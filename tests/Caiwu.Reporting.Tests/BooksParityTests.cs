using System.Globalization;
using Caiwu.Contracts;
using Caiwu.Reporting.Books;

namespace Caiwu.Reporting.Tests;

/// <summary>Entirely synthetic ledger, with independent hand-calculated expectations.</summary>
public sealed class BooksParityTests
{
    private static BooksLedgerInput Fixture()
    {
        var book = new BookInfo(Guid.Parse("993a9edc-7149-4484-b5b5-3390186e4bb0"), "合成账簿测试", AccountingRegime.Enterprise,
            "synthetic-books-v1", 2026, 1, 0, DateTimeOffset.Parse("2026-01-01T00:00:00Z", CultureInfo.InvariantCulture));
        return new(book, 17,
        [
            new("A", "现金父科目", null, 0, 0, JournalAccountKind.Cash),
            new("X9", "库存现金", "A", 1000, 0), // ParentCode, deliberately not a code prefix.
            new("B", "银行父科目", null, 0, 0, JournalAccountKind.Bank),
            new("Q", "测试银行", "B", 2000, 0), new("Z", "权益", null, 0, 3000),
            new("R", "收入", null, 0, 0), new("E", "费用", null, 0, 0), new("N", "零余额", null, 0, 0)
        ],
        [
            V(1, 1, 5, VoucherStatus.Posted, L(1, "Q", 100, 0), L(2, "X9", 0, 100)),
            V(2, 1, 31, VoucherStatus.Posted, L(1, "X9", 300, 0), L(2, "R", 0, 300)),
            V(3, 2, 1, VoucherStatus.Posted, L(1, "E", 50, 0), L(2, "Q", 0, 50) with { SettlementType = "转账", CheckNumber = "00123", BillNumber = "00045", SourceKey = "synthetic-pz-3-2" }),
            V(4, 2, 10, VoucherStatus.Posted, L(2, "X9", .20m, 0), L(1, "X9", .10m, 0), L(3, "R", 0, .30m)),
            V(5, 2, 28, VoucherStatus.Posted, L(1, "R", 300.30m, 0) with { Summary = "月度损益结转" }, L(2, "Z", 0, 300.30m)),
            V(6, 2, 28, VoucherStatus.Reviewed, L(1, "X9", 20, 0), L(2, "R", 0, 20)),
            V(7, 2, 28, VoucherStatus.Draft, L(1, "E", 5, 0), L(2, "Q", 0, 5)),
            V(8, 3, 1, VoucherStatus.Posted, L(1, "Q", 90, 0), L(2, "R", 0, 90))
        ], "人民币", "synthetic fixture; no original program/book/resource");
    }

    private static BooksLine L(int sequence, string account, decimal debit, decimal credit) =>
        new(sequence, account, "合成业务", debit, credit);
    private static BooksVoucher V(int n, int month, int day, VoucherStatus status, params BooksLine[] lines) =>
        new(new Guid(n, 0, 0, new byte[8]), new(2026, month, day), "记", n, status, lines);
    private static BooksQuery Cash(int from = 1, int to = 2, bool unposted = false) =>
        new(BooksKind.CashJournal, "X9", "X9", from, to, unposted);
    private static BooksAccountReport One(BooksLedgerInput input, BooksQuery q) => BooksReportBuilder.Build(input, q).Accounts.Single();

    [Fact]
    public void CashJournalHasExactOpeningEntriesMonthlyAndYtdWithoutSubtotalDoubleCounting()
    {
        var report = One(Fixture(), Cash());
        Assert.Equal((1000m, 300.30m, 100m, 1200.30m, 300.30m, 100m),
            (report.OpeningBalance, report.PeriodDebit, report.PeriodCredit, report.ClosingBalance, report.YearDebit, report.YearCredit));
        var entries = report.Rows.Where(r => r.Kind == BooksRowKind.Entry).ToArray();
        Assert.Equal(new decimal[] { 900m, 1200m, 1200.10m, 1200.30m }, entries.Select(r => r.Balance));
        Assert.Equal(new int?[] { 1, 2 }, entries.Where(r => r.Date == new DateOnly(2026, 2, 10)).Select(r => r.LineSequence));
        Assert.All(entries, r => Assert.NotNull(r.VoucherId));
        Assert.Equal(2, report.Rows.Count(r => r.Kind == BooksRowKind.MonthTotal));
        Assert.Equal(2, report.Rows.Count(r => r.Kind == BooksRowKind.YearToDate));
        Assert.Equal(300.30m, entries.Sum(r => r.Debit));
    }

