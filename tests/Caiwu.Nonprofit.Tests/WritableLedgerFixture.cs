using Caiwu.Nonprofit.Writable;
using Caiwu.Nonprofit.Reporting;
using DomainRestriction = Caiwu.Nonprofit.RestrictionClass;

namespace Caiwu.Nonprofit.Tests;

internal sealed class WritableLedgerFixture : IDisposable
{
    internal string DirectoryPath { get; } = Path.Combine(Path.GetTempPath(), "caiwu-np-synthetic-" + Guid.NewGuid().ToString("N"));
    internal string FilePath => Path.Combine(DirectoryPath, "synthetic.np-ledger.json");
    internal AtomicNonprofitLedgerStore Store { get; }
    internal NonprofitLedgerService Service { get; }
    internal Permissions Authorization { get; } = new();
    internal static readonly DateOnly Day = new(2026, 1, 15);
    internal static readonly DateTimeOffset Clock = new(2026, 2, 1, 12, 0, 0, TimeSpan.Zero);
    internal static Classification U => new(DomainRestriction.Unrestricted, null, null, null);
    internal static Classification R => new(DomainRestriction.Restricted, "grant-A", 1, "project-A");
    internal static IReadOnlyDictionary<DomainRestriction, string> NetAssets { get; } = new Dictionary<DomainRestriction, string>
    { [DomainRestriction.Unrestricted] = "3101", [DomainRestriction.Restricted] = "3102" };
    internal NonprofitMutationContext Context { get { var s = Service.GetSnapshot(); return new(s.BookId, s.Revision); } }

    internal WritableLedgerFixture(bool confirmOpening = true, IEnumerable<NonprofitLedgerAccount>? additional = null)
    {
        Store = new(FilePath); Service = new(Store, Authorization);
        NonprofitLedgerAccount A(string code, NonprofitAccountKind kind, bool credit = false) =>
            new(code, "合成科目" + code, null, code, kind, credit, true, new(), []);
        var chart = new[] { A("1002", NonprofitAccountKind.Asset), A("3101", NonprofitAccountKind.NetAsset, true),
            A("3102", NonprofitAccountKind.NetAsset, true), A("4101", NonprofitAccountKind.Income, true),
            A("5101", NonprofitAccountKind.Expense), A("5301", NonprofitAccountKind.Expense),
            A("1402", NonprofitAccountKind.Asset), A("1421", NonprofitAccountKind.Asset, true) }.Concat(additional ?? []).ToArray();
        Service.Initialize(new(Guid.NewGuid(), "N1", "合成民非测试账（非真实账套）", "a54", "synthetic:explicit-chart-not-original-a54",
            2026, 1, chart, [new("grant-A", 1, "project-A", Caiwu.Nonprofit.RestrictionSourceKind.ExternalProvider,
                "synthetic:grant-agreement", [new(RestrictionConditionKind.Purpose, "合成项目用途")])], []), "maker");
        if (confirmOpening) Service.SetOpening([
            new(Guid.NewGuid(), "1002", 1000, 0, null, new(), []),
            new(Guid.NewGuid(), "3101", 0, 1000, U, new(), [])], Context, "maker");
    }
    internal static NonprofitLedgerLine Line(string account, decimal debit, decimal credit, Classification? tag = null,
        string? component = null, LineDimensions? dimensions = null, IReadOnlyList<OriginalField>? fields = null) =>
        new(Guid.NewGuid(), account, "合成业务", debit, credit, tag, component, dimensions ?? new(), fields ?? []);
    internal static NonprofitVoucherDraft Draft(params NonprofitLedgerLine[] lines) => new(null, Day, "记", null, 0,
        NonprofitMovementRole.Activity, "synthetic:recognition-reviewed", lines, []);
    internal NonprofitLedgerVoucher Save(NonprofitVoucherDraft draft) => Service.SaveDraft(draft, Context, "maker");
    internal NonprofitLedgerVoucher Donation(decimal amount, Classification tag) =>
        Save(Draft(Line("1002", amount, 0), Line("4101", 0, amount, tag)));
    internal NonprofitLedgerVoucher Expense(decimal amount, Classification tag) =>
        Save(Draft(Line("5101", amount, 0, tag, "business"), Line("1002", 0, amount)));
    internal void ReviewAll()
    { foreach (var v in Service.GetSnapshot().Vouchers.Where(v => v.State == NonprofitVoucherState.Draft)) Service.Review(v.Id, Context, "reviewer"); }
    internal void CompleteOrdinary()
    { Donation(100, U); Donation(200, R); Expense(20, U); Expense(50, R); ReviewAll(); Service.PostMonth(1, Context, "poster"); }
    internal NonprofitLedgerVoucher CloseIncomeExpense()
    {
        var v = Service.GenerateClosingDraft(1, "记", Guid.NewGuid(), NetAssets, Context, "maker");
        Service.Review(v.Id, Context, "reviewer"); Service.PostMonth(1, Context, "poster"); return v;
    }
    internal WritableStatementReview Review(bool completeAnalyses = true)
    {
        var s = Service.GetSnapshot(); var review = WritableLedgerIdentity.CreateUnreviewed(s,
            new(new(2026, 1, 1), new(2026, 1, 31), ReportingPeriodKind.Monthly), Clock);
        BalanceFact[] analysed = [BalanceFact.AgencyMonetaryFunds, BalanceFact.LongDebtDueWithinYear,
            BalanceFact.OtherLongInvestmentDueWithinYear, BalanceFact.DueWithinYearInvestmentAllowance, BalanceFact.OtherCurrentAssets,
            BalanceFact.LongEquityAllowance, BalanceFact.LongDebtAllowance, BalanceFact.OtherLongInvestmentAllowance,
            BalanceFact.FixedAssetImpairment, BalanceFact.IntangibleAssetImpairment, BalanceFact.LongBorrowingsDueWithinYear,
            BalanceFact.LongPayablesDueWithinYear, BalanceFact.OtherLongLiabilitiesDueWithinYear, BalanceFact.OtherCurrentLiabilities, BalanceFact.OtherLongLiabilities];
        return review with { EvidenceReference = "synthetic:full-book-and-classification-review", AccountPopulationCompleteConfirmed = true,
            CnyAmountsConfirmed = true, MappingReviewed = true, ClassificationReviewed = true, CompleteYearToDateConfirmed = true,
            BusinessBreakdownComplete = true, FundraisingDisclosure = FundraisingDisclosure.NotApplicableConfirmed,
            YearOpeningBasis = YearOpeningBasis.Reviewed2026TransitionLedger,
            Components = [new("business", "合成公益业务", ActivityComponentKind.Business)],
            BalanceAnalyses = completeAnalyses ? analysed.Select(f => new WritableBalanceAnalysis(f, 0, 0, "synthetic:zero-analysis-confirmed")).ToArray() : [] };
    }
    public void Dispose() { if (Directory.Exists(DirectoryPath)) Directory.Delete(DirectoryPath, recursive: true); }
    internal sealed class Permissions : INonprofitAuthorizer
    {
        internal bool Deny { get; set; }
        public void Require(string operatorId, NonprofitPermission permission)
        { if (Deny) throw new UnauthorizedAccessException("合成拒绝：" + permission); }
    }
}
