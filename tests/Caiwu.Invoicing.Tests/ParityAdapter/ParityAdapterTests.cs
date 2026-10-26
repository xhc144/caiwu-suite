using System.Collections.Immutable;
using System.Text.Json;
using System.Text.Json.Nodes;
using Caiwu.Contracts;
using Caiwu.Invoicing.ParityAdapter;

namespace Caiwu.Invoicing.Tests.ParityAdapter;

public sealed class ParityAdapterTests
{
    private static readonly InvoiceMonth Month = new(2026, 10);
    private static readonly VoucherAccounts Mapping = new("1122", "6001", "6002", "222101", "1403", "222102", "2202");
    private static readonly DateOnly VoucherDate = new(2026, 10, 31);
    private static ModuleLedgerSnapshot Snapshot()
    {
        string[] codes = ["1122", "6001", "6002", "222101", "1403", "222102", "2202"];
        var book = new BookInfo(Guid.NewGuid(), "合成发票适配测试", AccountingRegime.SmallBusiness, "synthetic", 2026, 10, 9, DateTimeOffset.UnixEpoch);
        return new(new(21, book, codes.Select(x => new Account(x, "合成科目", null, BalanceDirection.Debit, true, 0, 0)).ToArray(), [], []), [], []);
    }
    private static ModuleLedgerSnapshot WithDocuments(ModuleLedgerSnapshot snapshot, int count = 1, string? extra = null)
    {
        var state = ParityInvoiceAdapter.Read(snapshot, InvoiceProduct.Qingsong);
        var service = new InvoiceService(new MemoryInvoiceStore(state));
        for (int i = 1; i <= count; i++)
        {
            var row = LegacyInvoiceRow.Parse("""{"fpdm":"00001","fphm":"00001","rq":"2026-10-05","g_qymc":"合成单位","g_sh":"SYNTH","je0":100,"se":13,"je1":113,"fpzt":"正常","sh_bz":"0","pz_bz":"0","unknown_variant":"不丢弃","original_null":null}""")
                .Set("fphm", $"{i:00000}");
            if (extra is not null) row = row.Set(extra, "不得丢失");
            service.Import(service.Read().Revision, [new(InvoiceDirection.Output, InvoiceKind.Special, [row])]);
        }
        var edited = service.Read();
        // Simulate the authoritative document payload only; this test does not claim the core has committed it.
        var module = new InvoiceModuleState(1, state.BookId, state.Product, state.OpeningMonth, state.OpenMonth, edited.Documents);
        return snapshot with { Modules = [new("invoices", [new("workspace", 1, InvoiceJson.Serialize(module))])] };
    }
    private static InvoiceVoucherPlan Plan(ModuleLedgerSnapshot snapshot, VoucherGrouping grouping = VoucherGrouping.Monthly)
    {
        var state = ParityInvoiceAdapter.Read(snapshot, InvoiceProduct.Qingsong);
        return new InvoiceService(new MemoryInvoiceStore(state)).CreateVoucherPlan(new(InvoiceDirection.Output, Month, Month, 1, 1,
            grouping, SalesCategory.Goods, Mapping, state.Documents.Select(x => x.Id).ToImmutableArray(), ImmutableHashSet.Create("正常"), true));
    }
    private static VoucherProposal Proposal(ModuleLedgerSnapshot snapshot, InvoiceVoucherPlan? plan = null) =>
        ParityInvoiceAdapter.PrepareVoucherProposal(snapshot, InvoiceProduct.Qingsong, plan ?? Plan(snapshot), Guid.NewGuid(), "记", VoucherDate,
            InvoicePostingScope.VerifiedBaseCurrencyWithoutAuxiliary);

