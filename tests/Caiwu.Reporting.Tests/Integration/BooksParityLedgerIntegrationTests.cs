using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Persistence.Sqlite;
using Caiwu.Reporting.Books;

namespace Caiwu.Reporting.Integration.Tests;

/// <summary>Uses actual domain posting + SQLite persistence on disposable synthetic data, never a user book.</summary>
public sealed class BooksParityLedgerIntegrationTests
{
    [Fact]
    public void PostedReopenedLedgerFeedsGeneralCashBankReportsAndQueriesDoNotWrite()
    {
        var folder = Path.Combine(Path.GetTempPath(), "caiwu-books-synthetic-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "synthetic.caiwu");
        var book = new BookInfo(Guid.NewGuid(), "账簿合成集成测试", AccountingRegime.Enterprise, "synthetic-only", 2026, 1, 0, DateTimeOffset.UtcNow);
        Account[] accounts = [
            new("1001", "现金", null, BalanceDirection.Debit, true, 1000, 0),
            new("1002", "银行", null, BalanceDirection.Debit, true, 2000, 0),
            new("4001", "权益", null, BalanceDirection.Credit, true, 0, 3000),
            new("6001", "收入", null, BalanceDirection.Credit, true, 0, 0),
            new("6602", "费用", null, BalanceDirection.Debit, true, 0, 0)
        ];
        try
        {
            using (var store = SqliteLedgerStore.Create(path, book, accounts))
            {
                var ledger = new LedgerService(store);
                Voucher Save(int month, int day, decimal amount, string debit, string credit)
                {
                    var s = ledger.GetSnapshot();
                    return ledger.SaveDraft(new(null, new(2026, month, day), "记", null, 0,
                        [new(debit, "合成集成业务", amount, 0), new(credit, "合成集成业务", 0, amount)], s.Revision, s.Book.Id), "制单");
                }
                void Post(int month, int day, decimal amount, string debit, string credit)
                {
                    var voucher = Save(month, day, amount, debit, credit);
                    var s = ledger.GetSnapshot(); ledger.Review(voucher.Id, "审核", new(s.Book.Id, s.Revision));
                    s = ledger.GetSnapshot(); ledger.Post(voucher.Id, "记账", new(s.Book.Id, s.Revision));
                }
                Post(1, 5, 100, "1002", "1001");
                Post(1, 31, 300, "1001", "6001");
                Post(2, 1, 50, "6602", "1002");
                Post(2, 28, .30m, "1001", "6001");
                _ = Save(2, 28, 20, "1001", "6001");
                var close = ledger.GetSnapshot(); ledger.CloseMonth(1, "结账", new(close.Book.Id, close.Revision));
            }
            using var reopened = SqliteLedgerStore.Open(path);
            var service = new LedgerService(reopened);
            var before = service.GetSnapshot();
            var serializedBefore = JsonSerializer.Serialize(before);
            var input = BooksSnapshotAdapter.FromSnapshot(before, new Dictionary<string, JournalAccountKind> {
                ["1001"] = JournalAccountKind.Cash, ["1002"] = JournalAccountKind.Bank
            });
            foreach (var (kind, account) in new[] { (BooksKind.CashJournal, "1001"), (BooksKind.BankJournal, "1002") })
            {
                var result = BooksReportBuilder.Build(input, new(kind, account, account, 2, 2));
                var calculated = result.Accounts.Single();
                var domain = service.GetLedger(account, new(2026, 2, 1), new(2026, 2, 28));
                Assert.Equal(domain[0].RunningBalance, calculated.OpeningBalance);
                Assert.Equal(domain[^1].RunningBalance, calculated.ClosingBalance);
                Assert.Equal(domain.Skip(1).Select(r => (r.VoucherId, r.Debit, r.Credit, r.RunningBalance)),
                    calculated.Rows.Where(r => r.Kind == BooksRowKind.Entry).Select(r => (r.VoucherId, r.Debit, r.Credit, r.Balance)));
                var general = BooksReportBuilder.Build(input, new(BooksKind.GeneralLedger, account, account, 2, 2)).Accounts.Single();
                Assert.Equal(calculated.ClosingBalance, general.ClosingBalance);
                Assert.Equal(calculated.PeriodDebit, general.PeriodDebit);
                Assert.Equal(calculated.PeriodCredit, general.PeriodCredit);
                var document = BooksDocumentBuilder.Create(result, account, DateTimeOffset.UtcNow);
                var exported = ReportExporter.ToCsv(document);
                Assert.Contains(kind == BooksKind.CashJournal ? "1200.30" : "2050.00", exported);
                using var html = new StringWriter(); ReportExporter.WriteHtml(document, html);
                Assert.Contains(result.Title, html.ToString());
            }
            var unposted = BooksReportBuilder.Build(input, new(BooksKind.CashJournal, "1001", "1001", 2, 2, true));
            Assert.Equal(1220.30m, unposted.Accounts.Single().ClosingBalance);
            Assert.Equal(serializedBefore, JsonSerializer.Serialize(service.GetSnapshot()));
            reopened.CheckIntegrity();
        }
        finally { Directory.Delete(folder, recursive: true); }
    }
}
