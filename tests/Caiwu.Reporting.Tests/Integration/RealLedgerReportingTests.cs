using System.Globalization;
using System.Net;
using System.Text;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Persistence.Sqlite;
using Microsoft.VisualBasic.FileIO;

namespace Caiwu.Reporting.Integration.Tests;

public sealed class RealLedgerReportingTests
{
    private static readonly DateOnly From = new(2026, 1, 1), To = new(2026, 1, 31);
    private static readonly DateTimeOffset GeneratedAt = new(2026, 2, 1, 10, 20, 30, TimeSpan.FromHours(8));
    private const string SourceAddress = "https://example.invalid/规则?version=2026&a=1&b=中文";
    private const string AuditOnlyActor = "AUDIT_ONLY_OPERATOR_MUST_NOT_BE_EXPORTED";
    private const string BankLeaf = "10020101", BankSibling = "100202";

    [Theory]
    [InlineData(AccountingRegime.SmallBusiness)]
    [InlineData(AccountingRegime.Enterprise)]
    public void ReopenedRealBooksProduceThreeReportsWithIndependentContractTotals(AccountingRegime regime)
    {
        using var fixture = new RealBook(regime);
        fixture.SeedContractSample();
        fixture.Reopen();
        Assert.All(fixture.Service.GetSnapshot().Vouchers, v => Assert.Equal(VoucherStatus.Posted, v.Status));
        var reports = Reports(fixture.Service, From, To);
        var balance = reports[1];
        Assert.Equal(new decimal?[] { 100000m, 100000m, 31200m, 31200m, 120000m, 120000m },
            balance.Total.Cells.Skip(4).Select(c => c.Amount));
        Assert.Equal(108800m, balance.Rows.Single(r => r.AccountCode == BankLeaf).Cells[8].Amount);
        Assert.Equal(2, balance.Rows.Single(r => r.AccountCode == BankLeaf).AccountDepth);
        Assert.Contains(balance.Rows, r => r.AccountCode == "100299" && r.Cells[8].Amount == 0m);
        Assert.Equal(3, reports[0].Rows.Count);
        Assert.Equal(31200m, reports[0].Total.Cells[7].Amount);
        Assert.Equal(4, reports[2].Rows.Count);
        Assert.Equal(108800m, reports[2].Rows[^1].Cells[9].Amount);
        Assert.All(reports[2].Rows.Skip(1), r => Assert.NotNull(r.VoucherId));
        Assert.Equal(fixture.Template.Version, balance.Metadata.Book.TemplateVersion);

        for (var index = 0; index < reports.Length; index++)
            VerifyAndWriteExports(reports[index], fixture, index.ToString(CultureInfo.InvariantCulture));
    }

    [Fact]
    public void ParentGrossBalancesAreNotNettedOrCountedTwiceAndCreditLedgerStaysNegative()
    {
        using var fixture = new RealBook(AccountingRegime.Enterprise);
        var openingPlan = fixture.Service.GetSnapshot();
        fixture.Service.SetOpeningBalances([
            new(BankLeaf, 100000m, 0), new(BankSibling, 0, 1000m), new(fixture.Capital, 0, 99000m)
        ], AuditOnlyActor, new(openingPlan.Book.Id, openingPlan.Revision));
        fixture.SeedContractSample();
        fixture.Reopen();
        var snapshot = fixture.Service.GetSnapshot();
        var metadata = Metadata(snapshot.Book, From, To);
        var balance = ReportBuilder.TrialBalance(metadata, fixture.Service.GetTrialBalance(From, To), snapshot.Accounts);
        var parent = balance.Rows.Single(r => r.AccountCode == "1002");
        Assert.False(parent.IsLeaf);
        Assert.Equal(108800m, parent.Cells[8].Amount);
        Assert.Equal(1000m, parent.Cells[9].Amount);
        Assert.Equal(120000m, balance.Total.Cells[8].Amount);
        Assert.Equal(120000m, balance.Total.Cells[9].Amount);
        var creditLedger = ReportBuilder.Ledger(metadata, BankSibling,
            fixture.Service.GetLedger(BankSibling, From, To), snapshot.Accounts);
        Assert.Single(creditLedger.Rows);
        Assert.Equal("贷", creditLedger.Rows[0].Cells[8].DisplayText);
        Assert.Equal(-1000m, creditLedger.Rows[0].Cells[9].Amount);
        Assert.Equal(0m, creditLedger.Total.Cells[6].Amount);
        var parentLedger = ReportBuilder.Ledger(metadata, "1002", fixture.Service.GetLedger("1002", From, To), snapshot.Accounts);
        Assert.Equal(99000m, parentLedger.Rows[0].Cells[9].Amount);
        Assert.Equal(107800m, parentLedger.Rows[^1].Cells[9].Amount);
        VerifyAndWriteExports(creditLedger, fixture, "credit-ledger");
    }