    [Fact]
    public void SnapshotAndSaveUseExactlyTheOriginBookRevisionAndKeepUnknownFields()
    {
        var origin = WithDocuments(Snapshot());
        var state = ParityInvoiceAdapter.Read(origin, InvoiceProduct.Qingsong);
        Assert.Equal(21, state.Revision);
        Assert.Equal(origin.Ledger.Book.Id, state.BookId);
        Assert.Equal(Month, state.OpenMonth);
        var service = new InvoiceService(new MemoryInvoiceStore(state));
        service.SetReviewed(21, state.Documents[0].Id, true);
        var batch = ParityInvoiceAdapter.PrepareSave(origin, service.Read());
        Assert.Equal(new LedgerMutationContext(origin.Ledger.Book.Id, 21), batch.Context);
        var saved = InvoiceJson.Deserialize<InvoiceModuleState>(Assert.Single(batch.Changes).Document!.PayloadJson);
        Assert.Equal("不丢弃", saved.Documents[0].Rows[0].Text("unknown_variant"));
        Assert.Equal(JsonValueKind.Null, saved.Documents[0].Rows[0].Fields["original_null"].ValueKind);
        Assert.Equal("1", saved.Documents[0].Rows[0].Text("sh_bz"));
        Assert.Equal("0", state.Documents[0].Rows[0].Text("sh_bz"));
    }

    [Fact]
    public void ProposalCarriesAtomicSourceUpdatesAndDoesNotMutateOrigin()
    {
        var origin = WithDocuments(Snapshot(), 2);
        var before = InvoiceJson.Serialize(origin);
        var proposal = Proposal(origin);
        Assert.Equal(VoucherDate, proposal.Date);
        Assert.Equal(21, proposal.Context.ExpectedRevision);
        Assert.Equal(2, proposal.SourceKeys.Count);
        Assert.Equal(226, proposal.Lines.Sum(x => x.Debit));
        var changed = InvoiceJson.Deserialize<InvoiceModuleState>(Assert.Single(proposal.Changes).Document!.PayloadJson);
        Assert.All(changed.Documents, doc => Assert.All(doc.Rows, row => Assert.Equal("1", row.Text("pz_bz"))));
        Assert.All(changed.Documents, doc => Assert.Equal(1, doc.Rows[0].Number("p_pzbh")));
        Assert.Equal(before, InvoiceJson.Serialize(origin));
        Assert.Empty(origin.Ledger.Vouchers); // No AcceptVoucherProposal was invoked.
    }

    [Fact]
    public void StableSourceKeyDoesNotChangeWhenDocumentGuidChanges()
    {
        var origin = WithDocuments(Snapshot());
        var first = Proposal(origin).SourceKeys[0];
        var module = InvoiceJson.Deserialize<InvoiceModuleState>(origin.Modules[0].Documents[0].PayloadJson);
        module = module with { Documents = [module.Documents[0] with { Id = Guid.NewGuid() }] };
        var reimported = origin with { Modules = [new("invoices", [new("workspace", 1, InvoiceJson.Serialize(module))])] };
        Assert.Equal(first, Proposal(reimported).SourceKeys[0]);
    }

    [Theory]
    [InlineData("xmbm")]
    [InlineData("pz_wb")]
    [InlineData("pz_sl")]
    public void UnsupportedVoucherDimensionsAreRetainedAndRefused(string field)
    {
        var snapshot = WithDocuments(Snapshot(), extra: field);
        Assert.Equal("不得丢失", ParityInvoiceAdapter.Read(snapshot, InvoiceProduct.Qingsong).Documents[0].Rows[0].Text(field));
        Assert.Equal("voucher-dimensions", Assert.Throws<InvoiceException>(() => Proposal(snapshot)).Code);
    }

    [Fact]
    public void MultipleVoucherPlansAndStaleContextAreNotSilentlySplitOrRefreshed()
    {
        var snapshot = WithDocuments(Snapshot(), 2);
        Assert.Equal("proposal-batch", Assert.Throws<InvoiceException>(() => Proposal(snapshot, Plan(snapshot, VoucherGrouping.PerInvoice))).Code);
        var oldPlan = Plan(snapshot);
        var changed = snapshot with { Ledger = snapshot.Ledger with { Revision = 22 } };
        Assert.Equal("stale", Assert.Throws<InvoiceException>(() => Proposal(changed, oldPlan)).Code);
    }

