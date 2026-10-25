using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Caiwu.Summaries;
using Caiwu.Summaries.Wpf;

internal static class Program
{
    private static int checks;
    private static string artifacts = "";
    private static readonly List<string> renders = [];
    [STAThread]
    private static int Main(string[] args)
    {
        var data = Path.Combine(Path.GetTempPath(), "caiwu-summary-wpf-" + Guid.NewGuid().ToString("N"));
        Application? app = null;
        try
        {
            artifacts = Path.GetFullPath(args.Length == 0 ? "artifacts/summary-manager" : args[0]);
            Directory.CreateDirectory(artifacts);
            app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            app.Resources.MergedDictionaries.Add(new ResourceDictionary
            { Source = new Uri("pack://application:,,,/PresentationFramework.Fluent;component/Themes/Fluent.xaml") });
            var field = new TextBox { Text = "原分录手写摘要", Margin = new Thickness(16) };
            var owner = new Window { Title = "合成账套摘要库回归宿主", Width = 420, Height = 160, Content = field };
            owner.Show(); field.Focus();
            var book = Guid.NewGuid();
            var location = new SummaryCatalogLocation(data, Path.Combine(data, "book-a", "catalog.json"), book);
            var catalog = JsonSummaryCatalog.Create(location);
            var manager = new SummaryManagerWindow(catalog, "合成账套 A") { Owner = owner };
            Guid category = default, entry = default;
            Drive(manager, window =>
            {
                Console.WriteLine(JsonSerializer.Serialize(new { diagnostic = "book-scope", window.State.BookId, window.State.BookDisplayName, expectedBookId = book, actualText = Find<TextBlock>(window, "BookScope").Text, inlineText = new System.Windows.Documents.TextRange(Find<TextBlock>(window, "BookScope").ContentStart, Find<TextBlock>(window, "BookScope").ContentEnd).Text }));
                Check(window.State.BookId == book && Find<TextBlock>(window, "BookScope").Text.Contains("合成账套 A", StringComparison.Ordinal), "scope identifies the injected book");
                Check(!Find<Button>(window, "ChooseButton").IsEnabled, "empty catalog cannot be selected");
                Click(window, "AddCategoryButton"); SetText(window, "CategoryNameBox", "费用");
                Check(catalog.Read().Categories.Count == 0, "typing category is not persisted");
                Click(window, "SaveButton");
                category = catalog.Read().Categories.Single().Id;
                Check(Find<ListBox>(window, "CategoryList").SelectedValue is Guid id && id == category, "saved category remains selected");
                Click(window, "RenameCategoryButton"); SetText(window, "CategoryNameBox", "日常费用"); Click(window, "SaveButton");
                Check(catalog.Read().Categories.Single().Id == category && catalog.Read().Categories.Single().Name == "日常费用", "category rename persists and keeps ID");
                Click(window, "AddSummaryButton"); SetText(window, "SummaryTextBox", "支付办公费\n保留原文说明");
                Check(catalog.Read().Entries.Count == 0 && !Find<Button>(window, "ChooseButton").IsEnabled, "draft summary does not persist or accept");
                Click(window, "SaveButton"); entry = catalog.Read().Entries.Single().Id;
                Check(Find<DataGrid>(window, "SummaryList").SelectedValue is Guid selected && selected == entry, "saved summary remains selected");
                Click(window, "EditSummaryButton"); SetText(window, "SummaryTextBox", "支付本月办公费\n保留原文说明"); Click(window, "SaveButton");
                Check(catalog.Read().Entries.Single().Id == entry && catalog.Read().Entries.Single().Text.StartsWith("支付本月", StringComparison.Ordinal), "summary edit persists with stable ID");
                SetText(window, "SearchBox", "没有匹配");
                Check(Find<DataGrid>(window, "SummaryList").Items.Count == 0 && !Find<Button>(window, "ChooseButton").IsEnabled, "no results clear selection and block acceptance");
                SetText(window, "SearchBox", "办公"); SelectEntry(window, entry);
                Check(Find<TextBox>(window, "SelectedPreview").Text.Contains("原文说明", StringComparison.Ordinal), "preview retains full multiline text");
                Click(window, "DeleteCategoryButton");
                Check(catalog.Read().Categories.Count == 1, "delete intent is not persisted");
                Click(window, "SaveButton");
                Check(window.State.HasPendingEdit && Find<TextBlock>(window, "StatusMessage").Text.Contains("仍有摘要", StringComparison.Ordinal), "nonempty category delete keeps input and displays failure");
                Click(window, "CancelEditButton");
                Capture(window, "summary-manager.png");
                SelectEntry(window, entry); Click(window, "ChooseButton");
            });
            Check(manager.Result.Accepted && manager.Result.Value?.Id == entry, "modal manager returns selected summary");
            Check(field.Text == "原分录手写摘要", "window does not mutate host voucher field");

            var beforeCancel = catalog.Read().Version;
            var cancel = new SummaryManagerWindow(catalog, "合成账套 A", entry) { Owner = owner };
            Drive(cancel, window =>
            {
                Click(window, "EditSummaryButton"); SetText(window, "SummaryTextBox", "取消关闭不落盘");
                Click(window, "CancelWindowButton");
            });
            Check(!cancel.Result.Accepted && catalog.Read().Version == beforeCancel, "cancel window discards unsaved edit");
            var close = new SummaryManagerWindow(catalog, "合成账套 A", entry) { Owner = owner };
            Drive(close, window => { Click(window, "EditSummaryButton"); SetText(window, "SummaryTextBox", "标题栏关闭不落盘"); window.Close(); });
            Check(!close.Result.Accepted && catalog.Read().Version == beforeCancel, "title-bar close discards unsaved edit");

            var writeFailure = new SummaryManagerWindow(catalog, "合成账套 A", entry) { Owner = owner };
            Drive(writeFailure, window =>
            {
                Click(window, "EditSummaryButton"); SetText(window, "SummaryTextBox", "写入失败时保留输入");
                var before = File.ReadAllBytes(location.CatalogPath);
                // Windows denies the destination rename while a read handle omits FileShare.Delete.
                using (new FileStream(location.CatalogPath, FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    Click(window, "SaveButton");
                    Check(window.State.Status == SummaryCatalogStatus.IoError && window.State.HasPendingEdit, "real OS rename failure is reported");
                    Check(Find<TextBox>(window, "SummaryTextBox").Text == "写入失败时保留输入", "OS write failure retains draft input");
                    Check(before.SequenceEqual(File.ReadAllBytes(location.CatalogPath)), "OS write failure preserves original file bytes");
                }
                Click(window, "SaveButton");
                Check(catalog.Read().Entries.Single().Text == "写入失败时保留输入", "explicit retry succeeds after OS handle release");
                Click(window, "CancelWindowButton");
            });

            var stale = new SummaryManagerWindow(catalog, "旧窗口 A", entry) { Owner = owner };
            Drive(stale, window =>
            {
                Click(window, "EditSummaryButton"); SetText(window, "SummaryTextBox", "冲突时保留这段输入");
                var captured = window.State.EditVersion;
                var other = JsonSummaryCatalog.Open(location);
                other.AddCategory("另一窗口已保存", other.Read().Version);
                Check(!Find<Button>(window, "ReloadButton").IsEnabled, "reload is disabled during pending edit");
                Click(window, "SaveButton");
                Check(window.State.Status == SummaryCatalogStatus.Conflict && window.State.EditVersion == captured, "stale save rejects captured version");
                Check(Find<TextBox>(window, "SummaryTextBox").Text == "冲突时保留这段输入", "conflict preserves typed input");
                Check(catalog.Read().Entries.Single().Text != "冲突时保留这段输入", "conflict does not overwrite persisted summary");
                Capture(window, "summary-conflict.png"); Click(window, "CancelWindowButton");
            });

            var deletion = new SummaryManagerWindow(catalog, "合成账套 A", entry) { Owner = owner };
            Drive(deletion, window =>
            {
                Click(window, "DeleteSummaryButton"); Click(window, "CancelEditButton");
                Check(catalog.Read().Entries.Count == 1, "cancel delete leaves persisted summary");
                Click(window, "DeleteSummaryButton"); Click(window, "SaveButton");
                Check(JsonSummaryCatalog.Open(location).Read().Entries.Count == 0, "confirmed delete persists");
                Find<ListBox>(window, "CategoryList").SelectedValue = category; Flush(window);
                Click(window, "DeleteCategoryButton"); Click(window, "SaveButton");
                Check(catalog.Read().Categories.All(c => c.Id != category), "empty category delete persists");
                Click(window, "CancelWindowButton");
            });

            // The real helper also owns the modal result and focus restoration contract.
            Exception? helperFailure = null;
            var helperTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(15) };
            helperTimer.Tick += (_, _) =>
            {
                helperFailure = new TimeoutException("Summary manager helper timed out."); helperTimer.Stop();
                foreach (var active in owner.OwnedWindows.OfType<SummaryManagerWindow>().ToArray()) active.Close();
            };
            app.Dispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle, new Action(() =>
            {
                try { Click(owner.OwnedWindows.OfType<SummaryManagerWindow>().Single(), "CancelWindowButton"); }
                catch (Exception ex)
                {
                    helperFailure = ex;
                    foreach (var active in owner.OwnedWindows.OfType<SummaryManagerWindow>().ToArray()) active.Close();
                }
            }));
            helperTimer.Start();
            var helperResult = SummaryManagementDialogs.ShowManager(owner, catalog, "合成账套 A", focusAfterClose: field);
            helperTimer.Stop();
            if (helperFailure is not null) throw helperFailure;
            Flush(owner);
            Check(!helperResult.Accepted && field.Text == "原分录手写摘要" && field.IsKeyboardFocused, "helper cancel preserves field and restores focus");
            var secondBook = Guid.NewGuid();
            var secondCatalog = JsonSummaryCatalog.Create(new(data, Path.Combine(data, "book-b", "catalog.json"), secondBook));
            var rebound = new SummaryManagerWindow(secondCatalog, "合成账套 B") { Owner = owner };
            Drive(rebound, window =>
            {
                Check(window.State.BookId == secondBook && window.State.Categories.Count == 0, "new host binding isolates second book");
                Click(window, "CancelWindowButton");
            });
            var intact = File.ReadAllBytes(location.CatalogPath);
            File.WriteAllText(location.CatalogPath, "synthetic damaged JSON");
            var damaged = new SummaryManagerWindow(catalog, "合成账套 A") { Owner = owner };
            Drive(damaged, window =>
            {
                Check(!Find<Button>(window, "AddCategoryButton").IsEnabled && !Find<Button>(window, "ChooseButton").IsEnabled, "damaged catalog cannot be edited or accepted");
                Check(Find<TextBlock>(window, "StatusMessage").Text.Contains("损坏", StringComparison.Ordinal), "damaged catalog shows explicit error");
                Check(File.ReadAllText(location.CatalogPath) == "synthetic damaged JSON", "damaged file is not silently reinitialized");
                Click(window, "CancelWindowButton");
            });
            File.WriteAllBytes(location.CatalogPath, intact);
            owner.Close(); app.Shutdown();
            WriteResult(true, null); return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex);
            if (artifacts.Length > 0) WriteResult(false, ex.ToString());
            app?.Shutdown(); return 1;
        }
        finally { if (Directory.Exists(data)) Directory.Delete(data, true); }
    }

    private static void WriteResult(bool passed, string? error) => File.WriteAllText(Path.Combine(artifacts, "smoke.json"),
        JsonSerializer.Serialize(new { passed, checks, renders, error, platform = Environment.OSVersion.ToString(), data = "synthetic only" }, new JsonSerializerOptions { WriteIndented = true }));
    private static void Drive(SummaryManagerWindow window, Action<SummaryManagerWindow> actions)
    {
        Exception? failure = null;
        var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(15) };
        timer.Tick += (_, _) => { failure ??= new TimeoutException("Summary manager smoke timed out."); timer.Stop(); window.Close(); };
        window.ContentRendered += (_, _) => window.Dispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle, new Action(() =>
        {
            try { Flush(window); actions(window); }
            catch (Exception ex) { failure = ex; try { Capture(window, "summary-failure.png"); } catch (Exception captureError) { Console.Error.WriteLine(captureError); } window.Close(); }
        }));
        timer.Start(); window.ShowDialog(); timer.Stop();
        if (failure is not null) throw new InvalidOperationException("Summary manager modal regression failed.", failure);
    }
    private static T Find<T>(Window window, string name) where T : FrameworkElement =>
        window.FindName(name) as T ?? throw new InvalidOperationException("Missing UI element " + name);
    private static void Click(Window window, string name)
    {
        Flush(window); var button = Find<Button>(window, name);
        Check(button.IsEnabled, name + " is enabled");
        button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent)); Flush(window);
    }
    private static void SetText(Window window, string name, string text)
    {
        var box = Find<TextBox>(window, name); box.Text = text;
        box.GetBindingExpression(TextBox.TextProperty)?.UpdateSource(); Flush(window);
    }
    private static void SelectEntry(Window window, Guid id)
    { Find<DataGrid>(window, "SummaryList").SelectedValue = id; Flush(window); }
    private static void Flush(Window window)
    { window.Dispatcher.Invoke(() => { }, DispatcherPriority.ApplicationIdle); window.UpdateLayout(); }
    private static void Check(bool condition, string message)
    { if (!condition) throw new InvalidOperationException(message); checks++; }
    private static void Capture(Window window, string filename)
    {
        Flush(window);
        var bitmap = new RenderTargetBitmap((int)Math.Ceiling(window.ActualWidth), (int)Math.Ceiling(window.ActualHeight), 96, 96, PixelFormats.Pbgra32);
        bitmap.Render(window);
        var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var stream = File.Create(Path.Combine(artifacts, filename)); encoder.Save(stream); renders.Add(filename);
    }
}
