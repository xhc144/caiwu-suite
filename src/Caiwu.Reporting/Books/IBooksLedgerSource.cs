namespace Caiwu.Reporting.Books;

/// <summary>The integrating reader owns storage and book isolation. ReadYear must return that actual year.</summary>
public interface IBooksLedgerSource
{
    IReadOnlyList<int> AvailableYears { get; }
    BooksLedgerInput ReadYear(int year);
}

public sealed class SingleYearBooksSource(BooksLedgerInput input) : IBooksLedgerSource
{
    public IReadOnlyList<int> AvailableYears { get; } = Array.AsReadOnly(new[] { input.Book.FiscalYear });
    public BooksLedgerInput ReadYear(int year) => year == input.Book.FiscalYear ? input :
        throw new ArgumentOutOfRangeException(nameof(year), "该数据源未提供所选年度账簿。");
}

public sealed record BooksVoucherReference(Guid BookId, long Revision, int FiscalYear, Guid VoucherId);
