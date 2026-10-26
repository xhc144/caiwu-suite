using System.Text.Json;
using System.Text.Json.Serialization;
using System.Security.Cryptography;
using System.Text;

namespace Caiwu.LegacyCompatibility;

public enum PreviewState { CorePreviewReconciled, Rejected, Incomplete, ExtractionFailed, Canceled }
public sealed record TableCaptureSummary(TableIdentity Identity, string SchemaFingerprint, int Columns, int Rows);
public sealed record InterpretationSummary(int Year, int Month, string BaseCurrency, CharacterKeyPolicy KeyPolicy,
    OpeningAmountBasis OpeningBasis, bool CompleteLeafScopeDeclared, bool PostedOnlyMovementBasisDeclared,
    string? BaseAuxiliaryKind, string? BaseAuxiliaryCode, IReadOnlyList<string> Accounts,
    IReadOnlyList<string> PostedCodes, IReadOnlyList<string> UnpostedCodes, string EvidenceReferenceFingerprint);

public sealed class PreviewReport
{
    public string SchemaVersion => "legacy-compat-preview-1";
    public string CompatibilityStatus => "not_assessed";
    public string OriginalLedgerUsability => "not_assessed";
    public string WindowsAcceptance => "not_tested";
    public string InventoryToExtractionBinding => "not_established";
    public string PhysicalSourceImmutability => "not_assessed";
    public bool ApplyAllowed => false;
    public string RollbackBoundary => "discard_in_memory_projection_and_owned_report_stage_only";
    public PreviewState State { get; }
    public ExtractionOrigin? Origin { get; }
    public string? ContentFingerprint { get; }
    public IReadOnlyList<InputFingerprint> InventoryInputs { get; }
    public string DatabaseInputId { get; }
    public int PreflightUnresolvedGapCount { get; }
    public InterpretationSummary Interpretation { get; }
    public IReadOnlyList<CoreTableBinding> Bindings { get; }
    public IReadOnlyList<TableCaptureSummary> CapturedTables { get; }
    public IReadOnlyList<ReconciliationCheck> Checks { get; }

    internal PreviewReport(PreviewState state, PreflightReceipt receipt, LegacySnapshot? snapshot,
        IEnumerable<ReconciliationCheck> checks, PreviewInterpretation interpretation)
    {
        State = state; Origin = snapshot?.Origin; ContentFingerprint = snapshot?.ContentFingerprint;
        InventoryInputs = receipt.Inputs;
        DatabaseInputId = receipt.DatabaseInputId;
        PreflightUnresolvedGapCount = receipt.UnresolvedGapCount;
        Bindings = interpretation.Bindings;
        Interpretation = new(interpretation.Year, interpretation.Month, interpretation.BaseCurrency, interpretation.KeyPolicy,
            interpretation.OpeningBasis, interpretation.CompleteLeafScopeDeclared, interpretation.PostedOnlyMovementBasisDeclared,
            interpretation.BaseAuxiliaryKind, interpretation.BaseAuxiliaryCode,
            Array.AsReadOnly(interpretation.AccountScope.Order(StringComparer.Ordinal).ToArray()),
            Array.AsReadOnly(interpretation.PostedStatusCodes.Order(StringComparer.Ordinal).ToArray()),
            Array.AsReadOnly(interpretation.UnpostedStatusCodes.Order(StringComparer.Ordinal).ToArray()),
            Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(interpretation.EvidenceReference))));
        CapturedTables = Array.AsReadOnly(snapshot?.Tables.Select(t => new TableCaptureSummary(t.Identity,
            t.SchemaFingerprint, t.Columns.Count, t.Rows.Count)).ToArray() ?? []);
        Checks = Array.AsReadOnly(checks.ToArray());
    }
}

public sealed record PreviewOutcome(PreviewReport Report, CoreProjection? ProjectionForReview);