    [Fact]
    public void DateEndpointsOpeningCarryForwardAndUnpostedVoucherFiltersMatchTheRealDomain()
    {
        using var fixture = new RealBook(AccountingRegime.SmallBusiness);
        fixture.SeedContractSample();
        var draft = fixture.Save(new(2026, 1, 31), 0.10m, fixture.Expense, BankLeaf, "草稿不入账");
        var reviewed = fixture.Save(new(2026, 1, 30), 0.20m, BankLeaf, fixture.Income, "已审核不入账");
        var reviewPlan = fixture.Service.GetSnapshot();
        fixture.Service.Review(reviewed.Id, "审核员", new(reviewPlan.Book.Id, reviewPlan.Revision));
        fixture.Post(new(2026, 2, 1), 99m, BankLeaf, fixture.Income, "二月不进一月");
        fixture.Reopen();
        var reports = Reports(fixture.Service, From, To);
        Assert.Equal(5, reports[0].Rows.Count);
        Assert.Equal(31200.30m, reports[0].Total.Cells[7].Amount);
        Assert.Equal(31200m, reports[1].Total.Cells[6].Amount);
        Assert.Equal(108800m, reports[2].Rows[^1].Cells[9].Amount);
        Assert.Contains(reports[0].Rows, r => r.VoucherId == draft.Id);
        Assert.Contains(reports[0].Rows, r => r.VoucherId == reviewed.Id && r.Cells[3].DisplayText == "已审核");
        var snapshot = fixture.Service.GetSnapshot();
        var posted = ReportBuilder.VoucherList(Metadata(snapshot.Book, From, To), snapshot.Vouchers,
            snapshot.Accounts, VoucherStatus.Posted);
        Assert.Equal(3, posted.Rows.Count);
        Assert.Equal(31200m, posted.Total.Cells[7].Amount);

        var middle = Reports(fixture.Service, new(2026, 1, 10), new(2026, 1, 20));
        Assert.Equal(2, middle[0].Rows.Count); // Both endpoints are included.
        Assert.Equal(21200m, middle[1].Total.Cells[6].Amount);
        Assert.Equal(90000m, middle[2].Rows[0].Cells[9].Amount); // Jan 5 contributes to opening.
        Assert.Equal(108800m, middle[2].Rows[^1].Cells[9].Amount);
        foreach (var report in middle) VerifyAndWriteExports(report, fixture, "middle-" + report.Kind);
    }

    [Fact]
    public void SameVoucherRepeatedAccountLinesKeepIdsOrderingAndExactCents()
    {
        using var fixture = new RealBook(AccountingRegime.Enterprise);
        var entryPlan = fixture.Service.GetSnapshot();
        var voucher = fixture.Service.SaveDraft(new(null, new(2026, 1, 15), "记", null, 1, [
            new(fixture.Expense, "第一行 0.10", 0.10m, 0), new(fixture.Expense, "第二行 0.20", 0.20m, 0),
            new(BankLeaf, "贷方 0.30", 0, 0.30m)
        ], entryPlan.Revision, entryPlan.Book.Id), "制单员");
        var reviewPlan = fixture.Service.GetSnapshot();
        fixture.Service.Review(voucher.Id, "审核员", new(reviewPlan.Book.Id, reviewPlan.Revision));
        var postPlan = fixture.Service.GetSnapshot();
        fixture.Service.Post(voucher.Id, "记账员", new(postPlan.Book.Id, postPlan.Revision));
        fixture.Reopen();
        var snapshot = fixture.Service.GetSnapshot();
        var metadata = Metadata(snapshot.Book, new(2026, 1, 15), new(2026, 1, 15));
        var ledger = ReportBuilder.Ledger(metadata, fixture.Expense,
            fixture.Service.GetLedger(fixture.Expense, metadata.From, metadata.To), snapshot.Accounts);
        Assert.Equal(3, ledger.Rows.Count);
        Assert.Equal(new decimal?[] { 0m, 0.10m, 0.30m }, ledger.Rows.Select(r => r.Cells[9].Amount));
        Assert.All(ledger.Rows.Skip(1), row => Assert.Equal(voucher.Id, row.VoucherId));
        Assert.Equal(0.30m, ledger.Total.Cells[6].Amount);
        var vouchers = ReportBuilder.VoucherList(metadata, snapshot.Vouchers, snapshot.Accounts);
        Assert.Single(vouchers.Rows);
        Assert.Equal(0.30m, vouchers.Total.Cells[7].Amount);
        Assert.Equal("第一行 0.10\n第二行 0.20\n贷方 0.30", vouchers.Rows[0].Cells[6].DisplayText);
        VerifyAndWriteExports(ledger, fixture, "repeated-lines");
    }

