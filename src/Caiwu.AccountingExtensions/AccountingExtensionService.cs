using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Operators;
using static Caiwu.AccountingExtensions.LedgerStateRules;

namespace Caiwu.AccountingExtensions;

/// <summary>
/// Adapter for the current single-year legacy ledger. Caller owns the store. Original database
/// auxiliary tables require the atomic integration contract documented in the module handoff.
/// </summary>
public sealed class AccountingExtensionService
{
    private readonly ILedgerStore store;
    private readonly LedgerService ledger;
    private readonly LocalOperatorService operators;
    private readonly OperatorSession session;
    private readonly TimeProvider clock;

    public AccountingExtensionService(ILedgerStore store, LocalOperatorService operators,
        OperatorSession session, TimeProvider? clock = null)
    {
        this.store = store ?? throw new ArgumentNullException(nameof(store));
        this.operators = operators ?? throw new ArgumentNullException(nameof(operators));
        this.session = session ?? throw new ArgumentNullException(nameof(session));
        this.clock = clock ?? TimeProvider.System;
        ledger = new LedgerService(store);
    }

    public LedgerSnapshot GetSnapshot() => operators.Execute(session, OperatorPermission.ReadLedger,
        _ => ValidateAndFreeze(store.Read()));

    public AccountingMutationResult ReversePosting(ReversePostingRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return operators.Execute(session, OperatorPermission.PostVoucher, actor =>
        {
            RequireReverseAdministrator(actor);
            var before = ValidateAndFreeze(store.Read());
            Context(before, request.Context);
            RequireLegacyLedger(before);
            Period(before, request.FiscalYear, request.AllMonths ? before.Book.StartMonth : request.FromMonth);
            var from = request.AllMonths ? before.Book.StartMonth : request.FromMonth;
            var through = request.AllMonths ? 12 : request.ThroughMonth;
            Period(before, request.FiscalYear, through);
            Require(from <= through, "请输入有效的起止月份范围。");
            Require(from > before.Book.ClosedThroughMonth, "所选月份已经结账，不能反过账；请先反结账。");
            var selected = before.Vouchers.Where(v => v.Date.Month >= from && v.Date.Month <= through &&
                v.Status == VoucherStatus.Posted).ToArray();
            Require(selected.Length != 0, "所选范围没有已过账凭证。");
            var ids = selected.Select(v => v.Id).ToHashSet();
            var next = before with
            {
                Vouchers = before.Vouchers.Select(v => ids.Contains(v.Id)
                    ? v with { Status = VoucherStatus.Reviewed } : v).ToArray()
            };
            var at = clock.GetUtcNow();
            var audits = selected.Select(v => new AuditEvent(Guid.NewGuid(), at, actor.ActorKey,
                "ReversePosting", v.Id, $"反过账 {request.FiscalYear}-{v.Date.Month:00} {v.Kind}-{v.Number}；保留审核信息"));
            return Commit(before, next, audits, selected.Length);
        });
    }

    public AccountingMutationResult ReopenPeriod(ReopenPeriodRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return operators.Execute(session, OperatorPermission.ClosePeriod, actor =>
        {
            RequireReverseAdministrator(actor);
            var before = ValidateAndFreeze(store.Read());
            Context(before, request.Context);
            RequireLegacyLedger(before);
            Period(before, request.FiscalYear, before.Book.StartMonth);
            var through = before.Book.ClosedThroughMonth;
            Require(through >= before.Book.StartMonth, "已经反结账到开账日期，不能继续反结账。");
            var nextThrough = request.AllMonths ? before.Book.StartMonth - 1 : through - 1;
            var next = before with { Book = before.Book with { ClosedThroughMonth = nextThrough } };
            var audit = new AuditEvent(Guid.NewGuid(), clock.GetUtcNow(), actor.ActorKey, "ReopenPeriod", null,
                $"反结账 {request.FiscalYear}-{nextThrough + 1:00} 至 {request.FiscalYear}-{through:00}；保留本年开账余额");
            return Commit(before, next, [audit], through - nextThrough);
        });
    }

    public MonthlyTransferPlan PreviewMonthlyTransfer(MonthlyTransferRequest request)
        => operators.Execute(session, OperatorPermission.PrepareVoucher,
            _ => PlanLegacyTransfer(request));

    /// <summary>
    /// Rebuilds the plan with its original context, then uses real Core.SaveDraft. Core re-reads and
    /// CAS-checks that same context; a writer between planning and saving causes a conflict, never a retry.
    /// </summary>
    public Voucher GenerateMonthlyTransfer(MonthlyTransferRequest request)
        => operators.Execute(session, OperatorPermission.PrepareVoucher, actor =>
        {
            var plan = PlanLegacyTransfer(request);
            return ledger.SaveDraft(plan.ToDraft(), actor.ActorKey);
        });

    private MonthlyTransferPlan PlanLegacyTransfer(MonthlyTransferRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var before = ValidateAndFreeze(store.Read());
        Context(before, request.Context);
        RequireLegacyLedger(before);
        return MonthlyTransferPlanner.CreatePlan(before, request);
    }

    private AccountingMutationResult Commit(LedgerSnapshot before, LedgerSnapshot next,
        IEnumerable<AuditEvent> audits, int affected)
    {
        var accepted = checked(before.Revision + 1);
        next = Freeze(next with { Revision = accepted, AuditEvents = before.AuditEvents.Concat(audits).ToArray() });
        store.Write(next, before.Revision);
        return new(accepted, affected);
    }

    // Until independent original menu rights are integrated, reversal requires BOTH the ordinary
    // posting/closing role and Administrator. No UI actor string or cached identity grants access.
    private static void RequireReverseAdministrator(OperatorIdentity actor)
    {
        if (!actor.Roles.HasFlag(OperatorRoles.Administrator))
            throw new OperatorAuthorizationException("反过账和反结账暂需管理员及对应过账/结账权限；请由已授权管理员操作。");
    }
}