    [Fact]
    public void PriorMonthsCarryIntoOpeningAndYtdAndZeroMonthCarriesUnchanged()
    {
        var report = One(Fixture(), Cash(2, 4));
        Assert.Equal(1200m, report.OpeningBalance);
        Assert.Equal(.30m, report.PeriodDebit);
        Assert.Equal(300.30m, report.YearDebit);
        Assert.Equal(100m, report.YearCredit);
        Assert.Equal(new decimal[] { 1200.30m, 1200.30m, 1200.30m },
            report.Rows.Where(r => r.Kind == BooksRowKind.MonthTotal).Select(r => r.Balance));
        Assert.Equal(report.OpeningBalance + report.PeriodDebit - report.PeriodCredit, report.ClosingBalance);
    }

    [Fact]
    public void BankJournalPreservesSettlementLeadingZerosCounterpartAndOnlySelectedPeriod()
    {
        var report = One(Fixture(), new(BooksKind.BankJournal, "Q", "Q", 2, 2));
        Assert.Equal((2100m, 0m, 50m, 2050m, 100m, 50m),
            (report.OpeningBalance, report.PeriodDebit, report.PeriodCredit, report.ClosingBalance, report.YearDebit, report.YearCredit));
        var row = Assert.Single(report.Rows, r => r.Kind == BooksRowKind.Entry);
        Assert.Equal(("转账", "00123", "00045", "synthetic-pz-3-2", "E 费用"),
            (row.SettlementType, row.CheckNumber, row.BillNumber, row.SourceKey, row.CounterAccounts));
    }

    [Fact]
    public void GeneralLedgerIncludesClosingVoucherWithoutGuessingFromItsSummary()
    {
        var report = One(Fixture(), new(BooksKind.GeneralLedger, "R", "R", 2, 2));
        Assert.Equal((-300m, 300.30m, .30m, 0m),
            (report.OpeningBalance, report.PeriodDebit, report.PeriodCredit, report.ClosingBalance));
        Assert.DoesNotContain(report.Rows, r => r.Kind == BooksRowKind.Entry);
        Assert.Equal("平", report.Rows[^1].Direction);
        Assert.Equal(0m, report.Rows[^1].BalanceAmount);
        Assert.Throws<ArgumentException>(() => One(Fixture(), new(BooksKind.GeneralLedger, "R", "R", 1, 2, true)));
    }

    [Fact]
    public void OptionalUnpostedScopeAffectsEntriesOpeningAndTotalsTogether()
    {
        var included = One(Fixture(), Cash(2, 2, true));
        Assert.Equal(1220.30m, included.ClosingBalance);
        Assert.Contains(included.Rows, r => r.Status == VoucherStatus.Reviewed);
        var carry = One(Fixture(), Cash(3, 3, true));
        Assert.Equal(1220.30m, carry.OpeningBalance);
        var bank = One(Fixture(), new(BooksKind.BankJournal, "Q", "Q", 2, 2, true));
        Assert.Equal(2045m, bank.ClosingBalance);
        Assert.Contains(bank.Rows, r => r.Status == VoucherStatus.Draft);
    }

