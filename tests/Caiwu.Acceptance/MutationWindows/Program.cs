using Caiwu.Desktop.Testing;
using System.Collections.ObjectModel;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Caiwu.Acceptance;
using Caiwu.Contracts;
using Caiwu.Desktop;
using Caiwu.Desktop.Dialogs;
using Caiwu.Desktop.Presentation;

internal static class Program
{
    private static string output = "";
    private static readonly List<object> results = [];
    private static DesktopBackend backend = null!;
    [STAThread] private static int Main(string[] args)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Actual Windows WPF required.");
        output = Path.GetFullPath(args[0]); Directory.CreateDirectory(output);
        var app = new IndependentDesktopApplication(); app.InitializeComponent(); app.ShutdownMode = ShutdownMode.OnExplicitShutdown;
        backend = SyntheticDesktopIdentity.Backend;
        var supported = new[] { "OPENING", "ACCOUNT", "DELETE", "REVIEW", "POST", "SAME-IDENTITY-RESTORE" };
        var selected = args.Length > 1 ? new[] { args[1] } : supported;
        if (selected.Any(name => !supported.Contains(name))) throw new ArgumentException("Unknown mutation scenario.");
        foreach (var name in selected)
        {
            Console.WriteLine("START " + name);
            try { Run(name); results.Add(new { id = name, status = "PASS" }); }
            catch (Exception e) { results.Add(new { id = name, status = "FAIL", detail = e.ToString() }); Console.Error.WriteLine(name + ": " + e); }
            finally
            {
                foreach (var window in app.Windows.Cast<Window>().ToArray())
                {
                    // Cleanup after assertions only; no successful mutation/input restoration inferred.
                    window.GetType().GetField("_dirty", BindingFlags.Instance | BindingFlags.NonPublic)?.SetValue(window, false);
                    window.GetType().GetField("_openingDirty", BindingFlags.Instance | BindingFlags.NonPublic)?.SetValue(window, false);
                    window.Close();
                }
            }
        }
        var failures = results.Count(r => JsonSerializer.SerializeToElement(r).GetProperty("status").GetString() != "PASS");
        File.WriteAllText(Path.Combine(output, "mutation-windows-results.json"), JsonSerializer.Serialize(new
        {
            checkoutCommit = Environment.GetEnvironmentVariable("CAIWU_REVALIDATION_COMMIT"), actualWindowsWpf = true,
            mechanism = "Actual MainWindow mutation handlers and editor factory, real SQLite competing writer, original captured UI contexts observed unchanged; native same-process confirmation/error buttons scripted.",
            physicalKeyboardImeTested = false, failures, results
        }, new JsonSerializerOptions { WriteIndented = true }));
        app.Shutdown(); return failures == 0 ? 0 : 1;
    }
    private static void Run(string name)
    {
        var path = Path.Combine(output, name + ".caiwu"); var template = backend.Templates.Single(t => t.Regime == AccountingRegime.SmallBusiness);
        using (var seed = backend.Create(path, new(Guid.NewGuid(), name, template.Regime, template.Version, 2026, 10, 9, DateTimeOffset.UtcNow), template.Accounts))
        {
            var service = backend.CreateService(seed); var plan = service.GetSnapshot();
            if (name == "OPENING") service.SetOpeningBalances([new("1002", 100, 0), new("3001", 0, 100)], "甲", Ctx(plan));
            else if (name != "ACCOUNT")
            {
                var v = service.SaveDraft(Request(plan, null, 10), "甲");
                if (name == "POST") { var reviewPlan = service.GetSnapshot(); SyntheticDesktopIdentity.ReviewerBackend.CreateService(seed).Review(v.Id, string.Empty, Ctx(reviewPlan)); }
            }
        }
        var seen = new List<SeenMutation>();
        var uiBackend = name is "REVIEW" or "POST" ? SyntheticDesktopIdentity.ReviewerBackend : backend;
        var wrapped = uiBackend with { CreateService = store => new ObservedLedgerService(uiBackend.CreateService(store), seen) };
        var main = SyntheticDesktopIdentity.CreateMain(wrapped, asReviewer: name is "REVIEW" or "POST"); main.Show(); Call(main, "OpenVerificationBook", path); Idle();
        Check(!((ComboBox)main.FindName("OperatorInput")).IsEditable, "Arbitrary names can impersonate a reviewer.");
        var session = Field<LedgerSession>(main, "_session"); var shown = session.Snapshot!;
        using var other = backend.Open(path); var writer = backend.CreateService(other);
        var v0 = shown.Vouchers.FirstOrDefault();
        string State() => JsonSerializer.Serialize(writer.GetSnapshot());
        void OriginalContext(string method)
        {
            var command = seen.Last(x => x.Method == method); Check(command.Context == Ctx(shown), "UI refreshed or omitted source context.");
        }
        if (name == "OPENING")
        {
            Call(main, "ShowVerificationPage", 3); var grid = (DataGrid)main.FindName("OpeningGrid");
            var rows = ((IEnumerable<OpeningBalanceEdit>)grid.ItemsSource).ToArray();
            EditCell(grid, rows.Single(r => r.Code == "3001"), 3, "150.00");
            EditCell(grid, rows.Single(r => r.Code == "1002"), 2, "150.00"); // active text editor at submission
            var newer = writer.GetSnapshot(); writer.SetOpeningBalances([new("1002", 200, 0), new("3001", 0, 200)], "甲", Ctx(newer)); var before = State();
            var acknowledge = Dialogs(("数据已发生变化", 1, (Action?)null)); Call(main, "SaveOpening_Click", main, new RoutedEventArgs()); WaitForDialogs(acknowledge);
            Check(State() == before && rows.Single(r => r.Code == "1002").DebitText == "150.00" && rows.Single(r => r.Code == "3001").CreditText == "150.00", "Opening input lost or stale amount persisted.");
            OriginalContext("SetOpeningBalances"); Capture(main, name);
        }
        else if (name == "ACCOUNT")
        {
            Call(main, "ShowVerificationPage", 2); var grid = (DataGrid)main.FindName("AccountGrid");
            grid.SelectedItem = grid.Items.Cast<AccountDisplay>().Single(a => a.Code == "1001");
            Exception? fault = null; var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(150) };
            timer.Tick += (_, _) =>
            {
                var dialog = Application.Current.Windows.OfType<AccountWindow>().FirstOrDefault(); if (dialog is null) return; timer.Stop();
                try
                {
                    var input = Field<TextBox>(dialog, "_name"); input.Text = "旧表单输入仍保留";
                    var plan = writer.GetSnapshot(); writer.SaveAccount(plan.Accounts.Single(a => a.Code == "1001") with { IsActive = false }, "甲", Ctx(plan)); var before = State();
                    Visuals<Button>(dialog).Single(b => b.Content?.ToString() == "确定").RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
                    Check(dialog.IsVisible && input.Text == "旧表单输入仍保留" && Field<CheckBox>(dialog, "_active").IsChecked == true && !string.IsNullOrWhiteSpace(Field<TextBlock>(dialog, "_error").Text) && State() == before, "Stale account silently changed or lost input.");
                    OriginalContext("SaveAccount"); Capture(dialog, name);
                }
                catch (Exception e) { fault = e; }
                finally { dialog.Close(); }
            };
            timer.Start(); Call(main, "EditAccount_Click", main, new RoutedEventArgs()); timer.Stop(); if (fault is not null) throw fault;
            Check(seen.Any(s => s.Method == "SaveAccount"), "Actual account Save was not exercised.");
        }
        else if (name == "SAME-IDENTITY-RESTORE")
        {
            var editor = (VoucherEditorWindow)Call(main, "CreateVerificationEditor", v0!.Id)!; editor.Show(); Idle();
            var grid = (DataGrid)editor.FindName("LinesGrid"); var rows = (ObservableCollection<VoucherLineEdit>)grid.ItemsSource;
            rows[1].CreditText = "30.00"; EditCell(grid, rows[0], 0, "旧编辑单元格未保存"); rows[0].DebitText = "30.00";
            var clone = Path.Combine(output, "same-id-clone.caiwu"); session.BackupTo(clone); Call(main, "OpenVerificationBook", clone);
            var restored = session.Snapshot!; Check(restored.Book.Id == shown.Book.Id && restored.Revision == shown.Revision, "Restore did not preserve identity and revision.");
            var before = State(); var cloneBefore = JsonSerializer.Serialize(restored);
            ((Button)editor.FindName("SaveButton")).RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
            Check(editor.IsVisible && rows[0].Summary == "旧编辑单元格未保存" && rows[0].DebitText == "30.00" && !string.IsNullOrWhiteSpace(((TextBlock)editor.FindName("ErrorText")).Text), "Same-identity restore let old editor save or lost input.");
            Check(State() == before && JsonSerializer.Serialize(session.Service!.GetSnapshot()) == cloneBefore && !seen.Any(s => s.Method == "SaveDraft"), "Old editor reached a writer after session replacement."); Capture(editor, name);
        }
        else
        {
            Call(main, "ShowVerificationPage", 1); var grid = (DataGrid)main.FindName("VoucherGrid"); grid.SelectedItem = grid.Items[0];
            void ChangeTo20()
            {
                if (name == "POST") { var cancelPlan = writer.GetSnapshot(); writer.CancelReview(v0!.Id, "乙", Ctx(cancelPlan)); }
                var editPlan = writer.GetSnapshot(); writer.SaveDraft(Request(editPlan, v0!.Id, 20), "甲");
                if (name == "POST") { var reviewPlan = writer.GetSnapshot(); SyntheticDesktopIdentity.ReviewerBackend.CreateService(other).Review(v0.Id, string.Empty, Ctx(reviewPlan)); }
            }
            string? expected = null;
            if (name != "POST") { ChangeTo20(); expected = State(); }
            var dialogs = name == "POST" ? Dialogs(("确认记账", 6, (Action)(() => { ChangeTo20(); expected = State(); })), ("数据已发生变化", 1, null))
                : name == "DELETE" ? Dialogs(("删除草稿", 6, (Action?)null), ("数据已发生变化", 1, null)) : Dialogs(("数据已发生变化", 1, (Action?)null));
            var handler = name == "DELETE" ? "DeleteVoucher_Click" : name == "REVIEW" ? "Review_Click" : "Post_Click";
            Call(main, handler, main, new RoutedEventArgs()); WaitForDialogs(dialogs);
            Check(expected is not null && State() == expected, "Stale selected/confirmed voucher mutated unseen amount/status/audit.");
            OriginalContext(name == "DELETE" ? "DeleteDraft" : name == "REVIEW" ? "Review" : "Post"); Capture(main, name);
        }
    }
    private static LedgerMutationContext Ctx(LedgerSnapshot s) => new(s.Book.Id, s.Revision);
    private static VoucherDraft Request(LedgerSnapshot s, Guid? id, decimal amount) => new(id, new(2026, 10, 1), "记", null, 0, [new("1002", "原十元", amount, 0), new("3001", "原十元", 0, amount)], s.Revision, s.Book.Id);
    private static void Check(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
    private static T Field<T>(object target, string field) => (T)target.GetType().GetField(field, BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(target)!;
    private static object? Call(object target, string method, params object?[] args) => target.GetType().GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(target, args);
    private static IEnumerable<T> Visuals<T>(DependencyObject root) where T : DependencyObject
    { for (var i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++) { var c = VisualTreeHelper.GetChild(root, i); if (c is T t) yield return t; foreach (var t2 in Visuals<T>(c)) yield return t2; } }
    private static void Idle() => Dispatcher.CurrentDispatcher.Invoke(() => { }, DispatcherPriority.ApplicationIdle);
    private static void EditCell(DataGrid grid, object row, int column, string text)
    {
        grid.CommitEdit(); grid.ScrollIntoView(row, grid.Columns[column]); grid.CurrentCell = new(row, grid.Columns[column]); grid.Focus();
        Check(grid.BeginEdit(), "Actual DataGrid did not enter edit mode."); Idle();
        var content = grid.Columns[column].GetCellContent(row); var input = content as TextBox ?? (content is null ? null : Visuals<TextBox>(content).FirstOrDefault());
        Check(input is not null, "Active editing TextBox not found."); input!.Focus(); input.Text = text;
    }
    private static Task Dialogs(params (string Title, int Button, Action? BeforeClick)[] sequence)
    {
        var task = Task.Run(() =>
        {
        foreach (var item in sequence)
        {
            var deadline = DateTime.UtcNow.AddSeconds(12); IntPtr dialog;
            do { dialog = FindDialog(item.Title); if (dialog != IntPtr.Zero) break; Thread.Sleep(30); } while (DateTime.UtcNow < deadline);
            Check(dialog != IntPtr.Zero, "Expected actual same-process native dialog missing: " + item.Title);
            var text = new StringBuilder(); EnumChildWindows(dialog, (child, _) => { var part = new StringBuilder(2048); GetWindowText(child, part, part.Capacity); text.AppendLine(part.ToString()); return true; }, IntPtr.Zero);
            File.AppendAllText(Path.Combine(output, "native-dialogs.jsonl"), JsonSerializer.Serialize(new { title = item.Title, text = text.ToString() }) + Environment.NewLine);
            if (item.Title == "确认记账") Check(text.ToString().Contains("10.00"), "Actual native confirmation did not show the original ten-unit amount.");
            item.BeforeClick?.Invoke(); var button = ReadyButton(dialog, item.Button);
            File.AppendAllText(Path.Combine(output, "native-driver.jsonl"), JsonSerializer.Serialize(new
            { item.Title, requestedButton = item.Button, actualButton = GetDlgCtrlID(button), foundButton = button != IntPtr.Zero,
                visible = IsWindowVisible(button), enabled = IsWindowEnabled(button) }) + Environment.NewLine);
            Check(button != IntPtr.Zero && IsWindowVisible(button) && IsWindowEnabled(button), "Native confirmation button missing/disabled/hidden.");
            // BM_CLICK requires an active dialog (Microsoft's documented precondition).
            // Only the same-process dialog found above can receive this native activation/click.
            SetForegroundWindow(dialog);
            var completed = SendMessageTimeout(button, 0x00F5, IntPtr.Zero, IntPtr.Zero, 0x0002, 5000, out _);
            var error = Marshal.GetLastPInvokeError();
            File.AppendAllText(Path.Combine(output, "native-driver.jsonl"), JsonSerializer.Serialize(new
            { item.Title, clickCompleted = completed != IntPtr.Zero, win32Error = error }) + Environment.NewLine);
            Check(completed != IntPtr.Zero,
                "Native confirmation click did not complete within five seconds.");
            var closeDeadline = DateTime.UtcNow.AddSeconds(5);
            while (FindDialog(item.Title) == dialog && DateTime.UtcNow < closeDeadline) Thread.Sleep(30);
            Check(FindDialog(item.Title) != dialog, "Native confirmation remained visible after clicking its real button.");
        }
        });
        // A modal UI can remain open when its driver faults. Report that cause
        // immediately so the outer process watchdog cannot hide it as a timeout.
        _ = task.ContinueWith(t => Console.Error.WriteLine("NATIVE-DIALOG-DRIVER-FAIL: " + t.Exception),
            CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted, TaskScheduler.Default);
        return task;
    }
    private static IntPtr ReadyButton(IntPtr dialog, int requested)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        do
        {
            var preferred = GetDlgItem(dialog, requested);
            if (preferred != IntPtr.Zero && IsWindowVisible(preferred) && IsWindowEnabled(preferred)) return preferred;
            if (requested == 1)
            {
                // The observed Windows OK-only message box has no child at IDOK=1.
                // Resolve the one real OK control, rather than assume its Win32 ID.
                var buttons = new List<IntPtr>();
                EnumChildWindows(dialog, (child, _) =>
                {
                    var cls = new StringBuilder(64); GetClassName(child, cls, cls.Capacity);
                    if (cls.ToString().Equals("Button", StringComparison.OrdinalIgnoreCase) && IsWindowVisible(child) && IsWindowEnabled(child)) buttons.Add(child);
                    return true;
                }, IntPtr.Zero);
                if (buttons.Count == 1)
                {
                    var caption = new StringBuilder(128); GetWindowText(buttons[0], caption, caption.Capacity);
                    var label = caption.ToString().Replace("&", "", StringComparison.Ordinal).Trim();
                    if (label.Equals("OK", StringComparison.OrdinalIgnoreCase) || label.StartsWith("确定", StringComparison.Ordinal)) return buttons[0];
                }
            }
            Thread.Sleep(30);
        } while (DateTime.UtcNow < deadline);
        throw new InvalidOperationException("Expected unique visible native confirmation button was not ready; requested ID " + requested);
    }
    private static void WaitForDialogs(Task task)
    {
        // The real application returns to its WPF loop after the handler. The probe
        // must also pump while the native driver finishes; GetWindowText from the
        // driver can synchronously send WM_GETTEXT to this UI thread.
        var dispatcher = Dispatcher.CurrentDispatcher;
        var frame = new DispatcherFrame();
        _ = task.ContinueWith(_ => dispatcher.BeginInvoke(() => frame.Continue = false), TaskScheduler.Default);
        Dispatcher.PushFrame(frame);
        task.GetAwaiter().GetResult();
    }
    private static IntPtr FindDialog(string title)
    {
        var found = IntPtr.Zero; EnumWindows((h, _) => { GetWindowThreadProcessId(h, out var pid); var text = new StringBuilder(256); GetWindowText(h, text, text.Capacity); var cls = new StringBuilder(64); GetClassName(h, cls, cls.Capacity); if (pid == Environment.ProcessId && IsWindowVisible(h) && text.ToString() == title && cls.ToString() == "#32770") { found = h; return false; } return true; }, IntPtr.Zero); return found;
    }
    private static void Capture(Window window, string name)
    {
        window.UpdateLayout(); var dpi = VisualTreeHelper.GetDpi(window); var bitmap = new RenderTargetBitmap((int)Math.Ceiling(window.ActualWidth * dpi.DpiScaleX), (int)Math.Ceiling(window.ActualHeight * dpi.DpiScaleY), dpi.PixelsPerInchX, dpi.PixelsPerInchY, PixelFormats.Pbgra32); bitmap.Render(window);
        var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap)); using var stream = File.Create(Path.Combine(output, name + ".png")); encoder.Save(stream);
    }
    private delegate bool EnumProc(IntPtr handle, IntPtr arg);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr arg);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr window, EnumProc callback, IntPtr arg);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out int pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll")] private static extern IntPtr GetDlgItem(IntPtr window, int id);
    [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wparam, IntPtr lparam, uint flags, uint timeout, out UIntPtr result);
}
