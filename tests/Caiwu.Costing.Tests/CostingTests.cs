using System.Globalization;
using System.Text.Json;

namespace Caiwu.Costing.Tests;

public sealed class CostingTests
{
    private static readonly DateOnly Day = new(2026, 1, 1);
    private static readonly CostPeriod Period = new(2026, 1);
    private static StockItem[] Items() => [new("G", "商品", "件", ItemKind.TradingGoods), new("R", "材料", "千克", ItemKind.RawMaterial),
        new("P", "产品甲", "件", ItemKind.FinishedProduct), new("Q", "产品乙", "件", ItemKind.FinishedProduct), new("T", "产品丙", "件", ItemKind.FinishedProduct)];
    private static InventorySnapshot Stock(params StockPosition[] openings) => InventoryCosting.Create(Guid.NewGuid(), Period, Items(), openings);
    private static PurchaseReceipt Purchase(decimal quantity = 1, decimal price = 10, string code = "G") =>
        new(Guid.NewGuid(), Day, code, quantity, InventoryCosting.PolicyVersion, new(price, 0, 0, 0));
    private static SaleIssue Sell(decimal quantity = 1, string code = "G") => new(Guid.NewGuid(), Day, code, quantity, InventoryCosting.PolicyVersion);
    private static MaterialIssue Issue(decimal quantity, string costObject) => new(Guid.NewGuid(), Day, "R", quantity, InventoryCosting.PolicyVersion, costObject);
    private static InventoryResult Apply(InventorySnapshot s, InventoryOperation op) => InventoryCosting.Apply(s, op, s.Revision);
    private static string Data(object obj) => JsonSerializer.Serialize(obj);
    private static void Reject(InventorySnapshot s, InventoryOperation op)
    {
        var before = Data(s);
        Assert.Throws<CostingValidationException>(() => Apply(s, op));
        Assert.Equal(before, Data(s));
    }
    private static ProductionSnapshot Production(InventorySnapshot s, AllocationBasis labor = AllocationBasis.OutputQuantity,
        AllocationBasis overhead = AllocationBasis.OutputQuantity) => ProductionCosting.Create(s.InventoryId, s.Period, labor, overhead);
    private static ProductionRequest Request(IReadOnlyList<ProductionOutput>? products = null, decimal labor = 0, decimal overhead = 0,
        IReadOnlyList<Guid>? sources = null) => new(Guid.NewGuid(), Day, ProductionCosting.PolicyVersion,
            products ?? [new("A", "P", 1, 0, 0)], sources ?? [], labor, overhead);
    private static void RejectProduction(ProductionSnapshot p, InventorySnapshot s, ProductionRequest request)
    {
        var before = Data(p);
        var stock = Data(s);
        Assert.Throws<CostingValidationException>(() => ProductionCosting.Allocate(p, s, request, p.Revision));
        Assert.Equal(before, Data(p)); Assert.Equal(stock, Data(s));
    }
    private static void Balanced(IEnumerable<PendingCostVoucher> suggestions)
    {
        foreach (var v in suggestions)
        {
            Assert.Equal(CostVoucherStatus.PendingAccountingReview, v.Status);
            Assert.Equal(v.Lines.Sum(l => l.Debit), v.Lines.Sum(l => l.Credit));
            Assert.All(v.Lines, l => Assert.True(l.Debit > 0 && l.Credit == 0 || l.Credit > 0 && l.Debit == 0));
        }
    }

