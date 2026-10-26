using System.Collections.Immutable;
using System.Text.Json;
using Caiwu.Invoicing;

namespace Caiwu.Invoicing.Tests;

public sealed class InvoiceWorkflowTests
{
    private static readonly InvoiceMonth October = new(2026, 10);
    private static readonly VoucherAccounts Mapping = new("1122", "6001", "6002", "222101", "1403", "222102", "2202");
    private static readonly string[] Codes = ["1122", "6001", "6002", "222101", "1403", "222102", "2202"];
    private static InvoiceWorkspace Workspace(InvoiceProduct product = InvoiceProduct.Qingsong) =>
        InvoiceWorkspace.CreateSynthetic(Guid.NewGuid(), product, October, Codes.Select(x => new InvoiceAccount(x, true, true)));
    private static InvoiceImport Invoice(string number = "00000001", InvoiceDirection direction = InvoiceDirection.Output,
        decimal net = 100, decimal tax = 13, InvoiceKind kind = InvoiceKind.Special)
    {
        var row = LegacyInvoiceRow.Parse("""{"fpdm":"00001234","fphm":"00000001","g_qymc":"合成单位","g_sh":"SYNTHETIC-ONLY","rq":"2026-10-05T12:34:56","je0":100,"se":13,"je1":113,"sl":2,"dj":50,"slv":0.13,"fpzt":"正常","lx":"RAW1","sh_bz":"0","pz_bz":"0","bz1":null,"variant_extra":"保留未知字段"}""")
            .Set("fphm", number).Set("je0", net).Set("se", tax).Set("je1", net + tax)
            .Set("sl", 2).Set("dj", net / 2).Set("slv", net == 0 ? 0 : tax / net);
        return new(direction, kind, [row]);
    }
    private static PlanRequest Request(InvoiceService service, InvoiceDirection direction = InvoiceDirection.Output,
        VoucherGrouping grouping = VoucherGrouping.PerInvoice) => new(direction, October, October, 1, 1, grouping,
            SalesCategory.Goods, Mapping, service.Read().Documents.Where(x => x.Key.Direction == direction).Select(x => x.Id).ToImmutableArray(),
            ImmutableHashSet.Create("正常", "红字"), true);
    private static void Error(string code, Action action) => Assert.Equal(code, Assert.Throws<InvoiceException>(action).Code);

    [Theory]
    [InlineData(InvoiceProduct.Qingsong)]
    [InlineData(InvoiceProduct.Chengben)]
    public void OutputAndInputRunThroughPlansSandboxCommitCompareAndReverse(InvoiceProduct product)
    {
        var service = new InvoiceService(new MemoryInvoiceStore(Workspace(product)));
        service.Import(0, [Invoice(), Invoice(direction: InvoiceDirection.Input)]);
        var outgoing = service.CreateVoucherPlan(Request(service));
        Assert.Empty(service.Read().Journals); // A plan has no ledger side effects.
        Assert.All(service.Read().Documents, x => Assert.True(x.IsUnprocessed));
        Assert.Equal(product, outgoing.Product);
        var outputJournal = Assert.Single(service.CommitVoucherPlanToSandbox(outgoing));
        var input = Request(service, InvoiceDirection.Input) with { FirstNumber = 2 };
        service.CommitVoucherPlanToSandbox(service.CreateVoucherPlan(input));
        Assert.All(service.Read().Documents, doc => Assert.All(doc.Rows, row => Assert.Equal("1", row.Text("pz_bz"))));
        Assert.Equal(2, service.Read().Journals.Length);
        var compare = service.CompareVat(2026, false, Mapping.OutputTax, Mapping.InputTax, service.ReadSandboxLedger())[9];
        Assert.True(compare.Matches);
        Assert.Equal(13, compare.OutputInLedger);
        Assert.Equal(13, compare.InputInLedger);
        service.DeleteGeneratedVoucherFromSandbox(service.Read().Revision, outputJournal.Id);
        Assert.Single(service.Read().Journals);
        Assert.True(service.Read().Documents.Single(x => x.Key.Direction == InvoiceDirection.Output).IsUnprocessed);
    }

