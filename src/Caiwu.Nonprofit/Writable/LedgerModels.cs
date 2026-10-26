namespace Caiwu.Nonprofit.Writable;

public enum NonprofitAccountKind { Asset, Liability, NetAsset, Income, Expense, PriorAdjustment }
public enum NonprofitVoucherState { Draft, Reviewed, Posted }
public enum NonprofitMovementRole { Activity, IncomeExpenseClosing, Release, Designation, PriorAdjustment }
public enum NonprofitPermission { Initialize, MaintainAccounts, MaintainOpening, EditVoucher, Review, Post, ReversePost, Close, Reopen }

/// <summary>The host resolves stable operator identity and checks its existing permissions. No permissive default.</summary>
public interface INonprofitAuthorizer
{
    void Require(string operatorId, NonprofitPermission permission);
}

/// <summary>Original value and declaration are retained independently of normalized calculations.
/// This is preservation, not proof that an original schema variant has been imported.</summary>
public sealed record OriginalField(string Table, string Column, string Declaration, string? RawValue);
public sealed record AccountDimensions(bool ForeignCurrency = false, bool Quantity = false,
    bool Project = false, bool Counterparty = false, bool Department = false, bool Person = false,
    bool CashFlow = false, bool Bank = false, bool Settlement = false);
public sealed record LineDimensions(string? Currency = null, decimal? ForeignAmount = null,
    decimal? ExchangeRate = null, decimal? Quantity = null, decimal? UnitPrice = null,
    string? Unit = null, string? Project = null, string? Counterparty = null,
    string? Department = null, string? Person = null, string? CashFlow = null,
    string? SettlementType = null, string? BillNumber = null, string? Contract = null,
    DateOnly? DueDate = null);
public sealed record NonprofitLedgerAccount(string Code, string Name, string? ParentCode,
    string OfficialRoot, NonprofitAccountKind Kind, bool CreditNormal, bool Active,
    AccountDimensions Dimensions, IReadOnlyList<OriginalField> OriginalFields);
public sealed record NonprofitOpening(Guid Id, string AccountCode, decimal Debit, decimal Credit,
    Classification? Classification, LineDimensions Dimensions, IReadOnlyList<OriginalField> OriginalFields);
public sealed record NonprofitLedgerLine(Guid Id, string AccountCode, string Summary,
    decimal Debit, decimal Credit, Classification? Classification, string? ComponentId,
    LineDimensions Dimensions, IReadOnlyList<OriginalField> OriginalFields);
public sealed record NonprofitLedgerVoucher(Guid Id, DateOnly Date, string Kind, int Number,
    int AttachmentCount, string PreparedBy, string? ReviewedBy, string? PostedBy,
    DateTimeOffset PreparedAt, DateTimeOffset? ReviewedAt, DateTimeOffset? PostedAt,
    NonprofitVoucherState State, NonprofitMovementRole Role, string EvidenceReference,
    Guid? SourceProposalId, IReadOnlyList<NonprofitLedgerLine> Lines, IReadOnlyList<OriginalField> OriginalFields);
public sealed record NonprofitVoucherDraft(Guid? Id, DateOnly Date, string Kind, int? Number,
    int AttachmentCount, NonprofitMovementRole Role, string EvidenceReference,
    IReadOnlyList<NonprofitLedgerLine> Lines, IReadOnlyList<OriginalField> OriginalFields,
    Guid? SourceProposalId = null);
public sealed record NonprofitAudit(Guid Id, DateTimeOffset At, string OperatorId,
    string Action, Guid? VoucherId, string Detail);
public sealed record NonprofitLedgerSnapshot(int SchemaVersion, Guid BookId, string BookCode,
    string BookName, string OriginalTemplateId, string ChartEvidenceReference,
    int FiscalYear, int StartMonth, int ClosedThroughMonth, long Revision,
    bool OpeningConfirmed, bool HasEverPosted,
    IReadOnlyList<NonprofitLedgerAccount> Accounts, IReadOnlyList<NonprofitOpening> Opening,
    IReadOnlyList<RestrictionEvidence> Restrictions, IReadOnlyList<NonprofitLedgerVoucher> Vouchers,
    IReadOnlyList<NonprofitAudit> Audit, IReadOnlyList<OriginalField> OriginalFields);
public sealed record NonprofitMutationContext(Guid BookId, long Revision);
public sealed record NonprofitBookDefinition(Guid BookId, string BookCode, string Name,
    string OriginalTemplateId, string ChartEvidenceReference, int FiscalYear, int StartMonth,
    IReadOnlyList<NonprofitLedgerAccount> Accounts, IReadOnlyList<RestrictionEvidence> Restrictions,
    IReadOnlyList<OriginalField> OriginalFields);
public sealed record NonprofitPostResult(IReadOnlyList<Guid> Posted, IReadOnlyList<Guid> SkippedUnreviewed);
public sealed record NonprofitAccountBalance(string AccountCode, Classification? Classification, decimal NetDebit);

/// <summary>Implement within the host's SAME book transaction/revision as accounts, vouchers, classification,
/// dimensions, original values and audit. Never split this into a ledger write plus a sidecar write.</summary>
public interface INonprofitLedgerStore
{
    NonprofitLedgerSnapshot Read();
    void Initialize(NonprofitLedgerSnapshot snapshot);
    void Commit(NonprofitMutationContext expected, NonprofitLedgerSnapshot next);
}

public sealed class NonprofitConcurrencyException(string message) : InvalidOperationException(message);
