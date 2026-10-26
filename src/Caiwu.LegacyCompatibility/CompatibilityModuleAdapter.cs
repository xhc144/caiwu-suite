using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Caiwu.LegacyCompatibility;

/// <summary>Copy these two values from the SAME ModuleLedgerSnapshot the user reviewed.</summary>
public sealed record CapturedModuleRevision
{
    public Guid ExpectedBookId { get; }
    public long ExpectedRevision { get; }
    public CapturedModuleRevision(Guid expectedBookId, long expectedRevision)
    {
        if (expectedBookId == Guid.Empty || expectedRevision < 0) throw new ArgumentException("captured_book_revision_required");
        ExpectedBookId = expectedBookId; ExpectedRevision = expectedRevision;
    }
}

public sealed record CompatibilityModuleDocument(string DocumentId, int SchemaVersion, string PayloadJson);

/// <summary>
/// Prepared input to the shared ModuleDocumentBatch API, not a saved/committed result.
/// Deliberately owns no store, external JSON authority, revision refresh, retry, delete, or voucher proposal.
/// </summary>
public sealed record CompatibilityReportBatch(string ModuleId, CapturedModuleRevision Context,
    IReadOnlyList<CompatibilityModuleDocument> Documents);

public static class CompatibilityModuleAdapter
{
    public const string ModuleId = "compat";

    /// <summary>
    /// Prepares an evidence document only. The host translates to LedgerModuleDocument/ModuleDocumentChange
    /// and calls SaveModuleDocuments with the captured context and authenticated actor. The current
    /// baseline lacks ParityModules.cs; this DTO boundary compiles independently without copying contracts.
    /// It cannot import old posted vouchers via AcceptVoucherProposal (which only makes new drafts).
    /// </summary>
    public static CompatibilityReportBatch PrepareReportArchival(PreviewReport report, CapturedModuleRevision reviewedTarget)
    {
        using var preview = JsonDocument.Parse(PreviewReportJson.Serialize(report));
        var payload = JsonSerializer.Serialize(new
        {
            schema_version = 1,
            kind = "compatibility_read_only_preview",
            target_book_id = reviewedTarget.ExpectedBookId,
            reviewed_revision = reviewedTarget.ExpectedRevision,
            preview = preview.RootElement
        });
        var id = "preview-" + Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(payload)));
        return new(ModuleId, reviewedTarget,
            Array.AsReadOnly(new[] { new CompatibilityModuleDocument(id, 1, payload) }));
    }
}