    [Fact]
    public void Trade_hand_calculated_moving_average_separates_expense_and_restores_original_sale_cost()
    {
        var s = Stock(new StockPosition("G", 10, 100));
        var purchase = Purchase(10, 12) with { Costs = new(12, 10, 2, 3) };
        var r = Apply(s, purchase); s = r.Snapshot;
        Assert.Equal(132m, r.Movement.Cost);
        Assert.Equal(new("G", 20, 232), s.Positions.Single(p => p.ItemCode == "G"));
        Assert.Equal(11.6m, s.Positions.Single(p => p.ItemCode == "G").AverageUnitCost);
        var suggestion = Assert.Single(r.VoucherSuggestions);
        Assert.Equal(s.InventoryId, suggestion.InventoryId);
        Assert.Equal(CostVoucherOrigin.Inventory, suggestion.Origin);
        Assert.Equal(132m, suggestion.Lines.Single(l => l.AccountRole == CostAccountRole.TradingInventory).Debit);
        Assert.Equal(3m, suggestion.Lines.Single(l => l.AccountRole == CostAccountRole.PurchasePeriodExpense).Debit);
        Assert.Equal(135m, suggestion.Lines.Single(l => l.AccountRole == CostAccountRole.AccountsPayable).Credit);
        var sale = Apply(s, Sell(6)); s = sale.Snapshot;
        Assert.Equal(69.60m, sale.Movement.Cost);
        Assert.Equal(new("G", 14, 162.40m), s.Positions.Single(p => p.ItemCode == "G"));
        s = Apply(s, Purchase(6, 15)).Snapshot;
        Assert.Equal(new("G", 20, 252.40m), s.Positions.Single(p => p.ItemCode == "G"));
        var returned = Apply(s, new CustomerReturn(Guid.NewGuid(), Day, "G", 2, InventoryCosting.PolicyVersion, sale.Movement.BusinessId)); s = returned.Snapshot;
        Assert.Equal(23.20m, returned.Movement.Cost);
        Assert.Equal(new("G", 22, 275.60m), s.Positions.Single(p => p.ItemCode == "G"));
        Assert.Equal(12.527273m, s.Positions.Single(p => p.ItemCode == "G").AverageUnitCost);
        Assert.Equal(CostAccountRole.CostOfSales, returned.VoucherSuggestions.Single().Lines.Single(l => l.Credit > 0).AccountRole);
        var close = Apply(s, Sell(22));
        Assert.Equal(275.60m, close.Movement.Cost);
        Assert.Equal(new("G", 0, 0), close.Snapshot.Positions.Single(p => p.ItemCode == "G"));
        Balanced(r.VoucherSuggestions.Concat(sale.VoucherSuggestions).Concat(returned.VoucherSuggestions).Concat(close.VoucherSuggestions));
        Assert.Equal(0L, Stock().Revision);
    }

    [Fact]
    public void Quantity_amount_conservation_clears_the_last_issue_residual()
    {
        var s = Stock(new StockPosition("G", 3, 0.02m));
        var one = Apply(s, Sell());
        var two = Apply(one.Snapshot, Sell());
        var three = Apply(two.Snapshot, Sell());
        Assert.Equal(0.01m, one.Movement.Cost);
        Assert.Equal(0.01m, two.Movement.Cost);
        Assert.Equal(0m, three.Movement.Cost);
        Assert.Empty(three.VoucherSuggestions);
        Assert.Equal(new("G", 0, 0), three.Snapshot.Positions.Single(p => p.ItemCode == "G"));
    }

    [Fact]
    public void Returns_allocate_cumulative_original_cost_so_partial_rounding_cannot_over_refund()
    {
        var sold = Apply(Stock(new StockPosition("G", 3, 0.02m)), Sell(3));
        CustomerReturn Return() => new(Guid.NewGuid(), Day, "G", 1, InventoryCosting.PolicyVersion, sold.Movement.BusinessId);
        var first = Apply(sold.Snapshot, Return());
        var second = Apply(first.Snapshot, Return());
        var third = Apply(second.Snapshot, Return());
        Assert.Equal(0.01m, first.Movement.Cost);
        Assert.Equal(0m, second.Movement.Cost);
        Assert.Equal(0.01m, third.Movement.Cost);
        Assert.Equal(new("G", 3, 0.02m), third.Snapshot.Positions.Single(p => p.ItemCode == "G"));
        Reject(third.Snapshot, Return());
        Reject(third.Snapshot, Return() with { OriginalSaleId = Guid.NewGuid() });
        Reject(third.Snapshot, Return() with { ItemCode = "Q" });
    }

