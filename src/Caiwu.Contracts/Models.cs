namespace Caiwu.Contracts;

public enum AccountingRegime { SmallBusiness, Enterprise, Nonprofit }
public enum BalanceDirection { Debit, Credit }
public enum VoucherStatus { Draft, Reviewed, Posted }

public sealed record BookInfo(Guid Id, string Name, AccountingRegime Regime,
    string TemplateVersion, int FiscalYear, int StartMonth,
    int ClosedThroughMonth, DateTimeOffset CreatedAt);

public sealed record Account(string Code, string Name, string? ParentCode,
    BalanceDirection Direction, bool IsActive,
    decimal OpeningDebit, decimal OpeningCredit);

public sealed record VoucherLine(string AccountCode, string Summary, decimal Debit, decimal Credit);

public sealed record Voucher(Guid Id, DateOnly Date, string Kind, int Number,
    int AttachmentCount, string PreparedBy, string? ReviewedBy,
    VoucherStatus Status, IReadOnlyList<VoucherLine> Lines);

/// <summary>
/// New and existing drafts require both expected fields from the same snapshot used to
/// open the editor. Null defaults retain source compatibility, not permission to write.
/// </summary>
public sealed record VoucherDraft(Guid? Id, DateOnly Date, string Kind, int? Number,
    int AttachmentCount, IReadOnlyList<VoucherLine> Lines, long? ExpectedRevision = null,
    Guid? ExpectedBookId = null);

public sealed record OpeningBalance(string AccountCode, decimal Debit, decimal Credit);

public sealed record AuditEvent(Guid Id, DateTimeOffset At, string OperatorName,
    string Action, Guid? VoucherId, string Detail);

public sealed record LedgerSnapshot(long Revision, BookInfo Book, IReadOnlyList<Account> Accounts,
    IReadOnlyList<Voucher> Vouchers, IReadOnlyList<AuditEvent> AuditEvents);

public sealed record TrialBalanceRow(string AccountCode, string AccountName, bool IsLeaf,
    decimal OpeningDebit, decimal OpeningCredit, decimal PeriodDebit,
    decimal PeriodCredit, decimal ClosingDebit, decimal ClosingCredit);

/// <param name="RunningBalance">Debit-positive, credit-negative signed balance.</param>
public sealed record LedgerEntryRow(DateOnly? Date, Guid? VoucherId, string VoucherKind,
    int? VoucherNumber, string Summary, decimal Debit, decimal Credit,
    decimal RunningBalance);

public sealed record TemplateDefinition(string Id, string DisplayName, AccountingRegime Regime,
    string Version, bool IsVerifiedForProduction, IReadOnlyList<Account> Accounts);
