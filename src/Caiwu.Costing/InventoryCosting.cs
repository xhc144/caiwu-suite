using static Caiwu.Costing.CostMath;

namespace Caiwu.Costing;

/// <summary>Pure single-month inventory transitions. Persistence must CAS the returned revision.</summary>
public static class InventoryCosting
{
    public const string PolicyVersion = "moving-weighted-average-rmb-v1";
    public static InventoryPolicy DefaultPolicy => new(PolicyVersion, InventoryValuationMethod.MovingWeightedAverage, NegativeStockPolicy.Reject);

    public static InventorySnapshot Create(Guid inventoryId, CostPeriod period, IReadOnlyList<StockItem> items,
        IReadOnlyList<StockPosition> openings, InventoryPolicy? policy = null)
    {
        Require(items is not null && openings is not null, "存货目录及期初不能为空。");
        Require(items.All(i => i is not null) && openings.All(p => p is not null), "存货目录及期初行不能为空。");
        Require(openings.Select(p => p.ItemCode).Distinct(StringComparer.Ordinal).Count() == openings.Count, "期初存货不能重复。");
        Require(openings.All(p => items.Any(i => i.Code == p.ItemCode)), "期初存货不在目录中。");
        var positions = items.Select(i => openings.SingleOrDefault(p => p.ItemCode == i.Code) ?? new(i.Code, 0, 0)).ToArray();
        var snapshot = new InventorySnapshot(inventoryId, period, policy ?? DefaultPolicy, 0,
            ReadOnly(items), ReadOnly(positions), ReadOnly(positions), ReadOnly<InventoryMovement>([]));
        Validate(snapshot);
        return snapshot;
    }

