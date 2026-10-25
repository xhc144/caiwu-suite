using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using Caiwu.Costing;
using Caiwu.Costing.Wpf;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        var app = new Application();
        var bookId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        var page = new CostWorksheetPage(bookId, new(2026, 10, 1));
        var window = new Window { Title = "合成成本工作表验收", Content = page, Width = 1400, Height = 900 };
        if (args.Contains("--interactive")) return app.Run(window);
        var exitCode = 1;
        var bindingErrors = new StringWriter();
        PresentationTraceSources.DataBindingSource.Listeners.Add(new TextWriterTraceListener(bindingErrors));
        PresentationTraceSources.DataBindingSource.Switch.Level = SourceLevels.Error;
        window.Loaded += (_, _) => window.Dispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle, new Action(() =>
        {
            try
            {
                Click("载入合成样例"); Click("计算 / 复算");
                Check(page.Editor.Result?.FinishedCost == 250m, "initial hand-calculated total250");
                var grid = Descendants(page).OfType<DataGrid>().Single(g => AutomationProperties.GetAutomationId(g) == "Stages");
                grid.ScrollIntoView(grid.Items[0]); grid.UpdateLayout();
                var column = grid.Columns.Single(c => Equals(c.Header, "人工费用池（元）"));
                grid.Focus(); grid.SelectedItem = grid.Items[0];
                grid.CurrentCell = new DataGridCellInfo(grid.Items[0], column);
                Check(grid.BeginEdit(), "begin actual DataGrid edit"); grid.UpdateLayout();
                var editor = column.GetCellContent(grid.Items[0]) as TextBox;
                Check(editor is not null, "DataGrid text editor exists");
                editor!.Text = "84.00";
                editor.GetBindingExpression(TextBox.TextProperty)!.UpdateSource();
                Check(!page.Editor.CanExport && page.Editor.VoucherRows.Count == 0, "edit invalidates suggestions");
                Click("计算 / 复算");
                Check(page.Editor.Result?.FinishedCost == 254m, "recalculated hand total254");
                var directory = Path.Combine(Path.GetTempPath(), "caiwu-costing-wpf-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(directory);
                var path = Path.Combine(directory, "synthetic-audit.json");
                CostWorksheetExport.SaveNewJson(path, page.Editor.GetCalculatedInput());
                CostWorksheetExport.SaveNewCsv(Path.Combine(directory, "synthetic-details.csv"), page.Editor.GetCalculatedInput());
                Check(CostWorksheetExport.OpenJson(path, bookId).FinishedCost == 254m, "saved JSON recalculates254");
                Check(string.IsNullOrEmpty(bindingErrors.ToString()), "no WPF binding errors: " + bindingErrors);
                Console.WriteLine("PASS: real WPF DataGrid edit, invalidate, recalculate250->254, JSON/CSV export, reopen; synthetic files: " + directory);
                exitCode = 0;
            }
            catch (Exception e) { Console.Error.WriteLine(e); }
            finally { app.Shutdown(exitCode); }
        }));
        app.Run(window); return exitCode;

        void Click(string title) => Descendants(page).OfType<Button>().Single(b => Equals(b.Content, title))
            .RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
    }
    private static void Check(bool value, string label) { if (!value) throw new InvalidOperationException(label); }
    private static IEnumerable<DependencyObject> Descendants(DependencyObject parent)
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++)
        {
            var child = VisualTreeHelper.GetChild(parent, i); yield return child;
            foreach (var descendant in Descendants(child)) yield return descendant;
        }
    }
}
