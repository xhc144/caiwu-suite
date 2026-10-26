using System.Collections.ObjectModel;
using System.Numerics;
using static Caiwu.Costing.CostMath;

namespace Caiwu.Costing.Parity;

internal static class InventoryRules
{
    internal static void Precision(InventoryPrecision p) => Require(p is not null && p.QuantityDecimals is >= 0 and <= 8 &&
        p.PriceDecimals is >= 0 and <= 8, "数量及单价小数位须为0至8；不能静默截断原数据。");
    internal static void Qty(decimal value, InventoryPrecision p, bool zero = true) => Require(value >= 0 &&
        (zero || value > 0) && value <= 1_000_000_000m && decimal.Round(value, p.QuantityDecimals) == value,
        "数量超过范围或账套设置的小数位数。");
    internal static void UnitPrice(decimal value, InventoryPrecision p) => Require(value >= 0 && value <= 1_000_000_000m &&
        decimal.Round(value, p.PriceDecimals) == value, "单价超过范围或账套设置的小数位数。");
    internal static void Account(string code, IReadOnlyList<InventoryAccount> accounts)
    {
        Text(code, "科目编码");
        Require(accounts.Count(a => a.Code == code && a.Active && a.Leaf) == 1, $"科目 {code} 不存在、未启用或非明细科目。");
    }
    // Exact 8-place quantity ratio; monetary totals are integer cents, avoiding rounded display prices.
    internal static decimal Proportion(decimal money, decimal quantity, decimal denominator)
    {
        Money(money);
        Require(quantity >= 0 && denominator > 0, "没有可用数量，无法计算加权成本。");
        var n = new BigInteger(money * 100m) * new BigInteger(quantity * 100_000_000m);
        var d = new BigInteger(denominator * 100_000_000m);
        var q = BigInteger.DivRem(n, d, out var remainder);
        if (remainder * 2 >= d) q++;
        Require(q <= long.MaxValue, "核算金额超出范围。");
        return (decimal)q / 100m;
    }
    internal static IReadOnlyList<OriginalRow> Rows(IReadOnlyList<OriginalRow> rows)
    {
        Require(rows is not null && rows.All(r => r is not null && r.Cells is not null && r.Cells.All(c => c.Value is not null)), "原始行及字段袋不能为空。");
        return ReadOnly(rows.Select(r => r with { Cells = new ReadOnlyDictionary<string, OriginalCell>(
            r.Cells.OrderBy(c => c.Key, StringComparer.Ordinal).ToDictionary(c => c.Key, c => c.Value)) }));
    }
    internal static Product Freeze(Product p) => p with { OriginalRows = Rows(p.OriginalRows) };
    internal static InventoryOpening Freeze(InventoryOpening p) => p with { OriginalRows = Rows(p.OriginalRows) };
    internal static InventoryStocktake Freeze(InventoryStocktake p) => p with { OriginalRows = Rows(p.OriginalRows) };
    internal static InventoryDocument Freeze(InventoryDocument d) => d with
    {
        OriginalRows = Rows(d.OriginalRows), VoucherLinks = ReadOnly(d.VoucherLinks),
        Lines = ReadOnly(d.Lines.Select(l => l with { OriginalRows = Rows(l.OriginalRows) }))
    };
    internal static InventoryBook Freeze(InventoryBook b) => b with
    {
        Warehouses = ReadOnly(b.Warehouses), Products = ReadOnly(b.Products.Select(Freeze)),
        Openings = ReadOnly(b.Openings.Select(Freeze)), Documents = ReadOnly(b.Documents.Select(Freeze)),
        Stocktakes = ReadOnly(b.Stocktakes.Select(Freeze)), Audit = ReadOnly(b.Audit), VoucherClaims = ReadOnly(b.VoucherClaims),
        Calculation = b.Calculation is null ? null : b.Calculation with
        { IssueCosts = ReadOnly(b.Calculation.IssueCosts), Totals = ReadOnly(b.Calculation.Totals) }
    };
    internal static string Source(InventoryBook b) => Fingerprint(new
    {
        b.Id, b.Period, b.Precision, b.Warehouses, b.Products, b.Openings,
        Documents = b.Documents.Select(d => d with { VoucherLinks = Array.Empty<InventoryVoucherLink>() }).ToArray(), b.Stocktakes
    }, "inventory-month-end-source-v1");

