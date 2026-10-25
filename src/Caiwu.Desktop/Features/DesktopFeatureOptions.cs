using Caiwu.Summaries;
using Caiwu.BookTools;
using Caiwu.Operators;

namespace Caiwu.Desktop.Features;

/// <summary>No implicit filesystem location. The host must supply an opened per-session catalog.</summary>
public sealed record SummaryFeatureRegistration(ISummaryCatalog Catalog,
    string BackupAttachmentKey, string BackupPolicyDescription,
    OperatorPermission ManagementPermission = OperatorPermission.PrepareVoucher);

/// <summary>All three host gates are mandatory; no default lease, destination policy or inventory is invented.</summary>
public sealed record BookCopyFeatureOptions(
    Func<FeatureSessionBinding, IDisposable> AcquireDataLease,
    Action<FeatureSessionBinding, string> ValidateManagedDestination,
    Action<FeatureSessionBinding, BookCopyResult> RegisterCreatedBook);

public sealed record DesktopFeatureOptions
{
    /// <summary>Must match the fixed login used by AuthorizedLedgerServiceFactory.BindSession for this MainWindow.</summary>
    public FeatureAuthentication? Authentication { get; init; }
    /// <summary>Called on a worker thread. Must not create a catalog implicitly on cancel/open.</summary>
    public Func<FeatureSessionBinding, SummaryFeatureRegistration>? OpenSummaryCatalog { get; init; }
    public Func<FeatureSessionBinding, bool>? CanInitializeSummaryCatalog { get; init; }
    public Func<FeatureSessionBinding, SummaryFeatureRegistration>? InitializeSummaryCatalog { get; init; }
    public ManagedFeatureContext? Managed { get; init; }
    public BookCopyFeatureOptions? BookCopy { get; init; }
    /// <summary>Explicit user-data preview root. Classification JSON remains outside the ledger backup until registered by Delivery.</summary>
    public string? NonprofitPreviewRoot { get; init; }
}