    [Fact]
    public void PersistedInjectionPayloadsAreGuardedAndNoAuditOrDatabasePathIsExported()
    {
        using var fixture = new RealBook(AccountingRegime.Enterprise);
        const string summary = "\uFEFF=HYPERLINK(\"https://bad.invalid\") <script>alert(1)</script> 中文🧾";
        fixture.Post(From, 0.30m, fixture.Expense, BankLeaf, summary);
        fixture.Reopen();
        var reports = Reports(fixture.Service, From, To);
        var voucherRecords = Csv(ReportExporter.ToCsv(reports[0]));
        var voucherData = Data(voucherRecords, reports[0]);
        Assert.StartsWith("'\uFEFF=HYPERLINK", voucherData[0][6]);
        var ledgerRecords = Csv(ReportExporter.ToCsv(reports[2]));
        Assert.StartsWith("'\uFEFF=HYPERLINK", Data(ledgerRecords, reports[2])[1][5]);
        foreach (var report in reports) VerifyAndWriteExports(report, fixture, "injection-" + report.Kind);
        Assert.Contains("&lt;script&gt;", ReportExporter.ToHtml(reports[0]));
        Assert.Contains(summary, WebUtility.HtmlDecode(ReportExporter.ToHtml(reports[0])));
    }

    [Fact]
    public void EmptyPeriodKeepsCarriedBalancesAndNoInventedActivity()
    {
        using var fixture = new RealBook(AccountingRegime.SmallBusiness);
        fixture.SeedContractSample();
        fixture.Reopen();
        var reports = Reports(fixture.Service, new(2026, 12, 1), new(2026, 12, 31));
        Assert.Empty(reports[0].Rows);
        Assert.Equal(0m, reports[1].Total.Cells[6].Amount);
        Assert.Equal(0m, reports[1].Total.Cells[7].Amount);
        Assert.Equal(120000m, reports[1].Total.Cells[4].Amount);
        Assert.Equal(120000m, reports[1].Total.Cells[8].Amount);
        Assert.Single(reports[2].Rows);
        Assert.Null(reports[2].Rows[0].VoucherId);
        Assert.Equal(108800m, reports[2].Rows[0].Cells[9].Amount);
        foreach (var report in reports) VerifyAndWriteExports(report, fixture, "empty-" + report.Kind);
    }

    [Fact]
    public void BackupRestoreProducesIdenticalReportContentWithFixedGenerationTime()
    {
        using var fixture = new RealBook(AccountingRegime.Enterprise);
        fixture.SeedContractSample();
        var expected = Reports(fixture.Service, From, To);
        var backup = Path.Combine(fixture.Folder, "backup.caiwubak");
        var restored = Path.Combine(fixture.Folder, "restored.caiwu");
        fixture.Store.BackupTo(backup);
        SqliteLedgerStore.RestoreBackup(backup, restored);
        using var copy = SqliteLedgerStore.Open(restored);
        var actual = Reports(new LedgerService(copy), From, To);
        for (var i = 0; i < expected.Length; i++)
        {
            Assert.Equal(ReportExporter.ToCsv(expected[i]), ReportExporter.ToCsv(actual[i]));
            Assert.Equal(ReportExporter.ToHtml(expected[i]), ReportExporter.ToHtml(actual[i]));
        }
    }

    [Fact]
    public void ActualDomainAndReportMetadataRejectInvalidFiscalRanges()
    {
        using var fixture = new RealBook(AccountingRegime.SmallBusiness);
        var book = fixture.Service.GetSnapshot().Book;
        foreach (var (from, to) in new[] { (To, From), (new DateOnly(2025, 12, 31), To), (From, new DateOnly(2027, 1, 1)) })
        {
            Assert.Throws<LedgerValidationException>(() => fixture.Service.GetTrialBalance(from, to));
            Assert.Throws<LedgerValidationException>(() => fixture.Service.GetLedger(BankLeaf, from, to));
            Assert.Throws<ArgumentException>(() => Metadata(book, from, to));
        }
    }

