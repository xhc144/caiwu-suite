using static Caiwu.Nonprofit.NonprofitRules;
using static Caiwu.Nonprofit.Writable.NonprofitLedgerValidation;

namespace Caiwu.Nonprofit.Writable;

/// <summary>Writable module boundary; the host supplies atomic storage and authorization.
/// Each operation consumes the exact book/revision the user edited or confirmed.</summary>
public sealed partial class NonprofitLedgerService
{
    private readonly INonprofitLedgerStore store;
    private readonly INonprofitAuthorizer authorizer;
    private readonly TimeProvider clock;
    public NonprofitLedgerService(INonprofitLedgerStore store, INonprofitAuthorizer authorizer, TimeProvider? clock = null)
    { this.store = store ?? throw new ArgumentNullException(nameof(store)); this.authorizer = authorizer ?? throw new ArgumentNullException(nameof(authorizer)); this.clock = clock ?? TimeProvider.System; }

    public NonprofitLedgerSnapshot GetSnapshot()
    { var value = AtomicNonprofitLedgerStore.Freeze(store.Read()); Validate(value); return value; }
    public void Initialize(NonprofitBookDefinition definition, string actor)
    {
        Require(actor, NonprofitPermission.Initialize);
        var s = new NonprofitLedgerSnapshot(1, definition.BookId, definition.BookCode, definition.Name,
            definition.OriginalTemplateId, definition.ChartEvidenceReference, definition.FiscalYear, definition.StartMonth,
            definition.StartMonth - 1, 0, false, false, definition.Accounts, [], definition.Restrictions, [],
            [new(Guid.NewGuid(), clock.GetUtcNow(), actor, "Initialize", null, definition.ChartEvidenceReference)], definition.OriginalFields);
        Validate(s); store.Initialize(AtomicNonprofitLedgerStore.Freeze(s));
    }
    private void Require(string actor, NonprofitPermission permission)
    { ArgumentException.ThrowIfNullOrWhiteSpace(actor); authorizer.Require(actor, permission); }
    private NonprofitLedgerSnapshot Begin(NonprofitMutationContext context, string actor, NonprofitPermission permission)
    {
        ArgumentNullException.ThrowIfNull(context); Require(actor, permission); var s = GetSnapshot();
        if (context.BookId != s.BookId || context.Revision != s.Revision)
            throw new NonprofitConcurrencyException("账套或账簿版本已变化；请重新核对后再操作。");
        Check(s.Revision < long.MaxValue, "NP_REVISION_OVERFLOW", "账簿版本不能再推进。"); return s;
    }
    private void Commit(NonprofitLedgerSnapshot old, NonprofitLedgerSnapshot next, string actor, string action, Guid? voucher = null, string detail = "")
    {
        next = next with { Revision = old.Revision + 1, Audit = next.Audit.Append(new NonprofitAudit(Guid.NewGuid(), clock.GetUtcNow(), actor, action, voucher, detail)).ToArray() };
        Validate(next); store.Commit(new(old.BookId, old.Revision), AtomicNonprofitLedgerStore.Freeze(next));
    }
    private static void OpenMonth(NonprofitLedgerSnapshot s, int month)
    { Check(month >= s.StartMonth && month <= 12 && month > s.ClosedThroughMonth, "NP_CLOSED_MONTH", "月份已经结账或超出本账年度；请先反结账。"); }
    private static NonprofitLedgerVoucher Voucher(NonprofitLedgerSnapshot s, Guid id) =>
        s.Vouchers.SingleOrDefault(v => v.Id == id) ?? throw new NonprofitValidationException("NP_VOUCHER_MISSING", "凭证不存在。");
    private static NonprofitLedgerSnapshot Replace(NonprofitLedgerSnapshot s, NonprofitLedgerVoucher v) =>
        s with { Vouchers = s.Vouchers.Select(old => old.Id == v.Id ? v : old).ToArray() };
    private static IReadOnlyList<OriginalField> Preserve(IReadOnlyList<OriginalField> old, IReadOnlyList<OriginalField> supplied)
    {
        Fields(supplied); var result = old.ToDictionary(f => (f.Table, f.Column));
        foreach (var f in supplied)
        {
            Check(!result.TryGetValue((f.Table, f.Column), out var before) || before == f,
                "NP_ORIGINAL_VALUE_CHANGED", "来源原值只作留存，不能在规范化编辑中覆盖。");
            result[(f.Table, f.Column)] = f;
        }
        return result.Values.ToArray();
    }

