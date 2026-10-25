using Caiwu.Contracts;

namespace Caiwu.Nonprofit.Reporting;

public enum LedgerAccountSemantic { Unclassified, OtherBalance, IncomeExpense, UnrestrictedNetAssets, RestrictedNetAssets, PriorYearAdjustment }
public enum SourceLineRole { Unclassified, BalanceOnly, RecognizedActivity, IncomeExpenseClosing, ReleaseToUnrestricted, TransferToRestricted, PriorYearAdjustment, PriorYearAdjustmentClosing }
public enum BalanceMappingMode { Unspecified, AccountBalances, ReviewedAnalysis, ConfirmedZero }

public sealed record SnapshotBinding(Guid BookId, long Revision, string SnapshotSha256);
/// <summary>Position is stable only within the bound immutable revision; content includes voucher/date/status and the entire line.</summary>
public sealed record VoucherLineReference(Guid VoucherId, int LineIndex, string ContentSha256);
public sealed record LedgerAccountClassification(string AccountCode, string AccountSha256, LedgerAccountSemantic Semantic,
    ActivityFact? ActivityFact, bool NoBalanceExpectedConfirmed, string EvidenceReference);
public sealed record LedgerLineClassification(VoucherLineReference Source, SourceLineRole Role,
    RestrictionTag? Classification, string? ComponentId, string? MovementGroupId, string EvidenceReference);
public sealed record AccountBalanceTerm(string AccountCode, string AccountSha256, int Coefficient);
public sealed record BalanceFactMapping(BalanceFact Fact, BalanceMappingMode Mode,
    IReadOnlyList<AccountBalanceTerm> Accounts, decimal? YearOpeningAnalysis, decimal? ClosingAnalysis, string EvidenceReference);
public sealed record ClassificationReview(bool CnyAmountsConfirmed, bool CompleteYearToDateConfirmed,
    bool AccountMappingReviewed, bool LineClassificationReviewed, bool BusinessBreakdownComplete,
    FundraisingDisclosure FundraisingDisclosure, YearOpeningBasis YearOpeningBasis,
    bool RestrictedIncomeTaxTreatmentReviewed, string RestrictedIncomeTaxReviewEvidence, string EvidenceReference);

/// <summary>A user-owned classification sidecar, not another ledger. No posted amounts can be edited here.</summary>
public sealed record LedgerClassificationManifest(int SchemaVersion, SnapshotBinding Binding, ReportingPeriod Period,
    DateTimeOffset CreatedAt, IReadOnlyList<LedgerAccountClassification> Accounts,
    IReadOnlyList<LedgerLineClassification> Lines, IReadOnlyList<BalanceFactMapping> BalanceMappings,
    IReadOnlyList<ActivityComponent> Components, ClassificationReview Review,
    IReadOnlyList<MissingReason> SourceLimitations);

public sealed record ClassificationValidationResult(IReadOnlyList<MissingReason> Issues)
{
    public bool IsValid => Issues.Count == 0;
}
public sealed class ClassificationStaleException : InvalidOperationException
{
    public MissingReason Reason { get; }
    public ClassificationStaleException(string detail) : base("NP_CLASSIFICATION_STALE: " + detail) =>
        Reason = new("NP_CLASSIFICATION_STALE", "Binding", detail);
}

public static class LedgerClassificationDraft
{
    /// <summary>Only copies source facts and locators; creates no inferred account or line classification and no zero assertions.</summary>
    public static LedgerClassificationManifest Create(LedgerSnapshot snapshot, ReportingPeriod period, DateTimeOffset createdAt)
    {
        SnapshotIdentity.ValidateSnapshot(snapshot);
        ArgumentNullException.ThrowIfNull(period);
        if (period.To.Year != snapshot.Book.FiscalYear || period.From.Month < snapshot.Book.StartMonth || createdAt == default)
            throw new ArgumentException("报告期间须在来源账套启用范围内，且提供创建时间。");
        var leaves = SnapshotIdentity.Leaves(snapshot);
        return new(1, SnapshotIdentity.Binding(snapshot), period, createdAt,
            Array.AsReadOnly(leaves.Select(a => new LedgerAccountClassification(a.Code, SnapshotIdentity.AccountHash(a),
                LedgerAccountSemantic.Unclassified, null, false, "")).ToArray()),
            Array.AsReadOnly(snapshot.Vouchers.Where(v => v.Status == VoucherStatus.Posted && v.Date <= period.To)
                .OrderBy(v => v.Date).ThenBy(v => v.Id).SelectMany(v => v.Lines.Select((l, i) => new LedgerLineClassification(
                    SnapshotIdentity.LineReference(v, i), SourceLineRole.Unclassified, null, null, null, ""))).ToArray()),
            Array.AsReadOnly(Enum.GetValues<BalanceFact>().Select(f => new BalanceFactMapping(f, BalanceMappingMode.Unspecified, [], null, null, "")).ToArray()),
            [], new(false, false, false, false, false, FundraisingDisclosure.Unknown, YearOpeningBasis.Unknown, false, "", ""), []);
    }
}