    [Fact]
    public void DuplicateImportsAreIdempotentEvenAfterGenerationAndColumnReordering()
    {
        var service = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        var data = Invoice();
        service.Import(0, [data]);
        service.CommitVoucherPlanToSandbox(service.CreateVoucherPlan(Request(service)));
        var reverse = data with { Rows = [new(data.Rows[0].Fields.Reverse().ToImmutableDictionary())] };
        var result = service.Import(2, [reverse]);
        Assert.Equal(new ImportResult(0, 1, 2), result);
        Assert.Single(service.Read().Journals);
    }

    [Fact]
    public void ConflictAbortsWholeBatchAndDoesNotOverwrite()
    {
        var service = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        service.Import(0, [Invoice()]);
        var before = InvoiceJson.Serialize(service.Read());
        Error("import-conflict", () => service.Import(1, [Invoice("00000002"), Invoice(net: 101)]));
        Assert.Equal(before, InvoiceJson.Serialize(service.Read()));
    }

    [Fact]
    public void SameNumberDifferentCodeDirectionOrKindRemainsDistinctAndZerosStay()
    {
        var service = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        var ordinary = Invoice(kind: InvoiceKind.Ordinary);
        var alternateCode = Invoice() with { Rows = [Invoice().Rows[0].Set("fpdm", "99999999")] };
        var result = service.Import(0, [Invoice(), ordinary, alternateCode, Invoice(direction: InvoiceDirection.Input)]);
        Assert.Equal(4, result.Added);
        Assert.All(service.Read().Documents, x => Assert.Equal("00000001", x.Key.Number));
    }

    [Fact]
    public void MultiLineInvoiceIsOneVoucherAndLineOrderDoesNotCreateDuplicate()
    {
        var first = Invoice().Rows[0].Set("xh", 1);
        var second = Invoice(net: 200, tax: 26).Rows[0].Set("xh", 2);
        var data = new InvoiceImport(InvoiceDirection.Output, InvoiceKind.Special, [first, second]);
        var service = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        service.Import(0, [data]);
        Assert.Equal(300, Assert.Single(service.Read().Documents).Net);
        Assert.Equal(1, service.Import(1, [data with { Rows = [second, first] }]).Duplicates);
        var voucher = Assert.Single(service.CreateVoucherPlan(Request(service)).Vouchers);
        Assert.Equal(339, voucher.Lines.Sum(x => x.Debit));
        Assert.Equal(voucher.Lines.Sum(x => x.Debit), voucher.Lines.Sum(x => x.Credit));
    }

    [Fact]
    public void MonthlyVoucherRetainsEverySourceAndDeletionClearsAllBacklinks()
    {
        var service = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        service.Import(0, [Invoice(), Invoice("00000002")]);
        var plan = service.CreateVoucherPlan(Request(service, grouping: VoucherGrouping.Monthly));
        var journal = Assert.Single(service.CommitVoucherPlanToSandbox(plan));
        Assert.Equal(2, journal.SourceIds.Length);
        service.DeleteGeneratedVoucherFromSandbox(2, journal.Id);
        Assert.All(service.Read().Documents, x => Assert.True(x.IsUnprocessed));
        Assert.All(service.Read().Documents, x => Assert.All(x.Rows, row => Assert.Null(row.Text("p_pzbh"))));
    }

    [Fact]
    public void ReviewedAndUnknownStatusDocumentsCannotBeEditedOrDeleted()
    {
        var service = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        var doc = service.Save(0, null, Invoice());
        service.SetReviewed(1, doc.Id, true);
        Error("reviewed", () => service.Delete(2, [doc.Id]));
        Error("reviewed", () => service.Save(2, doc.Id, Invoice()));
        service.SetReviewed(2, doc.Id, false);
        service.Delete(3, [doc.Id]);
        Assert.Empty(service.Read().Documents);
        var unknown = Invoice() with { Rows = [Invoice().Rows[0].Set("sh_bz", "7")] };
        service.Import(4, [unknown]);
        var preserved = Assert.Single(service.Read().Documents);
        Assert.Equal("7", preserved.Rows[0].Text("sh_bz"));
        Error("unknown-review", () => service.SetReviewed(5, preserved.Id, false));
        Error("unknown-review", () => service.CreateVoucherPlan(Request(service)));
    }