    [Fact]
    public void Issue_uses_exact_stock_ratio_instead_of_six_place_display_unit_cost()
    {
        var s = Stock(new StockPosition("G", 1_000_000_000m, 1m));
        Assert.Equal(0m, s.Positions.Single(p => p.ItemCode == "G").AverageUnitCost);
        var issue = Apply(s, Sell(999_999_999m));
        Assert.Equal(1m, issue.Movement.Cost);
        Assert.Equal(new("G", 1, 0), issue.Snapshot.Positions.Single(p => p.ItemCode == "G"));
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("0.00001")]
    [InlineData("1000000000.0001")]
    public void Invalid_quantities_are_rejected(string text)
    {
        var quantity = decimal.Parse(text, CultureInfo.InvariantCulture);
        Reject(Stock(), Purchase(quantity));
        Reject(Stock(new StockPosition("G", 1, 1)), Sell(quantity));
    }

    [Theory]
    [InlineData("-1")]
    [InlineData("0.0000001")]
    [InlineData("1000000000.000001")]
    public void Invalid_price_precision_or_range_is_rejected(string text) =>
        Reject(Stock(), Purchase(price: decimal.Parse(text, CultureInfo.InvariantCulture)));

    [Theory]
    [InlineData("-0.01")]
    [InlineData("0.001")]
    [InlineData("92233720368547758.08")]
    public void Invalid_cost_component_amounts_are_rejected(string text)
    {
        var amount = decimal.Parse(text, CultureInfo.InvariantCulture);
        Reject(Stock(), Purchase() with { Costs = new(1, amount, 0, 0) });
        Reject(Stock(), Purchase() with { Costs = new(1, 0, amount, 0) });
        Reject(Stock(), Purchase() with { Costs = new(1, 0, 0, amount) });
    }

    [Fact]
    public void Derived_purchase_rounding_is_explicit_half_away_and_limits_are_checked_before_returning_a_state()
    {
        Assert.Equal(0.01m, Apply(Stock(), Purchase(price: 0.005000m)).Movement.Cost);
        Assert.Equal(0m, Apply(Stock(), Purchase(0.0001m, 0.5m)).Movement.Cost);
        Reject(Stock(), Purchase(1_000_000_000m, 1_000_000_000m));
        var s = Stock(new StockPosition("G", 1, 92233720368547758.07m));
        Assert.Equal(92233720368547758.07m, Apply(s, Sell()).Movement.Cost);
        Reject(s, Purchase());
        Reject(Stock(new StockPosition("G", 1_000_000_000m, 0)), Purchase());
    }

    [Fact]
    public void No_negative_stock_unknown_items_or_mixed_trade_production_paths()
    {
        Reject(Stock(), Sell());
        Reject(Stock(new StockPosition("G", 1, 10)), Sell(1.0001m));
        Reject(Stock(), Purchase(code: "MISSING"));
        Reject(Stock(), Purchase(code: "P"));
        Reject(Stock(new StockPosition("R", 10, 100)), Sell(code: "R"));
        Reject(Stock(new StockPosition("G", 10, 100)), Issue(1, "A") with { ItemCode = "G" });
        Reject(Stock(new StockPosition("R", 10, 100)), Issue(11, "A"));
        Reject(Stock(new StockPosition("R", 10, 100)), Issue(1, " "));
    }

