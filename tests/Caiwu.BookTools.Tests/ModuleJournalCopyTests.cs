using System.Security.Cryptography;
using Caiwu.BookTools;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Persistence.Sqlite;
using Xunit;

namespace Caiwu.BookTools.Tests;

public sealed class ModuleJournalCopyTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "caiwu-module-copy-" + Guid.NewGuid().ToString("N"));
    public ModuleJournalCopyTests() => Directory.CreateDirectory(directory);
    public void Dispose() => Directory.Delete(directory, true);
    private string PathFor(string name) => Path.Combine(directory, name + ".caiwu");
    private static LedgerMutationContext Context(LedgerService service)
    { var s = service.GetSnapshot(); return new(s.Book.Id, s.Revision); }
    private static VoucherProposal Proposal(LedgerMutationContext context, string key = "receipt:1") => new(Guid.NewGuid(),
        "cashier", [key], context, new(2026, 10, 25), "记", null, 0,
        [new("1001", "合成", 8.76m, 0), new("4001", "合成", 0, 8.76m)], []);

    private LedgerSnapshot Seed()
    {
        using var store = SqliteLedgerStore.Create(PathFor("source"),
            new(Guid.NewGuid(), "合成源", AccountingRegime.Enterprise, "synthetic", 2026, 1, 0, DateTimeOffset.UtcNow),
            [new("1001", "现金", null, BalanceDirection.Debit, true, 0, 0), new("4001", "资本", null, BalanceDirection.Credit, true, 0, 0)]);
        var service = new LedgerService(store);
        var json = "{ \"BookId\":\"" + store.Read().Book.Id + "\", \"ExpectedRevision\":1, \"future\":{\"quantity\":0.0000001}, \"unknown\":123456789012345678901234567890 }";
        service.SaveModuleDocuments(new("cashier", Context(service), [new("identity", new("identity", 7, json))]), "合成");
        service.AcceptVoucherProposal(Proposal(Context(service)), "合成");
        service.SaveAccount(new("2001", "应付", null, BalanceDirection.Credit, true, 0, 0), "合成", Context(service));
        return service.GetSnapshot();
    }

    [Fact]
    public void FullCopyPreservesOpaqueHistoryAndSourceClaimsWithoutReusingOldTokens()
    {
        var source = Seed(); var sourceHash = Hash(PathFor("source"));
        var tools = new BookCopyService();
        var plan = tools.Preview(source, new(PathFor("source"), PathFor("full"), "合成完整复制", BookCopyScope.FullLedger, "合成"));
        Assert.Equal(source.Revision + 1, plan.NewRevision);
        var result = tools.Execute(plan);
        Assert.Equal(plan.NewRevision, result.Revision);
        Assert.Equal(sourceHash, Hash(PathFor("source")));
        using var copy = SqliteLedgerStore.Open(result.DestinationPath); var service = new LedgerService(copy);
        var state = service.GetModuleSnapshot();
        Assert.NotEqual(source.Book.Id, state.Ledger.Book.Id);
        Assert.Equal(source.AuditEvents, state.Ledger.AuditEvents.Take(source.AuditEvents.Count));
        var oldReceipt = Assert.Single(state.ProposalReceipts);
        Assert.Equal(2, oldReceipt.Revision);
        Assert.True(oldReceipt.Revision < state.Ledger.Revision);
        var opaque = Assert.Single(Assert.Single(state.Modules).Documents).PayloadJson;
        Assert.Contains(source.Book.Id.ToString(), opaque);
        Assert.Contains("123456789012345678901234567890", opaque);
        Assert.Throws<StoreConcurrencyException>(() => service.AcceptVoucherProposal(Proposal(new(source.Book.Id, source.Revision), "receipt:2"), "合成"));
        Assert.Throws<StoreConcurrencyException>(() => service.AcceptVoucherProposal(Proposal(new(state.Ledger.Book.Id, oldReceipt.Revision), "receipt:2"), "合成"));
        Assert.Throws<LedgerValidationException>(() => service.AcceptVoucherProposal(Proposal(Context(service)), "合成"));
        service.AcceptVoucherProposal(Proposal(Context(service), "receipt:2"), "合成");
        Assert.Equal(plan.NewRevision + 1, service.GetModuleSnapshot().Ledger.Revision);
        Assert.Equal(2, service.GetModuleSnapshot().ProposalReceipts.Count);
    }

    [Fact]
    public void AccountsOnlyCopyExplicitlyExcludesEveryModuleDocumentReceiptAndVoucher()
    {
        var source = Seed(); var tools = new BookCopyService();
        var plan = tools.Preview(source, new(PathFor("source"), PathFor("partial"), "合成科目复制", BookCopyScope.AccountsAndOpeningBalances, "合成"));
        Assert.Contains(plan.Rules, r => r.Field == "Module journal" && r.Behavior.Contains("不包含模块文档", StringComparison.Ordinal));
        var result = tools.Execute(plan);
        using var copy = SqliteLedgerStore.Open(result.DestinationPath);
        var state = new LedgerService(copy).GetModuleSnapshot();
        Assert.Equal(1, state.Ledger.Revision);
        Assert.Empty(state.Modules); Assert.Empty(state.ProposalReceipts); Assert.Empty(state.Ledger.Vouchers);
        Assert.Equal("BookCopiedAsNew", Assert.Single(state.Ledger.AuditEvents).Action);
    }

    [Fact]
    public void OrdinaryCopyStillStartsAtOneAndDestinationCannotBeOverwritten()
    {
        using (var source = SqliteLedgerStore.Create(PathFor("source"),
            new(Guid.NewGuid(), "普通合成源", AccountingRegime.Enterprise, "synthetic", 2026, 1, 0, DateTimeOffset.UtcNow),
            [new("1001", "现金", null, BalanceDirection.Debit, true, 0, 0)])) { }
        LedgerSnapshot snapshot; using (var store = SqliteLedgerStore.Open(PathFor("source"))) snapshot = store.Read();
        var tools = new BookCopyService(); var plan = tools.Preview(snapshot,
            new(PathFor("source"), PathFor("ordinary"), "普通合成复制", BookCopyScope.FullLedger, "合成"));
        Assert.Equal(1, plan.NewRevision);
        _ = tools.Execute(plan); var hash = Hash(PathFor("ordinary"));
        Assert.Throws<IOException>(() => tools.Execute(plan));
        Assert.Equal(hash, Hash(PathFor("ordinary")));
    }

    [Fact]
    public void SnapshotCreationPublishesCompleteNonzeroRevisionButNeverOverwrites()
    {
        var source = Seed(); var target = source with { Book = source.Book with { Id = Guid.NewGuid() }, Revision = 10 };
        using (var store = SqliteLedgerStore.CreateFromSnapshot(PathFor("snapshot"), target))
            Assert.Equal(10, new LedgerService(store).GetModuleSnapshot().Ledger.Revision);
        var hash = Hash(PathFor("snapshot"));
        Assert.Throws<IOException>(() => SqliteLedgerStore.CreateFromSnapshot(PathFor("snapshot"), target));
        Assert.Equal(hash, Hash(PathFor("snapshot")));
    }

    [Fact]
    public void LegacyResetToOneWithReceiptAtTwoRemainsAnIntegrityError()
    {
        var source = Seed();
        using var oldCopy = SqliteLedgerStore.Create(PathFor("legacy-copy"), source.Book with { Id = Guid.NewGuid() }, source.Accounts);
        oldCopy.Write(source with { Book = oldCopy.Read().Book, Revision = 1 }, 0);
        Assert.Throws<LedgerValidationException>(() => new LedgerService(oldCopy).GetModuleSnapshot());
        // The actual BookCopy path above uses a new revision greater than all retained receipts;
        // the journal's integrity check itself has not been removed or relaxed.
    }

    private static string Hash(string path) => Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(path)));
}
