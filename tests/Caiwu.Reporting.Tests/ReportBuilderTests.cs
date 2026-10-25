using Caiwu.Contracts;

namespace Caiwu.Reporting.Tests;

public sealed class ReportBuilderTests
{
    internal static readonly Guid BookId = Guid.Parse("00000000-0000-0000-0000-000000000001");
    internal static readonly DateOnly From = new(2026, 1, 1);
    internal static readonly DateOnly To = new(2026, 1, 31);
    internal static BookInfo Book(string name = "中文账套 🧾", AccountingRegime regime = AccountingRegime.SmallBusiness) =>
        new(BookId, name, regime, "small-business-demo-2026-v1", 2026, 1, 0,
            new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero));
    internal static ReportMetadata Metadata(IEnumerable<ReportSource>? sources = null) =>
        new(Book(), From, To, new DateTimeOffset(2026, 2, 1, 10, 20, 30, TimeSpan.FromHours(8)), sources);
    internal static Account A(string code, string name, string? parent = null) =>
        new(code, name, parent, BalanceDirection.Debit, true, 0, 0);
    internal static TrialBalanceRow B(string code, bool leaf, decimal closing = 0) =>
        new(code, "科目 " + code, leaf, 0, 0, 0, 0, closing, 0);
    internal static Voucher V(int number, decimal amount = 0.1m, VoucherStatus status = VoucherStatus.Posted) =>
        new(Guid.NewGuid(), new DateOnly(2026, 1, 10), "记", number, 2, "制单员", "审核员", status,
            [new("1002", "收到款项", amount, 0), new("6001", "主营收入", 0, amount)]);

    [Fact]
    public void IndependentContractSampleTotalsOnlyLeafRows()
    {
        // Independently hand-calculated fixture from IMPLEMENTATION_CONTRACT.md; no Core dependency.
        TrialBalanceRow[] balances = [
            new("1002", "银行存款", true, 100000m, 0, 20000m, 11200m, 108800m, 0),
            new("1403", "原材料", true, 0, 0, 10000m, 0, 10000m, 0),
            new("4001", "实收资本", true, 0, 100000m, 0, 0, 0, 100000m),
            new("6001", "主营业务收入", true, 0, 0, 0, 20000m, 0, 20000m),
            new("6602", "管理费用", false, 0, 0, 1200m, 0, 1200m, 0),
            new("6602-01", "办公费用", true, 0, 0, 1200m, 0, 1200m, 0),
            B("9999", true)
        ];
        var report = ReportBuilder.TrialBalance(Metadata(), balances,
            [A("6602", "管理费用"), A("6602-01", "办公费用", "6602")]);
        Assert.Equal(7, report.Rows.Count);
        Assert.Equal(new decimal?[] { 100000m, 100000m, 31200m, 31200m, 120000m, 120000m },
            report.Total.Cells.Skip(4).Select(c => c.Amount));
        Assert.Equal(1, report.Rows.Single(r => r.AccountCode == "6602-01").AccountDepth);
        Assert.Contains(report.Rows, r => r.AccountCode == "9999" && r.Cells[8].Amount == 0m);
        Assert.Equal("科目余额表", report.Title);
        Assert.Contains("未经法定财报项目映射", report.Note);
    }

    [Fact]
    public void HierarchyUsesExplicitParentsAndKeepsSignedAmounts()
    {
        var report = ReportBuilder.TrialBalance(Metadata(), [B("root", false), B("child", false), B("α🧾", true, -0.20m)],
            [A("root", "总科目"), A("child", "二级", "root"), A("α🧾", "三级", "child")]);
        var row = report.Rows.Single(r => r.AccountCode == "α🧾");
        Assert.Equal(2, row.AccountDepth);
        Assert.True(row.IsLeaf);
        Assert.Equal("3", row.Cells[2].DisplayText);
        Assert.Equal(-0.20m, report.Total.Cells[8].Amount);
        Assert.Equal("-0.20", row.Cells[8].DisplayText);
    }

    [Fact]
    public void LedgerPreservesOpeningOrderDrillThroughAndDebitPositiveConvention()
    {
        var id = Guid.Parse("00000000-0000-0000-0000-000000000007");
        LedgerEntryRow[] entries = [
            new(null, null, "", null, "期初余额", 0, 0, 0.10m),
            new(new DateOnly(2026, 1, 20), id, "记", 3, "支出 中文 \"🧾\"", 0, 0.30m, -0.20m),
            new(new DateOnly(2026, 1, 20), id, "记", 3, "退回", 0.20m, 0, 0)
        ];
        var report = ReportBuilder.Ledger(Metadata(), "1002/01", entries, [A("1002/01", "银行 / 子科目")]);
        Assert.Equal("期初余额", report.Rows[0].Cells[5].DisplayText);
        Assert.Null(report.Rows[0].VoucherId);
        Assert.Equal("", report.Rows[0].Cells[2].DisplayText);
        Assert.Equal(id, report.Rows[1].VoucherId);
        Assert.Equal("贷", report.Rows[1].Cells[8].DisplayText);
        Assert.Equal(-0.20m, report.Rows[1].Cells[9].Amount);
        Assert.Equal("平", report.Rows[2].Cells[8].DisplayText);
        Assert.Equal(0.20m, report.Total.Cells[6].Amount);
        Assert.Equal(0.30m, report.Total.Cells[7].Amount);
        Assert.Null(report.Total.Cells[9].Amount); // Running balances must never be summed.
    }

    [Fact]
    public void UnknownAccountsAndDtoNamesRemainVisible()
    {
        var ledger = ReportBuilder.Ledger(Metadata(), "未知/🧾", [new(null, null, "", null, "期初余额", 0, 0, 0)]);
        Assert.Equal("未知/🧾", ledger.Rows[0].AccountCode);
        Assert.Equal("未知科目", ledger.Rows[0].Cells[1].DisplayText);
        var balance = ReportBuilder.TrialBalance(Metadata(), [new("???", "原 DTO 名称", true, 0, 0, 0, 0, 0, 0)]);
        Assert.Equal("原 DTO 名称", balance.Rows[0].Cells[1].DisplayText);
        var voucher = ReportBuilder.VoucherList(Metadata(), [V(1)]);
        Assert.Equal("1002\n6001", voucher.Rows[0].Cells[4].DisplayText);
        Assert.Equal("未知科目\n未知科目", voucher.Rows[0].Cells[5].DisplayText);
    }

    [Fact]
    public void VoucherListFiltersPeriodAndOptionalStatusAndKeepsExactTotals()
    {
        var posted = V(2, 0.2m);
        var draft = V(1, 0.1m, VoucherStatus.Draft);
        var outside = V(3) with { Date = new DateOnly(2026, 2, 1) };
        var before = V(4) with { Date = new DateOnly(2025, 12, 31) };
        var report = ReportBuilder.VoucherList(Metadata(), [posted, outside, draft, before]);
        Assert.Equal(new[] { draft.Id, posted.Id }, report.Rows.Select(r => r.VoucherId!.Value));
        Assert.Equal(0.30m, report.Total.Cells[7].Amount);
        Assert.Equal(0.30m, report.Total.Cells[8].Amount);
        Assert.Equal("草稿", report.Rows[0].Cells[3].DisplayText);
        Assert.Equal("已记账", report.Rows[1].Cells[3].DisplayText);
        var filtered = ReportBuilder.VoucherList(Metadata(), [draft, posted], status: VoucherStatus.Posted);
        Assert.Single(filtered.Rows);
        Assert.Equal(posted.Id, filtered.Rows[0].VoucherId);
        Assert.Contains("已记账", filtered.Note);
    }

    [Fact]
    public void EndpointsAreInclusiveAndInputCollectionsAreSnapshotted()
    {
        var sources = new List<ReportSource> { new("规则原文", "https://example.org/规则?a=1&b=中文") };
        var metadata = Metadata(sources);
        sources.Clear();
        var vouchers = new List<Voucher> { V(1) with { Date = From }, V(2) with { Date = To } };
        var report = ReportBuilder.VoucherList(metadata, vouchers);
        vouchers.Clear();
        Assert.Equal(2, report.Rows.Count);
        Assert.Single(metadata.Sources);
        Assert.Equal("https://example.org/规则?a=1&b=中文", metadata.Sources[0].Address);
        Assert.Throws<NotSupportedException>(() => ((IList<ReportRow>)report.Rows).Clear());
        Assert.Throws<NotSupportedException>(() => ((IList<ReportCell>)report.Rows[0].Cells).Clear());
    }

    [Fact]
    public void EmptyReportsHaveZeroTotalsAndNoInventedEntries()
    {
        var balance = ReportBuilder.TrialBalance(Metadata(), []);
        var ledger = ReportBuilder.Ledger(Metadata(), "1002", []);
        var vouchers = ReportBuilder.VoucherList(Metadata(), []);
        foreach (var report in new[] { balance, ledger, vouchers })
        {
            Assert.Empty(report.Rows);
            Assert.All(report.Total.Cells.Where(c => c.Amount.HasValue), c => Assert.Equal(0m, c.Amount));
            Assert.Equal(report.Columns.Count, report.Total.Cells.Count);
        }
    }

    [Fact]
    public void AllMoneyFieldsRejectSubCentPrecisionInsteadOfRounding()
    {
        Assert.Throws<ArgumentException>(() => ReportBuilder.TrialBalance(Metadata(), [B("1002", true, 0.001m)]));
        Assert.Throws<ArgumentException>(() => ReportBuilder.VoucherList(Metadata(), [V(1, 0.001m)]));
        Assert.Throws<ArgumentException>(() => ReportBuilder.Ledger(Metadata(), "1002", [new(null, null, "", null, "", 0, 0, 0.001m)]));
    }

    [Fact]
    public void DecimalLimitsAreExactAndOverflowFailsExplicitly()
    {
        var report = ReportBuilder.TrialBalance(Metadata(), [B("max", true, decimal.MaxValue)]);
        Assert.Equal("79228162514264337593543950335.00", report.Rows[0].Cells[8].DisplayText);
        Assert.Throws<OverflowException>(() => ReportBuilder.TrialBalance(Metadata(),
            [B("max", true, decimal.MaxValue), B("extra", true, 1m)]));
    }

    [Fact]
    public void RejectDuplicateRowsAndCircularCatalogInsteadOfDoubleCountingOrHanging()
    {
        var voucher = V(1);
        Assert.Throws<ArgumentException>(() => ReportBuilder.VoucherList(Metadata(), [voucher, voucher]));
        Assert.Throws<ArgumentException>(() => ReportBuilder.TrialBalance(Metadata(), [B("1002", true), B("1002", true)]));
        Assert.Throws<ArgumentException>(() => ReportBuilder.TrialBalance(Metadata(), [B("a", true)], [A("a", "A", "b"), A("b", "B", "a")]));
    }

    [Fact]
    public void RejectMislabelledPeriodsAndUnknownRegimesOrStatuses()
    {
        Assert.Throws<ArgumentException>(() => new ReportMetadata(Book(), To, From, DateTimeOffset.UtcNow));
        Assert.Throws<ArgumentException>(() => new ReportMetadata(Book(), From, new DateOnly(2027, 1, 1), DateTimeOffset.UtcNow));
        Assert.Throws<ArgumentException>(() => new ReportMetadata(Book() with { StartMonth = 2 }, From, To, DateTimeOffset.UtcNow));
        Assert.Throws<ArgumentException>(() => new ReportMetadata(Book(regime: (AccountingRegime)99), From, To, DateTimeOffset.UtcNow));
        Assert.Throws<ArgumentException>(() => new ReportMetadata(Book() with { TemplateVersion = " " }, From, To, DateTimeOffset.UtcNow));
        Assert.Throws<ArgumentException>(() => new ReportMetadata(Book(), From, To, default));
        Assert.Throws<ArgumentOutOfRangeException>(() => ReportBuilder.VoucherList(Metadata(), [V(1, status: (VoucherStatus)99)]));
        Assert.Throws<ArgumentOutOfRangeException>(() => ReportBuilder.VoucherList(Metadata(), [], status: (VoucherStatus)99));
        Assert.Throws<ArgumentException>(() => ReportBuilder.Ledger(Metadata(), "1002", [new(new DateOnly(2026, 2, 1), null, "", null, "", 0, 0, 0)]));
    }

    [Theory]
    [InlineData(AccountingRegime.SmallBusiness, "小企业")]
    [InlineData(AccountingRegime.Enterprise, "企业")]
    [InlineData(AccountingRegime.Nonprofit, "民间非营利组织")]
    public void RegimeLabelsDoNotInventStatutoryStatements(AccountingRegime regime, string label)
    {
        var metadata = new ReportMetadata(Book(regime: regime), From, To, DateTimeOffset.UtcNow);
        var report = ReportBuilder.TrialBalance(metadata, []);
        Assert.Equal(label, metadata.RegimeName);
        Assert.Equal(ReportKind.TrialBalance, report.Kind);
        Assert.DoesNotContain("资产负债表", report.Title);
        Assert.DoesNotContain("利润表", report.Title);
        Assert.DoesNotContain("民非报表", report.Title);
    }
}