    [Fact]
    public void Unsupported_returns_cross_periods_and_backdated_inserts_fail_explicitly()
    {
        var purchase = Purchase();
        var s = Apply(Stock(), purchase with { Date = new(2026, 1, 2) }).Snapshot;
        Reject(s, Purchase() with { Date = Day });
        Reject(s, Purchase() with { Date = new(2026, 2, 1) });
        Reject(s, Purchase() with { Date = new(2025, 12, 31) });
        Reject(s, new SupplierReturn(Guid.NewGuid(), new(2026, 1, 2), "G", 1, InventoryCosting.PolicyVersion, purchase.BusinessId));
        Reject(s, new MaterialReturn(Guid.NewGuid(), new(2026, 1, 2), "R", 1, InventoryCosting.PolicyVersion, Guid.NewGuid()));
        Reject(s, new CustomerReturn(Guid.NewGuid(), new(2026, 2, 1), "G", 1, InventoryCosting.PolicyVersion, purchase.BusinessId));
    }

    [Fact]
    public void Inventory_policy_is_fixed_and_snapshot_corruption_is_not_silently_accepted()
    {
        var s = Stock();
        Assert.Throws<CostingValidationException>(() => InventoryCosting.Create(s.InventoryId, Period, Items(), [], InventoryCosting.DefaultPolicy with { Method = InventoryValuationMethod.Fifo }));
        Assert.Throws<CostingValidationException>(() => InventoryCosting.Create(s.InventoryId, Period, Items(), [], InventoryCosting.DefaultPolicy with { NegativeStock = NegativeStockPolicy.Allow }));
        Reject(s with { Policy = s.Policy with { Method = InventoryValuationMethod.MonthEndWeightedAverage } }, Purchase());
        Reject(s, Purchase() with { PolicyVersion = "v2" });
        Reject(s, Purchase() with { BusinessId = Guid.Empty });
        Reject(s with { Revision = 1 }, Purchase());
        Reject(s with { Positions = s.Positions.Select(p => p.ItemCode == "G" ? p with { Quantity = 1, Cost = 1 } : p).ToArray() }, Purchase());
    }

    [Fact]
    public void Invalid_opening_catalog_and_period_are_rejected()
    {
        Assert.Throws<CostingValidationException>(() => Stock(new StockPosition("G", 0, 1)));
        Assert.Throws<CostingValidationException>(() => Stock(new StockPosition("G", -1, 0)));
        Assert.Throws<CostingValidationException>(() => Stock(new StockPosition("G", 1, 1), new("G", 1, 1)));
        Assert.Throws<CostingValidationException>(() => Stock(new StockPosition("X", 1, 1)));
        Assert.Throws<CostingValidationException>(() => InventoryCosting.Create(Guid.Empty, Period, Items(), []));
        Assert.Throws<CostingValidationException>(() => InventoryCosting.Create(Guid.NewGuid(), new(2026, 13), Items(), []));
        Assert.Throws<CostingValidationException>(() => InventoryCosting.Create(Guid.NewGuid(), Period, [Items()[0], Items()[0]], []));
    }

    [Fact]
    public void Inventory_replay_is_idempotent_even_after_unrelated_changes_or_cosmetic_decimal_scale()
    {
        var original = Stock(); var op = Purchase(1.00m, 10.000m);
        var first = Apply(original, op);
        var more = Apply(first.Snapshot, Purchase(2, 20));
        var replay = InventoryCosting.Apply(more.Snapshot, op with { Quantity = 1m, Costs = new(10m, 0, 0, 0) }, 0);
        Assert.True(replay.IsReplay);
        Assert.Equal(2L, replay.Snapshot.Revision);
        Assert.Equal(Data(more.Snapshot), Data(replay.Snapshot));
        Assert.Equal(Data(first.VoucherSuggestions), Data(replay.VoucherSuggestions));
        Reject(more.Snapshot, op with { Quantity = 2 });
        Assert.Throws<CostingConcurrencyException>(() => InventoryCosting.Apply(more.Snapshot, Purchase(), 0));
        Assert.Equal(0L, original.Revision);
        Assert.Equal(0m, original.Positions.Single(p => p.ItemCode == "G").Cost);
    }