    public void SaveAccount(NonprofitLedgerAccount account, NonprofitMutationContext context, string actor)
    {
        var s = Begin(context, actor, NonprofitPermission.MaintainAccounts);
        var old = s.Accounts.SingleOrDefault(a => a.Code == account.Code);
        if (old is not null)
        {
            var used = s.Opening.Any(o => o.AccountCode == account.Code) || s.Vouchers.Any(v => v.Lines.Any(l => l.AccountCode == account.Code));
            Check(!used || old.OfficialRoot == account.OfficialRoot && old.Kind == account.Kind && old.ParentCode == account.ParentCode,
                "NP_USED_ACCOUNT", "已使用科目不能改变根映射、类别或父科目。");
            account = account with { OriginalFields = Preserve(old.OriginalFields, account.OriginalFields) };
        }
        var accounts = s.Accounts.Where(a => a.Code != account.Code).Append(account).ToArray();
        Commit(s, s with { Accounts = accounts }, actor, "SaveAccount", detail: account.Code);
    }

    public void SetOpening(IReadOnlyList<NonprofitOpening> opening, NonprofitMutationContext context, string actor)
    {
        var s = Begin(context, actor, NonprofitPermission.MaintainOpening);
        Check(!s.HasEverPosted && s.ClosedThroughMonth == s.StartMonth - 1, "NP_OPENING_LOCKED", "本年已有过账后不能再改期初，即使随后反过账。");
        // Preserve source fields of retained rows. Omitted rows are an explicit opening replacement.
        var prior = s.Opening.ToDictionary(o => o.Id);
        var rows = opening.Select(o => prior.TryGetValue(o.Id, out var old) ? o with { OriginalFields = Preserve(old.OriginalFields, o.OriginalFields) } : o).ToArray();
        Check(Sum(rows.Select(o => o.Debit - o.Credit)) == 0, "NP_OPENING_UNBALANCED", "年初数不平，不能确认期初。");
        Commit(s, s with { Opening = rows, OpeningConfirmed = true }, actor, "SetOpening");
    }

    public NonprofitLedgerVoucher SaveDraft(NonprofitVoucherDraft draft, NonprofitMutationContext context, string actor)
    {
        var s = Begin(context, actor, NonprofitPermission.EditVoucher); OpenMonth(s, draft.Date.Month);
        var old = draft.Id is { } id ? Voucher(s, id) : null;
        Check(old is null || old.State == NonprofitVoucherState.Draft, "NP_VOUCHER_READONLY", "已审核/过账凭证不能直接修改，请先执行逆操作。");
        if (old is not null) OpenMonth(s, old.Date.Month);
        var number = draft.Number ?? old?.Number ?? checked(s.Vouchers.Where(v => v.Date.Month == draft.Date.Month && v.Kind == draft.Kind).Select(v => v.Number).DefaultIfEmpty().Max() + 1);
        var prior = old?.Lines.ToDictionary(l => l.Id) ?? [];
        var lines = draft.Lines.Select(l => prior.TryGetValue(l.Id, out var before) ? l with { OriginalFields = Preserve(before.OriginalFields, l.OriginalFields) } : l).ToArray();
        foreach (var line in lines) Check(Leaf(s, line.AccountCode).Active, "NP_INACTIVE_ACCOUNT", "停用科目不能新增/修改分录。");
        var v = new NonprofitLedgerVoucher(old?.Id ?? Guid.NewGuid(), draft.Date, draft.Kind, number, draft.AttachmentCount,
            old?.PreparedBy ?? actor, null, null, old?.PreparedAt ?? clock.GetUtcNow(), null, null, NonprofitVoucherState.Draft,
            draft.Role, draft.EvidenceReference, draft.SourceProposalId, lines, Preserve(old?.OriginalFields ?? [], draft.OriginalFields));
        Commit(s, s with { Vouchers = s.Vouchers.Where(x => x.Id != v.Id).Append(v).ToArray() }, actor, "SaveDraft", v.Id);
        return AtomicNonprofitLedgerStore.Freeze(s with { Vouchers = [v] }).Vouchers[0];
    }

