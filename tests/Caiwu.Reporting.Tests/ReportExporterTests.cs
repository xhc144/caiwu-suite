using System.Globalization;
using System.Net;
using System.Text;
using Caiwu.Contracts;
using static Caiwu.Reporting.Tests.ReportBuilderTests;

namespace Caiwu.Reporting.Tests;

public sealed class ReportExporterTests
{
    [Theory]
    [InlineData("=1+1")]
    [InlineData("+SUM(A1:A2)")]
    [InlineData("-00123")]
    [InlineData("@SUM(A1)")]
    [InlineData("\t普通文本")]
    [InlineData("\r=1+1")]
    [InlineData("\n=1+1")]
    [InlineData(" \uFEFF\u200B=1+1")]
    [InlineData("　+1+1")]
    [InlineData("＝1+1")]
    [InlineData("＋1+1")]
    [InlineData("－1+1")]
    [InlineData("＠SUM(A1)")]
    public void CsvGuardsFormulaLikeTextAfterInvisibleCharacters(string text)
    {
        var report = ReportBuilder.Ledger(Metadata(), "1002", [new(From, null, "记", 1, text, -0.20m, 0, -0.20m)]);
        var csv = ReportExporter.ToCsv(report);
        var data = ParseCsv(csv).Single(row => row[5] == "'" + text);
        Assert.Equal("-0.20", data[6]);
        Assert.Equal("-0.20", data[9]);
        Assert.DoesNotContain("\"'-0.20\"", csv);
    }