    [Fact]
    public void UnknownAndWarehouseProcessingFlagsArePreservedAndBlockGeneration()
    {
        foreach (var flag in new[] { "2", "8" })
        {
            var service = new InvoiceService(new MemoryInvoiceStore(Workspace(InvoiceProduct.Chengben)));
            service.Import(0, [Invoice() with { Rows = [Invoice().Rows[0].Set("pz_bz", flag).Set("p_pjdh", "SYNTH-CK-1")] }]);
            Error("processed", () => service.CreateVoucherPlan(Request(service)));
            Error("processed", () => service.Delete(1, [service.Read().Documents[0].Id]));
            Assert.Equal(flag, service.Read().Documents[0].Rows[0].Text("pz_bz"));
        }
    }

    [Fact]
    public void ClosedDatesAndStaleEditsCannotMutateWorkspace()
    {
        var store = new MemoryInvoiceStore(Workspace());
        var service = new InvoiceService(store);
        var doc = service.Save(0, null, Invoice());
        Error("stale", () => service.Save(0, doc.Id, Invoice()));
        Assert.True(store.TrySave(1, service.Read() with { Revision = 2, OpenMonth = October.Next() }));
        var before = InvoiceJson.Serialize(service.Read());
        Error("closed", () => service.Delete(2, [doc.Id]));
        Error("closed", () => service.Import(2, [Invoice("2")]));
        Error("closed", () => service.SetReviewed(2, doc.Id, true));
        Assert.Equal(before, InvoiceJson.Serialize(service.Read()));
    }

    [Fact]
    public void InputCertificationDateDeterminesComparisonAndSelectedSourceMonth()
    {
        var service = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        var input = Invoice(direction: InvoiceDirection.Input) with { Rows = [Invoice(direction: InvoiceDirection.Input).Rows[0].Set("rq_2", "2026-11-08")] };
        service.Import(0, [input]);
        Error("source-period", () => service.CreateVoucherPlan(Request(service, InvoiceDirection.Input)));
        var request = Request(service, InvoiceDirection.Input) with { SourceMonth = October.Next(), VoucherMonth = October.Next() };
        Assert.Single(service.CreateVoucherPlan(request).Vouchers);
        Assert.Equal(0, service.CompareVat(2026, false, Mapping.OutputTax, Mapping.InputTax, null)[9].InputOnInvoice);
        Assert.Equal(13, service.CompareVat(2026, false, Mapping.OutputTax, Mapping.InputTax, null)[10].InputOnInvoice);
    }

    [Fact]
    public void OutputQuantityAndTaxThresholdsMatchDocumentedChecks()
    {
        var service = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        var data = Invoice();
        Error("quantity-price", () => service.Save(0, null, data with { Rows = [data.Rows[0].Set("je0", 100.01m)] }));
        Error("tax-rate", () => service.Save(0, null, data with { Rows = [data.Rows[0].Set("se", 13.02m)] }));
        service.Save(0, null, data with { Rows = [data.Rows[0].Set("se", 13.019m)] });
        Error("gross-mismatch", () => service.CreateVoucherPlan(Request(service)));
    }

    [Fact]
    public void MissingAmountsArePreservedButCannotSilentlyBecomeZeroVouchers()
    {
        var service = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        var data = Invoice(direction: InvoiceDirection.Input);
        service.Import(0, [data with { Rows = [data.Rows[0].Set("se", null)] }]);
        Assert.Null(service.Read().Documents[0].Rows[0].Number("se"));
        Error("amount-missing", () => service.CreateVoucherPlan(Request(service, InvoiceDirection.Input)));
    }

    [Fact]
    public void InputTaxTreatmentIsExplicitAndOrdinaryInvoiceCanCapitalizeTax()
    {
        var service = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        service.Import(0, [Invoice(direction: InvoiceDirection.Input, kind: InvoiceKind.Ordinary)]);
        var request = Request(service, InvoiceDirection.Input) with { SeparateInputTax = false };
        var voucher = Assert.Single(service.CreateVoucherPlan(request).Vouchers);
        Assert.DoesNotContain(voucher.Lines, x => x.AccountCode == Mapping.InputTax);
        Assert.Equal(113, voucher.Lines.Single(x => x.AccountCode == Mapping.Material).Debit);
    }

