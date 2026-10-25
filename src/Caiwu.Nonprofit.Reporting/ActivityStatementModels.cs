namespace Caiwu.Nonprofit.Reporting;

public enum RestrictionClass { Unrestricted, Restricted }
public enum RestrictionSourceKind { ExternalProvider, LawOrAdministrativeRegulation, InternalBudget }
public enum ActivityFact
{
    DonationIncome, MembershipIncome, ServiceIncome, GovernmentGrantIncome, SalesIncome,
    HeadquartersGrantIncome, InvestmentIncome, OtherIncome,
    BusinessActivityCost, TaxesAndSurcharges, AdministrationExpense, FundraisingExpense,
    AssetImpairmentLoss, IncomeTaxExpense, OtherExpense,
    ReleaseToUnrestricted, TransferToRestricted, PriorYearNetAssetAdjustment
}
public enum ActivityEntryRole { RecognizedMovement, IncomeExpenseClosing }
public enum ActivityComponentKind { Project, Service, Business, CharitableTrustEstablishment, FundraisingCost }
public enum FundraisingDisclosure { Unknown, NotApplicableConfirmed, RequiredAndClassified }

/// <summary>Restricted facts require an external/legal restriction, version, project and evidence.
/// Internal budgets alone do not create a restriction. Null/incomplete tags become missing reasons.</summary>
public sealed record RestrictionTag(RestrictionClass Class, string? RestrictionId = null,
    int? RestrictionVersion = null, string? ProjectId = null,
    RestrictionSourceKind? SourceKind = null, string? EvidenceReference = null);

/// <summary>Income credit-minus-debit; expense debit-minus-credit; adjustment net-asset increase positive.
/// Transfers are positive direction-specific amounts and expand into opposite U/R columns exactly once.</summary>
public sealed record ActivityEntry(Guid EntryId, DateOnly Date, ActivityFact Fact, decimal Amount,
    RestrictionTag? Classification, ActivityEntryRole Role, string EvidenceReference, string? ComponentId = null);
public sealed record ActivityComponent(string Id, string Label, ActivityComponentKind Kind);

public sealed class ActivityWindowInput
{
    public DateOnly From { get; }
    public DateOnly To { get; }
    public IReadOnlyList<ActivityEntry> Entries { get; }
    public IReadOnlySet<ActivityFact> CoveredFacts { get; }
    public string CoverageEvidenceReference { get; }
    public bool ClassificationReviewed { get; }
    public bool BusinessBreakdownComplete { get; }
    public FundraisingDisclosure FundraisingDisclosure { get; }
    public bool RestrictedIncomeTaxTreatmentReviewed { get; }
    public string? RestrictedIncomeTaxReviewEvidence { get; }

    public ActivityWindowInput(DateOnly from, DateOnly to, IEnumerable<ActivityEntry> entries,
        IEnumerable<ActivityFact> coveredFacts, string coverageEvidenceReference,
        bool classificationReviewed, bool businessBreakdownComplete,
        FundraisingDisclosure fundraisingDisclosure,
        bool restrictedIncomeTaxTreatmentReviewed = false, string? restrictedIncomeTaxReviewEvidence = null)
    {
        ArgumentNullException.ThrowIfNull(entries); ArgumentNullException.ThrowIfNull(coveredFacts);
        if (from > to || from.Year != to.Year || !Enum.IsDefined(fundraisingDisclosure))
            throw new ArgumentException("发生额覆盖期间或募捐成本披露状态无效。");
        var copy = entries.ToArray(); var coverage = coveredFacts.ToHashSet();
        if (coverage.Any(f => !Enum.IsDefined(f)) || copy.Any(e => e is null || e.EntryId == Guid.Empty ||
            !Enum.IsDefined(e.Fact) || !Enum.IsDefined(e.Role) || e.Date < from || e.Date > to) ||
            copy.Select(e => e.EntryId).Distinct().Count() != copy.Length)
            throw new ArgumentException("发生额含未知类型、重复ID、空项或超出覆盖期的数据。");
        foreach (var e in copy)
        {
            Money.Validate(e.Amount); ArgumentException.ThrowIfNullOrWhiteSpace(e.EvidenceReference);
            if (e.Fact is ActivityFact.ReleaseToUnrestricted or ActivityFact.TransferToRestricted && e.Amount < 0)
                throw new ArgumentException("双向转类须按指定方向输入非负金额，不能用负数混淆方向。");
            if (e.Role == ActivityEntryRole.IncomeExpenseClosing && e.Fact >= ActivityFact.ReleaseToUnrestricted)
                throw new ArgumentException("净资产转类或以前年度调整不能伪装成损益结转而被排除。");
        }
        if (coverage.Count != 0) ArgumentException.ThrowIfNullOrWhiteSpace(coverageEvidenceReference);
        if (restrictedIncomeTaxTreatmentReviewed) ArgumentException.ThrowIfNullOrWhiteSpace(restrictedIncomeTaxReviewEvidence);
        From = from; To = to; Entries = Array.AsReadOnly(copy);
        CoveredFacts = new ReadOnlySet<ActivityFact>(coverage);
        CoverageEvidenceReference = coverageEvidenceReference; ClassificationReviewed = classificationReviewed;
        BusinessBreakdownComplete = businessBreakdownComplete; FundraisingDisclosure = fundraisingDisclosure;
        RestrictedIncomeTaxTreatmentReviewed = restrictedIncomeTaxTreatmentReviewed;
        RestrictedIncomeTaxReviewEvidence = restrictedIncomeTaxReviewEvidence;
    }

    // Expose no mutable HashSet through the public DTO.
    private sealed class ReadOnlySet<T>(HashSet<T> source) : IReadOnlySet<T>
    {
        public int Count => source.Count;
        public bool Contains(T item) => source.Contains(item);
        public bool IsProperSubsetOf(IEnumerable<T> other) => source.IsProperSubsetOf(other);
        public bool IsProperSupersetOf(IEnumerable<T> other) => source.IsProperSupersetOf(other);
        public bool IsSubsetOf(IEnumerable<T> other) => source.IsSubsetOf(other);
        public bool IsSupersetOf(IEnumerable<T> other) => source.IsSupersetOf(other);
        public bool Overlaps(IEnumerable<T> other) => source.Overlaps(other);
        public bool SetEquals(IEnumerable<T> other) => source.SetEquals(other);
        public IEnumerator<T> GetEnumerator() => source.GetEnumerator();
        System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();
    }
}

public sealed class ActivityStatementInput
{
    public StatementContext Context { get; }
    public ActivityWindowInput? Current { get; }
    public ActivityWindowInput? YearToDate { get; }
    public ActivityWindowInput? PriorYearComparison { get; }
    public IReadOnlyList<ActivityComponent> Components { get; }
    public ActivityStatementInput(StatementContext context, ActivityWindowInput? current,
        ActivityWindowInput? yearToDate, IEnumerable<ActivityComponent>? components = null,
        ActivityWindowInput? priorYearComparison = null)
    {
        ArgumentNullException.ThrowIfNull(context);
        var copy = (components ?? []).ToArray();
        if (copy.Any(c => c is null || string.IsNullOrWhiteSpace(c.Id) || string.IsNullOrWhiteSpace(c.Label) || !Enum.IsDefined(c.Kind)) ||
            copy.Select(c => c.Id).Distinct(StringComparer.Ordinal).Count() != copy.Length)
            throw new ArgumentException("业务组成定义无效或ID重复。");
        Context = context; Current = current; YearToDate = yearToDate;
        Components = Array.AsReadOnly(copy); PriorYearComparison = priorYearComparison;
    }
}
