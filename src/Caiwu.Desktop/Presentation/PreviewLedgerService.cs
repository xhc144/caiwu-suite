using Caiwu.Contracts;

namespace Caiwu.Desktop.Presentation;

/// <summary>The current desktop has no complete nonprofit restriction model; keep such books read-only.</summary>
public sealed class PreviewLedgerService(ILedgerService inner) : ILedgerService
{
    public static bool AllowsWrites(BookInfo book) => book.Regime != AccountingRegime.Nonprofit;
    public static void DemandWritable(BookInfo book)
    {
        if (!AllowsWrites(book)) throw new LedgerValidationException("民非专有核算尚未完备，当前仅允许只读核对实验账套，不能新增或改写账务。");
    }
    private void Write(Action action) { DemandWritable(inner.GetSnapshot().Book); action(); }
    public LedgerSnapshot GetSnapshot() => inner.GetSnapshot();
    public void SaveAccount(Account account, string operatorName) => Write(() => inner.SaveAccount(account, operatorName));
    public void DeleteAccount(string code, string operatorName) => Write(() => inner.DeleteAccount(code, operatorName));
    public void SetOpeningBalances(IReadOnlyList<OpeningBalance> balances, string operatorName) => Write(() => inner.SetOpeningBalances(balances, operatorName));
    public Voucher SaveDraft(VoucherDraft draft, string operatorName)
    { DemandWritable(inner.GetSnapshot().Book); return inner.SaveDraft(draft, operatorName); }
    public void DeleteDraft(Guid id, string operatorName) => Write(() => inner.DeleteDraft(id, operatorName));
    public void Review(Guid id, string reviewer) => Write(() => inner.Review(id, reviewer));
    public void CancelReview(Guid id, string operatorName) => Write(() => inner.CancelReview(id, operatorName));
    public void Post(Guid id, string operatorName) => Write(() => inner.Post(id, operatorName));
    public void CloseMonth(int month, string operatorName) => Write(() => inner.CloseMonth(month, operatorName));
    public IReadOnlyList<TrialBalanceRow> GetTrialBalance(DateOnly from, DateOnly to) => inner.GetTrialBalance(from, to);
    public IReadOnlyList<LedgerEntryRow> GetLedger(string accountCode, DateOnly from, DateOnly to) => inner.GetLedger(accountCode, from, to);
}
