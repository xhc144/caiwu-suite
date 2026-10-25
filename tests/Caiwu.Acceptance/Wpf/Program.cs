using System.Collections.ObjectModel;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Interop;
using System.Windows.Input;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Desktop;
using Caiwu.Desktop.Dialogs;
using Caiwu.Desktop.Presentation;
using Caiwu.Persistence.Sqlite;
using Microsoft.Data.Sqlite;

internal static class Program
{
    private static readonly List<object> Results = [];
    private static int failures, blocked;
    private static readonly List<object> Measurements = [];
    private static string directory = "";

    [STAThread]
    private static int Main(string[] args)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Actual WPF runtime required.");
        directory = Path.GetFullPath(args.Length == 0 ? "tests/Caiwu.Acceptance/evidence/runtime/wpf" : args[0]);
        Directory.CreateDirectory(directory);
        var app = new App(); app.InitializeComponent(); app.ShutdownMode = ShutdownMode.OnExplicitShutdown;
        var backend = (DesktopBackend)typeof(App).GetMethod("CreateBackend", BindingFlags.Static | BindingFlags.NonPublic)!.Invoke(null, null)!;
        var path = Path.Combine(directory, "acceptance-" + Guid.NewGuid().ToString("N") + ".caiwu");
        var book = new BookInfo(Guid.NewGuid(), "独立验收", AccountingRegime.SmallBusiness, "acceptance", 2026, 10, 9, DateTimeOffset.UtcNow);
        using var store = SqliteLedgerStore.Create(path, book, TemplateCatalog.Get(AccountingRegime.SmallBusiness).Accounts);
        var service = new LedgerService(store);
        var saved = service.SaveDraft(new(null, new(2026, 10, 1), "记", null, 0,
            [new("1002", "独立数据", 123456.78m, 0), new("3001", "独立数据", 0, 123456.78m)]), "甲");
        service.Review(saved.Id, "乙"); service.Post(saved.Id, "乙");
        var window = new MainWindow(backend); app.MainWindow = window; window.Show(); Pump();
        Call(window, "OpenVerificationBook", path); Pump();
        Check("WPF-LAYOUT", () =>
        {
            var unreadable = new List<string>();
            foreach (var (page, name) in new[] { (1, "VoucherGrid"), (3, "OpeningGrid"), (4, "TrialGrid") })
            {
                Call(window, "ShowVerificationPage", page); Pump();
                Capture(window, name + ".png");
                var grid = (DataGrid)window.FindName(name);
                var widths = grid.Columns.Select(c => c.ActualWidth).ToArray();
                Measurements.Add(new { probe = "WPF-LAYOUT", grid = name, widths,
                    headers = grid.Columns.Select(c => c.Header?.ToString()).ToArray(),
                    dpi = VisualTreeHelper.GetDpi(grid).PixelsPerDip });
                for (var i = 0; i < grid.Columns.Count; i++)
                {
                    var column = grid.Columns[i];
                    var minimum = column.Width.IsAbsolute ? Math.Max(55, column.Width.Value * .85) : 100;
                    if (column.ActualWidth < minimum) unreadable.Add($"{name}/{column.Header}: {column.ActualWidth:0.##} < {minimum:0.##}");
                }
            }
            Assert(unreadable.Count == 0, "Unreadable columns: " + string.Join("; ", unreadable));
        });
        Check("WPF-INVALID-SAVE-RETAINS-INPUT", () =>
        {
            var editor = new VoucherEditorWindow(book, service.GetSnapshot().Accounts, null, "甲", d => service.SaveDraft(d, "甲")) { Owner = window };
            var before = store.Read().Revision;
            InDialog(editor, () =>
            {
                Fill(editor, "中文摘要（程序赋值，不是IME测试）", "1.23", "1.24");
                ((Button)editor.FindName("SaveButton")).RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
                Assert(editor.IsVisible && editor.DialogResult is null, "Validation failure closed dialog.");
                var rows = (ObservableCollection<VoucherLineEdit>)((DataGrid)editor.FindName("LinesGrid")).ItemsSource;
                Assert(rows[0].DebitText == "1.23" && rows[1].CreditText == "1.24" && rows[0].Summary.Contains("中文摘要"), "Input changed on failure.");
                Assert(store.Read().Revision == before && !string.IsNullOrWhiteSpace(((TextBlock)editor.FindName("ErrorText")).Text), "Rejected save changed storage or showed no error.");
                Capture(editor, "validation-retains-input.png");
            });
        });
        Check("WPF-MALFORMED-AMOUNT-REJECTED", () =>
        {
            var editor = new VoucherEditorWindow(book, service.GetSnapshot().Accounts, null, "甲", d => service.SaveDraft(d, "甲")) { Owner = window };
            var before = JsonSerializer.Serialize(store.Read());
            InDialog(editor, () =>
            {
                Fill(editor, "分组错误应拒绝", "1,23", "1,23");
                ((Button)editor.FindName("SaveButton")).RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
                Assert(editor.IsVisible && editor.DialogResult is null, "Malformed 1,23 was accepted and closed the editor.");
                AssertUnchangedInput(editor, "分组错误应拒绝", "1,23", "1,23");
                Assert(JsonSerializer.Serialize(store.Read()) == before, "Malformed amount wrote a voucher/audit/revision.");
                Assert(!string.IsNullOrWhiteSpace(((TextBlock)editor.FindName("ErrorText")).Text), "Malformed amount showed no explicit error.");
                Capture(editor, "malformed-amount-rejected.png");
            });
        });
        Check("WPF-RAPID-DOUBLE-SAVE-SINGLE-WRITE", () =>
        {
            var calls = 0; var before = store.Read();
            var editor = new VoucherEditorWindow(book, service.GetSnapshot().Accounts, null, "甲", d =>
            {
                calls++; return service.SaveDraft(d, "甲");
            }) { Owner = window };
            var ownerGuard = new MouseButtonEventHandler((_, e) => e.Handled = true);
            // Guard only the owner so the second native click cannot start an unrelated owner action
            // after the modal closes; input routing inside the voucher window remains unchanged.
            window.PreviewMouseDown += ownerGuard; window.PreviewMouseUp += ownerGuard;
            try
            {
                InDialogByNativeDoubleClick(editor, () => Fill(editor, "连点保存独立验收", "3.45", "3.45"), () => calls);
                var after = store.Read();
                Assert(calls == 1 && after.Vouchers.Count == before.Vouchers.Count + 1 && after.Revision == before.Revision + 1,
                    $"Rapid native clicks produced saveCalls={calls}, vouchersDelta={after.Vouchers.Count - before.Vouchers.Count}, revisionDelta={after.Revision - before.Revision}.");
                Measurements.Add(new { probe = "WPF-RAPID-DOUBLE-SAVE-SINGLE-WRITE", nativeMouseEvents = 4, saveCalls = calls,
                    vouchersDelta = after.Vouchers.Count - before.Vouchers.Count, revisionDelta = after.Revision - before.Revision });
            }
            finally { window.PreviewMouseDown -= ownerGuard; window.PreviewMouseUp -= ownerGuard; }
        });
        Check("WPF-SQLITE-BUSY-RETAINS-INPUT", () =>
        {
            var editor = new VoucherEditorWindow(book, service.GetSnapshot().Accounts, null, "甲", d => service.SaveDraft(d, "甲")) { Owner = window };
            using var blocker = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString());
            blocker.Open(); using var transaction = blocker.BeginTransaction(deferred: false);
            InDialog(editor, () =>
            {
                Fill(editor, "锁冲突保留", "2.34", "2.34");
                ((Button)editor.FindName("SaveButton")).RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
                Assert(editor.IsVisible && editor.DialogResult is null, "Busy failure closed dialog.");
                Assert(!string.IsNullOrWhiteSpace(((TextBlock)editor.FindName("ErrorText")).Text), "Busy save did not show inline error.");
                AssertUnchangedInput(editor, "锁冲突保留", "2.34", "2.34");
                Capture(editor, "sqlite-busy-retains-input.png");
            });
            transaction.Rollback();
        });
        Check("WPF-STALE-EDITOR-RETAINS-OPENING-TOKEN-AND-INPUT", () =>
        {
            var draft = service.SaveDraft(new(null, new(2026, 10, 2), "记", null, 0,
                [new("1002", "旧窗口原值", 10, 0), new("3001", "旧窗口原值", 0, 10)]), "甲");
            // Each editor's voucher, book identity and revision come from exactly one
            // snapshot at OPEN time, before either write. Never refresh a token in Save.
            var openingA = service.GetSnapshot();
            var openingB = service.GetSnapshot();
            var originalB = openingB.Vouchers.Single(v => v.Id == draft.Id);
            var attempts = new List<VoucherDraft>();
            var editor = new VoucherEditorWindow(openingB.Book, openingB.Accounts, originalB, "甲", request =>
            {
                attempts.Add(request); return service.SaveDraft(request, "甲");
            }, expectedRevision: openingB.Revision) { Owner = window };
            using var otherStore = SqliteLedgerStore.Open(path); var other = new LedgerService(otherStore);
            InDialog(editor, () =>
            {
                Fill(editor, "旧窗口未保存输入", "30.00", "30.00");
                var originalA = openingA.Vouchers.Single(v => v.Id == draft.Id);
                other.SaveDraft(new(originalA.Id, originalA.Date, originalA.Kind, originalA.Number,
                    originalA.AttachmentCount, [new("1002", "另一实例新值", 20, 0), new("3001", "另一实例新值", 0, 20)],
                    openingA.Revision, openingA.Book.Id), "甲");
                var afterOther = JsonSerializer.Serialize(store.Read());
                var button = (Button)editor.FindName("SaveButton");
                for (var retry = 0; retry < 2; retry++)
                {
                    button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
                    Assert(editor.IsVisible && editor.DialogResult is null, "Stale editor closed/overwrote after conflict.");
                    AssertUnchangedInput(editor, "旧窗口未保存输入", "30.00", "30.00");
                    Assert(!string.IsNullOrWhiteSpace(((TextBlock)editor.FindName("ErrorText")).Text), "Stale save showed no error.");
                    Assert(JsonSerializer.Serialize(store.Read()) == afterOther, "Stale save changed newer data/audit/revision.");
                }
                Assert(attempts.Count == 2 && attempts.All(r => r.ExpectedRevision == openingB.Revision && r.ExpectedBookId == openingB.Book.Id),
                    "Editor refreshed or omitted its original token during save/retry.");
                Capture(editor, "stale-editor-retains-token-input.png");
                Measurements.Add(new { probe = "WPF-STALE-EDITOR-RETAINS-OPENING-TOKEN-AND-INPUT", saveAttempts = attempts.Count,
                    openingRevision = openingB.Revision, originalTokensRetained = true, actualSecondSqliteConnection = true });
            });
        });
        Check("WPF-POSTED-READONLY", () =>
        {
            var posted = service.GetSnapshot().Vouchers.Single(v => v.Id == saved.Id);
            var editor = new VoucherEditorWindow(book, service.GetSnapshot().Accounts, posted, "甲", d => service.SaveDraft(d, "甲")) { Owner = window };
            InDialog(editor, () =>
            {
                Assert(((DataGrid)editor.FindName("LinesGrid")).IsReadOnly && !((Button)editor.FindName("SaveButton")).IsEnabled, "Posted editor editable.");
                var revision = store.Read().Revision; Call(editor, "Save");
                Assert(store.Read().Revision == revision, "Posted Save handler wrote data."); Capture(editor, "posted-readonly.png");
            });
        });
        // AccountWindow currently closes before the service validates. This invokes its real button,
        // without claiming that the backend accepted it; no account-save success is fabricated.
        Check("WPF-ACCOUNT-INVALID-RETAINS-INPUT", () =>
        {
            var dialog = new AccountWindow(null, null) { Owner = window };
            var accepted = false;
            InDialog(dialog, () =>
            {
                Field<TextBox>(dialog, "_code").Text = "123";
                Field<TextBox>(dialog, "_name").Text = "应保留的名称";
                var button = Descendants<Button>(dialog).Single(b => b.IsDefault);
                button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
                accepted = dialog.DialogResult == true;
                Assert(!accepted && dialog.IsVisible, "Invalid three-digit account closed the form before backend validation.");
            });
        });
        window.Close();
        File.WriteAllText(Path.Combine(directory, "wpf-results.json"), JsonSerializer.Serialize(new
        {
            executedAtUtc = DateTimeOffset.UtcNow, actualWindowsWpf = true,
            os = System.Runtime.InteropServices.RuntimeInformation.OSDescription,
            checkoutCommit = Environment.GetEnvironmentVariable("CAIWU_ACCEPTANCE_CHECKOUT_COMMIT") ?? "not supplied",
            productionSourceTree = Environment.GetEnvironmentVariable("CAIWU_ACCEPTANCE_SOURCE_TREE") ?? "not supplied",
            mechanism = "Actual production WPF classes/resources and SQLite; scripted routed events/reflection plus one native SendInput mouse double-click. No physical keyboard/IME/file-dialog automation.",
            failures, blocked, measurements = Measurements, results = Results
        }, new JsonSerializerOptions { WriteIndented = true }));
        app.Shutdown(); return failures == 0 && blocked == 0 ? 0 : 1;
    }
    private static void Check(string id, Action action)
    {
        try { action(); Results.Add(new { id, status = "PASS" }); Console.WriteLine("PASS " + id); }
        catch (ProbeBlockedException e) { blocked++; Results.Add(new { id, status = "BLOCKED", detail = e.Message }); Console.WriteLine("BLOCKED " + id + " " + e.Message); }
        catch (Exception e) { failures++; Results.Add(new { id, status = "FAIL", detail = e.ToString() }); Console.WriteLine("FAIL " + id + " " + e.Message); }
    }
    private static void Assert(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
    private static T Field<T>(object instance, string name) => (T)instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(instance)!;
    private static object? Call(object instance, string method, params object[] args)
    {
        try { return instance.GetType().GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(instance, args); }
        catch (TargetInvocationException e) { System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(e.InnerException!).Throw(); return null; }
    }
    private static void Fill(VoucherEditorWindow editor, string summary, string debit, string credit)
    {
        var rows = (ObservableCollection<VoucherLineEdit>)((DataGrid)editor.FindName("LinesGrid")).ItemsSource;
        rows[0].Summary = rows[1].Summary = summary; rows[0].AccountCode = "1002"; rows[1].AccountCode = "3001";
        rows[0].DebitText = debit; rows[1].CreditText = credit;
    }
    private static void AssertUnchangedInput(VoucherEditorWindow editor, string summary, string debit, string credit)
    {
        var rows = (ObservableCollection<VoucherLineEdit>)((DataGrid)editor.FindName("LinesGrid")).ItemsSource;
        Assert(rows[0].Summary == summary && rows[1].Summary == summary && rows[0].DebitText == debit && rows[1].CreditText == credit,
            "Rejected save changed or lost the entered summary/amounts.");
    }
    private sealed class ProbeBlockedException(string message) : Exception(message);
    private static void InDialogByNativeDoubleClick(VoucherEditorWindow editor, Action prepare, Func<int> saveCalls)
    {
        Exception? error = null;
        var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
        timer.Tick += (_, _) =>
        {
            timer.Stop();
            error ??= saveCalls() == 0
                ? new ProbeBlockedException("Synthetic native clicks did not reach Save within five seconds; desktop input availability unverified.")
                : new InvalidOperationException("Save was invoked but the modal did not close within five seconds.");
            ForceClose(editor);
        };
        editor.Dispatcher.InvokeAsync(() =>
        {
            try
            {
                prepare(); editor.UpdateLayout(); Capture(editor, "rapid-save-before-click.png");
                var handle = new WindowInteropHelper(editor).Handle;
                if (!SetForegroundWindow(handle) && GetForegroundWindow() != handle)
                    throw new ProbeBlockedException("Cannot foreground the actual editor on this Windows desktop.");
                var button = (Button)editor.FindName("SaveButton");
                var point = button.PointToScreen(new Point(button.ActualWidth / 2, button.ActualHeight / 2));
                if (!SetCursorPos((int)Math.Round(point.X), (int)Math.Round(point.Y)))
                    throw new ProbeBlockedException("SetCursorPos rejected native mouse placement.");
                var input = new[] { MouseInput(0x0002), MouseInput(0x0004), MouseInput(0x0002), MouseInput(0x0004) };
                var delivered = SendInput((uint)input.Length, input, Marshal.SizeOf<NativeInput>());
                if (delivered != input.Length) throw new ProbeBlockedException($"SendInput accepted {delivered}/4 native mouse events; no success inferred.");
                timer.Start();
            }
            catch (Exception e) { error = e; ForceClose(editor); }
        }, DispatcherPriority.ApplicationIdle);
        try
        {
            editor.ShowDialog();
            // Finish queued native input after the first click closes the modal.
            PumpFor(TimeSpan.FromMilliseconds(300));
            if (error is not null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(error).Throw();
            if (saveCalls() == 0) throw new ProbeBlockedException("Editor closed without a Save callback; double-click delivery not verified.");
        }
        finally { timer.Stop(); ForceClose(editor); }
    }
    private static void PumpFor(TimeSpan interval)
    {
        var frame = new DispatcherFrame(); var timer = new DispatcherTimer { Interval = interval };
        timer.Tick += (_, _) => { timer.Stop(); frame.Continue = false; }; timer.Start();
        try { Dispatcher.PushFrame(frame); } finally { timer.Stop(); }
    }
    private static void ForceClose(Window window)
    {
        if (!window.IsVisible) return;
        window.GetType().GetField("_dirty", BindingFlags.Instance | BindingFlags.NonPublic)?.SetValue(window, false);
        window.Close();
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct NativeInput { public uint Type; public NativeMouse Mouse; }
    [StructLayout(LayoutKind.Sequential)]
    private struct NativeMouse { public int Dx, Dy; public uint MouseData, Flags, Time; public UIntPtr Extra; }
    private static NativeInput MouseInput(uint flags) => new() { Type = 0, Mouse = new() { Flags = flags } };
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, NativeInput[] input, int size);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetCursorPos(int x, int y);
    private static void InDialog(Window window, Action probe)
    {
        Exception? error = null;
        window.Dispatcher.InvokeAsync(() =>
        {
            try { probe(); }
            catch (Exception e) { error = e; }
            finally
            {
                // Cleanup only, after observations; avoid a discard-confirmation deadlock.
                ForceClose(window);
            }
        }, DispatcherPriority.ApplicationIdle);
        window.ShowDialog(); if (error is not null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(error).Throw();
    }
    private static void Pump()
    {
        var frame = new DispatcherFrame();
        Dispatcher.CurrentDispatcher.InvokeAsync(() => frame.Continue = false, DispatcherPriority.ApplicationIdle);
        Dispatcher.PushFrame(frame);
    }
    private static IEnumerable<T> Descendants<T>(DependencyObject root) where T : DependencyObject
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++)
        {
            var child = VisualTreeHelper.GetChild(root, i); if (child is T match) yield return match;
            foreach (var descendant in Descendants<T>(child)) yield return descendant;
        }
    }
    private static void Capture(Window window, string name)
    {
        window.UpdateLayout(); var content = (FrameworkElement)window.Content;
        var image = new RenderTargetBitmap((int)Math.Ceiling(content.ActualWidth), (int)Math.Ceiling(content.ActualHeight), 96, 96, PixelFormats.Pbgra32);
        image.Render(content); var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(image));
        using var file = File.Create(Path.Combine(directory, name)); encoder.Save(file);
    }
}
