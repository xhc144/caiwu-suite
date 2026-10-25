using System.Net;
using Caiwu.Contracts;
using Caiwu.Reporting;

namespace Caiwu.ReportDesigner.Tests;

public sealed class ReportingPolicyTests
{
    [Theory]
    [InlineData("=1+1")]
    [InlineData("  +1")]
    [InlineData("\u200B@SUM(1)")]
    [InlineData("\tordinary")]
    [InlineData("\r\nplain")]
    [InlineData("－1")]
    [InlineData("<script>\"&</script>")]
    [InlineData("normal,\"quoted\"\n下一行")]
    public void CustomExportsConformToExistingReportingEscapingPolicy(string text)
    {
        var source = ReportBuilder.TrialBalance(SyntheticFixture.Input().Metadata,
            [new TrialBalanceRow("1", text, true, 0, 0, 1, 0, 1, 0)]);
        var input = new ReportInputSnapshot(source, 5);
        var template = input.CreateTemplate() with { Title = text, Header = text };
        var preview = ReportDesignerEngine.Preview(input, template);
        var baselineCsv = ReportExporter.ToCsv(source);
        var customCsv = ReportDesignerExport.ToCsv(preview);
        // The existing exporter is the independently exercised policy reference.
        var escaped = text.Replace("\"", "\"\"", StringComparison.Ordinal);
        Assert.Equal(baselineCsv.Contains("\"'" + escaped + "\"", StringComparison.Ordinal), customCsv.Contains("\"'" + escaped + "\"", StringComparison.Ordinal));
        Assert.Contains(WebUtility.HtmlEncode(text), ReportExporter.ToHtml(source));
        Assert.Contains(WebUtility.HtmlEncode(text), ReportDesignerExport.ToHtml(preview));
    }
}
