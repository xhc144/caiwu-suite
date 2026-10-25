using System.Globalization;
using System.Net;
using System.Text;

namespace Caiwu.Nonprofit.Reporting;

public enum StatementExportPurpose { CalculationPreview, FormalReport }
public sealed record StatementHtmlOptions
{
    public int RowsPerPage { get; }
    public bool Landscape { get; }
    public StatementHtmlOptions(int rowsPerPage = 18, bool landscape = true)
    {
        if (rowsPerPage is < 1 or > 1000) throw new ArgumentOutOfRangeException(nameof(rowsPerPage));
        RowsPerPage = rowsPerPage; Landscape = landscape;
    }
}

/// <summary>Adapter for the independent DTO. Security policy follows Caiwu.Reporting/ReportExporter.cs
/// (RFC4180, guarded text, encoded self-contained HTML, CSP, caller-owned streams).
/// Existing ReportDocument/row constructors are internal; no reflection, duplicate public types or edits there.</summary>
public static class NonprofitStatementExporter
{
    public static string ToCsv(NonprofitStatement statement, StatementExportPurpose purpose = StatementExportPurpose.CalculationPreview)
    {
        using var writer = new StringWriter(CultureInfo.InvariantCulture);
        WriteCsv(statement, writer, purpose); return writer.ToString();
    }
    public static void WriteCsv(NonprofitStatement statement, Stream stream, bool leaveOpen = true,
        StatementExportPurpose purpose = StatementExportPurpose.CalculationPreview)
    {
        ArgumentNullException.ThrowIfNull(stream); Check(statement, purpose);
        using var writer = new StreamWriter(stream, new UTF8Encoding(true, true), 4096, leaveOpen);
        WriteCsv(statement, writer, purpose);
    }
    public static void WriteCsv(NonprofitStatement statement, TextWriter writer,
        StatementExportPurpose purpose = StatementExportPurpose.CalculationPreview)
    {
        Check(statement, purpose); ArgumentNullException.ThrowIfNull(writer);
        var width = statement.Columns.Count + 3;
        void Pair(string key, string value) => CsvRecord(writer, new[] { CsvText(key), CsvText(value) }.Concat(Enumerable.Repeat("\"\"", width - 2)));
        foreach (var pair in Metadata(statement)) Pair(pair.Key, pair.Value);
        CsvRecord(writer, new[] { CsvText("项目键"), CsvText("项目（官方未印行号）"), CsvText("分组") }.Concat(statement.Columns.Select(c => CsvText(c.Label))));
        foreach (var line in statement.Lines)
            CsvRecord(writer, new[] { CsvText(line.Key), CsvText(line.Label), CsvText(line.Section) }.Concat(line.Values.Select(v =>
                v.Amount is { } amount ? amount.ToString("F2", CultureInfo.InvariantCulture) : CsvText(MissingText(v)))));
        foreach (var missing in statement.MissingReasons) Pair("缺失/阻断 " + missing.Code + " " + missing.Path, missing.Detail);
        foreach (var line in statement.Lines) Pair("公式 " + line.Key, line.Formula + "；" + line.SourceLocator);
        Pair("制度来源", NonprofitStatement.OfficialUrl);
        Pair("衔接来源", NonprofitStatement.TransitionUrl);
    }
    public static string ToHtml(NonprofitStatement statement, StatementHtmlOptions? options = null,
        StatementExportPurpose purpose = StatementExportPurpose.CalculationPreview)
    {
        using var writer = new StringWriter(CultureInfo.InvariantCulture);
        WriteHtml(statement, writer, options, purpose); return writer.ToString();
    }
    public static void WriteHtml(NonprofitStatement statement, Stream stream, StatementHtmlOptions? options = null,
        bool leaveOpen = true, StatementExportPurpose purpose = StatementExportPurpose.CalculationPreview)
    {
        ArgumentNullException.ThrowIfNull(stream); Check(statement, purpose);
        using var writer = new StreamWriter(stream, new UTF8Encoding(false, true), 4096, leaveOpen);
        WriteHtml(statement, writer, options, purpose);
    }
    public static void WriteHtml(NonprofitStatement statement, TextWriter writer, StatementHtmlOptions? options = null,
        StatementExportPurpose purpose = StatementExportPurpose.CalculationPreview)
    {
        Check(statement, purpose); ArgumentNullException.ThrowIfNull(writer); options ??= new();
        writer.Write("<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">");
        writer.Write("<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\"><meta name=\"referrer\" content=\"no-referrer\"><title>");
        writer.Write(H(statement.Title)); writer.Write("</title><style>@page{size:A4 "); writer.Write(options.Landscape ? "landscape" : "portrait");
        writer.Write(";margin:12mm}body{font-family:'Microsoft YaHei','Noto Sans CJK SC',sans-serif;color:#111;background:white;font-size:9pt}.page{break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}h1{font-size:16pt}.meta{display:flex;flex-wrap:wrap;gap:2mm 6mm}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #777;padding:1.5mm;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}.amount{text-align:right;font-variant-numeric:tabular-nums}.missing{color:#8b1111}.total{font-weight:bold}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}.notice{font-weight:bold}p,span,li{overflow-wrap:anywhere}a{color:inherit}@media screen{body{max-width:300mm;margin:6mm auto}.page{margin-bottom:12mm}}@media print{th{print-color-adjust:exact}}</style></head><body>");
        var pages = Math.Max(1, (statement.Lines.Count + options.RowsPerPage - 1) / options.RowsPerPage);
        for (var page = 0; page < pages; page++)
        {
            writer.Write("<section class=\"page\"><h1>"); writer.Write(H(statement.Title)); writer.Write("</h1><div class=\"meta\">");
            foreach (var pair in Metadata(statement)) { writer.Write("<span>"); writer.Write(H(pair.Key + "：" + pair.Value)); writer.Write("</span>"); }
            writer.Write("</div><p class=\"notice\">"); writer.Write(H(statement.Notice)); writer.Write("</p><table><thead><tr><th>项目（官方未印行号）</th>");
            foreach (var col in statement.Columns) { writer.Write("<th>"); writer.Write(H(col.Label)); writer.Write("</th>"); }
            writer.Write("</tr></thead><tbody>");
            foreach (var line in statement.Lines.Skip(page * options.RowsPerPage).Take(options.RowsPerPage))
            {
                writer.Write(line.IsSubtotal ? "<tr class=\"total\"" : "<tr"); writer.Write(" data-key=\""); writer.Write(H(line.Key)); writer.Write("\"><td>");
                writer.Write(H(line.Label)); writer.Write("</td>");
                foreach (var value in line.Values)
                {
                    writer.Write(value.Amount.HasValue ? "<td class=\"amount\">" : "<td class=\"missing\">");
                    writer.Write(H(value.Amount?.ToString("F2", CultureInfo.InvariantCulture) ?? MissingText(value))); writer.Write("</td>");
                }
                writer.Write("</tr>");
            }
            writer.Write("</tbody></table><p>第 "); writer.Write((page + 1).ToString(CultureInfo.InvariantCulture)); writer.Write(" / ");
            writer.Write(pages.ToString(CultureInfo.InvariantCulture)); writer.Write(" 逻辑页；实际纸张页数依打印预览。</p>");
            if (page == pages - 1)
            {
                writer.Write("<div class=\"missing\"><ul>");
                foreach (var issue in statement.MissingReasons) { writer.Write("<li>"); writer.Write(H(issue.Code + " " + issue.Path + "：" + issue.Detail)); writer.Write("</li>"); }
                writer.Write("</ul></div><p>制度来源：<a rel=\"noreferrer noopener\" href=\""); writer.Write(H(NonprofitStatement.OfficialUrl)); writer.Write("\">");
                writer.Write(H(NonprofitStatement.OfficialUrl)); writer.Write("</a></p><p>衔接来源：<a rel=\"noreferrer noopener\" href=\"");
                writer.Write(H(NonprofitStatement.TransitionUrl)); writer.Write("\">"); writer.Write(H(NonprofitStatement.TransitionUrl)); writer.Write("</a></p>");
                writer.Write("<details><summary>计算公式及定位</summary><ul>");
                foreach (var line in statement.Lines) { writer.Write("<li>"); writer.Write(H(line.Key + "：" + line.Formula + "；" + line.SourceLocator)); writer.Write("</li>"); }
                writer.Write("</ul></details>");
            }
            writer.Write("</section>");
        }
        writer.Write("</body></html>");
    }
    private static void Check(NonprofitStatement statement, StatementExportPurpose purpose)
    {
        ArgumentNullException.ThrowIfNull(statement);
        if (!Enum.IsDefined(purpose)) throw new ArgumentOutOfRangeException(nameof(purpose));
        if (purpose == StatementExportPurpose.FormalReport) statement.RequireFormalReport();
    }
    private static IEnumerable<KeyValuePair<string, string>> Metadata(NonprofitStatement s)
    {
        yield return new("报表", s.Title); yield return new("表号", s.OfficialForm);
        yield return new("账套", s.Context.BookName); yield return new("账套ID", s.Context.BookId.ToString("D"));
        yield return new("制度", "民间非营利组织会计制度，财会〔2024〕25号，2026起");
        yield return new("期间", s.Context.Period.From.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + " 至 " + s.Context.Period.To.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        yield return new("账簿版本", s.Context.SourceLedgerRevision.ToString(CultureInfo.InvariantCulture));
        yield return new("来源证据", s.Context.SourceEvidenceReference);
        if (s.OfficialForm == "会民非01表")
            yield return new("余额日期", "年初 " + s.Context.Period.YearStart.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + "；期末 " + s.Context.Period.To.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        yield return new("生成时间", s.Context.GeneratedAt.ToString("O", CultureInfo.InvariantCulture));
        yield return new("币种/单位", "CNY / 元"); yield return new("状态", Status(s));
        yield return new("比较数", s.ComparativeState switch
        {
            ComparativeState.NotRequiredOn2026FirstAdoption => "2026首次执行不要求上年比较数（未用0替代）",
            ComparativeState.Missing => "缺上年比较数", ComparativeState.Supplied => "已传上年可比口径", _ => "未要求比较列"
        });
        yield return new("规则包/公式版本", NonprofitStatement.RulePackageId + " / " + NonprofitStatement.RulePackageVersion + " / " + NonprofitStatement.FormulaVersion);
        yield return new("规则包SHA256", NonprofitStatement.RulePackageSha256);
        yield return new("制度全文SHA256", NonprofitStatement.OfficialSha256);
        yield return new("说明", s.Notice);
    }
    private static string Status(NonprofitStatement s) => s.Status switch
    {
        StatementStatus.Incomplete => "输入不完整；计算预览；" + (s.Context.SourceKind == StatementSourceKind.PendingReviewProjection ? "待审假设投影，非已记账事实" : "来源为已记账数据"),
        StatementStatus.PendingReviewProjection => "待审假设投影，非已记账事实；计算预览",
        _ => "数值已计算；计算预览；未经正式报表审定"
    };
    private static string MissingText(StatementValue value) => value.State == ValueState.NotRequired ? "不要求填列" :
        "缺失：" + string.Join("；", value.MissingReasons.Select(r => r.Code + " " + r.Path + " " + r.Detail));
    private static string H(string value) => WebUtility.HtmlEncode(value);
    private static string CsvText(string value)
    {
        var guard = false;
        foreach (var c in value)
        {
            if (char.IsControl(c)) { guard = true; continue; }
            if (char.IsWhiteSpace(c) || char.GetUnicodeCategory(c) == UnicodeCategory.Format) continue;
            guard |= c is '=' or '+' or '-' or '@' or '＝' or '＋' or '－' or '＠'; break;
        }
        return "\"" + (guard ? "'" : "") + value.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
    }
    private static void CsvRecord(TextWriter writer, IEnumerable<string> cells) => writer.Write(string.Join(',', cells) + "\r\n");
}
