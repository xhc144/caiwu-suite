using System.Globalization;
using System.Net;
using Caiwu.Contracts;

namespace Caiwu.Reporting.Tests;

public sealed class SmallBusinessStatementTests
{
    [Theory]
    [InlineData("a05")]
    [InlineData("a52")]
    public void OriginalTemplateVariantRemainsVisibleWithoutClaimingRecoveredContents(string originalId)
    {
        var report = SmallBusinessStatements.IncomeStatement(SampleA(), 1, At, new(originalTemplateId: originalId));
        Assert.Contains(report.Document.Annotations, a => a.Label == "原模板标识" && a.Value == originalId);
        Assert.Contains(report.Document.Annotations, a => a.Label == "原模板内容核验" && a.Value.StartsWith("否", StringComparison.Ordinal));
        Assert.Equal(18800, N(report, 32));
    }
    [Theory]
    [InlineData("a01")]
    [InlineData("a02")]
    [InlineData("a54")]
    public void AnotherRegimeCannotBeLabeledAsASmallBusinessOriginalTemplate(string originalId) =>
        Assert.Throws<ArgumentException>(() => new SmallBusinessStatementOptions(originalTemplateId: originalId));
    private static readonly DateOnly January = new(2026, 1, 31), February = new(2026, 2, 28), December = new(2026, 12, 31);
    private static readonly DateTimeOffset At = new(2026, 10, 25, 12, 0, 0, TimeSpan.Zero);
    private static Account A(string code, decimal debit = 0, decimal credit = 0, string? parent = null) =>
        new(code, code + "中文科目", parent, BalanceDirection.Debit, true, debit, credit);
    private static Voucher V(int month, int day, string debit, string credit, decimal amount) =>
        Journal(new(2026, month, day), [new(debit, "独立合成业务", amount, 0), new(credit, "独立合成业务", 0, amount)]);
    private static Voucher Journal(DateOnly date, params VoucherLine[] lines) => new(Guid.NewGuid(), date, "记", 1, 0, "制单", "审核", VoucherStatus.Posted, lines);
    private static LedgerSnapshot Snapshot(Account[] accounts, params Voucher[] vouchers) => new(0,
        new(Guid.Parse("00000000-0000-0000-0000-000000000001"), "小企业独立合成样例", AccountingRegime.SmallBusiness,
            "small-business-2011-demo.1", 2026, 1, 0, At), accounts, vouchers, []);
    private static decimal? N(SmallBusinessStatement statement, int row, bool first = true) =>
        first ? statement.Lines.Single(r => r.RowNumber == row).First.Amount : statement.Lines.Single(r => r.RowNumber == row).Second.Amount;

    private static LedgerSnapshot SampleA() => Snapshot([A("1002", 100000), A("3001", credit: 100000), A("1403"),
        A("5001"), A("5602"), A("3103"), A("3104")], V(1, 5, "1403", "1002", 10000),
        V(1, 10, "5602", "1002", 1200), V(1, 20, "1002", "5001", 20000));

    [Fact]
    public void IndependentSampleAComputesProfitAndRealAssetsRatherThanRenamingTrialBalance()
    {
        var sample = SampleA();
        var income = SmallBusinessStatements.IncomeStatement(sample, 1, At);
        Assert.Equal(32, income.Lines.Count);
        Assert.Equal(20000m, N(income, 1));
        Assert.Equal(1200m, N(income, 14));
        Assert.Equal(18800m, N(income, 21));
        Assert.Equal(18800m, N(income, 30));
        Assert.Equal(18800m, N(income, 32));
        Assert.Equal(18800m, N(income, 32, false));
        Assert.Null(N(income, 15)); // Opening costs cannot be inferred from total administrative expense.
        var balance = SmallBusinessStatements.BalanceSheet(sample, January, At);
        Assert.Equal(53, balance.Lines.Count);
        Assert.Equal(108800m, N(balance, 1));
        Assert.Equal(10000m, N(balance, 9));
        Assert.Equal(118800m, N(balance, 30)); // Trial balance is 120000 incl. expense; an expense is not an asset.
        Assert.Equal(100000m, N(balance, 30, false));
        Assert.Null(N(balance, 51)); // No fabricated closing/reallocation to retained profits.
        Assert.Null(N(balance, 53));
        Assert.Equal(100000m, N(balance, 53, false));
    }