    public void DeleteDraft(Guid id, NonprofitMutationContext context, string actor)
    {
        var s = Begin(context, actor, NonprofitPermission.EditVoucher); var v = Voucher(s, id); OpenMonth(s, v.Date.Month);
        Check(v.State == NonprofitVoucherState.Draft, "NP_VOUCHER_READONLY", "只能删除未审核凭证。");
        Commit(s, s with { Vouchers = s.Vouchers.Where(v => v.Id != id).ToArray() }, actor, "DeleteDraft", id);
    }
    public void Review(Guid id, NonprofitMutationContext context, string actor)
    {
        var s = Begin(context, actor, NonprofitPermission.Review); var v = Voucher(s, id); OpenMonth(s, v.Date.Month);
        Check(v.State == NonprofitVoucherState.Draft && v.PreparedBy != actor, "NP_REVIEW", "审核人和制单人相同不能审核，且只能审核草稿。");
        Commit(s, Replace(s, v with { State = NonprofitVoucherState.Reviewed, ReviewedBy = actor, ReviewedAt = clock.GetUtcNow() }), actor, "Review", id);
    }
    public void CancelReview(Guid id, NonprofitMutationContext context, string actor)
    {
        var s = Begin(context, actor, NonprofitPermission.Review); var v = Voucher(s, id); OpenMonth(s, v.Date.Month);
        Check(v.State == NonprofitVoucherState.Reviewed, "NP_REVIEW", "已过账请先反过账；只有已审核凭证可反审核。");
        Commit(s, Replace(s, v with { State = NonprofitVoucherState.Draft, ReviewedBy = null, ReviewedAt = null }), actor, "CancelReview", id);
    }
    public NonprofitPostResult PostMonth(int month, NonprofitMutationContext context, string actor)
    {
        var s = Begin(context, actor, NonprofitPermission.Post); OpenMonth(s, month);
        Check(s.OpeningConfirmed, "NP_OPENING_REQUIRED", "请先录入并确认平衡的期初数（包括明确确认的零）。");
        var selected = s.Vouchers.Where(v => v.Date.Month == month && v.State == NonprofitVoucherState.Reviewed).Select(v => v.Id).ToHashSet();
        Check(selected.Count > 0, "NP_NOTHING_TO_POST", "没有需要过账的已审核凭证。");
        var skipped = s.Vouchers.Where(v => v.Date.Month == month && v.State == NonprofitVoucherState.Draft).Select(v => v.Id).ToArray();
        var next = s with { HasEverPosted = true, Vouchers = s.Vouchers.Select(v => selected.Contains(v.Id) ? v with { State = NonprofitVoucherState.Posted, PostedBy = actor, PostedAt = clock.GetUtcNow() } : v).ToArray() };
        Commit(s, next, actor, "PostMonth", detail: $"month={month};posted={selected.Count};skippedUnreviewed={skipped.Length}");
        return new(Array.AsReadOnly(selected.ToArray()), Array.AsReadOnly(skipped));
    }
    public void ReversePost(int fromMonth, int toMonth, NonprofitMutationContext context, string actor)
    {
        var s = Begin(context, actor, NonprofitPermission.ReversePost); OpenMonth(s, fromMonth); OpenMonth(s, toMonth);
        Check(fromMonth <= toMonth, "NP_PERIOD_MISMATCH", "请输入有效的起止月份范围。");
        Check(s.Vouchers.Any(v => v.Date.Month >= fromMonth && v.Date.Month <= toMonth && v.State == NonprofitVoucherState.Posted), "NP_NOTHING_TO_REVERSE", "范围内没有已过账凭证。");
        Commit(s, s with { Vouchers = s.Vouchers.Select(v => v.Date.Month >= fromMonth && v.Date.Month <= toMonth && v.State == NonprofitVoucherState.Posted
            ? v with { State = NonprofitVoucherState.Reviewed, PostedBy = null, PostedAt = null } : v).ToArray() }, actor, "ReversePost", detail: $"months={fromMonth}-{toMonth}");
    }

