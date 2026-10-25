namespace Caiwu.Contracts;

/// <summary>
/// The origin of the data the user edited, selected or confirmed. Capture both fields from
/// that same LedgerSnapshot, keep them unchanged through submission, and never replace
/// them with a fresh read to bypass a conflict. The revision covers the entire book.
/// </summary>
public sealed record LedgerMutationContext(Guid ExpectedBookId, long ExpectedRevision);