    [Fact]
    public void Factory_material_labor_overhead_allocation_and_receipt_have_independent_hand_calculated_costs()
    {
        var s = Stock(new StockPosition("R", 100, 1000));
        var a = Apply(s, Issue(6, "A"));
        var b = Apply(a.Snapshot, Issue(4, "B")); s = b.Snapshot;
        Assert.Equal(60m, a.Movement.Cost); Assert.Equal(40m, b.Movement.Cost);
        var request = Request([new("A", "P", 2, 1, 3), new("B", "Q", 4, 3, 1)], 80, 40, [a.Movement.BusinessId, b.Movement.BusinessId]);
        var result = ProductionCosting.Allocate(Production(s, AllocationBasis.LaborHours, AllocationBasis.MachineHours), s, request, 0);
        var outputA = result.Run.Outputs.Single(o => o.CostObject == "A");
        var outputB = result.Run.Outputs.Single(o => o.CostObject == "B");
        Assert.Equal((60m, 20m, 30m, 110m, 55m), (outputA.Materials, outputA.Labor, outputA.Overhead, outputA.TotalCost, outputA.UnitCost));
        Assert.Equal((40m, 60m, 10m, 110m, 27.5m), (outputB.Materials, outputB.Labor, outputB.Overhead, outputB.TotalCost, outputB.UnitCost));
        Assert.Equal(220m, result.Run.Outputs.Sum(o => o.TotalCost));
        var receiptA = Apply(s, new ProductionReceipt(Guid.NewGuid(), Day, "P", 2, InventoryCosting.PolicyVersion, outputA));
        var receiptB = Apply(receiptA.Snapshot, new ProductionReceipt(Guid.NewGuid(), Day, "Q", 4, InventoryCosting.PolicyVersion, outputB));
        var sale = Apply(receiptB.Snapshot, Sell(1, "P"));
        Assert.Equal(55m, sale.Movement.Cost);
        Assert.Equal(new("R", 90, 900), sale.Snapshot.Positions.Single(p => p.ItemCode == "R"));
        Assert.Equal(new("P", 1, 55), sale.Snapshot.Positions.Single(p => p.ItemCode == "P"));
        Assert.Equal(new("Q", 4, 110), sale.Snapshot.Positions.Single(p => p.ItemCode == "Q"));
        Assert.Equal(1065m, sale.Snapshot.Positions.Sum(p => p.Cost));
        var suggestions = a.VoucherSuggestions.Concat(b.VoucherSuggestions).Concat(result.Run.VoucherSuggestions)
            .Concat(receiptA.VoucherSuggestions).Concat(receiptB.VoucherSuggestions).Concat(sale.VoucherSuggestions).ToArray();
        Balanced(suggestions);
        Assert.Equal(0m, suggestions.SelectMany(v => v.Lines).Where(l => l.AccountRole == CostAccountRole.WorkInProgress).Sum(l => l.Debit - l.Credit));
        Assert.Equal(120m, result.Run.VoucherSuggestions.Single().Lines.Sum(l => l.Debit));
        Assert.Equal(CostVoucherOrigin.ProductionAllocation, result.Run.VoucherSuggestions.Single().Origin);
        Assert.Equal(s.InventoryId, result.Run.VoucherSuggestions.Single().InventoryId);
        Reject(receiptB.Snapshot, new ProductionReceipt(Guid.NewGuid(), Day, "P", 2, InventoryCosting.PolicyVersion, outputA));
        Reject(s, new ProductionReceipt(Guid.NewGuid(), Day, "P", 1, InventoryCosting.PolicyVersion, outputA));
        Reject(s, new ProductionReceipt(Guid.NewGuid(), Day, "P", 2, InventoryCosting.PolicyVersion, outputA with { InventoryId = Guid.NewGuid() }));
        Reject(s, new ProductionReceipt(Guid.NewGuid(), Day, "P", 2, InventoryCosting.PolicyVersion, outputA with { TotalCost = 111 }));
    }

