using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.LegacyCompatibility;
using Caiwu.LegacyCompatibility.ContractsBridge;

// Real checkpoint contract types + synthetic host only. This does not test Core/SQLite atomicity.
var receipt = PreflightReceipt.Parse(File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "pr39-preflight.synthetic.json")), "F004");
var rules = new PreviewInterpretation([], 2026, 1, "CNY", ["1001"], [], [], "synthetic-contract-shape-only");
var preview = await CompatibilityPreview.RunAsync(receipt, new SqlAnywhereReadOnlyExtractor(), rules);
var bookId = Guid.Parse("8cde6efe-baa3-4656-b85e-a766ef74ff61");
var ledger = new LedgerSnapshot(17, new BookInfo(bookId, "synthetic-target", AccountingRegime.Enterprise,
    "synthetic", 2026, 1, 0, DateTimeOffset.UnixEpoch), [], [], []);
var reviewed = new ModuleLedgerSnapshot(ledger, [], []);
var host = new SyntheticHost(bookId, 17);
CompatibilityContractsBridge.ArchiveReport(host, preview.Report, reviewed, "fixture-actor");
var batch = host.Last!;
Require(batch.Context.ExpectedBookId == bookId && batch.Context.ExpectedRevision == 17, "captured_context");
Require(batch.ModuleId == "compat" && batch.Changes.Count == 1, "only_compat_report");
var document = batch.Changes[0].Document!;
Require(document.DocumentId == batch.Changes[0].DocumentId && document.SchemaVersion == 1, "stable_document_shape");
using var payload = JsonDocument.Parse(document.PayloadJson);
Require(payload.RootElement.GetProperty("reviewed_revision").GetInt64() == 17
    && !payload.RootElement.GetProperty("preview").GetProperty("ApplyAllowed").GetBoolean(), "evidence_only_payload");
Require(host.GetSnapshotCalls == 0 && host.ProposalCalls == 0, "no_revision_refresh_or_voucher_proposal");
host.CurrentRevision = 18;
var conflictPropagated = false;
try { CompatibilityContractsBridge.ArchiveReport(host, preview.Report, reviewed, "fixture-actor"); }
catch (InvalidOperationException error) when (error.Message == "synthetic_stale_context") { conflictPropagated = true; }
Require(conflictPropagated && host.SuccessfulSaves == 1 && host.GetSnapshotCalls == 0, "stale_context_propagates_no_retry");
Console.WriteLine(JsonSerializer.Serialize(new { scope = "shared_contract_shape_synthetic_host_only", assertions = 6,
    shared_contract_checkpoint = "5bb60d24b9c60c9eecfcc5adc37bced4688adf85", core_sqlite_transaction = "not_tested", result = "passed" }));

static void Require(bool condition, string code) { if (!condition) throw new InvalidOperationException(code); }

sealed class SyntheticHost(Guid bookId, long revision) : IParityLedgerService
{
    public long CurrentRevision { get; set; } = revision;
    public int GetSnapshotCalls { get; private set; }
    public int ProposalCalls { get; private set; }
    public int SuccessfulSaves { get; private set; }
    public ModuleDocumentBatch? Last { get; private set; }
    public ModuleLedgerSnapshot GetModuleSnapshot() { GetSnapshotCalls++; throw new NotSupportedException(); }
    public ModuleVoucherReceipt AcceptVoucherProposal(VoucherProposal proposal, string actor)
    { ProposalCalls++; throw new NotSupportedException(); }
    public void SaveModuleDocuments(ModuleDocumentBatch batch, string actor)
    {
        if (batch.Context.ExpectedBookId != bookId || batch.Context.ExpectedRevision != CurrentRevision)
            throw new InvalidOperationException("synthetic_stale_context");
        Last = batch; SuccessfulSaves++;
    }
}
