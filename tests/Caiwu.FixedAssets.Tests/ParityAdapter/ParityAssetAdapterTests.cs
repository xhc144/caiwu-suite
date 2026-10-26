using Caiwu.Contracts;
using Caiwu.FixedAssets.ParityAdapter;

namespace Caiwu.FixedAssets.Tests;

// Contract-fake tests only; not evidence that integration/Core/SQLite has been wired.
public sealed class ParityAssetAdapterTests
{
    private static readonly Guid HostId = Guid.Parse("8423aeab-5419-4d8d-8f8a-6a73446aaf73");
    private static readonly AssetBookIdentity Identity = new("chengben", "SYNTHETIC-ADAPTER-BOOK", "synthetic", "v1");
    private static AssetBookState Initial => new() { Identity = Identity, Settings = new(new(2026, 1), new()
    { Categories = [new("01", "合成设备", 0, "1601")], Purposes = [new("01", "合成用途", "6602")],
      Statuses = [new("01", "使用中", true)], Departments = [new("01", "合成部门")], DisposalReasons = [new("01", "合成报废")] }, "1602", "1606") };
    private static AssetCard Card => new() { Code = "A1", Name = "合成资产", CategoryCode = "01", PurposeCode = "01", StatusCode = "01", DepartmentCode = "01",
        PurchaseDate = new(2026, 1, 1), UseDate = new(2026, 1, 1), OriginalCost = 1200, UsefulLifeMonths = 12 };

    [Fact]
    public void StoreUsesOneWholeBookSnapshotAndPreservesSiblingDocuments()
    {
        var fake = new LedgerFake(); var adapter = new ParityAssetBookStore(fake, HostId, Initial, "合成操作员");
        var service = new AssetBookService(adapter, Identity); service.AddCard(7, Card, new(2026, 1, 1));
        Assert.Equal(1, fake.Reads); Assert.Equal(1, fake.Saves); Assert.Equal(new(HostId, 7), fake.LastBatch!.Context);
        Assert.Equal("assets", fake.LastBatch.ModuleId); Assert.Single(fake.LastBatch.Changes);
        Assert.Equal("{\"opaque\":1.234567890123456789}", fake.Snapshot.Modules.Single(x => x.ModuleId == "other").Documents[0].PayloadJson);
        Assert.Equal("{\"keep\":true}", fake.Snapshot.Modules.Single(x => x.ModuleId == "assets").Documents.Single(x => x.DocumentId == "unrelated").PayloadJson);
        var saved = service.Read(); Assert.Equal(8, saved.Revision); Assert.Single(saved.Cards);
        Assert.Contains(saved.Settings.Catalog.Accounts, x => x.Code == "1601" && x.IsLeaf && x.IsActive);
        Assert.Contains(saved.Settings.Catalog.Accounts, x => x.Code == "16" && !x.IsLeaf);
    }

    [Fact]
    public void UnrelatedRevisionInvalidatesOpenAssetDecision_NoRefreshRetry()
    {
        var fake = new LedgerFake(); var adapter = new ParityAssetBookStore(fake, HostId, Initial, "合成操作员");
        var service = new AssetBookService(adapter, Identity); var seen = service.Read();
        fake.Snapshot = fake.Snapshot with { Ledger = fake.Snapshot.Ledger with { Revision = 8 } };
        var ex = Assert.Throws<AssetRuleException>(() => service.AddCard(seen.Revision, Card, new(2026, 1, 1)));
        Assert.Equal("stale-revision", ex.Code); Assert.Equal(0, fake.Saves);
    }

    [Fact]
    public void RaceAtCommitPropagatesConflictWithoutRetryOrClaim()
    {
        var fake = new LedgerFake { FailSave = true }; var adapter = new ParityAssetBookStore(fake, HostId, Initial, "合成操作员");
        var service = new AssetBookService(adapter, Identity);
        var ex = Assert.Throws<AssetRuleException>(() => service.AddCard(7, Card, new(2026, 1, 1)));
        Assert.Equal("stale-revision", ex.Code); Assert.Equal(1, fake.Reads); Assert.Equal(1, fake.Saves);
        Assert.Equal(7, fake.Snapshot.Ledger.Revision); Assert.Equal(0, fake.Accepts);
    }

