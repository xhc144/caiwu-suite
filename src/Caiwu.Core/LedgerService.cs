using System.Globalization;
using System.Text;
using Caiwu.Contracts;

namespace Caiwu.Core;

/// <summary>
/// Single-year, RMB ledger rules. Each command reads a fresh revision and performs
/// exactly one atomic store write, including its audit event. The caller owns the store.
/// </summary>
public sealed class LedgerService : ILedgerService
{
    // Storage contract uses signed Int64 cents. No rounding or floating point conversion.
    private const decimal MaximumAmount = long.MaxValue / 100m;
    private readonly ILedgerStore store;

    public LedgerService(ILedgerStore store) => this.store = store ?? throw new ArgumentNullException(nameof(store));

    public LedgerSnapshot GetSnapshot() => Read();

    public void SaveAccount(Account account, string operatorName)
    {
        var actor = Actor(operatorName);
        Require(account is not null, "科目不能为空。");
        var before = Read();
        var nextAccount = account! with
        {
            Code = Code(account!.Code),
            Name = Text(account.Name, "科目名称"),
            ParentCode = account.ParentCode is null ? null : Code(account.ParentCode)
        };
        var old = before.Accounts.SingleOrDefault(a => a.Code == nextAccount.Code);
        var accounts = before.Accounts.Where(a => a.Code != nextAccount.Code).Append(nextAccount).ToArray();
        ValidateAccounts(accounts);

        if (old is not null)
        {
            var affected = Descendants(before.Accounts, old.Code);
            var hasHistory = before.Vouchers.Any(v => v.Lines.Any(l => affected.Contains(l.AccountCode)));
            var hasOpening = before.Accounts.Any(a => affected.Contains(a.Code) && (a.OpeningDebit != 0 || a.OpeningCredit != 0));
            if (old.Direction != nextAccount.Direction || old.ParentCode != nextAccount.ParentCode)
                Require(!hasHistory && !hasOpening, "科目或其下级已有凭证或期初余额，不能修改方向或上级关系。");
            if (old.OpeningDebit != nextAccount.OpeningDebit || old.OpeningCredit != nextAccount.OpeningCredit)
            {
                Require(!hasHistory, "已有凭证引用的科目不能直接修改期初余额，请使用期初余额设置。");
                RequireOpeningEditable(before);
            }
        }
        else if (nextAccount.OpeningDebit != 0 || nextAccount.OpeningCredit != 0)
            RequireOpeningEditable(before);

        if (nextAccount.ParentCode is not null)
            Require(!before.Vouchers.Any(v => v.Lines.Any(l => l.AccountCode == nextAccount.ParentCode)),
                "上级科目已有凭证引用，不能将其改为非末级科目。");
        ValidateOpeningBalance(accounts);
        Commit(before, before with { Accounts = accounts.OrderBy(a => a.Code, StringComparer.Ordinal).ToArray() },
            actor, "SaveAccount", null, $"保存科目 {nextAccount.Code} {nextAccount.Name}");
    }

    public void DeleteAccount(string code, string operatorName)
    {
        var actor = Actor(operatorName);
        code = Code(code);
        var before = Read();
        var account = FindAccount(before, code);
        Require(!before.Accounts.Any(a => a.ParentCode == code), "有下级科目的科目不能删除。");
        Require(account.OpeningDebit == 0 && account.OpeningCredit == 0, "有期初余额的科目不能删除。");
        Require(!before.Vouchers.Any(v => v.Lines.Any(l => l.AccountCode == code)), "已有凭证引用的科目不能删除。");
        Commit(before, before with { Accounts = before.Accounts.Where(a => a.Code != code).ToArray() },
            actor, "DeleteAccount", null, $"删除科目 {code}");
    }