    public IReadOnlyList<NonprofitAccountBalance> GetBalances(DateOnly through)
    { var s = GetSnapshot(); Check(through.Year == s.FiscalYear && through.Month >= s.StartMonth, "NP_PERIOD_MISMATCH", "余额日期超出本账年度。"); return Balances(s, through); }
    public static IReadOnlyList<NonprofitAccountBalance> Balances(NonprofitLedgerSnapshot s, DateOnly through) =>
        s.Opening.Select(o => new NonprofitAccountBalance(o.AccountCode, o.Classification, o.Debit - o.Credit))
            .Concat(s.Vouchers.Where(v => v.State == NonprofitVoucherState.Posted && v.Date <= through)
                .SelectMany(v => v.Lines).Select(l => new NonprofitAccountBalance(l.AccountCode, l.Classification, l.Debit - l.Credit)))
            .GroupBy(b => (b.AccountCode, b.Classification))
            .Select(g => new NonprofitAccountBalance(g.Key.AccountCode, g.Key.Classification, Sum(g.Select(b => b.NetDebit)))).ToArray();

    public void CloseMonth(int month, NonprofitMutationContext context, string actor)
    {
        var s = Begin(context, actor, NonprofitPermission.Close); OpenMonth(s, month);
        Check(s.OpeningConfirmed && month == s.ClosedThroughMonth + 1, "NP_CLOSE_SEQUENCE", "须确认期初并按月顺序结账。");
        var vouchers = s.Vouchers.Where(v => v.Date.Month == month).ToArray();
        Check(vouchers.All(v => v.State == NonprofitVoucherState.Posted), "NP_UNPOSTED", "本月还有未过账凭证，不能结账。");
        foreach (var group in vouchers.GroupBy(v => v.Kind))
            Check(group.Select(v => v.Number).Order().SequenceEqual(Enumerable.Range(1, group.Count())), "NP_NUMBER_GAP", "本月凭证编号不连续；请核对后显式调整编号，影响已打印的凭证和账册。");
        Check(Balances(s, new(s.FiscalYear, month, DateTime.DaysInMonth(s.FiscalYear, month))).Where(b => ProfitLoss(Leaf(s, b.AccountCode))).All(b => b.NetDebit == 0),
            "NP_CLOSING_REQUIRED", "损益尚未按类别结转；请生成、审核并过账月度结转凭证。");
        Commit(s, s with { ClosedThroughMonth = month }, actor, "CloseMonth", detail: $"month={month}");
    }
    public void ReopenLastMonth(NonprofitMutationContext context, string actor)
    {
        var s = Begin(context, actor, NonprofitPermission.Reopen);
        Check(s.ClosedThroughMonth >= s.StartMonth, "NP_OPENING_BOUNDARY", "已经反结账到开账日期，不能越过本账年度。");
        Commit(s, s with { ClosedThroughMonth = s.ClosedThroughMonth - 1 }, actor, "ReopenMonth", detail: $"month={s.ClosedThroughMonth}");
    }
    public void RenumberMonth(int month, bool printedDocumentImpactConfirmed, NonprofitMutationContext context, string actor)
    {
        var s = Begin(context, actor, NonprofitPermission.Close); OpenMonth(s, month);
        Check(printedDocumentImpactConfirmed, "NP_RENUMBER_CONFIRM", "自动调整将影响已打印凭证和账册，须先明确确认。");
        var replacements = s.Vouchers.Where(v => v.Date.Month == month).GroupBy(v => v.Kind)
            .SelectMany(g => g.OrderBy(v => v.Number).ThenBy(v => v.Id).Select((v, i) => v with { Number = i + 1 })).ToDictionary(v => v.Id);
        var changes = s.Vouchers.Where(v => replacements.TryGetValue(v.Id, out var n) && v.Number != n.Number).Select(v => $"{v.Id:D}:{v.Number}->{replacements[v.Id].Number}").ToArray();
        Check(changes.Length > 0, "NP_NUMBER_CONTINUOUS", "编号已经连续，无需调整。");
        Commit(s, s with { Vouchers = s.Vouchers.Select(v => replacements.GetValueOrDefault(v.Id) ?? v).ToArray() }, actor, "RenumberMonth", detail: string.Join(";", changes));
    }
}