    [Fact]
    public void ExplicitYearEndClosingsDoNotEraseIncomeAndRetainedProfitsBalance()
    {
        var sample = SampleA();
        var closing = Journal(December, new("5001", "损益结转", 20000, 0), new("5602", "损益结转", 0, 1200), new("3103", "损益结转", 0, 18800));
        var retained = Journal(December, new("3103", "年终转利润分配", 18800, 0), new("3104", "年终转利润分配", 0, 18800));
        sample = sample with { Vouchers = sample.Vouchers.Concat([closing, retained]).ToArray() };
        var options = new SmallBusinessStatementOptions([closing.Id, retained.Id]);
        var income = SmallBusinessStatements.IncomeStatement(sample, 12, At, options);
        Assert.Equal(18800m, N(income, 32));
        Assert.Equal(0m, N(income, 32, false));
        var balance = SmallBusinessStatements.BalanceSheet(sample, December, At, options);
        Assert.Equal(18800m, N(balance, 51));
        Assert.Equal(118800m, N(balance, 30));
        Assert.Equal(118800m, N(balance, 53));
        Assert.True(balance.HasAllNumericValues);
        Assert.False(balance.IsVerifiedForProduction);
        Assert.False(balance.IsCompleteFormulaSet);
        Assert.DoesNotContain(balance.Issues, i => i.Code == "BalanceEquationMismatch");
        var balanceWithoutIncomeClassification = SmallBusinessStatements.BalanceSheet(sample, December, At);
        Assert.Equal(118800m, N(balanceWithoutIncomeClassification, 53));
        Assert.DoesNotContain(balanceWithoutIncomeClassification.Issues, i => i.Code == "IncomeBasis");
        var unclassified = SmallBusinessStatements.IncomeStatement(sample, 12, At);
        Assert.Null(N(unclassified, 1));
        Assert.Contains(unclassified.Issues, i => i.Code == "IncomeBasis");
    }

    [Fact]
    public void IndependentSampleBSeparatesMonthlyAndYearToDateIncludingLossAndInterestIncome()
    {
        var accounts = new[] { A("1002", 20000), A("1403", 1000), A("1601", 5000), A("1602", credit: 1000), A("3001", credit: 25000),
            A("5001"), A("5401"), A("5602"), A("5603"), A("5111"), A("5301"), A("5711"), A("5801") };
        var sample = Snapshot(accounts,
            V(1, 2, "1002", "5001", 10000), V(1, 3, "5401", "1002", 6000), V(1, 4, "5602", "1002", 2000),
            V(1, 5, "1002", "5603", 100), V(1, 6, "5111", "1002", 200), V(1, 7, "1002", "5301", 500),
            V(1, 8, "5711", "1002", 300), V(1, 9, "5801", "1002", 525), V(2, 2, "1002", "5001", 4000),
            V(2, 3, "5401", "1002", 3000), V(2, 4, "5602", "1002", 1500), V(2, 5, "5603", "1002", 50),
            V(2, 6, "1002", "5111", 100), V(2, 7, "5711", "1002", 25));
        var january = SmallBusinessStatements.IncomeStatement(sample, 1, At);
        Assert.Equal(1575m, N(january, 32));
        Assert.Equal(-100m, N(january, 18));
        Assert.Equal(-200m, N(january, 20));
        var february = SmallBusinessStatements.IncomeStatement(sample, 2, At);
        Assert.Equal(14000m, N(february, 1)); Assert.Equal(4000m, N(february, 1, false));
        Assert.Equal(9000m, N(february, 2)); Assert.Equal(3000m, N(february, 2, false));
        Assert.Equal(-50m, N(february, 18)); Assert.Equal(50m, N(february, 18, false));
        Assert.Equal(1450m, N(february, 21)); Assert.Equal(-450m, N(february, 21, false));
        Assert.Equal(1625m, N(february, 30)); Assert.Equal(-475m, N(february, 30, false));
        Assert.Equal(1100m, N(february, 32)); Assert.Equal(-475m, N(february, 32, false));
        var balance = SmallBusinessStatements.BalanceSheet(sample, February, At);
        Assert.Equal(21100m, N(balance, 1)); Assert.Equal(5000m, N(balance, 18));
        Assert.Equal(1000m, N(balance, 19)); Assert.Equal(4000m, N(balance, 20));
        Assert.Equal(26100m, N(balance, 30)); Assert.Equal(25000m, N(balance, 30, false));
    }

