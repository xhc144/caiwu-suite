using System.Collections.Immutable;

namespace Caiwu.FixedAssets;

public readonly record struct AssetPeriod : IComparable<AssetPeriod>
{
    public int Year { get; }
    public int Month { get; }
    [System.Text.Json.Serialization.JsonConstructor]
    public AssetPeriod(int year, int month)
    {
        _ = new DateOnly(year, month, 1);
        Year = year; Month = month;
    }
    public DateOnly FirstDay => new(Year, Month, 1);
    public DateOnly LastDay => new(Year, Month, DateTime.DaysInMonth(Year, Month));
    public AssetPeriod Next() => From(FirstDay.AddMonths(1));
    public static AssetPeriod From(DateOnly date) => new(date.Year, date.Month);
    public int CompareTo(AssetPeriod other) => FirstDay.CompareTo(other.FirstDay);
    public override string ToString() => $"{Year:D4}-{Month:D2}";
    public static bool operator <(AssetPeriod a, AssetPeriod b) => a.CompareTo(b) < 0;
    public static bool operator >(AssetPeriod a, AssetPeriod b) => a.CompareTo(b) > 0;
    public static bool operator <=(AssetPeriod a, AssetPeriod b) => a.CompareTo(b) <= 0;
    public static bool operator >=(AssetPeriod a, AssetPeriod b) => a.CompareTo(b) >= 0;
}

// Explicit new-engine policies, NOT assumed mappings for the original zjff codes.
public enum AssetDepreciationMethod { StraightLine = 1, UnitsOfProduction = 2 }
public enum AssetMovementKind { Addition, CardEdit, OriginalCostAdjustment, OriginalCostAdjustmentReversal, Transfer, Disposal }
public enum AssetVoucherKind { Addition, Depreciation, Disposal }

// The adapter must retain source declarations/nulls/bytes. The module does not parse an original book.
public sealed record OriginalCell(string Declaration, bool IsNull, string? Text, ImmutableArray<byte> Bytes);
public sealed record OriginalRow(string Table, string RowIdentity, ImmutableDictionary<string, OriginalCell> Cells);
public sealed record AssetAccessory(string Code, string Name, decimal Quantity, decimal UnitPrice,
    decimal Amount, string Description, ImmutableArray<OriginalRow> OriginalRows);
public sealed record AssetImage(string Name, string MediaType, ImmutableArray<byte> Bytes);

public sealed record AssetCard
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public required string Code { get; init; } // bh
    public required string Name { get; init; } // mc
    public required string CategoryCode { get; init; } // sblb
    public required string StatusCode { get; init; } // sbzt
    public required string DepartmentCode { get; init; } // sydw
    public required string PurposeCode { get; init; } // ytbh
    public required DateOnly PurchaseDate { get; init; } // gzrq
    public required DateOnly UseDate { get; init; } // syrq
    public required decimal OriginalCost { get; init; } // yz
    public decimal ResidualRate { get; init; } // czl, new API uses fraction 0..1
    public decimal ResidualValue { get; init; } // yzcz, explicit authoritative amount
    public AssetDepreciationMethod Method { get; init; } = AssetDepreciationMethod.StraightLine;
    public string OriginalMethodCode { get; init; } = ""; // zjff: never infer a mapping during import
    public required int UsefulLifeMonths { get; init; } // synx
    public int? OriginalUsefulLifeYears { get; init; } // synx_y
    public decimal TotalWorkload { get; init; } // zgzl
    public string Specification { get; init; } = ""; // bz
    public decimal MonthlyWorkload { get; init; } // ygzl
    public decimal MonthlyDepreciation { get; init; } // yzje
    public int DepreciatedMonths { get; init; } // ljzjy
    public decimal AccumulatedWorkload { get; init; } // ljgzl
    public decimal AccumulatedDepreciation { get; init; } // ljzje
    public string OriginalFlag { get; init; } = ""; // sbbz
    public string DisposalReasonCode { get; init; } = ""; // zxyy
    public DateOnly? DisposalDate { get; init; } // zxrq
    public decimal NetValue => OriginalCost - AccumulatedDepreciation; // zcjz projection
    public string OriginalDepreciationFlag { get; init; } = ""; // zjjt (retain independently of status)
    public string MachineNumber { get; init; } = ""; // bjbh
    public string CurrencyCode { get; init; } = ""; // wbbz
    public decimal? ForeignAmount { get; init; } // wbje, preserve null vs zero
    public string Manufacturer { get; init; } = ""; // zccm
    public string Location { get; init; } = ""; // azdd
    public DateOnly? ManufactureDate { get; init; } // zcrq
    public string Unit { get; init; } = ""; // dw
    public decimal Quantity { get; init; } = 1; // sl, adapter must preserve original declared type
    public string ReferenceNumber { get; init; } = ""; // ckbh
    public ImmutableArray<AssetAccessory> Accessories { get; init; } = [];
    public ImmutableArray<AssetImage> Images { get; init; } = [];
    public ImmutableArray<OriginalRow> OriginalRows { get; init; } = [];
}

