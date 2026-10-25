using System.Globalization;
using System.Net;
using System.Text;

namespace Caiwu.Reporting;

/// <summary>Local, dependency-free exports. TextWriter overloads never close the caller's writer.</summary>
public static class ReportExporter
{
    /// <summary>RFC 4180 quoting, CRLF records, invariant decimal amounts, guarded text including metadata and citations.</summary>
    public static void WriteCsv(ReportDocument report, TextWriter writer)
    {
        ArgumentNullException.ThrowIfNull(report);
        ArgumentNullException.ThrowIfNull(writer);
        WriteCsvPair(writer, report.Columns.Count, "报表", report.Title);
        foreach (var pair in Metadata(report.Metadata))
            WriteCsvPair(writer, report.Columns.Count, pair.Key, pair.Value);
        WriteCsvPair(writer, report.Columns.Count, "说明", report.Note);
        WriteCsvRecord(writer, report.Columns.Select(c => CsvText(c.Title)));
        foreach (var row in report.Rows) WriteCsvRow(writer, row);
        WriteCsvRow(writer, report.Total);
        foreach (var source in report.Metadata.Sources)
            WriteCsvPair(writer, report.Columns.Count, $"来源：{source.Title}", source.Address);
    }

    /// <summary>UTF-8 BOM supports Chinese spreadsheet imports. The stream stays open by default.</summary>
    public static void WriteCsv(ReportDocument report, Stream stream, bool leaveOpen = true)
    {
        ArgumentNullException.ThrowIfNull(report);
        ArgumentNullException.ThrowIfNull(stream);
        using var writer = new StreamWriter(stream, new UTF8Encoding(true, true), 4096, leaveOpen);
        WriteCsv(report, writer);
    }

    public static string ToCsv(ReportDocument report)
    {
        using var writer = new StringWriter(CultureInfo.InvariantCulture);
        WriteCsv(report, writer);
        return writer.ToString();
    }

