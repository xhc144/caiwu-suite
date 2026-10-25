using Caiwu.Contracts;

namespace Caiwu.VoucherTools;

/// <summary>All header choices must be explicitly confirmed by the user. No automatic numbering.</summary>
public sealed record VoucherCopyOptions(DateOnly Date, string Kind, int Number,
    int AttachmentCount, string PreparedBy);

public enum VoucherCopyIssueCode
{
    InvalidSnapshot, SourceNotFound, AmbiguousSource, InvalidSourceStatus,
    DateOutsideBook, PeriodClosed, InvalidKind, InvalidNumber, NumberAlreadyUsed,
    InvalidAttachmentCount, InvalidPreparedBy, InvalidLines, AccountMissing,
    AccountInactive, AccountNotLeaf, InvalidSummary, InvalidAmount, Unbalanced
}

/// <param name="LineNumber">One-based source row, when the error belongs to a line.</param>
public sealed record VoucherCopyIssue(VoucherCopyIssueCode Code, string Message, int? LineNumber = null);

/// <summary>
/// An unsaved, detached new draft. The host alone may pass Draft and PreparedBy to
/// ILedgerService.SaveDraft after explicit confirmation. Core assigns the new identity.
/// </summary>
public sealed class VoucherCopyPlan
{
    internal VoucherCopyPlan(Guid sourceVoucherId, VoucherDraft draft, string preparedBy)
    {
        SourceVoucherId = sourceVoucherId;
        Draft = draft;
        PreparedBy = preparedBy;
    }

    /// <summary>For provenance display only; never use as the new draft's Id.</summary>
    public Guid SourceVoucherId { get; }
    public VoucherDraft Draft { get; }
    public string PreparedBy { get; }
}

public sealed class VoucherCopyResult
{
    internal VoucherCopyResult(VoucherCopyPlan? plan, IEnumerable<VoucherCopyIssue> issues)
    {
        Plan = plan;
        Issues = Array.AsReadOnly(issues.ToArray());
    }

    /// <summary>Null when any preflight issue blocks copying; input is never repaired silently.</summary>
    public VoucherCopyPlan? Plan { get; }
    public IReadOnlyList<VoucherCopyIssue> Issues { get; }
    public bool IsSuccess => Plan is not null;
}

/// <summary>WPF/other hosts supply the exact snapshot already displayed and a selected ID from it.</summary>
public interface IVoucherCopyPlanner
{
    VoucherCopyResult Plan(LedgerSnapshot displayedSnapshot, Guid sourceVoucherId, VoucherCopyOptions options);
}
