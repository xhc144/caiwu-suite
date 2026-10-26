using Caiwu.Contracts;

namespace Caiwu.LegacyCompatibility.ContractsBridge;

/// <summary>
/// Typed bridge for ParityModules v1 (checkpoint 5bb60d2). Kept in an optional independent project
/// until the integrator lands those shared contracts. Report evidence is the only module document
/// written; captured original business data is neither imported nor flattened to old voucher DTOs.
/// </summary>
public static class CompatibilityContractsBridge
{
    public static ModuleDocumentBatch PrepareReportArchival(PreviewReport report, ModuleLedgerSnapshot reviewedSnapshot)
    {
        var context = new CapturedModuleRevision(reviewedSnapshot.Ledger.Book.Id, reviewedSnapshot.Ledger.Revision);
        var plan = CompatibilityModuleAdapter.PrepareReportArchival(report, context);
        return new ModuleDocumentBatch(plan.ModuleId, new LedgerMutationContext(context.ExpectedBookId, context.ExpectedRevision),
            Array.AsReadOnly(plan.Documents.Select(d => new ModuleDocumentChange(d.DocumentId,
                new LedgerModuleDocument(d.DocumentId, d.SchemaVersion, d.PayloadJson))).ToArray()));
    }

    /// <summary>Never reloads the revision, retries a conflict, or suppresses the host's authorization/store error.</summary>
    public static void ArchiveReport(IParityLedgerService host, PreviewReport report,
        ModuleLedgerSnapshot reviewedSnapshot, string authenticatedActor) =>
        host.SaveModuleDocuments(PrepareReportArchival(report, reviewedSnapshot), authenticatedActor);
}