    [Fact]
    public void ParentAggregationFollowsTreeAndCreditBalanceHasDirectionAndPositiveDisplay()
    {
        Assert.Equal(One(Fixture(), Cash()).ClosingBalance,
            One(Fixture(), new(BooksKind.CashJournal, "A", "A", 1, 2)).ClosingBalance);
        var equity = One(Fixture(), new(BooksKind.GeneralLedger, "Z", "Z", 1, 2));
        Assert.Equal(-3300.30m, equity.ClosingBalance);
        Assert.Equal("贷", equity.Rows[^1].Direction);
        Assert.Equal(3300.30m, equity.Rows[^1].BalanceAmount);
        Assert.Throws<ArgumentException>(() => One(Fixture(), new(BooksKind.CashJournal, "Q", "Q", 1, 2)));
    }

    [Fact]
    public void ZeroAccountStillHasOpeningAndEveryMonthAndAccountRangesHaveNoGrandSum()
    {
        var result = BooksReportBuilder.Build(Fixture(), new(BooksKind.GeneralLedger, "N", "R", 1, 2));
        Assert.Equal(new[] { "N", "Q", "R" }, result.Accounts.Select(a => a.Account.Code));
        var zero = result.Accounts.First();
        Assert.Equal(5, zero.Rows.Count);
        Assert.All(zero.Rows, r => Assert.Equal(0, r.Balance));
    }

    [Fact]
    public void MidyearOpeningRequiresExplicitPriorYtdAndDoesNotTreatItAsNewActivity()
    {
        var input = Fixture();
        input = input with { Book = input.Book with { StartMonth = 4, ClosedThroughMonth = 3 }, Vouchers = [] };
        var query = new BooksQuery(BooksKind.BankJournal, "Q", "Q", 5, 5);
        Assert.Throws<ArgumentException>(() => One(input, query));
        input = input with { Accounts = input.Accounts.Select(a => a with {
            PreOpeningDebit = a.Code == "X9" ? 500 : a.Code == "Q" ? 200 : 0,
            PreOpeningCredit = a.Code == "X9" ? 100 : a.Code == "Q" ? 50 : a.Code == "Z" ? 550 : 0
        }).ToArray() };
        var report = One(input, query);
        Assert.Equal((2000m, 0m, 0m, 2000m, 200m, 50m),
            (report.OpeningBalance, report.PeriodDebit, report.PeriodCredit, report.ClosingBalance, report.YearDebit, report.YearCredit));
    }

    [Fact]
    public void RedLetterAmountsStayOnOriginalSideAndReduceActivityExactly()
    {
        var input = Fixture();
        input = input with { Vouchers = input.Vouchers.Append(V(9, 2, 11, VoucherStatus.Posted,
            L(1, "X9", -.10m, 0), L(2, "R", 0, -.10m))).ToArray() };
        var report = One(input, Cash());
        Assert.Equal(300.20m, report.PeriodDebit);
        Assert.Equal(1200.20m, report.ClosingBalance);
        Assert.Contains(report.Rows, r => r.Debit == -.10m && r.Credit == 0);
    }

