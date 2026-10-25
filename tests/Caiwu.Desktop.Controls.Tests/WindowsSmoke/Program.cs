using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Caiwu.Contracts;
using Caiwu.Desktop.Controls;

internal static class Program
{
    private static int checks;
    private static readonly List<object> renders = [];
    private static string artifacts = "";
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            artifacts = Path.GetFullPath(args.Length == 0 ? "artifacts/reference-dialogs" : args[0]);
            Directory.CreateDirectory(artifacts);
            var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            var field = new TextBox { Text = "原摘要", Margin = new Thickness(12) };
            var owner = new Window { Title = "Reference dialogs smoke host", Width = 380, Height = 150, Content = field };
            owner.Show(); field.Focus();
            Account[] chart = [A("1002", "银行存款"), A("100201", "基本账户", "1002"), A("100202", "旧账户", "1002", false),
                A("6602", "管理费用"), A("660201", "差旅费 🧾", "6602")];

            var chosen = new AccountPickerDialog(chart, "100201") { Owner = owner };
            var accepted = Drive(chosen, "account-list", window =>
            {
                Find<TextBox>(window, "AccountSearch").Text = "６６０２０１";
                Key(window, System.Windows.Input.Key.Down);
                Check(Find<Button>(window, "ChooseButton").IsEnabled, "search selects an active leaf");
                Key(window, System.Windows.Input.Key.Enter);
            });
            Check(accepted == true && chosen.SelectedAccount?.Code == "660201", "account Enter returns selected account");

            var blocked = new AccountPickerDialog(chart, "100201") { Owner = owner };
            Drive(blocked, "account-blocked", window =>
            {
                Find<TextBox>(window, "AccountSearch").Text = "100202";
                Key(window, System.Windows.Input.Key.Down); Key(window, System.Windows.Input.Key.Enter);
                Check(window.IsVisible && !Find<Button>(window, "ChooseButton").IsEnabled, "disabled leaf cannot close as accepted");
                Capture(window, "account-disabled");
                Find<TextBox>(window, "AccountSearch").Text = "完全无匹配";
                Key(window, System.Windows.Input.Key.Enter);
                Check(window.IsVisible && Find<TextBlock>(window, "SelectionStatus").Text.Contains("没有匹配", StringComparison.Ordinal), "no account results cannot confirm a stale selection");
                Find<TextBox>(window, "AccountSearch").Text = "100201";
                Key(window, System.Windows.Input.Key.Down);
                Check(Find<Button>(window, "ChooseButton").IsEnabled, "account search recovers from no results");
                Key(window, System.Windows.Input.Key.Escape);
            });
            Check(blocked.SelectedAccount is null && chart[1].Code == "100201", "cancel does not mutate original account");

            var tree = new AccountPickerDialog(chart, "100201") { Owner = owner };
            Drive(tree, "account-tree", window =>
            {
                Find<TabControl>(window, "AccountsView").SelectedIndex = 1; window.UpdateLayout();
                var view = Find<TreeView>(window, "AccountTree");
                var leaf = TreeContainer(view, "660201");
                Check(leaf is not null, "tree materializes real child containers");
                leaf!.IsSelected = true;
                Capture(window, "account-tree-selected"); Key(window, System.Windows.Input.Key.Enter);
            });
            Check(tree.SelectedAccount?.Code == "660201", "tree selection returns same account contract");

            var ime = new AccountPickerDialog(chart, "100201") { Owner = owner };
            Drive(ime, "account-composition", window =>
            {
                var search = Find<TextBox>(window, "AccountSearch");
                var composition = new TextComposition(InputManager.Current, search, "中");
                search.RaiseEvent(new TextCompositionEventArgs(Keyboard.PrimaryDevice, composition) { RoutedEvent = TextCompositionManager.PreviewTextInputStartEvent });
                Key(window, System.Windows.Input.Key.Enter);
                Check(window.IsVisible && ime.SelectedAccount is null, "composition Enter does not confirm account");
                search.RaiseEvent(new TextCompositionEventArgs(Keyboard.PrimaryDevice, composition) { RoutedEvent = TextCompositionManager.TextInputEvent, Handled = true });
                Key(window, System.Windows.Input.Key.Enter);
            });
            Check(ime.SelectedAccount?.Code == "100201", "handled composition completion releases Enter guard");

