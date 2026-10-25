using static Caiwu.Costing.CostMath;

namespace Caiwu.Costing;

/// <summary>Completed simple batches only; no WIP, joint/by-products, or automatic general-ledger writes.</summary>
public static class ProductionCosting
{
    public const string PolicyVersion = "completed-batch-largest-remainder-rmb-v1";

    public static ProductionSnapshot Create(Guid inventoryId, CostPeriod period, AllocationBasis laborBasis, AllocationBasis overheadBasis)
    {
        Require(inventoryId != Guid.Empty, "库存账册标识不能为空。");
        Period(period);
        var policy = new ProductionPolicy(PolicyVersion, laborBasis, overheadBasis);
        ValidatePolicy(policy);
        return new(inventoryId, period, policy, 0, ReadOnly<ProductionRun>([]));
    }

    public static ProductionResult Allocate(ProductionSnapshot current, InventorySnapshot inventory, ProductionRequest request, long expectedRevision)
    {
        Require(current is not null && current.Runs is not null && request is not null, "生产快照及请求不能为空。");
        if (expectedRevision < 0) throw new CostingConcurrencyException("预期生产revision不能为负数。");
        Period(current.Period); ValidatePolicy(current.Policy);
        Require(current.InventoryId != Guid.Empty && current.Revision == current.Runs.Count && current.Runs.All(r => r is not null), "生产快照版本或批次无效。");
        Require(current.Runs.Select(r => r.BusinessId).Distinct().Count() == current.Runs.Count &&
            current.Runs.All(r => r.Policy == current.Policy), "已有批次的分配政策不得静默变更。");
        foreach (var savedRun in current.Runs)
        {
            Date(current.Period, savedRun.Date);
            Require(savedRun.BusinessId != Guid.Empty && savedRun.MaterialIssueIds is not null && savedRun.Outputs is not null &&
                savedRun.Outputs.Count > 0 && savedRun.VoucherSuggestions is not null, "已存生产批次字段无效。");
            foreach (var output in savedRun.Outputs)
            {
                ValidateOutput(output);
                Require(output.ProductionRunId == savedRun.BusinessId && output.InventoryId == current.InventoryId && output.Date == savedRun.Date,
                    "已存生产结果与批次/账册不匹配。");
            }
        }
        InventoryCosting.Validate(inventory);
        Require(current.InventoryId == inventory.InventoryId && current.Period == inventory.Period, "领料账册或成本期间不匹配。");
        Date(current.Period, request.Date);
        Require(request.BusinessId != Guid.Empty && request.PolicyVersion == current.Policy.Version, "生产业务标识或规则版本无效。");
        Require(request.Products is not null && request.Products.Count > 0 && request.Products.All(p => p is not null), "必须提供完工产品。");
        Require(request.MaterialIssueIds is not null, "领料引用列表不能为空。");
        Money(request.DirectLabor); Money(request.ManufacturingOverhead);
        Require(request.OpeningWorkInProgress == 0 && request.ClosingWorkInProgress == 0,
            "首版只核算无期初/期末在产品的完工批次，不支持在产品或跨期摊分。");
        Require(request.Products.Select(p => p.CostObject).Distinct(StringComparer.Ordinal).Count() == request.Products.Count, "生产成本对象重复。");
        foreach (var product in request.Products)
        {
            Text(product.CostObject, "生产成本对象"); Text(product.ProductCode, "产品编码");
            Quantity(product.Quantity); Quantity(product.LaborHours, true); Quantity(product.MachineHours, true);
            Require(inventory.Items.Any(i => i.Code == product.ProductCode && i.Kind == ItemKind.FinishedProduct), "完工产品必须在同一目录中登记为产成品。");
        }
        Require(request.MaterialIssueIds.Distinct().Count() == request.MaterialIssueIds.Count, "同一领料业务不能重复计入材料成本。");
        var objects = request.Products.Select(p => p.CostObject).ToHashSet(StringComparer.Ordinal);
        var sources = request.MaterialIssueIds.Select(id =>
        {
            var source = inventory.Movements.SingleOrDefault(m => m.BusinessId == id);
            Require(source is not null && source.Kind == MovementKind.MaterialIssue && source.CostObject is not null &&
                objects.Contains(source.CostObject) && source.Date <= request.Date, "材料成本须引用本期已发生且归属正确的生产领料业务。");
            return source;
        }).ToArray();
        // Stable domain tag: an anonymous CLR type name changes with unrelated compilation details.
        var fingerprint = Fingerprint(new { Request = request, Policy = current.Policy, Sources = sources }, "production-request-and-material-sources-v1");
        var existing = current.Runs.SingleOrDefault(r => r.BusinessId == request.BusinessId);
        if (existing is not null)
        {
            Require(existing.Fingerprint == fingerprint, "同一生产业务标识已用于不同内容或政策版本。");
            return new(Freeze(current), existing, true);
        }
        if (expectedRevision != current.Revision) throw new CostingConcurrencyException("生产成本revision已变化，请刷新重试。");
        Require(current.Runs.Count == 0 || request.Date >= current.Runs[^1].Date, "首版不支持补插历史生产批次。");
        Require(!current.Runs.SelectMany(r => r.MaterialIssueIds).Intersect(request.MaterialIssueIds).Any(), "已有批次使用了该领料成本，不能换业务标识再次分配。");
        var totalMaterials = sources.Sum(s => s.Cost);
        Money(totalMaterials + request.DirectLabor + request.ManufacturingOverhead);
        decimal Basis(ProductionOutput p, AllocationBasis basis) => basis switch
        {
            AllocationBasis.OutputQuantity => p.Quantity,
            AllocationBasis.LaborHours => p.LaborHours,
            AllocationBasis.MachineHours => p.MachineHours,
            _ => throw new CostingValidationException("不支持的分配基数。")
        };
        var labor = CostMath.Allocate(request.DirectLabor, request.Products.Select(p => (p.CostObject, Basis(p, current.Policy.LaborBasis))).ToArray());
        var overhead = CostMath.Allocate(request.ManufacturingOverhead, request.Products.Select(p => (p.CostObject, Basis(p, current.Policy.OverheadBasis))).ToArray());
        var outputs = request.Products.OrderBy(p => p.CostObject, StringComparer.Ordinal).Select(p =>
        {
            var materials = sources.Where(s => s.CostObject == p.CostObject).Sum(s => s.Cost);
            var total = materials + labor[p.CostObject] + overhead[p.CostObject];
            return new ProductionOutputCost(request.BusinessId, current.InventoryId, request.Date, PolicyVersion, p.CostObject, p.ProductCode,
                p.Quantity, materials, labor[p.CostObject], overhead[p.CostObject], total,
                decimal.Round(total / p.Quantity, 6, MidpointRounding.AwayFromZero));
        }).ToArray();
        var suggestions = Suggest(current.InventoryId, CostVoucherOrigin.ProductionAllocation, request.BusinessId, request.Date, "本批直接人工及制造费用归集建议；材料沿用已领料建议",
            new(CostAccountRole.WorkInProgress, request.DirectLabor + request.ManufacturingOverhead, 0),
            new(CostAccountRole.PayrollPayable, 0, request.DirectLabor), new(CostAccountRole.ManufacturingOverhead, 0, request.ManufacturingOverhead));
        var run = new ProductionRun(request.BusinessId, request.Date, current.Policy, fingerprint, inventory.Revision,
            ReadOnly(request.MaterialIssueIds), ReadOnly(outputs), suggestions);
        var next = Freeze(current with { Revision = checked(current.Revision + 1), Runs = current.Runs.Append(run).ToArray() });
        return new(next, run, false);
    }

