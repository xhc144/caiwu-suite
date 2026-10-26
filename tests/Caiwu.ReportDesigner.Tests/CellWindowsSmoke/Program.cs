using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Caiwu.ReportDesigner.Cells;
using Caiwu.ReportDesigner.Wpf.Cells;

internal static class Program
{
    [STAThread] private static int Main(string[] args)
    {
        var exercise = args.Contains("--exercise", StringComparer.Ordinal);
        var output = args.FirstOrDefault(a => a.StartsWith("--out=", StringComparison.Ordinal))?[6..] ?? Path.Combine(Path.GetTempPath(), "caiwu-cell-smoke-" + Guid.NewGuid().ToString("N"));
        output = Path.GetFullPath(output); Directory.CreateDirectory(output);
        var book = Guid.Parse("44444444-5555-6666-7777-888888888888");
        var context = new ReportQueryContext(book, new(2026, 2, 1), new(2026, 2, 28), 1);
        var source = new LedgerReportSource(book, 1, new(2026, 1, 1), new(2026, 2, 28),
            [new("1001", null, 1000, 0), new("3001", null, 0, 1000)],
            [new("SYN-1", new(2026, 2, 4), true, [new("1001", 200, 0), new("3001", 0, 200)])], true);
        var initial = new CellReport { Title = "合成单元格报表", RowCount = 10, ColumnCount = 5,
            Cells = [new("A1", "项目"), new("B1", "金额"), new("A2", "期末余额"), new("B2", "=CLOSING(\"1001\")"),
                new("A3", "本期借方"), new("B3", "=DEBIT(\"1001\")"), new("B4", "=SUM(B2:B3)")],
            Rows = [new(2, .35m)], Columns = [new(1, 24)] };
        var app = new Application(); var control = new CellReportControl(source, () => context, output, initial);
        var window = new Window { Title = "报表定义 — 合成 fixture", Width = 1120, Height = 760, Content = control };
        var exit = 0; var complete = false;
        window.Closing += (_, e) => { if (!complete && !control.CanClose()) e.Cancel = true; };
        if (exercise) window.ContentRendered += (_, _) => window.Dispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle, new Action(() => {
            try {
                var grid = Descendants<DataGrid>(control).Single();
                grid.CurrentCell = new DataGridCellInfo(grid.Items[1], grid.Columns[1]); grid.ScrollIntoView(grid.Items[1], grid.Columns[1]); grid.UpdateLayout();
                if (!grid.BeginEdit()) throw new InvalidOperationException("DataGrid BeginEdit failed.");
                var editor = Descendants<TextBox>(grid).Single(t => t.IsVisible);
                editor.Text = "=CLOSING(\"1001\")+5"; editor.GetBindingExpression(TextBox.TextProperty)?.UpdateSource();
                grid.CommitEdit(DataGridEditingUnit.Cell, true); grid.CommitEdit(DataGridEditingUnit.Row, true);
                Descendants<Button>(control).Single(b => Equals(b.Content, "生成")).RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
                if (control.CurrentResult?["B2"].Number != 1205m || control.CurrentResult?["B4"].Number != 1405m) throw new InvalidOperationException("Rendered grid edit/generate result mismatch.");
                var path = Path.Combine(output, "synthetic.cells.json"); control.SaveTo(path); control.OpenFrom(path); control.Generate();
                if (control.CurrentResult?["B2"].Number != 1205m || control.HasUnsavedChanges) throw new InvalidOperationException("Save/reopen result mismatch.");
                CellReportExport.WriteHtml(Path.Combine(output, "synthetic.html"), control.CurrentResult!);
                CellReportExport.WriteCsv(Path.Combine(output, "synthetic.csv"), control.CurrentResult!);
                window.UpdateLayout(); var dpi = VisualTreeHelper.GetDpi(window); var image = new RenderTargetBitmap((int)(window.ActualWidth * dpi.DpiScaleX), (int)(window.ActualHeight * dpi.DpiScaleY), dpi.PixelsPerInchX, dpi.PixelsPerInchY, PixelFormats.Pbgra32); image.Render(window);
                var png = new PngBitmapEncoder(); png.Frames.Add(BitmapFrame.Create(image)); using (var stream = File.Create(Path.Combine(output, "synthetic.png"))) png.Save(stream);
                File.WriteAllText(Path.Combine(output, "result.txt"), "SYNTHETIC Windows WPF grid edit/generate/save/reopen/export passed. Original program/real-book acceptance remains not-tested.\n" + CellReportExport.Audit(control.CurrentResult!));
            } catch (Exception ex) { exit = 1; File.WriteAllText(Path.Combine(output, "failure.txt"), ex.ToString()); }
            finally { complete = true; window.Close(); }
        }));
        app.Run(window); return exit;
    }
    private static IEnumerable<T> Descendants<T>(DependencyObject root) where T : DependencyObject
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++) { var child = VisualTreeHelper.GetChild(root, i); if (child is T item) yield return item; foreach (var descendant in Descendants<T>(child)) yield return descendant; }
    }
}
