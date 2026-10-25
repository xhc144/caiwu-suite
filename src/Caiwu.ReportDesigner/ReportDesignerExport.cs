using System.Globalization;
using System.Net;
using System.Text;

namespace Caiwu.ReportDesigner;

public sealed record PageLayout(decimal PrintableWidth, decimal RequestedWidth, decimal Scale, int LogicalPages);
public static class ReportDesignerExport
{
    public static PageLayout Layout(ReportPreview preview)
    {
        var width = preview.Template.Orientation == PageOrientation.Landscape ? 1032m : 703m; // A4, 12 mm margins, 96 DPI
        var requested = preview.Columns.Sum(c => c.Width);
        var count = Math.Max(1, preview.Rows.Count);
        return new(width, requested, Math.Min(1, width / requested), (count + preview.Template.RowsPerPage - 1) / preview.Template.RowsPerPage);
    }
    public static void EnsureExportable(ReportPreview preview)
    {
        ArgumentNullException.ThrowIfNull(preview);
        if (preview.IsLimited) throw DesignValidationException.One("PREVIEW_LIMIT", "预览", "预览已截断，禁止导出或打印；请提高预览行数或缩小来源期间。");
    }
    /// <summary>Same RFC4180/CSV-injection policy as Reporting. Decimal values are invariant exact values, not formatted strings.</summary>
    public static void WriteCsv(ReportPreview preview, TextWriter writer)
    {
        EnsureExportable(preview); ArgumentNullException.ThrowIfNull(writer);
        var width = Math.Max(2, preview.Columns.Count);
        void Record(IEnumerable<string> cells) => writer.Write(string.Join(',', cells) + "\r\n");
        void Pair(string key, string value) => Record(new[] { CsvText(key), CsvText(value) }.Concat(Enumerable.Repeat("\"\"", width - 2)));
        Pair("标题", preview.Template.Title); Pair("页眉", preview.Template.Header);
        foreach (var line in preview.AuditLines()) Pair("审计/限制", line);
        Pair("页面", $"A4 {preview.Template.Orientation}；每逻辑页{preview.Template.RowsPerPage}行；CSV保存原始decimal，数值显示格式仅用于预览/HTML/打印。");
        Record(preview.Columns.Select(c => CsvText(c.Title)).Concat(Enumerable.Repeat("\"\"", width - preview.Columns.Count)));
        foreach (var row in preview.Rows) {
            if (row.Label.Length > 0) Pair("汇总", row.Label);
            Record(row.Cells.Select(c => c.Number is { } n ? n.ToString("0.############################", CultureInfo.InvariantCulture) : CsvText(c.Text))
                .Concat(Enumerable.Repeat("\"\"", width - row.Cells.Count)));
        }
    }
    /// <summary>Self-contained, encoded text, no executable template markup, scripts, external styles, remote resources or links.</summary>
    public static void WriteHtml(ReportPreview preview, TextWriter writer)
    {
        EnsureExportable(preview); ArgumentNullException.ThrowIfNull(writer); var layout = Layout(preview);
        writer.Write("<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\"><meta name=\"referrer\" content=\"no-referrer\"><title>");
        writer.Write(H(preview.Template.Title)); writer.Write("</title><style>@page{size:A4 ");
        writer.Write(preview.Template.Orientation == PageOrientation.Landscape ? "landscape" : "portrait");
        writer.Write(";margin:12mm}body{font:10pt 'Segoe UI','Microsoft YaHei',sans-serif;color:#111;background:white;margin:0}.page{break-after:page}.page:last-child{break-after:auto}h1{font-size:18pt}p{white-space:pre-wrap;overflow-wrap:anywhere}.audit{font-size:8pt}.warning{font-weight:bold}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #777;padding:4px;white-space:pre-wrap;overflow-wrap:anywhere;text-align:left;vertical-align:top}.number{text-align:right;font-variant-numeric:tabular-nums}.total,.subtotal{font-weight:bold}thead{display:table-header-group}tr{break-inside:avoid}@media screen{.page{margin:24px auto;max-width:");
        writer.Write(I(layout.PrintableWidth)); writer.Write("px;padding:24px;border:1px solid #ddd}}@media print{.page{padding:0}}</style></head><body>");
        for (var page = 0; page < layout.LogicalPages; page++) {
            writer.Write("<section class=\"page\"><h1>"); writer.Write(H(preview.Template.Title)); writer.Write("</h1><p>"); writer.Write(H(preview.Template.Header)); writer.Write("</p><div class=\"audit\">");
            foreach (var line in preview.AuditLines()) { writer.Write("<p class=\"warning\">"); writer.Write(H(line)); writer.Write("</p>"); }
            writer.Write("<p>列宽按比例适配纸宽；比例 "); writer.Write(I(layout.Scale)); writer.Write("。逻辑页可能因长文本增加实际纸张页数，须以打印预览为准。</p></div><table><colgroup>");
            foreach (var c in preview.Columns) { writer.Write("<col style=\"width:"); writer.Write(I(100 * c.Width / layout.RequestedWidth)); writer.Write("%\">"); }
            writer.Write("</colgroup><thead><tr>"); foreach (var c in preview.Columns) { writer.Write("<th scope=\"col\">"); writer.Write(H(c.Title)); writer.Write("</th>"); }
            writer.Write("</tr></thead><tbody>");
            foreach (var row in preview.Rows.Skip(page * preview.Template.RowsPerPage).Take(preview.Template.RowsPerPage)) {
                if (row.Label.Length > 0) { writer.Write("<tr><th colspan=\""); writer.Write(preview.Columns.Count); writer.Write("\">"); writer.Write(H(row.Label)); writer.Write("</th></tr>"); }
                writer.Write("<tr class=\""); writer.Write(row.Kind); writer.Write("\">");
                foreach (var cell in row.Cells) { writer.Write(cell.Number.HasValue ? "<td class=\"number\">" : "<td>"); writer.Write(H(cell.Text)); writer.Write("</td>"); }
                writer.Write("</tr>");
            }
            writer.Write("</tbody></table><p>逻辑页 "); writer.Write(page + 1); writer.Write(" / "); writer.Write(layout.LogicalPages); writer.Write("</p></section>");
        }
        writer.Write("</body></html>");
    }
    public static string ToHtml(ReportPreview preview) { using var writer = new StringWriter(CultureInfo.InvariantCulture); WriteHtml(preview, writer); return writer.ToString(); }
    public static string ToCsv(ReportPreview preview) { using var writer = new StringWriter(CultureInfo.InvariantCulture); WriteCsv(preview, writer); return writer.ToString(); }
    public static void ExportNewFile(ReportPreview preview, string hostPath, bool html)
    {
        EnsureExportable(preview);
        if (!Path.IsPathFullyQualified(hostPath)) throw new ArgumentException("导出路径由宿主提供绝对路径。");
        var extension = html ? ".html" : ".csv";
        if (!string.Equals(Path.GetExtension(hostPath), extension, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("导出扩展名不匹配。");
        var stage = Path.Combine(Path.GetDirectoryName(hostPath)!, "." + Guid.NewGuid().ToString("N") + ".tmp");
        try {
            using (var stream = new FileStream(stage, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                using (var writer = new StreamWriter(stream, new UTF8Encoding(!html, true), 4096, leaveOpen: true)) {
                    if (html) WriteHtml(preview, writer); else WriteCsv(preview, writer);
                }
                stream.Flush(flushToDisk: true);
            }
            AtomicPublication.New(stage, hostPath);
        } finally { if (File.Exists(stage)) File.Delete(stage); }
    }
    private static string H(string value) => WebUtility.HtmlEncode(value);
    private static string I(decimal value) => value.ToString("0.############################", CultureInfo.InvariantCulture);
    private static string CsvText(string value)
    {
        var guard = false;
        foreach (var c in value) {
            if (char.IsControl(c)) { guard = true; continue; }
            if (char.IsWhiteSpace(c) || char.GetUnicodeCategory(c) == UnicodeCategory.Format) continue;
            guard |= c is '=' or '+' or '-' or '@' or '＝' or '＋' or '－' or '＠'; break;
        }
        return "\"" + (guard ? "'" : "") + value.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
    }
}
