using System.Collections.Immutable;
using System.Globalization;
using System.Text.Json;

namespace Caiwu.Invoicing;

public enum InvoiceProduct { Qingsong, Chengben }
public enum InvoiceDirection { Output, Input }
public enum InvoiceKind { Special, Ordinary }
public enum VoucherGrouping { PerInvoice, Monthly }
public enum SalesCategory { Goods, Services }

public readonly record struct InvoiceMonth(int Year, int Month) : IComparable<InvoiceMonth>
{
    public DateOnly FirstDay => new(Year, Month, 1);
    public InvoiceMonth Next() => From(FirstDay.AddMonths(1));
    public static InvoiceMonth From(DateOnly date) => new(date.Year, date.Month);
    public int CompareTo(InvoiceMonth other) => FirstDay.CompareTo(other.FirstDay);
    public override string ToString() => $"{Year:0000}-{Month:00}";
}

/// <summary>Raw legacy column names, nulls and extension fields survive round trips.
/// lx, fpzt and sh_bz are deliberately not recoded from undocumented values.</summary>
public sealed record LegacyInvoiceRow(ImmutableDictionary<string, JsonElement> Fields)
{
    public static LegacyInvoiceRow Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.ValueKind != JsonValueKind.Object)
            throw new InvoiceException("row-shape", "发票行必须是字段对象。");
        var values = ImmutableDictionary.CreateBuilder<string, JsonElement>(StringComparer.Ordinal);
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in doc.RootElement.EnumerateObject())
        {
            if (!names.Add(p.Name)) throw new InvoiceException("duplicate-column", $"重复字段：{p.Name}");
            if (p.Value.ValueKind is JsonValueKind.Object or JsonValueKind.Array)
                throw new InvoiceException("column-shape", $"字段 {p.Name} 必须是标量或空值。");
            values.Add(p.Name, p.Value.Clone());
        }
        return new(values.ToImmutable());
    }

    public string? Text(string name) => !Fields.TryGetValue(name, out var value) || value.ValueKind == JsonValueKind.Null
        ? null : value.ValueKind == JsonValueKind.String ? value.GetString() : value.GetRawText();
    public decimal? Number(string name)
    {
        var text = Text(name);
        if (string.IsNullOrWhiteSpace(text)) return null;
        if (!decimal.TryParse(text, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint | NumberStyles.AllowExponent,
                CultureInfo.InvariantCulture, out var result))
            throw new InvoiceException("number", $"字段 {name} 不是可处理的十进制数。");
        return result;
    }
    public DateOnly? Date(string name)
    {
        var text = Text(name);
        if (string.IsNullOrWhiteSpace(text)) return null;
        if (!DateTime.TryParseExact(text, ["yyyy-MM-dd", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-ddTHH:mm:ss", "yyyy-MM-ddTHH:mm:ss.FFFFFFF"],
                CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
            throw new InvoiceException("date", $"字段 {name} 日期格式不正确。");
        return DateOnly.FromDateTime(date);
    }
    public LegacyInvoiceRow Set(string name, object? value) => new(Fields.SetItem(name, JsonSerializer.SerializeToElement(value)));
}

public sealed record InvoiceKey(InvoiceDirection Direction, InvoiceKind Kind, string Code, string Number);
public sealed record InvoiceDocument(Guid Id, long Version, InvoiceKey Key, ImmutableArray<LegacyInvoiceRow> Rows,
    string ContentDigest)
{
    public DateOnly IssueDate => Rows[0].Date("rq")!.Value;
    public DateOnly AccountingDate => Key.Direction == InvoiceDirection.Input ? Rows[0].Date("rq_2") ?? IssueDate : IssueDate;
    public string PartyName => Rows[0].Text("g_qymc") ?? "";
    public decimal Net => Rows.Sum(x => x.Number("je0") ?? 0);
    public decimal Tax => Rows.Sum(x => x.Number("se") ?? 0);
    public decimal Gross => Rows.Sum(x => x.Number("je1") ?? 0);
    public bool IsUnprocessed => Rows.All(x => (x.Text("pz_bz") ?? "0").Trim() == "0");
    public bool IsUnreviewed => Rows.All(x => (x.Text("sh_bz") ?? "0").Trim() == "0");
}

public sealed record InvoiceAccount(string Code, bool Active, bool IsLeaf);
public sealed record VoucherAccounts(string Receivable, string GoodsRevenue, string ServiceRevenue, string OutputTax,
    string Material, string InputTax, string Payable);
public sealed record PlanRequest(InvoiceDirection Direction, InvoiceMonth SourceMonth, InvoiceMonth VoucherMonth,
    int VoucherType, int FirstNumber, VoucherGrouping Grouping, SalesCategory SalesCategory,
    VoucherAccounts Accounts, ImmutableArray<Guid> SourceIds, ImmutableHashSet<string> EligibleInvoiceStatuses,
    bool SeparateInputTax);
public sealed record PlannedLine(string AccountCode, string Summary, decimal Debit, decimal Credit);
public sealed record PlannedVoucher(int Number, ImmutableArray<Guid> SourceIds, ImmutableArray<PlannedLine> Lines);
public sealed record InvoiceVoucherPlan(Guid BookId, InvoiceProduct Product, long WorkspaceRevision, PlanRequest Request,
    ImmutableArray<PlannedVoucher> Vouchers);
public sealed record InvoiceJournal(Guid Id, InvoiceMonth Period, int VoucherType, int Number, bool Reviewed, bool Posted,
    ImmutableArray<Guid> SourceIds, ImmutableArray<PlannedLine> Lines);
public sealed record InvoiceWorkspace(Guid BookId, InvoiceProduct Product, InvoiceMonth OpeningMonth, InvoiceMonth OpenMonth,
    long Revision, ImmutableArray<InvoiceDocument> Documents, ImmutableArray<InvoiceJournal> Journals,
    ImmutableArray<InvoiceAccount> Accounts)
{
    public static InvoiceWorkspace CreateSynthetic(Guid bookId, InvoiceProduct product, InvoiceMonth month,
        IEnumerable<InvoiceAccount> accounts) => new(bookId, product, month, month, 0, [], [], accounts.ToImmutableArray());
}

public sealed record InvoiceImport(InvoiceDirection Direction, InvoiceKind Kind, ImmutableArray<LegacyInvoiceRow> Rows);
public sealed record InvoiceEdit(Guid? Id, InvoiceImport Input);
public sealed record InvoiceRowSelection(Guid DocumentId, int RowIndex);
public sealed record SkippedInvoice(Guid DocumentId, string Reason);
public sealed record BatchDeleteResult(int DeletedInvoices, ImmutableArray<SkippedInvoice> Skipped, long Revision);
public sealed record InvoiceTransfer(int FormatVersion, Guid BookId, InvoiceProduct Product, ImmutableArray<InvoiceImport> Invoices);
public sealed record ImportResult(int Added, int Duplicates, long Revision);
public sealed record LedgerTaxLine(DateOnly Date, string AccountCode, decimal Debit, decimal Credit);
public sealed record VatComparison(string Period, decimal? OutputOnInvoice, decimal? InputOnInvoice,
    decimal? OutputInLedger, decimal? InputInLedger)
{
    public decimal? OutputDifference => OutputInLedger - OutputOnInvoice;
    public decimal? InputDifference => InputInLedger - InputOnInvoice;
    public bool? Matches => OutputDifference is null || InputDifference is null ? null
        : OutputDifference == 0 && InputDifference == 0;
}
public sealed class InvoiceException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
