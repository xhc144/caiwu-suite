using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Costing.Adapters;
using Caiwu.Costing.Parity;

namespace Caiwu.Costing.Tests;

public sealed class ParityAdapterTests
{
    private sealed class Service : IParityLedgerService
    {
        public ModuleLedgerSnapshot Snapshot { get; set; }
        public int Saves { get; private set; }
        public int Proposals { get; private set; }
        public bool FailProposal { get; set; }
        public bool ThrowAfterCommit { get; set; }
        public VoucherProposal? LastProposal { get; private set; }
        public Service(InventoryBook book)
        {
            var accounts = new[] { "1405", "2202", "222101", "222102", "1122", "6001", "6401", "1901" }.Select(c => new Account(c, c, null, BalanceDirection.Debit, true, 0, 0)).ToArray();
            Snapshot = new(new(41, new(book.Id, "合成账套", AccountingRegime.Enterprise, "synthetic", 2026, 10, 9, DateTimeOffset.UnixEpoch), accounts, [], []),
                [new("inventory", [new($"inventory-book-{book.Id:N}", 1, JsonSerializer.Serialize(book)), new("unrelated-document", 9, "{\"preserved\":true}")]),
                 new("other-module", [new("other", 3, "{\"keep\":1}")])], []);
        }
        public ModuleLedgerSnapshot GetModuleSnapshot() => Snapshot;
        private void Check(LedgerMutationContext context)
        { if (context.ExpectedBookId != Snapshot.Ledger.Book.Id || context.ExpectedRevision != Snapshot.Ledger.Revision) throw new StoreConcurrencyException("stale global revision"); }
        private ModuleLedgerSnapshot Apply(IReadOnlyList<ModuleDocumentChange> changes)
        {
            var current = Snapshot.Modules.SingleOrDefault(m => m.ModuleId == "inventory") ?? new ModuleDocumentCollection("inventory", []);
            var updated = current.Documents.Where(d => !changes.Any(c => c.DocumentId == d.DocumentId)).Concat(changes.Where(c => c.Document is not null).Select(c => c.Document!)).ToArray();
            return Snapshot with { Ledger = Snapshot.Ledger with { Revision = Snapshot.Ledger.Revision + 1 }, Modules = Snapshot.Modules.Where(m => m.ModuleId != "inventory").Append(current with { Documents = updated }).ToArray() };
        }
        public void SaveModuleDocuments(ModuleDocumentBatch batch, string actor)
        { Saves++; Check(batch.Context); Snapshot = Apply(batch.Changes); }
        public ModuleVoucherReceipt AcceptVoucherProposal(VoucherProposal proposal, string actor)
        {
            Proposals++; Check(proposal.Context); LastProposal = proposal;
            if (FailProposal) throw new LedgerValidationException("synthetic storage rejection before commit");
            var next = Apply(proposal.Changes);
            var receipt = new ModuleVoucherReceipt(proposal.ProposalId, proposal.ModuleId, proposal.SourceKeys, Guid.NewGuid(), next.Ledger.Revision);
            Snapshot = next with { ProposalReceipts = [.. next.ProposalReceipts, receipt] };
            if (ThrowAfterCommit) throw new IOException("synthetic uncertain delivery after atomic commit");
            return receipt;
        }
    }
    private static string WithoutClaims(string json)
    { var node = System.Text.Json.Nodes.JsonNode.Parse(json)!; node.AsObject().Remove("VoucherClaims"); return node.ToJsonString(); }
    private static InventoryBook Book()
    {
        var b = InventoryWorkflow.Create(Guid.NewGuid(), new(2026, 10), new(4, 6), [new("01", "仓库", WarehouseKind.Warehouse)]);
        var accounts = new[] { "1405", "2202", "222101", "222102", "1122", "6001", "6401", "1901" }.Select(c => new InventoryAccount(c, true, true)).ToArray();
        b = InventoryWorkflow.SaveProduct(b, new("P", "合成商品", "", "件", "1405", null, 0, 0, 0, []), accounts, "操作员", b.Revision);
        var d = new InventoryDocument(Guid.NewGuid(), "R1", "采购", InventoryDocumentKind.Receipt, new(2026, 10, 1), "01", "操作员", "合成", "合成", 13, "2202", "6401", null, false,
            [new(1, "P", 10, 10, 11.3m, 100, 13, 113, "", [])], [], []);
        return InventoryWorkflow.SaveDocument(b, d, accounts, "操作员", b.Revision);
    }
    private static InventoryVoucherPlan Plan(InventoryBook b, Service service) => InventoryVoucherPlanner.Plan(b, InventoryVoucherKind.Receipt,
        new(2026, 10, 1), new(2026, 10, 31), new("222101", "222102", "6001", "1901"), ParityInventoryAdapter.AccountCatalog(service.Snapshot));

