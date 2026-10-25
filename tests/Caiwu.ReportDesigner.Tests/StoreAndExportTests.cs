using System.Text;
using System.Text.Json;

namespace Caiwu.ReportDesigner.Tests;

public sealed class StoreAndExportTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "caiwu-designer-" + Guid.NewGuid().ToString("N"));
    public StoreAndExportTests() => Directory.CreateDirectory(directory);
    public void Dispose() => Directory.Delete(directory, recursive: true);
    private string PathFor(string name) => Path.Combine(directory, name);
    [Fact]
    public void EditPreviewSaveLoadExportCompleteLoop()
    {
        var input = SyntheticFixture.Input(); var original = SyntheticFixture.Template();
        var first = ReportDesignerEngine.Preview(input, original);
        var changed = original with { Header = "已修改", Columns = [original.Columns[2] with { Title = "更改三分之一", Width = 220 }, original.Columns[0], original.Columns[1] with { Expression = "SUM([periodDebit],-[periodCredit],0.2)" }] };
        var next = ReportDesignerEngine.Preview(input, changed);
        // Independent: per leaf100.10-10.00+0.20=90.30;30.20-20.10+0.20=10.30; total100.60.
        Assert.Equal(100.60m, next.Rows[^1].Cells[2].Number);
        Assert.Equal(100.20m, first.Rows[^1].Cells[1].Number);
        var path = PathFor("template.json"); var saved = TemplateStore.Save(path, changed);
        var loaded = TemplateStore.Load(path); Assert.Equal(saved.Sha256, loaded.Sha256);
        var readback = ReportDesignerEngine.Preview(input, loaded.Template);
        Assert.Equal(next.TemplateHash, readback.TemplateHash); Assert.Equal(220, readback.Columns[0].Width);
        ReportDesignerExport.ExportNewFile(readback, PathFor("report.html"), true);
        ReportDesignerExport.ExportNewFile(readback, PathFor("report.csv"), false);
        var html = File.ReadAllText(PathFor("report.html")); var csv = File.ReadAllText(PathFor("report.csv"));
        Assert.Contains("100.60", html); Assert.Contains("100.6", csv); Assert.Contains("更改三分之一", html);
        Assert.Contains(input.Fingerprint, html); Assert.Contains(loaded.Template.Id.ToString("D"), csv);
        Assert.Contains("2026-10-01", html); Assert.Contains("revision=42", csv);
        Assert.True(File.ReadAllBytes(PathFor("report.csv")).Take(3).SequenceEqual(new byte[] { 239, 187, 191 }));
        var widths = ParseCsv(csv).Select(r => r.Count).Distinct().ToArray(); Assert.Single(widths); Assert.Equal(3, widths[0]);
        if (Environment.GetEnvironmentVariable("CAIWU_DESIGNER_EVIDENCE") is { Length: > 0 } evidence) {
            Directory.CreateDirectory(evidence);
            foreach (var name in new[] { "template.json", "report.html", "report.csv" }) File.Copy(PathFor(name), Path.Combine(evidence, "synthetic-" + name), overwrite: true);
        }
    }
    [Fact]
    public void SaveDoesNotOverwriteWithoutExactLoadedVersion()
    {
        var path = PathFor("template.json"); var t = SyntheticFixture.Template(); var first = TemplateStore.Save(path, t);
        var oldBytes = File.ReadAllBytes(path);
        Assert.Throws<TemplateConflictException>(() => TemplateStore.Save(path, t)); Assert.Equal(oldBytes, File.ReadAllBytes(path));
        Assert.Throws<TemplateConflictException>(() => TemplateStore.Save(path, t, first.Sha256));
        var update = t with { Version = 2, Header = "第二版" }; var second = TemplateStore.Save(path, update, first.Sha256);
        Assert.NotEqual(first.Sha256, second.Sha256);
        Assert.Throws<TemplateConflictException>(() => TemplateStore.Save(path, update with { Version = 3 }, first.Sha256));
        Assert.Equal("第二版", TemplateStore.Load(path).Template.Header);
        Assert.Empty(Directory.EnumerateFiles(directory, "*.tmp"));
    }
    [Fact]
    public void LockedOrInvalidDestinationPreservesExistingContentAndOnlyOwnStageIsCleaned()
    {
        var path = PathFor("locked.json"); var saved = TemplateStore.Save(path, SyntheticFixture.Template()); var bytes = File.ReadAllBytes(path);
        using (var held = new FileStream(path + ".lock", FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            Assert.Throws<IOException>(() => TemplateStore.Save(path, saved.Template with { Version = 2 }, saved.Sha256));
        Assert.Equal(bytes, File.ReadAllBytes(path));
        var badTarget = PathFor("directory.json"); Directory.CreateDirectory(badTarget); File.WriteAllText(Path.Combine(badTarget, "keep.txt"), "keep");
        Assert.Throws<IOException>(() => TemplateStore.Save(badTarget, SyntheticFixture.Template()));
        Assert.Equal("keep", File.ReadAllText(Path.Combine(badTarget, "keep.txt"))); Assert.Empty(Directory.EnumerateFiles(directory, "*.tmp"));
    }
    [Fact]
    public async Task ConcurrentIndependentSavesHaveOnlyOneWinner()
    {
        var path = PathFor("race.json"); var t = SyntheticFixture.Template(); var ready = new Barrier(2);
        async Task<bool> Save(string header) => await Task.Run(() => {
            ready.SignalAndWait(TimeSpan.FromSeconds(10));
            try { TemplateStore.Save(path, t with { Header = header }); return true; } catch (IOException) { return false; }
        });
        var results = await Task.WhenAll(Save("A"), Save("B"));
        Assert.Single(results, x => x); Assert.Contains(TemplateStore.Load(path).Template.Header, new[] { "A", "B" });
        Assert.Empty(Directory.EnumerateFiles(directory, "*.tmp"));
    }
    [Fact]
    public void SchemaUnknownMembersDuplicatePropertiesAndBadFormulasRejected()
    {
        var path = PathFor("bad.json");
        File.WriteAllText(path, "{broken}"); Assert.Throws<InvalidDataException>(() => TemplateStore.Load(path));
        var saved = TemplateStore.Save(PathFor("valid.json"), SyntheticFixture.Template());
        var json = File.ReadAllText(PathFor("valid.json"));
        File.WriteAllText(path, json.Replace("\"SchemaVersion\": 1", "\"SchemaVersion\": 2")); Assert.Throws<DesignValidationException>(() => TemplateStore.Load(path));
        File.WriteAllText(path, json.Replace("\"SchemaVersion\": 1", "\"SchemaVersion\": 1, \"Surprise\": 1")); Assert.Throws<InvalidDataException>(() => TemplateStore.Load(path));
        File.WriteAllText(path, json.Replace("\"SchemaVersion\": 1", "\"SchemaVersion\": 1, \"SchemaVersion\": 1")); Assert.Throws<InvalidDataException>(() => TemplateStore.Load(path));
        File.WriteAllText(path, json.Replace("\"SchemaVersion\": 1,", "")); Assert.Throws<InvalidDataException>(() => TemplateStore.Load(path));
        Assert.Throws<DesignValidationException>(() => TemplateStore.Save(PathFor("formula.json"), saved.Template with { Columns = [new("x", "X", "eval(1)")] }));
        Assert.Throws<DesignValidationException>(() => TemplateStore.Save(PathFor("cycle.json"), saved.Template with { Columns = [new("x", "X", "[y]"), new("y", "Y", "[x]")] }));
    }
    [Fact]
    public void TruncatedPreviewCannotExportAndCannotHideWarnings()
    {
        var input = SyntheticFixture.Input(); var t = SyntheticFixture.Template() with { Header = "", Title = "完整报表" };
        var preview = ReportDesignerEngine.Preview(input, t, 1);
        Assert.True(preview.IsLimited); Assert.Contains("1/3", string.Join('\n', preview.Warnings));
        Assert.Throws<DesignValidationException>(() => ReportDesignerExport.ToCsv(preview));
        Assert.Throws<DesignValidationException>(() => ReportDesignerExport.ToHtml(preview));
        Assert.Throws<DesignValidationException>(() => ReportDesignerExport.ExportNewFile(preview, PathFor("limited.csv"), false));
        Assert.False(File.Exists(PathFor("limited.csv")));
    }
    [Fact]
    public void HtmlAndCsvEncodeTitlesHeadersCellsAndGroupsWithReportingPolicy()
    {
        var attack = " \u200B=HYPERLINK(\"https://evil.invalid\")\r\n<script>alert(1)</script>";
        var t = SyntheticFixture.Template() with { Title = attack, Header = attack, SubtotalBy = "accountName",
            Columns = [new("name", attack, "[accountName]"), new("amount", "净额", "[periodDebit]-[periodCredit]", Total: true)] };
        var p = ReportDesignerEngine.Preview(SyntheticFixture.Input(), t);
        var html = ReportDesignerExport.ToHtml(p); var csv = ReportDesignerExport.ToCsv(p);
        Assert.DoesNotContain("<script>", html); Assert.Contains("&lt;script&gt;", html); Assert.Contains("default-src 'none'", html);
        Assert.Contains("\"' \u200B=HYPERLINK", csv); Assert.Contains("\"\"https://evil.invalid\"\"", csv);
        Assert.Contains("来源缺失/限制", html); Assert.Contains("小计：", html);
        Assert.All(ParseCsv(csv), row => Assert.Equal(2, row.Count));
    }
    [Fact]
    public void SingleVisibleColumnCsvRemainsRectangularAndNoClobberExport()
    {
        var t = SyntheticFixture.Template() with { Columns = [new("name", "名称", "[accountName]")] };
        var p = ReportDesignerEngine.Preview(SyntheticFixture.Input(), t);
        Assert.All(ParseCsv(ReportDesignerExport.ToCsv(p)), row => Assert.Equal(2, row.Count));
        var path = PathFor("existing.csv"); File.WriteAllText(path, "keep");
        Assert.Throws<IOException>(() => ReportDesignerExport.ExportNewFile(p, path, false)); Assert.Equal("keep", File.ReadAllText(path));
        Assert.Empty(Directory.EnumerateFiles(directory, "*.tmp"));
    }
    [Fact]
    public void LayoutOrientationPageCountsAndWidthsAreDeterministic()
    {
        var t = SyntheticFixture.Template() with { RowsPerPage = 2, Orientation = PageOrientation.Portrait, Columns = [new("calc", "数值", "1", 1000, Total: true)] };
        var p = ReportDesignerEngine.Preview(SyntheticFixture.Input(), t);
        var layout = ReportDesignerExport.Layout(p); Assert.Equal(2, layout.LogicalPages); Assert.Equal(703m, layout.PrintableWidth); Assert.Equal(.703m, layout.Scale);
        var html = ReportDesignerExport.ToHtml(p); Assert.Equal(2, Count(html, "<section class=\"page\">")); Assert.Equal(2, Count(html, "SnapshotId=")); Assert.Contains("size:A4 portrait", html);
        Assert.Throws<DesignValidationException>(() => ReportDesignerEngine.Preview(SyntheticFixture.Input(), t with { RowsPerPage = 0 }));
        Assert.Throws<DesignValidationException>(() => ReportDesignerEngine.Preview(SyntheticFixture.Input(), t with { Columns = [new("calc", "数值", "1", 0)] }));
        var landscape = ReportDesignerExport.Layout(ReportDesignerEngine.Preview(SyntheticFixture.Input(), t with { Orientation = PageOrientation.Landscape })); Assert.Equal(1032, landscape.PrintableWidth); Assert.Equal(1m, landscape.Scale);
    }
    [Fact]
    public void GroupSubtotalsDoNotDoubleCountParentRowsAndTotalMatches()
    {
        var p = ReportDesignerEngine.Preview(SyntheticFixture.Input(2), SyntheticFixture.Template() with { SubtotalBy = "accountName" });
        var groups = p.Rows.Where(r => r.Kind == "subtotal").ToArray(); Assert.Equal(3, groups.Length);
        Assert.Equal(0m, groups.Single(r=>r.Label.Contains("父科目")).Cells[1].Number);
        Assert.Equal(180.2m, groups.Single(r=>r.Label.Contains("甲组")).Cells[1].Number);
        Assert.Equal(20.2m, groups.Single(r=>r.Label.Contains("乙组")).Cells[1].Number);
        Assert.Equal(200.4m, p.Rows[^1].Cells[1].Number);
    }
    [Fact]
    public void WritersRemainOpenAndIoFailuresPropagate()
    {
        var p = ReportDesignerEngine.Preview(SyntheticFixture.Input(), SyntheticFixture.Template());
        using var writer = new StringWriter(); ReportDesignerExport.WriteCsv(p, writer); writer.Write("still-open"); Assert.EndsWith("still-open", writer.ToString());
        Assert.Throws<IOException>(() => ReportDesignerExport.WriteHtml(p, new FailingWriter()));
    }
    private sealed class FailingWriter : StringWriter { public override void Write(string? value) => throw new IOException("synthetic failure"); }
    private static int Count(string source, string part) => (source.Length - source.Replace(part, "", StringComparison.Ordinal).Length) / part.Length;
    private static List<List<string>> ParseCsv(string csv)
    {
        var records = new List<List<string>>(); var row = new List<string>(); var cell = new StringBuilder(); var quoted = false;
        for (var i = 0; i < csv.Length; i++) {
            var c = csv[i];
            if (c == '"') { if (quoted && i+1 < csv.Length && csv[i+1] == '"') { cell.Append('"'); i++; } else quoted = !quoted; }
            else if (c == ',' && !quoted) { row.Add(cell.ToString()); cell.Clear(); }
            else if (c == '\r' && !quoted && i+1<csv.Length && csv[i+1]=='\n') { row.Add(cell.ToString()); cell.Clear(); records.Add(row); row = []; i++; }
            else cell.Append(c);
        }
        Assert.False(quoted); return records;
    }
}