            SummaryLibraryItem[] summaries = [new("a", "收款", "收到销售款"), new("b", "费用", "支付差旅费 🧾"), new("c", "费用", "支付办公费")];
            var summary = new SummaryPickerDialog(summaries) { Owner = owner };
            Drive(summary, "summary-library", window =>
            {
                var categories = Find<ListBox>(window, "SummaryCategories");
                categories.SelectedItem = categories.Items.Cast<ListBoxItem>().Single(i => Equals(i.Tag, "费用"));
                Find<TextBox>(window, "SummarySearch").Text = "差旅";
                Key(window, System.Windows.Input.Key.Down);
                Check(Find<TextBox>(window, "SummaryPreview").Text == "支付差旅费 🧾", "full summary preview retains Unicode");
                var grid = Find<DataGrid>(window, "SummaryList"); grid.UpdateLayout();
                var row = grid.ItemContainerGenerator.ContainerFromItem(grid.SelectedItem) as DataGridRow;
                Check(row is not null, "summary double-click targets a real data row");
                grid.RaiseEvent(new MouseButtonEventArgs(Mouse.PrimaryDevice, Environment.TickCount, MouseButton.Left)
                    { RoutedEvent = Control.MouseDoubleClickEvent, Source = row });
            });
            Check(summary.SelectedSummary?.Id == "b", "summary category and search return injected item");

            var cancelledSummary = new SummaryPickerDialog(summaries, "b") { Owner = owner };
            Drive(cancelledSummary, "summary-cancel", w =>
            {
                Find<TextBox>(w, "SummarySearch").Text = "完全无匹配"; Key(w, System.Windows.Input.Key.Enter);
                Check(w.IsVisible && Find<TextBox>(w, "SummaryPreview").Text.Length == 0 &&
                    Find<TextBlock>(w, "SelectionStatus").Text.Contains("没有匹配", StringComparison.Ordinal), "no summary results clear stale preview and cannot confirm");
                Find<TextBox>(w, "SummarySearch").Text = "办公"; Key(w, System.Windows.Input.Key.Down);
                Check(Find<TextBox>(w, "SummaryPreview").Text == "支付办公费", "summary search recovers from no results");
                Key(w, System.Windows.Input.Key.Escape);
            });
            Check(cancelledSummary.SelectedSummary is null && field.Text == "原摘要", "summary cancellation preserves existing host text");

            foreach (var empty in new Window[] { new AccountPickerDialog([]) { Owner = owner }, new SummaryPickerDialog([]) { Owner = owner } })
                Drive(empty, empty is AccountPickerDialog ? "empty-accounts" : "empty-summaries", w =>
                {
                    Check(!Find<Button>(w, "ChooseButton").IsEnabled, "empty source has disabled confirmation");
                    Check(Find<TextBlock>(w, "SelectionStatus").Text.Contains("暂无", StringComparison.Ordinal), "empty source displays meaningful state");
                    Key(w, System.Windows.Input.Key.Escape);
                });

            var malformed = new AccountPickerDialog([A("dup", "甲"), A("dup", "乙")]) { Owner = owner };
            Drive(malformed, "invalid-chart", w =>
            {
                Check(!Find<Button>(w, "ChooseButton").IsEnabled && Find<TextBlock>(w, "SelectionStatus").Text.Contains("重复", StringComparison.Ordinal), "invalid chart is a visible error, not a selectable list");
                Key(w, System.Windows.Input.Key.Escape);
            });