    [Fact]
    public void SnapshotRejectsWrongProductOrHighSchemaAndSaveCannotSmuggleSyntheticJournal()
    {
        var snapshot = WithDocuments(Snapshot());
        Assert.Equal("book-mismatch", Assert.Throws<InvoiceException>(() => ParityInvoiceAdapter.Read(snapshot, InvoiceProduct.Chengben)).Code);
        var bad = snapshot with { Modules = [new("invoices", [snapshot.Modules[0].Documents[0] with { SchemaVersion = 9 }])] };
        Assert.Equal("schema", Assert.Throws<InvoiceException>(() => ParityInvoiceAdapter.Read(bad, InvoiceProduct.Qingsong)).Code);
        var service = new InvoiceService(new MemoryInvoiceStore(ParityInvoiceAdapter.Read(snapshot, InvoiceProduct.Qingsong)));
        service.CommitVoucherPlanToSandbox(Plan(snapshot));
        Assert.Equal("ledger-write", Assert.Throws<InvoiceException>(() => ParityInvoiceAdapter.PrepareSave(snapshot, service.Read())).Code);
    }

    [Theory]
    [InlineData(InvoiceProduct.Qingsong, "qingsong/fp")]
    [InlineData(InvoiceProduct.Chengben, "chengben/fp")]
    public void RegistrationKeepsProductAndOriginalMenuIdentity(InvoiceProduct product, string expected)
    {
        var registration = ParityInvoiceAdapter.Registration(product);
        Assert.Equal("invoices", registration.ModuleId);
        Assert.Equal(4, registration.OriginalWindows.Count);
        Assert.All(registration.OriginalWindows, x => Assert.Equal(expected, x.Product));
        Assert.Contains(registration.OriginalWindows, x => x.ObjectName == "w_fp_lr_2" && x.Entry == "menu:m_frame_fp/m_o/m_o_pzsc");
    }

    [Fact]
    public void EntryStoreUsesOnlyCapturedContextAndPropagatesCoreConcurrencyWithoutLocalCommit()
    {
        var origin = WithDocuments(Snapshot());
        var spy = new ContractSpy(origin);
        var store = new ParityInvoiceStore(spy, InvoiceProduct.Qingsong, "synthetic-actor");
        var edited = store.Read();
        var service = new InvoiceService(new MemoryInvoiceStore(edited));
        service.SetReviewed(edited.Revision, edited.Documents[0].Id, true);
        Assert.False(store.TrySave(21, service.Read()));
        Assert.Equal(1, spy.Reads); // TrySave never fetched a new revision.
        Assert.Equal(new LedgerMutationContext(origin.Ledger.Book.Id, 21), spy.Batch!.Context);
        Assert.Equal("synthetic-actor", spy.Actor);
        Assert.Equal("0", ParityInvoiceAdapter.Read(origin, InvoiceProduct.Qingsong).Documents[0].Rows[0].Text("sh_bz"));
    }

    [Fact]
    public void AConsumedSourceIsNotFreedByDeletingItsDraft()
    {
        var snapshot = WithDocuments(Snapshot());
        var prior = Proposal(snapshot);
        var consumed = snapshot with { ProposalReceipts = [new(prior.ProposalId, "invoices", prior.SourceKeys, Guid.NewGuid(), 20)] };
        Assert.Empty(consumed.Ledger.Vouchers);
        Assert.Equal("source-consumed", Assert.Throws<InvoiceException>(() => Proposal(consumed)).Code);
    }

    public static IEnumerable<object[]> UnknownStructuralMembers()
    {
        foreach (var level in new[] { "module", "document", "key", "row", "month" })
        foreach (var payload in new[]
        {
            "null",
            "9007199254740993.1234567890123456789",
            """{"Nested":[null,{"Amount":9007199254740993.1234567890123456789,"Huge":1e1000}]}"""
        }) yield return [level, payload];
    }

