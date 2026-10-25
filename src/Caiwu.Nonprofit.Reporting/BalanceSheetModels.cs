namespace Caiwu.Nonprofit.Reporting;

/// <summary>Normal-side signed balances in CNY yuan. Contra balances are credit-positive.
/// Totals/analysed facts must include all related leaf accounts once, never parent plus children.</summary>
public enum BalanceFact
{
    Cash, BankDeposits, OtherMonetaryFunds, AgencyMonetaryFunds,
    ShortTermInvestments, ShortTermInvestmentAllowance,
    NotesReceivable, AccountsReceivable, OtherReceivables, BadDebtAllowance,
    Prepayments, Inventory, InventoryAllowance, PrepaidExpenses,
    LongDebtDueWithinYear, OtherLongInvestmentDueWithinYear, DueWithinYearInvestmentAllowance,
    OtherCurrentAssets,
    LongEquityInvestments, LongEquityAllowance,
    LongDebtInvestments, LongDebtAllowance,
    OtherLongInvestments, OtherLongInvestmentAllowance,
    FixedAssetCost, AccumulatedDepreciation, FixedAssetImpairment,
    ConstructionInProgress, FixedAssetDisposal, HeritageResources,
    IntangibleAssetCost, AccumulatedAmortization, IntangibleAssetImpairment,
    LongTermPrepaidExpenses, DedicatedAgencyAssets,
    ShortTermBorrowings, NotesPayable, AccountsPayable, OtherPayables,
    EmployeeBenefitsPayable, TaxesPayable, ReceiptsInAdvance, AccruedExpenses,
    LongBorrowingsDueWithinYear, LongPayablesDueWithinYear, OtherLongLiabilitiesDueWithinYear,
    OtherCurrentLiabilities, LongBorrowings, LongPayables, Provisions, OtherLongLiabilities,
    AgencyLiabilities, UnrestrictedNetAssets, RestrictedNetAssets
}
public enum IncomeExpenseClosingState { Unknown, NotClosed, ClosedAndReconciled }
public enum YearOpeningBasis { Unknown, Reviewed2026TransitionLedger, ReviewedRestatedPriorYearStatement }

public sealed record BalanceFactValue(BalanceFact Fact, decimal? Amount, string EvidenceReference, string? MissingDetail = null);

public sealed class BalanceColumnInput
{
    public DateOnly Date { get; }
    public IReadOnlyList<BalanceFactValue> Facts { get; }
    public IncomeExpenseClosingState ClosingState { get; }
    public YearOpeningBasis OpeningBasis { get; }
    public bool MappingReviewed { get; }
    public string ReviewEvidenceReference { get; }

    public BalanceColumnInput(DateOnly date, IEnumerable<BalanceFactValue> facts,
        IncomeExpenseClosingState closingState, YearOpeningBasis openingBasis,
        bool mappingReviewed, string reviewEvidenceReference)
    {
        ArgumentNullException.ThrowIfNull(facts);
        var copy = facts.ToArray();
        if (!Enum.IsDefined(closingState) || !Enum.IsDefined(openingBasis) ||
            copy.Any(f => f is null || !Enum.IsDefined(f.Fact)) || copy.Select(f => f.Fact).Distinct().Count() != copy.Length)
            throw new ArgumentException("余额事实、结转/年初状态无效或事实重复。");
        foreach (var fact in copy)
        {
            if (fact.Amount.HasValue)
            {
                Money.Validate(fact.Amount.Value);
                ArgumentException.ThrowIfNullOrWhiteSpace(fact.EvidenceReference);
            }
            else ArgumentException.ThrowIfNullOrWhiteSpace(fact.MissingDetail);
        }
        if (mappingReviewed) ArgumentException.ThrowIfNullOrWhiteSpace(reviewEvidenceReference);
        Date = date; Facts = Array.AsReadOnly(copy); ClosingState = closingState; OpeningBasis = openingBasis;
        MappingReviewed = mappingReviewed; ReviewEvidenceReference = reviewEvidenceReference;
    }
}

public sealed record BalanceSheetInput(StatementContext Context, BalanceColumnInput YearOpening, BalanceColumnInput Closing);