    [Fact]
    public void ClosedPeriodAndChangedBookAreRejected()
    {
        var fake = new LedgerFake(); fake.Snapshot = fake.Snapshot with { Ledger = fake.Snapshot.Ledger with { Book = fake.Snapshot.Ledger.Book with { ClosedThroughMonth = 1 } } };
        var adapter = new ParityAssetBookStore(fake, HostId, Initial, "合成操作员"); var service = new AssetBookService(adapter, Identity);
        Assert.Equal("closed-period", Assert.Throws<AssetRuleException>(() => service.AddCard(7, Card, new(2026, 1, 1))).Code);
        fake.Snapshot = fake.Snapshot with { Ledger = fake.Snapshot.Ledger with { Book = fake.Snapshot.Ledger.Book with { Id = Guid.NewGuid() } } };
        Assert.Equal("book-mismatch", Assert.Throws<AssetRuleException>(() => service.Read()).Code);
    }

    [Fact]
    public void FutureSchemaCannotBeDownconverted()
    {
        var fake = new LedgerFake(); fake.Put(new("assets-book-v1", 2, "{\"future\":true}"));
        var adapter = new ParityAssetBookStore(fake, HostId, Initial, "合成操作员");
        Assert.Equal("module-schema", Assert.Throws<AssetRuleException>(() => adapter.Load()).Code); Assert.Equal(0, fake.Saves);
    }

    [Fact]
    public void DimensionedPlanIsNotConvertedToLossyFourFieldVoucher()
    {
        var fake = new LedgerFake(); var adapter = new ParityAssetBookStore(fake, HostId, Initial, "合成操作员"); var service = new AssetBookService(adapter, Identity);
        service.AddCard(7, Card, new(2026, 1, 1)); service.CalculateDepreciation(8, new(2026, 1));
        var batch = service.CalculateDepreciation(9, new(2026, 2));
        var plan = service.CreateVoucherPlan(10, AssetVoucherKind.Depreciation, batch.Id, new(2026, 2, 28), "记", 1);
        _ = adapter.Load();
        var ex = Assert.Throws<AssetRuleException>(() => adapter.PrepareVoucherProposal(plan));
        Assert.Equal("rich-voucher-contract-required", ex.Code); Assert.Equal(0, fake.Accepts);
        var state = service.Read(); Assert.Equal("01", state.VoucherPlans.Single().Lines[0].DepartmentCode);
    }

    [Fact]
    public void AcceptedReceiptPreventsPlanVoidingAfterReopen()
    {
        var fake = new LedgerFake(); var adapter = new ParityAssetBookStore(fake, HostId, Initial, "合成操作员"); var service = new AssetBookService(adapter, Identity);
        service.AddCard(7, Card, new(2026, 1, 1)); service.CalculateDepreciation(8, new(2026, 1)); var batch = service.CalculateDepreciation(9, new(2026, 2));
        var plan = service.CreateVoucherPlan(10, AssetVoucherKind.Depreciation, batch.Id, new(2026, 2, 28), "记", 1);
        fake.Snapshot = fake.Snapshot with { ProposalReceipts = [new(plan.Id, "assets", [plan.SourceKey], Guid.NewGuid(), 12)], Ledger = fake.Snapshot.Ledger with { Revision = 12 } };
        Assert.Equal("voucher-accepted", Assert.Throws<AssetRuleException>(() => service.VoidVoucherPlan(12, plan.Id)).Code);
        Assert.Equal(0, fake.Accepts);
    }