    [Theory]
    [MemberData(nameof(UnknownStructuralMembers))]
    public void UnknownStructuralMembersCannotDisappearThroughReviewAndPrepareSave(string level, string payload)
    {
        var snapshot = WithDocuments(Snapshot());
        var module = JsonNode.Parse(snapshot.Modules[0].Documents[0].PayloadJson)!.AsObject();
        var document = module["Documents"]![0]!;
        var target = level switch
        {
            "module" => module,
            "document" => document.AsObject(),
            "key" => document["Key"]!.AsObject(),
            "row" => document["Rows"]![0]!.AsObject(),
            "month" => module["OpenMonth"]!.AsObject(),
            _ => throw new ArgumentOutOfRangeException(nameof(level))
        };
        target["FutureField"] = JsonNode.Parse(payload);
        var originalPayload = module.ToJsonString();
        var extended = snapshot with { Modules = [new("invoices", [new("workspace", 1, originalPayload)])] };

        // Exercise the reported read → review → save preparation path. Unknown schema must stop it before data can be rewritten.
        var error = Assert.Throws<JsonException>(() =>
        {
            var state = ParityInvoiceAdapter.Read(extended, InvoiceProduct.Qingsong);
            var service = new InvoiceService(new MemoryInvoiceStore(state));
            service.SetReviewed(state.Revision, state.Documents[0].Id, true);
            ParityInvoiceAdapter.PrepareSave(extended, service.Read());
        });
        Assert.Contains("FutureField", error.Message);
        Assert.Equal(originalPayload, extended.Modules[0].Documents[0].PayloadJson);
        Assert.Equal(snapshot.Ledger.Revision, extended.Ledger.Revision);
    }

    [Fact]
    public void RawColumnNullAndHighPrecisionSurviveReviewAndPrepareSave()
    {
        const string precise = "9007199254740993.1234567890123456789";
        var snapshot = WithDocuments(Snapshot());
        var module = JsonNode.Parse(snapshot.Modules[0].Documents[0].PayloadJson)!;
        var fields = module["Documents"]![0]!["Rows"]![0]!["Fields"]!.AsObject();
        fields["future_null"] = null;
        fields["future_precise"] = JsonNode.Parse(precise);
        var extended = snapshot with { Modules = [new("invoices", [new("workspace", 1, module.ToJsonString())])] };
        var state = ParityInvoiceAdapter.Read(extended, InvoiceProduct.Qingsong);
        var service = new InvoiceService(new MemoryInvoiceStore(state));
        service.SetReviewed(state.Revision, state.Documents[0].Id, true);
        var batch = ParityInvoiceAdapter.PrepareSave(extended, service.Read());
        using var saved = JsonDocument.Parse(Assert.Single(batch.Changes).Document!.PayloadJson);
        var restored = saved.RootElement.GetProperty("Documents")[0].GetProperty("Rows")[0].GetProperty("Fields");
        Assert.Equal(JsonValueKind.Null, restored.GetProperty("future_null").ValueKind);
        Assert.Equal(precise, restored.GetProperty("future_precise").GetRawText());
        Assert.Equal("1", restored.GetProperty("sh_bz").GetString());
    }

    private sealed class ContractSpy(ModuleLedgerSnapshot snapshot) : IParityLedgerService
    {
        public int Reads { get; private set; }
        public ModuleDocumentBatch? Batch { get; private set; }
        public string? Actor { get; private set; }
        public ModuleLedgerSnapshot GetModuleSnapshot() { Reads++; return snapshot; }
        public void SaveModuleDocuments(ModuleDocumentBatch batch, string operatorName)
        {
            Batch = batch; Actor = operatorName;
            throw new StoreConcurrencyException("合成冲突");
        }
        public ModuleVoucherReceipt AcceptVoucherProposal(VoucherProposal proposal, string operatorName)
            => throw new NotSupportedException("This test inspects contracts, not core persistence.");
    }
}
