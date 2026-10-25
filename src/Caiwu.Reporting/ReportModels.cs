using System.Globalization;
using Caiwu.Contracts;

namespace Caiwu.Reporting;

public enum ReportKind { VoucherList, TrialBalance, Ledger }
public enum ReportValueKind { Text, Amount }

/// <summary>An explicit citation supplied by the integrating caller; no rules are inferred from it.</summary>
public sealed class ReportSource
{
    public string Title { get; }
    public string Address { get; }

    public ReportSource(string title, string address)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(title);
        ArgumentException.ThrowIfNullOrWhiteSpace(address);
        if (!Uri.TryCreate(address, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp) ||
            !string.IsNullOrEmpty(uri.UserInfo) || address.Any(char.IsControl))
            throw new ArgumentException("来源链接须为不含凭据的绝对 HTTP(S) 地址。", nameof(address));
        Title = title;
        Address = address;
    }
}

/// <summary>Immutable provenance. The caller supplies the clock and the actual account-book template version.</summary>
public sealed class ReportMetadata
{
    public BookInfo Book { get; }
    public DateOnly From { get; }
    public DateOnly To { get; }
    public DateTimeOffset GeneratedAt { get; }
    public IReadOnlyList<ReportSource> Sources { get; }
    public string RegimeName => Book.Regime switch
    {
        AccountingRegime.SmallBusiness => "小企业",
        AccountingRegime.Enterprise => "企业",
        AccountingRegime.Nonprofit => "民间非营利组织",
        _ => throw new InvalidOperationException("未知会计制度。")
    };

    public ReportMetadata(BookInfo book, DateOnly from, DateOnly to,
        DateTimeOffset generatedAt, IEnumerable<ReportSource>? sources = null)
    {
        ArgumentNullException.ThrowIfNull(book);
        ArgumentException.ThrowIfNullOrWhiteSpace(book.Name);
        ArgumentException.ThrowIfNullOrWhiteSpace(book.TemplateVersion);
        if (!Enum.IsDefined(book.Regime) || book.FiscalYear is < 1 or > 9999 ||
            book.StartMonth is < 1 or > 12)
            throw new ArgumentException("账套制度、年度或启用月无效。", nameof(book));
        if (from > to || from.Year != book.FiscalYear || to.Year != book.FiscalYear ||
            from.Month < book.StartMonth)
            throw new ArgumentException("报表期间须在账套启用月起的同一会计年度内。", nameof(from));
        if (generatedAt == default)
            throw new ArgumentException("须提供实际生成时间。", nameof(generatedAt));
        var sourceCopy = (sources ?? []).ToArray();
        if (sourceCopy.Any(s => s is null))
            throw new ArgumentException("来源不能包含空项。", nameof(sources));
        Book = book;
        From = from;
        To = to;
        GeneratedAt = generatedAt;
        Sources = Array.AsReadOnly(sourceCopy);
    }
}

public sealed record ReportColumn(string Key, string Title, ReportValueKind Kind);

/// <summary>Text and decimal amounts stay distinct, including in CSV. Sub-cent amounts are rejected, never rounded.</summary>
public sealed class ReportCell
{
    public ReportValueKind Kind { get; }
    public string DisplayText { get; }
    public decimal? Amount { get; }

    private ReportCell(string text, decimal? amount)
    {
        DisplayText = text;
        Amount = amount;
        Kind = amount.HasValue ? ReportValueKind.Amount : ReportValueKind.Text;
    }

    internal static ReportCell Text(string? text) => new(text ?? "", null);
    internal static ReportCell Money(decimal amount)
    {
        if (decimal.Round(amount, 2) != amount)
            throw new ArgumentException("报表金额不能含分以下精度。", nameof(amount));
        return new(amount.ToString("F2", CultureInfo.InvariantCulture), amount);
    }
}

/// <summary>VoucherId is a drill-through key, not an executable URL. AccountDepth follows ParentCode, never code prefixes.</summary>
public sealed class ReportRow
{
    public IReadOnlyList<ReportCell> Cells { get; }
    public Guid? VoucherId { get; }
    public string? AccountCode { get; }
    public int AccountDepth { get; }
    public bool? IsLeaf { get; }

    internal ReportRow(IEnumerable<ReportCell> cells, Guid? voucherId = null,
        string? accountCode = null, int accountDepth = 0, bool? isLeaf = null)
    {
        Cells = Array.AsReadOnly(cells.ToArray());
        VoucherId = voucherId;
        AccountCode = accountCode;
        AccountDepth = accountDepth;
        IsLeaf = isLeaf;
    }
}

/// <summary>A presentation snapshot. Rows exclude Total; no statutory financial statement mapping is performed.</summary>
public sealed class ReportDocument
{
    public ReportKind Kind { get; }
    public string Title { get; }
    public ReportMetadata Metadata { get; }
    public IReadOnlyList<ReportColumn> Columns { get; }
    public IReadOnlyList<ReportRow> Rows { get; }
    public ReportRow Total { get; }
    public string Note { get; }

    internal ReportDocument(ReportKind kind, string title, ReportMetadata metadata,
        IEnumerable<ReportColumn> columns, IEnumerable<ReportRow> rows, ReportRow total, string note)
    {
        Kind = kind;
        Title = title;
        Metadata = metadata;
        Columns = Array.AsReadOnly(columns.ToArray());
        Rows = Array.AsReadOnly(rows.ToArray());
        Total = total;
        Note = note;
    }
}

/// <summary>RowsPerPage bounds logical pages; a very tall row may occupy additional physical print sheets.</summary>
public sealed class HtmlExportOptions
{
    public int RowsPerPage { get; }
    public bool Landscape { get; }

    public HtmlExportOptions(int rowsPerPage = 12, bool landscape = true)
    {
        if (rowsPerPage is < 1 or > 1000)
            throw new ArgumentOutOfRangeException(nameof(rowsPerPage), "每页行数须在 1 至 1000 之间。");
        RowsPerPage = rowsPerPage;
        Landscape = landscape;
    }
}
