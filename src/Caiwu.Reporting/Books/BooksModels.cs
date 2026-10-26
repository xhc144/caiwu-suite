using Caiwu.Contracts;

namespace Caiwu.Reporting.Books;

public enum BooksKind { GeneralLedger, CashJournal, BankJournal }
public enum JournalAccountKind { None, Cash, Bank }
public enum BooksRowKind { Opening, Entry, MonthTotal, YearToDate }

/// <summary>Opening is at Book.StartMonth. Pre-opening activity is required for a midyear book's true YTD.</summary>
public sealed record BooksAccount(string Code, string Name, string? ParentCode,
    decimal OpeningDebit, decimal OpeningCredit, JournalAccountKind JournalKind = JournalAccountKind.None,
    decimal? PreOpeningDebit = null, decimal? PreOpeningCredit = null);

/// <summary>Sequence is the original line order; signed debit/credit supports red-letter reversals.</summary>
public sealed record BooksLine(int Sequence, string AccountCode, string Summary, decimal Debit, decimal Credit,
    string SettlementType = "", string CheckNumber = "", string BillNumber = "", string SourceKey = "");

public sealed record BooksVoucher(Guid Id, DateOnly Date, string Kind, int Number, VoucherStatus Status,
    IReadOnlyList<BooksLine> Lines);

/// <summary>A complete, single-year base-currency projection, not an original-book migration format.</summary>
public sealed record BooksLedgerInput(BookInfo Book, long Revision, IReadOnlyList<BooksAccount> Accounts,
    IReadOnlyList<BooksVoucher> Vouchers, string BaseCurrencyName, string SourceDescription);

/// <summary>Inclusive account range, ordinal account-code order; parent aggregation follows ParentCode.</summary>
public sealed record BooksQuery(BooksKind Kind, string AccountFrom, string AccountTo,
    int FromMonth, int ToMonth, bool IncludeUnposted = false);

public sealed record BooksRow(BooksRowKind Kind, DateOnly? Date, Guid? VoucherId,
    string VoucherKind, int? VoucherNumber, int? LineSequence, string Summary,
    string AccountCode, string CounterAccounts, string SettlementType, string CheckNumber,
    string BillNumber, string SourceKey, VoucherStatus? Status, decimal Debit, decimal Credit, decimal Balance)
{
    public string Direction => Balance > 0 ? "借" : Balance < 0 ? "贷" : "平";
    public decimal BalanceAmount => Math.Abs(Balance);
    public string VoucherLabel => VoucherNumber.HasValue ? $"{VoucherKind}-{VoucherNumber}" : "";
}

public sealed record BooksAccountReport(BooksAccount Account, IReadOnlyList<BooksRow> Rows,
    decimal OpeningBalance, decimal PeriodDebit, decimal PeriodCredit, decimal ClosingBalance,
    decimal YearDebit, decimal YearCredit);

public sealed record BooksResult(BookInfo Book, long Revision, BooksQuery Query,
    string BaseCurrencyName, string SourceDescription, IReadOnlyList<BooksAccountReport> Accounts)
{
    public string Title => Query.Kind switch
    {
        BooksKind.GeneralLedger => "总分类账",
        BooksKind.CashJournal => "现金日记账",
        BooksKind.BankJournal => "银行日记账",
        _ => throw new ArgumentOutOfRangeException()
    };
}