    public static InventoryResult Apply(InventorySnapshot current, InventoryOperation operation, long expectedRevision)
    {
        Validate(current);
        if (expectedRevision < 0) throw new CostingConcurrencyException("预期库存revision不能为负数。");
        Require(operation is not null, "库存业务不能为空。");
        Require(operation.BusinessId != Guid.Empty, "业务幂等标识不能为空。");
        Text(operation.ItemCode, "存货编码");
        Quantity(operation.Quantity);
        Date(current.Period, operation.Date);
        Require(operation.PolicyVersion == current.Policy.Version, "业务计价版本与库存政策不符，不允许静默切换。");
        Require(operation is PurchaseReceipt or SaleIssue or MaterialIssue or CustomerReturn or ProductionReceipt,
            "首版不支持供应商退货、领料退回或该库存业务类型，请走经审定的扩展流程。");
        var fingerprint = Fingerprint(operation);
        var existing = current.Movements.SingleOrDefault(m => m.BusinessId == operation.BusinessId);
        if (existing is not null)
        {
            Require(existing.Fingerprint == fingerprint, "同一业务标识已用于不同内容或版本，不能重复入库/出库。");
            return new(Freeze(current), existing, true, Suggestions(current, operation, existing));
        }
        if (expectedRevision != current.Revision)
            throw new CostingConcurrencyException("库存revision已变化，请取得最新快照再计算。");
        Require(current.Movements.Count == 0 || operation.Date >= current.Movements[^1].Date,
            "移动加权首版禁止补插早于最后业务日期的记录。");
        var item = current.Items.SingleOrDefault(i => i.Code == operation.ItemCode);
        Require(item is not null, "存货编码不存在。");
        var position = current.Positions.Single(p => p.ItemCode == operation.ItemCode);
        decimal cost;
        Guid? reference = null;
        string? costObject = null;
        MovementKind kind;
        switch (operation)
        {
            case PurchaseReceipt purchase:
                Require(item.Kind is ItemKind.TradingGoods or ItemKind.RawMaterial, "产成品须由已核算生产结果入库，不能混作采购入库。");
                Require(purchase.Costs is not null, "采购成本组成不能为空。");
                Money(purchase.Costs.CapitalizableAcquisitionCost); Money(purchase.Costs.NonDeductibleTax); Money(purchase.Costs.PeriodExpense);
                cost = PurchaseAmount(purchase.Quantity, purchase.Costs.UnitPrice) + purchase.Costs.CapitalizableAcquisitionCost + purchase.Costs.NonDeductibleTax;
                Money(cost); Money(cost + purchase.Costs.PeriodExpense);
                kind = MovementKind.PurchaseReceipt;
                break;
            case SaleIssue:
                Require(item.Kind is ItemKind.TradingGoods or ItemKind.FinishedProduct, "原材料销售处置不属于首版商贸销售流程。");
                Require(operation.Quantity <= position.Quantity, "库存不足，首版明确禁止负库存。");
                cost = Share(position.Cost, operation.Quantity, position.Quantity);
                kind = MovementKind.SaleIssue;
                break;
            case MaterialIssue issue:
                Require(item.Kind == ItemKind.RawMaterial, "生产领料只能使用原材料。");
                Text(issue.CostObject, "生产成本对象");
                Require(issue.Quantity <= position.Quantity, "库存不足，首版明确禁止负库存。");
                cost = Share(position.Cost, issue.Quantity, position.Quantity);
                costObject = issue.CostObject;
                kind = MovementKind.MaterialIssue;
                break;
            case CustomerReturn returned:
                var sale = current.Movements.SingleOrDefault(m => m.BusinessId == returned.OriginalSaleId);
                Require(sale is not null && sale.Kind == MovementKind.SaleIssue && sale.ItemCode == returned.ItemCode,
                    "销售退回必须引用本期同一存货的原销售出库业务。");
                var previous = current.Movements.Where(m => m.Kind == MovementKind.CustomerReturn && m.ReferenceId == sale.BusinessId).ToArray();
                var cumulativeQuantity = previous.Sum(m => m.Quantity) + returned.Quantity;
                Require(cumulativeQuantity <= sale.Quantity, "累计退货数量超过原销售出库数量。");
                cost = Share(sale.Cost, cumulativeQuantity, sale.Quantity) - previous.Sum(m => m.Cost);
                reference = sale.BusinessId;
                kind = MovementKind.CustomerReturn;
                break;
            case ProductionReceipt receipt:
                Require(item.Kind == ItemKind.FinishedProduct, "生产完工只能入库产成品。");
                ProductionCosting.ValidateOutput(receipt.Output);
                Require(receipt.Output.InventoryId == current.InventoryId && receipt.Output.ProductCode == item.Code && receipt.Output.Quantity == receipt.Quantity,
                    "完工入库须与产品成本结果的存货及完整数量相同，首版不支持拆分入库。");
                Date(current.Period, receipt.Output.Date);
                Require(receipt.Date >= receipt.Output.Date, "完工入库日期不能早于生产成本结果日期。");
                Require(!current.Movements.Any(m => m.Kind == MovementKind.ProductionReceipt &&
                    m.ReferenceId == receipt.Output.ProductionRunId && m.CostObject == receipt.Output.CostObject),
                    "该生产批次成本对象已经入库，不能换业务标识重复接收。");
                cost = receipt.Output.TotalCost;
                reference = receipt.Output.ProductionRunId;
                costObject = receipt.Output.CostObject;
                kind = MovementKind.ProductionReceipt;
                break;
            default: throw new CostingValidationException("不支持的库存业务。");
        }
        var outgoing = kind is MovementKind.SaleIssue or MovementKind.MaterialIssue;
        var nextPosition = position with
        {
            Quantity = position.Quantity + (outgoing ? -operation.Quantity : operation.Quantity),
            Cost = position.Cost + (outgoing ? -cost : cost)
        };
        Position(nextPosition);
        var revision = checked(current.Revision + 1);
        var movement = new InventoryMovement(operation.BusinessId, operation.Date, kind, item.Code,
            operation.Quantity, cost, reference, costObject, fingerprint, revision);
        var next = Freeze(current with
        {
            Revision = revision,
            Positions = current.Positions.Select(p => p.ItemCode == item.Code ? nextPosition : p).ToArray(),
            Movements = current.Movements.Append(movement).ToArray()
        });
        return new(next, movement, false, Suggestions(current, operation, movement));
    }

