using Caiwu.Nonprofit.Reporting;

namespace Caiwu.Nonprofit.Reporting.Tests;

internal static class SyntheticData
{
    internal static readonly Guid BookId = new("20260000-0000-0000-0000-000000000001");
    internal static readonly DateTimeOffset Clock = new(2026, 7, 1, 10, 20, 30, TimeSpan.FromHours(8));
    internal static RestrictionTag U => new(RestrictionClass.Unrestricted);
    internal static RestrictionTag R => new(RestrictionClass.Restricted, "synthetic-grant-A", 1, "synthetic-project-A", RestrictionSourceKind.ExternalProvider, "synthetic-reviewed-agreement-A");
    internal static ActivityComponent[] Components => [new("project-A", "合成项目A", ActivityComponentKind.Project)];
    internal static StatementContext Context(int month = 6, int year = 2026, string name = "合成账套", StatementSourceKind source = StatementSourceKind.PostedLedger,
        ReportingPeriodKind kind = ReportingPeriodKind.Monthly) => new(BookId, name, 42,
            kind == ReportingPeriodKind.Annual ? new(new(year, 1, 1), new(year, 12, 31), kind) :
            new(new(year, month, 1), new(year, month, DateTime.DaysInMonth(year, month)), kind),
            Clock, source, "synthetic-ledger-revision-42", true);
    internal static ActivityEntry E(int id, int month, ActivityFact fact, decimal amount, RestrictionTag? tag,
        string? component = null, ActivityEntryRole role = ActivityEntryRole.RecognizedMovement, int year = 2026) =>
        new(new Guid(id, 0, 0, new byte[8]), new(year, month, 15), fact, amount, tag, role, "synthetic-voucher-" + id, component);
    internal static ActivityWindowInput Window(DateOnly from, DateOnly to, IEnumerable<ActivityEntry>? entries = null,
        IEnumerable<ActivityFact>? coverage = null, bool classificationReviewed = true, bool details = true,
        FundraisingDisclosure fundraising = FundraisingDisclosure.NotApplicableConfirmed, bool taxReviewed = false) =>
        new(from, to, entries ?? [], coverage ?? Enum.GetValues<ActivityFact>(), "synthetic-complete-covered-facts",
            classificationReviewed, details, fundraising, taxReviewed, taxReviewed ? "synthetic-specialist-tax-review" : null);
    internal static ActivityStatementInput Activity(StatementContext ctx, IEnumerable<ActivityEntry> entries,
        IEnumerable<ActivityComponent>? components = null)
    {
        var all = entries.ToArray();
        return new(ctx, Window(ctx.Period.From, ctx.Period.To, all.Where(e => e.Date >= ctx.Period.From)),
            Window(ctx.Period.YearStart, ctx.Period.To, all), components ?? Components);
    }
    internal static decimal Amount(NonprofitStatement report, string key, int column) => report.Lines.Single(l => l.Key == key).Values[column].Amount
        ?? throw new InvalidOperationException("Expected numeric " + key);
    internal static StatementValue Value(NonprofitStatement report, string key, int column = 1) => report.Lines.Single(l => l.Key == key).Values[column];
    internal static BalanceColumnInput Balances(DateOnly date, IReadOnlyDictionary<BalanceFact, decimal>? overrides = null,
        IncomeExpenseClosingState closing = IncomeExpenseClosingState.ClosedAndReconciled, bool reviewed = true,
        YearOpeningBasis basis = YearOpeningBasis.Reviewed2026TransitionLedger, BalanceFact? omit = null) =>
        new(date, Enum.GetValues<BalanceFact>().Where(f => f != omit).Select(f => new BalanceFactValue(f,
            overrides is not null && overrides.TryGetValue(f, out var value) ? value : 0m,
            "synthetic-explicit-balance-or-confirmed-zero-" + f)), closing, basis, reviewed, "synthetic-reviewed-trial-and-analysis");
    internal static BalanceSheetInput BalanceInput(IReadOnlyDictionary<BalanceFact, decimal>? closing = null,
        IncomeExpenseClosingState state = IncomeExpenseClosingState.ClosedAndReconciled) =>
        new(Context(), Balances(new(2026, 1, 1), new Dictionary<BalanceFact, decimal>
        { [BalanceFact.BankDeposits] = 10000, [BalanceFact.UnrestrictedNetAssets] = 6000, [BalanceFact.RestrictedNetAssets] = 4000 }),
            Balances(new(2026, 6, 30), closing, state));