    [Fact]
    public void Allocation_residual_cents_follow_exact_largest_remainders_and_stable_cost_object_order()
    {
        var s = Stock();
        var request = Request([new("C", "T", 1, 0, 0), new("B", "Q", 1, 0, 0), new("A", "P", 1, 0, 0)], 0.01m, 0.02m);
        var run = ProductionCosting.Allocate(Production(s), s, request, 0).Run;
        Assert.Equal(new[] { "A", "B", "C" }, run.Outputs.Select(o => o.CostObject));
        Assert.Equal(new[] { 0.01m, 0m, 0m }, run.Outputs.Select(o => o.Labor));
        Assert.Equal(new[] { 0.01m, 0.01m, 0m }, run.Outputs.Select(o => o.Overhead));
        Assert.Equal(0.03m, run.Outputs.Sum(o => o.TotalCost));
        Balanced(run.VoucherSuggestions);
    }

    [Fact]
    public void Allocation_uses_integer_rational_arithmetic_at_Int64_cent_limit()
    {
        var s = Stock();
        var r = Request([new("A", "P", 3, 0, 0), new("B", "Q", 3, 0, 0), new("C", "T", 4, 0, 0)], 92233720368547758.07m);
        var run = ProductionCosting.Allocate(Production(s), s, r, 0).Run;
        Assert.Equal(27670116110564327.42m, run.Outputs[0].Labor);
        Assert.Equal(27670116110564327.42m, run.Outputs[1].Labor);
        Assert.Equal(36893488147419103.23m, run.Outputs[2].Labor);
        Assert.Equal(92233720368547758.07m, run.Outputs.Sum(o => o.Labor));
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("0.00001")]
    public void Zero_or_invalid_output_is_explicitly_rejected_instead_of_hiding_cost_in_WIP(string quantity)
    {
        var s = Stock();
        RejectProduction(Production(s), s, Request([new("A", "P", decimal.Parse(quantity, CultureInfo.InvariantCulture), 1, 1)], 10, 10));
    }

    [Fact]
    public void Zero_allocation_basis_rejects_nonzero_pool_and_allows_zero_pool_without_division()
    {
        var s = Stock();
        var p = Production(s, AllocationBasis.LaborHours, AllocationBasis.MachineHours);
        RejectProduction(p, s, Request(labor: 1));
        RejectProduction(p, s, Request(overhead: 1));
        var result = ProductionCosting.Allocate(p, s, Request(), 0);
        Assert.Equal(0m, result.Run.Outputs.Single().TotalCost);
        Assert.Empty(result.Run.VoucherSuggestions);
    }

    [Fact]
    public void WIP_cross_periods_malformed_inputs_and_unsupported_bases_fail_without_mutating_inputs()
    {
        var s = Stock(); var p = Production(s);
        RejectProduction(p, s, Request() with { OpeningWorkInProgress = 1 });
        RejectProduction(p, s, Request() with { ClosingWorkInProgress = 1 });
        RejectProduction(p, s, Request() with { Date = new(2026, 2, 1) });
        RejectProduction(p, s, Request() with { PolicyVersion = "next" });
        RejectProduction(p, s, Request() with { DirectLabor = -1 });
        RejectProduction(p, s, Request() with { ManufacturingOverhead = 0.001m });
        RejectProduction(p, s, Request() with { Products = [] });
        RejectProduction(p, s, Request() with { Products = [new("A", "P", 1, 0, 0), new("A", "Q", 1, 0, 0)] });
        RejectProduction(p, s, Request() with { Products = [new("A", "G", 1, 0, 0)] });
        RejectProduction(p, s, Request() with { Products = [new("A", "P", 1, -1, 0)] });
        RejectProduction(p, s, Request() with { MaterialIssueIds = [Guid.NewGuid()] });
        Assert.Throws<CostingValidationException>(() => Production(s, (AllocationBasis)999));
        RejectProduction(p with { InventoryId = Guid.NewGuid() }, s, Request());
    }