    [Fact]
    public void SmallBusinessStatementsConsumeRealReopenedSnapshotAndExportCoverage()
    {
        using var fixture = new RealBook(AccountingRegime.SmallBusiness);
        fixture.SeedContractSample();
        fixture.Reopen();
        var snapshot = fixture.Service.GetSnapshot();
        var options = new SmallBusinessStatementOptions(additionalSources: [new("合成测试来源", SourceAddress)]);
        var income = SmallBusinessStatements.IncomeStatement(snapshot, 1, GeneratedAt, options);
        var balance = SmallBusinessStatements.BalanceSheet(snapshot, To, GeneratedAt, options);
        Assert.Equal(18800m, income.Lines.Single(l => l.RowNumber == 32).First.Amount);
        Assert.Equal(118800m, balance.Lines.Single(l => l.RowNumber == 30).First.Amount);
        Assert.Null(balance.Lines.Single(l => l.RowNumber == 53).First.Amount);
        Assert.Contains(balance.Issues, i => i.Code == "MissingRow" && i.Detail.Contains("行51", StringComparison.Ordinal));
        foreach (var statement in new[] { income, balance })
        {
            Assert.False(statement.IsVerifiedForProduction);
            Assert.False(statement.IsCompleteFormulaSet);
            VerifyAndWriteExports(statement.Document, fixture, "statement-" + statement.OfficialForm);
            Assert.Contains(Csv(ReportExporter.ToCsv(statement.Document)), row => row[0] == "生产核验" && row[1] == "否");
        }
    }

    private static ReportMetadata Metadata(BookInfo book, DateOnly from, DateOnly to) =>
        new(book, from, to, GeneratedAt, [new("合成样例来源（测试占位，非制度依据）", SourceAddress)]);

    private static ReportDocument[] Reports(ILedgerService service, DateOnly from, DateOnly to)
    {
        var snapshot = service.GetSnapshot();
        var metadata = Metadata(snapshot.Book, from, to);
        return [ReportBuilder.VoucherList(metadata, snapshot.Vouchers, snapshot.Accounts),
            ReportBuilder.TrialBalance(metadata, service.GetTrialBalance(from, to), snapshot.Accounts),
            ReportBuilder.Ledger(metadata, BankLeaf, service.GetLedger(BankLeaf, from, to), snapshot.Accounts)];
    }

