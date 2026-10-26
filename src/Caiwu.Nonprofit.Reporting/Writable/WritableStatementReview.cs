using Caiwu.Nonprofit.Writable;
using System.Security.Cryptography;
using System.Text.Json;

namespace Caiwu.Nonprofit.Reporting;

public sealed record WritableBalanceAnalysis(BalanceFact Fact, decimal? YearOpening,
    decimal? Closing, string EvidenceReference, string? MissingDetail = null);

/// <summary>Human review assertions are bound to the full enriched snapshot, not a reduced four-field voucher.
/// Derived account amounts cannot be overwritten by analysis values.</summary>
public sealed record WritableStatementReview(Guid BookId, long Revision, string SnapshotSha256,
    ReportingPeriod Period, DateTimeOffset ReviewedAt, string EvidenceReference,
    bool AccountPopulationCompleteConfirmed, bool CnyAmountsConfirmed, bool MappingReviewed,
    bool ClassificationReviewed, bool CompleteYearToDateConfirmed, bool BusinessBreakdownComplete,
    FundraisingDisclosure FundraisingDisclosure, YearOpeningBasis YearOpeningBasis,
    bool RestrictedIncomeTaxTreatmentReviewed, string? RestrictedIncomeTaxReviewEvidence,
    IReadOnlyList<WritableBalanceAnalysis> BalanceAnalyses, IReadOnlyList<ActivityComponent> Components,
    IReadOnlyList<MissingReason> SourceLimitations);

public static class WritableLedgerIdentity
{
    public static string Sha256(NonprofitLedgerSnapshot snapshot) =>
        Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(snapshot)));
    public static WritableStatementReview CreateUnreviewed(NonprofitLedgerSnapshot snapshot, ReportingPeriod period, DateTimeOffset at)
    {
        NonprofitLedgerValidation.Validate(snapshot);
        return new(snapshot.BookId, snapshot.Revision, Sha256(snapshot), period, at, "",
            false, false, false, false, false, false, FundraisingDisclosure.Unknown, YearOpeningBasis.Unknown,
            false, null, [], [], []);
    }
}