    internal static ActivityEntry[] ExampleA() =>
    [
        E(1,5,ActivityFact.DonationIncome,200,U), E(2,5,ActivityFact.DonationIncome,400,R),
        E(3,5,ActivityFact.BusinessActivityCost,100,U,"project-A"), E(4,5,ActivityFact.BusinessActivityCost,150,R,"project-A"),
        E(10,6,ActivityFact.DonationIncome,1000,U), E(11,6,ActivityFact.DonationIncome,2000,R),
        E(12,6,ActivityFact.MembershipIncome,300,U), E(13,6,ActivityFact.ServiceIncome,100,U),
        E(14,6,ActivityFact.GovernmentGrantIncome,500,R), E(15,6,ActivityFact.InvestmentIncome,-25,U),
        E(16,6,ActivityFact.BusinessActivityCost,200,U,"project-A"), E(17,6,ActivityFact.BusinessActivityCost,600,R,"project-A"),
        E(18,6,ActivityFact.AdministrationExpense,80,U), E(19,6,ActivityFact.AdministrationExpense,20,R),
        E(20,6,ActivityFact.FundraisingExpense,15,U), E(21,6,ActivityFact.FundraisingExpense,5,R),
        E(22,6,ActivityFact.TaxesAndSurcharges,10,U), E(23,6,ActivityFact.AssetImpairmentLoss,50,R),
        E(24,6,ActivityFact.IncomeTaxExpense,30,U), E(25,6,ActivityFact.OtherExpense,5,U),
        E(26,6,ActivityFact.ReleaseToUnrestricted,120,R), E(27,6,ActivityFact.TransferToRestricted,40,R),
        E(28,6,ActivityFact.PriorYearNetAssetAdjustment,-10,U), E(29,6,ActivityFact.PriorYearNetAssetAdjustment,15,R)
    ];
    internal static Dictionary<BalanceFact, decimal> BalanceExampleA() => new()
    {
        [BalanceFact.Cash]=100, [BalanceFact.BankDeposits]=10000, [BalanceFact.OtherMonetaryFunds]=400, [BalanceFact.AgencyMonetaryFunds]=500,
        [BalanceFact.ShortTermInvestments]=1000,[BalanceFact.ShortTermInvestmentAllowance]=50,
        [BalanceFact.NotesReceivable]=200,[BalanceFact.AccountsReceivable]=800,[BalanceFact.OtherReceivables]=100,[BalanceFact.BadDebtAllowance]=100,
        [BalanceFact.Prepayments]=300,[BalanceFact.Inventory]=700,[BalanceFact.InventoryAllowance]=20,[BalanceFact.PrepaidExpenses]=60,
        [BalanceFact.LongDebtDueWithinYear]=1000,[BalanceFact.OtherLongInvestmentDueWithinYear]=200,[BalanceFact.OtherCurrentAssets]=10,
        [BalanceFact.LongEquityInvestments]=2000,[BalanceFact.LongEquityAllowance]=100,[BalanceFact.LongDebtInvestments]=5000,[BalanceFact.LongDebtAllowance]=200,
        [BalanceFact.OtherLongInvestments]=1000,[BalanceFact.OtherLongInvestmentAllowance]=50,
        [BalanceFact.FixedAssetCost]=4000,[BalanceFact.AccumulatedDepreciation]=500,[BalanceFact.FixedAssetImpairment]=100,
        [BalanceFact.ConstructionInProgress]=200,[BalanceFact.FixedAssetDisposal]=-40,[BalanceFact.HeritageResources]=30,
        [BalanceFact.IntangibleAssetCost]=1000,[BalanceFact.AccumulatedAmortization]=100,[BalanceFact.IntangibleAssetImpairment]=20,[BalanceFact.LongTermPrepaidExpenses]=300,
        [BalanceFact.DedicatedAgencyAssets]=200,[BalanceFact.ShortTermBorrowings]=1000,[BalanceFact.NotesPayable]=100,[BalanceFact.AccountsPayable]=600,[BalanceFact.OtherPayables]=300,
        [BalanceFact.EmployeeBenefitsPayable]=-20,[BalanceFact.TaxesPayable]=-10,[BalanceFact.ReceiptsInAdvance]=400,[BalanceFact.AccruedExpenses]=50,
        [BalanceFact.LongBorrowingsDueWithinYear]=500,[BalanceFact.LongPayablesDueWithinYear]=100,[BalanceFact.OtherLongLiabilitiesDueWithinYear]=200,[BalanceFact.OtherCurrentLiabilities]=30,
        [BalanceFact.LongBorrowings]=4000,[BalanceFact.LongPayables]=800,[BalanceFact.Provisions]=150,[BalanceFact.OtherLongLiabilities]=500,
        [BalanceFact.AgencyLiabilities]=700,[BalanceFact.UnrestrictedNetAssets]=10000,[BalanceFact.RestrictedNetAssets]=7520
    };
}
