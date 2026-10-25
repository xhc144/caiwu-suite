using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

internal static class NativeCapture
{
    internal static readonly List<object> Captures = [];
    internal static void Save(Window window, string filename)
    {
        window.Activate(); window.UpdateLayout();
        window.Dispatcher.Invoke(() => { }, DispatcherPriority.ApplicationIdle);
        // PrintWindow can otherwise return the previous compositor frame immediately
        // after routed handlers update controls. Keep pumping while WPF presents it.
        var frame = new DispatcherFrame();
        var settle = new DispatcherTimer(DispatcherPriority.ApplicationIdle, window.Dispatcher)
            { Interval = TimeSpan.FromMilliseconds(200) };
        settle.Tick += (_, _) => { settle.Stop(); frame.Continue = false; };
        settle.Start(); Dispatcher.PushFrame(frame);
        DwmFlush();
        var hwnd = new WindowInteropHelper(window).Handle;
        Program.Need(hwnd != 0 && GetWindowRect(hwnd, out _), "native HWND is visible for capture");
        GetWindowRect(hwnd, out var rect);
        var width = rect.Right - rect.Left; var height = rect.Bottom - rect.Top;
        Program.Need(width > 100 && height > 100, "native window bounds measured");
        var dc = GetWindowDC(hwnd); var memory = CreateCompatibleDC(dc);
        var bitmap = CreateCompatibleBitmap(dc, width, height); var previous = SelectObject(memory, bitmap);
        try
        {
            Program.Need(dc != 0 && memory != 0 && bitmap != 0 && PrintWindow(hwnd, memory, 2), "PrintWindow captures actual complete native window");
            var source = Imaging.CreateBitmapSourceFromHBitmap(bitmap, 0, Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
            var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(source));
            var path = Path.Combine(Program.Output, filename);
            using (var file = File.Create(path)) encoder.Save(file);
            var dpi = VisualTreeHelper.GetDpi(window);
            Captures.Add(new { file = filename, width, height, dpiX = dpi.PixelsPerInchX, dpiY = dpi.PixelsPerInchY,
                sha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(path))),
                method = "Win32 PrintWindow, complete native HWND including frame; no crop, resize or upscale" });
            CaptureDesktop(hwnd, filename);
        }
        finally { SelectObject(memory, previous); DeleteObject(bitmap); DeleteDC(memory); ReleaseDC(hwnd, dc); }
    }
    private static void CaptureDesktop(nint hwnd, string filename)
    {
        Program.Need(GetForegroundWindow() == hwnd, "actual module is foreground for desktop evidence");
        var width = GetSystemMetrics(0); var height = GetSystemMetrics(1);
        var screen = GetDC(0); var memory = CreateCompatibleDC(screen);
        var bitmap = CreateCompatibleBitmap(screen, width, height); var previous = SelectObject(memory, bitmap);
        try
        {
            Program.Need(screen != 0 && BitBlt(memory, 0, 0, width, height, screen, 0, 0, 0x40CC0020), "BitBlt captures actual foreground desktop");
            var source = Imaging.CreateBitmapSourceFromHBitmap(bitmap, 0, Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
            var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(source));
            var file = Path.GetFileNameWithoutExtension(filename) + "-desktop.png";
            var path = Path.Combine(Program.Output, file);
            using (var output = File.Create(path)) encoder.Save(output);
            GetWindowRect(hwnd, out var bounds);
            Captures.Add(new { file, width, height, windowBounds = new { bounds.Left, bounds.Top, bounds.Right, bounds.Bottom },
                sha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(path))),
                method = "Win32 desktop BitBlt with tested module HWND verified foreground; complete primary display, no crop, resize or upscale" });
        }
        finally { SelectObject(memory, previous); DeleteObject(bitmap); DeleteDC(memory); ReleaseDC(0, screen); }
    }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("dwmapi.dll")] private static extern int DwmFlush();
    [DllImport("user32.dll")] private static extern bool GetWindowRect(nint hwnd, out Rect rect);
    [DllImport("user32.dll")] private static extern nint GetWindowDC(nint hwnd);
    [DllImport("user32.dll")] private static extern nint GetDC(nint hwnd);
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern int ReleaseDC(nint hwnd, nint dc);
    [DllImport("user32.dll")] private static extern bool PrintWindow(nint hwnd, nint dc, uint flags);
    [DllImport("gdi32.dll")] private static extern nint CreateCompatibleDC(nint dc);
    [DllImport("gdi32.dll")] private static extern nint CreateCompatibleBitmap(nint dc, int width, int height);
    [DllImport("gdi32.dll")] private static extern nint SelectObject(nint dc, nint obj);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(nint obj);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(nint dc);
    [DllImport("gdi32.dll")] private static extern bool BitBlt(nint target, int x, int y, int width, int height, nint source, int sourceX, int sourceY, uint operation);
}