    [Fact]
    public void CounterpartyAndTermEvidenceEnableGrossReclassificationWithoutNetting()
    {
        var sample = Snapshot([A("1002", 100), A("3001", credit: 45), A("1122"), A("112201", 100, parent: "1122"),
            A("112202", credit: 30, parent: "1122"), A("1123"), A("112301", credit: 20, parent: "1123"),
            A("2202"), A("220201", credit: 80, parent: "2202"), A("220202", 10, parent: "2202"),
            A("2203"), A("220301", credit: 40, parent: "2203"), A("220302", 5, parent: "2203")]);
        var unknown = SmallBusinessStatements.BalanceSheet(sample, January, At);
        Assert.Null(N(unknown, 4)); Assert.Null(N(unknown, 33));
        var noTerm = SmallBusinessStatements.BalanceSheet(sample, January, At,
            new(settlementLeavesAreCounterpartySeparated: true));
        Assert.Equal(105m, N(noTerm, 4)); Assert.Equal(100m, N(noTerm, 33));
        Assert.Null(N(noTerm, 5)); Assert.Null(N(noTerm, 34)); Assert.Null(N(noTerm, 28)); Assert.Null(N(noTerm, 45));
        var options = new SmallBusinessStatementOptions(settlementLeavesAreCounterpartySeparated: true,
            settlementTerms: [new("112202", false, false), new("220202", false, false), new("220301", true, true)]);
        var result = SmallBusinessStatements.BalanceSheet(sample, January, At, options);
        Assert.Equal(105m, N(result, 4)); Assert.Equal(10m, N(result, 5)); Assert.Equal(100m, N(result, 33));
        Assert.Equal(30m, N(result, 34)); Assert.Equal(40m, N(result, 45));
        Assert.Equal(215m, N(result, 30)); Assert.Equal(215m, N(result, 53));
        Assert.True(result.HasAllNumericValues);
        Assert.False(result.IsVerifiedForProduction);
    }

    [Fact]
    public void InventoryContraAmountsAndSubtotalsAreNotDoubleCounted()
    {
        var sample = Snapshot([A("1403", 100), A("1404", credit: 20), A("1405", 1000), A("1407", credit: 300), A("3001", credit: 780)]);
        var result = SmallBusinessStatements.BalanceSheet(sample, January, At);
        Assert.Equal(780m, N(result, 9)); Assert.Equal(700m, N(result, 12));
        Assert.Null(N(result, 10)); // Material difference cannot be assigned to raw materials automatically.
        Assert.Equal(780m, N(result, 15)); Assert.Equal(780m, N(result, 30)); Assert.Equal(780m, N(result, 53));
        Assert.False(result.HasAllNumericValues);
    }

    [Fact]
    public void ExplicitDetailMappingsUseParentRelationsAndDoNotRepeatExpense()
    {
        var sample = Snapshot([A("1002", 100), A("3001", credit: 100), A("5602"), A("560201", parent: "5602"), A("560202", parent: "5602")],
            V(1, 2, "560201", "1002", 20), V(1, 3, "560202", "1002", 30));
        var options = new SmallBusinessStatementOptions(incomeDetails: [new(15, "560201"), new(16, "560202")]);
        var result = SmallBusinessStatements.IncomeStatement(sample, 1, At, options);
        Assert.Equal(50m, N(result, 14)); Assert.Equal(20m, N(result, 15)); Assert.Equal(30m, N(result, 16));
        Assert.Null(N(result, 17)); Assert.Equal(-50m, N(result, 32));
        Assert.Throws<ArgumentException>(() => SmallBusinessStatements.IncomeStatement(sample, 1, At,
            new(incomeDetails: [new(15, "5602"), new(16, "560201")])));
        Assert.Throws<ArgumentException>(() => SmallBusinessStatements.IncomeStatement(sample, 1, At,
            new(incomeDetails: [new(19, "560201")])));
    }

    [Fact]
    public void EmptyUnknownAndMissingMaturityNeverBecomeInventedZeroes()
    {
        Assert.All(SmallBusinessStatements.BalanceSheet(Snapshot([]), January, At).Lines, line => Assert.Null(line.First.Amount));
        Assert.All(SmallBusinessStatements.IncomeStatement(Snapshot([]), 1, At).Lines, line => Assert.Null(line.First.Amount));
        var unknown = Snapshot([A("9999", 10), A("3001", credit: 10)]);
        var result = SmallBusinessStatements.BalanceSheet(unknown, January, At);
        Assert.Null(N(result, 1)); Assert.Contains(result.Issues, issue => issue.Code == "UnknownAccount");
        var explicitlyMapped = SmallBusinessStatements.BalanceSheet(unknown, January, At,
            new(accountMappings: [new("9999", "1002")]));
        Assert.Equal(10m, N(explicitlyMapped, 1));
        var longTerm = SmallBusinessStatements.BalanceSheet(Snapshot([A("1501", 10), A("3001", credit: 10)]), January, At);
        Assert.Null(N(longTerm, 14)); Assert.Null(N(longTerm, 16)); Assert.Null(N(longTerm, 30));
        var loan = SmallBusinessStatements.BalanceSheet(Snapshot([A("1002", 10), A("2501", credit: 10)]), January, At);
        Assert.Null(N(loan, 40)); Assert.Null(N(loan, 42)); Assert.Null(N(loan, 53));
        var zeroNetReceivable = SmallBusinessStatements.BalanceSheet(Snapshot([A("1122"), A("1002")]), January, At);
        Assert.Null(N(zeroNetReceivable, 4)); // An aggregate zero does not prove customer debit/credit balances are zero.
    }