    /// <summary>Replaces active leaf openings; disabled leaf openings must remain unchanged.</summary>
    public void SetOpeningBalances(IReadOnlyList<OpeningBalance> balances, string operatorName)
    {
        var actor = Actor(operatorName);
        Require(balances is not null, "期初余额不能为空。");
        var before = Read();
        RequireOpeningEditable(before);
        var values = new Dictionary<string, OpeningBalance>(StringComparer.Ordinal);
        foreach (var balance in balances!)
        {
            Require(balance is not null, "期初余额行不能为空。");
            var code = Code(balance!.AccountCode);
            Require(values.TryAdd(code, balance), "同一科目不能重复设置期初余额。");
            // Opening-grid rows also include disabled leaves. Their unchanged balances
            // are historical setup data, not permission to use them in new vouchers.
            var account = FindAccount(before, code);
            Require(!before.Accounts.Any(a => a.ParentCode == code), "只能为末级科目设置期初余额。");
            MoneyPair(balance.Debit, balance.Credit, allowZero: true);
            Require(account.IsActive || balance.Debit == account.OpeningDebit && balance.Credit == account.OpeningCredit,
                $"停用科目 {code} 只能原样保留期初余额，修改前请先启用科目。");
        }
        foreach (var account in before.Accounts.Where(a => !a.IsActive && (a.OpeningDebit != 0 || a.OpeningCredit != 0)))
            Require(values.ContainsKey(account.Code), $"停用科目 {account.Code} 已有期初余额，不能遗漏后静默清零；请原样提交或先启用再修改。");
        var accounts = before.Accounts.Select(a => values.TryGetValue(a.Code, out var b)
            ? a with { OpeningDebit = b.Debit, OpeningCredit = b.Credit }
            : a with { OpeningDebit = 0, OpeningCredit = 0 }).ToArray();
        ValidateOpeningBalance(accounts);
        Commit(before, before with { Accounts = accounts }, actor, "SetOpeningBalances", null,
            $"整体设置期初余额，共 {values.Count} 个科目");
    }

    public Voucher SaveDraft(VoucherDraft draft, string operatorName)
    {
        var actor = Actor(operatorName);
        Require(draft is not null, "凭证不能为空。");
        var before = Read();
        RequireOpenDate(before, draft!.Date);
        var kind = Text(draft.Kind, "凭证字");
        Require(draft.AttachmentCount >= 0, "附件张数不能为负数。");
        Voucher? old = null;
        if (draft.Id.HasValue)
        {
            old = FindVoucher(before, draft.Id.Value);
            RequireOpenDate(before, old.Date);
            Require(old.Status == VoucherStatus.Draft, "只能修改草稿凭证，已审核或记账凭证不能修改。");
        }
        var lines = ValidateLines(before, draft.Lines);
        var peers = before.Vouchers.Where(v => v.Id != old?.Id && v.Date.Year == draft.Date.Year &&
            v.Date.Month == draft.Date.Month && v.Kind == kind).ToArray();
        var number = draft.Number;
        if (number is null)
        {
            if (old is not null && old.Date.Month == draft.Date.Month && old.Kind == kind)
                number = old.Number;
            else
            {
                var maximum = peers.Select(v => v.Number).DefaultIfEmpty(0).Max();
                Require(maximum < int.MaxValue, "本月该凭证字的编号已用尽。");
                number = maximum + 1;
            }
        }
        Require(number > 0, "凭证编号必须为正整数。");
        Require(!peers.Any(v => v.Number == number), "本年度、本月、该凭证字下的编号已存在。");
        var voucher = new Voucher(old?.Id ?? Guid.NewGuid(), draft.Date, kind, number.Value,
            draft.AttachmentCount, actor, null, VoucherStatus.Draft, lines);
        Commit(before, before with { Vouchers = before.Vouchers.Where(v => v.Id != voucher.Id).Append(voucher).ToArray() },
            actor, "SaveDraft", voucher.Id, $"保存 {Label(voucher)}");
        return voucher;
    }

    public void DeleteDraft(Guid id, string operatorName)
    {
        var actor = Actor(operatorName);
        var before = Read();
        var voucher = FindVoucher(before, id);
        RequireOpenDate(before, voucher.Date);
        Require(voucher.Status == VoucherStatus.Draft, "只能删除草稿凭证。");
        Commit(before, before with { Vouchers = before.Vouchers.Where(v => v.Id != id).ToArray() },
            actor, "DeleteDraft", id, $"删除 {Label(voucher)}");
    }

    public void Review(Guid id, string reviewer)
    {
        var actor = Actor(reviewer);
        var before = Read();
        var voucher = FindVoucher(before, id);
        RequireOpenDate(before, voucher.Date);
        Require(voucher.Status == VoucherStatus.Draft, "只有草稿凭证可以审核。");
        Require(!SameActor(voucher.PreparedBy, actor), "制单人与审核人必须分离。");
        ValidateLines(before, voucher.Lines);
        ReplaceVoucher(before, voucher with { Status = VoucherStatus.Reviewed, ReviewedBy = actor }, actor, "Review");
    }

    public void CancelReview(Guid id, string operatorName)
    {
        var actor = Actor(operatorName);
        var before = Read();
        var voucher = FindVoucher(before, id);
        RequireOpenDate(before, voucher.Date);
        Require(voucher.Status == VoucherStatus.Reviewed, "只有已审核且未记账的凭证可以取消审核。");
        ReplaceVoucher(before, voucher with { Status = VoucherStatus.Draft, ReviewedBy = null }, actor, "CancelReview");
    }

