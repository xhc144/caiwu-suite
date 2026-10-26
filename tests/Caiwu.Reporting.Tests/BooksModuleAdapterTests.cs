#if CAIWU_PARITY_MODULES_V1
using Caiwu.Contracts;
using Caiwu.Reporting.Books;

namespace Caiwu.Reporting.Tests;

public sealed class BooksModuleAdapterTests
{
    private static (ModuleLedgerSnapshot Snapshot, BooksProjectionOptions Options) Fixture()
    {
        var book = new BookInfo(Guid.NewGuid(), "同版本合成模块账簿", AccountingRegime.Enterprise, "synthetic", 2026, 1, 0, DateTimeOffset.UtcNow);
        var id = Guid.NewGuid();
        var ledger = new LedgerSnapshot(8, book, [new("A", "银行", null, BalanceDirection.Debit, true, 0, 0), new("Z", "权益", null, BalanceDirection.Credit, true, 0, 0)],
            [new(id, new(2026, 1, 1), "记", 1, 0, "制单", "审核", VoucherStatus.Posted, [new("A", "摘要", 5, 0), new("Z", "摘要", 0, 5)])], []);
        const string raw = "{ \"unknown_original_column\":9007199254740993, \"辅助\":{\"项目\":\"P01\"}, \"外币\":\"1.234500\" }";
        var snapshot = new ModuleLedgerSnapshot(ledger, [new("compat", [new("source-raw", 7, raw)])], []);
        var options = new BooksProjectionOptions(book.Id, 8, new Dictionary<string, JournalAccountKind> { ["A"] = JournalAccountKind.Bank },
            new Dictionary<string, (decimal, decimal)>(), [new(id, 1, "A", "摘要", 5, 0, "转账", "0001", "002", "原键")], "人民币");
        return (snapshot, options);
    }

    [Fact]
    public void ProjectionRetainsExactUnknownJsonAndEnrichesOnlyMatchingLedgerLine()
    {
        var (snapshot, options) = Fixture();
        var projection = BooksModuleAdapter.FromSnapshot(snapshot, options);
        Assert.Equal(snapshot.Modules[0].Documents[0].PayloadJson, projection.RetainedDocuments[0].PayloadJson);
        Assert.Equal(7, projection.RetainedDocuments[0].SchemaVersion);
        var result = BooksReportBuilder.Build(projection.Input, new(BooksKind.BankJournal, "A", "A", 1, 1));
        var entry = Assert.Single(result.Accounts[0].Rows, r => r.Kind == BooksRowKind.Entry);
        Assert.Equal(("转账", "0001", "002", "原键"), (entry.SettlementType, entry.CheckNumber, entry.BillNumber, entry.SourceKey));
        Assert.Equal(8, result.Revision);
    }

    [Fact]
    public void ForeignRevisionBookAndChangedOrMissingLineAnnotationsAreRejected()
    {
        var (snapshot, options) = Fixture();
        Assert.Throws<ArgumentException>(() => BooksModuleAdapter.FromSnapshot(snapshot, options with { ExpectedRevision = 7 }));
        Assert.Throws<ArgumentException>(() => BooksModuleAdapter.FromSnapshot(snapshot, options with { ExpectedBookId = Guid.NewGuid() }));
        Assert.Throws<ArgumentException>(() => BooksModuleAdapter.FromSnapshot(snapshot, options with {
            LineAnnotations = [options.LineAnnotations[0] with { Debit = 6 }] }));
        Assert.Throws<ArgumentException>(() => BooksModuleAdapter.FromSnapshot(snapshot, options with {
            LineAnnotations = [options.LineAnnotations[0] with { Sequence = 99 }] }));
    }

    [Fact]
    public void RegistrationUsesOnlyVerifiedProductsAndOriginalLedgerMenuEntries()
    {
        foreach (var product in new[] { "qingsong/main", "minfeiqi/main", "chengben/main" })
        {
            var registration = BooksModuleAdapter.Registration(product);
            Assert.Equal("books", registration.ModuleId);
            Assert.Equal(new[] { "w_zc_zc", "w_zc_xjrjz", "w_zc_yhrjz" }, registration.OriginalWindows.Select(w => w.ObjectName));
            Assert.All(registration.OriginalWindows, w => Assert.Equal(product, w.Product));
        }
        Assert.Throws<ArgumentException>(() => BooksModuleAdapter.Registration("qingsong/cn"));
    }
}
#endif
