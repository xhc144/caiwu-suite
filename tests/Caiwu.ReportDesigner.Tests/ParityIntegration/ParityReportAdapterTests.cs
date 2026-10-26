using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.ReportDesigner.Cells;
using Caiwu.ReportDesigner.Integration;

namespace Caiwu.ReportDesigner.Tests;

public sealed class ParityReportAdapterTests
{
    private static readonly Guid Book = Guid.Parse("77777777-1111-2222-3333-444444444444");
    private static ModuleLedgerSnapshot Snapshot(IReadOnlyList<ModuleDocumentCollection>? modules = null) => new(
        new(12, new(Book, "合成", AccountingRegime.SmallBusiness, "synthetic", 2026, 1, 0, DateTimeOffset.UnixEpoch),
            [new("a", "借", null, BalanceDirection.Debit, true, 100, 0), new("b", "贷", null, BalanceDirection.Credit, true, 0, 100)], [], []), modules ?? [], []);
    private sealed class Service : IParityLedgerService
    {
        public ModuleDocumentBatch? Batch; public string? Actor; public bool Reject;
        public ModuleLedgerSnapshot GetModuleSnapshot() => throw new InvalidOperationException("Adapter must not refresh a captured context.");
        public void SaveModuleDocuments(ModuleDocumentBatch batch, string operatorName) { if (Reject) throw new InvalidOperationException("CAS conflict"); Batch = batch; Actor = operatorName; }
        public ModuleVoucherReceipt AcceptVoucherProposal(VoucherProposal proposal, string actor) => throw new InvalidOperationException("Reports do not create vouchers.");
    }
    [Fact] public void SaveUsesCapturedBookRevisionAndPreservesOpaqueOriginalColumnsAndUnknownValues()
    {
        var report = new CellReport { RowCount = 2, ColumnCount = 2, Cells = [new("A1", "旧标题")] };
        const string original = "{ \"foreignAmount\": 123456789.123456789, \"数量\":\"002\", \"aux\":{\"项目\":\"P-01\"}, \"unknownColumn\": null }";
        var envelope = JsonSerializer.Serialize(new ReportModuleEnvelope { Report = report, OriginalPayloadJson = original,
            UnknownProperties = new() { ["futureFeature"] = JsonDocument.Parse("{\"decimal\":12345678901234567890.12345678}").RootElement.Clone() } });
        var id = "report:" + report.Id.ToString("D"); var snapshot = Snapshot([new("reports", [new(id, 1, envelope)]), new("other", [new("keep", 9, "{\"raw\":true}")])]);
        var session = ParityReportAdapter.Open(snapshot, id); var service = new Service();
        ParityReportAdapter.Save(service, session, session.Envelope.Report with { Title = "已编辑" }, "SYN-actor");
        Assert.NotNull(service.Batch); Assert.Equal("reports", service.Batch.ModuleId); Assert.Equal(Book, service.Batch.Context.ExpectedBookId); Assert.Equal(12, service.Batch.Context.ExpectedRevision);
        Assert.Single(service.Batch.Changes); Assert.Equal(id, service.Batch.Changes[0].DocumentId); Assert.Equal("SYN-actor", service.Actor);
        var stored = ParityReportAdapter.Open(Snapshot([new("reports", [service.Batch.Changes[0].Document!])]), id);
        Assert.Equal(original, stored.Envelope.OriginalPayloadJson); Assert.Equal(2, stored.Envelope.Report.Version); Assert.Equal("已编辑", stored.Envelope.Report.Title);
        Assert.Equal("12345678901234567890.12345678", stored.Envelope.UnknownProperties!["futureFeature"].GetProperty("decimal").GetRawText());
        Assert.Equal("{\"raw\":true}", snapshot.Modules[1].Documents[0].PayloadJson);
    }
    [Fact] public void SaveFailurePropagatesAndNoSuccessStateIsInvented()
    {
        var session = ParityReportAdapter.New(Snapshot(), new(), "{}"); var service = new Service { Reject = true };
        Assert.Throws<InvalidOperationException>(() => ParityReportAdapter.Save(service, session, session.Envelope.Report, "synthetic"));
        Assert.Null(service.Batch); Assert.Equal(1, session.Envelope.Report.Version); Assert.Equal(12, session.Context.ExpectedRevision);
    }
    [Fact] public void SimplifiedLedgerRequiresExplicitCompletenessEvidenceAndDoesNotDropDimensions()
    {
        var snapshot = Snapshot();
        var proof = new ReportLedgerCompleteness(true, true, true, true, true, new(2026, 1, 1), new(2026, 12, 31), true, "self-authored synthetic fixture; no extra dimensions");
        Assert.Throws<ReportDataException>(() => ParityReportAdapter.CreateBaseCurrencySource(snapshot, proof with { NoUnknownSourceColumns = false }));
        Assert.Throws<ReportDataException>(() => ParityReportAdapter.CreateBaseCurrencySource(snapshot, proof with { NoAuxiliaryValues = false }));
        var source = ParityReportAdapter.CreateBaseCurrencySource(snapshot, proof);
        var result = new CellReportEngine().Generate(new() { Cells = [new("A1", "=CLOSING(\"a\")")] }, new(Book, new(2026, 1, 1), new(2026, 1, 31), 12), source);
        Assert.Equal(100m, result["A1"].Number);
    }
    [Fact] public void UnknownSchemaAndDuplicateOriginalKeysAreRefusedWithoutRewriting()
    {
        Assert.Throws<InvalidDataException>(() => ParityReportAdapter.New(Snapshot(), new(), "{\"aux\":1,\"aux\":2}"));
        Assert.Throws<InvalidDataException>(() => ParityReportAdapter.Open(Snapshot([new("reports", [new("future", 2, "{}")])]), "future"));
    }
}
