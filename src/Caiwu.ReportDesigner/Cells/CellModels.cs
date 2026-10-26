using System.Globalization;
using System.Text.Json.Serialization;

namespace Caiwu.ReportDesigner.Cells;

public readonly record struct CellAddress(int Row, int Column)
{
    public static CellAddress Parse(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        var split = 0; var column = 0;
        while (split < text.Length && char.IsAsciiLetter(text[split]))
        {
            if (split == 3) throw new FormatException("单元格列超出范围。");
            column = checked(column * 26 + char.ToUpperInvariant(text[split++]) - 'A' + 1);
        }
        if (split == 0 || split == text.Length || text[split] == '0' ||
            !text[split..].All(char.IsAsciiDigit) || !int.TryParse(text[split..], NumberStyles.None, CultureInfo.InvariantCulture, out var row) ||
            row is < 1 or > 999 || column is < 1 or > 250) throw new FormatException("单元格地址须在 A1 至 IP999 内。");
        return new(row, column);
    }
    public override string ToString()
    {
        var n = Column; var column = "";
        while (n > 0) { n--; column = (char)('A' + n % 26) + column; n /= 26; }
        return column + Row.ToString(CultureInfo.InvariantCulture);
    }
}
public enum CellHorizontalAlignment { General, Left, Center, Right }
public enum CellVerticalAlignment { Top, Center, Bottom }
public sealed record CellFormat(
    CellHorizontalAlignment Horizontal = CellHorizontalAlignment.General,
    CellVerticalAlignment Vertical = CellVerticalAlignment.Center,
    bool Wrap = false, int DecimalPlaces = 2, bool Thousands = false);
public sealed record CellDefinition(string Address, string Content, CellFormat? Format = null);
public sealed record ReportRow(int Index, decimal HeightInches);
public sealed record ReportColumn(int Index, decimal WidthCharacters);
public sealed record CellReport
{
    [JsonRequired] public int SchemaVersion { get; init; } = 1;
    [JsonRequired] public Guid Id { get; init; } = Guid.NewGuid();
    [JsonRequired] public long Version { get; init; } = 1;
    [JsonRequired] public string Title { get; init; } = "报表";
    [JsonRequired] public int RowCount { get; init; } = 20;
    [JsonRequired] public int ColumnCount { get; init; } = 8;
    [JsonRequired] public decimal DefaultRowHeightInches { get; init; } = .25m;
    [JsonRequired] public decimal DefaultColumnWidthCharacters { get; init; } = 12;
    [JsonRequired] public IReadOnlyList<ReportRow> Rows { get; init; } = [];
    [JsonRequired] public IReadOnlyList<ReportColumn> Columns { get; init; } = [];
    [JsonRequired] public IReadOnlyList<CellDefinition> Cells { get; init; } = [];
}
public sealed record CellIssue(string Address, string Code, string Message, int? Position = null);
public sealed class CellReportException(IReadOnlyList<CellIssue> issues) : Exception(string.Join("\n", issues.Select(i => $"{i.Address} [{i.Code}] {i.Message}")))
{ public IReadOnlyList<CellIssue> Issues { get; } = issues; }
public sealed record CalculatedCell(string Address, string Text, decimal? Number, string Content, CellFormat Format);
public sealed record ReportQueryContext(Guid BookId, DateOnly From, DateOnly To, long ExpectedRevision);
public sealed record ReportSourceStamp(Guid BookId, DateOnly From, DateOnly To, long Revision,
    string Currency, bool IsSynthetic, int UnpostedVoucherCount, string Description);
public enum ReportMeasure { Opening, Closing, Debit, Credit, YearToDateDebit, YearToDateCredit }
public sealed record ReportDataRequest(ReportMeasure Measure, string AccountCode, bool IncludeDescendants);
/// <summary>Capture once per generation; implementations must return a stable, complete, read-only snapshot.</summary>
public interface IReportDataSource { IReportDataSnapshot Capture(ReportQueryContext context); }
public interface IReportDataSnapshot
{
    ReportSourceStamp Stamp { get; }
    decimal Read(ReportDataRequest request);
}
public sealed class ReportDataException(string message) : Exception(message);
public sealed class CellReportResult
{
    public CellReport Report { get; }
    public ReportSourceStamp Source { get; }
    public IReadOnlyDictionary<string, CalculatedCell> Cells { get; }
    internal CellReportResult(CellReport report, ReportSourceStamp source, IDictionary<string, CalculatedCell> cells)
    {
        Report = report; Source = source;
        Cells = new System.Collections.ObjectModel.ReadOnlyDictionary<string, CalculatedCell>(cells);
    }
    public CalculatedCell this[string address] => Cells[CellAddress.Parse(address).ToString()];
}

public static class CellReportRules
{
    public static CellReport Freeze(CellReport report)
    {
        ArgumentNullException.ThrowIfNull(report);
        void Fail(string message) => throw new CellReportException([new("", "LAYOUT", message)]);
        if (report.SchemaVersion != 1 || report.Id == Guid.Empty || report.Version < 1) Fail("无效设计版本或标识。");
        if (string.IsNullOrWhiteSpace(report.Title) || report.Title.Length > 120 || report.Title.Any(char.IsControl)) Fail("报表名称须为1–120个可显示字符。");
        if (report.RowCount is < 1 or > 999 || report.ColumnCount is < 1 or > 250) Fail("最大行数999，最大列数250，且均不能为零。");
        if (report.DefaultRowHeightInches is < .05m or > 10 || report.DefaultColumnWidthCharacters is < 1 or > 255) Fail("行高或列宽超出范围。");
        if (report.Rows is null || report.Columns is null || report.Cells is null || report.Cells.Count > 10000) Fail("格式集合不能为空，非空单元格上限10000。");
        var rows = report.Rows!.ToArray(); var columns = report.Columns!.ToArray(); var cells = report.Cells!.ToArray();
        if (rows.Length > report.RowCount || rows.Any(r => r is null || r.Index < 1 || r.Index > report.RowCount || r.HeightInches is < .05m or > 10) || rows.Select(r => r.Index).Distinct().Count() != rows.Length) Fail("行格式索引、大小或唯一性无效。");
        if (columns.Length > report.ColumnCount || columns.Any(c => c is null || c.Index < 1 || c.Index > report.ColumnCount || c.WidthCharacters is < 1 or > 255) || columns.Select(c => c.Index).Distinct().Count() != columns.Length) Fail("列格式索引、大小或唯一性无效。");
        var used = new HashSet<CellAddress>();
        var normalized = new List<CellDefinition>();
        foreach (var cell in cells)
        {
            if (cell is null || cell.Content is null || cell.Content.Length > 2048 || cell.Content.Any(c => char.IsControl(c) && c is not ('\n' or '\r' or '\t'))) Fail("单元格内容无效或过长。");
            CellAddress address;
            try { address = CellAddress.Parse(cell!.Address); }
            catch (Exception ex) when (ex is FormatException or ArgumentException or OverflowException) { Fail("无效单元格地址。"); throw; }
            if (address.Row > report.RowCount || address.Column > report.ColumnCount || !used.Add(address)) Fail("单元格越界或重复。");
            var format = cell.Format ?? new();
            if (!Enum.IsDefined(format.Horizontal) || !Enum.IsDefined(format.Vertical) || format.DecimalPlaces is < 0 or > 6) Fail("单元格格式无效。");
            normalized.Add(cell with { Address = address.ToString(), Format = format });
        }
        return report with { Rows = Array.AsReadOnly(rows), Columns = Array.AsReadOnly(columns), Cells = normalized.AsReadOnly() };
    }
}