public static class CompatibilityPreview
{
    public static async ValueTask<PreviewOutcome> RunAsync(PreflightReceipt preflight, ILegacyReadOnlyExtractor extractor,
        PreviewInterpretation interpretation, CancellationToken cancellationToken = default)
    {
        LegacySnapshot? snapshot = null;
        if (!preflight.InventoryComplete)
            return Outcome(PreviewState.Incomplete, [new("preflight_inventory_incomplete", CheckStatus.NotAssessed)]);
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            snapshot = await extractor.ExtractAsync(cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            var projection = CoreMapper.Map(snapshot, interpretation.Bindings, interpretation.KeyPolicy, cancellationToken);
            var checks = CoreReconciler.Reconcile(projection, interpretation, cancellationToken).ToList();
            if (snapshot.Origin != ExtractionOrigin.Synthetic)
                checks.Add(new("external_copy_session_and_post_read_hash_not_validated", CheckStatus.NotAssessed));
            var state = checks.Any(c => c.Status == CheckStatus.Mismatch) ? PreviewState.Rejected
                : checks.Any(c => c.Status == CheckStatus.NotAssessed) ? PreviewState.Incomplete : PreviewState.CorePreviewReconciled;
            // A rejected/partial conversion never leaks a partially usable candidate to an apply path.
            cancellationToken.ThrowIfCancellationRequested();
            return new(new PreviewReport(state, preflight, snapshot, checks, interpretation),
                state == PreviewState.CorePreviewReconciled ? projection : null);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return Outcome(PreviewState.Canceled, [new("preview_canceled_no_candidate", CheckStatus.NotAssessed)]);
        }
        catch (LegacyMappingException error)
        {
            return Outcome(PreviewState.Rejected, [new(error.Message, CheckStatus.Mismatch, error.Location)]);
        }
        catch (LegacyExtractionException)
        {
            return Outcome(PreviewState.ExtractionFailed, [new("read_only_extraction_unavailable_or_incomplete", CheckStatus.NotAssessed)]);
        }
        catch (Exception)
        {
            // Provider exceptions can include credentials/SQL/data/paths. Never echo them to reports.
            return Outcome(PreviewState.ExtractionFailed, [new("preview_failed_no_candidate_no_raw_provider_error", CheckStatus.NotAssessed)]);
        }

        PreviewOutcome Outcome(PreviewState state, ReconciliationCheck[] checks) =>
            new(new PreviewReport(state, preflight, snapshot, checks, interpretation), null);
    }
}

/// <summary>
/// Publish the summary only, never the raw snapshot. A create-new staging file is fully flushed before
/// a same-directory, no-overwrite rename. Failures remove only this call's staging file. Existing source
/// or report files (including hard links/symlinks) cannot be overwritten. A published report is the commit
/// point; cancellation after that point does not remove it or claim rollback of business data.
/// </summary>
public static class PreviewReportPublisher
{
    public static async ValueTask PublishNewAsync(PreviewReport report, string destination,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var fullDestination = Path.GetFullPath(destination);
        var parent = Path.GetDirectoryName(fullDestination)!;
        if (!Directory.Exists(parent)) throw new DirectoryNotFoundException("report_parent_must_exist");
        var bytes = Encoding.UTF8.GetBytes(PreviewReportJson.Serialize(report));
        var stage = Path.Combine(parent, ".caiwu-compat-" + Guid.NewGuid().ToString("N") + ".tmp");
        var owned = false;
        try
        {
            await using (var file = new FileStream(stage, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                4096, FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                owned = true;
                await file.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
                await file.FlushAsync(cancellationToken).ConfigureAwait(false);
                file.Flush(flushToDisk: true);
            }
            cancellationToken.ThrowIfCancellationRequested();
            File.Move(stage, fullDestination, overwrite: false);
            owned = false;
        }
        finally
        {
            if (owned) File.Delete(stage);
        }
    }
}

public static class PreviewReportJson
{
    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() }
    };
    public static string Serialize(PreviewReport report) => JsonSerializer.Serialize(report, Options);
}
