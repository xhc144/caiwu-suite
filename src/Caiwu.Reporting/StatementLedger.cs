using Caiwu.Contracts;

namespace Caiwu.Reporting;

internal sealed class StatementLedger
{
    internal static readonly HashSet<string> ProfitAccounts = ["5001", "5051", "5111", "5301", "5401", "5402", "5403", "5601", "5602", "5603", "5711", "5801"];
    internal static readonly HashSet<string> OfficialAccounts = [
        "1001", "1002", "1012", "1101", "1121", "1122", "1123", "1131", "1132", "1221", "1401", "1402", "1403", "1404", "1405", "1407", "1408", "1411", "1421",
        "1501", "1511", "1601", "1602", "1604", "1605", "1606", "1621", "1622", "1701", "1702", "1801", "1901", "2001", "2201", "2202", "2203", "2211", "2221", "2231", "2232", "2241",
        "2401", "2501", "2701", "3001", "3002", "3101", "3103", "3104", "4001", "4101", "4301", "4401", "4403", .. ProfitAccounts];
    internal BookInfo Book { get; }
    internal long Revision { get; }
    internal SmallBusinessStatementOptions Options { get; }
    internal Dictionary<string, Account> Accounts { get; }
    internal Dictionary<string, string?> Roots { get; } = new(StringComparer.Ordinal);
    internal Dictionary<string, decimal> Opening { get; } = new(StringComparer.Ordinal);
    internal Dictionary<string, decimal> Closing { get; } = new(StringComparer.Ordinal);
    internal Voucher[] Posted { get; }
    internal HashSet<Guid> ClosingIds { get; }
    internal List<StatementIssue> Issues { get; } = [];
    internal string? FatalCoverageIssue { get; }
    internal string? IncomeCoverageIssue { get; }

