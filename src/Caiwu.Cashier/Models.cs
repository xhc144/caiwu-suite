namespace Caiwu.Cashier;

/// <summary>Account and currency form the original cashier ledger identity.</summary>
public sealed record AccountKey(string Code, string Currency);
public sealed record AccountDefinition(string Code, string Name, bool IsDetail, bool HasCashFlow,
    string[] Currencies);
public sealed record BookDefinition(string Id, DateOnly OpeningDate, DateOnly ActiveMonth,
    DateOnly LatestDocumentDate, string BaseCurrency, AccountDefinition[] Accounts);

/// <summary>Optional original fields retain declaration, NULL and raw value. This is not a file importer.</summary>
public sealed record OriginalValue(string Declaration, string? RawValue);
public sealed record OpeningBalance(AccountKey Account, int Year, decimal Balance);
public enum DocumentDirection { Receipt, Payment }
public enum DocumentOrigin { Cashier, GeneralLedger, External }
public sealed record DocumentInput(AccountKey Account, DateOnly Date, string Summary,
    DocumentDirection Direction, decimal Amount, string? CounterAccount, string EnteredBy,
    string? Notes = null, string? CounterpartyName = null, string? CounterpartyBank = null,
    string? CounterpartyBankAccount = null);

public sealed record CashierDocument(Guid Id, long Number, AccountKey Account, DateOnly Date,
    string Summary, decimal Debit, decimal Credit, string? CounterAccount, string EnteredBy,
    string? Notes, string? CounterpartyName, string? CounterpartyBank, string? CounterpartyBankAccount,
    DocumentOrigin Origin, string? GeneratedVoucherId, long? ReconciliationCode,
    Dictionary<string, OriginalValue>? OriginalFields = null)
{
    public decimal Net => Debit - Credit;
}

/// <summary>Versioned ledger-side snapshot, not an authoritative write to the general ledger.</summary>
public sealed record LedgerEntry(string Id, string Revision, AccountKey Account, DateOnly Date,
    string VoucherId, string Summary, decimal Debit, decimal Credit, bool IsPosted,
    long? ReconciliationCode = null, Dictionary<string, OriginalValue>? OriginalFields = null)
{
    public decimal Net => Debit - Credit;
}

public sealed record ReconciliationGroup(long Code, AccountKey Account, Guid[] DocumentIds,
    string[] LedgerEntryIds, DateTimeOffset CreatedAt, string Operator);
public sealed record AuditEntry(long Sequence, string Action, string Operator, DateTimeOffset At, string Target);

/// <summary>Module-owned state. Stores must return detached copies and commit the transform atomically.</summary>
public sealed record CashierSnapshot(long Revision, BookDefinition Book, long NextDocumentNumber,
    long NextReconciliationCode, OpeningBalance[] Openings, CashierDocument[] Documents,
    LedgerEntry[] LedgerEntries, ReconciliationGroup[] Reconciliations, AuditEntry[] Audit)
{
    public static CashierSnapshot Empty(BookDefinition book) => new(0, book, 1, 1, [], [], [], [], []);
}

public enum JournalRowKind { Opening, Document, DailySubtotal }
public sealed record JournalRow(JournalRowKind Kind, DateOnly Date, long? Number, Guid? DocumentId,
    string Summary, decimal Debit, decimal Credit, decimal Balance, CashierDocument? Document = null);
public sealed record Journal(long SourceRevision, AccountKey Account, DateOnly From, DateOnly Through, decimal Opening,
    decimal TotalDebit, decimal TotalCredit, decimal Closing, JournalRow[] Rows);
public sealed record ReconciliationQuery(AccountKey Account, int Year, int Month,
    bool IncludeMatched = false, bool IncludeEarlierUnmatched = false);
public sealed record ReconciliationView(long SourceRevision, CashierDocument[] Documents, LedgerEntry[] LedgerEntries);
public enum VoucherGrouping { PerDocument, Monthly }
public sealed record VoucherPlanLine(string AccountCode, decimal Debit, decimal Credit, string Currency,
    decimal ForeignDebit, decimal ForeignCredit, decimal Rate, string Summary, Guid SourceDocumentId);
public sealed record VoucherPlanItem(string PlanKey, DateOnly Date, Guid[] SourceDocuments, VoucherPlanLine[] Lines);
public sealed record VoucherPlan(long SourceRevision, string BookId, VoucherGrouping Grouping,
    VoucherPlanItem[] Vouchers);

public sealed class CashierRuleException(string code, string message) : InvalidOperationException(message)
{
    public string Code { get; } = code;
}
public sealed class CashierConcurrencyException : InvalidOperationException
{
    public CashierConcurrencyException(long expected, long actual)
        : base($"数据已由其他窗口更新，本次输入未提交。请保留输入并显式重载数据后再决定是否保存（预期版本 {expected}，当前 {actual}）。")
    { Expected = expected; Actual = actual; }

    /// <summary>The public CAS error does not disclose its winning revision. Do not read a new token to invent one.</summary>
    public CashierConcurrencyException(long expected, Exception innerException)
        : base($"保存时账套已由其他窗口更新，本次输入未提交。请保留输入并显式重载数据后再决定是否保存（预期版本 {expected}）。", innerException)
    { Expected = expected; }

    public long Expected { get; }
    public long? Actual { get; }
}
