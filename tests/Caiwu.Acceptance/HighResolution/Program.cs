using Caiwu.Desktop.Testing;
using System.Collections.ObjectModel;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Caiwu.Desktop;
using Caiwu.Desktop.Dialogs;
using Caiwu.Desktop.Presentation;
using Caiwu.Desktop.Verification;

internal static class Program
{
    private const int ModeBytes = 220;
    [STAThread] private static int Main(string[] args)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Actual Windows desktop required.");
        var output = Path.GetFullPath(args[0]); Directory.CreateDirectory(output);
        var mode = Marshal.AllocHGlobal(ModeBytes); byte[]? original = null;
        var captures = new List<object>();
        try
        {
            SetProcessDpiAwarenessContext(new IntPtr(-4));
            Marshal.Copy(new byte[ModeBytes], 0, mode, ModeBytes); Marshal.WriteInt16(mode, 68, ModeBytes);
            if (!EnumDisplaySettings(null, -1, mode)) throw new InvalidOperationException("BLOCKED: cannot read actual desktop mode.");
            original = new byte[ModeBytes]; Marshal.Copy(mode, original, 0, ModeBytes);
            if (GetSystemMetrics(0) < 1920 || GetSystemMetrics(1) < 1080)
            {
                Marshal.WriteInt32(mode, 72, Marshal.ReadInt32(mode, 72) | 0x180000);
                Marshal.WriteInt32(mode, 172, 1920); Marshal.WriteInt32(mode, 176, 1080);
                if (ChangeDisplaySettings(mode, 2) != 0 || ChangeDisplaySettings(mode, 0) != 0)
                    throw new InvalidOperationException("BLOCKED: native desktop does not support 1920x1080; no upscaled image produced.");
            }
            if (GetSystemMetrics(0) < 1920 || GetSystemMetrics(1) < 1080) throw new InvalidOperationException("BLOCKED: desktop mode change was ineffective.");
            var app = new App(); app.InitializeComponent(); app.ShutdownMode = ShutdownMode.OnExplicitShutdown;
            var backend = SyntheticDesktopIdentity.Backend;
            var path = Path.Combine(output, "synthetic.caiwu"); SyntheticDesktopIdentity.SeedSample(path);
            var main = SyntheticDesktopIdentity.CreateMain(backend); app.MainWindow = main; main.Show(); Call(main, "OpenVerificationBook", path);
            main.WindowState = WindowState.Maximized; Idle(main);
            Call(main, "ShowVerificationPage", 1); Capture(main, "main-window.png");
            ((ComboBox)main.FindName("LedgerAccountInput")).SelectedValue = "1002";
            Call(main, "ShowVerificationPage", 5); Capture(main, "ledger.png");
            var editor = (VoucherEditorWindow)Call(main, "CreateVerificationEditor", (object?)null)!;
            editor.Show(); editor.WindowState = WindowState.Maximized;
            var rows = (ObservableCollection<VoucherLineEdit>)((DataGrid)editor.FindName("LinesGrid")).ItemsSource;
            rows[0].AccountCode = "1002"; rows[0].Summary = "合成凭证 · 待保存输入"; rows[0].DebitText = "1234.56";
            rows[1].AccountCode = "3001"; rows[1].Summary = "合成凭证 · 待保存输入"; rows[1].CreditText = "1234.56";
            Capture(editor, "voucher-editor.png");
            // Cleanup only after capture; no save is claimed and synthetic pending input is deliberately discarded.
            typeof(VoucherEditorWindow).GetField("_dirty", BindingFlags.Instance | BindingFlags.NonPublic)?.SetValue(editor, false); editor.Close();
            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
            Exception? reportError = null;
            timer.Tick += (_, _) =>
            {
                var report = app.Windows.OfType<ReportCenterWindow>().FirstOrDefault(); if (report is null) return;
                timer.Stop();
                try { report.WindowState = WindowState.Maximized; Capture(report, "report.png"); }
                catch (Exception e) { reportError = e; }
                finally { report.Close(); }
            };
            timer.Start(); Call(main, "ReportCenter_Click", main, new RoutedEventArgs()); timer.Stop();
            if (reportError is not null) throw reportError;
            if (captures.Count != 4) throw new InvalidOperationException("Four actual page captures were not generated.");
            main.Close();
            File.WriteAllText(Path.Combine(output, "screenshots.json"), JsonSerializer.Serialize(new
            {
                checkoutCommit = Environment.GetEnvironmentVariable("CAIWU_REVALIDATION_COMMIT"),
                actualWindowsDesktop = true, syntheticDataOnly = true, resizedOrUpscaled = false,
                mechanism = "Native primary desktop BitBlt, actual self-authored WPF windows maximized; no original commercial program run.",
                captures
            }, new JsonSerializerOptions { WriteIndented = true }));
            app.Shutdown(); return 0;
        }
        catch (Exception e) { File.WriteAllText(Path.Combine(output, "capture-failure.txt"), e.ToString()); Console.Error.WriteLine(e); return 1; }
        finally { if (original is not null) { Marshal.Copy(original, 0, mode, ModeBytes); ChangeDisplaySettings(mode, 0); } Marshal.FreeHGlobal(mode); }

        void Capture(Window window, string file)
        {
            window.Activate(); Idle(window);
            if (GetForegroundWindow() != new WindowInteropHelper(window).Handle)
                throw new InvalidOperationException("BLOCKED: intended WPF page is not the foreground native window.");
            var width = GetSystemMetrics(0); var height = GetSystemMetrics(1);
            var screen = GetDC(IntPtr.Zero); var dc = CreateCompatibleDC(screen); var bmp = CreateCompatibleBitmap(screen, width, height); var previous = SelectObject(dc, bmp);
            try
            {
                if (!BitBlt(dc, 0, 0, width, height, screen, 0, 0, 0x40CC0020)) throw new InvalidOperationException("Native desktop capture failed.");
                var source = Imaging.CreateBitmapSourceFromHBitmap(bmp, IntPtr.Zero, Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
                var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(source));
                var filePath = Path.Combine(output, file); using (var stream = File.Create(filePath)) encoder.Save(stream);
                captures.Add(new { file, width, height, windowDpi = GetDpiForWindow(new WindowInteropHelper(window).Handle), sha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(filePath))) });
            }
            finally { SelectObject(dc, previous); DeleteObject(bmp); DeleteDC(dc); ReleaseDC(IntPtr.Zero, screen); }
        }
    }
    private static object? Call(object target, string name, params object?[] args) => target.GetType().GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(target, args);
    private static void Idle(Window window) { window.UpdateLayout(); window.Dispatcher.Invoke(() => { }, DispatcherPriority.ApplicationIdle); Thread.Sleep(200); }
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool EnumDisplaySettings(string? device, int mode, IntPtr settings);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int ChangeDisplaySettings(IntPtr settings, int flags);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int width, int height);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] private static extern bool BitBlt(IntPtr destination, int x, int y, int width, int height, IntPtr source, int sx, int sy, uint operation);
}
