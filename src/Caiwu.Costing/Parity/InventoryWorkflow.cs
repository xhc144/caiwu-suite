using static Caiwu.Costing.CostMath;
using static Caiwu.Costing.Parity.InventoryRules;

namespace Caiwu.Costing.Parity;

/// <summary>One month's document workflow; host supplies authenticated actor, account catalog and transaction CAS.</summary>
public static class InventoryWorkflow
{
    public const string PolicyVersion = "original-month-end-weighted-slice-v1";

    public static InventoryBook Create(Guid id, CostPeriod period, InventoryPrecision precision, IReadOnlyList<Warehouse> warehouses)
    {
        var book = new InventoryBook(id, period, precision, 0, ReadOnly(warehouses), [], [], [], [], null, [], []);
        Validate(book); return Freeze(book);
    }
    public static InventoryBook SaveProduct(InventoryBook book, Product product, IReadOnlyList<InventoryAccount> accounts,
        string actor, long expectedRevision)
    {
        Version(book, expectedRevision); Unlocked(book); ValidateProduct(book, product); Account(product.InventoryAccount, accounts);
        if (!string.IsNullOrEmpty(product.SalesAccount)) Account(product.SalesAccount, accounts);
        var old = book.Products.SingleOrDefault(p => p.Code == product.Code);
        if (old is not null) product = product with { OriginalRows = Preserve(old.OriginalRows, product.OriginalRows) };
        return Commit(book with { Products = ReadOnly(book.Products.Where(p => p.Code != product.Code).Append(Freeze(product))) }, actor, "product.save", product.Code);
    }
    public static InventoryBook DeleteProduct(InventoryBook book, string productCode, string actor, long expectedRevision)
    {
        Version(book, expectedRevision); Unlocked(book);
        Require(book.Products.Any(p => p.Code == productCode), "此产品不存在！");
        Require(!book.Openings.Any(p => p.ProductCode == productCode) && !book.Documents.Any(d => d.Lines.Any(l => l.ProductCode == productCode)) &&
            !book.Stocktakes.Any(t => t.ProductCode == productCode), "产品已经使用，无法删除！");
        return Commit(book with { Products = ReadOnly(book.Products.Where(p => p.Code != productCode)) }, actor, "product.delete", productCode);
    }
    public static InventoryBook SaveOpening(InventoryBook book, InventoryOpening opening, string actor, long expectedRevision)
    {
        Version(book, expectedRevision); Unlocked(book); Key(book, opening.WarehouseCode, opening.ProductCode);
        Qty(opening.Quantity, book.Precision); Money(opening.Amount);
        var old = book.Openings.SingleOrDefault(p => p.WarehouseCode == opening.WarehouseCode && p.ProductCode == opening.ProductCode);
        if (old is not null) opening = opening with { OriginalRows = Preserve(old.OriginalRows, opening.OriginalRows) };
        return Commit(book with { Openings = ReadOnly(book.Openings.Where(p => p != old).Append(Freeze(opening))) }, actor, "opening.save", opening.ProductCode);
    }
    public static InventoryBook SaveDocument(InventoryBook book, InventoryDocument document, IReadOnlyList<InventoryAccount> accounts,
        string actor, long expectedRevision)
    {
        Version(book, expectedRevision); Unlocked(book); ValidateDocument(book, document);
        var old = book.Documents.SingleOrDefault(d => d.Id == document.Id);
        if (old is not null)
        {
            Editable(old);
            Require(old.Kind == document.Kind, "不能改变已保存单据的业务类别。");
            // Retain removed detail rows too: raw rows are provenance, not a rewrite instruction.
            document = document with { OriginalRows = Preserve(old.OriginalRows.Concat(old.Lines.SelectMany(l => l.OriginalRows)).ToArray(), document.OriginalRows) };
            document = document with { Lines = ReadOnly(document.Lines.Select(l => l with
            { OriginalRows = Preserve(old.Lines.SingleOrDefault(x => x.Sequence == l.Sequence)?.OriginalRows ?? [], l.OriginalRows) })) };
        }
        Require(document.Reviewer is null && document.VoucherLinks.Count == 0, "存盘不能伪造审核或凭证状态。");
        if (document.Kind is InventoryDocumentKind.Receipt or InventoryDocumentKind.Sale) Account(document.SettlementAccount, accounts);
        if (document.Kind is InventoryDocumentKind.Sale or InventoryDocumentKind.Consumption) Account(document.CostAccount, accounts);
        Require(!book.Documents.Any(d => d.Id != document.Id && d.Kind == document.Kind && d.Number == document.Number), "单号重复！");
        var next = book with { Documents = ReadOnly(book.Documents.Where(d => d.Id != document.Id).Append(Freeze(document))) };
        Require(document.NegativeStockConfirmed || CurrentStock(next).All(p => p.Quantity >= 0),
            "产品出库数量大于库存数量！请明确确认后再存盘；核算时仍须有足够的月度成本基数。");
        return Commit(next, actor, "document.save", document.Id.ToString());
    }
    public static InventoryBook DeleteDocument(InventoryBook book, Guid documentId, string actor, long expectedRevision)
    {
        Version(book, expectedRevision); Unlocked(book); var d = Find(book, documentId); Editable(d);
        return Commit(book with { Documents = ReadOnly(book.Documents.Where(d => d.Id != documentId)) }, actor, "document.delete", documentId.ToString());
    }
    public static InventoryBook ReviewDocument(InventoryBook book, Guid documentId, bool review, string actor, long expectedRevision)
    {
        Version(book, expectedRevision); Unlocked(book); Text(actor, "审核人"); var d = Find(book, documentId);
        Require(d.VoucherLinks.Count == 0, "此单据已经生成凭证，不能更改审核状态！");
        Require(review ? d.Reviewer is null : d.Reviewer == actor, review ? "此单据已经审核！" : "只有原审核人可以取消审核！");
        var changed = d with { Reviewer = review ? actor : null };
        return Commit(book with { Documents = ReadOnly(book.Documents.Select(x => x.Id == d.Id ? changed : x)) }, actor,
            review ? "document.review" : "document.unreview", documentId.ToString());
    }
    public static InventoryBook SaveStocktake(InventoryBook book, InventoryStocktake stocktake, string actor, long expectedRevision)
    {
        Version(book, expectedRevision); Unlocked(book); Key(book, stocktake.WarehouseCode, stocktake.ProductCode); Qty(stocktake.ActualQuantity, book.Precision);
        var old = book.Stocktakes.SingleOrDefault(p => p.WarehouseCode == stocktake.WarehouseCode && p.ProductCode == stocktake.ProductCode);
        if (old is not null) stocktake = stocktake with { OriginalRows = Preserve(old.OriginalRows, stocktake.OriginalRows) };
        return Commit(book with { Stocktakes = ReadOnly(book.Stocktakes.Where(p => p != old).Append(Freeze(stocktake))) }, actor, "stocktake.save", stocktake.ProductCode);
    }
    public static IReadOnlyList<InventoryBalance> CurrentStock(InventoryBook book)
    {
        Validate(book);
        if (book.Calculation is { } calculation)
            return ReadOnly(calculation.Totals.Select(t => new InventoryBalance(t.WarehouseCode, t.ProductCode, t.ClosingQuantity, t.ClosingAmount)));
        return ReadOnly(Keys(book).Select(k => new InventoryBalance(k.WarehouseCode, k.ProductCode,
            book.Openings.Where(o => o.WarehouseCode == k.WarehouseCode && o.ProductCode == k.ProductCode).Sum(o => o.Quantity) +
            book.Documents.Where(d => d.WarehouseCode == k.WarehouseCode).Sum(d => (d.Kind == InventoryDocumentKind.Receipt ? 1 : -1) *
                d.Lines.Where(l => l.ProductCode == k.ProductCode).Sum(l => l.Quantity)), null)));
    }
    public static InventoryBook Calculate(InventoryBook book, bool adjustZeroQuantityResidual, string actor, long expectedRevision)
    {
        Version(book, expectedRevision); Unlocked(book);
        var result = Compute(book, adjustZeroQuantityResidual);
        return Commit(book with { Calculation = result }, actor, "cost.calculate", $"{book.Period.Year:D4}{book.Period.Month:D2}");
    }
    public static InventoryBook CancelCalculation(InventoryBook book, string actor, long expectedRevision)
    {
        Version(book, expectedRevision); Require(book.Calculation is not null, "已到初始开帐日期，无需反过账！");
        Require(!book.VoucherClaims.Any(c => c.Kind is InventoryVoucherKind.IssueCost or InventoryVoucherKind.Stocktake) &&
            !book.Documents.SelectMany(d => d.VoucherLinks).Any(l => l.Kind is InventoryVoucherKind.IssueCost or InventoryVoucherKind.Stocktake),
            "成本凭证仍有关联，请先按总账审核/过账状态处理凭证再取消核算。");
        return Commit(book with { Calculation = null }, actor, "cost.cancel", $"{book.Period.Year:D4}{book.Period.Month:D2}");
    }
    // Link commit is intentionally a host transaction concern; never creates a GL voucher here.
    public static InventoryBook LinkDraft(InventoryBook book, InventoryVoucherPlan plan, Guid documentId, InventoryVoucherKind kind,
        string voucherIdentity, string actor, long expectedRevision)
    {
        Version(book, expectedRevision); InventoryVoucherPlanner.ValidateSource(book, plan); Text(voucherIdentity, "凭证标识");
        Require(plan.Vouchers.Any(v => v.DocumentId == documentId && v.Kind == kind), "计划中没有此单据的凭证。");
        var d = Find(book, documentId); Require(!d.VoucherLinks.Any(l => l.Kind == kind), "已有重复凭证，不能生成！");
        var changed = d with { VoucherLinks = ReadOnly(d.VoucherLinks.Append(new(kind, voucherIdentity, LinkedVoucherState.Draft))) };
        return Commit(book with { Documents = ReadOnly(book.Documents.Select(x => x.Id == documentId ? changed : x)) }, actor, "voucher.link-draft", voucherIdentity);
    }
    /// <summary>Called only by a host that commits this state and the new draft in one transaction.
    /// The proposal reference resolves through ModuleVoucherReceipt; it is not a fabricated voucher ID.</summary>
    public static InventoryBook ClaimPlan(InventoryBook book, InventoryVoucherPlan plan, string sourceKey, Guid proposalId,
        string actor, long expectedRevision)
    {
        Version(book, expectedRevision); InventoryVoucherPlanner.ValidateSource(book, plan);
        Require(proposalId != Guid.Empty, "凭证建议标识不能为空。");
        var voucher = plan.Vouchers.SingleOrDefault(v => v.SourceKey == sourceKey)
            ?? throw new CostingValidationException("凭证来源不在计划中。");
        Require(!book.VoucherClaims.Any(c => c.SourceKey == sourceKey || c.ProposalId == proposalId), "凭证来源或建议已经认领。");
        var next = book with { VoucherClaims = ReadOnly(book.VoucherClaims.Append(new(sourceKey, proposalId, voucher.Kind, voucher.DocumentId))) };
        if (voucher.DocumentId is { } id)
        {
            var d = Find(book, id); Require(!d.VoucherLinks.Any(l => l.Kind == voucher.Kind), "已有重复凭证，不能生成！");
            var changed = d with { VoucherLinks = ReadOnly(d.VoucherLinks.Append(new(voucher.Kind, $"proposal:{proposalId:D}", LinkedVoucherState.Draft))) };
            next = next with { Documents = ReadOnly(next.Documents.Select(x => x.Id == id ? changed : x)) };
        }
        return Commit(next, actor, "voucher.claim-proposal", sourceKey);
    }
    internal static MonthlyInventoryCalculation Compute(InventoryBook book, bool adjust)
    {
        var totals = new List<MonthlyInventoryTotal>(); var costs = new List<IssueCost>();
        foreach (var key in Keys(book))
        {
            var opening = book.Openings.SingleOrDefault(o => o.WarehouseCode == key.WarehouseCode && o.ProductCode == key.ProductCode);
            var receiptLines = book.Documents.Where(d => d.WarehouseCode == key.WarehouseCode && d.Kind == InventoryDocumentKind.Receipt)
                .SelectMany(d => d.Lines).Where(l => l.ProductCode == key.ProductCode).ToArray();
            var issues = book.Documents.Where(d => d.WarehouseCode == key.WarehouseCode && d.Kind != InventoryDocumentKind.Receipt)
                .OrderBy(d => d.Date).ThenBy(d => d.Number, StringComparer.Ordinal).ThenBy(d => d.Id)
                .SelectMany(d => d.Lines.Where(l => l.ProductCode == key.ProductCode).OrderBy(l => l.Sequence).Select(l => (d.Id, Line: l))).ToArray();
            var oq = opening?.Quantity ?? 0; var oa = opening?.Amount ?? 0;
            var rq = receiptLines.Sum(l => l.Quantity); var ra = receiptLines.Sum(l => l.NetAmount);
            var aq = oq + rq; var aa = oa + ra; Money(aa);
            var iq = issues.Sum(x => x.Line.Quantity);
            Require(iq <= aq, $"{key.WarehouseCode}/{key.ProductCode} 月度可用数量不足，不能核算。");
            decimal assigned = 0, cumulative = 0;
            foreach (var issue in issues)
            {
                cumulative += issue.Line.Quantity;
                var target = Proportion(aa, cumulative, aq);
                costs.Add(new(issue.Id, issue.Line.Sequence, target - assigned)); assigned = target;
            }
            var expectedQuantity = aq - iq; var expectedAmount = aa - assigned;
            var actualQuantity = book.Stocktakes.SingleOrDefault(t => t.WarehouseCode == key.WarehouseCode && t.ProductCode == key.ProductCode)?.ActualQuantity ?? expectedQuantity;
            decimal finalAmount;
            if (aq == 0)
            {
                Require(actualQuantity == 0, "盘盈产品没有可用成本基数，须补齐经确认的成本后核算。");
                Require(aa == 0 || adjust, "存在没有数量还有金额的产品，请明确选择自动调整或修正期初。");
                finalAmount = 0;
            }
            else finalAmount = actualQuantity == expectedQuantity ? expectedAmount : Proportion(aa, actualQuantity, aq);
            totals.Add(new(key.WarehouseCode, key.ProductCode, oq, oa, rq, ra, iq, assigned,
                actualQuantity - expectedQuantity, finalAmount - expectedAmount, actualQuantity, finalAmount));
        }
        return new(PolicyVersion, Source(book), adjust, ReadOnly(costs), ReadOnly(totals));
    }
    private static IEnumerable<(string WarehouseCode, string ProductCode)> Keys(InventoryBook b) =>
        b.Openings.Select(o => (o.WarehouseCode, o.ProductCode))
        .Concat(b.Documents.SelectMany(d => d.Lines.Select(l => (d.WarehouseCode, l.ProductCode))))
        .Concat(b.Stocktakes.Select(t => (t.WarehouseCode, t.ProductCode))).Distinct()
        .OrderBy(k => k.WarehouseCode, StringComparer.Ordinal).ThenBy(k => k.ProductCode, StringComparer.Ordinal);
    private static InventoryDocument Find(InventoryBook b, Guid id) => b.Documents.SingleOrDefault(d => d.Id == id)
        ?? throw new CostingValidationException("此单据不存在！");
    private static void Editable(InventoryDocument d)
    {
        Require(d.Reviewer is null, "此单据已经审核，不能修改或删除！");
        Require(d.VoucherLinks.Count == 0, "此单据已经生成凭证，不能修改或删除！");
    }
    private static IReadOnlyList<OriginalRow> Preserve(IEnumerable<OriginalRow> old, IEnumerable<OriginalRow> incoming) =>
        Rows(old.Concat(incoming).DistinctBy(r => Fingerprint(r)).ToArray());
}