    /// <summary>No scripts, remote assets or automatic navigation. Explicit HTTP(S) source links remain clickable and printable.</summary>
    public static void WriteHtml(ReportDocument report, TextWriter writer, HtmlExportOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(report);
        ArgumentNullException.ThrowIfNull(writer);
        options ??= new HtmlExportOptions();
        writer.Write("<!doctype html>\n<html lang=\"zh-CN\"><head><meta charset=\"utf-8\">");
        writer.Write("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">");
        writer.Write("<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">");
        writer.Write("<meta name=\"referrer\" content=\"no-referrer\"><title>");
        writer.Write(H(report.Title));
        writer.Write("</title><style>@page{size:A4 ");
        writer.Write(options.Landscape ? "landscape" : "portrait");
        writer.Write(";margin:12mm}*{box-sizing:border-box}body{margin:0;color:#111;background:white;font-family:'Microsoft YaHei','Noto Sans CJK SC','PingFang SC',sans-serif;font-size:10pt}");
        writer.Write(".page{padding:12mm;break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}h1{font-size:17pt;margin:0 0 6mm;overflow-wrap:anywhere}");
        writer.Write(".metadata{display:flex;flex-wrap:wrap;gap:2mm 6mm;margin-bottom:3mm}.metadata span,.note,.sources{white-space:pre-wrap;overflow-wrap:anywhere}.note,.page-number{font-size:9pt;margin:3mm 0}");
        writer.Write("table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #666;padding:1.5mm;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#eee}");
        writer.Write(".amount{text-align:right;font-variant-numeric:tabular-nums;white-space:normal;overflow-wrap:anywhere}.total{font-weight:bold}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}.sources{font-size:9pt;margin-top:4mm}a{color:#111}");
        writer.Write("@media screen{body{background:#ddd}.page{background:white;max-width:340mm;margin:6mm auto;box-shadow:0 1px 5px #888;overflow:auto}}@media print{.page{padding:0}th{print-color-adjust:exact}}</style></head><body>\n");

        // Total is a real row, counted in pagination so a full last data page cannot overflow just for the total.
        var rowCount = (long)report.Rows.Count + 1;
        var pages = (rowCount + options.RowsPerPage - 1) / options.RowsPerPage;
        for (long page = 0; page < pages; page++)
        {
            writer.Write("<section class=\"page\"><header><h1>");
            writer.Write(H(report.Title));
            writer.Write("</h1><div class=\"metadata\">");
            foreach (var pair in Metadata(report.Metadata))
            {
                writer.Write("<span>"); writer.Write(H(pair.Key)); writer.Write("：");
                writer.Write(H(pair.Value)); writer.Write("</span>");
            }
            writer.Write("</div><p class=\"note\">"); writer.Write(H(report.Note));
            writer.Write("</p></header><table><thead><tr>");
            foreach (var column in report.Columns)
            {
                writer.Write("<th scope=\"col\">"); writer.Write(H(column.Title)); writer.Write("</th>");
            }
            writer.Write("</tr></thead><tbody>\n");
            var start = page * options.RowsPerPage;
            var end = Math.Min(start + options.RowsPerPage, rowCount);
            for (var index = start; index < end; index++)
                WriteHtmlRow(writer, index < report.Rows.Count ? report.Rows[(int)index] : report.Total,
                    index == report.Rows.Count);
            writer.Write("</tbody></table><footer><p class=\"page-number\">第 ");
            writer.Write(I(page + 1)); writer.Write(" / "); writer.Write(I(pages));
            writer.Write(" 页；数据行数："); writer.Write(I(report.Rows.Count)); writer.Write("</p>");
            if (page == pages - 1 && report.Metadata.Sources.Count > 0)
            {
                writer.Write("<div class=\"sources\">来源：<ul>");
                foreach (var source in report.Metadata.Sources)
                {
                    writer.Write("<li>"); writer.Write(H(source.Title)); writer.Write("：<a rel=\"noreferrer noopener\" href=\"");
                    writer.Write(H(source.Address)); writer.Write("\">"); writer.Write(H(source.Address));
                    writer.Write("</a></li>");
                }
                writer.Write("</ul></div>");
            }
            writer.Write("</footer></section>\n");
        }
        writer.Write("</body></html>\n");
    }

    /// <summary>UTF-8, without a BOM. The stream stays open by default.</summary>
    public static void WriteHtml(ReportDocument report, Stream stream, HtmlExportOptions? options = null, bool leaveOpen = true)
    {
        ArgumentNullException.ThrowIfNull(report);
        ArgumentNullException.ThrowIfNull(stream);
        using var writer = new StreamWriter(stream, new UTF8Encoding(false, true), 4096, leaveOpen);
        WriteHtml(report, writer, options);
    }

    public static string ToHtml(ReportDocument report, HtmlExportOptions? options = null)
    {
        using var writer = new StringWriter(CultureInfo.InvariantCulture);
        WriteHtml(report, writer, options);
        return writer.ToString();
    }

    private static IEnumerable<KeyValuePair<string, string>> Metadata(ReportMetadata metadata)
    {
        yield return new("账套", metadata.Book.Name);
        yield return new("账套 ID", metadata.Book.Id.ToString("D"));
        yield return new("制度", metadata.RegimeName);
        yield return new("制度版本", metadata.Book.TemplateVersion);
        yield return new("期间", metadata.From.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) +
            " 至 " + metadata.To.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        yield return new("生成时间", metadata.GeneratedAt.ToString("O", CultureInfo.InvariantCulture));
        yield return new("币种 / 单位", "人民币（CNY）/ 元");
    }

    private static void WriteCsvPair(TextWriter writer, int width, string key, string value) =>
        WriteCsvRecord(writer, new[] { CsvText(key), CsvText(value) }.Concat(Enumerable.Repeat("\"\"", width - 2)));

    private static void WriteCsvRow(TextWriter writer, ReportRow row) =>
        WriteCsvRecord(writer, row.Cells.Select(c => c.Kind == ReportValueKind.Amount ? c.DisplayText : CsvText(c.DisplayText)));

    private static void WriteCsvRecord(TextWriter writer, IEnumerable<string> cells)
    {
        var first = true;
        foreach (var cell in cells)
        {
            if (!first) writer.Write(',');
            writer.Write(cell);
            first = false;
        }
        writer.Write("\r\n");
    }

    private static string CsvText(string value)
    {
        // Check after leading whitespace/format characters as spreadsheet importers may ignore them.
        // A leading tab, CR or LF also gets guarded even when it precedes ordinary text.
        var guard = false;
        foreach (var c in value)
        {
            if (char.IsControl(c)) { guard = true; continue; }
            if (char.IsWhiteSpace(c) || char.GetUnicodeCategory(c) == UnicodeCategory.Format) continue;
            guard |= c is '=' or '+' or '-' or '@' or '＝' or '＋' or '－' or '＠';
            break;
        }
        return "\"" + (guard ? "'" : "") + value.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
    }

    private static void WriteHtmlRow(TextWriter writer, ReportRow row, bool total)
    {
        writer.Write(total ? "<tr class=\"total\"" : "<tr");
        if (row.VoucherId.HasValue)
        {
            writer.Write(" data-voucher-id=\""); writer.Write(row.VoucherId.Value.ToString("D")); writer.Write('"');
        }
        if (row.AccountCode is not null)
        {
            writer.Write(" data-account-code=\""); writer.Write(H(row.AccountCode)); writer.Write('"');
        }
        writer.Write('>');
        foreach (var cell in row.Cells)
        {
            writer.Write(cell.Kind == ReportValueKind.Amount ? "<td class=\"amount\">" : "<td>");
            writer.Write(H(cell.DisplayText)); writer.Write("</td>");
        }
        writer.Write("</tr>\n");
    }

    private static string H(string value) => WebUtility.HtmlEncode(value);
    private static string I(long value) => value.ToString(CultureInfo.InvariantCulture);
}