    [Theory]
    [InlineData("cycle")][InlineData("missing-parent")][InlineData("duplicate-account")]
    [InlineData("parent-opening")][InlineData("opening-unbalanced")][InlineData("opening-fraction")]
    [InlineData("unknown-line")][InlineData("parent-line")][InlineData("unbalanced-voucher")]
    [InlineData("duplicate-id")][InlineData("duplicate-sequence")][InlineData("wrong-year")]
    [InlineData("invalid-status")][InlineData("two-sides")][InlineData("fraction")]
    public void InvalidLedgerIsRejectedBeforeProducingPlausibleResults(string defect)
    {
        var input = Fixture();
        var accounts = input.Accounts.ToArray(); var vouchers = input.Vouchers.ToArray();
        switch (defect)
        {
            case "cycle": accounts[0] = accounts[0] with { ParentCode = "X9" }; break;
            case "missing-parent": accounts[0] = accounts[0] with { ParentCode = "MISSING" }; break;
            case "duplicate-account": accounts[0] = accounts[1]; break;
            case "parent-opening": accounts[0] = accounts[0] with { OpeningDebit = 1 }; break;
            case "opening-unbalanced": accounts[1] = accounts[1] with { OpeningDebit = 999 }; break;
            case "opening-fraction": accounts[1] = accounts[1] with { OpeningDebit = 999.999m }; break;
            case "duplicate-id": vouchers[1] = vouchers[1] with { Id = vouchers[0].Id }; break;
            case "wrong-year": vouchers[0] = vouchers[0] with { Date = new(2027, 1, 5) }; break;
            case "invalid-status": vouchers[0] = vouchers[0] with { Status = (VoucherStatus)99 }; break;
            default:
                var lines = vouchers[0].Lines.ToArray();
                lines[0] = defect switch {
                    "unknown-line" => lines[0] with { AccountCode = "UNKNOWN" },
                    "parent-line" => lines[0] with { AccountCode = "B" },
                    "unbalanced-voucher" => lines[0] with { Debit = 99 },
                    "duplicate-sequence" => lines[0] with { Sequence = 2 },
                    "two-sides" => lines[0] with { Credit = 1 },
                    "fraction" => lines[0] with { Debit = 100.001m },
                    _ => throw new InvalidOperationException()
                };
                vouchers[0] = vouchers[0] with { Lines = lines }; break;
        }
        Assert.Throws<ArgumentException>(() => One(input with { Accounts = accounts, Vouchers = vouchers }, Cash()));
    }

    [Fact]
    public void ExportReusesSafeCsvAndHtmlAndDoesNotSumSubtotals()
    {
        var input = Fixture(); var vouchers = input.Vouchers.ToArray();
        vouchers[0] = vouchers[0] with { Lines = vouchers[0].Lines.Select(l => l with { Summary = "=1+1,<script>\"中文\"" }).ToArray() };
        var result = BooksReportBuilder.Build(input with { Vouchers = vouchers }, Cash());
        var doc = BooksDocumentBuilder.Create(result, "X9", DateTimeOffset.Parse("2026-03-01T00:00:00Z", CultureInfo.InvariantCulture));
        Assert.False(doc.IncludeTotal);
        Assert.Equal(result.Accounts.Single().Rows.Count, doc.Rows.Count);
        var csv = ReportExporter.ToCsv(doc);
        Assert.Contains("'=1+1", csv);
        Assert.Contains("1200.30", csv);
        using var writer = new StringWriter(); ReportExporter.WriteHtml(doc, writer);
        Assert.DoesNotContain("<script>", writer.ToString());
        Assert.Contains("&lt;script&gt;", writer.ToString());
        Assert.Contains("版本：17", doc.Note);
        Assert.Equal(16, doc.Columns.Count);
        Assert.All(doc.Rows, r => Assert.Equal(16, r.Cells.Count));
    }

    [Fact]
    public void EveryMonthPartitionCarriesTheSameClosingAndDoesNotRepeatYtdIntoPeriodTotals()
    {
        var input = Fixture();
        foreach (var (kind, code) in new[] { (BooksKind.CashJournal, "X9"), (BooksKind.BankJournal, "Q"), (BooksKind.GeneralLedger, "R") })
        {
            for (var start = 1; start <= 12; start++)
            {
                for (var end = start; end <= 12; end++)
                {
                    var all = One(input, new(kind, code, code, start, end));
                    var months = Enumerable.Range(start, end - start + 1).Select(m => One(input, new(kind, code, code, m, m))).ToArray();
                    Assert.Equal(all.PeriodDebit, months.Sum(m => m.PeriodDebit));
                    Assert.Equal(all.PeriodCredit, months.Sum(m => m.PeriodCredit));
                    Assert.Equal(all.OpeningBalance, months[0].OpeningBalance);
                    Assert.Equal(all.ClosingBalance, months[^1].ClosingBalance);
                    Assert.Equal(all.YearDebit, months[^1].YearDebit);
                    Assert.Equal(all.YearCredit, months[^1].YearCredit);
                    for (var i = 1; i < months.Length; i++) Assert.Equal(months[i - 1].ClosingBalance, months[i].OpeningBalance);
                }
            }
        }
    }
}
