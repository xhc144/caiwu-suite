using System.Text.Json;
using Caiwu.Costing;
using Caiwu.Costing.Parity;

namespace Caiwu.Costing.Tests;

public sealed class InventoryParityTests
{
    private static readonly DateOnly Date = new(2026, 10, 10);
    private static readonly InventoryAccount[] Accounts = [..new[] { "1405", "1122", "2202", "6001", "6401", "5001", "222101", "222102", "1901" }.Select(c => new InventoryAccount(c, true, true))];
    private static readonly InventoryVoucherSettings Settings = new("222101", "222102", "6001", "1901");
    private static InventoryBook New()
    {
        var b = InventoryWorkflow.Create(Guid.NewGuid(), new(2026, 10), new(4, 6), [new("01", "仓库", WarehouseKind.Warehouse), new("02", "车间", WarehouseKind.Workshop)]);
        return InventoryWorkflow.SaveProduct(b, new("P01", "合成产品", "规格", "件", "1405", null, 0, 10, 20, []), Accounts, "制单员", b.Revision);
    }
    private static InventoryBook Opening(InventoryBook b, decimal quantity, decimal amount, string warehouse = "01") =>
        InventoryWorkflow.SaveOpening(b, new(warehouse, "P01", quantity, amount, []), "制单员", b.Revision);
    private static InventoryDocument Doc(InventoryDocumentKind kind, string number, decimal qty, decimal net = 0, decimal tax = 0, string warehouse = "01") =>
        new(Guid.NewGuid(), number, kind == InventoryDocumentKind.Receipt ? "采购" : kind == InventoryDocumentKind.Sale ? "销售" : "领用", kind, Date, warehouse,
            "制单员", "合成测试", "合成票种", 13, kind == InventoryDocumentKind.Receipt ? "2202" : "1122", "6401", null, false,
            [new(1, "P01", qty, 0, 0, net, tax, net + tax, "合成行", [])], [], []);
    private static InventoryBook Save(InventoryBook b, InventoryDocument d) => InventoryWorkflow.SaveDocument(b, d, Accounts, "制单员", b.Revision);
    private static InventoryBook Calculate(InventoryBook b, bool adjust = false) => InventoryWorkflow.Calculate(b, adjust, "核算员", b.Revision);
    private static InventoryVoucherPlan Plan(InventoryBook b, InventoryVoucherKind kind) => InventoryVoucherPlanner.Plan(b, kind, new(2026, 10, 1), new(2026, 10, 31), Settings, Accounts);
    private static void Balanced(InventoryVoucherPlan plan) => Assert.All(plan.Vouchers, v =>
        Assert.Equal(v.Lines.Sum(l => l.Debit), v.Lines.Sum(l => l.Credit)));

