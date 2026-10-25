using System.Globalization;
using System.Text;
using Caiwu.Nonprofit.Reporting;
using static Caiwu.Nonprofit.Reporting.Tests.SyntheticData;

namespace Caiwu.Nonprofit.Reporting.Tests;

public sealed class ExportAndMoneyTests
{
    [Theory]
    [InlineData("=HYPERLINK(\"https://bad.invalid\")")]
    [InlineData(" \uFEFF\u200B+1+1")]
    [InlineData("＠SUM(A1)")]
    [InlineData("\t普通文本")]
    public void CsvGuardsMetadataAndDynamicLabels_ButKeepsNegativeMoneyNumeric(string hostile)
    {
        var ctx=Context(name:hostile);
        var r=NonprofitActivityStatement.Calculate(Activity(ctx,[E(400,6,ActivityFact.InvestmentIncome,-1.25m,U)]));
        var records=ParseCsv(NonprofitStatementExporter.ToCsv(r));
        Assert.All(records,row=>Assert.Equal(r.Columns.Count+3,row.Length));
        Assert.Contains(records,row=>row[0]=="账套"&&row[1]=="'"+hostile);
        Assert.Equal("-1.25",records.Single(row=>row[0]=="investment")[3]);
        var details=new[]{new ActivityComponent("project-A",hostile,ActivityComponentKind.Project)};
        r=NonprofitActivityStatement.Calculate(Activity(Context(),[E(401,6,ActivityFact.BusinessActivityCost,1,U,"project-A")],details));
        Assert.Contains(ParseCsv(NonprofitStatementExporter.ToCsv(r)),row=>row[0]=="component:project-A"&&row[1]=="其中："+hostile);
    }
    [Fact]
    public void CsvRoundTripsUnicodeQuotesNewlinesAndMissingReasonsWithoutBlankZeroAmbiguity()
    {
        const string name="合成 🧾,\"引号\"\r\n下一行";
        var r=NonprofitActivityStatement.Calculate(new(Context(name:name),null,null,Components));
        var records=ParseCsv(NonprofitStatementExporter.ToCsv(r));
        Assert.Contains(records,x=>x[0]=="账套"&&x[1]==name);
        var data=records.Single(x=>x[0]=="donation");Assert.StartsWith("缺失：",data[3],StringComparison.Ordinal);
        Assert.Contains(records,x=>x[0].StartsWith("缺失/阻断",StringComparison.Ordinal)&&x[1].Contains("完整发生额",StringComparison.Ordinal));
    }
    [Fact]
    public void HtmlEncodesDynamicContentAndPagesAllRowsWithRepeatedMetadataAndNoScript()
    {
        const string hostile="</td><script>alert(1)</script><img src=x onerror='boom'>\" & 中文";
        var r=NonprofitActivityStatement.Calculate(Activity(Context(name:hostile),[E(410,6,ActivityFact.BusinessActivityCost,1,U,"project-A")],
            [new("project-A",hostile,ActivityComponentKind.Project)]));
        var html=NonprofitStatementExporter.ToHtml(r,new(3));
        Assert.DoesNotContain("<script>",html,StringComparison.Ordinal);Assert.DoesNotContain("<img",html,StringComparison.Ordinal);
        Assert.Contains("&lt;script&gt;",html,StringComparison.Ordinal);Assert.Contains("default-src 'none'",html,StringComparison.Ordinal);
        Assert.Equal((r.Lines.Count+2)/3,Count(html,"<section class=\"page\">"));
        Assert.Equal(r.Lines.Count,Count(html," data-key=\""));Assert.Equal((r.Lines.Count+2)/3,Count(html,"<thead>"));
        Assert.Contains(NonprofitStatement.OfficialUrl,html,StringComparison.Ordinal);Assert.Contains("计算预览",html,StringComparison.Ordinal);
    }
    [Fact]
    public void ExportsPreserveExplicitSourceRevisionClockFormAndPendingState()
    {
        var r=NonprofitActivityStatement.Calculate(Activity(Context(source:StatementSourceKind.PendingReviewProjection),[]));
        var csv=NonprofitStatementExporter.ToCsv(r);var html=NonprofitStatementExporter.ToHtml(r);
        foreach(var value in new[]{"会民非02表","42","2026-06-01 至 2026-06-30","2026-07-01T10:20:30.0000000+08:00","待审假设投影","非已记账事实"})
        {Assert.Contains(value,csv,StringComparison.Ordinal);Assert.Contains(value,html,StringComparison.Ordinal);}
        Assert.Throws<InvalidOperationException>(()=>NonprofitStatementExporter.ToHtml(r,purpose:StatementExportPurpose.FormalReport));
    }
    [Fact]
    public void StreamsHaveDocumentedBomAndOwnership_AndIoFailurePropagates()
    {
        var r=NonprofitBalanceSheet.Calculate(BalanceInput());
        using var csv=new MemoryStream();NonprofitStatementExporter.WriteCsv(r,csv);Assert.True(csv.CanWrite);
        Assert.Equal(new byte[]{0xef,0xbb,0xbf},csv.ToArray()[..3]);
        using var html=new MemoryStream();NonprofitStatementExporter.WriteHtml(r,html);Assert.True(html.CanWrite);
        Assert.Equal("<!d",Encoding.UTF8.GetString(html.ToArray()[..3]));
        Assert.Throws<IOException>(()=>NonprofitStatementExporter.WriteCsv(r,new FailingWriter()));
        using var closed=new MemoryStream();NonprofitStatementExporter.WriteHtml(r,closed,leaveOpen:false);Assert.False(closed.CanWrite);
    }
    [Fact]
    public void InvariantExportAmountsUnderCommaDecimalCulture()
    {
        var prior=CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture=CultureInfo.GetCultureInfo("fr-FR");
            var r=NonprofitActivityStatement.Calculate(Activity(Context(),[E(420,6,ActivityFact.DonationIncome,0.1m,U),E(421,6,ActivityFact.DonationIncome,0.2m,U)]));
            Assert.Equal("0.30",ParseCsv(NonprofitStatementExporter.ToCsv(r)).Single(x=>x[0]=="donation")[3]);
        }
        finally {CultureInfo.CurrentCulture=prior;}
    }
    [Fact]
    public void SubCentAndRealOverflowsReject_OffsettingLargeEntriesAreOrderIndependent()
    {
        Assert.Throws<ArgumentException>(()=>Window(new(2026,6,1),new(2026,6,30),[E(430,6,ActivityFact.DonationIncome,0.001m,U)]));
        Assert.Throws<OverflowException>(()=>Balances(new(2026,6,30),new Dictionary<BalanceFact,decimal>{[BalanceFact.BankDeposits]=decimal.MaxValue}));
        const decimal limit=92233720368547758.07m;
        var entries=new[]{E(431,6,ActivityFact.DonationIncome,limit,U),E(432,6,ActivityFact.DonationIncome,0.01m,U),E(433,6,ActivityFact.DonationIncome,-limit,U)};
        foreach(var order in new[]{entries,entries.Reverse().ToArray(),new[]{entries[1],entries[0],entries[2]}})
        {
            var r=NonprofitActivityStatement.Calculate(Activity(Context(),order));Assert.Equal(0.01m,Amount(r,"donation",0));
        }
        Assert.Throws<OverflowException>(()=>NonprofitActivityStatement.Calculate(Activity(Context(),entries[..2])));
        Assert.Throws<OverflowException>(()=>NonprofitBalanceSheet.Calculate(BalanceInput(new Dictionary<BalanceFact,decimal>{[BalanceFact.Cash]=limit,[BalanceFact.BankDeposits]=0.01m})));
    }
    private static int Count(string text,string token)=>(text.Length-text.Replace(token,"",StringComparison.Ordinal).Length)/token.Length;
    private sealed class FailingWriter:StringWriter {public override void Write(string? value)=>throw new IOException("synthetic output failure");}
    // Independent RFC4180 reader: verifies records and embedded quote/newline escaping, not exporter helpers.
    private static List<string[]> ParseCsv(string csv)
    {
        var records=new List<string[]>();var record=new List<string>();var field=new StringBuilder();var quoted=false;
        for(var i=0;i<csv.Length;i++)
        {
            var c=csv[i];
            if(quoted)
            {
                if(c=='"'&&i+1<csv.Length&&csv[i+1]=='"'){field.Append('"');i++;}
                else if(c=='"')quoted=false;else field.Append(c);
            }
            else if(c=='"')quoted=true;
            else if(c==','){record.Add(field.ToString());field.Clear();}
            else if(c=='\r'&&i+1<csv.Length&&csv[i+1]=='\n'){record.Add(field.ToString());field.Clear();records.Add(record.ToArray());record.Clear();i++;}
            else field.Append(c);
        }
        Assert.False(quoted);Assert.Empty(record);Assert.Equal(0,field.Length);return records;
    }
}