    [Theory]
    [InlineData("fr-FR")]
    [InlineData("ar-SA")]
    [InlineData("zh-CN")]
    public void CsvRoundTripsUnicodeQuotesNewlinesAndInvariantAmounts(string culture)
    {
        var previous = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo(culture);
            const string summary = "中文 🧾,\"双引号\"\r\n下一行\n末行";
            var report = ReportBuilder.Ledger(Metadata(), "001/α", [new(From, null, "记", 1, summary, 0.10m, 0.20m, -0.10m)]);
            var records = ParseCsv(ReportExporter.ToCsv(report));
            Assert.All(records, r => Assert.Equal(report.Columns.Count, r.Length));
            var data = records.Single(r => r[5] == summary);
            Assert.Equal("001/α", data[0]);
            Assert.Equal("2026-01-01", data[2]);
            Assert.Equal("0.10", data[6]);
            Assert.Equal("0.20", data[7]);
            Assert.Equal("-0.10", data[9]);
            Assert.Contains(records, r => r[0] == "期间" && r[1] == "2026-01-01 至 2026-01-31");
            Assert.Contains(records, r => r[0] == "生成时间" && r[1] == "2026-02-01T10:20:30.0000000+08:00");
            Assert.Contains(records, r => r[0] == "制度版本" && r[1] == "small-business-demo-2026-v1");
            Assert.Contains("2026-01-01 至 2026-01-31", ReportExporter.ToHtml(report));
        }
        finally { CultureInfo.CurrentCulture = previous; }
    }

    [Fact]
    public void CsvGuardsMetadataCatalogNamesCodesAndSourceLabels()
    {
        var metadata = new ReportMetadata(Book("=WEBSERVICE(\"https://bad.invalid\")") with { TemplateVersion = "@version" },
            From, To, DateTimeOffset.UtcNow, [new("=来源", "https://example.org/rules?a=1&b=中文")]);
        var voucher = V(1) with { Kind = "=凭证字", PreparedBy = "-制单", ReviewedBy = "+审核",
            Lines = [new("=编码", "@摘要", 1, 0)] };
        var report = ReportBuilder.VoucherList(metadata, [voucher], [A("=编码", "+科目")]);
        var records = ParseCsv(ReportExporter.ToCsv(report));
        Assert.Contains(records, r => r[0] == "账套" && r[1] == "'=WEBSERVICE(\"https://bad.invalid\")");
        Assert.Contains(records, r => r[0] == "制度版本" && r[1] == "'@version");
        var data = records.Single(r => r[12] == voucher.Id.ToString("D"));
        Assert.Equal("'=凭证字", data[1]);
        Assert.Equal("'=编码", data[4]);
        Assert.Equal("'+科目", data[5]);
        Assert.Equal("'@摘要", data[6]);
        Assert.Equal("'-制单", data[10]);
        Assert.Equal("'+审核", data[11]);
        Assert.Contains(records, r => r[0] == "来源：=来源" && r[1] == "https://example.org/rules?a=1&b=中文");
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("data:text/html,<script>alert(1)</script>")]
    [InlineData("file:///etc/passwd")]
    [InlineData("//example.org/rules")]
    [InlineData("/rules")]
    [InlineData("https://user:secret@example.org/rules")]
    [InlineData("https://example.org/\npath")]
    public void RejectsUnsafeSourceSchemesCredentialsAndControlCharacters(string address) =>
        Assert.Throws<ArgumentException>(() => new ReportSource("来源", address));

    [Fact]
    public void HtmlEncodesEveryDynamicSurfaceAndRetainsSafePrintableSourceLinks()
    {
        const string hostile = "</td><script>alert(1)</script><img src=x onerror='boom'>\" & 中文 🧾";
        const string code = "1002\" onclick=\"boom";
        const string address = "https://example.org/规则?a=1&b=%22quoted%22";
        var metadata = new ReportMetadata(Book(hostile) with { TemplateVersion = hostile }, From, To,
            new DateTimeOffset(2026, 2, 1, 0, 0, 0, TimeSpan.Zero), [new(hostile, address)]);
        var id = Guid.Parse("00000000-0000-0000-0000-000000000007");
        var report = ReportBuilder.Ledger(metadata, code, [new(From, id, hostile, 7, hostile, 0, 1, -1)], [A(code, hostile)]);
        var html = ReportExporter.ToHtml(report);
        Assert.StartsWith("<!doctype html>", html);
        Assert.Contains("lang=\"zh-CN\"", html);
        Assert.Contains("charset=\"utf-8\"", html);
        Assert.DoesNotContain("<script", html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("<img", html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(" onclick=\"boom\"", html);
        Assert.Contains("&lt;script&gt;", html);
        Assert.Contains("&quot; onclick=&quot;boom", html);
        Assert.Contains("data-voucher-id=\"" + id.ToString("D") + "\"", html);
        Assert.Contains("href=\"https://example.org/规则?a=1&amp;b=%22quoted%22\"", html);
        Assert.Contains(hostile, WebUtility.HtmlDecode(html));
        Assert.Contains("default-src 'none'", html);
        Assert.Contains("table-header-group", html);
        Assert.Contains("page-break-after:always", html);
    }

    [Fact]
    public void VoucherIdsSurviveBothExportFormats()
    {
        var voucher = V(1);
        var report = ReportBuilder.VoucherList(Metadata(), [voucher]);
        Assert.Contains(voucher.Id.ToString("D"), ReportExporter.ToHtml(report));
        Assert.Contains(ParseCsv(ReportExporter.ToCsv(report)), r => r[12] == voucher.Id.ToString("D"));
    }

    [Fact]
    public void PaginationCountsTotalRepeatsHeadersAndNeverDropsRowsOrSources()
    {
        const int count = 10000;
        var source = new ReportSource("规则原文（明确版本）", "https://example.org/规则?version=2026&x=1");
        var report = ReportBuilder.TrialBalance(Metadata([source]),
            Enumerable.Range(0, count).Select(i => B(i.ToString("D5", CultureInfo.InvariantCulture), true, 0.01m)));
        var html = ReportExporter.ToHtml(report, new HtmlExportOptions(100));
        Assert.Equal(101, Count(html, "<section class=\"page\">"));
        Assert.Equal(101, Count(html, "<thead>"));
        Assert.Equal(10000, Count(html, "data-account-code="));
        Assert.Equal(1, Count(html, "<tr class=\"total\""));
        Assert.Equal(1, Count(html, "href="));
        Assert.Contains("第 101 / 101 页", html);
        Assert.Contains("data-account-code=\"09999\"", html);
        Assert.Equal(100m, report.Total.Cells[8].Amount);
        var csv = ParseCsv(ReportExporter.ToCsv(report));
        Assert.Equal(count, csv.Count(r => r[2] == "1" && r[3] == "是"));
        Assert.Contains(csv, r => r[0] == "来源：规则原文（明确版本）" && r[1] == source.Address);
    }

    [Fact]
    public void EmptyAndOneRowReportsStillHaveValidLogicalPages()
    {
        var empty = ReportBuilder.Ledger(Metadata(), "1002", []);
        Assert.Equal(1, Count(ReportExporter.ToHtml(empty, new HtmlExportOptions(1)), "<section class=\"page\">"));
        var one = ReportBuilder.TrialBalance(Metadata(), [B("1002", true)]);
        var html = ReportExporter.ToHtml(one, new HtmlExportOptions(1, false));
        Assert.Equal(2, Count(html, "<thead>"));
        Assert.Contains("size:A4 portrait", html);
        Assert.Throws<ArgumentOutOfRangeException>(() => new HtmlExportOptions(0));
        Assert.Throws<ArgumentOutOfRangeException>(() => new HtmlExportOptions(1001));
    }

    [Fact]
    public void StreamExportsUseCorrectUtf8BomAndRespectOwnership()
    {
        var report = ReportBuilder.TrialBalance(Metadata(), [B("中文🧾", true, -0.01m)]);
        using var csv = new MemoryStream();
        ReportExporter.WriteCsv(report, csv);
        Assert.True(csv.CanWrite);
        Assert.Equal(new byte[] { 0xEF, 0xBB, 0xBF }, csv.ToArray().Take(3));
        Assert.Contains("中文🧾", Encoding.UTF8.GetString(csv.ToArray()));
        using var html = new MemoryStream();
        ReportExporter.WriteHtml(report, html);
        Assert.True(html.CanWrite);
        Assert.Equal((byte)'<', html.ToArray()[0]);
        Assert.Contains("中文🧾", WebUtility.HtmlDecode(Encoding.UTF8.GetString(html.ToArray())));
        var owned = new MemoryStream();
        ReportExporter.WriteCsv(report, owned, leaveOpen: false);
        Assert.False(owned.CanWrite);
        var htmlOwned = new MemoryStream();
        ReportExporter.WriteHtml(report, htmlOwned, leaveOpen: false);
        Assert.False(htmlOwned.CanWrite);
        using var writer = new StringWriter();
        ReportExporter.WriteCsv(report, writer);
        writer.Write("still open");
        Assert.EndsWith("still open", writer.ToString());
    }

    [Fact]
    public void ExportDoesNotSwallowIoFailures()
    {
        var report = ReportBuilder.TrialBalance(Metadata(), []);
        using var writer = new FailingWriter();
        Assert.Throws<IOException>(() => ReportExporter.WriteCsv(report, writer));
        Assert.Throws<IOException>(() => ReportExporter.WriteHtml(report, writer));
    }

    private sealed class FailingWriter : TextWriter
    {
        public override Encoding Encoding => Encoding.UTF8;
        public override void Write(char value) => throw new IOException("simulated full disk");
    }

    private static int Count(string value, string needle) =>
        (value.Length - value.Replace(needle, "", StringComparison.Ordinal).Length) / needle.Length;

    // A separate RFC 4180 reader verifies records, quoting and embedded newlines independently of the exporter.
    internal static List<string[]> ParseCsv(string csv)
    {
        var records = new List<string[]>();
        var row = new List<string>();
        var field = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < csv.Length; i++)
        {
            var c = csv[i];
            if (c == '"')
            {
                if (quoted && i + 1 < csv.Length && csv[i + 1] == '"') { field.Append('"'); i++; }
                else quoted = !quoted;
            }
            else if (!quoted && c == ',') { row.Add(field.ToString()); field.Clear(); }
            else if (!quoted && c == '\r')
            {
                Assert.True(i + 1 < csv.Length && csv[++i] == '\n', "CSV record must end with CRLF.");
                row.Add(field.ToString()); field.Clear(); records.Add(row.ToArray()); row.Clear();
            }
            else if (!quoted && c == '\n') Assert.Fail("Bare LF outside a quoted field.");
            else field.Append(c);
        }
        Assert.False(quoted);
        Assert.Empty(row);
        Assert.Equal(0, field.Length);
        return records;
    }
}