    [Fact]
    public void Materials_must_reference_unique_appropriately_dated_issues_and_cannot_be_charged_twice()
    {
        var initial = Stock(new StockPosition("R", 10, 100));
        var issue = Apply(initial, Issue(1, "A"));
        var s = issue.Snapshot; var p = Production(s);
        RejectProduction(p, s, Request(sources: [issue.Movement.BusinessId, issue.Movement.BusinessId]));
        RejectProduction(p, s, Request([new("B", "P", 1, 0, 0)], sources: [issue.Movement.BusinessId]));
        var future = Apply(initial, Issue(1, "A") with { Date = new(2026, 1, 2) });
        RejectProduction(Production(future.Snapshot), future.Snapshot, Request(sources: [future.Movement.BusinessId]));
        var request = Request(sources: [issue.Movement.BusinessId]);
        var first = ProductionCosting.Allocate(p, s, request, 0);
        RejectProduction(first.Snapshot, s, request with { BusinessId = Guid.NewGuid() });
        RejectProduction(first.Snapshot with { Policy = first.Snapshot.Policy with { LaborBasis = AllocationBasis.LaborHours } }, s, Request());
    }

    [Fact]
    public void Production_replay_revision_and_immutable_output_contracts_are_explicit()
    {
        var s = Stock(new StockPosition("R", 10, 100));
        var issue = Apply(s, Issue(1, "A")); s = issue.Snapshot;
        var p = Production(s); var request = Request(sources: [issue.Movement.BusinessId]);
        var first = ProductionCosting.Allocate(p, s, request, 0);
        var laterInventory = Apply(s, Purchase()).Snapshot;
        var replay = ProductionCosting.Allocate(first.Snapshot, laterInventory, request, 0);
        Assert.True(replay.IsReplay);
        Assert.Equal(1L, replay.Snapshot.Revision);
        Assert.Equal(Data(first.Run), Data(replay.Run));
        RejectProduction(first.Snapshot, s, request with { DirectLabor = 1 });
        Assert.Throws<CostingConcurrencyException>(() => ProductionCosting.Allocate(first.Snapshot, s, Request(), 0));
        Assert.Throws<NotSupportedException>(() => ((IList<ProductionOutputCost>)first.Run.Outputs).Clear());
        Assert.Throws<NotSupportedException>(() => ((IList<Guid>)first.Run.MaterialIssueIds).Clear());
        Assert.Throws<NotSupportedException>(() => ((IList<ProductionRun>)first.Snapshot.Runs).Clear());
        Assert.Equal(0L, p.Revision);
    }

    [Fact]
    public void Mutable_caller_arrays_and_result_casts_cannot_change_inventory_or_suggestions()
    {
        var items = Items(); var openings = new[] { new StockPosition("G", 1, 10) };
        var s = InventoryCosting.Create(Guid.NewGuid(), Period, items, openings);
        items[0] = items[0] with { Name = "篡改" }; openings[0] = openings[0] with { Cost = 99 };
        Assert.Equal("商品", s.Items[0].Name);
        Assert.Equal(10m, s.Positions[0].Cost);
        var r = Apply(s, Sell());
        Assert.Throws<NotSupportedException>(() => ((IList<StockPosition>)r.Snapshot.Positions).Clear());
        Assert.Throws<NotSupportedException>(() => ((IList<InventoryMovement>)r.Snapshot.Movements).Clear());
        Assert.Throws<NotSupportedException>(() => ((IList<CostVoucherLine>)r.VoucherSuggestions[0].Lines).Clear());
        Assert.Equal(10m, s.Positions[0].Cost);
    }