    internal StatementLedger(LedgerSnapshot snapshot, DateOnly asOf, SmallBusinessStatementOptions options)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        Book = snapshot.Book;
        Revision = snapshot.Revision;
        Options = options;
        if (Book.Regime != AccountingRegime.SmallBusiness)
            throw new NotSupportedException("此计算器仅支持小企业制度；企业及民非不能套用。");
        if (Book.FiscalYear != 2026 || Book.StartMonth != 1)
            throw new NotSupportedException("首版仅支持 2026 单年度且 1 月启用的完整账套；年中启用、跨年及上年比较须补数据与规则。");
        if (asOf.Year != Book.FiscalYear)
            throw new ArgumentException("报告日必须位于账套单一会计年度。", nameof(asOf));
        Accounts = snapshot.Accounts.ToDictionary(a => a.Code, StringComparer.Ordinal);
        var mappings = options.AccountMappings.ToDictionary(m => m.RootAccountCode, m => m.OfficialAccountCode, StringComparer.Ordinal);
        foreach (var (actual, official) in mappings)
            if (!Accounts.TryGetValue(actual, out var a) || a.ParentCode is not null || !OfficialAccounts.Contains(official))
                throw new ArgumentException("根科目映射必须从实际一级科目指向正式 2011 一级编码。", nameof(options));
        var parents = Accounts.Values.Where(a => a.ParentCode is not null).Select(a => a.ParentCode!).ToHashSet(StringComparer.Ordinal);
        decimal openingCheck = 0;
        foreach (var account in Accounts.Values)
        {
            if (!Enum.IsDefined(account.Direction)) throw new ArgumentException("科目方向未知。", nameof(snapshot));
            var seen = new HashSet<string>(StringComparer.Ordinal) { account.Code };
            var root = account;
            while (root.ParentCode is { } parent)
            {
                if (!seen.Add(parent) || !Accounts.TryGetValue(parent, out root!))
                    throw new ArgumentException("科目父子关系循环或缺少上级。", nameof(snapshot));
            }
            var official = mappings.GetValueOrDefault(root.Code) ?? (OfficialAccounts.Contains(root.Code) ? root.Code : null);
            Roots.Add(account.Code, official);
            ValidateMoneyPair(account.OpeningDebit, account.OpeningCredit);
            if (parents.Contains(account.Code))
            {
                if (account.OpeningDebit != 0 || account.OpeningCredit != 0)
                    throw new ArgumentException("非末级科目不能重复携带期初余额。", nameof(snapshot));
                continue;
            }
            var amount = MoneyMath.Add(account.OpeningDebit, -account.OpeningCredit);
            Opening.Add(account.Code, amount);
            Closing.Add(account.Code, amount);
            openingCheck = MoneyMath.Add(openingCheck, amount);
        }
        if (openingCheck != 0) throw new ArgumentException("账套期初借贷不平衡。", nameof(snapshot));
        if (snapshot.Vouchers.Select(v => v.Id).Distinct().Count() != snapshot.Vouchers.Count ||
            snapshot.Vouchers.Any(v => !Enum.IsDefined(v.Status)))
            throw new ArgumentException("凭证 ID 重复或状态未知。", nameof(snapshot));
        Posted = snapshot.Vouchers.Where(v => v.Status == VoucherStatus.Posted).ToArray();
        foreach (var voucher in Posted)
        {
            if (voucher.Date.Year != Book.FiscalYear) throw new ArgumentException("已记账凭证跨账套年度。", nameof(snapshot));
            decimal check = 0;
            foreach (var line in voucher.Lines)
            {
                if (!Opening.ContainsKey(line.AccountCode)) throw new ArgumentException("凭证引用未知或非末级科目。", nameof(snapshot));
                ValidateMoneyPair(line.Debit, line.Credit);
                var delta = MoneyMath.Add(line.Debit, -line.Credit);
                check = MoneyMath.Add(check, delta);
                if (voucher.Date <= asOf) Closing[line.AccountCode] = MoneyMath.Add(Closing[line.AccountCode], delta);
            }
            if (check != 0) throw new ArgumentException("已记账凭证借贷不平衡。", nameof(snapshot));
        }
        ClosingIds = options.ProfitClosingVoucherIds.ToHashSet();
        foreach (var id in ClosingIds)
        {
            var voucher = Posted.SingleOrDefault(v => v.Id == id);
            if (voucher is null || !voucher.Lines.Any(l => Roots[l.AccountCode] == "3103") ||
                voucher.Lines.Any(l => Roots[l.AccountCode] is not { } r || (!ProfitAccounts.Contains(r) && r is not "3103" and not "3104")))
                throw new ArgumentException("显式损益结转凭证必须已记账，含本年利润，且仅涉及损益、本年利润或利润分配。", nameof(options));
        }
        var unknown = Opening.Keys.Where(k => Roots[k] is null).ToArray();
        foreach (var code in unknown) Issues.Add(new("UnknownAccount", $"未映射科目：{code} {Accounts[code].Name}"));
        if (Accounts.Count == 0) FatalCoverageIssue = "无科目数据，无法确认不存在的业务，不能以全零代替缺失。";
        else if (unknown.Any(k => Opening[k] != 0 || Posted.Where(v => v.Date <= asOf).Any(v => v.Lines.Any(l => l.AccountCode == k && (l.Debit != 0 || l.Credit != 0)))))
            FatalCoverageIssue = "存在有余额或本年发生额的未映射科目；不能判断它应归入哪些正式项目。";
        var unclassifiedClosing = Posted.Any(v => v.Date <= asOf && !ClosingIds.Contains(v.Id) &&
            v.Lines.Any(l => Roots[l.AccountCode] == "3103") && v.Lines.Any(l => IsProfit(l.AccountCode)));
        IncomeCoverageIssue = FatalCoverageIssue ?? (Opening.Any(p => IsProfit(p.Key) && p.Value != 0)
            ? "损益科目带非零年初余额，不能确认完整本年发生额。" : unclassifiedClosing
                ? "存在未显式分类的本年利润/损益结转凭证，不能把结转当经营发生额或按摘要猜测。" : null);
        if (FatalCoverageIssue is not null) Issues.Add(new("IncompleteInput", FatalCoverageIssue));
        if (IncomeCoverageIssue is not null && IncomeCoverageIssue != FatalCoverageIssue) Issues.Add(new("IncomeBasis", IncomeCoverageIssue));
        var termCodes = new HashSet<string>(StringComparer.Ordinal);
        foreach (var term in options.SettlementTerms)
            if (!termCodes.Add(term.AccountCode) || !Opening.ContainsKey(term.AccountCode) || Roots[term.AccountCode] is not ("1122" or "1123" or "2202" or "2203"))
                throw new ArgumentException("往来期限分类须为不重复的往来末级科目。", nameof(options));
    }

    internal bool IsProfit(string code) => Roots[code] is { } root && ProfitAccounts.Contains(root);
    internal decimal Balance(bool opening, params string[] roots) => Sum((opening ? Opening : Closing)
        .Where(p => Roots[p.Key] is { } root && roots.Contains(root, StringComparer.Ordinal)).Select(p => p.Value));
    internal decimal Activity(DateOnly from, DateOnly to, IEnumerable<string> codes) => Sum(Posted
        .Where(v => v.Date >= from && v.Date <= to && !ClosingIds.Contains(v.Id))
        .SelectMany(v => v.Lines).Where(l => codes.Contains(l.AccountCode, StringComparer.Ordinal))
        .Select(l => MoneyMath.Add(l.Debit, -l.Credit)));
    internal string[] Leaves(params string[] roots) => Opening.Keys.Where(k => Roots[k] is { } r && roots.Contains(r, StringComparer.Ordinal)).ToArray();
    internal bool HasActivity(DateOnly from, DateOnly to, string root) => Posted
        .Where(v => v.Date >= from && v.Date <= to && !ClosingIds.Contains(v.Id)).SelectMany(v => v.Lines)
        .Any(l => Roots[l.AccountCode] == root && (l.Debit != 0 || l.Credit != 0));
    internal string[] DescendantLeaves(string account)
    {
        if (!Accounts.ContainsKey(account)) throw new ArgumentException("明细映射科目不存在。");
        return Opening.Keys.Where(k =>
        {
            var code = k;
            while (true) { if (code == account) return true; if (Accounts[code].ParentCode is not { } parent) return false; code = parent; }
        }).ToArray();
    }
    internal static decimal Sum(IEnumerable<decimal> values) => values.Aggregate(0m, MoneyMath.Add);
    private static void ValidateMoneyPair(decimal debit, decimal credit)
    {
        if (debit < 0 || credit < 0 || debit > long.MaxValue / 100m || credit > long.MaxValue / 100m ||
            (debit != 0 && credit != 0)) throw new ArgumentException("账务金额须在 Int64 分范围内且单行只能有一方。");
        _ = ReportCell.Money(debit); _ = ReportCell.Money(credit);
    }
}
