namespace Caiwu.Contracts;

/// <summary>Account-book operations. Posted vouchers have no reverse-post or mutation API.</summary>
public interface ILedgerService
{
    LedgerSnapshot GetSnapshot();
    void SaveAccount(Account account, string operatorName);
    void DeleteAccount(string code, string operatorName);
    void SetOpeningBalances(IReadOnlyList<OpeningBalance> balances, string operatorName);
    Voucher SaveDraft(VoucherDraft draft, string operatorName);
    void DeleteDraft(Guid id, string operatorName);
    void Review(Guid id, string reviewer);
    void CancelReview(Guid id, string operatorName);
    void Post(Guid id, string operatorName);
    void CloseMonth(int month, string operatorName);
    IReadOnlyList<TrialBalanceRow> GetTrialBalance(DateOnly from, DateOnly to);
    IReadOnlyList<LedgerEntryRow> GetLedger(string accountCode, DateOnly from, DateOnly to);
}
