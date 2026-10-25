using Caiwu.Desktop.Testing;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Desktop;
using Caiwu.Desktop.Dialogs;
using Caiwu.Desktop.Presentation;
using Caiwu.Persistence.Sqlite;
using Caiwu.Reporting;

internal static class Program
{
    private static readonly List<object> Results = [];
    private static readonly List<object> Observations = [];
    private static readonly List<Task> UiActions = [];
    private static string output = "";
    private static int failures, blocked;

    [STAThread]
    private static int Main(string[] args)
    {
        if (!OperatingSystem.IsWindows())
        {
            Console.Error.WriteLine("BLOCKED: actual Windows WPF and common file dialog required.");
            return 2;
        }
        output = Path.GetFullPath(args.Length == 0 ? "artifacts/ui-navigation" : args[0]);
        Directory.CreateDirectory(output);
        var app = new App();
        app.InitializeComponent();
        app.ShutdownMode = ShutdownMode.OnExplicitShutdown;
        SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext());
        // Pump without Application.Run: that would invoke App.OnStartup and open a second main window.
        var run = RunAsync();
        var frame = new DispatcherFrame();
        _ = run.ContinueWith(_ => app.Dispatcher.BeginInvoke(() => frame.Continue = false), TaskScheduler.Default);
        Dispatcher.PushFrame(frame);
        try { run.GetAwaiter().GetResult(); }
        catch (Exception ex) { failures++; Console.Error.WriteLine(ex); }
        File.WriteAllText(Path.Combine(output, "navigation-results.json"), JsonSerializer.Serialize(new
        {
            schema = "caiwu-ui-navigation-results/1", actualWindowsWpf = true,
            executedAtUtc = DateTimeOffset.UtcNow, os = RuntimeInformation.OSDescription,
            checkoutCommit = Environment.GetEnvironmentVariable("CAIWU_NAV_CHECKOUT_COMMIT") ?? "not supplied",
            productionSourceTree = Environment.GetEnvironmentVariable("CAIWU_NAV_SOURCE_TREE") ?? "not supplied",
            deliverySourceTree = Environment.GetEnvironmentVariable("CAIWU_NAV_DELIVERY_TREE") ?? "not supplied",
            mechanism = "Production WPF controls, routed click/double-click events and real modal windows; same-process native file-dialog Cancel button. Programmatic text entry, not physical keyboard/IME testing.",
            failures, blocked, results = Results, observations = Observations
        }, new JsonSerializerOptions { WriteIndented = true }));
        app.Shutdown();
        return failures == 0 && blocked == 0 ? 0 : 1;
    }

    private static async Task RunAsync()
    {
        await CheckAsync("UI-NAV-NEWBOOK-CANCEL-RETAINS-INPUT", NewBookCancelAsync);
        await CheckAsync("UI-NAV-REPORT-RETURN-RETAINS-CONTEXT", ReportReturnAsync);
    }

    private static DesktopBackend ProductionBackend() => SyntheticDesktopIdentity.Backend;

    private static async Task<MainWindow> MainAsync(DesktopBackend backend)
    {
        var main = SyntheticDesktopIdentity.CreateMain(backend);
        Application.Current.MainWindow = main;
        main.Show();
        await SettleAsync();
        return main;
    }

    private static async Task NewBookCancelAsync()
    {
        var production = ProductionBackend();
        var creates = 0;
        var backend = production with { Create = (path, book, accounts) =>
        {
            creates++;
            return production.Create(path, book, accounts);
        }};
        var main = await MainAsync(backend);
        NewBookWindow? form = null;
        try
        {
            Schedule(() => Click(Menu(main, "新建账套…")));
            form = await VisibleAsync<NewBookWindow>();
            var expected = new BookFormState("取消后应保留的虚拟账套", "2025", AccountingRegime.Enterprise, 7);
            FillBook(form, expected);
            Capture(form, "new-book-filled.png");
            using var cancelTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(12));
            // Native COM dialogs run their own modal message loop. A background observer cancels
            // only our process's exact save dialog; it never scans/clicks another application.
            var cancel = Task.Run(() => NativeCancelSaveDialog(cancelTimeout.Token));
            Schedule(() => Click(Visuals<Button>(form).Single(b => b.IsDefault)));
            var native = await cancel;
            await SettleAsync();
            var returnedDirectly = Windows<NewBookWindow>().FirstOrDefault();
            if (returnedDirectly is null)
            {
                await WaitAsync(() => main.IsEnabled, "Main window did not become usable after cancel.");
                Schedule(() => Click(Menu(main, "新建账套…")));
                form = await VisibleAsync<NewBookWindow>();
            }
            else form = returnedDirectly;
            var actual = ReadBook(form);
            Observations.Add(new { probe = "new-book", expected, actual, returnedDirectly = returnedDirectly is not null,
                createCalls = creates, nativeCancel = native });
            Capture(form, "new-book-after-save-cancel.png");
            Require(actual == expected,
                $"Save-location cancel silently lost form input. Expected {expected}; visible form has {actual}.");
            var name = Labeled<TextBox>(form, "单位 / 账套名称");
            Require(name.IsEnabled && !name.IsReadOnly, "Retained form cannot be edited.");
            name.Text += "（继续修改）";
            Require(name.Text.EndsWith("（继续修改）", StringComparison.Ordinal), "Cannot revise retained input.");
            Require(creates == 0, "Cancelling file selection invoked a real book creation.");
        }
        finally
        {
            foreach (var open in Windows<NewBookWindow>().ToArray())
                Click(Visuals<Button>(open).Single(b => b.IsCancel));
            await SettleAsync();
            main.Close();
        }
    }

    private static async Task ReportReturnAsync()
    {
        var path = Path.Combine(output, "navigation-" + Guid.NewGuid().ToString("N") + ".caiwu");
        var template = TemplateCatalog.Get(AccountingRegime.SmallBusiness);
        var book = new BookInfo(Guid.NewGuid(), "导航回归虚拟账套", AccountingRegime.SmallBusiness,
            template.Version, 2026, 10, 9, DateTimeOffset.UtcNow);
        var accounts = template.Accounts.Concat(Enumerable.Range(9000, 96)
            .Select(i => new Account(i.ToString(), "探针科目" + i, null, BalanceDirection.Debit, true, 0, 0))).ToArray();
        using var store = SqliteLedgerStore.Create(path, book, accounts);
        var service = new LedgerService(store);
        for (var i = 0; i < 48; i++)
        {
            // Each synthetic setup command plans from its own full snapshot; no UI mutation is retried.
            var entryPlan = service.GetSnapshot();
            var voucher = service.SaveDraft(new(null, new DateOnly(2026, 10, 2 + i / 3), "记", null, 0,
                [new("9060", "虚拟业务" + i, i + 1, 0), new("3001", "虚拟业务" + i, 0, i + 1)], entryPlan.Revision, entryPlan.Book.Id), "探针制单");
            var reviewPlan = service.GetSnapshot(); service.Review(voucher.Id, "探针审核", new(reviewPlan.Book.Id, reviewPlan.Revision));
            var postPlan = service.GetSnapshot(); service.Post(voucher.Id, "探针审核", new(postPlan.Book.Id, postPlan.Revision));
        }
        var before = JsonSerializer.Serialize(store.Read());
        var main = await MainAsync(ProductionBackend());
        try
        {
            // Fixture load only; every navigation action below uses the actual visible controls.
            var load = typeof(MainWindow).GetMethod("OpenVerificationBook", BindingFlags.Instance | BindingFlags.NonPublic)
                ?? throw new InvalidOperationException("Fixture-load hook changed; update bootstrap explicitly.");
            load.Invoke(main, [path]);
            Schedule(() => Click(Menu(main, "账簿报表与导出…")));
            var report = await VisibleAsync<ReportCenterWindow>();
            report.Width = 1020; report.Height = 620;
            Find<DatePicker>(report, "FromInput").SelectedDate = new DateTime(2026, 10, 2);
            Find<DatePicker>(report, "ToInput").SelectedDate = new DateTime(2026, 10, 20);
            Find<ComboBox>(report, "AccountInput").SelectedValue = "1002";
            Click(Button(report, "生成报表", "生成"));
            await SettleAsync();
            var grid = Find<DataGrid>(report, "ReportGrid");
            await SelectScrolledAsync(grid, grid.Items.Cast<ReportRow>().Single(r => r.AccountCode == "9060"));
            var parent = ReadReport(report);
            Observations.Add(new { probe = "report-parent-fixture", state = parent });
            Capture(report, "report-parent-before.png");
            Prerequisite(parent.VerticalOffset > 0 && parent.HorizontalOffset > 0,
                "Fixture did not establish a nonzero parent vertical/horizontal scroll position.");
            DoubleClick(grid);
            await SettleAsync();
            Require(Find<ComboBox>(report, "KindInput").SelectedIndex == 1,
                "Actual balance-row double-click did not enter the detail ledger.");
            var ledgerRow = grid.Items.Cast<ReportRow>().Where(r => r.VoucherId is not null).ElementAt(32);
            await SelectScrolledAsync(grid, ledgerRow);
            var detail = ReadReport(report);
            Observations.Add(new { probe = "report-detail-fixture", state = detail });
            Capture(report, "report-detail-before-voucher.png");
            Prerequisite(detail.VerticalOffset > 0 && detail.HorizontalOffset > 0,
                "Fixture did not establish a nonzero detail vertical/horizontal scroll position.");
            Schedule(() => DoubleClick(grid));
            var voucherWindow = await VisibleAsync<VoucherEditorWindow>();
            Require(Find<DataGrid>(voucherWindow, "LinesGrid").IsReadOnly,
                "Posted fixture voucher unexpectedly editable.");
            Capture(voucherWindow, "report-voucher-readonly.png");
            // Equivalent to the standard close affordance; no fields/tokens/dirty flags are changed.
            voucherWindow.Close();
            await SettleAsync();
            var detailAfter = ReadReport(report);
            var violations = Compare(detail, detailAfter, "Closing voucher");
            Capture(report, "report-detail-after-voucher.png");
            var back = Visuals<Button>(report).Where(b => b.IsVisible && b.IsEnabled)
                .SingleOrDefault(b => b.Content?.ToString() is { } label &&
                    (label.Contains("返回余额", StringComparison.Ordinal) || label.Contains("返回科目余额", StringComparison.Ordinal)
                     || label.Contains("返回上", StringComparison.Ordinal)));
            var returnAction = back is null ? "existing kind selector + Generate" : back.Content?.ToString();
            if (back is not null) Click(back);
            else
            {
                // Do not mandate a new button: the existing kind selector is an acceptable way
                // back if it restores the saved parent context instead of losing it.
                Find<ComboBox>(report, "KindInput").SelectedIndex = 0;
                Click(Button(report, "生成报表", "生成"));
            }
            await SettleAsync();
            var parentAfter = ReadReport(report);
            violations.AddRange(Compare(parent, parentAfter, "Returning to balance table"));
            Observations.Add(new { probe = "report-return", parent, detail, detailAfter, parentAfter, returnAction, violations });
            Capture(report, "report-parent-after.png");
            Require(JsonSerializer.Serialize(store.Read()) == before, "Read-only drill-through changed book data/audit/revision.");
            Require(violations.Count == 0, string.Join(" | ", violations));
        }
        finally
        {
            foreach (var open in Windows<VoucherEditorWindow>().ToArray()) open.Close();
            foreach (var open in Windows<ReportCenterWindow>().ToArray()) open.Close();
            await SettleAsync();
            main.Close();
        }
    }

    private sealed record BookFormState(string Name, string Year, AccountingRegime Regime, int Month);
    private static void FillBook(Window form, BookFormState state)
    {
        Labeled<TextBox>(form, "单位 / 账套名称").Text = state.Name;
        Labeled<TextBox>(form, "会计年度").Text = state.Year;
        var template = Labeled<ComboBox>(form, "会计制度");
        template.SelectedItem = template.Items.Cast<TemplateDefinition>().Single(t => t.Regime == state.Regime);
        Labeled<ComboBox>(form, "启用月份").SelectedItem = state.Month;
    }
    private static BookFormState ReadBook(Window form) => new(
        Labeled<TextBox>(form, "单位 / 账套名称").Text, Labeled<TextBox>(form, "会计年度").Text,
        ((TemplateDefinition)Labeled<ComboBox>(form, "会计制度").SelectedItem).Regime,
        (int)Labeled<ComboBox>(form, "启用月份").SelectedItem);

    private sealed record ReportState(int Kind, string? Account, DateTime? From, DateTime? To,
        string? SelectedKey, double VerticalOffset, double HorizontalOffset);
    private static string Key(ReportRow row) => row.VoucherId is { } id ? "voucher:" + id : "account:" + row.AccountCode;
    private static ReportState ReadReport(Window report)
    {
        report.UpdateLayout();
        var grid = Find<DataGrid>(report, "ReportGrid");
        var scroll = GridScroll(grid);
        return new(Find<ComboBox>(report, "KindInput").SelectedIndex,
            Find<ComboBox>(report, "AccountInput").SelectedValue as string,
            Find<DatePicker>(report, "FromInput").SelectedDate, Find<DatePicker>(report, "ToInput").SelectedDate,
            grid.SelectedItem is ReportRow row ? Key(row) : null, scroll.VerticalOffset, scroll.HorizontalOffset);
    }
    private static List<string> Compare(ReportState before, ReportState after, string stage)
    {
        var errors = new List<string>();
        if (before.Kind != after.Kind || before.Account != after.Account || before.From != after.From || before.To != after.To)
            errors.Add(stage + ": report kind/account/date context was not preserved.");
        if (before.SelectedKey != after.SelectedKey) errors.Add(stage + ": selected business row was lost or changed.");
        if (Math.Abs(before.VerticalOffset - after.VerticalOffset) > .5)
            errors.Add($"{stage}: vertical scroll changed {before.VerticalOffset} -> {after.VerticalOffset}.");
        if (Math.Abs(before.HorizontalOffset - after.HorizontalOffset) > .5)
            errors.Add($"{stage}: horizontal scroll changed {before.HorizontalOffset} -> {after.HorizontalOffset}.");
        return errors;
    }
    private static async Task SelectScrolledAsync(DataGrid grid, ReportRow row)
    {
        grid.SelectedItem = row;
        grid.ScrollIntoView(row);
        await SettleAsync();
        var scroll = GridScroll(grid);
        scroll.ScrollToHorizontalOffset(Math.Min(140, scroll.ScrollableWidth));
        await SettleAsync();
        Prerequisite(grid.ItemContainerGenerator.ContainerFromItem(row) is DataGridRow visible && visible.IsVisible,
            "Selected fixture row is not realized in the actual grid.");
    }

    private static async Task CheckAsync(string id, Func<Task> probe)
    {
        try
        {
            await probe();
            await WaitAsync(() => UiActions.All(t => t.IsCompleted), "A modal navigation action did not finish after cleanup.");
            foreach (var action in UiActions) await action;
            Results.Add(new { id, status = "PASS" }); Console.WriteLine("PASS " + id);
        }
        catch (ProbeBlockedException ex)
        {
            blocked++; Results.Add(new { id, status = "BLOCKED", detail = ex.Message });
            Console.WriteLine("BLOCKED " + id + " " + ex.Message);
        }
        catch (Exception ex)
        {
            failures++; Results.Add(new { id, status = "FAIL", detail = ex.ToString() });
            Console.WriteLine("FAIL " + id + " " + ex.Message);
        }
        await SettleAsync();
        foreach (var action in UiActions.Where(t => t.IsCompleted).ToArray())
        {
            // Observe dispatched exceptions instead of silently losing them.
            if (action.IsFaulted) Console.Error.WriteLine(action.Exception);
            UiActions.Remove(action);
        }
    }
    private static void Require(bool value, string message)
    { if (!value) throw new InvalidOperationException(message); }
    private static void Prerequisite(bool value, string message)
    { if (!value) throw new ProbeBlockedException(message); }
    private sealed class ProbeBlockedException(string message) : Exception(message);
    private static void Schedule(Action action) => UiActions.Add(Dispatcher.CurrentDispatcher.InvokeAsync(action).Task);
    private static async Task SettleAsync()
    {
        await Dispatcher.CurrentDispatcher.InvokeAsync(() => { }, DispatcherPriority.ApplicationIdle);
        await Task.Delay(100);
        await Dispatcher.CurrentDispatcher.InvokeAsync(() => { }, DispatcherPriority.ApplicationIdle);
    }
    private static async Task WaitAsync(Func<bool> ready, string reason)
    {
        var watch = Stopwatch.StartNew();
        while (!ready())
        {
            if (watch.Elapsed > TimeSpan.FromSeconds(10)) throw new ProbeBlockedException(reason);
            var fault = UiActions.FirstOrDefault(t => t.IsFaulted);
            if (fault is not null) await fault;
            await Task.Delay(50);
        }
    }
    private static IEnumerable<T> Windows<T>() where T : Window => Application.Current.Windows.OfType<T>().Where(w => w.IsVisible);
    private static async Task<T> VisibleAsync<T>() where T : Window
    {
        await WaitAsync(() => Windows<T>().Any(), $"Actual {typeof(T).Name} did not become visible.");
        await SettleAsync();
        return Windows<T>().Single();
    }
    private static T Find<T>(Window owner, string name) where T : FrameworkElement =>
        owner.FindName(name) as T ?? throw new InvalidOperationException($"Visible control {name} changed/missing.");
    private static T Labeled<T>(Window owner, string label) where T : Control
    {
        var text = Visuals<TextBlock>(owner).Single(t => t.Text == label);
        if (text.Parent is Panel panel)
        {
            var next = panel.Children.IndexOf(text) + 1;
            if (next < panel.Children.Count && panel.Children[next] is T control) return control;
        }
        throw new InvalidOperationException("Labeled control changed: " + label);
    }
    // Both delivered visual versions use the same production Generate_Click action.
    // Resolve its exact visible caption; never invoke a handler or skip a navigation assertion.
    private static Button Button(Window owner, params string[] captions) => Visuals<Button>(owner)
        .Single(b => b.IsVisible && b.Content is string text && captions.Contains(text, StringComparer.Ordinal));
    private static MenuItem Menu(Window owner, string header) => Logical(owner).OfType<MenuItem>()
        .Single(m => m.Header?.ToString() == header);
    private static void Click(Button button)
    {
        Require(button.IsVisible && button.IsEnabled, "Cannot click disabled/hidden button: " + button.Content);
        button.RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent));
    }
    private static void Click(MenuItem item)
    {
        Require(item.IsEnabled, "Cannot use disabled menu: " + item.Header);
        item.RaiseEvent(new RoutedEventArgs(MenuItem.ClickEvent));
    }
    private static void DoubleClick(DataGrid grid) => grid.RaiseEvent(new MouseButtonEventArgs(Mouse.PrimaryDevice, 0, MouseButton.Left)
        { RoutedEvent = Control.MouseDoubleClickEvent });
    private static ScrollViewer GridScroll(DataGrid grid) => Visuals<ScrollViewer>(grid)
        .FirstOrDefault(s => s.Name == "DG_ScrollViewer") ?? Visuals<ScrollViewer>(grid).First();
    private static IEnumerable<DependencyObject> Logical(DependencyObject root)
    {
        foreach (var child in LogicalTreeHelper.GetChildren(root).OfType<DependencyObject>())
        {
            yield return child;
            foreach (var nested in Logical(child)) yield return nested;
        }
    }
    private static IEnumerable<T> Visuals<T>(DependencyObject root) where T : DependencyObject
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++)
        {
            var child = VisualTreeHelper.GetChild(root, i);
            if (child is T match) yield return match;
            foreach (var nested in Visuals<T>(child)) yield return nested;
        }
    }
    private static void Capture(Window window, string name)
    {
        window.UpdateLayout();
        var content = (FrameworkElement)window.Content;
        var image = new RenderTargetBitmap((int)Math.Ceiling(content.ActualWidth),
            (int)Math.Ceiling(content.ActualHeight), 96, 96, PixelFormats.Pbgra32);
        image.Render(content);
        var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(image));
        using var file = File.Create(Path.Combine(output, name)); encoder.Save(file);
    }

    private sealed record NativeCancelEvidence(string Title, string ClassName, int ProcessId, bool CancelButtonClicked);
    private static NativeCancelEvidence NativeCancelSaveDialog(CancellationToken timeout)
    {
        while (!timeout.IsCancellationRequested)
        {
            IntPtr found = IntPtr.Zero;
            EnumWindows((handle, _) =>
            {
                GetWindowThreadProcessId(handle, out var pid);
                if (pid == Environment.ProcessId && IsWindowVisible(handle) && WindowText(handle) == "保存新账套")
                {
                    var cls = new StringBuilder(256); GetClassName(handle, cls, cls.Capacity);
                    if (cls.ToString() == "#32770") { found = handle; return false; }
                }
                return true;
            }, IntPtr.Zero);
            if (found != IntPtr.Zero)
            {
                var cancel = GetDlgItem(found, 2); // IDCANCEL: the actual native dialog button.
                if (cancel == IntPtr.Zero || !IsWindowVisible(cancel) || !IsWindowEnabled(cancel))
                    throw new ProbeBlockedException("Same-process Save dialog found but its native Cancel button is unavailable.");
                if (!PostMessage(cancel, 0x00F5, IntPtr.Zero, IntPtr.Zero)) // BM_CLICK
                    throw new ProbeBlockedException("Windows rejected the native Cancel button click.");
                var closed = Stopwatch.StartNew();
                while (IsWindowVisible(found) && closed.Elapsed < TimeSpan.FromSeconds(5)) Thread.Sleep(25);
                if (IsWindowVisible(found)) throw new ProbeBlockedException("Native Cancel click did not close the actual save dialog.");
                return new("保存新账套", "#32770", Environment.ProcessId, true);
            }
            timeout.WaitHandle.WaitOne(25);
        }
        throw new ProbeBlockedException("No matching same-process native Save dialog within 12 seconds; no cancel success inferred.");
    }
    private static string WindowText(IntPtr handle)
    { var text = new StringBuilder(512); GetWindowText(handle, text, text.Capacity); return text.ToString(); }
    private delegate bool EnumWindowProc(IntPtr window, IntPtr param);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowProc callback, IntPtr param);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out int processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll")] private static extern IntPtr GetDlgItem(IntPtr window, int id);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
}
