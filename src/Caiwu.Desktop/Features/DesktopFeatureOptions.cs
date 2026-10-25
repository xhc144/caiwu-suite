using Caiwu.Summaries;
using Caiwu.BookTools;

namespace Caiwu.Desktop.Features;

/// <summary>No implicit filesystem location. The host must supply an opened per-session catalog.</summary>
public sealed record SummaryFeatureRegistration(ISummaryCatalog Catalog,
    string BackupAttachmentKey, string BackupPolicyDescription);

/// <summary>All three host gates are mandatory; no default lease, destination policy or inventory is invented.</summary>
public sealed record BookCopyFeatureOptions(
    Func<FeatureSessionBinding, IDisposable> AcquireDataLease,
    Action<FeatureSessionBinding, string> ValidateManagedDestination,
    Action<FeatureSessionBinding, BookCopyResult> RegisterCreatedBook);

public sealed record DesktopFeatureOptions
{
    /// <summary>Called on a worker thread. Must not create a catalog implicitly on cancel/open.</summary>
    public Func<FeatureSessionBinding, SummaryFeatureRegistration>? OpenSummaryCatalog { get; init; }
    public BookCopyFeatureOptions? BookCopy { get; init; }
}