    [Fact]
    public void SaveUsesObservedGlobalRevisionAndPreservesOtherModuleDocuments()
    {
        var b = Book(); var service = new Service(b); var adapter = new ParityInventoryAdapter(service, service.Snapshot, "操作员");
        var next = InventoryWorkflow.SaveOpening(adapter.Load(b.Id), new("01", "P", 1, 10, []), "操作员", b.Revision);
        Assert.True(adapter.TryCommit(b.Revision, next)); Assert.Equal(42, service.Snapshot.Ledger.Revision);
        var reopened = new ParityInventoryAdapter(service, service.Snapshot, "操作员").Load(b.Id);
        Assert.Equal(1, reopened.Openings.Single().Quantity);
        Assert.Equal("{\"preserved\":true}", service.Snapshot.Modules.Single(m => m.ModuleId == "inventory").Documents.Single(d => d.DocumentId == "unrelated-document").PayloadJson);
        Assert.Equal("{\"keep\":1}", service.Snapshot.Modules.Single(m => m.ModuleId == "other-module").Documents.Single().PayloadJson);
        Assert.Throws<CostingConcurrencyException>(() => adapter.Load(b.Id));
    }
    [Fact]
    public void OtherModuleWriteInvalidatesInventoryDecisionWithoutRefreshingToken()
    {
        var b = Book(); var service = new Service(b); var observed = service.Snapshot; var adapter = new ParityInventoryAdapter(service, observed, "操作员");
        service.Snapshot = service.Snapshot with { Ledger = service.Snapshot.Ledger with { Revision = 42 } };
        var next = InventoryWorkflow.SaveOpening(b, new("01", "P", 1, 10, []), "操作员", b.Revision);
        Assert.False(adapter.TryCommit(b.Revision, next)); Assert.Equal(1, service.Saves);
        Assert.Empty(new ParityInventoryAdapter(service, service.Snapshot, "操作员").Load(b.Id).Openings);
    }
    [Fact]
    public void DraftProposalAndSourceClaimAreSubmittedInOneCallAndResolveThroughReceipt()
    {
        var b = Book(); var service = new Service(b); var plan = Plan(b, service); var adapter = new ParityInventoryAdapter(service, service.Snapshot, "操作员");
        var proposalId = Guid.NewGuid(); var receipt = adapter.AcceptPlan(plan, plan.Vouchers.Single().SourceKey, proposalId, "记", null, 0);
        Assert.Equal(0, service.Saves); Assert.Equal(1, service.Proposals); Assert.Equal(41, service.LastProposal!.Context.ExpectedRevision);
        Assert.Equal(proposalId, receipt.ProposalId); Assert.NotEqual(Guid.Empty, receipt.VoucherId);
        Assert.Equal(113, service.LastProposal.Lines.Sum(l => l.Debit)); Assert.Equal(113, service.LastProposal.Lines.Sum(l => l.Credit));
        var next = new ParityInventoryAdapter(service, service.Snapshot, "操作员").Load(b.Id);
        Assert.Equal(proposalId, next.VoucherClaims.Single().ProposalId);
        Assert.Equal($"proposal:{proposalId:D}", next.Documents.Single().VoucherLinks.Single().VoucherIdentity);
    }
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void FailedOrUncertainProposalDoesNotRetryOrLocallyClaimSuccess(bool afterCommit)
    {
        var b = Book(); var service = new Service(b) { FailProposal = !afterCommit, ThrowAfterCommit = afterCommit }; var plan = Plan(b, service);
        var adapter = new ParityInventoryAdapter(service, service.Snapshot, "操作员");
        Assert.ThrowsAny<Exception>(() => adapter.AcceptPlan(plan, plan.Vouchers.Single().SourceKey, Guid.NewGuid(), "记", null, 0));
        Assert.Throws<CostingConcurrencyException>(() => adapter.AcceptPlan(plan, plan.Vouchers.Single().SourceKey, Guid.NewGuid(), "记", null, 0));
        Assert.Equal(1, service.Proposals);
        var reopened = new ParityInventoryAdapter(service, service.Snapshot, "操作员").Load(b.Id);
        Assert.Equal(afterCommit ? 1 : 0, reopened.VoucherClaims.Count); // reconcile actual receipt, never infer timeout outcome
    }
    [Fact]
    public void UnknownSchemaUnknownJsonAndDuplicateKeysCannotBeRewritten()
    {
        foreach (var mode in new[] { "version", "unknown", "duplicate", "missing", "nullrow" })
        {
            var b = Book(); var service = new Service(b); var module = service.Snapshot.Modules[0]; var doc = module.Documents[0];
            var changed = mode switch
            {
                "version" => doc with { SchemaVersion = 2 },
                "unknown" => doc with { PayloadJson = doc.PayloadJson.Insert(1, "\"UnknownOriginalField\":1,") },
                "missing" => doc with { PayloadJson = WithoutClaims(doc.PayloadJson) },
                "nullrow" => doc with { PayloadJson = doc.PayloadJson.Replace("\"Products\":[", "\"Products\":[null,") },
                _ => doc with { PayloadJson = doc.PayloadJson.Insert(1, "\"Revision\":999,") }
            };
            service.Snapshot = service.Snapshot with { Modules = [module with { Documents = [changed] }] };
            var adapter = new ParityInventoryAdapter(service, service.Snapshot, "操作员");
            Assert.Throws<CostingValidationException>(() => adapter.Load(b.Id)); Assert.Equal(0, service.Saves);
        }
    }
    [Fact]
    public void OriginalVariantDataStaysStoredButCannotBeFlattenedIntoSimpleGlLines()
    {
        var b = Book(); var row = new OriginalRow("pjnr2", "source1", "variant", new Dictionary<string, OriginalCell> { ["xmbm"] = new("char(10)", "项目甲  ") });
        b = b with { Documents = [b.Documents[0] with { OriginalRows = [row] }] };
        var service = new Service(b); var plan = Plan(b, service); var adapter = new ParityInventoryAdapter(service, service.Snapshot, "操作员");
        Assert.Throws<CostingValidationException>(() => adapter.AcceptPlan(plan, plan.Vouchers.Single().SourceKey, Guid.NewGuid(), "记", null, 0));
        Assert.Equal(0, service.Proposals); Assert.Equal("项目甲  ", adapter.Load(b.Id).Documents.Single().OriginalRows.Single().Cells["xmbm"].Value);
    }
    [Fact]
    public void ExistingReceiptPreventsRandomProposalReplayEvenIfLocalClaimIsMissing()
    {
        var b = Book(); var service = new Service(b); var plan = Plan(b, service);
        service.Snapshot = service.Snapshot with { ProposalReceipts = [new(Guid.NewGuid(), "inventory", [plan.Vouchers.Single().SourceKey], Guid.NewGuid(), 41)] };
        var adapter = new ParityInventoryAdapter(service, service.Snapshot, "操作员");
        Assert.Throws<CostingValidationException>(() => adapter.AcceptPlan(plan, plan.Vouchers.Single().SourceKey, Guid.NewGuid(), "记", null, 0));
        Assert.Equal(0, service.Proposals);
    }
    [Fact]
    public void InitializationIsExplicitAndCannotOverwriteExistingModuleOrDifferentLedger()
    {
        var b = Book(); var service = new Service(b);
        var existing = new ParityInventoryAdapter(service, service.Snapshot, "操作员");
        Assert.Throws<CostingValidationException>(() => existing.Initialize(b)); Assert.Equal(0, service.Saves);
        Assert.Throws<CostingValidationException>(() => existing.Load(Guid.NewGuid()));
        service.Snapshot = service.Snapshot with { Modules = [service.Snapshot.Modules.Single(m => m.ModuleId == "other-module")] };
        var fresh = new ParityInventoryAdapter(service, service.Snapshot, "操作员");
        Assert.Throws<CostingValidationException>(() => fresh.Load(b.Id));
        fresh.Initialize(b); Assert.Equal(1, service.Saves);
        Assert.Equal(2, service.Snapshot.Modules.Count);
        Assert.Equal(b.Documents.Single().Number, new ParityInventoryAdapter(service, service.Snapshot, "操作员").Load(b.Id).Documents.Single().Number);
    }

