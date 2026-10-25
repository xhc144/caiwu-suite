using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Threading;

internal static class NativeInput
{
    public static int DeliveredEvents { get; private set; }
    public static void Pump(int milliseconds = 120)
    {
        var frame = new DispatcherFrame();
        var timer = new DispatcherTimer(DispatcherPriority.Background) { Interval = TimeSpan.FromMilliseconds(milliseconds) };
        timer.Tick += (_, _) => { timer.Stop(); frame.Continue = false; };
        timer.Start(); Dispatcher.PushFrame(frame);
    }
    public static void Until(Func<bool> condition, string failure)
    {
        var elapsed = Stopwatch.StartNew();
        while (!condition() && elapsed.Elapsed < TimeSpan.FromSeconds(3)) Pump(30);
        Program.Require(condition(), failure);
    }
    public static void Foreground(Window window)
    {
        window.Activate(); SetForegroundWindow(new WindowInteropHelper(window).Handle); Pump();
        Program.Require(GetForegroundWindow() == new WindowInteropHelper(window).Handle, "Native input foreground unavailable.");
    }
    public static void Fill(Window window, string name, string text)
    {
        var target = (Control)window.FindName(name); target.BringIntoView(); target.Focus(); Pump(40);
        Program.Require(target.IsKeyboardFocusWithin, "Requested input did not receive keyboard focus.");
        Send(window, [KeyInput(0x11, 0, 0), KeyInput(0x41, 0, 0), KeyInput(0x41, 0, 2), KeyInput(0x11, 0, 2)]);
        Send(window, text.SelectMany(c => new[] { KeyInput(0, c, 4), KeyInput(0, c, 6) }).ToArray());
        Until(() => target switch { TextBox box => box.Text == text, PasswordBox box => box.Password == text, _ => false }, "Native typing was not accepted.");
    }
    public static void Press(Window window, ushort key)
    {
        Send(window, [KeyInput(key, 0, 0), KeyInput(key, 0, 2)]); Pump();
    }
    public static void Click(Window window, FrameworkElement target)
    {
        target.BringIntoView(); window.UpdateLayout(); Pump(40);
        Program.Require(target.IsVisible && target.IsEnabled && target.ActualWidth > 0 && target.ActualHeight > 0, "Native click target unavailable.");
        var point = target.PointToScreen(new Point(target.ActualWidth / 2, target.ActualHeight / 2));
        Program.Require(SetCursorPos((int)point.X, (int)point.Y), "Cannot position synthetic mouse.");
        Send(window, [new() { Type = 0, Data = new() { Mouse = new() { Flags = 2 } } }, new() { Type = 0, Data = new() { Mouse = new() { Flags = 4 } } }]); Pump();
    }
    public static void Click(Window window, string name) => Click(window, (FrameworkElement)window.FindName(name));
    public static void Toggle(Window window, string name, bool enabled)
    {
        var box = (CheckBox)window.FindName(name);
        if (box.IsChecked != enabled) Click(window, box);
        Program.Require(box.IsChecked == enabled, "Role/enable native toggle failed.");
    }
    public static void Tab(Window window, string from, string to)
    {
        ((Control)window.FindName(from)).Focus(); Pump(40); Press(window, 0x09);
        Program.Require(((Control)window.FindName(to)).IsKeyboardFocusWithin, "Native Tab did not reach the expected field.");
    }
    [StructLayout(LayoutKind.Sequential)] private struct Input { public uint Type; public InputUnion Data; }
    [StructLayout(LayoutKind.Explicit)] private struct InputUnion
    {
        [FieldOffset(0)] public KeyboardInput Keyboard;
        [FieldOffset(0)] public MouseInput Mouse;
    }
    [StructLayout(LayoutKind.Sequential)] private struct KeyboardInput { public ushort Key, Scan; public uint Flags, Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] private struct MouseInput { public int X, Y; public uint Data, Flags, Time; public UIntPtr Extra; }
    private static Input KeyInput(ushort key, ushort scan, uint flags) => new() { Type = 1, Data = new() { Keyboard = new() { Key = key, Scan = scan, Flags = flags } } };
    private static void Send(Window target, Input[] inputs)
    {
        Program.Require(GetForegroundWindow() == new WindowInteropHelper(target).Handle, "Native target lost foreground.");
        if (inputs.Length == 0) return;
        var sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<Input>());
        Program.Require(sent == inputs.Length, "Native SendInput was incomplete; interaction remains unverified.");
        DeliveredEvents += inputs.Length;
    }
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
}