    [Fact]
    public void LedgerCloseOverlayDoesNotBecomePermanentModuleLockAfterLedgerReopens()
    {
        var fake = new LedgerFake(); fake.Snapshot = fake.Snapshot with { Ledger = fake.Snapshot.Ledger with
            { Book = fake.Snapshot.Ledger.Book with { ClosedThroughMonth = 1 } } };
        var adapter = new ParityAssetBookStore(fake, HostId, Initial, "合成操作员"); var service = new AssetBookService(adapter, Identity);
        service.AddCard(7, Card with { PurchaseDate = new(2026, 2, 1), UseDate = new(2026, 2, 1) }, new(2026, 2, 1));
        var persisted = AssetModuleDocumentCodec.Deserialize(fake.Snapshot.Modules.Single(x => x.ModuleId == "assets").Documents.Single(x => x.DocumentId == "assets-book-v1").PayloadJson);
        Assert.Null(persisted.ClosedThrough);
        fake.Snapshot = fake.Snapshot with { Ledger = fake.Snapshot.Ledger with { Revision = 9, Book = fake.Snapshot.Ledger.Book with { ClosedThroughMonth = 0 } } };
        Assert.Null(service.Read().ClosedThrough);
    }

    [Fact]
    public void CorruptModuleJsonIsReportedBeforeSave()
    {
        var fake = new LedgerFake(); fake.Put(new("assets-book-v1", 1, "{broken"));
        var adapter = new ParityAssetBookStore(fake, HostId, Initial, "合成操作员");
        Assert.Equal("module-data", Assert.Throws<AssetRuleException>(() => adapter.Load()).Code);
        Assert.Equal(0, fake.Saves);
    }

    private sealed class LedgerFake : IParityLedgerService
    {
        public ModuleLedgerSnapshot Snapshot { get; set; } = new(new(7, new(HostId, "合成账套", AccountingRegime.Enterprise, "synthetic", 2026, 1, 0, DateTimeOffset.UnixEpoch),
            [new("16", "合成父科目", null, BalanceDirection.Debit, true, 0, 0), new("1601", "合成资产", "16", BalanceDirection.Debit, true, 0, 0),
             new("1602", "合成折旧", "16", BalanceDirection.Credit, true, 0, 0), new("6602", "合成费用", null, BalanceDirection.Debit, true, 0, 0)], [], []),
            [new("other", [new("opaque", 3, "{\"opaque\":1.234567890123456789}")]), new("assets", [new("unrelated", 3, "{\"keep\":true}")])], []);
        public int Reads { get; private set; }
        public int Saves { get; private set; }
        public int Accepts { get; private set; }
        public bool FailSave { get; init; }
        public ModuleDocumentBatch? LastBatch { get; private set; }
        public ModuleLedgerSnapshot GetModuleSnapshot() { Reads++; return Snapshot; }
        public void Put(LedgerModuleDocument document)
        {
            Snapshot = Snapshot with { Modules = Snapshot.Modules.Where(x => x.ModuleId != "assets").Append(new ModuleDocumentCollection("assets", [document])).ToArray() };
        }
        public void SaveModuleDocuments(ModuleDocumentBatch batch, string operatorName)
        {
            Saves++; LastBatch = batch;
            if (FailSave || batch.Context.ExpectedBookId != Snapshot.Ledger.Book.Id || batch.Context.ExpectedRevision != Snapshot.Ledger.Revision)
                throw new StoreConcurrencyException("合成并发冲突");
            var docs = Snapshot.Modules.Single(x => x.ModuleId == batch.ModuleId).Documents.ToDictionary(x => x.DocumentId);
            foreach (var change in batch.Changes) { if (change.Document is null) docs.Remove(change.DocumentId); else docs[change.DocumentId] = change.Document; }
            Snapshot = Snapshot with { Ledger = Snapshot.Ledger with { Revision = Snapshot.Ledger.Revision + 1 },
                Modules = Snapshot.Modules.Where(x => x.ModuleId != batch.ModuleId).Append(new ModuleDocumentCollection(batch.ModuleId, docs.Values.ToArray())).ToArray() };
        }
        public ModuleVoucherReceipt AcceptVoucherProposal(VoucherProposal proposal, string operatorName)
        { Accepts++; throw new InvalidOperationException("This contract fake does not claim ledger integration."); }
    }
}
