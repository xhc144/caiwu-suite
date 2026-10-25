namespace Caiwu.Nonprofit;

public enum RestrictionClass { Unrestricted, Restricted }
public enum RestrictionSourceKind { ExternalProvider, LawOrAdministrativeRegulation, InternalBudget }
public enum RestrictionConditionKind { Time, Purpose }
public enum SuggestionKind { Activity, Closing, Release, Opening }
public enum PlanningPhase { Active, ClosingInProgress, ClassifiedClosingComputed }
public enum SuggestionStatus { PendingReview }
public enum DonationKind { Cash, Service }

public sealed record RestrictionCondition(RestrictionConditionKind Kind, string Terms);
public sealed record RestrictionEvidence(string Id, int Version, string ProjectId,
    RestrictionSourceKind SourceKind, string EvidenceReference,
    IReadOnlyList<RestrictionCondition> Conditions);
public sealed record Classification(RestrictionClass Class, string? RestrictionId,
    int? RestrictionVersion, string? ProjectId);
public sealed record ClassifiedBalance(string AccountCode, Classification? Classification, decimal NetDebit);
public sealed record RuleBinding(string PackageId, string Version, string Sha256);
public sealed record OperationReceipt(Guid RequestId, string PayloadSha256, IReadOnlyList<Guid> VoucherIds);
public sealed record PlanningState(Guid BookId, long SourceLedgerRevision, long Revision,
    DateOnly PeriodStart, DateOnly PeriodEnd, bool IsPeriodLocked, PlanningPhase Phase,
    RuleBinding Rules, IReadOnlyList<RestrictionEvidence> Restrictions,
    IReadOnlyList<ClassifiedBalance> Balances, IReadOnlyList<OperationReceipt> Receipts,
    DateOnly? LastPlannedDate = null);
public sealed record LineSuggestion(Guid Id, string AccountCode, decimal Debit, decimal Credit,
    Classification? Classification, string Summary);
public sealed record VoucherSuggestion(Guid Id, DateOnly Date, SuggestionKind Kind,
    bool IsNoncash, IReadOnlyList<LineSuggestion> Lines,
    SuggestionStatus Status = SuggestionStatus.PendingReview);
public sealed record ActivityAssessment(string EvidenceReference, bool RecognitionConfirmed,
    bool? ServiceMeasurementReliable = null);
public sealed record ReleaseAssessment(string RestrictionId, int RestrictionVersion,
    bool TimeSatisfied, bool PurposeSatisfied, bool ProviderRevoked, string EvidenceReference);
public sealed record AllocationShare(string Id, Guid VoucherLineId, string AccountCode,
    Classification Classification, long Weight, decimal? RequestedAmount = null);
public sealed record AllocationRequest(string Id, Guid VoucherId, decimal Total,
    bool BasisApproved, string BasisEvidenceReference, IReadOnlyList<AllocationShare> Shares);
public sealed record CalculatedShare(string Id, Guid VoucherLineId, string AccountCode,
    Classification Classification, long Weight, decimal Amount, long FloorCents, bool ReceivedExtraCent);
public sealed record AllocationCalculation(string Id, Guid VoucherId, decimal Total,
    string BasisEvidenceReference, string RoundingPolicy, IReadOnlyList<CalculatedShare> Shares);
public sealed record ProposalRequest(Guid RequestId, long ExpectedRevision, VoucherSuggestion Draft,
    IReadOnlyList<AllocationRequest> Allocations, ReleaseAssessment? Release,
    ActivityAssessment? Activity);
public sealed record BalanceDelta(string AccountCode, Classification? Classification,
    decimal Before, decimal Change, decimal After);
public sealed record ProposalEvidence(ActivityAssessment? Activity, ReleaseAssessment? Release,
    IReadOnlyList<string> EvidenceReferences);
public sealed record NonprofitProposal(Guid RequestId, long BasedOnPlanningRevision,
    long BasedOnLedgerRevision, RuleBinding Rules, SuggestionStatus Status,
    IReadOnlyList<VoucherSuggestion> Vouchers, IReadOnlyList<AllocationCalculation> Allocations,
    IReadOnlyList<BalanceDelta> Changes, PlanningState ProjectedState, ProposalEvidence Evidence);
public sealed record DonationRequest(Guid RequestId, long ExpectedRevision, DateOnly Date,
    decimal Amount, Classification Classification, DonationKind Kind,
    string EvidenceReference, bool RecognitionConfirmed, bool? ServiceMeasurementReliable = null,
    string ServiceExpenseAccount = "5101");
public sealed record ExpenseRequest(Guid RequestId, long ExpectedRevision, DateOnly Date,
    string AccountCode, decimal Amount, Classification Classification, string EvidenceReference);
public sealed record ClosingRequest(Guid RequestId, long ExpectedRevision, DateOnly Date);
public sealed record ReleaseRequest(Guid RequestId, long ExpectedRevision, DateOnly Date,
    decimal Amount, ReleaseAssessment Assessment);

public sealed class NonprofitValidationException(string code, string message) : Exception($"{code}: {message}")
{
    public string Code { get; } = code;
}
