using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using Caiwu.BookTools;
using Caiwu.BookTools.Wpf;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Persistence.Sqlite;
using Caiwu.Summaries;
using Caiwu.Summaries.Wpf;
using Caiwu.VoucherTools.Wpf;

internal static class Program
{
    internal static string Output = "";
    private static readonly List<string> checks = [];
    private static readonly List<object> observations = [];
    [STAThread]
    private static int Main(string[] args)
    {
        var name = args[0]; Output = Path.GetFullPath(args[1]); Directory.CreateDirectory(Output);
        var root = Path.Combine(Path.GetTempPath(), "caiwu-module-qa-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        Application? app = null;
        string? error = null;
        try
        {
            Need(OperatingSystem.IsWindows(), "actual Windows required");
            app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            app.Resources.MergedDictionaries.Add(new ResourceDictionary { Source = new Uri("/Caiwu.Desktop;component/Themes/Modern.xaml", UriKind.Relative) });
            Need(app.Resources["AppCanvas"] is SolidColorBrush, "exact production Modern.xaml resources loaded without product startup");
            switch (name)
            {
                case "book-preview-cancel": BookPreview(root); break;
                case "book-full": BookSuccess(root, false); break;
                case "book-opening": BookSuccess(root, true); break;
                case "book-stale": BookStale(root); break;
                case "book-busy-cancel": BookBusyCancel(root); break;
                case "book-race": BookRace(root); break;
                case "voucher-focus-sqlite": Voucher(root, false); break;
                case "voucher-stale-sqlite": Voucher(root, true); break;
                case "summary-bad-query": SummaryBadQuery(root); break;
                default: throw new ArgumentException("Unknown case: " + name);
            }
        }
        catch (Exception ex) { error = ex.ToString(); Console.Error.WriteLine(error); }
        finally
        {
            app?.Shutdown();
            try { Directory.Delete(root, true); }
            catch (Exception ex) { error = (error ?? "") + "\nSynthetic cleanup failed: " + ex; }
            File.WriteAllText(Path.Combine(Output, name + ".json"), JsonSerializer.Serialize(new
            {
                name, passed = error is null, error, checks, observations,
                checkoutCommit = Environment.GetEnvironmentVariable("CAIWU_MODULE_QA_COMMIT"),
                actualWindowsWpf = OperatingSystem.IsWindows(),
                inputMethod = "Actual modal WPF windows; direct Text/SelectedValue properties and RoutedEvent Click. Keyboard focus inspected; native keyboard, mouse and IME not exercised.",
                data = "new synthetic temporary books only", captures = NativeCapture.Captures
            }, new JsonSerializerOptions { WriteIndented = true }));
        }
        return error is null ? 0 : 1;
    }
    private static void BookPreview(string root)
    {
        var source = CreateBook(root, "source"); var shown = Read(source); var hash = Hash(source);
        var target = Path.Combine(root, "target.caiwu");
        var dialog = new BookCopyWindow(new(), shown, source, "合成操作员");
        Drive(dialog, () =>
        {
            ClickContent(dialog, "生成复制前预览");
            Need(dialog.IsVisible && !string.IsNullOrWhiteSpace(Find<TextBlock>(dialog, "StatusText").Text), "invalid preview stays open with error");
            Need(!Find<Button>(dialog, "ExecuteButton").IsEnabled, "invalid preview cannot execute");
            SetBook(dialog, target); ClickContent(dialog, "生成复制前预览");
            Need(!File.Exists(target) && Hash(source) == hash, "preview does not write source or target");
            Need(Find<CheckBox>(dialog, "Confirmation").IsEnabled && !Find<Button>(dialog, "ExecuteButton").IsEnabled, "preview requires explicit approval");
            Need(Find<TextBlock>(dialog, "PreviewText").Text.Contains("新 BookId"), "preview identifies new identity");
            Find<CheckBox>(dialog, "Confirmation").IsChecked = true; Flush();
            Need(Find<Button>(dialog, "ExecuteButton").IsEnabled, "checkbox enables execute");
            BookBox(dialog, "NewBookName").Text = "合成改名重新预览"; Flush();
            Need(!Find<Button>(dialog, "ExecuteButton").IsEnabled && Find<CheckBox>(dialog, "Confirmation").IsChecked == false, "changed input invalidates plan and approval");
            NativeCapture.Save(dialog, "book-preview-invalidated.png");
            Click(dialog, "CancelButton");
        });
        Need(dialog.Result is null && !File.Exists(target) && Hash(source) == hash, "cancel leaves both books unchanged");
        Need(!Directory.GetDirectories(root).Any(), "cancel creates no temporary workspace");
    }
    private static void BookSuccess(string root, bool opening)
    {
        var source = CreateBook(root, "source"); var shown = Read(source); var hash = Hash(source);
        var target = Path.Combine(root, "target.caiwu");
        var dialog = new BookCopyWindow(new(), shown, source, "合成复制员");
        Drive(dialog, () =>
        {
            SetBook(dialog, target);
            Find<ComboBox>(dialog, "ScopeBox").SelectedIndex = opening ? 1 : 0; Flush();
            ClickContent(dialog, "生成复制前预览");
            Need(!File.Exists(target), "actual preview has no target");
            NativeCapture.Save(dialog, opening ? "book-opening-preview.png" : "book-full-preview.png");
            Find<CheckBox>(dialog, "Confirmation").IsChecked = true; Flush();
            Click(dialog, "ExecuteButton");
        }, waitsForAsyncClose: true);
        var result = dialog.Result ?? throw new InvalidOperationException("Actual window did not return success");
        var actual = Read(target);
        Need(actual.Book.Id == result.Book.Id && actual.Book.Id != shown.Book.Id && actual.Book.Name == "合成复制目标", "copy creates planned fresh book identity");
        Need(actual.Revision == 1 && Json(actual.Accounts) == Json(shown.Accounts), "copy persists accounts and original openings exactly");
        Need(Json(actual.Vouchers) == Json(opening ? Array.Empty<Voucher>() : shown.Vouchers), "selected scope persists exact vouchers");
        Need(actual.AuditEvents.Count == (opening ? 1 : shown.AuditEvents.Count + 1), "copy persists provenance and selected audit scope");
        Need(Hash(source) == hash && !Directory.GetDirectories(root).Any(), "success preserves source and cleans staging");
        observations.Add(new { result.Book.Id, targetSha256 = Hash(target), sourceSha256 = hash, opening });
    }
    private static void BookStale(string root)
    {
        var source = CreateBook(root, "source"); var shown = Read(source); var target = Path.Combine(root, "target.caiwu");
        var dialog = new BookCopyWindow(new(), shown, source, "合成复制员");
        Drive(dialog, () =>
        {
            SetBook(dialog, target); ClickContent(dialog, "生成复制前预览");
            using (var store = SqliteLedgerStore.Open(source))
                new LedgerService(store).SaveAccount(shown.Accounts[0] with { Name = "另一窗口已保存" }, "另一合成员", new(shown.Book.Id, shown.Revision));
            var changed = Hash(source);
            Find<CheckBox>(dialog, "Confirmation").IsChecked = true; Flush(); Click(dialog, "ExecuteButton");
            Poll(dialog, () => Find<TextBlock>(dialog, "StatusText").Text.Contains("源账套已变化"), () =>
            {
                Need(dialog.IsVisible && dialog.Result is null && !File.Exists(target), "stale source fails inside window without publishing");
                Need(BookBox(dialog, "NewBookName").Text == "合成复制目标" && Hash(source) == changed, "failed execute retains input and concurrent winner");
                Need(!Find<Button>(dialog, "ExecuteButton").IsEnabled, "failed stale plan requires fresh approval");
                NativeCapture.Save(dialog, "book-stale-error.png"); Click(dialog, "CancelButton");
            });
        }, waitsForAsyncClose: true);
    }
    private static void BookBusyCancel(string root)
    {
        var source = CreateBook(root, "source"); var shown = Read(source); var hash = Hash(source); var target = Path.Combine(root, "target.caiwu");
        using var reached = new ManualResetEventSlim(); using var release = new ManualResetEventSlim();
        var service = new BookCopyService(validateSource: _ =>
        {
            reached.Set(); if (!release.Wait(TimeSpan.FromSeconds(10))) throw new TimeoutException("controlled capture gate");
        });
        var dialog = new BookCopyWindow(service, shown, source, "合成复制员");
        try
        {
            Drive(dialog, () =>
            {
                SetBook(dialog, target); ClickContent(dialog, "生成复制前预览");
                Find<CheckBox>(dialog, "Confirmation").IsChecked = true; Flush(); Click(dialog, "ExecuteButton");
                Poll(dialog, () => reached.IsSet, () =>
                {
                    Click(dialog, "CancelButton"); release.Set();
                    Poll(dialog, () => Find<TextBlock>(dialog, "StatusText").Text.Contains("已取消"), () =>
                    {
                        Need(dialog.Result is null && !File.Exists(target) && Hash(source) == hash, "busy cancel safely exits before publication without writes");
                        NativeCapture.Save(dialog, "book-cancelled.png"); Click(dialog, "CancelButton");
                    });
                });
            }, waitsForAsyncClose: true);
        }
        finally { release.Set(); }
        Need(!Directory.GetDirectories(root).Any(), "busy cancellation cleans owned workspace");
    }
    private sealed record Outcome(BookCopyResult? Result, string? Error, string? Hash);
    private static void BookRace(string root)
    {
        for (var round = 0; round < 30; round++)
        {
            var dir = Path.Combine(root, "round-" + round); Directory.CreateDirectory(dir);
            var sourceA = CreateBook(dir, "a"); var sourceB = CreateBook(dir, "b");
            var hashA = Hash(sourceA); var hashB = Hash(sourceB); var target = Path.Combine(dir, "winner.caiwu");
            using var barrier = new Barrier(2);
            BookCopyService Make()
            {
                var calls = 0;
                return new(validateDestination: _ =>
                {
                    if (Interlocked.Increment(ref calls) == 2 && !barrier.SignalAndWait(TimeSpan.FromSeconds(10)))
                        throw new TimeoutException("final publication barrier");
                });
            }
            var a = Make(); var b = Make();
            var pa = a.Preview(Read(sourceA), new(sourceA, target, "合成竞争A", BookCopyScope.FullLedger, "A"));
            var pb = b.Preview(Read(sourceB), new(sourceB, target, "合成竞争B", BookCopyScope.FullLedger, "B"));
            Task<Outcome> Run(BookCopyService s, BookCopyPlan p) => Task.Factory.StartNew(() =>
            {
                try { var r = s.Execute(p); return new Outcome(r, null, Hash(target)); }
                catch (Exception ex) { return new Outcome(null, ex.GetType().FullName + ": " + ex.Message, null); }
            }, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
            var outcomes = Task.WhenAll(Run(a, pa), Run(b, pb)).GetAwaiter().GetResult();
            var winners = outcomes.Where(x => x.Result is not null).ToArray();
            var actual = Read(target); var after = Hash(target);
            observations.Add(new { round, winnerCount = winners.Length, savedBookId = actual.Book.Id, sourceAHash = hashA, sourceBHash = hashB, finalHash = after, outcomes });
            File.WriteAllText(Path.Combine(Output, "race-observations.json"), Json(observations));
            Need(winners.Length == 1, "round " + round + " exactly one publisher succeeds");
            Need(outcomes.Single(x => x.Result is null).Error!.StartsWith("System.IO.IOException:"), "round " + round + " loser reports IOException");
            Need(actual.Book == winners[0].Result!.Book && after == winners[0].Hash, "round " + round + " winner identity and bytes survive loser cleanup");
            Need(hashA == Hash(sourceA) && hashB == Hash(sourceB), "round " + round + " both source byte hashes unchanged");
            Need(!Directory.GetDirectories(dir).Any(), "round " + round + " both temporary workspaces removed");
        }
    }
    private static void Voucher(string root, bool stale)
    {
        var source = CreateBook(root, "voucher"); var shown = Read(source); var before = Json(shown);
        var dialog = new VoucherCopyWindow(shown, shown.Vouchers[0].Id, "当前合成制单员");
        Drive(dialog, () =>
        {
            Need(Find<TextBox>(dialog, "DateInput").IsKeyboardFocused, "initial focus is actual date input");
            Set(dialog, "DateInput", "2026-02-30"); Set(dialog, "KindInput", "转"); Set(dialog, "NumberInput", "9"); Set(dialog, "AttachmentInput", "0");
            Click(dialog, "ConfirmButton");
            Need(dialog.IsVisible && Find<TextBox>(dialog, "DateInput").IsKeyboardFocused, "invalid date keeps window and actual keyboard focus");
            Need(Read(source).Revision == shown.Revision && Json(Read(source)) == before, "invalid confirmation does not write actual SQLite");
            NativeCapture.Save(dialog, "voucher-error-focus.png");
            if (stale)
            {
                using var store = SqliteLedgerStore.Open(source);
                new LedgerService(store).SaveAccount(shown.Accounts[0] with { Name = "同快照并发胜者" }, "另一合成员", new(shown.Book.Id, shown.Revision));
            }
            Set(dialog, "DateInput", "2026-02-01"); Click(dialog, "ConfirmButton");
        });
        var plan = dialog.Plan ?? throw new InvalidOperationException("valid actual dialog has no plan");
        Need(plan.Draft.ExpectedBookId == shown.Book.Id && plan.Draft.ExpectedRevision == shown.Revision && plan.Draft.Id is null, "dialog preserves original snapshot token and fresh identity");
        var current = Read(source); var hash = Hash(source);
        using (var store = SqliteLedgerStore.Open(source))
        {
            if (stale)
            {
                try { new LedgerService(store).SaveDraft(plan.Draft, plan.PreparedBy); throw new InvalidOperationException("stale plan saved"); }
                catch (StoreConcurrencyException) { }
                Need(Json(store.Read()) == Json(current), "real Core/SQLite rejects stale plan without replacing winner");
            }
            else
            {
                Need(Json(current) == before, "dialog alone did not persist copy");
                var saved = new LedgerService(store).SaveDraft(plan.Draft, plan.PreparedBy);
                Need(saved.Id != shown.Vouchers[0].Id && saved.PreparedBy == "当前合成制单员", "host explicitly saves fresh draft with current actor");
            }
        }
        if (stale) Need(Hash(source) == hash, "stale save preserves exact SQLite bytes");
        else Need(Read(source).Vouchers.Count == 2, "fresh copied voucher reopens from actual SQLite");
    }
    private static void SummaryBadQuery(string root)
    {
        var location = new SummaryCatalogLocation(root, Path.Combine(root, "summary", "catalog.json"), Guid.NewGuid());
        var catalog = JsonSummaryCatalog.Create(location);
        var s = catalog.AddCategory("合成费用", catalog.Read().Version);
        s = catalog.AddSummary(s.Categories[0].Id, "中文摘要 😀 保留原文", s.Version);
        var id = s.Entries[0].Id; var before = Hash(location.CatalogPath);
        foreach (var code in new[] { 0xD800, 0xDC00 })
        {
            var dialog = new SummaryManagerWindow(JsonSummaryCatalog.Open(location), "合成摘要账套", id);
            Drive(dialog, () =>
            {
                Need(Find<Button>(dialog, "ChooseButton").IsEnabled, "reopened persisted summary initially selectable");
                Set(dialog, "SearchBox", new string((char)code, 1));
                Need(dialog.State.Status == SummaryCatalogStatus.InvalidData && dialog.State.SelectedEntryId is null, "invalid UTF16 query clears old selection");
                Need(Find<DataGrid>(dialog, "SummaryList").Items.Count == 0 && !Find<Button>(dialog, "ChooseButton").IsEnabled, "actual controls reject stale selection after bad query");
                Need(!dialog.State.AcceptSelection().Accepted && !dialog.Result.Accepted, "bad query cannot accept old text");
                NativeCapture.Save(dialog, "summary-bad-query-" + code + ".png");
                Set(dialog, "SearchBox", "中文");
                Need(!Find<Button>(dialog, "ChooseButton").IsEnabled, "query recovery does not silently reselect old item");
                Find<DataGrid>(dialog, "SummaryList").SelectedValue = id; Flush();
                Need(Find<Button>(dialog, "ChooseButton").IsEnabled, "explicit reselection recovers valid query");
                Click(dialog, "CancelWindowButton");
            });
        }
        Need(before == Hash(location.CatalogPath) && JsonSummaryCatalog.Open(location).Read().Entries.Single().Text == "中文摘要 😀 保留原文", "bad queries and cancel preserve persisted original bytes and text");
    }
    private static string CreateBook(string root, string name)
    {
        var path = Path.Combine(root, name + ".caiwu");
        using var store = SqliteLedgerStore.Create(path,
            new(Guid.NewGuid(), "合成账套" + name, AccountingRegime.Enterprise, "synthetic-only", 2026, 1, 0, DateTimeOffset.UtcNow),
            [new("1002", "合成银行", null, BalanceDirection.Debit, true, 10m, 0), new("4001", "合成资本", null, BalanceDirection.Credit, true, 0, 10m)]);
        var shown = store.Read();
        new LedgerService(store).SaveDraft(new(null, new(2026, 1, 5), "记", 1, 0,
            [new("1002", "合成借方", 0.2m, 0), new("4001", "合成贷方", 0, 0.2m)], shown.Revision, shown.Book.Id), "合成制单员");
        return path;
    }
    private static LedgerSnapshot Read(string path) { using var s = SqliteLedgerStore.Open(path); s.CheckIntegrity(); return s.Read(); }
    private static string Hash(string path) => Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(path)));
    private static string Json(object value) => JsonSerializer.Serialize(value);
    internal static void Need(bool value, string message) { if (!value) throw new InvalidOperationException(message); checks.Add(message); Console.WriteLine("PASS " + message); }
    private static T Find<T>(Window w, string name) where T : FrameworkElement => (T)w.FindName(name);
    private static void Set(Window w, string name, string text) { var b = Find<TextBox>(w, name); b.Text = text; b.GetBindingExpression(TextBox.TextProperty)?.UpdateSource(); Flush(); }
    private static TextBox BookBox(Window w, string binding) => Descendants<TextBox>(w).Single(t => BindingOperations.GetBinding(t, TextBox.TextProperty)?.Path.Path == binding);
    private static void SetBook(Window w, string target)
    { BookBox(w, "NewBookName").Text = "合成复制目标"; BookBox(w, "DestinationPath").Text = target; Flush(); }
    private static IEnumerable<T> Descendants<T>(DependencyObject p) where T : DependencyObject
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(p); i++)
        { var c = VisualTreeHelper.GetChild(p, i); if (c is T t) yield return t; foreach (var nested in Descendants<T>(c)) yield return nested; }
    }
    private static void ClickContent(Window w, string content)
    { var b = Descendants<Button>(w).Single(b => b.Content as string == content); Need(b.IsEnabled, content + " enabled"); b.RaiseEvent(new RoutedEventArgs(Button.ClickEvent)); Flush(); }
    private static void Click(Window w, string name)
    { var b = Find<Button>(w, name); Need(b.IsEnabled, name + " enabled"); b.RaiseEvent(new RoutedEventArgs(Button.ClickEvent)); Flush(); }
    private static void Flush() => Dispatcher.CurrentDispatcher.Invoke(() => { }, DispatcherPriority.ApplicationIdle);
    private static void Poll(Window w, Func<bool> ready, Action action)
    {
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(30) };
        var start = DateTime.UtcNow;
        timer.Tick += (_, _) =>
        {
            try
            {
                if (DateTime.UtcNow - start > TimeSpan.FromSeconds(12)) throw new TimeoutException("async UI outcome not reached");
                if (!ready()) return; timer.Stop(); action();
            }
            catch (Exception ex) { timer.Stop(); pendingFailure = ex; w.Close(); }
        };
        w.Closed += (_, _) => timer.Stop(); timer.Start();
    }
    private static Exception? pendingFailure;
    private static void Drive(Window w, Action action, bool waitsForAsyncClose = false)
    {
        pendingFailure = null;
        var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(18) };
        timer.Tick += (_, _) => { timer.Stop(); pendingFailure ??= new TimeoutException("actual modal window timed out"); w.Close(); };
        w.ContentRendered += (_, _) => w.Dispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle, new Action(() =>
        {
            try { w.Activate(); w.UpdateLayout(); Flush(); action(); if (!waitsForAsyncClose && w.IsVisible) w.Close(); }
            catch (Exception ex) { pendingFailure = ex; w.Close(); }
        }));
        timer.Start(); w.ShowDialog(); timer.Stop();
        if (pendingFailure is not null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(pendingFailure).Throw();
    }
}