    public void Post(Guid id, string operatorName)
    {
        var actor = Actor(operatorName);
        var before = Read();
        var voucher = FindVoucher(before, id);
        RequireOpenDate(before, voucher.Date);
        Require(voucher.Status == VoucherStatus.Reviewed, "只有已审核且未记账的凭证可以记账，不得重复记账。");
        Require(!string.IsNullOrWhiteSpace(voucher.ReviewedBy) && !SameActor(voucher.PreparedBy, voucher.ReviewedBy!),
            "凭证缺少独立审核人。");
        ValidateLines(before, voucher.Lines);
        ValidateOpeningBalance(before.Accounts);
        ReplaceVoucher(before, voucher with { Status = VoucherStatus.Posted }, actor, "Post");
    }

    public void CloseMonth(int month, string operatorName)
    {
        var actor = Actor(operatorName);
        var before = Read();
        Require(month >= before.Book.StartMonth && month <= 12, "结账月份超出账套会计期间。");
        Require(month == before.Book.ClosedThroughMonth + 1, "只能按月顺序结账，不能重复结账或跳月结账。");
        Require(!before.Vouchers.Any(v => v.Date.Month == month && v.Status != VoucherStatus.Posted),
            "该月仍有未记账凭证，不能结账。");
        ValidateOpeningBalance(before.Accounts);
        Commit(before, before with { Book = before.Book with { ClosedThroughMonth = month } },
            actor, "CloseMonth", null, $"结账 {before.Book.FiscalYear}-{month:00}");
    }

    public IReadOnlyList<TrialBalanceRow> GetTrialBalance(DateOnly from, DateOnly to)
    {
        var snapshot = Read();
        RequireRange(snapshot, from, to);
        var parents = snapshot.Accounts.Where(a => a.ParentCode is not null).Select(a => a.ParentCode!).ToHashSet(StringComparer.Ordinal);
        var totals = snapshot.Accounts.ToDictionary(a => a.Code, _ => new Totals(), StringComparer.Ordinal);
        foreach (var account in snapshot.Accounts.Where(a => !parents.Contains(a.Code)))
            totals[account.Code].Opening = account.OpeningDebit - account.OpeningCredit;
        foreach (var voucher in snapshot.Vouchers.Where(v => v.Status == VoucherStatus.Posted && v.Date <= to))
        foreach (var line in voucher.Lines)
        {
            var amount = totals[line.AccountCode];
            if (voucher.Date < from) amount.Opening += line.Debit - line.Credit;
            else { amount.Debit += line.Debit; amount.Credit += line.Credit; }
        }
        var leaves = snapshot.Accounts.Where(a => !parents.Contains(a.Code)).ToDictionary(a => a.Code,
            a => Row(a, totals[a.Code]), StringComparer.Ordinal);
        // Aggregate columns of leaf rows, retaining opposite balances in different leaves.
        return Array.AsReadOnly(snapshot.Accounts.OrderBy(a => a.Code, StringComparer.Ordinal).Select(a =>
        {
            if (leaves.TryGetValue(a.Code, out var leaf)) return leaf;
            var subtree = Descendants(snapshot.Accounts, a.Code);
            var rows = leaves.Values.Where(r => subtree.Contains(r.AccountCode)).ToArray();
            return new TrialBalanceRow(a.Code, a.Name, false, rows.Sum(r => r.OpeningDebit), rows.Sum(r => r.OpeningCredit),
                rows.Sum(r => r.PeriodDebit), rows.Sum(r => r.PeriodCredit), rows.Sum(r => r.ClosingDebit), rows.Sum(r => r.ClosingCredit));
        }).ToArray());
    }

    public IReadOnlyList<LedgerEntryRow> GetLedger(string accountCode, DateOnly from, DateOnly to)
    {
        accountCode = Code(accountCode);
        var snapshot = Read();
        RequireRange(snapshot, from, to);
        FindAccount(snapshot, accountCode);
        var subtree = Descendants(snapshot.Accounts, accountCode);
        var running = snapshot.Accounts.Where(a => subtree.Contains(a.Code)).Sum(a => a.OpeningDebit - a.OpeningCredit);
        var vouchers = snapshot.Vouchers.Where(v => v.Status == VoucherStatus.Posted && v.Date <= to)
            .OrderBy(v => v.Date).ThenBy(v => v.Kind, StringComparer.Ordinal).ThenBy(v => v.Number).ThenBy(v => v.Id).ToArray();
        foreach (var voucher in vouchers.Where(v => v.Date < from))
        foreach (var line in voucher.Lines.Where(l => subtree.Contains(l.AccountCode)))
            running += line.Debit - line.Credit;
        var rows = new List<LedgerEntryRow> { new(null, null, "", null, "期初余额", 0, 0, running) };
        foreach (var voucher in vouchers.Where(v => v.Date >= from))
        foreach (var line in voucher.Lines.Where(l => subtree.Contains(l.AccountCode)))
        {
            running += line.Debit - line.Credit;
            rows.Add(new(voucher.Date, voucher.Id, voucher.Kind, voucher.Number, line.Summary, line.Debit, line.Credit, running));
        }
        return rows.AsReadOnly();
    }

