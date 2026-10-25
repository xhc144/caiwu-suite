using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Caiwu.Contracts;
using Caiwu.Acceptance;
using Caiwu.Core;
using Caiwu.Desktop;
using Caiwu.Desktop.Dialogs;
using Caiwu.Desktop.Presentation;
using Microsoft.Data.Sqlite;

internal static class Program
{
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };
    [STAThread]
    private static int Main(string[] args)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Actual Windows WPF required.");
        try { return args[0] == "--child" ? Child(args[1], args[2], args[3]) : Parent(args[0]); }
        catch (Exception ex) { Console.Error.WriteLine(ex); return 1; }
    }
    private static DesktopBackend Backend() => (DesktopBackend)typeof(App).GetMethod("CreateBackend", BindingFlags.NonPublic | BindingFlags.Static)!.Invoke(null, null)!;
    private static string Digest(object value) => Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value)));
    private static void Require(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
    private static void Write(string path, object value)
    {
        var stage = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        File.WriteAllText(stage, JsonSerializer.Serialize(value, Json)); File.Move(stage, path, true);
    }
    private static JsonElement Read(string path) => JsonDocument.Parse(File.ReadAllText(path)).RootElement.Clone();
    private static void WaitFile(string path, params Process[] children)
    {
        var deadline = DateTime.UtcNow.AddSeconds(25);
        while (!File.Exists(path))
        {
            if (children.Any(p => p.HasExited)) throw new InvalidOperationException("Child exited before evidence: " + Path.GetFileName(path));
            if (DateTime.UtcNow >= deadline) throw new TimeoutException("Missing bounded child evidence: " + Path.GetFileName(path));
            Thread.Sleep(100);
        }
    }
    private static int Parent(string output)
    {
        var root = Path.GetFullPath(output); Directory.CreateDirectory(root); var results = new List<object>();
        void Case(string id, Action action)
        {
            try { action(); results.Add(new { id, status = "PASS" }); Console.WriteLine("PASS " + id); }
            catch (Exception e) { results.Add(new { id, status = "FAIL", error = e.ToString() }); Console.Error.WriteLine("FAIL " + id + " " + e.Message); }
        }
        var backend = Backend();
        (string, Guid) Seed(string directory, string name)
        {
            Directory.CreateDirectory(directory); var path = Path.Combine(directory, name + ".caiwu");
            var template = TemplateCatalog.Get(AccountingRegime.SmallBusiness);
            using var store = backend.Create(path, new(Guid.NewGuid(), name, template.Regime, template.Version, 2026, 10, 9, DateTimeOffset.UtcNow), template.Accounts);
            var service = backend.CreateService(store);
            var seedPlan = service.GetSnapshot();
            var v = service.SaveDraft(new(null, new(2026, 10, 1), "记", null, 0,
                [new("1002", "初始十元", 10, 0), new("3001", "初始十元", 0, 10)], seedPlan.Revision, seedPlan.Book.Id), "甲");
            return (path, v.Id);
        }
        Case("APP-BACKEND-VALIDATES-OPEN-AND-RESTORE-BEFORE-STORAGE", () =>
        {
            var (path, _) = Seed(Path.Combine(root, "policy"), "synthetic-untrusted");
            using (var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString()))
            {
                db.Open(); using var command = db.CreateCommand();
                command.CommandText = "CREATE TRIGGER synthetic_probe AFTER UPDATE ON ledger BEGIN UPDATE ledger SET name='must-not-run' WHERE singleton=1; END";
                command.ExecuteNonQuery();
            }
            var before = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(path))); var destination = path + ".restored.caiwu";
            var openRejected = false; var restoreRejected = false;
            try { using var unexpected = backend.Open(path); } catch (InvalidDataException) { openRejected = true; }
            try { backend.Restore(path, destination); } catch (InvalidDataException) { restoreRejected = true; }
            Require(openRejected && restoreRejected && !File.Exists(destination), "Actual App backend did not gate untrusted trigger-bearing input.");
            Require(Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(path))) == before, "Rejected source bytes changed.");
        });
        foreach (var separateBooks in new[] { false, true })
        {
            var scenario = separateBooks ? "TWO-APPLICATION-PROCESSES-SEPARATE-BOOKS" : "TWO-APPLICATION-PROCESSES-STALE-EDITOR";
            Case(scenario, () =>
            {
                var directory = Path.Combine(root, scenario); Directory.CreateDirectory(directory);
                var (aPath, _) = Seed(directory, "book-a"); var bPath = separateBooks ? Seed(directory, "book-b").Item1 : aPath;
                var aDir = Path.Combine(directory, "A"); var bDir = Path.Combine(directory, "B"); Directory.CreateDirectory(aDir); Directory.CreateDirectory(bDir);
                using var a = StartChild("A", aPath, aDir); using var b = StartChild("B", bPath, bDir);
                try
                {
                    WaitFile(Path.Combine(aDir, "ready.json"), a, b); WaitFile(Path.Combine(bDir, "ready.json"), a, b);
                    var readyA = Read(Path.Combine(aDir, "ready.json")); var readyB = Read(Path.Combine(bDir, "ready.json"));
                    Require(readyA.GetProperty("processId").GetInt32() != readyB.GetProperty("processId").GetInt32(), "Two processes were not created.");
                    Require((readyA.GetProperty("openingBookId").GetGuid() != readyB.GetProperty("openingBookId").GetGuid()) == separateBooks, "Book identity setup mismatch.");
                    var typedB = Command(bDir, 1, "type", "30.00", a, b); var typedA = Command(aDir, 1, "type", "20.00", a, b);
                    Require(typedA.GetProperty("inputDebit").GetString() == "20.00" && typedB.GetProperty("inputDebit").GetString() == "30.00", "Editor inputs were not populated.");
                    var acceptedA = Command(aDir, 2, "save", "", b);
                    Require(!acceptedA.GetProperty("editorVisible").GetBoolean() && acceptedA.GetProperty("storedAmount").GetDecimal() == 20, "A did not save 20 through actual editor.");
                    var outcomeB = Command(bDir, 2, "save", "", b);
                    if (separateBooks)
                    {
                        Require(!outcomeB.GetProperty("editorVisible").GetBoolean() && outcomeB.GetProperty("storedAmount").GetDecimal() == 30, "B's separate book failed to save its own amount.");
                        using var aStore = backend.Open(aPath); using var bStore = backend.Open(bPath);
                        Require(aStore.Read().Vouchers.Single().Lines[0].Debit == 20 && bStore.Read().Vouchers.Single().Lines[0].Debit == 30, "Separate-book data leaked.");
                    }
                    else
                    {
                        AssertRejectedB(outcomeB, readyB);
                        var retry = Command(bDir, 3, "save", "", b); AssertRejectedB(retry, readyB);
                        Require(retry.GetProperty("snapshotSha256").GetString() == acceptedA.GetProperty("snapshotSha256").GetString(), "Rejected attempts changed new data/audit/revision.");
                        Command(bDir, 4, "close", "", b);
                    }
                    Require(a.WaitForExit(10000) && b.WaitForExit(10000) && a.ExitCode == 0 && b.ExitCode == 0, "Child process did not end cleanly.");
                }
                finally
                {
                    if (!a.HasExited) a.Kill(true); if (!b.HasExited) b.Kill(true);
                }
            });
        }
        var failed = results.Count(r => JsonSerializer.SerializeToElement(r).GetProperty("status").GetString() == "FAIL");
        Write(Path.Combine(root, "dual-windows-results.json"), new
        {
            actualWindowsWpf = true, checkoutCommit = Environment.GetEnvironmentVariable("CAIWU_REVALIDATION_COMMIT"),
            mechanism = "Two separate .NET processes, each actual MainWindow+VoucherEditorWindow; controls and Save routed events scripted. File opening uses the existing verification hook, not native file-dialog automation.",
            physicalKeyboardImeTested = false, nativeFileDialogsTested = false, deliveryBlocked = true, failed, results
        });
        return failed == 0 ? 0 : 1;
    }
    private static void AssertRejectedB(JsonElement state, JsonElement ready)
    {
        Require(state.GetProperty("editorVisible").GetBoolean() && state.GetProperty("inputDebit").GetString() == "30.00" && state.GetProperty("inputCredit").GetString() == "30.00" && state.GetProperty("inputSummary").GetString() == "未保存输入-B", "B closed or lost original input.");
        Require(!string.IsNullOrWhiteSpace(state.GetProperty("error").GetString()) && state.GetProperty("storedAmount").GetDecimal() == 20, "B silently overwrote A or showed no conflict.");
        foreach (var token in state.GetProperty("sentTokens").EnumerateArray())
            Require(token.GetProperty("expectedRevision").GetInt64() == ready.GetProperty("openingRevision").GetInt64() && token.GetProperty("expectedBookId").GetGuid() == ready.GetProperty("openingBookId").GetGuid(), "B refreshed or omitted original tokens.");
    }
    private static JsonElement Command(string directory, int seq, string kind, string amount, params Process[] children)
    {
        Write(Path.Combine(directory, "command.json"), new { seq, kind, amount });
        var evidence = Path.Combine(directory, "event-" + seq + ".json"); WaitFile(evidence, children); return Read(evidence);
    }
    private static Process StartChild(string role, string path, string output)
    {
        var start = new ProcessStartInfo("dotnet") { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var arg in new[] { Assembly.GetExecutingAssembly().Location, "--child", role, path, output }) start.ArgumentList.Add(arg);
        var process = Process.Start(start)!;
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) File.AppendAllText(Path.Combine(output, "stdout.log"), e.Data + Environment.NewLine); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) File.AppendAllText(Path.Combine(output, "stderr.log"), e.Data + Environment.NewLine); };
        process.BeginOutputReadLine(); process.BeginErrorReadLine(); return process;
    }
    private static int Child(string role, string path, string output)
    {
        var app = new App(); app.InitializeComponent(); app.ShutdownMode = ShutdownMode.OnExplicitShutdown;
        var seen = new List<SeenMutation>(); var actualBackend = Backend();
        var backend = actualBackend with { CreateService = store => new ObservedLedgerService(actualBackend.CreateService(store), seen) };
        var main = new MainWindow(backend); app.MainWindow = main; main.Show();
        Call(main, "OpenVerificationBook", path);
        var session = (LedgerSession)typeof(MainWindow).GetField("_session", BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(main)!;
        var opening = session.Service!.GetSnapshot(); var original = opening.Vouchers.Single();
        var editor = (VoucherEditorWindow)Call(main, "CreateVerificationEditor", original.Id)!;
        editor.Title = "Independent dual editor " + role; editor.WindowStartupLocation = WindowStartupLocation.Manual;
        editor.Left = role == "A" ? 25 : 450; editor.Top = 45;
        var rows = (ObservableCollection<VoucherLineEdit>)((DataGrid)editor.FindName("LinesGrid")).ItemsSource;
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) }; var last = 0; Exception? fault = null;
        object State(string kind)
        {
            // Current data is read only for evidence; it NEVER supplies the editor's token.
            var current = session.Service!.GetSnapshot();
            return new { role, kind, processId = Environment.ProcessId, openingBookId = opening.Book.Id, openingRevision = opening.Revision,
                editorVisible = editor.IsVisible, inputDebit = rows[0].DebitText, inputCredit = rows[1].CreditText,
                inputSummary = rows[0].Summary, error = ((TextBlock)editor.FindName("ErrorText")).Text,
                storedBookId = current.Book.Id, storedRevision = current.Revision, storedAmount = current.Vouchers.Single().Lines[0].Debit,
                vouchers = current.Vouchers.Count, auditEvents = current.AuditEvents.Count, snapshotSha256 = Digest(current), sentTokens = seen.Where(x => x.Draft is not null).Select(x => new { expectedRevision = x.Draft!.ExpectedRevision, expectedBookId = x.Draft.ExpectedBookId }).ToArray() };
        }
        editor.Loaded += (_, _) => editor.Dispatcher.InvokeAsync(() =>
        {
            Capture(main, Path.Combine(output, "main-window.png")); Capture(editor, Path.Combine(output, "editor-ready.png"));
            Write(Path.Combine(output, "ready.json"), State("ready")); timer.Start();
        }, DispatcherPriority.ApplicationIdle);
        timer.Tick += (_, _) =>
        {
            try
            {
                var commandPath = Path.Combine(output, "command.json"); if (!File.Exists(commandPath)) return;
                var command = Read(commandPath); var seq = command.GetProperty("seq").GetInt32(); if (seq <= last) return; last = seq;
                var kind = command.GetProperty("kind").GetString();
                if (kind == "type")
                {
                    rows[0].Summary = rows[1].Summary = "未保存输入-" + role;
                    rows[0].DebitText = rows[1].CreditText = command.GetProperty("amount").GetString()!;
                }
                else if (kind == "save")
                {
                    ((Button)editor.FindName("SaveButton")).RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
                }
                else if (kind == "close") { typeof(VoucherEditorWindow).GetField("_dirty", BindingFlags.NonPublic | BindingFlags.Instance)?.SetValue(editor, false); editor.Close(); }
                else throw new InvalidDataException("Unknown bounded child command.");
                if (editor.IsVisible) Capture(editor, Path.Combine(output, "editor-event-" + seq + ".png"));
                Write(Path.Combine(output, "event-" + seq + ".json"), State(kind!));
            }
            catch (Exception ex)
            {
                fault = ex; timer.Stop(); Console.Error.WriteLine(ex);
                typeof(VoucherEditorWindow).GetField("_dirty", BindingFlags.NonPublic | BindingFlags.Instance)?.SetValue(editor, false); editor.Close();
            }
        };
        try { editor.ShowDialog(); }
        finally { timer.Stop(); main.Close(); app.Shutdown(); }
        if (fault is not null) throw fault;
        return 0;
    }
    private static object? Call(object instance, string method, params object[] args) => instance.GetType().GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(instance, args);
    private static void Capture(Window window, string path)
    {
        window.UpdateLayout(); var dpi = VisualTreeHelper.GetDpi(window);
        var bitmap = new RenderTargetBitmap((int)Math.Ceiling(window.ActualWidth * dpi.DpiScaleX), (int)Math.Ceiling(window.ActualHeight * dpi.DpiScaleY), 96 * dpi.DpiScaleX, 96 * dpi.DpiScaleY, PixelFormats.Pbgra32);
        bitmap.Render(window); var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var file = File.Create(path); encoder.Save(file);
    }
}
