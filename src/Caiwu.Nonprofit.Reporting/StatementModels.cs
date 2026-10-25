using System.Numerics;
using Caiwu.Contracts;

namespace Caiwu.Nonprofit.Reporting;

public enum ReportingPeriodKind { Monthly, Quarterly, HalfYearly, Annual }
public enum StatementStatus { Incomplete, CalculatedPreview, PendingReviewProjection }
public enum StatementSourceKind { PostedLedger, PendingReviewProjection }
public enum ValueState { Calculated, Missing, NotRequired }
public enum ComparativeState { NotRequested, NotRequiredOn2026FirstAdoption, Supplied, Missing }

/// <summary>Calendar period, inclusive endpoints. Annual is never labelled 本月数.</summary>
public sealed record ReportingPeriod
{
    public DateOnly From { get; }
    public DateOnly To { get; }
    public DateOnly YearStart => new(To.Year, 1, 1);
    public ReportingPeriodKind Kind { get; }
    public string CurrentLabel => Kind switch
    {
        ReportingPeriodKind.Monthly => "本月数",
        ReportingPeriodKind.Quarterly => "本季度数",
        ReportingPeriodKind.HalfYearly => "本半年度数",
        _ => "本年数"
    };

    public ReportingPeriod(DateOnly from, DateOnly to, ReportingPeriodKind kind)
    {
        if (!Enum.IsDefined(kind) || from.Year < 2026 || from.Year != to.Year || from > to ||
            from.Day != 1 || to.Day != DateTime.DaysInMonth(to.Year, to.Month))
            throw new ArgumentException("期间须为2026年起同一公历年度内的完整月/季/半年/年。");
        var valid = kind switch
        {
            ReportingPeriodKind.Monthly => from.Month == to.Month,
            ReportingPeriodKind.Quarterly => from.Month is 1 or 4 or 7 or 10 && to.Month == from.Month + 2,
            ReportingPeriodKind.HalfYearly => from.Month is 1 or 7 && to.Month == from.Month + 5,
            ReportingPeriodKind.Annual => from.Month == 1 && to.Month == 12,
            _ => false
        };
        if (!valid) throw new ArgumentException("起讫日期与期间类型不符。");
        From = from; To = to; Kind = kind;
    }
}

public sealed record StatementContext
{
    public Guid BookId { get; }
    public string BookName { get; }
    public long SourceLedgerRevision { get; }
    public ReportingPeriod Period { get; }
    public DateTimeOffset GeneratedAt { get; }
    public StatementSourceKind SourceKind { get; }
    public string SourceEvidenceReference { get; }
    public bool CnyAmountsConfirmed { get; }
    public IReadOnlyList<MissingReason> SourceLimitations { get; }

    public StatementContext(Guid bookId, string bookName, long sourceLedgerRevision,
        ReportingPeriod period, DateTimeOffset generatedAt, StatementSourceKind sourceKind,
        string sourceEvidenceReference, bool cnyAmountsConfirmed, IEnumerable<MissingReason>? sourceLimitations = null)
    {
        if (bookId == Guid.Empty || sourceLedgerRevision < 0 || generatedAt == default || !Enum.IsDefined(sourceKind))
            throw new ArgumentException("账套身份、真实账簿版本、生成时间或来源类型无效。");
        ArgumentException.ThrowIfNullOrWhiteSpace(bookName);
        ArgumentException.ThrowIfNullOrWhiteSpace(sourceEvidenceReference);
        ArgumentNullException.ThrowIfNull(period);
        BookId = bookId; BookName = bookName; SourceLedgerRevision = sourceLedgerRevision;
        Period = period; GeneratedAt = generatedAt; SourceKind = sourceKind;
        SourceEvidenceReference = sourceEvidenceReference; CnyAmountsConfirmed = cnyAmountsConfirmed;
        var limitations = (sourceLimitations ?? []).ToArray();
        if (limitations.Any(x => x is null || string.IsNullOrWhiteSpace(x.Code) || string.IsNullOrWhiteSpace(x.Path) || string.IsNullOrWhiteSpace(x.Detail)))
            throw new ArgumentException("来源缺失原因须含代码、路径与说明。", nameof(sourceLimitations));
        SourceLimitations = Array.AsReadOnly(limitations);
    }
}

public sealed record MissingReason(string Code, string Path, string Detail);

public sealed class StatementValue
{
    public decimal? Amount { get; }
    public ValueState State { get; }
    public IReadOnlyList<MissingReason> MissingReasons { get; }
    private StatementValue(decimal? amount, ValueState state, IEnumerable<MissingReason> reasons)
    { Amount = amount; State = state; MissingReasons = Array.AsReadOnly(reasons.Distinct().ToArray()); }
    internal static StatementValue Known(decimal value) => new(Money.Validate(value), ValueState.Calculated, []);
    internal static StatementValue Missing(string code, string path, string detail) => new(null, ValueState.Missing, [new(code, path, detail)]);
    internal static StatementValue Missing(IEnumerable<MissingReason> reasons) => new(null, ValueState.Missing, reasons);
    internal static StatementValue Sum(params StatementValue[] values) => Sum((IEnumerable<StatementValue>)values);
    internal static StatementValue Sum(IEnumerable<StatementValue> values)
    {
        var copy = values.ToArray();
        return copy.Any(v => v.State != ValueState.Calculated)
            ? Missing(copy.SelectMany(v => v.MissingReasons))
            : Known(Money.Sum(copy.Select(v => v.Amount!.Value)));
    }
    internal StatementValue Negate() => Amount is { } a ? Known(-a) : this;
}

