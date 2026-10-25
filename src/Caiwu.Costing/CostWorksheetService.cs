using System.Globalization;
using System.Numerics;
using static Caiwu.Costing.CostMath;

namespace Caiwu.Costing;

/// <summary>Pure, repeatable worksheet calculations. Does not store, review or post vouchers.</summary>
public sealed class CostWorksheetService
{
    public const string PolicyVersion = "worksheet-whole-stage-largest-remainder-rmb-v1";
    public const int MaximumStages = 32;
    public const int MaximumObjects = 1000;

    public CostWorksheetCalculation Calculate(CostWorksheet input)
    {
        Require(input is not null && input.WorksheetId != Guid.Empty && input.BookId != Guid.Empty,
            "工作表与账套标识不能为空。");
        Require(input.Date != default && input.PolicyVersion == PolicyVersion, "日期或计算方式版本无效。");
        Label(input.PreparedBy, "制表人"); Label(input.SourceReference, "成本来源/审核依据", 512);
        Require(input.Stages is not null && input.Stages.Count is > 0 and <= MaximumStages,
            $"阶段数须为1至{MaximumStages}。");
        Require(input.Stages.All(s => s is not null && s.Objects is not null && s.CarryIns is not null), "阶段及其对象/承接列表不能为空。");
        Require(input.Stages.Sum(s => (long)s.Objects.Count) <= MaximumObjects &&
            input.Stages.Sum(s => (long)s.CarryIns.Count) <= MaximumObjects, "工作表对象或承接数超限。");
        Require(input.Stages.Select(s => s.StageId).Distinct(StringComparer.Ordinal).Count() == input.Stages.Count, "阶段标识重复。");
        Require(input.Stages.All(s => s.Objects.All(o => o is not null) && s.CarryIns.All(c => c is not null)), "对象及承接行不能为空。");
        // Freeze before returning any input; callers cannot rewrite an audit report through original lists.
        input = input with { Stages = ReadOnly(input.Stages.Select(s => s with
        { Objects = ReadOnly(s.Objects.OrderBy(o => o.CostObject, StringComparer.Ordinal)),
          CarryIns = ReadOnly(s.CarryIns.OrderBy(c => c.SourceStageId, StringComparer.Ordinal)
              .ThenBy(c => c.SourceCostObject, StringComparer.Ordinal).ThenBy(c => c.TargetCostObject, StringComparer.Ordinal)) })) };
        var stages = new List<CostStageCalculation>();
        var known = new Dictionary<(string Stage, string Object), CostObjectCalculation>();
        var consumed = new HashSet<(string Stage, string Object)>();
        var suggestions = new List<WorksheetVoucherSuggestion>();
        decimal externalTotal = 0;
        foreach (var stage in input.Stages)
        {
            Identifier(stage.StageId, "阶段标识"); Label(stage.Name, "阶段名称");
            Require(Enum.IsDefined(stage.LaborBasis) && Enum.IsDefined(stage.OverheadBasis) && Enum.IsDefined(stage.MaterialBasis), "分配基础无效。");
            Money(stage.DirectLabor); Money(stage.ManufacturingOverhead); Money(stage.SharedMaterials);
            Require(stage.Objects.Count > 0 && stage.Objects.All(o => o is not null), "每个阶段须有成本对象。");
            Require(stage.Objects.Select(o => o.CostObject).Distinct(StringComparer.Ordinal).Count() == stage.Objects.Count, "同阶段成本对象重复。");
            foreach (var obj in stage.Objects)
            {
                Identifier(obj.CostObject, "成本对象"); Label(obj.ProductName, "产品名称");
                Quantity(obj.OutputQuantity); Quantity(obj.LaborHours, true); Quantity(obj.MachineHours, true);
                Money(obj.DirectMaterials);
            }
            var carry = stage.Objects.ToDictionary(o => o.CostObject, _ => (Materials: 0m, Labor: 0m, Overhead: 0m), StringComparer.Ordinal);
            foreach (var link in stage.CarryIns)
            {
                Require(link is not null, "承接关系不能为空。");
                Identifier(link.SourceStageId, "来源阶段"); Identifier(link.SourceCostObject, "来源对象"); Identifier(link.TargetCostObject, "目标对象");
                var key = (link.SourceStageId, link.SourceCostObject);
                Require(known.TryGetValue(key, out var source), "承接来源必须是已计算的更早阶段对象；不允许循环、同阶段或未来引用。");
                Require(carry.ContainsKey(link.TargetCostObject), "承接目标不属于本阶段。");
                Require(consumed.Add(key), "同一来源对象只能整批承接一次，不能重复分配。");
                var c = carry[link.TargetCostObject];
                carry[link.TargetCostObject] = (c.Materials + source!.Materials, c.Labor + source.Labor, c.Overhead + source.Overhead);
                Suggest($"{stage.StageId}/{link.TargetCostObject}/carry/{link.SourceStageId}/{link.SourceCostObject}", "阶段间在制成本整批转移建议",
                    new(stage.StageId, link.TargetCostObject, CostAccountRole.WorkInProgress, source.TotalCost, 0),
                    new(link.SourceStageId, link.SourceCostObject, CostAccountRole.WorkInProgress, 0, source.TotalCost));
            }
            decimal Basis(CostObjectInput o, AllocationBasis b) => b switch
            {
                AllocationBasis.OutputQuantity => o.OutputQuantity,
                AllocationBasis.LaborHours => o.LaborHours,
                AllocationBasis.MachineHours => o.MachineHours,
                _ => throw new CostingValidationException("分配基础无效。")
            };
            var materials = CostMath.Allocate(stage.SharedMaterials, stage.Objects.Select(o => (o.CostObject, Basis(o, stage.MaterialBasis))).ToArray());
            var labor = CostMath.Allocate(stage.DirectLabor, stage.Objects.Select(o => (o.CostObject, Basis(o, stage.LaborBasis))).ToArray());
            var overhead = CostMath.Allocate(stage.ManufacturingOverhead, stage.Objects.Select(o => (o.CostObject, Basis(o, stage.OverheadBasis))).ToArray());
            var outputs = new List<CostObjectCalculation>();
            foreach (var obj in stage.Objects.OrderBy(o => o.CostObject, StringComparer.Ordinal))
            {
                var c = carry[obj.CostObject];
                var result = new CostObjectCalculation(stage.StageId, obj.CostObject, obj.ProductName, obj.OutputQuantity,
                    obj.DirectMaterials, labor[obj.CostObject], overhead[obj.CostObject], c.Materials, c.Labor, c.Overhead, false, materials[obj.CostObject]);
                Money(result.TotalCost);
                outputs.Add(result); known.Add((stage.StageId, obj.CostObject), result);
                Suggest($"{stage.StageId}/{obj.CostObject}/external", "外部材料、人工及制造费用归集建议（来源须审核，避免重复记账）",
                    new(stage.StageId, obj.CostObject, CostAccountRole.WorkInProgress, obj.DirectMaterials + materials[obj.CostObject] + labor[obj.CostObject] + overhead[obj.CostObject], 0),
                    new(stage.StageId, obj.CostObject, CostAccountRole.RawMaterials, 0, obj.DirectMaterials + materials[obj.CostObject]),
                    new(stage.StageId, obj.CostObject, CostAccountRole.PayrollPayable, 0, labor[obj.CostObject]),
                    new(stage.StageId, obj.CostObject, CostAccountRole.ManufacturingOverhead, 0, overhead[obj.CostObject]));
            }
            var external = stage.Objects.Sum(o => o.DirectMaterials) + stage.SharedMaterials + stage.DirectLabor + stage.ManufacturingOverhead;
            externalTotal += external; Money(externalTotal);
            var carried = carry.Values.Sum(c => c.Materials + c.Labor + c.Overhead);
            Require(outputs.Sum(o => o.TotalCost) == external + carried, "阶段成本不守恒。");
            var details = Trace("材料", stage.SharedMaterials, stage.MaterialBasis, materials)
                .Concat(Trace("人工", stage.DirectLabor, stage.LaborBasis, labor))
                .Concat(Trace("制造费用", stage.ManufacturingOverhead, stage.OverheadBasis, overhead));
            stages.Add(new(stage.StageId, stage.Name, external, carried, ReadOnly(outputs), ReadOnly(details)));

            IEnumerable<PoolAllocationDetail> Trace(string element, decimal pool, AllocationBasis basis, IReadOnlyDictionary<string, decimal> allocated)
            {
                var denominator = stage.Objects.Aggregate(BigInteger.Zero, (sum, o) => sum + Units(Basis(o, basis)));
                foreach (var obj in stage.Objects.OrderBy(o => o.CostObject, StringComparer.Ordinal))
                {
                    var weight = Basis(obj, basis);
                    var numerator = (BigInteger)Cents(pool) * Units(weight);
                    var floor = denominator == 0 ? 0m : (decimal)(numerator / denominator) / 100m;
                    yield return new(obj.CostObject, element, basis, weight, pool,
                        numerator.ToString(CultureInfo.InvariantCulture), denominator.ToString(CultureInfo.InvariantCulture),
                        floor, allocated[obj.CostObject] - floor, allocated[obj.CostObject]);
                }
            }
        }
        stages = stages.Select(s => s with { Objects = ReadOnly(s.Objects.Select(o => o with
        { IsTransferredOut = consumed.Contains((o.StageId, o.CostObject)) })) }).ToList();
        var final = stages.SelectMany(s => s.Objects).Where(o => !o.IsTransferredOut).ToArray();
        Require(final.Sum(o => o.TotalCost) == externalTotal, "最终完工成本与外部投入不守恒。");
        foreach (var obj in final)
            Suggest($"{obj.StageId}/{obj.CostObject}/finish", "终端成本对象整批完工结转建议",
                new(obj.StageId, obj.CostObject, CostAccountRole.FinishedProducts, obj.TotalCost, 0),
                new(obj.StageId, obj.CostObject, CostAccountRole.WorkInProgress, 0, obj.TotalCost));
        return new(input, Fingerprint(input, PolicyVersion), externalTotal, final.Sum(o => o.TotalCost),
            ReadOnly(stages), ReadOnly(suggestions));

        void Suggest(string key, string summary, params WorksheetVoucherLine[] lines)
        {
            lines = lines.Where(l => l.Debit != 0 || l.Credit != 0).ToArray();
            foreach (var line in lines) { Money(line.Debit); Money(line.Credit); }
            Require(lines.Sum(l => l.Debit) == lines.Sum(l => l.Credit), "建议借贷不平衡。");
            if (lines.Length > 0) suggestions.Add(new($"{input.WorksheetId:D}/{key}", summary,
                CostVoucherStatus.PendingAccountingReview, ReadOnly(lines)));
        }
    }

    private static void Identifier(string value, string name)
    {
        Label(value, name); Require(!value.Contains('/'), $"{name}不能包含/。");
    }

    private static void Label(string value, string name, int max = 128)
    {
        Text(value, name); Require(value.Length <= max, $"{name}长度不能超过{max}。");
    }
}
