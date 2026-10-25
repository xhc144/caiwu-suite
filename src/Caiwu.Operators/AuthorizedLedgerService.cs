using Caiwu.Contracts;

namespace Caiwu.Operators;

/// <summary>
/// Central ILedgerService authorization boundary for one fixed login session. Never exposes the raw service.
/// Legacy operatorName/reviewer parameters are ignored; trusted immutable actor keys come from the session.
/// Original mutation contexts and draft tokens pass through unchanged to Core's final CAS check.
/// </summary>
public sealed class AuthorizedLedgerService : ILedgerService
{
    private readonly ILedgerService _inner;
    private readonly LocalOperatorService _operators;
    private readonly OperatorSession _session;

    public AuthorizedLedgerService(ILedgerService inner, LocalOperatorService operators, OperatorSession session)
    {
        _inner = inner ?? throw new ArgumentNullException(nameof(inner));
        _operators = operators ?? throw new ArgumentNullException(nameof(operators));
        _session = session ?? throw new ArgumentNullException(nameof(session));
        _operators.RequirePermission(_session, OperatorPermission.ReadLedger);
    }

    public LedgerSnapshot GetSnapshot() => Read(_inner.GetSnapshot);
    public IReadOnlyList<TrialBalanceRow> GetTrialBalance(DateOnly from, DateOnly to)
        => Read(() => _inner.GetTrialBalance(from, to));
    public IReadOnlyList<LedgerEntryRow> GetLedger(string accountCode, DateOnly from, DateOnly to)
        => Read(() => _inner.GetLedger(accountCode, from, to));

    public void SaveAccount(Account account, string operatorName, LedgerMutationContext? context = null)
        => Write(OperatorPermission.EditAccounts, actor => _inner.SaveAccount(account, actor.ActorKey, context));
    public void DeleteAccount(string code, string operatorName, LedgerMutationContext? context = null)
        => Write(OperatorPermission.EditAccounts, actor => _inner.DeleteAccount(code, actor.ActorKey, context));
    public void SetOpeningBalances(IReadOnlyList<OpeningBalance> balances, string operatorName, LedgerMutationContext? context = null)
        => Write(OperatorPermission.EditOpeningBalances, actor => _inner.SetOpeningBalances(balances, actor.ActorKey, context));

    public Voucher SaveDraft(VoucherDraft draft, string operatorName)
    {
        ArgumentNullException.ThrowIfNull(draft);
        if (draft.Id is not { } id)
            return _operators.Execute(_session, OperatorPermission.PrepareVoucher, actor => _inner.SaveDraft(draft, actor.ActorKey));
        var originalContext = draft.ExpectedBookId is { } bookId && draft.ExpectedRevision is { } revision
            ? new LedgerMutationContext(bookId, revision) : null;
        return _operators.ExecuteDraftEditFrom(_session,
            () => ReadExpectedVoucher(id, originalContext).PreparedBy,
            actor => _inner.SaveDraft(draft, actor.ActorKey));
    }

    public void DeleteDraft(Guid id, string operatorName, LedgerMutationContext? context = null)
        => _operators.ExecuteDraftEditFrom(_session,
            () => ReadExpectedVoucher(id, context).PreparedBy,
            actor => { _inner.DeleteDraft(id, actor.ActorKey, context); return true; });

    public void Review(Guid id, string reviewer, LedgerMutationContext? context = null)
        => _operators.ExecuteReviewFrom(_session,
            () => ReadExpectedVoucher(id, context).PreparedBy,
            actor => { _inner.Review(id, actor.ActorKey, context); return true; });

    public void CancelReview(Guid id, string operatorName, LedgerMutationContext? context = null)
        => Write(OperatorPermission.ReviewVoucher, actor => _inner.CancelReview(id, actor.ActorKey, context));
    public void Post(Guid id, string operatorName, LedgerMutationContext? context = null)
        => Write(OperatorPermission.PostVoucher, actor => _inner.Post(id, actor.ActorKey, context));
    public void CloseMonth(int month, string operatorName, LedgerMutationContext? context = null)
        => Write(OperatorPermission.ClosePeriod, actor => _inner.CloseMonth(month, actor.ActorKey, context));

    private T Read<T>(Func<T> read) => _operators.Execute(_session, OperatorPermission.ReadLedger, _ => read());
    private void Write(OperatorPermission permission, Action<OperatorIdentity> write)
        => _operators.Execute(_session, permission, actor => { write(actor); return true; });

    private Voucher ReadExpectedVoucher(Guid id, LedgerMutationContext? context)
    {
        if (context is null) throw new StoreConcurrencyException("缺少原账套/版本快照，请重新打开并核对凭证。");
        var snapshot = _inner.GetSnapshot();
        if (snapshot.Book.Id != context.ExpectedBookId || snapshot.Revision != context.ExpectedRevision)
            throw new StoreConcurrencyException("凭证所属账套或版本已变化；未执行操作，请重新打开并核对。");
        return snapshot.Vouchers.SingleOrDefault(voucher => voucher.Id == id)
            ?? throw new LedgerValidationException("凭证不存在。");
    }
}

/// <summary>Use only in the composition root. Captures the exact login object, never a mutable current-session getter.</summary>
public static class AuthorizedLedgerServiceFactory
{
    public static Func<ILedgerStore, ILedgerService> BindSession(LocalOperatorService operators, OperatorSession session,
        Func<ILedgerStore, ILedgerService> trustedFactory)
    {
        ArgumentNullException.ThrowIfNull(operators); ArgumentNullException.ThrowIfNull(session); ArgumentNullException.ThrowIfNull(trustedFactory);
        operators.RequirePermission(session, OperatorPermission.ReadLedger);
        return store =>
        {
            // Reject a logged-out factory before invoking even the trusted raw factory.
            operators.RequirePermission(session, OperatorPermission.ReadLedger);
            return new AuthorizedLedgerService(trustedFactory(store), operators, session);
        };
    }
}