    [Fact]
    public void MonthEndWeightedUsesLaterReceiptsRatherThanMovingAverage()
    {
        var b = Opening(New(), 10, 100);
        var sale = Doc(InventoryDocumentKind.Sale, "S1", 5, 150);
        b = Save(b, sale);
        b = Save(b, Doc(InventoryDocumentKind.Receipt, "R1", 10, 300) with { Date = new(2026, 10, 20) });
        b = Calculate(b);
        Assert.Equal(100, b.Calculation!.IssueCosts.Single().Amount); // (100+300)/(10+10)*5
        var t = Assert.Single(b.Calculation.Totals);
        Assert.Equal(15, t.ClosingQuantity); Assert.Equal(300, t.ClosingAmount);
        Assert.Equal(100, Plan(b, InventoryVoucherKind.IssueCost).Vouchers.Single().Lines.Single(l => l.AccountCode == "6401").Debit);
    }
    [Fact]
    public void WarehouseAndWorkshopCostsRemainSeparate()
    {
        var b = Opening(Opening(New(), 10, 100), 10, 500, "02");
        var a = Doc(InventoryDocumentKind.Sale, "S1", 2);
        var c = Doc(InventoryDocumentKind.Consumption, "C1", 2, warehouse: "02") with { CostAccount = "5001" };
        b = Calculate(Save(Save(b, a), c));
        Assert.Equal(20, b.Calculation!.IssueCosts.Single(x => x.DocumentId == a.Id).Amount);
        Assert.Equal(100, b.Calculation.IssueCosts.Single(x => x.DocumentId == c.Id).Amount);
        Assert.Equal(80, b.Calculation.Totals.Single(t => t.WarehouseCode == "01").ClosingAmount);
        Assert.Equal(400, b.Calculation.Totals.Single(t => t.WarehouseCode == "02").ClosingAmount);
    }
    [Fact]
    public void CumulativeRoundingConservesLastCentAndFullIssueClearsCost()
    {
        var b = Opening(New(), 3, 0.01m);
        for (var i = 1; i <= 3; i++) b = Save(b, Doc(InventoryDocumentKind.Sale, $"S{i}", 1));
        b = Calculate(b);
        Assert.Equal(new[] { 0m, .01m, 0m }, b.Calculation!.IssueCosts.Select(c => c.Amount));
        Assert.Equal(0, b.Calculation.Totals.Single().ClosingAmount);
        Assert.Equal(.01m, b.Calculation.IssueCosts.Sum(c => c.Amount));
    }
    [Theory]
    [InlineData(6, -2, -20, 60)]
    [InlineData(9, 1, 10, 90)]
    public void StocktakeRevaluesActualQuantityAndProducesBalancedDifference(decimal actual, decimal diffQty, decimal diffAmount, decimal closing)
    {
        var b = Save(Opening(New(), 10, 100), Doc(InventoryDocumentKind.Sale, "S1", 2));
        b = InventoryWorkflow.SaveStocktake(b, new("01", "P01", actual, []), "盘点员", b.Revision);
        b = Calculate(b); var t = b.Calculation!.Totals.Single();
        Assert.Equal(diffQty, t.StocktakeQuantityDifference); Assert.Equal(diffAmount, t.StocktakeAmountDifference); Assert.Equal(closing, t.ClosingAmount);
        Assert.Equal(t.OpeningAmount + t.ReceiptAmount - t.IssueAmount + t.StocktakeAmountDifference, t.ClosingAmount);
        Balanced(Plan(b, InventoryVoucherKind.Stocktake));
    }
    [Fact]
    public void ZeroQuantityResidualNeedsExplicitAdjustmentAndBalancesLoss()
    {
        var b = Opening(New(), 0, 1.23m);
        Assert.Throws<CostingValidationException>(() => Calculate(b));
        b = Calculate(b, true);
        Assert.Equal(-1.23m, b.Calculation!.Totals.Single().StocktakeAmountDifference);
        Assert.Equal(1.23m, Plan(b, InventoryVoucherKind.Stocktake).Vouchers.Single().Lines.Single(l => l.AccountCode == "1901").Debit);
    }
    [Fact]
    public void ReceiptAndSalePlansUseConfirmedTaxAmountsAndAccounts()
    {
        var b = Save(New(), Doc(InventoryDocumentKind.Receipt, "R1", 10, 100, 13));
        b = Save(b, Doc(InventoryDocumentKind.Sale, "S1", 3, 60, 7.8m));
        var receipt = Plan(b, InventoryVoucherKind.Receipt); var sale = Plan(b, InventoryVoucherKind.SalesRevenue);
        Balanced(receipt); Balanced(sale);
        Assert.Equal(100, receipt.Vouchers.Single().Lines.Single(l => l.AccountCode == "1405").Debit);
        Assert.Equal(13, receipt.Vouchers.Single().Lines.Single(l => l.AccountCode == "222101").Debit);
        Assert.Equal(113, receipt.Vouchers.Single().Lines.Single(l => l.AccountCode == "2202").Credit);
        Assert.Equal(67.8m, sale.Vouchers.Single().Lines.Single(l => l.AccountCode == "1122").Debit);
        Assert.Equal(7.8m, sale.Vouchers.Single().Lines.Single(l => l.AccountCode == "222102").Credit);
        Assert.Equal(100, Calculate(b).Calculation!.Totals.Single().ReceiptAmount); // input tax is excluded, not silently capitalized
    }
    [Fact]
    public void CalculatedPeriodLocksMutationsAndCancelRestoresEditability()
    {
        var b = Save(Opening(New(), 10, 100), Doc(InventoryDocumentKind.Sale, "S1", 2));
        b = Calculate(b); var id = b.Documents.Single().Id;
        Assert.Throws<CostingValidationException>(() => Save(b, Doc(InventoryDocumentKind.Receipt, "R1", 1, 10)));
        Assert.Throws<CostingValidationException>(() => Opening(b, 20, 100));
        Assert.Throws<CostingValidationException>(() => InventoryWorkflow.DeleteDocument(b, id, "操作员", b.Revision));
        Assert.Equal(80, InventoryWorkflow.CurrentStock(b).Single().Amount);
        b = InventoryWorkflow.CancelCalculation(b, "核算员", b.Revision);
        Assert.Null(b.Calculation); Assert.Null(InventoryWorkflow.CurrentStock(b).Single().Amount);
        Assert.Equal(2, Save(b, Doc(InventoryDocumentKind.Receipt, "R1", 1, 10)).Documents.Count);
        Assert.Throws<CostingValidationException>(() => InventoryWorkflow.CancelCalculation(b, "核算员", b.Revision));
    }
    [Fact]
    public void ReviewAndVoucherLinksProtectDocumentsAndReviewerIdentity()
    {
        var b = Save(New(), Doc(InventoryDocumentKind.Receipt, "R1", 1, 10)); var d = b.Documents.Single();
        b = InventoryWorkflow.ReviewDocument(b, d.Id, true, "审核员", b.Revision);
        Assert.Throws<CostingValidationException>(() => InventoryWorkflow.DeleteDocument(b, d.Id, "操作员", b.Revision));
        Assert.Throws<CostingValidationException>(() => InventoryWorkflow.ReviewDocument(b, d.Id, false, "其他人", b.Revision));
        b = InventoryWorkflow.ReviewDocument(b, d.Id, false, "审核员", b.Revision);
        var plan = Plan(b, InventoryVoucherKind.Receipt);
        b = InventoryWorkflow.LinkDraft(b, plan, d.Id, InventoryVoucherKind.Receipt, "voucher-1", "制单员", b.Revision);
        Assert.Throws<CostingValidationException>(() => Save(b, d));
        Assert.Throws<CostingValidationException>(() => InventoryWorkflow.DeleteDocument(b, d.Id, "制单员", b.Revision));
        Assert.Throws<CostingValidationException>(() => Plan(b, InventoryVoucherKind.Receipt));
    }
    [Fact]
    public void CostLinkBlocksCancellationAndStalePlanIsRejected()
    {
        var b = Calculate(Save(Opening(New(), 2, 20), Doc(InventoryDocumentKind.Sale, "S1", 1)));
        var plan = Plan(b, InventoryVoucherKind.IssueCost);
        var cancelled = InventoryWorkflow.CancelCalculation(b, "核算员", b.Revision);
        Assert.Throws<CostingConcurrencyException>(() => InventoryVoucherPlanner.ValidateSource(cancelled, plan));
        var linked = InventoryWorkflow.LinkDraft(b, plan, b.Documents.Single().Id, InventoryVoucherKind.IssueCost, "voucher-1", "制单员", b.Revision);
        Assert.Throws<CostingValidationException>(() => InventoryWorkflow.CancelCalculation(linked, "核算员", linked.Revision));
    }
    [Fact]
    public void InsufficientStockNeedsConfirmationAndInsufficientMonthlyBasisCannotCalculate()
    {
        var b = Opening(New(), 1, 10); var d = Doc(InventoryDocumentKind.Sale, "S1", 2);
        Assert.Throws<CostingValidationException>(() => Save(b, d)); Assert.Empty(b.Documents);
        b = Save(b, d with { NegativeStockConfirmed = true });
        Assert.Equal(-1, InventoryWorkflow.CurrentStock(b).Single().Quantity);
        Assert.Throws<CostingValidationException>(() => Calculate(b));
        b = Save(b, Doc(InventoryDocumentKind.Receipt, "R1", 1, 20));
        Assert.Equal(30, Calculate(b).Calculation!.IssueCosts.Single().Amount);
    }
    [Fact]
    public void ConcurrencyDuplicateNumberAndMalformedMoneyFailWithoutMutation()
    {
        var b = New(); var d = Doc(InventoryDocumentKind.Receipt, "R1", 2, 10);
        Assert.Throws<CostingConcurrencyException>(() => InventoryWorkflow.SaveDocument(b, d, Accounts, "操作员", b.Revision - 1));
        Assert.Throws<CostingValidationException>(() => Save(b, d with { Lines = [d.Lines[0] with { GrossAmount = 11 }] }));
        Assert.Empty(b.Documents);
        b = Save(b, d);
        Assert.Throws<CostingValidationException>(() => Save(b, d with { Id = Guid.NewGuid() }));
        Assert.Single(b.Documents);
    }
    [Fact]
    public void LeafAndActiveAccountChecksAreRequiredForDocumentAndPlan()
    {
        var b = New(); var d = Doc(InventoryDocumentKind.Receipt, "R1", 1, 10, 1);
        Assert.Throws<CostingValidationException>(() => InventoryWorkflow.SaveDocument(b, d, [], "操作员", b.Revision));
        b = Save(b, d);
        var bad = Accounts.Select(a => a.Code == "222101" ? a with { Leaf = false } : a).ToArray();
        Assert.Throws<CostingValidationException>(() => InventoryVoucherPlanner.Plan(b, InventoryVoucherKind.Receipt, Date, Date, Settings, bad));
    }
    [Fact]
    public void UsedProductCannotBeDeletedAndCrossPeriodIsRejected()
    {
        var b = Opening(New(), 1, 10);
        Assert.Throws<CostingValidationException>(() => InventoryWorkflow.DeleteProduct(b, "P01", "操作员", b.Revision));
        Assert.Throws<CostingValidationException>(() => Save(b, Doc(InventoryDocumentKind.Receipt, "R1", 1, 10) with { Date = new(2026, 11, 1) }));
    }
    [Fact]
    public void RawVariantFieldsNullAndTrailingSpacesSurviveEditsAndJsonRoundTrip()
    {
        var cells = new Dictionary<string, OriginalCell> { ["unknown_variant"] = new("double", "1.0000000000000002"), ["sm"] = new("char(40)", "原值  "), ["nullable"] = new("char(10)", null), ["binary_variant"] = new("long binary", null, "AAEC/w==") };
        var raw = new OriginalRow("pjnr1", "original-row-7", "synthetic-schema-variant-6", cells);
        var b = New(); var doc = Doc(InventoryDocumentKind.Receipt, "R1", 1, 10) with { OriginalRows = [raw] };
        b = Save(b, doc); cells["sm"] = new("char(40)", "external mutation");
        b = Save(b, b.Documents.Single() with { Summary = "edited projection", OriginalRows = [] });
        var restored = JsonSerializer.Deserialize<InventoryBook>(JsonSerializer.Serialize(b))!;
        var saved = restored.Documents.Single().OriginalRows.Single();
        Assert.Equal("原值  ", saved.Cells["sm"].Value); Assert.Null(saved.Cells["nullable"].Value);
        Assert.Equal("1.0000000000000002", saved.Cells["unknown_variant"].Value);
        Assert.Equal("AAEC/w==", saved.Cells["binary_variant"].RawBytesBase64);
        Assert.Equal("edited projection", restored.Documents.Single().Summary);
        Assert.Single(InventoryWorkflow.CurrentStock(restored));
    }
    [Fact]
    public void RemovalOfDetailKeepsOriginalDetailProvenance()
    {
        var b = Opening(New(), 10, 100); var d = Doc(InventoryDocumentKind.Sale, "S1", 1);
        var row = new OriginalRow("pjnr2", "line-2", "synthetic", new Dictionary<string, OriginalCell> { ["extra"] = new("char(40)", "preserved") });
        d = d with { Lines = [d.Lines[0], d.Lines[0] with { Sequence = 2, OriginalRows = [row] }] }; b = Save(b, d);
        b = Save(b, d with { Lines = [d.Lines[0]] });
        Assert.Contains(b.Documents.Single().OriginalRows, r => r.SourceIdentity == "line-2");
    }
    [Fact]
    public void CalculationAndAuditAreImmutableAndDocumentOrderingDoesNotAffectCost()
    {
        var b = Opening(New(), 3, 1); b = Save(b, Doc(InventoryDocumentKind.Sale, "S2", 1)); b = Save(b, Doc(InventoryDocumentKind.Sale, "S1", 1));
        var x = Calculate(b); var y = Calculate(b with { Documents = b.Documents.Reverse().ToArray() });
        Assert.Equal(x.Calculation!.IssueCosts, y.Calculation!.IssueCosts);
        Assert.Equal(.67m, x.Calculation.IssueCosts.Sum(c => c.Amount)); Assert.Equal(.33m, x.Calculation.Totals.Single().ClosingAmount);
        Assert.Equal(x.Revision, x.Audit.Last().Revision); Assert.Null(b.Calculation);
        Assert.Throws<NotSupportedException>(() => ((IList<IssueCost>)x.Calculation.IssueCosts).Clear());
    }
    [Fact]
    public void HighPrecisionInputIsRejectedInsteadOfSilentlyRounding()
    {
        var b = New(); var d = Doc(InventoryDocumentKind.Receipt, "R1", 1.00001m, 10);
        Assert.Throws<CostingValidationException>(() => Save(b, d));
        Assert.Throws<CostingValidationException>(() => Opening(b, 1, 1.001m));
        Assert.Empty(b.Openings); Assert.Empty(b.Documents);
    }
    [Fact]
    public void ConsumptionHasCostPlanButNoSalesRevenuePlan()
    {
        var b = Save(Opening(New(), 5, 50), Doc(InventoryDocumentKind.Consumption, "C1", 2) with { CostAccount = "5001" });
        Assert.Throws<CostingValidationException>(() => Plan(b, InventoryVoucherKind.SalesRevenue));
        Assert.Throws<CostingValidationException>(() => Plan(b, InventoryVoucherKind.IssueCost));
        var plan = Plan(Calculate(b), InventoryVoucherKind.IssueCost); Balanced(plan);
        Assert.Equal(20, plan.Vouchers.Single().Lines.Single(l => l.AccountCode == "5001").Debit);
    }
    [Fact]
    public void StocktakeClaimBlocksCancellationAndSameSourceCannotBePlannedAgain()
    {
        var b = Opening(New(), 10, 100);
        b = InventoryWorkflow.SaveStocktake(b, new("01", "P01", 9, []), "盘点员", b.Revision);
        b = Calculate(b); var plan = Plan(b, InventoryVoucherKind.Stocktake);
        b = InventoryWorkflow.ClaimPlan(b, plan, plan.Vouchers.Single().SourceKey, Guid.NewGuid(), "操作员", b.Revision);
        Assert.Throws<CostingValidationException>(() => InventoryWorkflow.CancelCalculation(b, "操作员", b.Revision));
        Assert.Throws<CostingValidationException>(() => Plan(b, InventoryVoucherKind.Stocktake));
    }
    [Fact]
    public void TamperedCalculationCannotServeAsCurrentInventoryOrVoucherSource()
    {
        var b = Calculate(Save(Opening(New(), 10, 100), Doc(InventoryDocumentKind.Sale, "S1", 2)));
        var tampered = b with { Calculation = b.Calculation! with { Totals = [b.Calculation.Totals[0] with { ClosingAmount = 800 }] } };
        Assert.Throws<CostingValidationException>(() => InventoryWorkflow.CurrentStock(tampered));
        Assert.Throws<CostingValidationException>(() => Plan(tampered, InventoryVoucherKind.IssueCost));
    }

}
