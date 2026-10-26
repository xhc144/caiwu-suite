using Caiwu.Contracts;

namespace Caiwu.Cashier.Integration;

/// <summary>
/// Builds a user-reviewable proposal from the same snapshot used for the plan. Unsupported rich
/// accounting values fail explicitly; they are never rounded or squeezed into VoucherLine.
/// Submit only after the host has obtained the real operator's confirmation and authorization.
/// </summary>
public sealed class CashierVoucherProposalAdapter(IParityLedgerService ledger, BookDefinition definition)
{
    public VoucherProposal CreateProposal(ModuleLedgerSnapshot sameSnapshot, VoucherPlan plan, int voucherIndex,
        Guid proposalId, string kind, int? number = null, int attachmentCount = 0)
    {
        var state = ParityCashierStore.Project(sameSnapshot, definition);
        if (plan.BookId != state.Book.Id || plan.SourceRevision != sameSnapshot.Ledger.Revision)
            throw new CashierConcurrencyException(plan.SourceRevision, sameSnapshot.Ledger.Revision);
        if (proposalId == Guid.Empty || voucherIndex < 0 || voucherIndex >= plan.Vouchers.Length)
            throw new CashierRuleException("voucher.selection", "请选择有效的凭证计划与建议识别号。");
        var selected = plan.Vouchers[voucherIndex];
        var sources = selected.SourceDocuments.Select(id => state.Documents.SingleOrDefault(d => d.Id == id)
            ?? throw new CashierRuleException("voucher.source", "凭证来源单据不存在。")).ToArray();
        if (sources.Length == 0 || sources.Any(x => x.GeneratedVoucherId is not null))
            throw new CashierRuleException("voucher.consumed", "凭证来源为空或已经生成过凭证。");
        if (sources.Any(x => x.Account.Currency != state.Book.BaseCurrency || x.OriginalFields?.Count > 0)
            || selected.Lines.Any(x => x.Currency != state.Book.BaseCurrency || x.Rate != 1
                || x.Debit < 0 || x.Credit < 0 || decimal.Round(x.Debit, 2) != x.Debit || decimal.Round(x.Credit, 2) != x.Credit
                || x.Debit > long.MaxValue / 100m || x.Credit > long.MaxValue / 100m))
            throw new CashierRuleException("voucher.contract.gap",
                "公共凭证 DTO 暂不支持此单据的外币、原字段、负数或原精度；保留原值，未提交凭证。");
        var rates = plan.Vouchers.SelectMany(x => x.Lines).GroupBy(x => x.Currency).ToDictionary(x => x.Key, x => x.First().Rate);
        var canonical = new CashierService(new SnapshotOnlyStore(state)).CreateVoucherPlan(sources[0].Date.Year,
            sources[0].Date.Month, plan.Grouping, rates);
        var match = canonical.Vouchers.SingleOrDefault(x => x.PlanKey == selected.PlanKey);
        if (match is null || match.Date != selected.Date || !match.SourceDocuments.SequenceEqual(selected.SourceDocuments) || !match.Lines.SequenceEqual(selected.Lines))
            throw new CashierRuleException("voucher.plan.changed", "凭证计划与原始单据不一致，请重新生成计划。");
        var claimed = sources.Select(x => x.Id).ToHashSet();
        var next = state with { Revision = checked(state.Revision + 1), Documents = state.Documents.Select(d => claimed.Contains(d.Id)
            ? d with { GeneratedVoucherId = $"proposal:{proposalId:D}" } : d).ToArray() };
        return new(proposalId, ParityCashierStore.ModuleId, sources.Select(x => ParityCashierStore.SourceKey(x.Id)).ToArray(),
            ParityCashierStore.Context(sameSnapshot), selected.Date, kind, number, attachmentCount,
            selected.Lines.Select(x => new VoucherLine(x.AccountCode, x.Summary, x.Debit, x.Credit)).ToArray(),
            [ParityCashierStore.Change(next)]);
    }

    public ModuleVoucherReceipt AcceptConfirmed(VoucherProposal reviewedProposal, string actor) =>
        ledger.AcceptVoucherProposal(reviewedProposal, actor);

    private sealed class SnapshotOnlyStore(CashierSnapshot state) : ICashierStore
    {
        public CashierSnapshot Read() => ParityCashierStore.Clone(state);
        public CashierSnapshot Transact(long expectedRevision, Func<CashierSnapshot, CashierSnapshot> transform) =>
            throw new NotSupportedException("凭证计划视图只读。");
    }
}