public sealed record StatementColumn(string Key, string Label);
public sealed record StatementLine(string Key, int PresentationOrder, string Label, string Section,
    bool IsSubtotal, string Formula, string SourceLocator, IReadOnlyList<StatementValue> Values)
{
    // 财会〔2024〕25号正式表样未印行号。说明中的(1)...是填列说明项号，不是行次。
    public int? OfficialRowNumber => null;
}

/// <summary>Finite, source-pinned calculation; never a compliance certificate or approved financial report.</summary>
public sealed class NonprofitStatement
{
    public const string FormulaVersion = "np2026-statements-preview.1";
    public const string OfficialUrl = "https://yn.mof.gov.cn/caizhengjiancha/202504/P020250415689506085583.pdf";
    public const string OfficialSha256 = "35b47fb928e167293150187fff4b03cfc0b8c814b978b5dcbbb750650a4417c6";
    public const string RulePackageId = "nonprofit-2026-official";
    public const string RulePackageVersion = "2026.10.25.1";
    public const string RulePackageSha256 = "0730548fdc4cd1db74f587ba050c2fd8849b32804e50c9eefa1394c561d3a4df";
    public const string TransitionUrl = "https://www.mof.gov.cn/jrttts/202505/P020250521563512745169.pdf";
    public string Title { get; }
    public string OfficialForm { get; }
    public StatementContext Context { get; }
    public IReadOnlyList<StatementColumn> Columns { get; }
    public IReadOnlyList<StatementLine> Lines { get; }
    public IReadOnlyList<MissingReason> MissingReasons { get; }
    public ComparativeState ComparativeState { get; }
    public StatementStatus Status { get; }
    public bool CanIssueAsFormal => false;
    public bool IsVerifiedForProduction => false;
    public bool HasAllRequiredValues => MissingReasons.Count == 0;
    public string Notice => "计算预览，未经正式报表审定；不覆盖现金流量表、附注及整体制度合规。缺失值不得解释为0。";

    internal NonprofitStatement(string title, string form, StatementContext context,
        IEnumerable<StatementColumn> columns, IEnumerable<StatementLine> lines,
        IEnumerable<MissingReason> issues, ComparativeState comparative = ComparativeState.NotRequested)
    {
        Title = title; OfficialForm = form; Context = context;
        Columns = Array.AsReadOnly(columns.ToArray()); Lines = Array.AsReadOnly(lines.ToArray());
        MissingReasons = Array.AsReadOnly(context.SourceLimitations.Concat(issues).Concat(Lines.SelectMany(l => l.Values).SelectMany(v => v.MissingReasons)).Distinct().ToArray());
        ComparativeState = comparative;
        Status = MissingReasons.Count != 0 ? StatementStatus.Incomplete :
            context.SourceKind == StatementSourceKind.PendingReviewProjection ? StatementStatus.PendingReviewProjection : StatementStatus.CalculatedPreview;
    }
    public void RequireCompleteCalculation()
    {
        if (!HasAllRequiredValues) throw new InvalidOperationException("报表输入不完整：" + string.Join("；", MissingReasons.Select(x => x.Code + ":" + x.Detail)));
    }
    public void RequireFormalReport() => throw new InvalidOperationException("本模块只交付待复核计算预览，不能签发正式完整报表。");
}

/// <summary>Source implementation must freeze one real revision and preserve explicit coverage/dimensions.</summary>
public interface INonprofitStatementDataSource
{
    BalanceSheetInput ReadBalanceSheet(StatementContext context);
    ActivityStatementInput ReadActivityStatement(StatementContext context);
}

/// <summary>v1 LedgerSnapshot has no line IDs, classification or approved movement roles. Never infer them from Summary.</summary>
public static class LedgerSnapshotGapAnalyzer
{
    public static IReadOnlyList<MissingReason> Analyze(LedgerSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        var issues = new List<MissingReason>
        {
            new("NP_DIMENSIONS", "VoucherLine", "缺稳定行ID、限定类别、限制ID/版本、项目及业务组成；不能从摘要猜测。"),
            new("NP_MOVEMENT_ROLES", "Voucher", "缺普通活动/结转/双向转类/前期调整的已审业务类型。"),
            new("NP_BALANCE_ANALYSIS", "Account", "缺受托代理货币、减值归属、到期分析及上年末/2026新账年初依据。"),
            new("NP_COVERAGE", "LedgerSnapshot", "缺全年完整发生额覆盖声明、已审分类和已完成损益结转证据。")
        };
        if (snapshot.Book.Regime != AccountingRegime.Nonprofit)
            issues.Add(new("NP_REGIME", "Book.Regime", "来源账套不是民间非营利组织制度。"));
        return issues.AsReadOnly();
    }
}

internal static class Money
{
    private static readonly BigInteger Limit = long.MaxValue;
    internal static decimal Validate(decimal amount)
    {
        if (decimal.Round(amount, 2) != amount) throw new ArgumentException("金额必须精确到分，不能静默舍入。");
        var cents = (BigInteger)(amount * 100m);
        if (BigInteger.Abs(cents) > Limit) throw new OverflowException("金额超出对称Int64分范围。");
        return amount;
    }
    internal static decimal Sum(IEnumerable<decimal> values)
    {
        BigInteger cents = 0;
        foreach (var value in values) { Validate(value); cents += (BigInteger)(value * 100m); }
        if (BigInteger.Abs(cents) > Limit) throw new OverflowException("计算结果超出对称Int64分范围。");
        return (decimal)cents / 100m;
    }
}
