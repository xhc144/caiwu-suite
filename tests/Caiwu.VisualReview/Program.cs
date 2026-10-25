using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using System.Windows;
using System.Windows.Automation.Peers;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Desktop;
using Caiwu.Desktop.Dialogs;
using Caiwu.Desktop.Controls;
using Caiwu.Desktop.Presentation;
using Caiwu.Desktop.Verification;
using Caiwu.Persistence.Sqlite;

internal static class Program
{
    private static readonly List<object> Captures = [];
    private static readonly List<string> Checks = [];
    private static readonly List<object> FontObservations = [];
    private static string output = "";
    private static nint displayMode;
    private static byte[]? originalDisplay;

    [STAThread]
    private static int Main(string[] args)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("An actual Windows WPF desktop is required.");
        output = Path.GetFullPath(args.Length > 0 ? args[0] : "artifacts/verification/modern");
        Directory.CreateDirectory(output);
        App? app = null;
        try
        {
            PrepareDesktop();
            app = new App(); app.InitializeComponent(); app.ShutdownMode = ShutdownMode.OnExplicitShutdown;
            var backend = new DesktopBackend(SqliteLedgerStore.Open, SqliteLedgerStore.Create,
                SqliteLedgerStore.RestoreBackup, s => new LedgerService(s), TemplateCatalog.All);
            var path = Path.Combine(output, "synthetic-visual-" + Guid.NewGuid().ToString("N") + ".caiwu");
            var postedId = SampleLedger.Create(backend, path);
            using var store = SqliteLedgerStore.Open(path);
            var service = new LedgerService(store);
            var snapshot = service.GetSnapshot();
            foreach (var (summary, amount, review) in new[] { ("办公用品采购 · 合成样例", 860m, false), ("差旅费用报销 · 合成样例", 2480.50m, true) })
            {
                var entryPlan = service.GetSnapshot();
                var voucher = service.SaveDraft(new(null, new(2026, 10, 18), "记", null, 2,
                    [new("5602", summary, amount, 0), new("1002", summary, 0, amount)], entryPlan.Revision, entryPlan.Book.Id), "制单员");
                if (review)
                {
                    var reviewPlan = service.GetSnapshot();
                    service.Review(voucher.Id, "审核员", new(reviewPlan.Book.Id, reviewPlan.Revision));
                }
            }
            var main = new MainWindow(backend); app.MainWindow = main; main.Show(); Pump();
            Call(main, "OpenVerificationBook", path); Pump(); SizeNative(main);
            Call(main, "ShowVerificationPage", 0); Pump(); Capture(main, "01-workspace.png");
            Call(main, "ShowVerificationPage", 1); Pump(); Capture(main, "02-vouchers.png");
            var pages = (TabControl)main.FindName("Pages"); Require(pages.Items.Count == 7, "Original navigation tabs were lost.");
            var grid = (DataGrid)main.FindName("VoucherGrid");
            Require(grid.Columns.All(c => c.ActualWidth >= 90), "Voucher columns collapsed.");
            Checks.Add("Original navigation and readable voucher columns");
            var button = Descendants<Button>(main).First(b => b.Content?.ToString()?.Contains("Ctrl+N") == true);
            button.ApplyTemplate();
            Require(button.Template.FindName("Frame", button) is Border { CornerRadius.TopLeft: > 0 }, "Modern Button template is not applied.");
            Require(UIElementAutomationPeer.CreatePeerForElement(button)?.GetAutomationControlType() == AutomationControlType.Button, "Button lost its UI Automation peer.");
            button.Focus(); Pump(); Require(button.IsKeyboardFocused, "Button cannot receive keyboard focus.");
            button.MoveFocus(new TraversalRequest(FocusNavigationDirection.Next)); Pump();
            Require(Keyboard.FocusedElement is not null, "Keyboard traversal lost focus.");
            Checks.Add("Modern button template, native automation peer and keyboard focus traversal");
            Require(main.FontSize == 14, "Custom main Window did not receive the application typography.");
            var searchBox = (TextBox)main.FindName("VoucherSearch");
            Require(ReferenceEquals(searchBox.Template, app.FindResource("DefaultTextBoxControlTemplate")), "Search input fell back to a legacy TextBox template.");
            var operatorInput = (ComboBox)main.FindName("OperatorInput");
            Require(ReferenceEquals(operatorInput.Template, app.FindResource("EditableComboBoxTemplate")), "Editable ComboBox fell back to a legacy template.");
            var date = (DatePicker)main.FindName("VoucherFrom");
            Require(date.Template.FindName("BorderElement", date) is Border, "DatePicker fell back to a legacy template.");
            Checks.Add("Application typography and actual Fluent TextBox, editable ComboBox and DatePicker templates");
            date.IsDropDownOpen = true; Pump();
            Require(date.Template.FindName("PART_Popup", date) is Popup { IsOpen: true }, "DatePicker calendar popup did not open.");
            date.IsDropDownOpen = false; Pump(); Checks.Add("Native DatePicker calendar popup opens and closes");
            var menu = Descendants<Menu>(main).Single(); var menuItem = (MenuItem)menu.Items[0];
            menuItem.IsSubmenuOpen = true; Pump(); Require(menuItem.IsSubmenuOpen, "Menu failed to open.");
            menuItem.IsSubmenuOpen = false; Pump(); Checks.Add("Existing native menu opens and closes");
            var posted = service.GetSnapshot().Vouchers.Single(v => v.Id == postedId);
            var editor = new VoucherEditorWindow(snapshot.Book, snapshot.Accounts, posted, "制单员", _ => throw new InvalidOperationException("Read-only sample.")) { Owner = main };
            editor.Show(); Pump(); SizeNative(editor); Capture(editor, "03-posted-voucher.png");
            Require(((DataGrid)editor.FindName("LinesGrid")).IsReadOnly && !((Button)editor.FindName("SaveButton")).IsEnabled,
                "Posted voucher is no longer read-only.");
            Checks.Add("Posted voucher remains read-only and Save stays disabled"); editor.Close(); Pump();
            // Exercise the native editable DataGrid template without changing persisted accounting data.
            var draft = service.GetSnapshot().Vouchers.First(v => v.Status == VoucherStatus.Draft);
            var editable = new VoucherEditorWindow(snapshot.Book, snapshot.Accounts, draft, "制单员", _ => throw new InvalidOperationException("Visual check must not save.")) { Owner = main };
            editable.Show(); Pump();
            var lines = (DataGrid)editable.FindName("LinesGrid"); lines.CurrentCell = new DataGridCellInfo(lines.Items[0], lines.Columns[3]);
            lines.ScrollIntoView(lines.Items[0], lines.Columns[3]); lines.Focus();
            Require(lines.BeginEdit(), "DataGrid amount cell cannot enter edit mode."); Pump();
            Require(Descendants<TextBox>(lines).Any(t => t.IsVisible), "Native amount editing TextBox was lost.");
            lines.CancelEdit(DataGridEditingUnit.Cell); lines.CancelEdit(DataGridEditingUnit.Row); editable.Close(); Pump();
            Checks.Add("Native DataGrid amount cell enters and cancels edit mode");
            var picker = new AccountPickerDialog(snapshot.Accounts, "1002") { Owner = main };
            picker.Show(); Pump();
            Require(((DataGrid)picker.FindName("AccountList")).Items.Count > 0, "Controls account picker lost rows under App resources.");
            var search = (TextBox)picker.FindName("AccountSearch"); search.Focus(); Pump();
            Require(search.IsKeyboardFocused, "Controls account picker search cannot receive focus.");
            picker.Close(); Pump();
            var summaries = new SummaryPickerDialog([new("visual-summary", "合成分类", "合成摘要完整原文")]) { Owner = main };
            summaries.Show(); Pump();
            Require(((DataGrid)summaries.FindName("SummaryList")).Items.Count == 1, "Controls summary picker lost rows under App resources.");
            Require(((TextBox)summaries.FindName("SummaryPreview")).IsReadOnly, "Controls summary preview lost read-only state.");
            summaries.Close(); Pump(); Checks.Add("Existing Controls account/summary dialogs render and retain focus/read-only semantics under global App resources");
            Call(main, "ShowVerificationPage", 4); Pump(); Capture(main, "04-trial-balance.png");
            Call(main, "ShowVerificationPage", 5); ((ComboBox)main.FindName("LedgerAccountInput")).SelectedValue = "1002";
            Call(main, "ShowVerificationPage", 5); Pump(); Capture(main, "05-bank-ledger.png");
            var report = new ReportCenterWindow(snapshot.Accounts, new(2026, 10, 1), new(2026, 10, 31),
                (kind, account, from, to) => ReportingQueries.Build(service, kind, account, from, to), (_, _) => { }) { Owner = main };
            report.Show(); Pump(); SizeNative(report); Capture(report, "06-reports.png");
            var reportGrid = (DataGrid)report.FindName("ReportGrid");
            var reportAmount = reportGrid.Columns.Single(c => c.Header?.ToString() == "期初借方");
            Require(reportAmount.GetCellContent(reportGrid.Items[0]) is TextBlock { TextAlignment: TextAlignment.Right }, "Generated report amount cells are not aligned right.");
            Checks.Add("Generated report amount cells align right without changing report bindings");
            report.Close(); Pump();
            main.Close(); Pump();
            SaveResult(true, null); app.Shutdown(0); return 0;
        }
        catch (Exception ex)
        {
            SaveResult(false, ex.ToString()); app?.Shutdown(1); return 1;
        }
        finally
        {
            if (originalDisplay is not null) { Marshal.Copy(originalDisplay, 0, displayMode, 220); ChangeDisplaySettings(displayMode, 0); }
            if (displayMode != 0) Marshal.FreeHGlobal(displayMode);
        }
    }

    private static void SaveResult(bool success, string? error) => File.WriteAllText(Path.Combine(output, "visual-review.json"),
        JsonSerializer.Serialize(new { success, actualWindowsWpf = true, syntheticOnly = true,
            captureMethod = "Win32 PrintWindow, complete native window including non-client frame; no image resize or crop",
            checkoutCommit = Environment.GetEnvironmentVariable("CAIWU_VISUAL_COMMIT"),
            sourceTree = Environment.GetEnvironmentVariable("CAIWU_VISUAL_SOURCE_TREE"),
            generatedAtUtc = DateTimeOffset.UtcNow, installedUiFonts = Fonts.SystemFontFamilies.Select(f => f.Source).Where(f => f.Contains("Segoe", StringComparison.OrdinalIgnoreCase) || f.Contains("YaHei", StringComparison.OrdinalIgnoreCase) || f.Contains("DengXian", StringComparison.OrdinalIgnoreCase) || f.Contains("SimSun", StringComparison.OrdinalIgnoreCase)).Order().ToArray(), checks = Checks, fontObservations = FontObservations, screenshots = Captures, error }, new JsonSerializerOptions { WriteIndented = true }));

    private static void PrepareDesktop()
    {
        // Same native mode protocol as the existing independent Acceptance high-resolution runner.
        displayMode = Marshal.AllocHGlobal(220); Marshal.Copy(new byte[220], 0, displayMode, 220);
        Marshal.WriteInt16(displayMode, 68, 220);
        Require(EnumDisplaySettings(null, -1, displayMode), "Cannot read actual Windows display mode.");
        originalDisplay = new byte[220]; Marshal.Copy(displayMode, originalDisplay, 0, 220);
        if (GetSystemMetrics(0) < 1920 || GetSystemMetrics(1) < 1080)
        {
            Marshal.WriteInt32(displayMode, 72, Marshal.ReadInt32(displayMode, 72) | 0x180000);
            Marshal.WriteInt32(displayMode, 172, 1920); Marshal.WriteInt32(displayMode, 176, 1080);
            Require(ChangeDisplaySettings(displayMode, 2) == 0 && ChangeDisplaySettings(displayMode, 0) == 0,
                "Runner display does not support native 1920x1080; no upscaled capture allowed.");
        }
        Require(GetSystemMetrics(0) >= 1920 && GetSystemMetrics(1) >= 1080, "Native display mode change was ineffective.");
    }
    private static void SizeNative(Window window)
    {
        window.WindowState = WindowState.Normal; window.Activate(); Pump();
        var hwnd = new WindowInteropHelper(window).Handle;
        Require(SetWindowPos(hwnd, 0, 0, 0, 1920, 1080, 0x0004 | 0x0010), "SetWindowPos failed."); Pump();
        Require(GetWindowRect(hwnd, out var rect) && rect.Right - rect.Left == 1920 && rect.Bottom - rect.Top == 1080,
            "Runner did not create a native 1920x1080 window; no upscale is allowed.");
    }
    private static void Capture(Window window, string file)
    {
        window.Activate(); window.UpdateLayout(); Pump();
        ObserveFonts(window, file);
        var hwnd = new WindowInteropHelper(window).Handle;
        Require(GetWindowRect(hwnd, out var rect), "Cannot measure native window.");
        int width = rect.Right - rect.Left, height = rect.Bottom - rect.Top;
        Require(width >= 1920 && height >= 1080, "Native screenshot is below requested resolution.");
        var dc = GetWindowDC(hwnd); Require(dc != 0, "GetWindowDC failed.");
        var memory = CreateCompatibleDC(dc); var bitmap = CreateCompatibleBitmap(dc, width, height);
        var old = SelectObject(memory, bitmap);
        try
        {
            Require(PrintWindow(hwnd, memory, 2), "PrintWindow failed; no screenshot inferred.");
            var source = Imaging.CreateBitmapSourceFromHBitmap(bitmap, 0, Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
            Require(source.PixelWidth == width && source.PixelHeight == height, "Capture size differs from native bounds.");
            var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(source));
            var path = Path.Combine(output, file); using (var stream = File.Create(path)) encoder.Save(stream);
            var dpi = VisualTreeHelper.GetDpi(window);
            Captures.Add(new { file, width, height, dpiX = dpi.PixelsPerInchX, dpiY = dpi.PixelsPerInchY,
                contentWidthDip = ((FrameworkElement)window.Content).ActualWidth, contentHeightDip = ((FrameworkElement)window.Content).ActualHeight,
                sha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(path))) });
        }
        finally { SelectObject(memory, old); DeleteObject(bitmap); DeleteDC(memory); ReleaseDC(hwnd, dc); }
    }
    private static void ObserveFonts(Window window, string file)
    {
        var cells = Descendants<DataGrid>(window).Where(g => g.IsVisible && g.Items.Count > 0)
            .SelectMany(g => g.Columns.Select(c => c.GetCellContent(g.Items[0]))).OfType<TextBlock>();
        var labels = Descendants<TextBlock>(window).Where(t => t.IsVisible && !string.IsNullOrWhiteSpace(t.Text)).Take(16);
        foreach (var text in cells.Concat(labels).Distinct())
        {
            var glyphs = Glyphs(VisualTreeHelper.GetDrawing(text)).ToArray();
            FontObservations.Add(new { file, text = text.Text.Length > 64 ? text.Text[..64] : text.Text,
                declaredFamily = text.FontFamily.Source, size = text.FontSize, weight = text.FontWeight.ToString(),
                foreground = text.Foreground?.ToString(),
                actualFamilies = glyphs.SelectMany(g => g.FamilyNames.Values).Distinct().ToArray() });
        }
    }
    private static IEnumerable<GlyphTypeface> Glyphs(Drawing? drawing)
    {
        if (drawing is GlyphRunDrawing glyph) yield return glyph.GlyphRun.GlyphTypeface;
        if (drawing is DrawingGroup group)
            foreach (var child in group.Children)
                foreach (var face in Glyphs(child)) yield return face;
    }
    private static object? Call(object target, string name, params object[] args)
    {
        try { return target.GetType().GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(target, args); }
        catch (TargetInvocationException ex) { System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(ex.InnerException!).Throw(); throw; }
    }
    private static void Pump()
    {
        var frame = new DispatcherFrame(); Dispatcher.CurrentDispatcher.InvokeAsync(() => frame.Continue = false, DispatcherPriority.ApplicationIdle);
        Dispatcher.PushFrame(frame);
    }
    private static IEnumerable<T> Descendants<T>(DependencyObject root) where T : DependencyObject
    {
        for (int i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++)
        {
            var child = VisualTreeHelper.GetChild(root, i); if (child is T match) yield return match;
            foreach (var descendant in Descendants<T>(child)) yield return descendant;
        }
    }
    private static void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool EnumDisplaySettings(string? device, int mode, nint settings);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int ChangeDisplaySettings(nint settings, int flags);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetWindowPos(nint hwnd, nint after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetWindowRect(nint hwnd, out Rect rect);
    [DllImport("user32.dll")] private static extern nint GetWindowDC(nint hwnd);
    [DllImport("user32.dll")] private static extern int ReleaseDC(nint hwnd, nint dc);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool PrintWindow(nint hwnd, nint dc, uint flags);
    [DllImport("gdi32.dll")] private static extern nint CreateCompatibleDC(nint dc);
    [DllImport("gdi32.dll")] private static extern nint CreateCompatibleBitmap(nint dc, int width, int height);
    [DllImport("gdi32.dll")] private static extern nint SelectObject(nint dc, nint obj);
    [DllImport("gdi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DeleteObject(nint obj);
    [DllImport("gdi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DeleteDC(nint dc);
}
