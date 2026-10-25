namespace Caiwu.Costing;

/// <summary>Reviewer-confirmed external costs, distinct from inventory movement based ProductionCosting.</summary>
public sealed record CostWorksheet(Guid WorksheetId, Guid BookId, DateOnly Date, string PreparedBy,
    string SourceReference, string PolicyVersion, IReadOnlyList<CostStageInput> Stages);
public sealed record CostStageInput(string StageId, string Name, AllocationBasis LaborBasis,
    AllocationBasis OverheadBasis, decimal DirectLabor, decimal ManufacturingOverhead,
    IReadOnlyList<CostObjectInput> Objects, IReadOnlyList<StageCarryInput> CarryIns,
    decimal SharedMaterials = 0, AllocationBasis MaterialBasis = AllocationBasis.OutputQuantity);
public sealed record CostObjectInput(string CostObject, string ProductName, decimal OutputQuantity,
    decimal DirectMaterials, decimal LaborHours, decimal MachineHours);
/// <summary>Whole cost of one earlier stage object is transferred once, without loss or WIP.</summary>
public sealed record StageCarryInput(string SourceStageId, string SourceCostObject, string TargetCostObject);
public sealed record CostObjectCalculation(string StageId, string CostObject, string ProductName,
    decimal OutputQuantity, decimal DirectMaterials, decimal AllocatedLabor, decimal AllocatedOverhead,
    decimal CarriedMaterials, decimal CarriedLabor, decimal CarriedOverhead, bool IsTransferredOut, decimal AllocatedMaterials = 0)
{
    public decimal Materials => DirectMaterials + AllocatedMaterials + CarriedMaterials;
    public decimal Labor => AllocatedLabor + CarriedLabor;
    public decimal Overhead => AllocatedOverhead + CarriedOverhead;
    public decimal TotalCost => Materials + Labor + Overhead;
    /// <summary>Display only, never multiplied back to derive a transfer amount.</summary>
    public decimal UnitCost => decimal.Round(TotalCost / OutputQuantity, 6, MidpointRounding.AwayFromZero);
}
public sealed record CostStageCalculation(string StageId, string Name, decimal ExternalCost,
    decimal CarriedCost, IReadOnlyList<CostObjectCalculation> Objects, IReadOnlyList<PoolAllocationDetail> AllocationDetails);
public sealed record PoolAllocationDetail(string CostObject, string CostElement, AllocationBasis Basis, decimal Weight,
    decimal Pool, string ExactNumerator, string ExactDenominator, decimal FloorAmount, decimal RemainderAdjustment, decimal AllocatedAmount);
public sealed record WorksheetVoucherLine(string StageId, string CostObject, CostAccountRole AccountRole,
    decimal Debit, decimal Credit);
public sealed record WorksheetVoucherSuggestion(string SuggestionKey, string Summary,
    CostVoucherStatus Status, IReadOnlyList<WorksheetVoucherLine> Lines);
public sealed record CostWorksheetCalculation(CostWorksheet Input, string InputFingerprint,
    decimal ExternalCost, decimal FinishedCost, IReadOnlyList<CostStageCalculation> Stages,
    IReadOnlyList<WorksheetVoucherSuggestion> VoucherSuggestions);
public sealed record CostWorksheetReport(int SchemaVersion, CostWorksheetCalculation Calculation);