    private static void VerifyAndWriteExports(ReportDocument report, RealBook fixture, string name)
    {
        var csvPath = Path.Combine(fixture.Folder, name + ".csv");
        var htmlPath = Path.Combine(fixture.Folder, name + ".html");
        using (var csv = File.Create(csvPath)) ReportExporter.WriteCsv(report, csv);
        using (var html = File.Create(htmlPath)) ReportExporter.WriteHtml(report, html, new HtmlExportOptions(2));
        var bytes = File.ReadAllBytes(csvPath);
        Assert.Equal(new byte[] { 0xef, 0xbb, 0xbf }, bytes.Take(3));
        var csvText = Encoding.UTF8.GetString(bytes.AsSpan(3));
        var htmlText = File.ReadAllText(htmlPath, Encoding.UTF8);
        Assert.Equal(ReportExporter.ToCsv(report), csvText);
        var records = Csv(csvText);
        Assert.All(records, row => Assert.Equal(report.Columns.Count, row.Length));
        Assert.Equal(report.Rows.Count, Data(records, report).Length);
        Assert.Contains(records, r => r[0] == "制度版本" && r[1] == fixture.Template.Version);
        Assert.Contains(records, r => r[0] == "期间" && r[1] == report.Metadata.From.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) +
            " 至 " + report.Metadata.To.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        Assert.Contains(records, r => r[0] == "生成时间" && r[1] == GeneratedAt.ToString("O", CultureInfo.InvariantCulture));
        Assert.Contains(records, r => r[1] == SourceAddress);
        Assert.Contains("href=\"https://example.invalid/规则?version=2026&amp;a=1&amp;b=中文\"", htmlText);
        Assert.DoesNotContain("<script", htmlText, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("<img", htmlText, StringComparison.OrdinalIgnoreCase);
        foreach (var text in new[] { csvText, htmlText })
        {
            Assert.DoesNotContain(AuditOnlyActor, text);
            Assert.DoesNotContain(fixture.DatabasePath, text);
            Assert.DoesNotContain(fixture.Folder, text);
        }
        foreach (var id in report.Rows.Where(r => r.VoucherId.HasValue).Select(r => r.VoucherId!.Value))
        {
            Assert.Contains(id.ToString("D"), csvText);
            Assert.Contains("data-voucher-id=\"" + id.ToString("D") + "\"", htmlText);
        }
    }

    private static string[][] Data(List<string[]> records, ReportDocument report)
    {
        var header = records.FindIndex(r => r.SequenceEqual(report.Columns.Select(c => c.Title)));
        Assert.True(header >= 0, "CSV must contain the declared report header.");
        return records.Skip(header + 1).Take(report.Rows.Count).ToArray();
    }

    private static List<string[]> Csv(string csv)
    {
        using var parser = new TextFieldParser(new StringReader(csv)) { HasFieldsEnclosedInQuotes = true, TrimWhiteSpace = false };
        parser.SetDelimiters(",");
        var rows = new List<string[]>();
        while (!parser.EndOfData) rows.Add(parser.ReadFields()!);
        return rows;
    }

    private sealed class RealBook : IDisposable
    {
        internal string Folder { get; } = Path.Combine(Path.GetTempPath(), "caiwu-reporting-integration-" + Guid.NewGuid().ToString("N"));
        internal string DatabasePath => Path.Combine(Folder, "synthetic.caiwu");
        internal TemplateDefinition Template { get; }
        internal string Capital { get; }
        internal string Income { get; }
        internal string Expense { get; }
        internal SqliteLedgerStore Store { get; private set; }
        internal LedgerService Service { get; private set; }

        internal RealBook(AccountingRegime regime)
        {
            Template = TemplateCatalog.Get(regime);
            (Capital, Income, Expense) = regime == AccountingRegime.SmallBusiness ? ("3001", "5001", "5602") : ("4001", "6001", "6602");
            Directory.CreateDirectory(Folder);
            var book = new BookInfo(Guid.NewGuid(), "=合成账套 <script>非执行文本</script> 中文🧾", regime,
                Template.Version, 2026, 1, 0, GeneratedAt);
            Store = SqliteLedgerStore.Create(DatabasePath, book, Template.Accounts);
            Service = new LedgerService(Store);
            foreach (var account in new[] { A("100201", "银行分支", "1002"), A(BankLeaf, "银行账户 <img src=x> 🧾", "100201"),
                A(BankSibling, "银行反向余额", "1002"), A("100299", "零余额银行", "1002") })
            {
                var accountPlan = Service.GetSnapshot();
                Service.SaveAccount(account, AuditOnlyActor, new(accountPlan.Book.Id, accountPlan.Revision));
            }
            var openingPlan = Service.GetSnapshot();
            Service.SetOpeningBalances([new(BankLeaf, 100000m, 0), new(Capital, 0, 100000m)], AuditOnlyActor,
                new(openingPlan.Book.Id, openingPlan.Revision));
        }

        private static Account A(string code, string name, string parent) => new(code, name, parent, BalanceDirection.Debit, true, 0, 0);
        internal Voucher Save(DateOnly date, decimal amount, string debit, string credit, string summary)
        {
            // This is fresh synthetic fixture creation, not an existing user edit/retry.
            var entryPlan = Service.GetSnapshot();
            return Service.SaveDraft(new(null, date, "记", null, 1,
                [new(debit, summary, amount, 0), new(credit, summary, 0, amount)], entryPlan.Revision, entryPlan.Book.Id), "制单员");
        }
        internal void Post(DateOnly date, decimal amount, string debit, string credit, string summary)
        {
            var voucher = Save(date, amount, debit, credit, summary);
            var reviewPlan = Service.GetSnapshot();
            Service.Review(voucher.Id, "审核员", new(reviewPlan.Book.Id, reviewPlan.Revision));
            var postPlan = Service.GetSnapshot();
            Service.Post(voucher.Id, "记账员", new(postPlan.Book.Id, postPlan.Revision));
        }
        internal void SeedContractSample()
        {
            Post(new(2026, 1, 5), 10000m, "1403", BankLeaf, "购入原材料 中文🧾");
            Post(new(2026, 1, 10), 1200m, Expense, BankLeaf, "支付费用");
            Post(new(2026, 1, 20), 20000m, BankLeaf, Income, "主营业务收入");
        }
        internal void Reopen()
        {
            Store.Dispose();
            Store = SqliteLedgerStore.Open(DatabasePath);
            Service = new LedgerService(Store);
        }
        public void Dispose() { Store.Dispose(); Directory.Delete(Folder, recursive: true); }
    }
}
