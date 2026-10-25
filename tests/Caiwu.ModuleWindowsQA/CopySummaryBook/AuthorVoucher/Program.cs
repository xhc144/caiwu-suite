using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.VoucherTools;
using Caiwu.VoucherTools.Wpf;
using Caiwu.VoucherTools.Wpf.Tests;

internal static class Program
{
    private static readonly List<object> results = [];
    private static int failures;
    private static string directory = "";

    [STAThread]
    private static int Main(string[] args)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Actual Windows WPF is required.");
        directory = Path.GetFullPath(args.Length == 0 ? "TestResults/voucher-copy-wpf" : args[0]);
        Directory.CreateDirectory(directory);
        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };

        Check("WPF-LAYOUT-PREVIEW-FALLBACK", () =>
        {
            var shown = SyntheticData.Snapshot();
            var original = Data(shown);
            var dialog = Dialog(shown);
            InDialog(dialog, () =>
            {
                Assert(Box(dialog, "DateInput").Text == "" && Box(dialog, "KindInput").Text == "" &&
                    Box(dialog, "NumberInput").Text == "" && Box(dialog, "AttachmentInput").Text == "", "Header fields guessed defaults.");
                Assert(Text(dialog, "PreparedByText").Text == "当前制单员", "Current actor was not supplied by host.");
                Assert(Text(dialog, "SourceText").Text.Contains("已记账"), "Source identity/status is missing.");
                var grid = (DataGrid)dialog.FindName("LinesGrid");
                Assert(grid.IsReadOnly && grid.Items.Count == 3 && !grid.CanUserSortColumns, "Preview lost rows/order or permits editing.");
                Assert(grid.Columns.All(c => c.ActualWidth >= c.MinWidth && c.ActualWidth >= 40), "Preview columns collapsed.");
                Assert(dialog.Resources.MergedDictionaries.Any(d => d.Source?.OriginalString.Contains("Fluent.xaml") == true), "Standalone Fluent fallback missing.");
                Capture(dialog, "preview-fallback.png");
            });
            Assert(dialog.Plan is null && Data(shown) == original, "Opening/closing mutated source or produced a plan.");
        });

        Check("WPF-ALL-FIELD-ERRORS-RETAIN-INPUT", () =>
        {
            var shown = SyntheticData.Snapshot();
            var original = Data(shown);
            var dialog = Dialog(shown);
            InDialog(dialog, () =>
            {
                Fill(dialog, "2026-02-30", " 转 ", "0", "1.5");
                Click(dialog, "ConfirmButton");
                AssertOpen(dialog);
                AssertInputs(dialog, "2026-02-30", " 转 ", "0", "1.5");
                foreach (var field in new[] { "DateError", "KindError", "NumberError", "AttachmentError" })
                    Assert(!string.IsNullOrWhiteSpace(Text(dialog, field).Text), "Field error missing: " + field);
                Capture(dialog, "field-errors-retained.png");
            });
            Assert(dialog.Plan is null && Data(shown) == original, "Rejected fields changed state.");
        });

        Check("WPF-DUPLICATE-NUMBER-RETAINED", () =>
        {
            var dialog = Dialog(SyntheticData.Snapshot());
            InDialog(dialog, () =>
            {
                Fill(dialog, "2026-01-05", "记", "7", "3");
                Click(dialog, "ConfirmButton");
                AssertOpen(dialog);
                AssertInputs(dialog, "2026-01-05", "记", "7", "3");
                Assert(Text(dialog, "NumberError").Text.Contains("已存在"), "Duplicate number was not mapped to number field.");
            });
        });

        Check("WPF-CLOSED-TARGET-PERIOD", () =>
        {
            var shown = SyntheticData.Snapshot();
            shown = shown with { Book = shown.Book with { ClosedThroughMonth = 2 } };
            var dialog = Dialog(shown);
            InDialog(dialog, () =>
            {
                FillValid(dialog);
                Click(dialog, "ConfirmButton");
                AssertOpen(dialog);
                Assert(Text(dialog, "DateError").Text.Contains("已结账"), "Closed target period was accepted or not mapped to date.");
            });
        });

        Check("WPF-INACTIVE-ACCOUNT-ROW-FEEDBACK", () =>
        {
            var shown = SyntheticData.Snapshot();
            shown = shown with { Accounts = shown.Accounts.Select(a => a.Code == "1403" ? a with { IsActive = false } : a).ToArray() };
            var dialog = Dialog(shown);
            InDialog(dialog, () =>
            {
                FillValid(dialog);
                Click(dialog, "ConfirmButton");
                AssertOpen(dialog);
                var error = Text(dialog, "GeneralError").Text;
                Assert(error.Contains("第 1 行") && error.Contains("1403") && error.Contains("停用"), "Source account error/row missing.");
                Assert(((DataGrid)dialog.FindName("LinesGrid")).Items.Count == 3, "Invalid account silently removed a row.");
                Capture(dialog, "inactive-account-feedback.png");
            });
        });

        Check("WPF-CONFIRM-RETURNS-PLAN-HOST-ALONE-SAVES", () =>
        {
            var shown = SyntheticData.Snapshot();
            var original = Data(shown);
            using var store = new ProbeStore(shown);
            var dialog = Dialog(shown);
            var accepted = InDialog(dialog, () => { FillValid(dialog); Click(dialog, "ConfirmButton"); });
            Assert(accepted == true && dialog.Plan is not null, "Valid confirmation did not return a plan.");
            var plan = dialog.Plan!;
            Assert(plan.Draft.Id is null && plan.PreparedBy == "当前制单员", "Identity/preparer was inherited.");
            Assert(plan.Draft.ExpectedBookId == shown.Book.Id && plan.Draft.ExpectedRevision == shown.Revision, "Original context was lost.");
            Assert(Data(plan.Draft.Lines) == Data(shown.Vouchers[0].Lines), "Exact lines/duplicates changed.");
            Assert(store.Reads == 0 && store.Writes == 0 && Data(shown) == original, "Dialog accessed storage or changed snapshot.");
            var saved = new LedgerService(store).SaveDraft(plan.Draft, plan.PreparedBy);
            Assert(saved.Id != shown.Vouchers[0].Id && saved.Status == VoucherStatus.Draft && saved.ReviewedBy is null, "Host save did not create a fresh draft.");
            Assert(store.Writes == 1 && Data(shown) == original, "Host did not write exactly once or modified the source.");
        });

        Check("WPF-CANCEL-BUTTON-RETURNS-NULL", () =>
        {
            var shown = SyntheticData.Snapshot();
            var original = Data(shown);
            var dialog = Dialog(shown);
            var accepted = InDialog(dialog, () => { FillValid(dialog); Click(dialog, "CancelButton"); });
            Assert(accepted != true && dialog.Plan is null && Data(shown) == original, "Cancel produced a plan or modified source.");
        });

        Check("WPF-ESCAPE-ROUTED-KEY-RETURNS-NULL", () =>
        {
            var dialog = Dialog(SyntheticData.Snapshot());
            var accepted = InDialog(dialog, () =>
            {
                FillValid(dialog);
                var source = PresentationSource.FromVisual(dialog) ?? throw new InvalidOperationException("No actual WPF presentation source.");
                dialog.RaiseEvent(new KeyEventArgs(Keyboard.PrimaryDevice, source, Environment.TickCount, Key.Escape)
                    { RoutedEvent = Keyboard.PreviewKeyDownEvent });
            });
            Assert(accepted != true && dialog.Plan is null, "Escape did not cancel the real dialog.");
        });

        Check("WPF-WINDOW-CLOSE-RETURNS-NULL", () =>
        {
            var dialog = Dialog(SyntheticData.Snapshot());
            var accepted = InDialog(dialog, () => { FillValid(dialog); dialog.Close(); });
            Assert(accepted != true && dialog.Plan is null, "Window close returned a plan.");
        });

        Check("WPF-STALE-TOKEN-PRESERVED-FOR-HOST-REJECTION", () =>
        {
            var shown = SyntheticData.Snapshot();
            using var store = new ProbeStore(shown);
            var service = new LedgerService(store);
            var dialog = Dialog(shown);
            var readsAfterConcurrentWrite = 0;
            InDialog(dialog, () =>
            {
                service.SaveAccount(shown.Accounts[0] with { Name = "合成银行新名称" }, "另一窗口",
                    new(shown.Book.Id, shown.Revision));
                readsAfterConcurrentWrite = store.Reads;
                FillValid(dialog);
                Click(dialog, "ConfirmButton");
            });
            var plan = dialog.Plan ?? throw new InvalidOperationException("Dialog must return original-input plan without reloading.");
            Assert(plan.Draft.ExpectedRevision == shown.Revision && store.Reads == readsAfterConcurrentWrite, "Dialog refreshed token or read storage.");
            var before = Data(store.Read());
            var writes = store.Writes;
            try { service.SaveDraft(plan.Draft, plan.PreparedBy); throw new InvalidOperationException("Stale plan unexpectedly saved."); }
            catch (StoreConcurrencyException) { }
            Assert(store.Writes == writes && Data(store.Read()) == before, "Rejected stale host save changed storage.");
        });

        Check("WPF-HOST-THEME-RESOURCES-WIN", () =>
        {
            var brush = new SolidColorBrush(Color.FromRgb(250, 252, 255));
            var style = new Style(typeof(Button));
            style.Setters.Add(new Setter(Control.FontWeightProperty, FontWeights.SemiBold));
            app.Resources["Caiwu.Copy.Background"] = brush;
            app.Resources[typeof(Button)] = style;
            try
            {
                var dialog = Dialog(SyntheticData.Snapshot());
                InDialog(dialog, () =>
                {
                    Assert(ReferenceEquals(dialog.FindResource("Caiwu.Copy.Background"), brush), "Local fallback shadowed global brush.");
                    Assert(dialog.Resources.MergedDictionaries.Count == 0, "Local Fluent dictionary shadowed host styles.");
                    Assert(ReferenceEquals(((Button)dialog.FindName("ConfirmButton")).Style, style), "Host implicit button style was lost.");
                });
            }
            finally { app.Resources.Remove("Caiwu.Copy.Background"); app.Resources.Remove(typeof(Button)); }
        });

        Check("WPF-CORRECT-ERROR-AND-CONFIRM-ONCE", () =>
        {
            var planner = new CountingPlanner();
            var shown = SyntheticData.Snapshot();
            var dialog = new VoucherCopyWindow(shown, shown.Vouchers[0].Id, "当前制单员", planner);
            InDialog(dialog, () =>
            {
                Fill(dialog, "2026-01-05", "记", "7", "0");
                Click(dialog, "ConfirmButton");
                AssertOpen(dialog);
                Box(dialog, "NumberInput").Text = "8";
                Click(dialog, "ConfirmButton");
                var accepted = dialog.Plan;
                Click(dialog, "ConfirmButton"); // A queued second event cannot consume/replace a confirmed plan.
                Assert(ReferenceEquals(accepted, dialog.Plan), "Second confirm replaced the accepted plan.");
                Assert(Text(dialog, "NumberError").Text == "", "Corrected field error was not cleared.");
            });
            Assert(dialog.Plan?.Draft.Number == 8 && planner.Calls == 2, "Correction was lost or duplicate confirm invoked planning again.");
        });

        File.WriteAllText(Path.Combine(directory, "wpf-results.json"), JsonSerializer.Serialize(new
        {
            actualWindowsWpf = true,
            checkoutCommit = Environment.GetEnvironmentVariable("CAIWU_VOUCHER_COPY_COMMIT"),
            os = Environment.OSVersion.ToString(),
            failures,
            results,
            inputMethod = "Actual WPF modal windows and routed Click/Key events; no native mouse/IME assertion."
        }, new JsonSerializerOptions { WriteIndented = true }));
        app.Shutdown();
        return failures == 0 ? 0 : 1;
    }

    private static VoucherCopyWindow Dialog(LedgerSnapshot shown) => new(shown, shown.Vouchers[0].Id, "当前制单员");
    private static string Data(object value) => JsonSerializer.Serialize(value);
    private static TextBox Box(Window window, string name) => (TextBox)window.FindName(name);
    private static TextBlock Text(Window window, string name) => (TextBlock)window.FindName(name);
    private static void Click(Window window, string name) => ((Button)window.FindName(name)).RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
    private static void FillValid(Window window) => Fill(window, "2026-02-01", "转", "8", "0");
    private static void Fill(Window window, string date, string kind, string number, string attachments)
    {
        Box(window, "DateInput").Text = date;
        Box(window, "KindInput").Text = kind;
        Box(window, "NumberInput").Text = number;
        Box(window, "AttachmentInput").Text = attachments;
    }
    private static void AssertInputs(Window window, string date, string kind, string number, string attachments) =>
        Assert(Box(window, "DateInput").Text == date && Box(window, "KindInput").Text == kind &&
            Box(window, "NumberInput").Text == number && Box(window, "AttachmentInput").Text == attachments, "Rejected form lost input.");
    private static void AssertOpen(VoucherCopyWindow dialog) => Assert(dialog.IsVisible && dialog.DialogResult is null && dialog.Plan is null,
        "Validation failure closed dialog or returned a plan.");
    private static void Assert(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
    private static void Check(string name, Action action)
    {
        try { action(); results.Add(new { name, status = "PASS" }); Console.WriteLine("PASS " + name); }
        catch (Exception ex) { failures++; results.Add(new { name, status = "FAIL", error = ex.ToString() }); Console.WriteLine("FAIL " + name + ": " + ex.Message); }
    }
    private static bool? InDialog(Window dialog, Action probe)
    {
        Exception? error = null;
        dialog.Dispatcher.InvokeAsync(() =>
        {
            try { dialog.UpdateLayout(); probe(); }
            catch (Exception ex) { error = ex; }
            finally { if (dialog.IsVisible) dialog.Close(); }
        }, DispatcherPriority.ApplicationIdle);
        var accepted = dialog.ShowDialog();
        if (error is not null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(error).Throw();
        return accepted;
    }
    private static void Capture(Window window, string filename)
    {
        window.UpdateLayout();
        var image = new RenderTargetBitmap((int)Math.Ceiling(window.ActualWidth), (int)Math.Ceiling(window.ActualHeight), 96, 96, PixelFormats.Pbgra32);
        image.Render(window);
        var png = new PngBitmapEncoder(); png.Frames.Add(BitmapFrame.Create(image));
        using var stream = File.Create(Path.Combine(directory, filename)); png.Save(stream);
    }
    private sealed class CountingPlanner : IVoucherCopyPlanner
    {
        internal int Calls { get; private set; }
        public VoucherCopyResult Plan(LedgerSnapshot displayedSnapshot, Guid sourceVoucherId, VoucherCopyOptions options)
        { Calls++; return new VoucherCopyPlanner().Plan(displayedSnapshot, sourceVoucherId, options); }
    }
    private sealed class ProbeStore(LedgerSnapshot snapshot) : ILedgerStore
    {
        private LedgerSnapshot data = snapshot;
        public string DatabasePath => "synthetic-memory-only";
        internal int Reads { get; private set; }
        internal int Writes { get; private set; }
        public LedgerSnapshot Read() { Reads++; return data; }
        public void Write(LedgerSnapshot next, long expectedRevision)
        {
            if (data.Revision != expectedRevision || next.Revision != expectedRevision + 1)
                throw new StoreConcurrencyException("Synthetic CAS conflict.");
            data = next; Writes++;
        }
        public void BackupTo(string destinationPath) => throw new NotSupportedException();
        public void CheckIntegrity() { }
        public void Dispose() { }
    }
}
