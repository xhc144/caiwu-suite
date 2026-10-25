namespace Caiwu.Contracts;

/// <summary>Lossless, module-owned JSON object. PayloadJson is retained verbatim.</summary>
public sealed record LedgerModuleDocument(string DocumentId, int SchemaVersion, string PayloadJson);

/// <summary>Null Document deletes only the named document; other documents are retained.</summary>
public sealed record ModuleDocumentChange(string DocumentId, LedgerModuleDocument? Document);

public sealed record ModuleDocumentBatch(string ModuleId, LedgerMutationContext Context,
    IReadOnlyList<ModuleDocumentChange> Changes);

public sealed record ModuleDocumentCollection(string ModuleId, IReadOnlyList<LedgerModuleDocument> Documents);

/// <summary>The ledger and module state belong to exactly the same whole-book revision.</summary>
public sealed record ModuleLedgerSnapshot(LedgerSnapshot Ledger,
    IReadOnlyList<ModuleDocumentCollection> Modules, IReadOnlyList<ModuleVoucherReceipt> ProposalReceipts);

/// <summary>
/// A user-confirmed, new draft proposal, never permission to review or post. Source keys must
/// identify stable business documents, not a newly generated key on each submission.
/// Changes, source claims, voucher and audit commit in one ledger transaction.
/// </summary>
public sealed record VoucherProposal(Guid ProposalId, string ModuleId, IReadOnlyList<string> SourceKeys,
    LedgerMutationContext Context, DateOnly Date, string Kind, int? Number, int AttachmentCount,
    IReadOnlyList<VoucherLine> Lines, IReadOnlyList<ModuleDocumentChange> Changes);

public sealed record ModuleVoucherReceipt(Guid ProposalId, string ModuleId, IReadOnlyList<string> SourceKeys,
    Guid VoucherId, long Revision);

/// <summary>Additional API; ILedgerService v1.2 and existing callers keep their signatures.</summary>
public interface IParityLedgerService
{
    ModuleLedgerSnapshot GetModuleSnapshot();
    void SaveModuleDocuments(ModuleDocumentBatch batch, string operatorName);
    ModuleVoucherReceipt AcceptVoucherProposal(VoucherProposal proposal, string operatorName);
}

/// <summary>Original identifiers, without guessed pixels, inferred entry points or product reuse.</summary>
public sealed record OriginalWindowReference(string Product, string ObjectName, string Entry);

/// <summary>
/// Descriptive registration only. The shell binds an actual module-owned window/handler and its
/// existing authorization policy before offering an executable menu command.
/// </summary>
public sealed record ParityModuleRegistration(string ModuleId, int ContractVersion,
    IReadOnlyList<OriginalWindowReference> OriginalWindows);