            foreach (var (account, accept) in new[] { (true, true), (true, false), (false, true), (false, false) })
                HelperFocusCase(app, owner, field, chart, summaries, account, accept);
            owner.Close(); app.Shutdown();
            File.WriteAllText(Path.Combine(artifacts, "smoke.json"), JsonSerializer.Serialize(new { passed = checks, renders, platform = Environment.OSVersion.ToString() }, new JsonSerializerOptions { WriteIndented = true }));
            Console.WriteLine($"WPF dialog smoke passed: {checks}; artifacts: {artifacts}");
            return 0;
        }
        catch (Exception ex) { Console.Error.WriteLine(ex); return 1; }
    }
    private static Account A(string code, string name, string? parent = null, bool active = true) => new(code, name, parent, BalanceDirection.Debit, active, 0, 0);
    private static void Check(bool condition, string label) { if (!condition) throw new InvalidOperationException(label); checks++; Console.WriteLine("PASS " + label); }
    private static T Find<T>(Window window, string name) where T : FrameworkElement => window.FindName(name) as T ?? throw new InvalidOperationException("Missing control: " + name);
    private static bool? Drive(Window window, string screenshot, Action<Window> action)
    {
        Exception? error = null;
        var timeout = new DispatcherTimer { Interval = TimeSpan.FromSeconds(15) };
        timeout.Tick += (_, _) => { error = new TimeoutException("Modal smoke timed out."); window.DialogResult = false; };
        window.Loaded += (_, _) => window.Dispatcher.BeginInvoke(DispatcherPriority.ContextIdle, new Action(() =>
        {
            try { Check(window.IsLoaded && PresentationSource.FromVisual(window) is not null, "real WPF window loaded"); Capture(window, screenshot); action(window); }
            catch (Exception ex) { error = ex; if (window.IsVisible) window.DialogResult = false; }
        }));
        timeout.Start(); var result = window.ShowDialog(); timeout.Stop();
        if (error is not null) throw new InvalidOperationException("Smoke failed: " + screenshot, error);
        return result;
    }
    private static void Key(Window window, Key key) => window.RaiseEvent(new KeyEventArgs(Keyboard.PrimaryDevice,
        PresentationSource.FromVisual(window), Environment.TickCount, key) { RoutedEvent = Keyboard.PreviewKeyDownEvent });
    private static void HelperFocusCase(Application app, Window owner, TextBox field, Account[] chart,
        SummaryLibraryItem[] summaries, bool account, bool accept)
    {
        field.Focus();
        var originalText = field.Text;
        var label = (account ? "account" : "summary") + (accept ? "-accept" : "-cancel");
        Window? Modal() => app.Windows.OfType<Window>().SingleOrDefault(w => w.IsVisible && w.IsLoaded &&
            (account ? w is AccountPickerDialog : w is SummaryPickerDialog));
        Exception? error = null;
        var driver = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(50) };
        var deadline = new DispatcherTimer { Interval = TimeSpan.FromSeconds(15) };
        driver.Tick += (_, _) =>
        {
            if (Modal() is not { } modal) return;
            driver.Stop();
            try
            {
                Capture(modal, "helper-" + label);
                var first = Find<Button>(modal, accept ? "ChooseButton" : "CancelButton");
                var opposite = Find<Button>(modal, accept ? "CancelButton" : "ChooseButton");
                first.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
                // Exercise queued duplicate and opposite commands after closing began. The first decision must win.
                first.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
                opposite.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
            }
            catch (Exception ex) { error = ex; if (modal.IsVisible) modal.Close(); }
        };
        deadline.Tick += (_, _) => { error = new TimeoutException("Helper modal timed out: " + label); Modal()?.Close(); };
        driver.Start(); deadline.Start();
        try
        {
            if (account)
            {
                var result = SelectionDialogs.PickAccount(owner, chart, "100201", field);
                if (error is not null) throw new InvalidOperationException(label, error);
                Check(result.Accepted == accept && result.Value?.Code == (accept ? "100201" : null), label + " keeps first modal decision");
            }
            else
            {
                var result = SelectionDialogs.PickSummary(owner, summaries, "b", field);
                if (error is not null) throw new InvalidOperationException(label, error);
                Check(result.Accepted == accept && result.Value?.Id == (accept ? "b" : null), label + " keeps first modal decision");
            }
        }
        finally { driver.Stop(); deadline.Stop(); }
        Pump();
        Check(field.IsKeyboardFocused && field.Text == originalText, label + " restores owner focus without writing host text");
    }
    private static TreeViewItem? TreeContainer(ItemsControl parent, string code)
    {
        parent.UpdateLayout();
        foreach (var item in parent.Items)
            if (parent.ItemContainerGenerator.ContainerFromItem(item) is TreeViewItem container)
            {
                if (item is AccountTreeNode node && node.Choice.Code == code) return container;
                if (TreeContainer(container, code) is { } found) return found;
            }
        return null;
    }
    private static void Capture(Window window, string name)
    {
        window.UpdateLayout(); var dpi = VisualTreeHelper.GetDpi(window);
        var image = new RenderTargetBitmap((int)Math.Ceiling(window.ActualWidth * dpi.DpiScaleX), (int)Math.Ceiling(window.ActualHeight * dpi.DpiScaleY),
            96 * dpi.DpiScaleX, 96 * dpi.DpiScaleY, PixelFormats.Pbgra32);
        image.Render(window); var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(image));
        using var output = File.Create(Path.Combine(artifacts, name + ".png")); encoder.Save(output);
        renders.Add(new { name, width = image.PixelWidth, height = image.PixelHeight, dpiX = 96 * dpi.DpiScaleX, dpiY = 96 * dpi.DpiScaleY });
    }
    private static void Pump()
    {
        var frame = new DispatcherFrame(); Dispatcher.CurrentDispatcher.BeginInvoke(DispatcherPriority.ContextIdle, new Action(() => frame.Continue = false)); Dispatcher.PushFrame(frame);
    }
}
