using R = Caiwu.ReportDesigner.SafeFormula.Rational;

namespace Caiwu.ReportDesigner.Cells;

public sealed record ReportAccount(string Code, string? ParentCode, decimal OpeningDebit, decimal OpeningCredit);
public sealed record ReportEntry(string AccountCode, decimal Debit, decimal Credit);
public sealed record ReportVoucher(string Id, DateOnly Date, bool Posted, IReadOnlyList<ReportEntry> Entries);
/// <summary>Own DTO boundary: complete base-currency ledger, explicit hierarchy, immutable copies. No database access.</summary>
public sealed class LedgerReportSource : IReportDataSource
{
    private readonly Guid bookId;
    private readonly long revision;
    private readonly DateOnly openingDate, completeThrough;
    private readonly ReportAccount[] accounts;
    private readonly ReportVoucher[] vouchers;
    private readonly bool synthetic;
    public LedgerReportSource(Guid bookId, long revision, DateOnly openingDate, DateOnly completeThrough, IEnumerable<ReportAccount> accounts,
        IEnumerable<ReportVoucher> vouchers, bool isSynthetic)
    {
        if (bookId == Guid.Empty || revision < 0 || openingDate > completeThrough) throw new ArgumentException("账套标识或代次无效。");
        this.bookId = bookId; this.revision = revision; this.openingDate = openingDate; this.completeThrough = completeThrough; synthetic = isSynthetic;
        this.accounts = accounts.Select(a => a with { }).ToArray();
        this.vouchers = vouchers.Select(v => v with { Entries = Array.AsReadOnly(v.Entries.ToArray()) }).ToArray();
        Validate();
    }
    private void Validate()
    {
        if (accounts.Length is < 1 or > 10000 || vouchers.Length > 100000 || vouchers.Sum(v => (long)v.Entries.Count) > 1000000)
            throw new ReportDataException("账务快照为空或超过预算。");
        if (accounts.Any(a => string.IsNullOrWhiteSpace(a.Code)) || accounts.Select(a => a.Code).Distinct(StringComparer.Ordinal).Count() != accounts.Length)
            throw new ReportDataException("科目编码为空或重复。");
        var map = accounts.ToDictionary(a => a.Code, StringComparer.Ordinal);
        var parents = accounts.Where(a => a.ParentCode is not null).Select(a => a.ParentCode!).ToHashSet(StringComparer.Ordinal);
        foreach (var a in accounts)
        {
            if (string.IsNullOrWhiteSpace(a.Code) || a.Code.Length > 40 || a.Code.Any(char.IsControl) || a.OpeningDebit < 0 || a.OpeningCredit < 0 ||
                (a.OpeningDebit != 0 && a.OpeningCredit != 0)) throw new ReportDataException("科目/期初借贷无效。");
            if (parents.Contains(a.Code) && (a.OpeningDebit != 0 || a.OpeningCredit != 0)) throw new ReportDataException("父科目不能携带期初，避免父子重复。");
            var seen = new HashSet<string>(StringComparer.Ordinal); var current = a;
            while (true)
            {
                if (!seen.Add(current.Code) || seen.Count > 64) throw new ReportDataException("科目树循环或超过64层。");
                if (current.ParentCode is null) break;
                if (!map.TryGetValue(current.ParentCode, out current!)) throw new ReportDataException("科目父节点缺失。");
            }
        }
        R Sum(IEnumerable<decimal> numbers) => numbers.Aggregate(R.Zero, (a, b) => a + R.FromDecimal(b));
        if ((Sum(accounts.Select(a => a.OpeningDebit)) - Sum(accounts.Select(a => a.OpeningCredit))).ToDecimal() != 0)
            throw new ReportDataException("期初借贷不平衡。");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var v in vouchers)
        {
            if (string.IsNullOrWhiteSpace(v.Id) || !ids.Add(v.Id) || v.Date < openingDate || v.Date > completeThrough || v.Entries.Count < 2)
                throw new ReportDataException("凭证标识、日期或分录数无效。");
            foreach (var line in v.Entries)
                if (!map.ContainsKey(line.AccountCode) || parents.Contains(line.AccountCode) || line.Debit < 0 || line.Credit < 0 ||
                    (line.Debit == 0) == (line.Credit == 0)) throw new ReportDataException("分录必须是已知末级科目，借贷只能有一侧为正。");
            if ((Sum(v.Entries.Select(e => e.Debit)) - Sum(v.Entries.Select(e => e.Credit))).ToDecimal() != 0)
                throw new ReportDataException("凭证借贷不平衡。");
        }
    }
    public IReportDataSnapshot Capture(ReportQueryContext context)
    {
        if (context.BookId != bookId || context.ExpectedRevision != revision) throw new ReportDataException("账套或快照代次已变化，请重新生成。");
        if (context.From > context.To || context.From < openingDate || context.To > completeThrough || context.From.Year != context.To.Year)
            throw new ReportDataException("期间必须在完整快照范围内，且不跨年。");
        return new Snapshot(this, context);
    }
    private sealed class Snapshot : IReportDataSnapshot
    {
        public ReportSourceStamp Stamp { get; }
        private readonly Dictionary<ReportDataRequest, decimal> cache = [];
        private readonly Dictionary<string, HashSet<string>> leaves = new(StringComparer.Ordinal);
        private readonly Dictionary<string, Totals> totals = new(StringComparer.Ordinal);
        private readonly bool yearComplete;
        private sealed class Totals { public R Opening = R.Zero, Closing = R.Zero, Debit = R.Zero, Credit = R.Zero, YtdDebit = R.Zero, YtdCredit = R.Zero; }
        public Snapshot(LedgerReportSource source, ReportQueryContext context)
        {
            Stamp = new(context.BookId, context.From, context.To, context.ExpectedRevision, "CNY", source.synthetic,
                source.vouchers.Count(v => !v.Posted && v.Date <= context.To), "完整本位币快照；只计已过账凭证；余额为借减贷；无外币/数量/辅助维度适配。");
            yearComplete = source.openingDate <= new DateOnly(context.From.Year, 1, 1);
            var map = source.accounts.ToDictionary(a => a.Code, StringComparer.Ordinal);
            var parents = source.accounts.Where(a => a.ParentCode is not null).Select(a => a.ParentCode!).ToHashSet(StringComparer.Ordinal);
            foreach (var account in source.accounts) leaves.Add(account.Code, new(StringComparer.Ordinal));
            foreach (var a in source.accounts.Where(a => !parents.Contains(a.Code)))
            {
                var n = a; var opening = R.FromDecimal(a.OpeningDebit) - R.FromDecimal(a.OpeningCredit);
                totals.Add(a.Code, new() { Opening = opening, Closing = opening });
                while (true) { leaves[n.Code].Add(a.Code); if (n.ParentCode is null) break; n = map[n.ParentCode]; }
            }
            foreach (var v in source.vouchers.Where(v => v.Posted && v.Date <= context.To))
            foreach (var e in v.Entries)
            {
                var t = totals[e.AccountCode]; var d = R.FromDecimal(e.Debit); var c = R.FromDecimal(e.Credit);
                t.Closing += d - c;
                if (v.Date < context.From) t.Opening += d - c;
                if (v.Date >= context.From) { t.Debit += d; t.Credit += c; }
                if (v.Date.Year == context.To.Year) { t.YtdDebit += d; t.YtdCredit += c; }
            }
        }
        public decimal Read(ReportDataRequest request)
        {
            if (!Enum.IsDefined(request.Measure)) throw new ReportDataException("未知取数类型。");
            if (cache.TryGetValue(request, out var existing)) return existing;
            if (!leaves.TryGetValue(request.AccountCode, out var descendants)) throw new ReportDataException($"科目 {request.AccountCode} 不存在，不能填零。");
            if (!request.IncludeDescendants && !totals.ContainsKey(request.AccountCode)) throw new ReportDataException("父科目须明确使用 TREE 汇总末级，不能填零。");
            if (!yearComplete && request.Measure is ReportMeasure.YearToDateCredit or ReportMeasure.YearToDateDebit)
                throw new ReportDataException("年中启用快照缺年初至启用日前发生额，不能计算本年累计。");
            var sum = R.Zero;
            foreach (var key in request.IncludeDescendants ? descendants : new HashSet<string> { request.AccountCode })
            {
                var t = totals[key];
                sum += request.Measure switch { ReportMeasure.Opening => t.Opening, ReportMeasure.Closing => t.Closing,
                    ReportMeasure.Debit => t.Debit, ReportMeasure.Credit => t.Credit, ReportMeasure.YearToDateDebit => t.YtdDebit,
                    ReportMeasure.YearToDateCredit => t.YtdCredit, _ => throw new ReportDataException("未知取数类型。") };
            }
            var value = sum.ToDecimal(); cache.Add(request, value); return value;
        }
    }
}
