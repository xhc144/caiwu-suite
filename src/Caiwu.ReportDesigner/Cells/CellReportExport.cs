using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Caiwu.ReportDesigner.Cells;

public static class CellReportExport
{
    public static string Html(CellReportResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        var report = result.Report; var html = new StringBuilder();
        static string E(string s) => WebUtility.HtmlEncode(s);
        html.Append("<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\"><title>").Append(E(report.Title)).Append("</title><style>body{font-family:sans-serif}table{border-collapse:collapse;table-layout:fixed}td{border:1px solid #aaa;overflow:hidden}caption{text-align:left}small{display:block;white-space:pre-wrap}</style><h1>").Append(E(report.Title)).Append("</h1><small>").Append(E(Audit(result))).Append("</small><table><colgroup>");
        var columns = report.Columns.ToDictionary(c => c.Index, c => c.WidthCharacters);
        var rows = report.Rows.ToDictionary(r => r.Index, r => r.HeightInches);
        for (var col = 1; col <= report.ColumnCount; col++) html.Append("<col style=\"width:").Append(N(columns.GetValueOrDefault(col, report.DefaultColumnWidthCharacters))).Append("ch\">");
        html.Append("</colgroup><tbody>");
        for (var row = 1; row <= report.RowCount; row++)
        {
            html.Append("<tr style=\"height:").Append(N(rows.GetValueOrDefault(row, report.DefaultRowHeightInches))).Append("in\">");
            for (var col = 1; col <= report.ColumnCount; col++)
            {
                if (!result.Cells.TryGetValue(new CellAddress(row, col).ToString(), out var cell)) { html.Append("<td></td>"); continue; }
                var h = cell.Format.Horizontal switch { CellHorizontalAlignment.Left => "left", CellHorizontalAlignment.Center => "center", CellHorizontalAlignment.Right => "right", _ => cell.Number.HasValue ? "right" : "left" };
                var v = cell.Format.Vertical switch { CellVerticalAlignment.Top => "top", CellVerticalAlignment.Bottom => "bottom", _ => "middle" };
                html.Append("<td style=\"text-align:").Append(h).Append(";vertical-align:").Append(v).Append(";white-space:").Append(cell.Format.Wrap ? "pre-wrap" : "pre").Append("\">").Append(E(cell.Text)).Append("</td>");
            }
            html.Append("</tr>");
        }
        return html.Append("</tbody></table></html>").ToString();
    }
    public static string Csv(CellReportResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        var csv = new StringBuilder();
        // CSV intentionally exports cell grid only; use Audit for a sidecar if the host needs metadata.
        for (var row = 1; row <= result.Report.RowCount; row++)
        {
            for (var col = 1; col <= result.Report.ColumnCount; col++)
            {
                if (col > 1) csv.Append(',');
                if (!result.Cells.TryGetValue(new CellAddress(row, col).ToString(), out var cell)) { csv.Append("\"\""); continue; }
                var text = cell.Text;
                if (!cell.Number.HasValue && (text.StartsWith('\t') || text.StartsWith('\r') || text.StartsWith('\n') ||
                    (text.TrimStart().FirstOrDefault() is '=' or '+' or '-' or '@'))) text = "'" + text;
                csv.Append('"').Append(text.Replace("\"", "\"\"", StringComparison.Ordinal)).Append('"');
            }
            csv.Append("\r\n");
        }
        return csv.ToString();
    }
    public static string Audit(CellReportResult result) =>
        $"{(result.Source.IsSynthetic ? "SYNTHETIC 合成账务" : "宿主账务快照（原账套兼容需另行验收）")}\n" +
        $"BookId={result.Source.BookId:D}; revision={result.Source.Revision}; {result.Source.From:yyyy-MM-dd}..{result.Source.To:yyyy-MM-dd}; currency={result.Source.Currency}\n" +
        $"report={result.Report.Id:D}; version={result.Report.Version}; SHA256={Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(result.Report)))}\n" +
        $"未过账凭证={result.Source.UnpostedVoucherCount}（不计入取数）；显示舍入不改变计算值。\n{result.Source.Description}";
    public static void WriteHtml(string path, CellReportResult result) => WriteNew(path, Html(result));
    public static void WriteCsv(string path, CellReportResult result) => WriteNew(path, Csv(result));
    private static void WriteNew(string path, string content)
    {
        if (!Path.IsPathFullyQualified(path)) throw new ArgumentException("导出路径须为绝对路径。");
        var full = Path.GetFullPath(path); var stage = Path.Combine(Path.GetDirectoryName(full)!, ".export-" + Guid.NewGuid().ToString("N") + ".tmp");
        try {
            using (var stream = new FileStream(stage, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            using (var writer = new StreamWriter(stream, new UTF8Encoding(true))) { writer.Write(content); writer.Flush(); stream.Flush(true); }
            AtomicPublication.New(stage, full);
        } finally { if (File.Exists(stage)) File.Delete(stage); }
    }
    private static string N(decimal number) => number.ToString(CultureInfo.InvariantCulture);
}