    internal static void Validate(InventoryBook b)
    {
        Require(b is not null && b.Id != Guid.Empty && b.Revision >= 0, "库存账册标识或版本无效。");
        Period(b.Period); Precision(b.Precision);
        Require(b.Warehouses is not null && b.Products is not null && b.Openings is not null && b.Documents is not null &&
            b.Stocktakes is not null && b.Audit is not null && b.VoucherClaims is not null, "账册集合不能为空。");
        Require(b.Warehouses.All(w => w is not null) && b.Products.All(p => p is not null) &&
            b.Openings.All(o => o is not null) && b.Documents.All(d => d is not null) && b.Stocktakes.All(t => t is not null) &&
            b.VoucherClaims.All(c => c is not null), "账册集合不能含空行。");
        Require(b.Warehouses.Select(w => w.Code).Distinct().Count() == b.Warehouses.Count, "仓库编号重复。");
        foreach (var w in b.Warehouses) { Text(w.Code, "仓库编号"); Text(w.Name, "仓库名称"); Require(Enum.IsDefined(w.Kind), "仓库类型无效。"); }
        Require(b.Products.Select(p => p.Code).Distinct().Count() == b.Products.Count, "产品编号重复。");
        foreach (var p in b.Products) ValidateProduct(b, p);
        Require(b.Openings.Select(o => (o.WarehouseCode, o.ProductCode)).Distinct().Count() == b.Openings.Count, "期初产品重复。");
        foreach (var o in b.Openings) { Key(b, o.WarehouseCode, o.ProductCode); Qty(o.Quantity, b.Precision); Money(o.Amount); Rows(o.OriginalRows); }
        Require(b.Documents.Select(d => d.Id).Distinct().Count() == b.Documents.Count &&
            b.Documents.Select(d => (d.Kind, d.Number)).Distinct().Count() == b.Documents.Count, "单据标识或同类别单号重复。");
        foreach (var d in b.Documents) ValidateDocument(b, d);
        Require(b.Stocktakes.Select(o => (o.WarehouseCode, o.ProductCode)).Distinct().Count() == b.Stocktakes.Count, "盘点产品重复。");
        foreach (var t in b.Stocktakes) { Key(b, t.WarehouseCode, t.ProductCode); Qty(t.ActualQuantity, b.Precision); Rows(t.OriginalRows); }
        Require(b.VoucherClaims.Select(c => c.SourceKey).Distinct().Count() == b.VoucherClaims.Count, "凭证来源认领重复。");
        foreach (var claim in b.VoucherClaims)
        {
            Text(claim.SourceKey, "凭证来源");
            Require(claim.ProposalId != Guid.Empty && Enum.IsDefined(claim.Kind), "凭证认领标识无效。");
            Require(claim.DocumentId is null || b.Documents.Any(d => d.Id == claim.DocumentId), "凭证认领单据不存在。");
        }
        if (b.Calculation is not null)
        {
            Require(b.Calculation.PolicyVersion == InventoryWorkflow.PolicyVersion && b.Calculation.SourceFingerprint == Source(b),
                "核算来源已变化，不能使用旧成本结果。");
            Require(Fingerprint(b.Calculation) == Fingerprint(InventoryWorkflow.Compute(b, b.Calculation.AdjustZeroQuantityResidual)),
                "核算数量金额与单据不一致，不能使用旧成本结果。");
        }
    }
    internal static void Key(InventoryBook b, string warehouse, string product)
    {
        Require(b.Warehouses.Any(w => w.Code == warehouse), "仓库不存在。");
        Require(b.Products.Any(p => p.Code == product), "此产品不存在！");
    }
    internal static bool ProductHasActivity(InventoryBook b, string code) =>
        b.Openings.Any(o => o.ProductCode == code) || b.Documents.Any(d => d.Lines.Any(l => l.ProductCode == code)) ||
        b.Stocktakes.Any(t => t.ProductCode == code);
    internal static void ValidateProduct(InventoryBook b, Product p)
    {
        Require(p is not null, "产品不能为空。"); Text(p.Code, "产品编号"); Text(p.Name, "产品名称"); Text(p.Unit, "单位");
        Text(p.InventoryAccount, "产品科目"); UnitPrice(p.PlannedPrice, b.Precision); UnitPrice(p.ReceiptPrice, b.Precision);
        UnitPrice(p.IssuePrice, b.Precision); Rows(p.OriginalRows);
    }
    internal static void ValidateDocument(InventoryBook b, InventoryDocument d)
    {
        Require(d is not null && d.Id != Guid.Empty && Enum.IsDefined(d.Kind), "单据标识或类别无效。");
        Text(d.Number, "单号"); Text(d.OriginalCategory, "原单据类别"); Text(d.Operator, "操作人"); Date(b.Period, d.Date);
        Require(b.Warehouses.Any(w => w.Code == d.WarehouseCode), "仓库不存在。");
        Require(d.TaxRate >= 0 && d.TaxRate <= 100, "税率须为0至100的显式百分数。");
        Require(d.Lines is not null && d.Lines.Count > 0 && d.Lines.All(l => l is not null), "此单据无内容。");
        Require(d.Lines.All(l => l.Sequence > 0) && d.Lines.Select(l => l.Sequence).Distinct().Count() == d.Lines.Count, "单据行序号无效或重复。");
        foreach (var l in d.Lines)
        {
            Key(b, d.WarehouseCode, l.ProductCode); Qty(l.Quantity, b.Precision, false);
            UnitPrice(l.UnitPrice, b.Precision); UnitPrice(l.TaxInclusiveUnitPrice, b.Precision);
            Money(l.NetAmount); Money(l.TaxAmount); Money(l.GrossAmount);
            Require(l.NetAmount + l.TaxAmount == l.GrossAmount, "价税合计与金额、税额不一致；不得根据税率猜测或覆盖已确认金额。");
            Rows(l.OriginalRows);
        }
        Require(d.VoucherLinks is not null && d.VoucherLinks.All(l => l is not null && Enum.IsDefined(l.Kind) && Enum.IsDefined(l.State)), "凭证关联无效。");
        Require(d.VoucherLinks.Select(l => l.Kind).Distinct().Count() == d.VoucherLinks.Count, "同一单据同类凭证关联重复。");
        Rows(d.OriginalRows);
    }
    internal static void Version(InventoryBook b, long expected)
    {
        Validate(b);
        if (expected < 0 || expected != b.Revision) throw new CostingConcurrencyException("库存数据已变化，请重取后再操作。");
    }
    internal static void Unlocked(InventoryBook b) => Require(b.Calculation is null, "成本核算完毕，本月数据不能再输入！");
    internal static InventoryBook Commit(InventoryBook b, string actor, string action, string target)
    {
        Text(actor, "操作人");
        var next = b with { Revision = checked(b.Revision + 1), Audit = ReadOnly(b.Audit.Append(new(b.Revision + 1, actor, action, target))) };
        Validate(next); return Freeze(next);
    }
}
