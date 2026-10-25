namespace Caiwu.Costing;

public sealed class CostingValidationException(string message) : Exception(message);
public sealed class CostingConcurrencyException(string message) : Exception(message);

public sealed record CostPeriod(int Year, int Month);
public enum ItemKind { TradingGoods, RawMaterial, FinishedProduct }
public enum InventoryValuationMethod { MovingWeightedAverage, MonthEndWeightedAverage, Fifo }
public enum NegativeStockPolicy { Reject, Allow }
public sealed record InventoryPolicy(string Version, InventoryValuationMethod Method, NegativeStockPolicy NegativeStock);
public sealed record StockItem(string Code, string Name, string Unit, ItemKind Kind);
public sealed record StockPosition(string ItemCode, decimal Quantity, decimal Cost)
{
    /// <summary>Display only. Issues use the full integer-cent/quantity ratio.</summary>
    public decimal AverageUnitCost => Quantity == 0 ? 0 : decimal.Round(Cost / Quantity, 6, MidpointRounding.AwayFromZero);
}

public enum MovementKind { PurchaseReceipt, SaleIssue, MaterialIssue, CustomerReturn, ProductionReceipt }
public sealed record InventoryMovement(Guid BusinessId, DateOnly Date, MovementKind Kind, string ItemCode,
    decimal Quantity, decimal Cost, Guid? ReferenceId, string? CostObject, string Fingerprint, long Revision);
public sealed record InventorySnapshot(Guid InventoryId, CostPeriod Period, InventoryPolicy Policy, long Revision,
    IReadOnlyList<StockItem> Items, IReadOnlyList<StockPosition> OpeningPositions,
    IReadOnlyList<StockPosition> Positions, IReadOnlyList<InventoryMovement> Movements);
public sealed record InventoryResult(InventorySnapshot Snapshot, InventoryMovement Movement,
    bool IsReplay, IReadOnlyList<PendingCostVoucher> VoucherSuggestions);

// Procurement cost classification is supplied explicitly by a reviewer, never inferred from a tax rate.
public sealed record PurchaseCosts(decimal UnitPrice, decimal CapitalizableAcquisitionCost,
    decimal NonDeductibleTax, decimal PeriodExpense);
public abstract record InventoryOperation(Guid BusinessId, DateOnly Date, string ItemCode, decimal Quantity, string PolicyVersion);
public sealed record PurchaseReceipt(Guid BusinessId, DateOnly Date, string ItemCode, decimal Quantity,
    string PolicyVersion, PurchaseCosts Costs) : InventoryOperation(BusinessId, Date, ItemCode, Quantity, PolicyVersion);
public sealed record SaleIssue(Guid BusinessId, DateOnly Date, string ItemCode, decimal Quantity,
    string PolicyVersion) : InventoryOperation(BusinessId, Date, ItemCode, Quantity, PolicyVersion);
public sealed record MaterialIssue(Guid BusinessId, DateOnly Date, string ItemCode, decimal Quantity,
    string PolicyVersion, string CostObject) : InventoryOperation(BusinessId, Date, ItemCode, Quantity, PolicyVersion);
public sealed record CustomerReturn(Guid BusinessId, DateOnly Date, string ItemCode, decimal Quantity,
    string PolicyVersion, Guid OriginalSaleId) : InventoryOperation(BusinessId, Date, ItemCode, Quantity, PolicyVersion);
public sealed record ProductionReceipt(Guid BusinessId, DateOnly Date, string ItemCode, decimal Quantity,
    string PolicyVersion, ProductionOutputCost Output) : InventoryOperation(BusinessId, Date, ItemCode, Quantity, PolicyVersion);
// Explicitly rejected until original procurement/cost adjustments and WIP effects have an approved workflow.
public sealed record SupplierReturn(Guid BusinessId, DateOnly Date, string ItemCode, decimal Quantity,
    string PolicyVersion, Guid OriginalPurchaseId) : InventoryOperation(BusinessId, Date, ItemCode, Quantity, PolicyVersion);
public sealed record MaterialReturn(Guid BusinessId, DateOnly Date, string ItemCode, decimal Quantity,
    string PolicyVersion, Guid OriginalIssueId) : InventoryOperation(BusinessId, Date, ItemCode, Quantity, PolicyVersion);

public enum AllocationBasis { OutputQuantity, LaborHours, MachineHours }
public sealed record ProductionPolicy(string Version, AllocationBasis LaborBasis, AllocationBasis OverheadBasis);
public sealed record ProductionOutput(string CostObject, string ProductCode, decimal Quantity, decimal LaborHours, decimal MachineHours);
public sealed record ProductionRequest(Guid BusinessId, DateOnly Date, string PolicyVersion,
    IReadOnlyList<ProductionOutput> Products, IReadOnlyList<Guid> MaterialIssueIds,
    decimal DirectLabor, decimal ManufacturingOverhead, decimal OpeningWorkInProgress = 0, decimal ClosingWorkInProgress = 0);
public sealed record ProductionOutputCost(Guid ProductionRunId, Guid InventoryId, DateOnly Date, string PolicyVersion,
    string CostObject, string ProductCode, decimal Quantity, decimal Materials, decimal Labor, decimal Overhead,
    decimal TotalCost, decimal UnitCost);
public sealed record ProductionRun(Guid BusinessId, DateOnly Date, ProductionPolicy Policy, string Fingerprint,
    long SourceInventoryRevision, IReadOnlyList<Guid> MaterialIssueIds, IReadOnlyList<ProductionOutputCost> Outputs,
    IReadOnlyList<PendingCostVoucher> VoucherSuggestions);
public sealed record ProductionSnapshot(Guid InventoryId, CostPeriod Period, ProductionPolicy Policy,
    long Revision, IReadOnlyList<ProductionRun> Runs);
public sealed record ProductionResult(ProductionSnapshot Snapshot, ProductionRun Run, bool IsReplay);

// Semantic roles must be mapped to reviewed active leaf accounts by the general-ledger adapter.
public enum CostAccountRole
{
    TradingInventory, RawMaterials, FinishedProducts, WorkInProgress, AccountsPayable,
    CostOfSales, PurchasePeriodExpense, PayrollPayable, ManufacturingOverhead
}
public enum CostVoucherStatus { PendingAccountingReview }
public enum CostVoucherOrigin { Inventory, ProductionAllocation }
public sealed record CostVoucherLine(CostAccountRole AccountRole, decimal Debit, decimal Credit);
public sealed record PendingCostVoucher(Guid InventoryId, CostVoucherOrigin Origin, Guid BusinessId, DateOnly Date, string Summary,
    CostVoucherStatus Status, IReadOnlyList<CostVoucherLine> Lines);
