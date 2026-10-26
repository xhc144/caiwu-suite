using static Caiwu.Costing.CostMath;
using static Caiwu.Costing.Parity.InventoryRules;

namespace Caiwu.Costing.Parity;

/// <summary>Produces reviewed-input draft plans. Does not assign voucher numbers, post, delete or call persistence.</summary>
public static class InventoryVoucherPlanner
{
    public static InventoryVoucherPlan Plan(InventoryBook book, InventoryVoucherKind kind, DateOnly from, DateOnly to,
        InventoryVoucherSettings settings, IReadOnlyList<InventoryAccount> accounts)
    {
        Validate(book); Require(Enum.IsDefined(kind), "凭证类别无效。"); Date(book.Period, from); Date(book.Period, to);
        Require(from <= to, "开始日期不能大于截止日期！");
        var output = new List<InventoryPlannedVoucher>();
        if (kind is InventoryVoucherKind.IssueCost or InventoryVoucherKind.Stocktake)
        {
            Require(book.Calculation is not null, "成本凭证请在本月【成本核算】后生成！");
            Require(Fingerprint(book.Calculation) == Fingerprint(InventoryWorkflow.Compute(book, book.Calculation.AdjustZeroQuantityResidual)),
                "核算结果与单据不一致，不能生成凭证。");
        }
        if (kind == InventoryVoucherKind.Stocktake)
        {
            var date = new DateOnly(book.Period.Year, book.Period.Month, DateTime.DaysInMonth(book.Period.Year, book.Period.Month));
            Require(date >= from && date <= to, "盘点凭证日期不在所选范围内。");
            foreach (var t in book.Calculation!.Totals.Where(t => t.StocktakeAmountDifference != 0))
            {
                var lines = new List<InventoryPlannedLine>();
                var inventory = book.Products.Single(p => p.Code == t.ProductCode).InventoryAccount;
                var amount = Math.Abs(t.StocktakeAmountDifference);
                Add(lines, inventory, t.StocktakeAmountDifference > 0 ? amount : 0, t.StocktakeAmountDifference < 0 ? amount : 0);
                Add(lines, settings.InventoryDifferenceAccount, t.StocktakeAmountDifference < 0 ? amount : 0, t.StocktakeAmountDifference > 0 ? amount : 0);
                Make($"{book.Id:N}/stocktake/{Fingerprint(new { t.WarehouseCode, t.ProductCode })}", null, date, lines);
            }
        }
        else
        {
            foreach (var d in book.Documents.Where(d => d.Date >= from && d.Date <= to).OrderBy(d => d.Date).ThenBy(d => d.Number, StringComparer.Ordinal))
            {
                if (d.VoucherLinks.Any(l => l.Kind == kind)) continue;
                if (kind == InventoryVoucherKind.Receipt && d.Kind != InventoryDocumentKind.Receipt ||
                    kind == InventoryVoucherKind.SalesRevenue && d.Kind != InventoryDocumentKind.Sale ||
                    kind == InventoryVoucherKind.IssueCost && d.Kind == InventoryDocumentKind.Receipt) continue;
                var lines = new List<InventoryPlannedLine>();
                foreach (var l in d.Lines)
                {
                    var product = book.Products.Single(p => p.Code == l.ProductCode);
                    switch (kind)
                    {
                        case InventoryVoucherKind.Receipt:
                            Add(lines, product.InventoryAccount, l.NetAmount, 0);
                            Add(lines, settings.InputTaxAccount, l.TaxAmount, 0);
                            Add(lines, d.SettlementAccount, 0, l.GrossAmount);
                            break;
                        case InventoryVoucherKind.SalesRevenue:
                            Add(lines, d.SettlementAccount, l.GrossAmount, 0);
                            Add(lines, settings.RevenueAccount, 0, l.NetAmount);
                            Add(lines, settings.OutputTaxAccount, 0, l.TaxAmount);
                            break;
                        case InventoryVoucherKind.IssueCost:
                            var cost = book.Calculation!.IssueCosts.Single(c => c.DocumentId == d.Id && c.Sequence == l.Sequence).Amount;
                            Add(lines, d.CostAccount, cost, 0); Add(lines, product.InventoryAccount, 0, cost);
                            break;
                    }
                }
                Make($"{book.Id:N}/{d.Id:N}/{kind}", d.Id, d.Date, lines);
            }
        }
        Require(output.Count > 0, "无数据，不能生成凭证计划！");
        return new(book.Id, book.Revision, PlanSource(book), ReadOnly(output));

        void Add(List<InventoryPlannedLine> lines, string account, decimal debit, decimal credit)
        {
            if (debit == 0 && credit == 0) return;
            Account(account, accounts); Money(debit); Money(credit);
            lines.Add(new(account, kind.ToString(), debit, credit));
        }
        void Make(string key, Guid? id, DateOnly date, List<InventoryPlannedLine> lines)
        {
            if (lines.Count == 0 || book.VoucherClaims.Any(c => c.SourceKey == key)) return;
            var combined = lines.GroupBy(l => (l.AccountCode, DebitSide: l.Debit != 0)).Select(g =>
                new InventoryPlannedLine(g.Key.AccountCode, kind.ToString(), g.Sum(l => l.Debit), g.Sum(l => l.Credit))).ToArray();
            foreach (var l in combined) { Money(l.Debit); Money(l.Credit); }
            Money(combined.Sum(l => l.Debit)); Money(combined.Sum(l => l.Credit));
            Require(combined.Sum(l => l.Debit) == combined.Sum(l => l.Credit), "借贷不平，不能生成凭证计划！");
            output.Add(new(key, id, kind, date, ReadOnly(combined)));
        }
    }
    public static void ValidateSource(InventoryBook book, InventoryVoucherPlan plan)
    {
        Validate(book);
        if (plan.BookId != book.Id || plan.SourceRevision != book.Revision || plan.SourceFingerprint != PlanSource(book))
            throw new CostingConcurrencyException("凭证计划来源已变化，请重新生成计划。");
    }
    private static string PlanSource(InventoryBook b) => Fingerprint(new { Source = Source(b), b.Calculation, Links = b.Documents.Select(d => d.VoucherLinks).ToArray(), b.VoucherClaims }, "inventory-voucher-source-v1");
}