    private static void ValidatePolicy(ProductionPolicy policy) => Require(policy is not null && policy.Version == PolicyVersion &&
        Enum.IsDefined(policy.LaborBasis) && Enum.IsDefined(policy.OverheadBasis), "生产成本政策版本或分配基数无效。");

    internal static void ValidateOutput(ProductionOutputCost output)
    {
        Require(output is not null && output.ProductionRunId != Guid.Empty && output.InventoryId != Guid.Empty && output.PolicyVersion == PolicyVersion, "生产结果或版本无效。");
        Text(output.CostObject, "生产成本对象"); Text(output.ProductCode, "产品编码"); Quantity(output.Quantity);
        Money(output.Materials); Money(output.Labor); Money(output.Overhead); Money(output.TotalCost);
        Require(output.TotalCost == output.Materials + output.Labor + output.Overhead &&
            output.UnitCost == decimal.Round(output.TotalCost / output.Quantity, 6, MidpointRounding.AwayFromZero), "生产结果金额或单位成本不一致。");
    }

    private static ProductionSnapshot Freeze(ProductionSnapshot s) => s with
    {
        Runs = ReadOnly(s.Runs.Select(r => r with
        {
            MaterialIssueIds = ReadOnly(r.MaterialIssueIds), Outputs = ReadOnly(r.Outputs),
            VoucherSuggestions = ReadOnly(r.VoucherSuggestions.Select(v => v with { Lines = ReadOnly(v.Lines) }))
        }))
    };
}
