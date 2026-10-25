using System.Collections.ObjectModel;
using System.IO;
using System.Reflection;
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
    private static int failures;
    private static string directory = "";

    [STAThread]
    private static int Main(string[] args)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Actual WPF runtime required.");
        directory = Path.GetFullPath(args.Length == 0 ? "tests/Caiwu.Acceptance/evidence/runtime/wpf" : args[0]);
        Directory.CreateDirectory(directory);
        var app = new App(); app.InitializeComponent(); app.ShutdownMode = ShutdownMode.OnExplicitShutdown;
        var backend = new DesktopBackend(SqliteLedgerStore.Open, SqliteLedgerStore.Create,
            SqliteLedgerStore.RestoreBackup, s => new LedgerService(s), TemplateCatalog.All);
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
            foreach (var (page, name) in new[] { (1, "VoucherGrid"), (3, "OpeningGrid"), (4, "TrialGrid") })
            {
                Call(window, "ShowVerificationPage", page); Pump();
                Capture(window, name + ".png");
                var grid = (DataGrid)window.FindName(name);
                var widths = grid.Columns.Select(c => c.ActualWidth).ToArray();
                Assert(widths.All(w => w >= 55), name + " collapsed columns: " + string.Join(",", widths));
            }
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
            });
            transaction.Rollback();
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
            mechanism = "Actual production WPF classes/resources, real SQLite; scripted routed events/reflection. No physical keyboard/IME/file-dialog automation.",
            failures, results = Results
        }, new JsonSerializerOptions { WriteIndented = true }));
        app.Shutdown(); return failures == 0 ? 0 : 1;
    }
    private static void Check(string id, Action action)
    {
        try { action(); Results.Add(new { id, status = "PASS" }); Console.WriteLine("PASS " + id); }
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
                window.GetType().GetField("_dirty", BindingFlags.Instance | BindingFlags.NonPublic)?.SetValue(window, false);
                window.Close();
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
