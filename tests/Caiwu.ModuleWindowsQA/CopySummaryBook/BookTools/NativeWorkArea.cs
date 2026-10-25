using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;

internal sealed class NativeDisplayMode : IDisposable
{
    private readonly byte[] original;
    internal NativeDisplayMode(int width, int height)
    {
        var mode = Marshal.AllocHGlobal(220);
        try
        {
            Marshal.Copy(new byte[220], 0, mode, 220); Marshal.WriteInt16(mode, 68, 220);
            Program.Need(EnumDisplaySettings(null, -1, mode), "read actual native display mode");
            original = new byte[220]; Marshal.Copy(mode, original, 0, 220);
            Marshal.WriteInt32(mode, 72, Marshal.ReadInt32(mode, 72) | 0x180000);
            Marshal.WriteInt32(mode, 172, width); Marshal.WriteInt32(mode, 176, height);
            Program.Need(ChangeDisplaySettings(mode, 2) == 0 && ChangeDisplaySettings(mode, 0) == 0, "requested native display mode supported and applied");
            Program.Need(GetSystemMetrics(0) == width && GetSystemMetrics(1) == height, $"actual display is {width}x{height}, no resized screenshot");
        }
        finally { Marshal.FreeHGlobal(mode); }
    }
    public void Dispose()
    {
        var mode = Marshal.AllocHGlobal(220);
        try { Marshal.Copy(original, 0, mode, original.Length); Program.Need(ChangeDisplaySettings(mode, 0) == 0, "original display mode restored"); }
        finally { Marshal.FreeHGlobal(mode); }
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool EnumDisplaySettings(string? device, int mode, nint settings);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int ChangeDisplaySettings(nint settings, int flags);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
}

internal static class NativeWorkArea
{
    internal static object Verify(Window window)
    {
        Pump(); window.UpdateLayout();
        var hwnd = new WindowInteropHelper(window).Handle;
        var info = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
        Program.Need(GetMonitorInfo(MonitorFromWindow(hwnd, 2), ref info) && GetWindowRect(hwnd, out _), "independently read actual monitor work area and HWND bounds");
        GetWindowRect(hwnd, out var bounds);
        Program.Need(bounds.Left >= info.Work.Left - 1 && bounds.Top >= info.Work.Top - 1 && bounds.Right <= info.Work.Right + 1 && bounds.Bottom <= info.Work.Bottom + 1, "complete HWND fits physical work area including taskbar exclusion");
        foreach (var name in new[] { "Confirmation", "ExecuteButton", "CancelButton" })
        {
            var control = (FrameworkElement)window.FindName(name);
            var first = control.PointToScreen(new Point());
            var last = control.PointToScreen(new Point(control.ActualWidth, control.ActualHeight));
            Program.Need(control.IsVisible && first.X >= info.Work.Left && first.Y >= info.Work.Top && last.X <= info.Work.Right + 1 && last.Y <= info.Work.Bottom + 1, name + " fully visible inside real work area");
        }
        var dpi = VisualTreeHelper.GetDpi(window);
        return new { workArea = new { info.Work.Left, info.Work.Top, info.Work.Right, info.Work.Bottom }, windowBounds = new { bounds.Left, bounds.Top, bounds.Right, bounds.Bottom }, window.MaxWidth, window.MaxHeight, dpiX = dpi.PixelsPerInchX, dpiY = dpi.PixelsPerInchY };
    }
    internal static void Click(Window window, FrameworkElement control)
    {
        control.BringIntoView(); window.Activate(); Pump();
        Program.Need(control.IsEnabled && control.IsVisible, "native mouse target enabled and visible");
        var center = new Point(control.ActualWidth / 2, control.ActualHeight / 2);
        var inWindow = control.TransformToAncestor(window).Transform(center);
        var hit = window.InputHitTest(inWindow) as DependencyObject;
        Program.Need(hit is not null && (ReferenceEquals(hit, control) || control.IsAncestorOf(hit)), "native mouse target passes actual WPF hit test without overlay");
        Program.Need(GetForegroundWindow() == new WindowInteropHelper(window).Handle, "native mouse target is actual foreground module");
        var screen = control.PointToScreen(center);
        Program.Need(SetCursorPos((int)Math.Round(screen.X), (int)Math.Round(screen.Y)), "native cursor positioned on tested control");
        Input[] inputs = [new() { Data = new() { Mouse = new() { Flags = 2 } } }, new() { Data = new() { Mouse = new() { Flags = 4 } } }];
        Program.Need(SendInput(2, inputs, Marshal.SizeOf<Input>()) == 2, "SendInput delivered real mouse down/up");
        Pump();
    }
    internal static void Pump()
    {
        var frame = new DispatcherFrame();
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(120) };
        timer.Tick += (_, _) => { timer.Stop(); frame.Continue = false; };
        timer.Start(); Dispatcher.PushFrame(frame);
    }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }
    [StructLayout(LayoutKind.Sequential)] private struct Input { public uint Type; public InputUnion Data; }
    [StructLayout(LayoutKind.Explicit)] private struct InputUnion
    {
        [FieldOffset(0)] public MouseInput Mouse;
        [FieldOffset(0)] public KeyboardInput Keyboard;
    }
    [StructLayout(LayoutKind.Sequential)] private struct MouseInput { public int X, Y; public uint Data, Flags, Time; public nuint Extra; }
    [StructLayout(LayoutKind.Sequential)] private struct KeyboardInput { public ushort Key, Scan; public uint Flags, Time; public nuint Extra; }
    [DllImport("user32.dll")] private static extern nint MonitorFromWindow(nint hwnd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern bool GetMonitorInfo(nint monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(nint hwnd, out Rect rect);
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, Input[] inputs, int size);
}