    private sealed class Totals { public decimal Opening; public decimal Debit; public decimal Credit; }

    private static TrialBalanceRow Row(Account a, Totals t)
    {
        var closing = t.Opening + t.Debit - t.Credit;
        return new(a.Code, a.Name, true, Math.Max(t.Opening, 0), Math.Max(-t.Opening, 0), t.Debit, t.Credit,
            Math.Max(closing, 0), Math.Max(-closing, 0));
    }

    private LedgerSnapshot Read()
    {
        var snapshot = Freeze(store.Read());
        Require(snapshot.Revision >= 0, "账套版本无效。");
        Require(snapshot.Book.FiscalYear is >= 1 and <= 9999 && snapshot.Book.StartMonth is >= 1 and <= 12 &&
            snapshot.Book.ClosedThroughMonth >= snapshot.Book.StartMonth - 1 && snapshot.Book.ClosedThroughMonth <= 12,
            "账套会计年度或期间设置无效。");
        ValidateAccounts(snapshot.Accounts);
        return snapshot;
    }

    private void ReplaceVoucher(LedgerSnapshot before, Voucher voucher, string actor, string action) =>
        Commit(before, before with { Vouchers = before.Vouchers.Select(v => v.Id == voucher.Id ? voucher : v).ToArray() },
            actor, action, voucher.Id, $"{action} {Label(voucher)}");

    private void Commit(LedgerSnapshot before, LedgerSnapshot next, string actor, string action, Guid? voucherId, string detail)
    {
        var audit = new AuditEvent(Guid.NewGuid(), DateTimeOffset.UtcNow, actor, action, voucherId, detail);
        next = Freeze(next with
        {
            Revision = checked(before.Revision + 1),
            AuditEvents = before.AuditEvents.Append(audit).ToArray()
        });
        // No retry: a stale decision must never silently overwrite another writer's work.
        store.Write(next, before.Revision);
    }

    private static LedgerSnapshot Freeze(LedgerSnapshot s) => s with
    {
        Accounts = Array.AsReadOnly(s.Accounts.ToArray()),
        Vouchers = Array.AsReadOnly(s.Vouchers.Select(v => v with { Lines = Array.AsReadOnly(v.Lines.ToArray()) }).ToArray()),
        AuditEvents = Array.AsReadOnly(s.AuditEvents.ToArray())
    };

    private static void ValidateAccounts(IReadOnlyList<Account> accounts)
    {
        var codes = new HashSet<string>(StringComparer.Ordinal);
        foreach (var a in accounts)
        {
            Require(a is not null, "科目不能为空。");
            Require(Code(a!.Code) == a.Code && codes.Add(a.Code), "科目编码无效或重复。");
            Text(a.Name, "科目名称");
            Require(Enum.IsDefined(a.Direction), "科目余额方向无效。");
            MoneyPair(a.OpeningDebit, a.OpeningCredit, allowZero: true);
        }
        var byCode = accounts.ToDictionary(a => a.Code, StringComparer.Ordinal);
        foreach (var a in accounts)
        {
            if (a.ParentCode is null) continue;
            Require(byCode.TryGetValue(a.ParentCode, out var parent), "上级科目不存在。");
            Require(a.Code.Length > parent!.Code.Length && a.Code.StartsWith(parent.Code, StringComparison.Ordinal),
                "下级科目编码必须以上级编码开头且更长，不能形成循环。");
            Require(!a.IsActive || parent.IsActive, "启用的科目不能隶属于停用的上级科目。");
            Require(parent.OpeningDebit == 0 && parent.OpeningCredit == 0, "非末级科目不能直接设置期初余额。");
        }
    }

    private static void ValidateOpeningBalance(IReadOnlyList<Account> accounts) =>
        Require(accounts.Sum(a => a.OpeningDebit) == accounts.Sum(a => a.OpeningCredit), "期初余额借贷不平衡。");