    [Theory]
    [InlineData(2025, 10, 9)]
    [InlineData(2026, 9, 9)]
    [InlineData(2026, 10, 10)]
    public void InitializeCannotSaveOtherYearBeforeStartOrClosedInventory(int year, int month, int closedThrough)
    {
        var b = InventoryWorkflow.Create(Guid.NewGuid(), new(year, month), new(4, 6), [new("01", "仓库", WarehouseKind.Warehouse)]);
        var service = new Service(b);
        service.Snapshot = service.Snapshot with
        {
            Ledger = service.Snapshot.Ledger with { Book = service.Snapshot.Ledger.Book with { ClosedThroughMonth = closedThrough } },
            Modules = []
        };
        var adapter = new ParityInventoryAdapter(service, service.Snapshot, "操作员");
        Assert.Throws<CostingValidationException>(() => adapter.Initialize(b));
        Assert.Equal(0, service.Saves); Assert.Equal(0, service.Proposals); Assert.Equal(41, service.Snapshot.Ledger.Revision);
    }
    [Theory]
    [InlineData(2025, 10)]
    [InlineData(2026, 9)]
    public void LoadRejectsModulePeriodOutsideObservedLedgerYearOrEnabledMonths(int year, int month)
    {
        var b = InventoryWorkflow.Create(Guid.NewGuid(), new(year, month), new(4, 6), [new("01", "仓库", WarehouseKind.Warehouse)]);
        var service = new Service(b);
        service.Snapshot = service.Snapshot with { Ledger = service.Snapshot.Ledger with { Book = service.Snapshot.Ledger.Book with { ClosedThroughMonth = 9 } } };
        Assert.Throws<CostingValidationException>(() => new ParityInventoryAdapter(service, service.Snapshot, "操作员").Load(b.Id));
        Assert.Equal(0, service.Saves);
    }
    [Theory]
    [InlineData(2025, 10)]
    [InlineData(2026, 9)]
    [InlineData(2026, 11)]
    public void TryCommitCannotReplaceExistingMonthWithAnotherPeriod(int year, int month)
    {
        var b = InventoryWorkflow.Create(Guid.NewGuid(), new(2026, 10), new(4, 6), [new("01", "仓库", WarehouseKind.Warehouse)]);
        var service = new Service(b);
        service.Snapshot = service.Snapshot with { Ledger = service.Snapshot.Ledger with { Book = service.Snapshot.Ledger.Book with { ClosedThroughMonth = 9 } } };
        var next = b with { Period = new(year, month), Revision = b.Revision + 1 };
        Assert.Throws<CostingValidationException>(() => new ParityInventoryAdapter(service, service.Snapshot, "操作员").TryCommit(b.Revision, next));
        Assert.Equal(0, service.Saves); Assert.Equal(41, service.Snapshot.Ledger.Revision);
    }
    [Fact]
    public void ClosedMonthCanBeReadButCannotBeMutatedOrSubmittedAsVoucher()
    {
        var b = Book(); var service = new Service(b); var plan = Plan(b, service);
        service.Snapshot = service.Snapshot with { Ledger = service.Snapshot.Ledger with { Book = service.Snapshot.Ledger.Book with { ClosedThroughMonth = 10 } } };
        var adapter = new ParityInventoryAdapter(service, service.Snapshot, "操作员");
        var loaded = adapter.Load(b.Id); Assert.Equal(new(2026, 10), loaded.Period);
        var next = InventoryWorkflow.SaveOpening(loaded, new("01", "P", 1, 10, []), "操作员", loaded.Revision);
        Assert.Throws<CostingValidationException>(() => adapter.TryCommit(loaded.Revision, next));
        Assert.Throws<CostingValidationException>(() => adapter.AcceptPlan(plan, plan.Vouchers[0].SourceKey, Guid.NewGuid(), "记", null, 0));
        Assert.Equal(0, service.Saves); Assert.Equal(0, service.Proposals);
    }

