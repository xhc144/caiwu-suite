using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Data;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Caiwu.ReportDesigner;
using Caiwu.ReportDesigner.Tests;
using Caiwu.ReportDesigner.Wpf;
using Microsoft.Win32;

internal static class Program
{
    private static readonly List<string> completed = [];
    [STAThread]
    public static int Main(string[] args)
    {
        var interactive = args.Contains("--interactive", StringComparer.Ordinal);
        var output = Path.GetFullPath(args.FirstOrDefault(x => !x.StartsWith("--", StringComparison.Ordinal)) ?? Path.Combine(Path.GetTempPath(), "caiwu-designer-smoke-" + Guid.NewGuid().ToString("N")));
        Directory.CreateDirectory(output);
        var app = new Application();
        app.Resources.MergedDictionaries.Add(new ResourceDictionary { Source = new Uri("pack://application:,,,/PresentationFramework.Fluent;component/Themes/Fluent.xaml", UriKind.Absolute) });
        var current = true; var counter = 0;
        var templatePath = Path.Combine(output, "synthetic-template.json");
        var control = new ReportDesignerControl(SyntheticFixture.Input(), new(
            _ => current,
            purpose => interactive ? PickTemplate(purpose) : templatePath,
            html => interactive ? PickExport(html) : Path.Combine(output, $"report-{++counter}" + (html ? ".html" : ".csv"))), SyntheticFixture.Template());
        var window = new Window { Title = "合成账表 · ReportDesigner Windows smoke", Width = 1400, Height = 940, Content = control };
        if (interactive) { app.Run(window); return 0; }
        var code = 1;
        using var watchdog = new System.Threading.Timer(_ => Environment.Exit(124), null, TimeSpan.FromSeconds(75), Timeout.InfiniteTimeSpan);
        window.ContentRendered += async (_, _) => {
            try {
                await Pump();
                Check(control.CurrentPreview!.Rows[^1].Cells[1].Number == 100.2m, "initial independent total100.20");
                var grid = (DataGrid)control.FindName("ColumnEditor");
                EditCell(grid, 1, 2, "SUM([periodDebit],-[periodCredit],0.2)");
                Check(control.CurrentPreview is null && !Button(control, "HtmlButton").IsEnabled, "real DataGrid formula edit invalidates old preview/export");
                EditCell(grid, 1, 1, "修改后净额"); EditCell(grid, 1, 3, "220");
                ((TextBox)control.FindName("HeaderEditor")).Text = "Windows实际WPF修改页眉 <b>纯文本</b>";
                Click(control, "PreviewButton");
                Check(control.CurrentPreview!.Rows[^1].Cells[1].Number == 100.6m, "edited formula independently totals100.60");
                Click(control, "SaveButton"); Check(File.Exists(templatePath), "save actual validated JSON");
                EditCell(grid, 1, 2, "0"); Click(control, "PreviewButton");
                Check(control.CurrentPreview!.Rows[^1].Cells[1].Number == 0, "second edit visible before readback");
                Click(control, "LoadButton");
                Check(control.CurrentPreview!.Rows[^1].Cells[1].Number == 100.6m, "load restores saved formula and re-previews");
                Check(control.Columns[1].Width == "220", "column width roundtrip");
                Click(control, "HtmlButton"); Click(control, "CsvButton");
                Check(File.ReadAllText(Path.Combine(output, "report-1.html")).Contains("100.60", StringComparison.Ordinal), "HTML exports reloaded actual result");
                Check(File.ReadAllText(Path.Combine(output, "report-2.csv")).Contains("100.6", StringComparison.Ordinal), "CSV exports reloaded actual result");
                var loaded = TemplateStore.Load(templatePath);
                TemplateStore.Save(templatePath, loaded.Template with { Version = 2, Header = "另一窗口" }, loaded.Sha256);
                Click(control, "SaveButton");
                Check(((TextBlock)control.FindName("StatusText")).Text.Contains("其他窗口", StringComparison.Ordinal), "stale template save conflict stays in window");
                Check(control.Columns[1].Expression.Contains("0.2", StringComparison.Ordinal), "conflict retains user edit");
                Click(control, "LoadButton");
                EditCell(grid, 1, 2, "[periodDebit]/0"); Click(control, "PreviewButton");
                Check(control.CurrentPreview is null && ((TextBlock)control.FindName("StatusText")).Text.Contains("数据行", StringComparison.Ordinal), "division error is located and no stale preview remains");
                Click(control, "LoadButton");
                var preview = control.CurrentPreview!;
                var document = ReportDesignerPrinter.CreateDocument(preview, 1056, 720);
                var paginator = ((System.Windows.Documents.IDocumentPaginatorSource)document).DocumentPaginator; paginator.ComputePageCount();
                Check(paginator.PageCount > 0, "actual WPF print paginator creates pages; no printer/PDF submission claimed");
                await Pump(); window.UpdateLayout();
                var bitmap = new RenderTargetBitmap((int)Math.Ceiling(window.ActualWidth), (int)Math.Ceiling(window.ActualHeight), 96, 96, PixelFormats.Pbgra32);
                bitmap.Render(window); var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap));
                using (var stream = File.Create(Path.Combine(output, "wpf-render.png"))) encoder.Save(stream);
                current = false; Click(control, "PreviewButton");
                Check(control.CurrentPreview is null && ((TextBlock)control.FindName("StatusText")).Text.Contains("失效", StringComparison.Ordinal), "stale host session refuses preview");
                code = 0;
            } catch (Exception ex) { File.WriteAllText(Path.Combine(output, "failure.txt"), ex.ToString()); }
            finally {
                var pngPath = Path.Combine(output, "wpf-render.png");
                File.WriteAllText(Path.Combine(output, "smoke.json"), JsonSerializer.Serialize(new {
                    Passed = code == 0, Completed = completed, Environment.OSVersion,
                    Framework = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
                    RenderSha256 = File.Exists(pngPath) ? Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(pngPath))) : null,
                    Printed = false, PdfTested = false, PhysicalKeyboardTested = false
                }, new JsonSerializerOptions { WriteIndented = true }));
                window.Close(); app.Shutdown(code);
            }
        };
        app.Run(window); return code;
    }
    private static Button Button(ReportDesignerControl c, string name) => (Button)c.FindName(name);
    private static void Click(ReportDesignerControl c, string name) => Button(c, name).RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent));
    private static void Check(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); completed.Add(message); }
    private static async Task Pump() => await Dispatcher.Yield(DispatcherPriority.ApplicationIdle);
    private static void EditCell(DataGrid grid, int row, int column, string text)
    {
        grid.SelectedItem = grid.Items[row]; grid.ScrollIntoView(grid.Items[row], grid.Columns[column]); grid.UpdateLayout();
        grid.CurrentCell = new DataGridCellInfo(grid.Items[row], grid.Columns[column]);
        if (!grid.BeginEdit()) throw new InvalidOperationException("DataGrid BeginEdit failed.");
        grid.UpdateLayout();
        var content = grid.Columns[column].GetCellContent(grid.Items[row]);
        var editor = content as TextBox ?? FindChild<TextBox>(content);
        if (editor is null) throw new InvalidOperationException("Actual DataGrid text editor not found.");
        editor.Focus(); editor.Text = text; editor.GetBindingExpression(TextBox.TextProperty)?.UpdateSource();
        if (!grid.CommitEdit(DataGridEditingUnit.Cell, true) || !grid.CommitEdit(DataGridEditingUnit.Row, true)) throw new InvalidOperationException("DataGrid commit failed.");
        grid.UpdateLayout();
    }
    private static T? FindChild<T>(DependencyObject? root) where T : DependencyObject
    {
        if (root is null) return null;
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++) { var child = VisualTreeHelper.GetChild(root, i); if (child is T found) return found; if (FindChild<T>(child) is { } nested) return nested; }
        return null;
    }
    private static string? PickTemplate(TemplatePathPurpose purpose)
    {
        if (purpose == TemplatePathPurpose.Load) { var open = new OpenFileDialog { Filter = "模板 JSON|*.json" }; return open.ShowDialog() == true ? open.FileName : null; }
        var save = new SaveFileDialog { Filter = "模板 JSON|*.json", FileName = "report-template.json", OverwritePrompt = true };
        return save.ShowDialog() == true ? save.FileName : null;
    }
    private static string? PickExport(bool html) { var save = new SaveFileDialog { Filter = html ? "HTML|*.html" : "CSV|*.csv", OverwritePrompt = true }; return save.ShowDialog() == true ? save.FileName : null; }
}