    [Fact]
    public void RedInvoicesReverseSidesAndRemainBalanced()
    {
        var service = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        service.Import(0, [Invoice(net: -100, tax: -13)]);
        var voucher = Assert.Single(service.CreateVoucherPlan(Request(service)).Vouchers);
        Assert.Equal(113, voucher.Lines.Single(x => x.AccountCode == Mapping.Receivable).Credit);
        Assert.Equal(13, voucher.Lines.Single(x => x.AccountCode == Mapping.OutputTax).Debit);
        Assert.All(voucher.Lines, x => Assert.True(x.Debit >= 0 && x.Credit >= 0));
    }

    [Fact]
    public void InactiveOrNonLeafAccountsZeroVouchersAndUnknownInvoiceStateAreRejected()
    {
        var state = Workspace();
        var service = new InvoiceService(new MemoryInvoiceStore(state with
        {
            Accounts = state.Accounts.Select(x => x.Code == Mapping.OutputTax ? x with { IsLeaf = false } : x).ToImmutableArray()
        }));
        service.Import(0, [Invoice()]);
        Error("account", () => service.CreateVoucherPlan(Request(service)));
        var zero = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        zero.Import(0, [Invoice(net: 0, tax: 0)]);
        Error("zero-voucher", () => zero.CreateVoucherPlan(Request(zero)));
        var unknown = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        unknown.Import(0, [Invoice() with { Rows = [Invoice().Rows[0].Set("fpzt", "待核实")] }]);
        Error("invoice-status", () => unknown.CreateVoucherPlan(Request(unknown)));
    }

    [Fact]
    public void PlanDoesNotCommitAfterChangesAndCannotBeTamperedOrSentToAnotherBook()
    {
        var service = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        service.Import(0, [Invoice()]);
        var plan = service.CreateVoucherPlan(Request(service));
        var tampered = plan with { Vouchers = [plan.Vouchers[0] with { Lines = [new(Mapping.Receivable, "伪造", 1, 0)] }] };
        Error("plan-tampered", () => service.CommitVoucherPlanToSandbox(tampered));
        Error("book-mismatch", () => service.CommitVoucherPlanToSandbox(plan with { BookId = Guid.NewGuid() }));
        service.Save(1, null, Invoice("00000002"));
        Error("stale", () => service.CommitVoucherPlanToSandbox(plan));
        Assert.Empty(service.Read().Journals);
    }

    [Fact]
    public void ExistingVoucherNumberAndProcessedInvoiceCannotBeRegenerated()
    {
        var service = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        service.Import(0, [Invoice(), Invoice("00000002")]);
        var first = Request(service) with { SourceIds = [service.Read().Documents[0].Id] };
        service.CommitVoucherPlanToSandbox(service.CreateVoucherPlan(first));
        Error("processed", () => service.CreateVoucherPlan(first));
        var second = Request(service) with { SourceIds = [service.Read().Documents[1].Id] };
        Error("duplicate-voucher", () => service.CreateVoucherPlan(second));
        Assert.Single(service.CreateVoucherPlan(second with { FirstNumber = 2 }).Vouchers);
    }

    [Fact]
    public void CompareUsesLedgerSignsAndNeverClaimsMissingLedgerMatched()
    {
        var service = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        service.Import(0, [Invoice(), Invoice(direction: InvoiceDirection.Input)]);
        Assert.Null(service.CompareVat(2026, false, Mapping.OutputTax, Mapping.InputTax, null)[9].Matches);
        LedgerTaxLine[] ledger = [new(new(2026, 10, 1), Mapping.OutputTax, 2, 15), new(new(2026, 11, 1), Mapping.InputTax, 16, 2)];
        var q4 = service.CompareVat(2026, true, Mapping.OutputTax, Mapping.InputTax, ledger)[3];
        Assert.Equal(0, q4.OutputDifference);
        Assert.Equal(1, q4.InputDifference);
        Assert.False(q4.Matches);
    }

    [Fact]
    public void FailedCompareAndSwapPublishesNeitherJournalNorSourceFlags()
    {
        var backing = new MemoryInvoiceStore(Workspace());
        var service = new InvoiceService(backing);
        service.Import(0, [Invoice()]);
        var plan = service.CreateVoucherPlan(Request(service));
        var failing = new InvoiceService(new RejectingStore(backing));
        Error("stale", () => failing.CommitVoucherPlanToSandbox(plan));
        Assert.Empty(service.Read().Journals);
        Assert.True(service.Read().Documents[0].IsUnprocessed);
    }

