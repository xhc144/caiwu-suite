using Caiwu.Contracts;

namespace Caiwu.Desktop.Presentation;

/// <summary>The current desktop has no complete nonprofit restriction model; keep such books read-only.</summary>
public sealed partial class PreviewLedgerService : ILedgerService
#if CAIWU_PARITY_MODULES
    , IParityLedgerService
#endif
{
    private readonly ILedgerService inner;
    public PreviewLedgerService(ILedgerService inner) => this.inner = inner ?? throw new ArgumentNullException(nameof(inner));
    public static bool AllowsWrites(BookInfo book) => book.Regime != AccountingRegime.Nonprofit;
    public static void DemandWritable(BookInfo book)
    {
        if (!AllowsWrites(book)) throw new LedgerValidationException("民非专有核算尚未完备，当前仅允许只读核对实验账套，不能新增或改写账务。");
    }
    private void Write(Action action) { DemandWritable(inner.GetSnapshot().Book); action(); }
    public LedgerSnapshot GetSnapshot() => inner.GetSnapshot();
    public void SaveAccount(Account account, string operatorName, LedgerMutationContext? context = null) => Write(() => inner.SaveAccount(account, operatorName, context));
    public void DeleteAccount(string code, string operatorName, LedgerMutationContext? context = null) => Write(() => inner.DeleteAccount(code, operatorName, context));
    public void SetOpeningBalances(IReadOnlyList<OpeningBalance> balances, string operatorName, LedgerMutationContext? context = null) => Write(() => inner.SetOpeningBalances(balances, operatorName, context));
    public Voucher SaveDraft(VoucherDraft draft, string operatorName)
    { DemandWritable(inner.GetSnapshot().Book); return inner.SaveDraft(draft, operatorName); }
    public void DeleteDraft(Guid id, string operatorName, LedgerMutationContext? context = null) => Write(() => inner.DeleteDraft(id, operatorName, context));
    public void Review(Guid id, string reviewer, LedgerMutationContext? context = null) => Write(() => inner.Review(id, reviewer, context));
    public void CancelReview(Guid id, string operatorName, LedgerMutationContext? context = null) => Write(() => inner.CancelReview(id, operatorName, context));
    public void Post(Guid id, string operatorName, LedgerMutationContext? context = null) => Write(() => inner.Post(id, operatorName, context));
    public void CloseMonth(int month, string operatorName, LedgerMutationContext? context = null) => Write(() => inner.CloseMonth(month, operatorName, context));
    public IReadOnlyList<TrialBalanceRow> GetTrialBalance(DateOnly from, DateOnly to) => inner.GetTrialBalance(from, to);
    public IReadOnlyList<LedgerEntryRow> GetLedger(string accountCode, DateOnly from, DateOnly to) => inner.GetLedger(accountCode, from, to);
}