    [Fact]
    public void OnlyPostedThroughReportDateContributesAndProfitReturnsKeepTheirSign()
    {
        var sample = Snapshot([A("1002", 10), A("3001", credit: 10), A("5001")],
            V(1, 1, "1002", "5001", 0.10m), V(1, 31, "1002", "5001", 0.20m),
            V(2, 1, "1002", "5001", 100), V(1, 10, "5001", "1002", 0.05m),
            V(1, 11, "1002", "5001", 500) with { Status = VoucherStatus.Draft },
            V(1, 12, "1002", "5001", 500) with { Status = VoucherStatus.Reviewed });
        var result = SmallBusinessStatements.IncomeStatement(sample, 1, At);
        Assert.Equal(0.25m, N(result, 1)); Assert.Equal(0.25m, N(result, 32));
        Assert.Equal(10.25m, N(SmallBusinessStatements.BalanceSheet(sample, January, At), 1));
    }

    [Fact]
    public void RejectsUnsupportedRegimesYearsPartialYearsAndInvalidClosingClassifications()
    {
        var sample = SampleA();
        foreach (var book in new[] { sample.Book with { Regime = AccountingRegime.Enterprise }, sample.Book with { Regime = AccountingRegime.Nonprofit },
            sample.Book with { FiscalYear = 2025 }, sample.Book with { FiscalYear = 2027 }, sample.Book with { StartMonth = 2 } })
            Assert.Throws<NotSupportedException>(() => SmallBusinessStatements.IncomeStatement(sample with { Book = book }, 1, At));
        Assert.Throws<ArgumentException>(() => SmallBusinessStatements.BalanceSheet(sample, new(2027, 1, 31), At));
        Assert.Throws<ArgumentException>(() => SmallBusinessStatements.BalanceSheet(sample, new(2026, 1, 30), At));
        Assert.Throws<ArgumentOutOfRangeException>(() => SmallBusinessStatements.IncomeStatement(sample, 13, At));
        Assert.Throws<ArgumentException>(() => SmallBusinessStatements.IncomeStatement(sample, 1, At, new([sample.Vouchers[0].Id])));
        Assert.Throws<ArgumentException>(() => SmallBusinessStatements.IncomeStatement(sample, 1, At, new([Guid.NewGuid()])));
        Assert.Throws<ArgumentException>(() => SmallBusinessStatements.IncomeStatement(sample with
            { Vouchers = [sample.Vouchers[0] with { Date = new(2025, 12, 31) }] }, 1, At));
        Assert.Throws<ArgumentException>(() => SmallBusinessStatements.BalanceSheet(sample with
            { Accounts = [A("1002", 1), A("3001")] }, January, At));
    }

    [Fact]
    public void ExportsOfficialRowsCoverageAndSourcesWithoutExtraBlanketTotalAndEncodesInput()
    {
        var previous = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("ar-SA");
            var sample = Snapshot([A("1002"), A("3001")]);
            sample = sample with { Book = sample.Book with { Name = "=中文<script>alert(1)</script> 🧾" } };
            foreach (var statement in new[] { SmallBusinessStatements.BalanceSheet(sample, January, At), SmallBusinessStatements.IncomeStatement(sample, 1, At) })
            {
                Assert.False(statement.Document.IncludeTotal);
                Assert.True(statement.HasAllNumericValues);
                Assert.False(statement.IsCompleteFormulaSet);
                Assert.False(statement.IsVerifiedForProduction);
                var records = ReportExporterTests.ParseCsv(ReportExporter.ToCsv(statement.Document));
                Assert.Contains(records, row => row[0] == "生产核验" && row[1] == "否");
                Assert.Contains(records, row => row[0] == "完整公式集" && row[1] == "否");
                Assert.Contains(records, row => row[0] == "规则包" && row[1].Contains(SmallBusinessStatement.RulePackageVersion, StringComparison.Ordinal));
                Assert.Contains(records, row => row[0] == "账套" && row[1].StartsWith("'=中文", StringComparison.Ordinal));
                Assert.Contains(records, row => row[1] == SmallBusinessStatement.OfficialAppendixUrl);
                Assert.Equal(statement.Lines.Count, records.Count(row => int.TryParse(row[0], out _)));
                var html = ReportExporter.ToHtml(statement.Document);
                Assert.DoesNotContain("<tr class=\"total\"", html);
                Assert.DoesNotContain("<script>", html);
                Assert.Contains("&lt;script&gt;", html);
                Assert.Contains("2026-01-31", html);
                Assert.Contains(statement.OfficialForm, WebUtility.HtmlDecode(html));
            }
        }
        finally { CultureInfo.CurrentCulture = previous; }
    }
}