    private static IReadOnlyList<PendingCostVoucher> Suggestions(InventorySnapshot state, InventoryOperation operation, InventoryMovement movement)
    {
        var inventory = state.Items.Single(i => i.Code == operation.ItemCode).Kind switch
        {
            ItemKind.TradingGoods => CostAccountRole.TradingInventory,
            ItemKind.RawMaterial => CostAccountRole.RawMaterials,
            _ => CostAccountRole.FinishedProducts
        };
        var amount = movement.Cost;
        return operation switch
        {
            PurchaseReceipt p => Suggest(state.InventoryId, CostVoucherOrigin.Inventory, p.BusinessId, p.Date, "采购成本及已明确分类的期间费用建议",
                new(inventory, amount, 0), new(CostAccountRole.PurchasePeriodExpense, p.Costs.PeriodExpense, 0),
                new(CostAccountRole.AccountsPayable, 0, amount + p.Costs.PeriodExpense)),
            SaleIssue s => Suggest(state.InventoryId, CostVoucherOrigin.Inventory, s.BusinessId, s.Date, "销售成本结转建议", new(CostAccountRole.CostOfSales, amount, 0), new(inventory, 0, amount)),
            MaterialIssue m => Suggest(state.InventoryId, CostVoucherOrigin.Inventory, m.BusinessId, m.Date, "生产领料成本建议", new(CostAccountRole.WorkInProgress, amount, 0), new(inventory, 0, amount)),
            CustomerReturn r => Suggest(state.InventoryId, CostVoucherOrigin.Inventory, r.BusinessId, r.Date, "销售退回成本建议", new(inventory, amount, 0), new(CostAccountRole.CostOfSales, 0, amount)),
            ProductionReceipt p => Suggest(state.InventoryId, CostVoucherOrigin.Inventory, p.BusinessId, p.Date, "完工产品入库成本建议", new(inventory, amount, 0), new(CostAccountRole.WorkInProgress, 0, amount)),
            _ => throw new CostingValidationException("不支持的凭证建议类型。")
        };
    }

    internal static InventorySnapshot Freeze(InventorySnapshot state) => state with
    {
        Items = ReadOnly(state.Items), OpeningPositions = ReadOnly(state.OpeningPositions),
        Positions = ReadOnly(state.Positions), Movements = ReadOnly(state.Movements)
    };

    internal static void Validate(InventorySnapshot state)
    {
        Require(state is not null && state.InventoryId != Guid.Empty, "库存快照及账册标识无效。");
        Period(state.Period);
        Require(state.Policy == DefaultPolicy, "只支持固定版本移动加权、禁止负库存政策；其他计价方法须另建审定流程。");
        Require(state.Items is not null && state.OpeningPositions is not null && state.Positions is not null && state.Movements is not null,
            "库存快照列表不能为空。");
        Require(state.Items.Count > 0 && state.Items.All(i => i is not null), "至少需要一个有效存货。");
        foreach (var item in state.Items) { Text(item.Code, "存货编码"); Text(item.Name, "存货名称"); Text(item.Unit, "计量单位"); Require(Enum.IsDefined(item.Kind), "存货类型无效。"); }
        Require(state.Items.Select(i => i.Code).Distinct(StringComparer.Ordinal).Count() == state.Items.Count, "存货编码重复。");
        Require(state.Revision == state.Movements.Count && state.Movements.All(m => m is not null), "库存快照revision或历史无效。");
        var codes = state.Items.Select(i => i.Code).ToHashSet(StringComparer.Ordinal);
        foreach (var list in new[] { state.OpeningPositions, state.Positions })
        {
            Require(list.Count == codes.Count && list.All(p => p is not null && codes.Contains(p.ItemCode)) &&
                list.Select(p => p.ItemCode).Distinct(StringComparer.Ordinal).Count() == codes.Count, "库存余额必须与存货目录一一对应。");
            foreach (var p in list) Position(p);
        }
        Require(state.Movements.Select(m => m.BusinessId).Distinct().Count() == state.Movements.Count, "库存历史业务标识重复。");
        var computed = state.OpeningPositions.ToDictionary(p => p.ItemCode, StringComparer.Ordinal);
        DateOnly? last = null;
        for (var i = 0; i < state.Movements.Count; i++)
        {
            var m = state.Movements[i];
            Require(m.BusinessId != Guid.Empty && Enum.IsDefined(m.Kind) && m.Revision == i + 1 && codes.Contains(m.ItemCode), "库存历史字段无效。");
            Date(state.Period, m.Date); Quantity(m.Quantity); Money(m.Cost);
            Require(last is null || m.Date >= last, "库存历史日期顺序无效。");
            last = m.Date;
            var p = computed[m.ItemCode];
            var sign = m.Kind is MovementKind.SaleIssue or MovementKind.MaterialIssue ? -1 : 1;
            p = p with { Quantity = p.Quantity + sign * m.Quantity, Cost = p.Cost + sign * m.Cost };
            Position(p);
            computed[m.ItemCode] = p;
        }
        Require(state.Positions.All(p => p == computed[p.ItemCode]), "库存数量金额与期初及业务历史不一致。");
    }
}