    [Fact]
    public void ReviewedOrPostedSyntheticJournalCannotBeDeleted()
    {
        var backing = new MemoryInvoiceStore(Workspace());
        var service = new InvoiceService(backing);
        service.Import(0, [Invoice()]);
        var journal = Assert.Single(service.CommitVoucherPlanToSandbox(service.CreateVoucherPlan(Request(service))));
        Assert.True(backing.TrySave(2, service.Read() with { Revision = 3, Journals = [journal with { Reviewed = true }] }));
        Error("journal-reviewed", () => service.DeleteGeneratedVoucherFromSandbox(3, journal.Id));
        Assert.Single(service.Read().Journals);
        Assert.False(service.Read().Documents[0].IsUnprocessed);
    }

    [Fact]
    public void ScalarFieldsNullsExtensionsAndFullKnownSchemaSurviveJsonReadback()
    {
        var service = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        var row = Invoice().Rows[0];
        foreach (var name in InvoiceColumns.Output) if (!row.Fields.ContainsKey(name)) row = row.Set(name, null);
        service.Import(0, [new(InvoiceDirection.Output, InvoiceKind.Special, [row])]);
        var copy = InvoiceJson.Deserialize<InvoiceWorkspace>(InvoiceJson.Serialize(service.Read()));
        var restored = copy.Documents[0].Rows[0];
        Assert.Equal(row.Fields.Keys.Order(), restored.Fields.Keys.Order());
        foreach (var name in row.Fields.Keys) Assert.True(JsonElement.DeepEquals(row.Fields[name], restored.Fields[name]), name);
        Assert.Equal("保留未知字段", restored.Text("variant_extra"));
        Assert.Equal("2026-10-05T12:34:56", restored.Text("rq"));
    }