    [Fact]
    public void Production_receipt_and_customer_return_retry_do_not_repeat_stock_or_suggestions()
    {
        var s = Stock();
        var run = ProductionCosting.Allocate(Production(s), s, Request(labor: 10), 0).Run;
        var receipt = new ProductionReceipt(Guid.NewGuid(), Day, "P", 1, InventoryCosting.PolicyVersion, run.Outputs[0]);
        var received = Apply(s, receipt);
        var replay = InventoryCosting.Apply(received.Snapshot, receipt, 0);
        Assert.True(replay.IsReplay);
        Assert.Equal(Data(received.Snapshot), Data(replay.Snapshot));
        Assert.Equal(Data(received.VoucherSuggestions), Data(replay.VoucherSuggestions));
        var sale = Apply(received.Snapshot, Sell(1, "P"));
        var returnOp = new CustomerReturn(Guid.NewGuid(), Day, "P", 1, InventoryCosting.PolicyVersion, sale.Movement.BusinessId);
        var returned = Apply(sale.Snapshot, returnOp);
        var replayReturn = InventoryCosting.Apply(returned.Snapshot, returnOp, 0);
        Assert.True(replayReturn.IsReplay);
        Assert.Equal(Data(returned.Snapshot), Data(replayReturn.Snapshot));
        Assert.Equal(new StockPosition("P", 1, 10), replayReturn.Snapshot.Positions.Single(p => p.ItemCode == "P"));
    }

    [Fact]
    public void Backdated_production_and_cross_book_or_cross_period_sources_are_rejected()
    {
        var s = Stock(); var p = Production(s);
        var first = ProductionCosting.Allocate(p, s, Request() with { Date = new(2026, 1, 2) }, 0);
        RejectProduction(first.Snapshot, s, Request());
        RejectProduction(p with { Period = new(2026, 2) }, s, Request());
        RejectProduction(p, s with { InventoryId = Guid.NewGuid() }, Request());
        var output = first.Run.Outputs[0];
        Reject(s, new ProductionReceipt(Guid.NewGuid(), Day, "P", 1, InventoryCosting.PolicyVersion, output));
    }

    [Fact]
    public void Negative_revision_is_invalid_even_for_an_existing_idempotent_business()
    {
        var s = Stock(); var op = Purchase(); var done = Apply(s, op);
        Assert.Throws<CostingConcurrencyException>(() => InventoryCosting.Apply(done.Snapshot, op, -1));
        var p = Production(s); var r = Request(); var allocated = ProductionCosting.Allocate(p, s, r, 0);
        Assert.Throws<CostingConcurrencyException>(() => ProductionCosting.Allocate(allocated.Snapshot, s, r, -1));
    }

    [Fact]
    public void Fingerprints_and_tie_breaks_are_independent_of_current_culture()
    {
        var s = Stock(); var op = Purchase(1.5m, 12.345678m);
        var original = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("en-US");
            var first = Apply(s, op);
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("fr-FR");
            var second = Apply(s, op);
            Assert.Equal(first.Movement.Fingerprint, second.Movement.Fingerprint);
            Assert.Equal(first.Movement.Cost, second.Movement.Cost);
            Assert.Equal(18.52m, second.Movement.Cost);
        }
        finally { CultureInfo.CurrentCulture = original; }
    }

    [Fact]
    public void Request_array_mutation_cannot_rewrite_completed_production_outputs()
    {
        var s = Stock(new StockPosition("R", 10, 100));
        var issue = Apply(s, Issue(1, "A")); s = issue.Snapshot;
        var products = new[] { new ProductionOutput("A", "P", 3, 0, 0) };
        var ids = new[] { issue.Movement.BusinessId };
        var r = ProductionCosting.Allocate(Production(s), s, Request(products, sources: ids), 0);
        products[0] = products[0] with { Quantity = 99 };
        ids[0] = Guid.NewGuid();
        Assert.Equal(3m, r.Run.Outputs[0].Quantity);
        Assert.Equal(3.333333m, r.Run.Outputs[0].UnitCost);
        Assert.Equal(issue.Movement.BusinessId, r.Run.MaterialIssueIds[0]);
    }
}
