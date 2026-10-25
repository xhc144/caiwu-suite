using Caiwu.Contracts;

namespace Caiwu.Acceptance;

internal sealed record SeenMutation(string Method, LedgerMutationContext? Context = null, VoucherDraft? Draft = null);

/// <summary>Observe actual UI arguments; forward unchanged to the real service, without token reads.</summary>
internal sealed class ObservedLedgerService(ILedgerService inner, IList<SeenMutation> seen) : ILedgerService
{
    private void Write(string method, LedgerMutationContext? context, Action command)
    { seen.Add(new(method, context)); command(); }
    public LedgerSnapshot GetSnapshot() => inner.GetSnapshot();
    public void SaveAccount(Account a, string o, LedgerMutationContext? c = null) => Write(nameof(SaveAccount), c, () => inner.SaveAccount(a, o, c));
    public void DeleteAccount(string a, string o, LedgerMutationContext? c = null) => Write(nameof(DeleteAccount), c, () => inner.DeleteAccount(a, o, c));
    public void SetOpeningBalances(IReadOnlyList<OpeningBalance> b, string o, LedgerMutationContext? c = null) => Write(nameof(SetOpeningBalances), c, () => inner.SetOpeningBalances(b, o, c));
    public Voucher SaveDraft(VoucherDraft d, string o) { seen.Add(new(nameof(SaveDraft), Draft: d)); return inner.SaveDraft(d, o); }
    public void DeleteDraft(Guid id, string o, LedgerMutationContext? c = null) => Write(nameof(DeleteDraft), c, () => inner.DeleteDraft(id, o, c));
    public void Review(Guid id, string o, LedgerMutationContext? c = null) => Write(nameof(Review), c, () => inner.Review(id, o, c));
    public void CancelReview(Guid id, string o, LedgerMutationContext? c = null) => Write(nameof(CancelReview), c, () => inner.CancelReview(id, o, c));
    public void Post(Guid id, string o, LedgerMutationContext? c = null) => Write(nameof(Post), c, () => inner.Post(id, o, c));
    public void CloseMonth(int m, string o, LedgerMutationContext? c = null) => Write(nameof(CloseMonth), c, () => inner.CloseMonth(m, o, c));
    public IReadOnlyList<TrialBalanceRow> GetTrialBalance(DateOnly f, DateOnly t) => inner.GetTrialBalance(f, t);
    public IReadOnlyList<LedgerEntryRow> GetLedger(string c, DateOnly f, DateOnly t) => inner.GetLedger(c, f, t);
}