    [Fact]
    public void SyntheticFileStorePersistsTransactionAndEnforcesCasAcrossInstances()
    {
        var dir = Path.Combine(Path.GetTempPath(), "caiwu-invoice-test-" + Guid.NewGuid());
        Directory.CreateDirectory(dir);
        try
        {
            var path = Path.Combine(dir, "fixture.invoice-synthetic.json");
            var store = new SyntheticJsonInvoiceStore(path);
            store.Create(Workspace());
            Assert.Throws<IOException>(() => store.Create(Workspace()));
            var service = new InvoiceService(store);
            service.Import(0, [Invoice()]);
            service.CommitVoucherPlanToSandbox(service.CreateVoucherPlan(Request(service)));
            var reopened = new SyntheticJsonInvoiceStore(path);
            Assert.Single(reopened.Read().Journals);
            Assert.Equal("1", reopened.Read().Documents[0].Rows[0].Text("pz_bz"));
            Assert.False(reopened.TrySave(0, reopened.Read() with { Revision = 1 }));
            Error("synthetic-path", () => new SyntheticJsonInvoiceStore(Path.Combine(dir, "real.db")));
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void LegacyRowRejectsDuplicateKeysAndMalformedNumbersOrAmbiguousDates()
    {
        Error("duplicate-column", () => LegacyInvoiceRow.Parse("{\"fphm\":\"1\",\"fphm\":\"2\"}"));
        Error("duplicate-column", () => LegacyInvoiceRow.Parse("{\"fphm\":\"1\",\"FPHM\":\"2\"}"));
        Error("number", () => LegacyInvoiceRow.Parse("{\"je0\":\"1,000\"}").Number("je0"));
        Error("date", () => LegacyInvoiceRow.Parse("{\"rq\":\"10/05/2026\"}").Date("rq"));
    }

    [Fact]
    public void BatchEditIsAtomicAndTransferRequiresExactProductAndBook()
    {
        var service = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        service.Import(0, [Invoice(), Invoice("00000002")]);
        var docs = service.Read().Documents;
        var before = InvoiceJson.Serialize(service.Read());
        Error("duplicate-invoice", () => service.SaveMany(1, [new(docs[0].Id, Invoice("00000003")), new(docs[1].Id, Invoice("00000003"))]));
        Assert.Equal(before, InvoiceJson.Serialize(service.Read()));
        Error("transfer-identity", () => service.ImportTransfer(1, new(1, Guid.NewGuid(), InvoiceProduct.Qingsong, [Invoice("4")])));
        Error("transfer-identity", () => service.ImportTransfer(1, new(1, service.Read().BookId, InvoiceProduct.Chengben, [Invoice("4")])));
        Assert.Equal(before, InvoiceJson.Serialize(service.Read()));
    }

    [Fact]
    public void ReimportOfCurrentExportAfterGenerationSkipsDuplicate()
    {
        var service = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        service.Import(0, [Invoice()]);
        service.CommitVoucherPlanToSandbox(service.CreateVoucherPlan(Request(service)));
        var doc = service.Read().Documents[0];
        Assert.Equal(1, service.Import(2, [new(doc.Key.Direction, doc.Key.Kind, doc.Rows)]).Duplicates);
    }

    [Fact]
    public void MissingFaceTaxRemainsUnknownDuringComparison()
    {
        var service = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        var input = Invoice(direction: InvoiceDirection.Input);
        service.Import(0, [input with { Rows = [input.Rows[0].Set("se", null)] }]);
        var result = service.CompareVat(2026, false, Mapping.OutputTax, Mapping.InputTax, [])[9];
        Assert.Null(result.InputOnInvoice);
        Assert.Null(result.InputDifference);
        Assert.Null(result.Matches);
    }

    [Fact]
    public void RepeatedInputSummaryRowsAndOutputLineNumbersCannotInflateAmounts()
    {
        var service = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        var input = Invoice(direction: InvoiceDirection.Input);
        Error("input-row-count", () => service.Import(0, [input with { Rows = [input.Rows[0], input.Rows[0]] }]));
        var row = Invoice().Rows[0].Set("xh", 1);
        Error("line-sequence", () => service.Import(0, [new(InvoiceDirection.Output, InvoiceKind.Special, [row, row])]));
        Assert.Empty(service.Read().Documents);
    }

    [Fact]
    public void TransferCodecRejectsDuplicateKeysAtAnyDepth()
    {
        Error("duplicate-json-key", () => InvoiceJson.Deserialize<InvoiceTransfer>("{\"FormatVersion\":1,\"FormatVersion\":2}"));
        Error("duplicate-json-key", () => InvoiceJson.Deserialize<InvoiceTransfer>("{\"Invoices\":[{\"Rows\":[{\"Fields\":{\"fphm\":\"1\",\"fphm\":\"2\"}}]}]}"));
    }

    [Fact]
    public void RowDeletionKeepsOtherGoodsRowsAndBatchDeletionSkipsProtectedInvoices()
    {
        var service = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        var a = Invoice().Rows[0].Set("xh", 1);
        var b = Invoice(net: 200, tax: 26).Rows[0].Set("xh", 2);
        service.Import(0, [new(InvoiceDirection.Output, InvoiceKind.Special, [a, b]), Invoice("00000002")]);
        var id = service.Read().Documents[0].Id;
        service.DeleteRows(1, [new(id, 0)]);
        var remaining = service.Read().Documents.Single(x => x.Id == id);
        Assert.Equal(200, remaining.Net);
        Assert.Equal(2, Assert.Single(remaining.Rows).Number("xh"));
        service.SetReviewed(2, id, true);
        var result = service.DeleteBatch(3, service.Read().Documents.Select(x => x.Id).ToImmutableArray());
        Assert.Equal(1, result.DeletedInvoices);
        Assert.Equal(id, Assert.Single(result.Skipped).DocumentId);
        Assert.Equal(id, Assert.Single(service.Read().Documents).Id);
    }

    [Fact]
    public void OutputReviewCommandCannotRewriteInputCertificationMethod()
    {
        var service = new InvoiceService(new MemoryInvoiceStore(Workspace()));
        service.Import(0, [Invoice(direction: InvoiceDirection.Input)]);
        var doc = Assert.Single(service.Read().Documents);
        Error("input-review-semantics", () => service.SetReviewed(1, doc.Id, true));
        Assert.Equal("0", service.Read().Documents[0].Rows[0].Text("sh_bz"));
    }

    private sealed class RejectingStore(IInvoiceStore backing) : IInvoiceStore
    {
        public InvoiceWorkspace Read() => backing.Read();
        public bool TrySave(long expectedRevision, InvoiceWorkspace workspace) => false;
    }
}