    [Theory]
    [InlineData(0, 10, 9)]
    [InlineData(2026, 0, 0)]
    [InlineData(2026, 13, 12)]
    [InlineData(2026, 10, 8)]
    [InlineData(2026, 10, 13)]
    public void ReadyRejectsInvalidObservedLedgerPeriodMetadata(int year, int start, int closed)
    {
        var b = Book(); var service = new Service(b);
        service.Snapshot = service.Snapshot with { Ledger = service.Snapshot.Ledger with { Book = service.Snapshot.Ledger.Book with
            { FiscalYear = year, StartMonth = start, ClosedThroughMonth = closed } } };
        Assert.Throws<CostingValidationException>(() => new ParityInventoryAdapter(service, service.Snapshot, "操作员").Load(b.Id));
        Assert.Equal(0, service.Saves); Assert.Equal(0, service.Proposals);
    }
    [Theory]
    [InlineData(10, 9)]
    [InlineData(11, 9)]
    [InlineData(12, 11)]
    public void InitializeAllowsEnabledUnclosedMonthInObservedLedgerYear(int month, int closed)
    {
        var b = InventoryWorkflow.Create(Guid.NewGuid(), new(2026, month), new(4, 6), [new("01", "仓库", WarehouseKind.Warehouse)]);
        var service = new Service(b);
        service.Snapshot = service.Snapshot with { Ledger = service.Snapshot.Ledger with { Book = service.Snapshot.Ledger.Book with
            { ClosedThroughMonth = closed } }, Modules = [] };
        new ParityInventoryAdapter(service, service.Snapshot, "操作员").Initialize(b);
        Assert.Equal(1, service.Saves);
        Assert.Equal(b.Period, new ParityInventoryAdapter(service, service.Snapshot, "操作员").Load(b.Id).Period);
    }
    [Fact]
    public void AcceptedReceiptCannotDriftInventoryAccountBeforeIssueVoucher()
    {
        var b = Book(); var service = new Service(b); var receiptPlan = Plan(b, service);
        var adapter = new ParityInventoryAdapter(service, service.Snapshot, "操作员");
        adapter.AcceptPlan(receiptPlan, receiptPlan.Vouchers[0].SourceKey, Guid.NewGuid(), "记", null, 0);
        var receipt = service.LastProposal!;
        var store = new ParityInventoryAdapter(service, service.Snapshot, "操作员");
        var loaded = store.Load(b.Id);
        Assert.Throws<CostingValidationException>(() => store.TryCommit(loaded.Revision,
            loaded with { Revision = loaded.Revision + 1, Products = [loaded.Products[0] with { InventoryAccount = "1406" }] }));
        Assert.Equal(0, service.Saves);
        var accounts = ParityInventoryAdapter.AccountCatalog(service.Snapshot).Append(new("1406", true, true)).ToArray();
        Assert.Throws<CostingValidationException>(() => InventoryWorkflow.SaveProduct(loaded,
            loaded.Products[0] with { InventoryAccount = "1406" }, accounts, "操作员", loaded.Revision));
        var sale = loaded.Documents[0] with { Id = Guid.NewGuid(), Number = "S1", OriginalCategory = "销售",
            Kind = InventoryDocumentKind.Sale, SettlementAccount = "1122", VoucherLinks = [] };
        var issued = InventoryWorkflow.SaveDocument(loaded, sale, accounts, "操作员", loaded.Revision);
        issued = InventoryWorkflow.Calculate(issued, false, "操作员", issued.Revision);
        var costPlan = InventoryVoucherPlanner.Plan(issued, InventoryVoucherKind.IssueCost, new(2026, 10, 1), new(2026, 10, 31),
            new("222101", "222102", "6001", "1901"), accounts);
        Assert.Equal(100, receipt.Lines.Single(l => l.AccountCode == "1405").Debit);
        Assert.Equal(100, costPlan.Vouchers[0].Lines.Single(l => l.AccountCode == "1405").Credit);
        Assert.DoesNotContain(costPlan.Vouchers[0].Lines, l => l.AccountCode == "1406");
    }

    [Fact]
    public void CancellingUnclaimedCalculationCannotRewriteClosedLedgerMonth()
    {
        var b = Book(); b = InventoryWorkflow.Calculate(b, false, "核算员", b.Revision);
        Assert.Empty(b.VoucherClaims);
        var service = new Service(b);
        service.Snapshot = service.Snapshot with { Ledger = service.Snapshot.Ledger with { Book = service.Snapshot.Ledger.Book with { ClosedThroughMonth = 10 } } };
        var adapter = new ParityInventoryAdapter(service, service.Snapshot, "操作员");
        var loaded = adapter.Load(b.Id);
        var cancelled = InventoryWorkflow.CancelCalculation(loaded, "操作员", loaded.Revision);
        Assert.Throws<CostingValidationException>(() => adapter.TryCommit(loaded.Revision, cancelled));
        Assert.Equal(0, service.Saves); Assert.Equal(41, service.Snapshot.Ledger.Revision);
        var reopened = new ParityInventoryAdapter(service, service.Snapshot, "操作员").Load(b.Id);
        Assert.NotNull(reopened.Calculation); Assert.Equal(b.Revision, reopened.Revision);
    }

}
