using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Costing.Wpf;
using Caiwu.Desktop;
using Caiwu.Desktop.Features;
using Caiwu.Desktop.Presentation;
using Caiwu.Persistence.Sqlite;
using Caiwu.Summaries;
using Caiwu.VoucherTools;

internal static class Program
{
    private static string evidence = "";
    private static readonly List<object> Results = [];
    private static int failures;

    [STAThread]
    private static int Main(string[] args)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Actual Windows/WPF required.");
        using var watchdog = new System.Threading.Timer(_ => Environment.FailFast("Desktop feature probe exceeded 90 seconds."), null, 90000, Timeout.Infinite);
        evidence = Path.GetFullPath(args.Length > 0 ? args[0] : "artifacts/desktop-features-windows"); Directory.CreateDirectory(evidence);
        var temporary = Path.Combine(Path.GetTempPath(), "caiwu-feature-windows-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(temporary);
        var app = new App(); app.InitializeComponent(); app.ShutdownMode = ShutdownMode.OnExplicitShutdown;
        SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext());
        var book = new BookInfo(Guid.NewGuid(), "合成桌面窗口探针", AccountingRegime.SmallBusiness, "synthetic-wpf", 2026, 1, 0, DateTimeOffset.UtcNow);
        var accounts = new Account[] { new("1002", "银行存款", null, BalanceDirection.Debit, true, 0, 0), new("3001", "实收资本", null, BalanceDirection.Credit, true, 0, 0) };
        var path = Path.Combine(temporary, "source.caiwu");
        using (var seed = SqliteLedgerStore.Create(path, book, accounts))
        {
            var service = new LedgerService(seed); var s = service.GetSnapshot();
            service.SaveDraft(new(null, new(2026, 1, 1), "记", 1, 0, [new("1002", "合成凭证", 100.25m, 0), new("3001", "合成凭证", 0, 100.25m)], s.Revision, s.Book.Id), "源制单人");
        }
        var backend = new DesktopBackend(p => SqliteLedgerStore.Open(p), (p, b, a) => SqliteLedgerStore.Create(p, b, a),
            SqliteLedgerStore.RestoreBackup, s => new PreviewLedgerService(new LedgerService(s)), []);
        using var session = new LedgerSession(backend); session.Open(path);
        PendingVoucherCopy Pending(int number)
        {
            var s = session.Snapshot!;
            var plan = new VoucherCopyPlanner().Plan(s, s.Vouchers[0].Id, new(new(2026, 1, 2), "记", number, 0, "当前制单人")).Plan!;
            return new(new(session, s), plan);
        }
        Check("HOST-MENUS-AND-DISABLED-POLICY-GATES", () =>
        {
            var host = new MainWindow(backend); app.MainWindow = host;
            host.InitializeDesktopFeatures(new()); host.Show(); Pump();
            typeof(MainWindow).GetMethod("OpenVerificationBook", BindingFlags.NonPublic | BindingFlags.Instance)!.Invoke(host, [path]); Pump();
            var menu = ((DockPanel)host.Content).Children.OfType<Menu>().Single();
            var business = menu.Items.OfType<MenuItem>().Single(i => i.Header.ToString()!.StartsWith("实务操作"));
            var archive = menu.Items.OfType<MenuItem>().Single(i => i.Header.ToString()!.StartsWith("会计档案"));
            Assert(business.Items.OfType<MenuItem>().Any(i => i.Header.ToString()!.StartsWith("复制凭证")), "Copy missing from business menu.");
            var bookCopy = archive.Items.OfType<MenuItem>().Single(i => i.Header.ToString() == "复制账套…");
            var summary = archive.Items.OfType<MenuItem>().Single(i => i.Header.ToString() == "常用摘要管理…");
            Assert(!bookCopy.IsEnabled && bookCopy.ToolTip!.ToString()!.Contains("租约"), "BookTools bypassed Delivery lease gate.");
            Assert(!summary.IsEnabled && summary.ToolTip!.ToString()!.Contains("备份附件"), "Summary bypassed attachment configuration.");
            var rejected = false; try { host.InitializeDesktopFeatures(new()); } catch (InvalidOperationException) { rejected = true; }
            Assert(rejected, "Duplicate initialization added menus again."); Capture(host, "host-menus"); host.Close();
        });
        Check("COPY-CANCEL-NO-IMPLICIT-WRITE-AND-THEME", () =>
        {
            var before = session.Service!.GetSnapshot().Revision; var dialog = new CopiedDraftWindow(Pending(2));
            Drive(dialog, () =>
            {
                Assert(ReferenceEquals(dialog.Style, app.TryFindResource(typeof(Window))), "Host Window style not inherited.");
                Assert(Find<DataGrid>(dialog, "Feature.Copy.Lines").Items.Count == 2, "Copied lines not displayed.");
                Capture(dialog, "copy-cancel"); dialog.Close();
            });
            Assert(session.Service.GetSnapshot().Revision == before, "Cancel wrote ledger.");
        });
        Check("COPY-FAILED-SAVE-RETAINS-EDIT-THEN-SAVES-ONE-NEW-DRAFT", () =>
        {
            var pending = Pending(2); var dialog = new CopiedDraftWindow(pending); var before = session.Service!.GetSnapshot();
            Drive(dialog, () =>
            {
                var rows = (ObservableCollection<VoucherLineEdit>)Find<DataGrid>(dialog, "Feature.Copy.Lines").ItemsSource;
                rows[0].Summary = "保留人工修改"; rows[1].CreditText = "1.00";
                Click(Find<Button>(dialog, "Feature.Copy.Save"));
                Until(() => Find<TextBlock>(dialog, "Feature.Status").Text.Contains("未保存"));
                Assert(dialog.IsVisible && pending.SavedVoucher is null && rows[0].Summary == "保留人工修改" && rows[1].CreditText == "1.00", "Failed save lost input or closed.");
                Assert(session.Service.GetSnapshot().Revision == before.Revision, "Invalid draft changed ledger."); Capture(dialog, "copy-validation");
                rows[1].CreditText = "100.25"; Click(Find<Button>(dialog, "Feature.Copy.Save"));
                Until(() => pending.SavedVoucher is not null && !dialog.IsVisible);
            });
            Assert(pending.SavedVoucher is { Status: VoucherStatus.Draft, ReviewedBy: null } v && v.Id != pending.Plan.SourceVoucherId && v.PreparedBy == "当前制单人", "Saved identity/state/operator invalid.");
            Assert(session.Service!.GetSnapshot().Vouchers.Count == before.Vouchers.Count + 1, "Saved more than once."); session.Refresh();
        });
        Check("COPY-SAME-BOOK-REOPEN-DISABLES-OLD-WINDOW", () =>
        {
            var pending = Pending(3); var dialog = new CopiedDraftWindow(pending); var before = session.Service!.GetSnapshot().Revision;
            Drive(dialog, () =>
            {
                session.Open(path); Until(() => !Find<DockPanel>(dialog, "Feature.Body").IsEnabled);
                Click(Find<Button>(dialog, "Feature.Copy.Save")); Pump();
                Assert(dialog.IsVisible && pending.SavedVoucher is null, "Stale window saved/closed."); Capture(dialog, "copy-stale-session"); dialog.Close();
            });
            Assert(session.Service!.GetSnapshot().Revision == before, "Stale window wrote reopened same BookId.");
        });
        var location = new SummaryCatalogLocation(temporary, Path.Combine(temporary, "summary.json"), book.Id);
        var catalog = JsonSummaryCatalog.Create(location);
        var registration = new SummaryFeatureRegistration(catalog, "synthetic.summary.attachment", "合成测试登记；不替代真实 Delivery 清单");
        Check("SUMMARY-ASYNC-PERSISTENCE-AND-UI-THREAD-STATE", () =>
        {
            var recording = new RecordingCatalog(catalog); var dialog = new AsyncSummaryManagerWindow(new(session, session.Snapshot!), registration with { Catalog = recording });
            var uiThread = Environment.CurrentManagedThreadId; var notifications = new List<int>();
            dialog.State.PropertyChanged += (_, _) => notifications.Add(Environment.CurrentManagedThreadId);
            var ticks = 0; var pulse = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(10) }; pulse.Tick += (_, _) => ticks++;
            Drive(dialog, () =>
            {
                pulse.Start();
                try { Until(() => recording.Started.IsSet); Until(() => ticks >= 3); }
                finally { recording.Release.Set(); }
                Until(() => dialog.State.Snapshot is not null); pulse.Stop();
                Assert(recording.Threads.All(id => id != uiThread), "Summary I/O blocked UI thread.");
                Click(ButtonText(dialog, "新增分类")); Find<TextBox>(dialog, "Feature.Summary.Draft").Text = "窗口分类";
                Click(Find<Button>(dialog, "Feature.Summary.Save")); Until(() => dialog.State.Categories.Any(c => c.Name == "窗口分类"));
                Assert(notifications.Count > 0 && notifications.All(id => id == uiThread), "Owner state mutated away from Dispatcher.");
                Click(ButtonText(dialog, "新增摘要")); Find<TextBox>(dialog, "Feature.Summary.Draft").Text = "窗口持久摘要";
                Click(Find<Button>(dialog, "Feature.Summary.Save")); Until(() => dialog.State.Rows.Any(e => e.Text == "窗口持久摘要"));
                Capture(dialog, "summary-persisted"); dialog.Close();
            });
            Assert(catalog.Read().Entries.Any(e => e.Text == "窗口持久摘要"), "Summary was not persisted.");
        });
        Check("SUMMARY-CONFLICT-AND-INVALID-QUERY-RETAIN-INPUT", () =>
        {
            var dialog = new AsyncSummaryManagerWindow(new(session, session.Snapshot!), registration);
            Drive(dialog, () =>
            {
                Until(() => dialog.State.Snapshot is not null);
                Click(ButtonText(dialog, "新增分类")); Find<TextBox>(dialog, "Feature.Summary.Draft").Text = "保留分类名";
                var version = dialog.State.EditVersion; catalog.AddCategory("外部窗口", catalog.Read().Version);
                Click(Find<Button>(dialog, "Feature.Summary.Save")); Until(() => dialog.State.Status == SummaryCatalogStatus.Conflict);
                Assert(dialog.State.HasPendingEdit && dialog.State.EditVersion == version && Find<TextBox>(dialog, "Feature.Summary.Draft").Text == "保留分类名", "Conflict lost edit/version.");
                Capture(dialog, "summary-conflict"); Click(ButtonText(dialog, "取消本次编辑")); Click(ButtonText(dialog, "重新载入"));
                Until(() => dialog.State.Status == SummaryCatalogStatus.Ready);
                Find<TextBox>(dialog, "Feature.Summary.Search").Text = "\uD800";
                Assert(dialog.IsVisible && dialog.State.Status == SummaryCatalogStatus.InvalidData, "Invalid Unicode query escaped window handling."); dialog.Close();
            });
        });
        Check("SUMMARY-SAME-BOOK-RESTORE-DISABLES-OLD-WINDOW", () =>
        {
            var dialog = new AsyncSummaryManagerWindow(new(session, session.Snapshot!), registration); var before = catalog.Read().Version;
            Drive(dialog, () =>
            {
                Until(() => dialog.State.Snapshot is not null); var backup = Path.Combine(temporary, "same-id.caiwubak"); session.BackupTo(backup);
                var restored = Path.Combine(temporary, "same-id-restored.caiwu"); session.RestoreTo(backup, restored); session.Open(restored);
                Until(() => !Find<DockPanel>(dialog, "Feature.Body").IsEnabled); Capture(dialog, "summary-stale-session"); dialog.Close();
            });
            Assert(catalog.Read().Version == before, "Invalidating old manager wrote catalog.");
        });
        Check("COST-WORKSHEET-PREVIEW-DOES-NOT-POST-AND-INVALIDATES", () =>
        {
            var before = session.Service!.GetSnapshot().Revision; var binding = new FeatureSessionBinding(session, session.Snapshot!);
            var dialog = new SessionFeatureWindow(binding); var page = new CostWorksheetPage(book.Id, new(2026, 1, 2));
            ((DockPanel)dialog.Content).Children.OfType<DockPanel>().Single().Children.Add(page);
            Drive(dialog, () =>
            {
                Click(ButtonText(page, "载入合成样例")); Click(ButtonText(page, "计算 / 复算"));
                Assert(page.Editor.CanExport && page.Editor.VoucherRows.Count > 0, "Actual cost controls did not calculate review suggestions.");
                Assert(session.Service!.GetSnapshot().Revision == before, "Cost suggestion posted ledger."); Capture(dialog, "cost-preview");
                session.Open(session.DatabasePath!); Until(() => !Find<DockPanel>(dialog, "Feature.Body").IsEnabled); dialog.Close();
            });
            Assert(session.Service!.GetSnapshot().Revision == before, "Cost invalidation wrote ledger.");
        });
        session.Close();
        File.WriteAllText(Path.Combine(evidence, "results.json"), JsonSerializer.Serialize(new { syntheticOnly = true, windowsExecuted = true,
            physicalKeyboardOrImeTested = false, os = Environment.OSVersion.ToString(), results = Results }, new JsonSerializerOptions { WriteIndented = true }));
        app.Shutdown(); Directory.Delete(temporary, true); return failures == 0 ? 0 : 1;
    }

    private static void Check(string id, Action action)
    {
        try { action(); Results.Add(new { id, passed = true }); Console.WriteLine("PASS " + id); }
        catch (Exception ex) { failures++; Results.Add(new { id, passed = false, error = ex.ToString() }); Console.WriteLine("FAIL " + id + " " + ex.Message); }
    }
    private static void Assert(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
    private static void Click(Button button) => button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
    private static Button ButtonText(DependencyObject root, string text) => Descendants(root).OfType<Button>().Single(b => b.Content?.ToString() == text);
    private static T Find<T>(DependencyObject root, string id) where T : DependencyObject => Descendants(root).OfType<T>().Single(x => AutomationProperties.GetAutomationId(x) == id);
    private static IEnumerable<DependencyObject> Descendants(DependencyObject root)
    { yield return root; for (var i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++) foreach (var child in Descendants(VisualTreeHelper.GetChild(root, i))) yield return child; }
    private static void Pump()
    {
        var frame = new DispatcherFrame(); var tick = new DispatcherTimer(DispatcherPriority.Background) { Interval = TimeSpan.FromMilliseconds(20) };
        tick.Tick += (_, _) => { tick.Stop(); frame.Continue = false; }; tick.Start(); Dispatcher.PushFrame(frame);
    }
    private static void Until(Func<bool> condition)
    { var clock = Stopwatch.StartNew(); while (!condition()) { if (clock.Elapsed > TimeSpan.FromSeconds(8)) throw new TimeoutException("Window condition not reached."); Pump(); } }
    private static void Drive(Window dialog, Action action)
    {
        Exception? failure = null;
        dialog.Dispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle, new Action(() =>
        { try { action(); } catch (Exception ex) { failure = ex; } finally { if (dialog.IsVisible) dialog.Close(); } }));
        dialog.ShowDialog(); if (failure is not null) throw failure;
    }
    private static void Capture(Window dialog, string name)
    {
        dialog.UpdateLayout(); var dpi = VisualTreeHelper.GetDpi(dialog);
        var image = new RenderTargetBitmap((int)Math.Ceiling(dialog.ActualWidth * dpi.DpiScaleX), (int)Math.Ceiling(dialog.ActualHeight * dpi.DpiScaleY),
            dpi.PixelsPerInchX, dpi.PixelsPerInchY, PixelFormats.Pbgra32); image.Render(dialog);
        var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(image));
        using var output = File.Create(Path.Combine(evidence, name + ".png")); encoder.Save(output);
    }

    private sealed class RecordingCatalog(ISummaryCatalog inner) : ISummaryCatalog
    {
        public List<int> Threads { get; } = [];
        public ManualResetEventSlim Started { get; } = new();
        public ManualResetEventSlim Release { get; } = new();
        public SummaryCatalogLocation Location => inner.Location;
        private void Record() { lock (Threads) Threads.Add(Environment.CurrentManagedThreadId); }
        public SummarySnapshot Read()
        { Record(); Started.Set(); if (!Release.Wait(TimeSpan.FromSeconds(8))) throw new TimeoutException("Synthetic catalog was not released."); return inner.Read(); }
        public SummarySnapshot AddCategory(string name, CatalogVersion expected) { Record(); return inner.AddCategory(name, expected); }
        public SummarySnapshot RenameCategory(Guid id, string name, CatalogVersion expected) { Record(); return inner.RenameCategory(id, name, expected); }
        public SummarySnapshot DeleteCategory(Guid id, CatalogVersion expected) { Record(); return inner.DeleteCategory(id, expected); }
        public SummarySnapshot AddSummary(Guid categoryId, string text, CatalogVersion expected) { Record(); return inner.AddSummary(categoryId, text, expected); }
        public SummarySnapshot UpdateSummary(Guid id, Guid categoryId, string text, CatalogVersion expected) { Record(); return inner.UpdateSummary(id, categoryId, text, expected); }
        public SummarySnapshot DeleteSummary(Guid id, CatalogVersion expected) { Record(); return inner.DeleteSummary(id, expected); }
        public CatalogBackup ExportBackup(string destinationPath) => inner.ExportBackup(destinationPath);
        public CatalogBackup ValidateBackup(string backupPath, string? expectedSha256 = null) => inner.ValidateBackup(backupPath, expectedSha256);
    }
}