public sealed record AssetCategory(string Code, string Name, decimal DefaultResidualRate, string AssetAccount);
public sealed record AssetPurpose(string Code, string Name, string ExpenseAccount);
public sealed record AssetStatus(string Code, string Name, bool Depreciates);
public sealed record AssetReference(string Code, string Name);
public sealed record AssetAccount(string Code, bool IsActive, bool IsLeaf);
public sealed record AssetCatalog
{
    public ImmutableArray<AssetCategory> Categories { get; init; } = [];
    public ImmutableArray<AssetPurpose> Purposes { get; init; } = [];
    public ImmutableArray<AssetStatus> Statuses { get; init; } = [];
    public ImmutableArray<AssetReference> Departments { get; init; } = [];
    public ImmutableArray<AssetReference> DisposalReasons { get; init; } = [];
    public ImmutableArray<AssetAccount> Accounts { get; init; } = [];
}
public sealed record AssetBookIdentity(string Product, string BookId, string Template, string SchemaFingerprint);
public sealed record AssetBookSettings(AssetPeriod OpeningPeriod, AssetCatalog Catalog,
    string AccumulatedDepreciationAccount, string DisposalClearingAccount);
public sealed record AssetMovement(Guid Id, Guid AssetId, AssetMovementKind Kind, DateOnly Date,
    AssetCard? Before, AssetCard After, string Description, Guid? ReversesMovementId = null);
public sealed record AssetDepreciationLine(Guid AssetId, string AssetCode, string AssetName, string DepartmentCode,
    string PurposeCode, AssetDepreciationMethod Method, decimal Cost, decimal ResidualValue,
    decimal Amount, decimal Workload, decimal AccumulatedBefore, decimal AccumulatedAfter, decimal NetValue);
public sealed record AssetDepreciationBatch(Guid Id, AssetPeriod Period,
    ImmutableArray<AssetDepreciationLine> Lines, ImmutableDictionary<Guid, AssetCard> Before,
    ImmutableDictionary<Guid, AssetCard> After, bool Cancelled)
{
    public decimal Total => Lines.Sum(x => x.Amount);
}
public sealed record AssetVoucherLine(Guid AssetId, string AccountCode, string DepartmentCode,
    string Summary, decimal Debit, decimal Credit);
public sealed record AssetVoucherReceipt(Guid PlanId, Guid VoucherId, long LedgerRevision, ImmutableArray<string> SourceKeys);
public sealed record AssetVoucherPlan(Guid Id, string SourceKey, AssetVoucherKind Kind, Guid SourceId,
    DateOnly Date, string VoucherType, int VoucherNumber, ImmutableArray<AssetVoucherLine> Lines, bool Voided)
{
    public decimal DebitTotal => Lines.Sum(x => x.Debit);
    public decimal CreditTotal => Lines.Sum(x => x.Credit);
}
public sealed record AssetBookState
{
    public required AssetBookIdentity Identity { get; init; }
    public required AssetBookSettings Settings { get; init; }
    public long Revision { get; init; }
    public bool ReadOnly { get; init; }
    public AssetPeriod? ClosedThrough { get; init; }
    public ImmutableDictionary<Guid, AssetCard> Cards { get; init; } = ImmutableDictionary<Guid, AssetCard>.Empty;
    public ImmutableArray<AssetMovement> Movements { get; init; } = [];
    public ImmutableArray<AssetDepreciationBatch> Batches { get; init; } = [];
    public ImmutableArray<AssetVoucherPlan> VoucherPlans { get; init; } = [];
    public ImmutableArray<AssetVoucherReceipt> VoucherReceipts { get; init; } = [];
    // Unassigned/reference/settings original rows and unknown columns, not silently projected away.
    public ImmutableArray<OriginalRow> OriginalRows { get; init; } = [];
    public AssetPeriod NextDepreciationPeriod => Batches.Where(x => !x.Cancelled)
        .OrderByDescending(x => x.Period).Select(x => x.Period.Next()).FirstOrDefault(Settings.OpeningPeriod);
}
public sealed record AssetLedgerRow(Guid AssetId, string Code, string Name, string CategoryCode,
    string DepartmentCode, DateOnly UseDate, decimal OriginalCost, decimal ResidualValue,
    decimal AccumulatedDepreciation, decimal NetValue, DateOnly? DisposalDate);
public sealed class AssetRuleException(string code, string message) : InvalidOperationException(message)
{
    public string Code { get; } = code;
}
