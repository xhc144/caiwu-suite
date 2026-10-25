namespace Caiwu.Contracts;

/// <summary>
/// Account-book operations, mutation context contract v1.2. Every write requires the book/revision
/// from the same snapshot the user edited or confirmed. Missing/stale/foreign context must throw
/// StoreConcurrencyException without changing data. Posted vouchers have no reverse-post API.
/// </summary>
public interface ILedgerService
{
    LedgerSnapshot GetSnapshot();
    // null defaults allow old callers to compile so that they receive an explicit rejection;
    // they do not grant permission to read a fresh token or perform an unguarded write.
    void SaveAccount(Account account, string operatorName, LedgerMutationContext? context = null);
    void DeleteAccount(string code, string operatorName, LedgerMutationContext? context = null);
    void SetOpeningBalances(IReadOnlyList<OpeningBalance> balances, string operatorName, LedgerMutationContext? context = null);
    // New and existing drafts both require VoucherDraft.ExpectedBookId/ExpectedRevision.
    Voucher SaveDraft(VoucherDraft draft, string operatorName);
    void DeleteDraft(Guid id, string operatorName, LedgerMutationContext? context = null);
    void Review(Guid id, string reviewer, LedgerMutationContext? context = null);
    void CancelReview(Guid id, string operatorName, LedgerMutationContext? context = null);
    void Post(Guid id, string operatorName, LedgerMutationContext? context = null);
    void CloseMonth(int month, string operatorName, LedgerMutationContext? context = null);
    IReadOnlyList<TrialBalanceRow> GetTrialBalance(DateOnly from, DateOnly to);
    IReadOnlyList<LedgerEntryRow> GetLedger(string accountCode, DateOnly from, DateOnly to);
}