    private static void RequireOpeningEditable(LedgerSnapshot s) =>
        Require(s.Book.ClosedThroughMonth < s.Book.StartMonth && !s.Vouchers.Any(v => v.Status == VoucherStatus.Posted),
            "已有记账凭证或已结账期间，不能修改期初余额。");

    private static IReadOnlyList<VoucherLine> ValidateLines(LedgerSnapshot s, IReadOnlyList<VoucherLine> lines)
    {
        Require(lines is not null && lines.Count >= 2, "凭证至少需要两条有效分录。");
        var copy = new List<VoucherLine>();
        foreach (var line in lines!)
        {
            Require(line is not null, "凭证分录不能为空。");
            var code = Code(line!.AccountCode);
            RequireUsableLeaf(s, code);
            MoneyPair(line.Debit, line.Credit, allowZero: false);
            copy.Add(line with { AccountCode = code, Summary = Text(line.Summary, "分录摘要") });
        }
        Require(copy.Sum(l => l.Debit) == copy.Sum(l => l.Credit), "凭证借贷金额不平衡。");
        return copy.AsReadOnly();
    }

    private static void RequireUsableLeaf(LedgerSnapshot s, string code)
    {
        var account = FindAccount(s, code);
        Require(account.IsActive, "不能使用停用科目。");
        Require(!s.Accounts.Any(a => a.ParentCode == code), "只能使用末级科目。");
    }

    private static Account FindAccount(LedgerSnapshot s, string code) =>
        s.Accounts.SingleOrDefault(a => a.Code == code) ?? throw new LedgerValidationException($"科目 {code} 不存在。");

    private static Voucher FindVoucher(LedgerSnapshot s, Guid id) =>
        s.Vouchers.SingleOrDefault(v => v.Id == id) ?? throw new LedgerValidationException("凭证不存在，请刷新后重试。");

    private static HashSet<string> Descendants(IReadOnlyList<Account> accounts, string root)
    {
        var children = accounts.Where(a => a.ParentCode is not null).ToLookup(a => a.ParentCode!, a => a.Code, StringComparer.Ordinal);
        var found = new HashSet<string>(StringComparer.Ordinal) { root };
        var queue = new Queue<string>();
        queue.Enqueue(root);
        while (queue.TryDequeue(out var code))
            foreach (var child in children[code]) if (found.Add(child)) queue.Enqueue(child);
        return found;
    }

    private static void RequireDate(LedgerSnapshot s, DateOnly date) =>
        Require(date.Year == s.Book.FiscalYear && date.Month >= s.Book.StartMonth, "日期超出账套会计年度或启用月份。");

    private static void RequireOpenDate(LedgerSnapshot s, DateOnly date)
    {
        RequireDate(s, date);
        Require(date.Month > s.Book.ClosedThroughMonth, "该期间已结账，不能新增、修改、审核或记账。");
    }

    private static void RequireRange(LedgerSnapshot s, DateOnly from, DateOnly to)
    {
        RequireDate(s, from);
        RequireDate(s, to);
        Require(from <= to, "开始日期不能晚于结束日期。");
    }

    private static void MoneyPair(decimal debit, decimal credit, bool allowZero)
    {
        Money(debit); Money(credit);
        Require(debit == 0 || credit == 0, "同一行不能同时填写借方和贷方金额。");
        Require(allowZero || debit > 0 || credit > 0, "分录金额必须大于零。");
    }

    private static void Money(decimal amount) => Require(amount >= 0 && amount <= MaximumAmount && decimal.Round(amount, 2) == amount,
        "金额须为非负、最多两位小数，且不得超出 Int64 分的存储范围。");

    private static string Code(string value)
    {
        value = Text(value, "科目编码");
        Require(value.Length is >= 4 and <= 32 && value.All(c => c is >= '0' and <= '9'), "科目编码须为 4 至 32 位数字。");
        return value;
    }

    private static string Actor(string value) => Text(value, "操作人").Normalize(NormalizationForm.FormKC);
    private static bool SameActor(string first, string second) => string.Equals(Actor(first), Actor(second), StringComparison.OrdinalIgnoreCase);

    private static string Text(string value, string field)
    {
        Require(!string.IsNullOrWhiteSpace(value), $"{field}不能为空。");
        value = value.Trim();
        Require(!value.Any(char.IsControl), $"{field}不能含控制字符。");
        return value;
    }

    private static string Label(Voucher v) => $"{v.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)} {v.Kind}-{v.Number}";
    private static void Require(bool condition, string message)
    {
        if (!condition) throw new LedgerValidationException(message);
    }
}
