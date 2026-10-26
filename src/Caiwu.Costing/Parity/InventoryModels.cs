namespace Caiwu.Costing.Parity;

// Raw cells are archival values, not values to round-trip through decimal/double or trim.
// A connector must retain row identity, schema variants, NULL and original declarations.
public sealed record OriginalCell(string Declaration, string? Value, string? RawBytesBase64 = null);
public sealed record OriginalRow(string Table, string SourceIdentity, string SchemaFingerprint,
    IReadOnlyDictionary<string, OriginalCell> Cells);

public enum WarehouseKind { Warehouse, Workshop }
public sealed record Warehouse(string Code, string Name, WarehouseKind Kind);
public sealed record InventoryPrecision(int QuantityDecimals, int PriceDecimals);
public sealed record InventoryAccount(string Code, bool Active, bool Leaf);
public sealed record Product(string Code, string Name, string Specification, string Unit,
    string InventoryAccount, string? SalesAccount, decimal PlannedPrice, decimal ReceiptPrice,
    decimal IssuePrice, IReadOnlyList<OriginalRow> OriginalRows);
public sealed record InventoryOpening(string WarehouseCode, string ProductCode, decimal Quantity,
    decimal Amount, IReadOnlyList<OriginalRow> OriginalRows);
public enum InventoryDocumentKind { Receipt, Sale, Consumption }
public sealed record InventoryDocumentLine(int Sequence, string ProductCode, decimal Quantity,
    decimal UnitPrice, decimal TaxInclusiveUnitPrice, decimal NetAmount, decimal TaxAmount,
    decimal GrossAmount, string Description, IReadOnlyList<OriginalRow> OriginalRows);
public enum InventoryVoucherKind { Receipt, SalesRevenue, IssueCost, Stocktake }
public enum LinkedVoucherState { Draft, Reviewed, Posted }
public sealed record InventoryVoucherLink(InventoryVoucherKind Kind, string VoucherIdentity, LinkedVoucherState State);
public sealed record InventoryDocument(Guid Id, string Number, string OriginalCategory,
    InventoryDocumentKind Kind, DateOnly Date, string WarehouseCode, string Operator,
    string Summary, string InvoiceType, decimal TaxRate, string SettlementAccount, string CostAccount,
    string? Reviewer, bool NegativeStockConfirmed, IReadOnlyList<InventoryDocumentLine> Lines,
    IReadOnlyList<InventoryVoucherLink> VoucherLinks, IReadOnlyList<OriginalRow> OriginalRows);
public sealed record InventoryStocktake(string WarehouseCode, string ProductCode, decimal ActualQuantity,
    IReadOnlyList<OriginalRow> OriginalRows);
public sealed record InventoryBalance(string WarehouseCode, string ProductCode, decimal Quantity, decimal? Amount);
public sealed record IssueCost(Guid DocumentId, int Sequence, decimal Amount);
public sealed record MonthlyInventoryTotal(string WarehouseCode, string ProductCode,
    decimal OpeningQuantity, decimal OpeningAmount, decimal ReceiptQuantity, decimal ReceiptAmount,
    decimal IssueQuantity, decimal IssueAmount, decimal StocktakeQuantityDifference,
    decimal StocktakeAmountDifference, decimal ClosingQuantity, decimal ClosingAmount);
public sealed record MonthlyInventoryCalculation(string PolicyVersion, string SourceFingerprint,
    bool AdjustZeroQuantityResidual, IReadOnlyList<IssueCost> IssueCosts,
    IReadOnlyList<MonthlyInventoryTotal> Totals);
public sealed record InventoryVoucherClaim(string SourceKey, Guid ProposalId, InventoryVoucherKind Kind, Guid? DocumentId);
public sealed record InventoryAudit(long Revision, string Operator, string Action, string Target);
public sealed record InventoryBook(Guid Id, CostPeriod Period, InventoryPrecision Precision,
    long Revision, IReadOnlyList<Warehouse> Warehouses, IReadOnlyList<Product> Products,
    IReadOnlyList<InventoryOpening> Openings, IReadOnlyList<InventoryDocument> Documents,
    IReadOnlyList<InventoryStocktake> Stocktakes, MonthlyInventoryCalculation? Calculation,
    IReadOnlyList<InventoryAudit> Audit, IReadOnlyList<InventoryVoucherClaim> VoucherClaims);
public sealed record InventoryVoucherSettings(string InputTaxAccount, string OutputTaxAccount,
    string RevenueAccount, string InventoryDifferenceAccount);
public sealed record InventoryPlannedLine(string AccountCode, string Summary, decimal Debit, decimal Credit);
public sealed record InventoryPlannedVoucher(string SourceKey, Guid? DocumentId,
    InventoryVoucherKind Kind, DateOnly Date, IReadOnlyList<InventoryPlannedLine> Lines);
public sealed record InventoryVoucherPlan(Guid BookId, long SourceRevision, string SourceFingerprint,
    IReadOnlyList<InventoryPlannedVoucher> Vouchers);

/// <summary>Host must implement this in the same ledger transaction as voucher links and audit.</summary>
public interface IInventoryBookStore
{
    InventoryBook Load(Guid bookId);
    bool TryCommit(long expectedRevision, InventoryBook next);
}
