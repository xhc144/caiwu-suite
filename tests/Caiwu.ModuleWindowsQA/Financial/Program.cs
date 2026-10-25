using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace Caiwu.ModuleWindowsQA.Financial;

internal static partial class Program
{
    private static string output = "";
    private static readonly List<object> cases = [];
    private static List<string> checks = [];
    private static readonly List<object> captures = [];
    private static readonly StringWriter bindingErrors = new();
    private static string currentCase = "startup";
    private static int failures;
    private static readonly DateTimeOffset Clock = new(2026, 10, 25, 10, 0, 0, TimeSpan.Zero);

    [STAThread]
    private static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false); Console.Error.WriteLine("Financial component QA: actual Windows, synthetic data only.");
        output = Path.GetFullPath(args.Single()); Directory.CreateDirectory(output);
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Actual Windows required.");
        PresentationTraceSources.DataBindingSource.Listeners.Add(new TextWriterTraceListener(bindingErrors));
        PresentationTraceSources.DataBindingSource.Switch.Level = SourceLevels.Error;
        using var watchdog = new System.Threading.Timer(_ => {
            File.WriteAllText(Path.Combine(output, "timeout.txt"), "Single-process 180 second deadline exceeded. No pass inferred.");
            Environment.Exit(124);
        }, null, TimeSpan.FromSeconds(180), Timeout.InfiniteTimeSpan);
        try
        {
            using var desktop = new NativeDesktop();
            var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            // Exact production resource dictionary; no production login, main window, or anonymous identity bypass.
            app.Resources.MergedDictionaries.Add(new ResourceDictionary {
                Source = new Uri("pack://application:,,,/Caiwu.Desktop;component/Themes/Modern.xaml")
            });
            app.Dispatcher.BeginInvoke(new Action(async () => {
                await RunCase("costing", Costing);
                await RunCase("nonprofit", Nonprofit);
                await RunCase("designer", Designer);
                if (!string.IsNullOrWhiteSpace(bindingErrors.ToString())) failures++;
                WriteResults(); app.Shutdown(failures == 0 ? 0 : 1);
            }));
            return app.Run();
        }
        catch (Exception ex)
        {
            failures++; cases.Add(new { name = currentCase, passed = false, error = ex.ToString(), checks });
            WriteResults(); Console.Error.WriteLine(ex); return 1;
        }
    }
    private static async Task RunCase(string name, Func<Task> action)
    {
        currentCase = name; checks = []; var previousBindings = bindingErrors.ToString();
        try
        {
            await action();
            Check(bindingErrors.ToString() == previousBindings, "no WPF binding errors in this component");
            cases.Add(new { name, passed = true, checks = checks.ToArray() });
        }
        catch (Exception ex)
        {
            failures++; Console.Error.WriteLine(name + ": " + ex);
            foreach (var window in Application.Current.Windows.OfType<Window>().ToArray())
                try { await Capture(window, name + "-failure.png"); } catch (Exception capture) { Console.Error.WriteLine(capture); }
            cases.Add(new { name, passed = false, error = ex.ToString(), checks = checks.ToArray() });
        }
        finally
        {
            foreach (var window in Application.Current.Windows.OfType<Window>().ToArray()) window.Close();
            WriteResults();
        }
    }
    private static void WriteResults() => File.WriteAllText(Path.Combine(output, "financial-results.json"), JsonSerializer.Serialize(new {
        sourceSha = Environment.GetEnvironmentVariable("CAIWU_QA_SHA"), syntheticDataOnly = true,
        actualWindows = OperatingSystem.IsWindows(), passed = failures == 0 && cases.Count == 3,
        framework = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
        cases, captures, bindingErrors = bindingErrors.ToString(),
        host = "Independent explicit synthetic component host. Production MainWindow/login/session integration not exercised.",
        inputMechanism = "Actual WPF DataGrid editors and routed button events; verified native SendInput Unicode for ordinary Chinese text; native file dialogs via UIAutomation.",
        notCovered = new[] { "physical keyboard", "IME composition", "printer submission", "PDF output", "production Desktop integration", "installation/update/account-set retention" }
    }, new JsonSerializerOptions { WriteIndented = true }));
    private static void Check(bool condition, string label)
    {
        if (!condition) throw new InvalidOperationException(label);
        checks.Add(label); Console.WriteLine(currentCase + " PASS " + label);
        File.WriteAllText(Path.Combine(output, "financial-progress.json"), JsonSerializer.Serialize(new {
            sourceSha = Environment.GetEnvironmentVariable("CAIWU_QA_SHA"), currentCase, completedChecks = checks, completedCases = cases.Count,
            finished = false, passed = false
        }, new JsonSerializerOptions { WriteIndented = true }));
    }
    private static async Task<Window> Show(FrameworkElement content, string title)
    {
        var window = new Window { Title = "合成金融组件验收 · " + title, Content = content, Width = 1500, Height = 950, WindowState = WindowState.Maximized };
        window.Show(); window.Activate(); await Settle();
        Check(window.Style == Application.Current.TryFindResource(typeof(Window)), "inherits exact modern Window style");
        Check(window.FontFamily.Source.Contains("YaHei", StringComparison.Ordinal), "inherits Chinese font family");
        Check((window.Foreground as SolidColorBrush)?.Color == (Application.Current.FindResource("AppInk") as SolidColorBrush)?.Color, "inherits modern foreground brush");
        var firstButton = Visuals<Button>(content).First(b => b.Content is string);
        Check(firstButton.Style == Application.Current.TryFindResource(typeof(Button)), "inherits exact modern Button template");
        return window;
    }
    private static async Task Settle() { await Dispatcher.Yield(DispatcherPriority.ApplicationIdle); await Task.Delay(180); }
    private static IEnumerable<T> Visuals<T>(DependencyObject root) where T : DependencyObject
    {
        if (root is T found) yield return found;
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++)
            foreach (var child in Visuals<T>(VisualTreeHelper.GetChild(root, i))) yield return child;
    }
    private static void Click(DependencyObject root, string caption) => Visuals<Button>(root).Single(b => Equals(b.Content, caption)).RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
    private static void ClickName(FrameworkElement root, string name) => ((Button)root.FindName(name)).RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
    private static void Tab(DependencyObject root, string header)
    {
        var tabs = Visuals<TabControl>(root).First(); tabs.SelectedItem = tabs.Items.OfType<TabItem>().Single(t => Equals(t.Header, header)); tabs.UpdateLayout();
    }
    private static TextBox BeginTextEdit(DataGrid grid, object row, int column)
    {
        grid.SelectedItem = row; grid.ScrollIntoView(row, grid.Columns[column]); grid.UpdateLayout(); grid.Focus();
        grid.CurrentCell = new(row, grid.Columns[column]);
        Check(grid.BeginEdit(), "actual DataGrid begins edit: " + grid.Columns[column].Header); grid.UpdateLayout();
        return Visuals<TextBox>(grid.Columns[column].GetCellContent(row)).First();
    }
    private static void Commit(DataGrid grid)
    {
        Check(grid.CommitEdit(DataGridEditingUnit.Cell, true) && grid.CommitEdit(DataGridEditingUnit.Row, true), "actual DataGrid commits cell and row"); grid.UpdateLayout();
    }
    private static void Edit(DataGrid grid, object row, int column, string value)
    {
        var box = BeginTextEdit(grid, row, column); box.Text = value;
        box.GetBindingExpression(TextBox.TextProperty)?.UpdateSource(); Commit(grid);
    }
    private static void Choice(DataGrid grid, object row, int column, object value)
    {
        grid.SelectedItem = row; grid.ScrollIntoView(row, grid.Columns[column]); grid.UpdateLayout(); grid.Focus(); grid.CurrentCell = new(row, grid.Columns[column]);
        Check(grid.BeginEdit(), "actual enum editor begins edit"); grid.UpdateLayout();
        var box = Visuals<ComboBox>(grid.Columns[column].GetCellContent(row)).First(); box.SelectedValue = value; Commit(grid);
    }
    private static void RightAligned(DataGrid grid, int column)
    {
        grid.ScrollIntoView(grid.Items[0], grid.Columns[column]); grid.UpdateLayout();
        var text = Visuals<TextBlock>(grid.Columns[column].GetCellContent(grid.Items[0])).First();
        Check(text.TextAlignment == TextAlignment.Right, "rendered amount column right aligned: " + grid.Columns[column].Header);
    }
    private static string Hash(string path) => Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(path)));
    private static Dictionary<string, string> Files(string directory) => Directory.GetFiles(directory, "*", SearchOption.AllDirectories).ToDictionary(p => Path.GetRelativePath(directory, p), Hash);
    private static void SameFiles(Dictionary<string, string> before, string directory, string label)
    {
        var after = Files(directory); Check(before.Count == after.Count && before.All(p => after.GetValueOrDefault(p.Key) == p.Value), label);
    }
}
