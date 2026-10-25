using System.IO;
using System.Windows.Controls;
using Caiwu.ReportDesigner;
using Caiwu.ReportDesigner.Tests;
using Caiwu.ReportDesigner.Wpf;

namespace Caiwu.ModuleWindowsQA.Financial;

internal static partial class Program
{
    // Explicit test-only host guards all provenance fields. It does not grant any production identity or ledger access.
    private sealed class SyntheticDesignerHost(ReportInputSnapshot captured, string directory)
    {
        public Guid BookId = captured.Metadata.Book.Id;
        public long Revision = captured.SourceRevision;
        public DateOnly From = captured.Metadata.From, To = captured.Metadata.To;
        public Guid Session = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
        private readonly Guid openingSession = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
        public bool Cancel;
        public Action? DuringExportSelection;
        public string TemplatePath => Path.Combine(directory, "synthetic-template.json");
        public ReportDesignerHost Create() => new(
            input => ReferenceEquals(input, captured) && BookId == input.Metadata.Book.Id && Revision == input.SourceRevision &&
                From == input.Metadata.From && To == input.Metadata.To && Session == openingSession,
            _ => Cancel ? null : TemplatePath,
            html => { DuringExportSelection?.Invoke(); return Cancel ? null : Path.Combine(directory, html ? "synthetic-report.html" : "synthetic-report.csv"); });
    }
    private static async Task Designer()
    {
        var directory = Path.Combine(output, "designer"); Directory.CreateDirectory(directory);
        var input = SyntheticFixture.Input(); var host = new SyntheticDesignerHost(input, directory);
        var control = new ReportDesignerControl(input, host.Create(), SyntheticFixture.Template());
        var window = await Show(control, "报表设计器");
        Check(control.CurrentPreview!.Rows[^1].Cells[1].Number == 100.2m, "independent initial leaf-only total100.20");
        var grid = (DataGrid)control.FindName("ColumnEditor");
        Edit(grid, grid.Items[1], 2, "SUM([periodDebit],-[periodCredit],0.2)");
        Check(control.CurrentPreview is null && !((Button)control.FindName("HtmlButton")).IsEnabled, "real formula cell edit clears stale preview/export");
        Edit(grid, grid.Items[1], 1, "修改后净额"); Edit(grid, grid.Items[1], 3, "220");
        await TypeChinese(window, (TextBox)control.FindName("HeaderEditor"), "合成页眉 中文Az09（） <b>纯文本</b>");
        ClickName(control, "PreviewButton");
        Check(control.CurrentPreview!.Rows[^1].Cells[1].Number == 100.6m, "edited formula independently totals100.60");
        host.Cancel = true; var before = Files(directory); var preview = control.CurrentPreview;
        ClickName(control, "SaveButton"); ClickName(control, "LoadButton"); ClickName(control, "HtmlButton"); ClickName(control, "CsvButton");
        SameFiles(before, directory, "explicit host cancellation of save/load/exports creates no files");
        Check(ReferenceEquals(preview, control.CurrentPreview), "cancelled host path selection retains exact preview"); host.Cancel = false;
        ClickName(control, "SaveButton");
        Check(File.Exists(host.TemplatePath), "actual Save button writes validated template JSON");
        Edit(grid, grid.Items[1], 2, "0"); ClickName(control, "PreviewButton");
        Check(control.CurrentPreview!.Rows[^1].Cells[1].Number == 0, "second actual edit changes visible calculation");
        ClickName(control, "LoadButton");
        Check(control.CurrentPreview!.Rows[^1].Cells[1].Number == 100.6m && control.Columns[1].Width == "220", "actual Load button restores formula and width then re-previews");
        ClickName(control, "HtmlButton"); ClickName(control, "CsvButton");
        Check(File.ReadAllText(Path.Combine(directory, "synthetic-report.html")).Contains("100.60", StringComparison.Ordinal) &&
            File.ReadAllText(Path.Combine(directory, "synthetic-report.csv")).Contains("100.6", StringComparison.Ordinal), "actual HTML/CSV buttons export reloaded values");
        Check(File.ReadAllText(Path.Combine(directory, "synthetic-report.html")).Contains("&lt;b&gt;纯文本&lt;/b&gt;", StringComparison.Ordinal), "HTML encodes user-entered header markup");
        var previewGrid = (DataGrid)control.FindName("PreviewGrid"); RightAligned(previewGrid, 2);
        await Capture(window, "designer-preview.png");
        var htmlHash = Hash(Path.Combine(directory, "synthetic-report.html")); ClickName(control, "HtmlButton");
        Check(Hash(Path.Combine(directory, "synthetic-report.html")) == htmlHash && window.IsVisible && control.CurrentPreview is null, "duplicate export refuses overwrite, stays open and clears stale preview");
        ClickName(control, "LoadButton");
        var loaded = TemplateStore.Load(host.TemplatePath);
        TemplateStore.Save(host.TemplatePath, loaded.Template with { Version = 2, Header = "另一合成窗口" }, loaded.Sha256);
        var hash = Hash(host.TemplatePath); Edit(grid, grid.Items[1], 1, "未保存的中文编辑"); ClickName(control, "SaveButton");
        Check(Hash(host.TemplatePath) == hash && control.Columns[1].Title == "未保存的中文编辑" && ((TextBlock)control.FindName("StatusText")).Text.Contains("其他窗口", StringComparison.Ordinal), "concurrent template save conflict preserves file and user edit in window");
        ClickName(control, "LoadButton"); Edit(grid, grid.Items[1], 2, "[periodDebit]/0"); ClickName(control, "PreviewButton");
        Check(control.CurrentPreview is null && window.IsVisible && !((Button)control.FindName("CsvButton")).IsEnabled &&
            ((TextBlock)control.FindName("StatusText")).Text.Contains("数据行", StringComparison.Ordinal), "division error is located; no pseudo-complete report or stale export");
        await Capture(window, "designer-formula-error.png");
        ClickName(control, "LoadButton"); ((TextBox)control.FindName("LimitEditor")).Text = "1"; ClickName(control, "PreviewButton");
        Check(control.CurrentPreview?.IsLimited == true && !((Button)control.FindName("HtmlButton")).IsEnabled && !((Button)control.FindName("PrintButton")).IsEnabled, "limited preview explicitly disables full export and printing");
        ((TextBox)control.FindName("LimitEditor")).Text = "200"; ClickName(control, "PreviewButton");
        before = Files(directory); host.DuringExportSelection = () => host.Revision++;
        ClickName(control, "CsvButton"); SameFiles(before, directory, "source changed during path selection rejects export without modifying existing files");
        Check(control.CurrentPreview is null && ((TextBlock)control.FindName("StatusText")).Text.Contains("失效", StringComparison.Ordinal), "path-selection source race visibly invalidates old preview");
        host.DuringExportSelection = null; host.Revision = input.SourceRevision;
        foreach (var change in new Action[] { () => host.BookId = Guid.NewGuid(), () => host.To = host.To.AddDays(-1), () => host.Session = Guid.NewGuid() })
        {
            host.BookId = input.Metadata.Book.Id; host.To = input.Metadata.To; host.Session = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
            ClickName(control, "PreviewButton"); change(); before = Files(directory);
            ClickName(control, "SaveButton"); ClickName(control, "PreviewButton");
            Check(control.CurrentPreview is null && window.IsVisible, "changed book/period/session refuses save and preview in same window");
            SameFiles(before, directory, "changed book/period/session leaves saved files unchanged");
        }
        await Capture(window, "designer-stale-session.png");
    }
}
