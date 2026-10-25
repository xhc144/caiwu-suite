using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media.Imaging;

namespace Caiwu.ModuleWindowsQA.Financial;

internal static partial class Program
{
    // Native primary-desktop capture and INPUT layouts adapted from existing HighResolution/NativeFocus probes.
    private sealed class NativeDesktop : IDisposable
    {
        private readonly IntPtr mode = Marshal.AllocHGlobal(220);
        private byte[]? original;
        public NativeDesktop()
        {
            Marshal.Copy(new byte[220], 0, mode, 220); Marshal.WriteInt16(mode, 68, 220);
            if (!EnumDisplaySettings(null, -1, mode)) throw new InvalidOperationException("BLOCKED: cannot read native display mode.");
            original = new byte[220]; Marshal.Copy(mode, original, 0, 220);
            if (GetSystemMetrics(0) < 1920 || GetSystemMetrics(1) < 1080)
            {
                Marshal.WriteInt32(mode, 72, Marshal.ReadInt32(mode, 72) | 0x180000);
                Marshal.WriteInt32(mode, 172, 1920); Marshal.WriteInt32(mode, 176, 1080);
                if (ChangeDisplaySettings(mode, 2) != 0 || ChangeDisplaySettings(mode, 0) != 0)
                    throw new InvalidOperationException("BLOCKED: native display cannot show 1920x1080; no rescaled evidence.");
            }
        }
        public void Dispose()
        {
            if (original is not null) { Marshal.Copy(original, 0, mode, 220); ChangeDisplaySettings(mode, 0); }
            Marshal.FreeHGlobal(mode);
        }
    }
    private static async Task Capture(Window window, string name)
    {
        window.Activate(); window.UpdateLayout(); await Settle();
        var handle = new WindowInteropHelper(window).Handle;
        Check(GetForegroundWindow() == handle, "capture foreground is intended component window");
        GetClientRect(handle, out var bounds); var origin = new PointNative(); ClientToScreen(handle, ref origin);
        var width = GetSystemMetrics(0); var height = GetSystemMetrics(1);
        Check(origin.X >= 0 && origin.Y >= 0 && origin.X + bounds.Right <= width && origin.Y + bounds.Bottom <= height, "complete native client fits desktop without clipping");
        var screen = GetDC(IntPtr.Zero); var dc = CreateCompatibleDC(screen); var bitmap = CreateCompatibleBitmap(screen, width, height); var previous = SelectObject(dc, bitmap);
        try
        {
            if (!BitBlt(dc, 0, 0, width, height, screen, 0, 0, 0x40CC0020)) throw new InvalidOperationException("Native BitBlt failed.");
            var image = Imaging.CreateBitmapSourceFromHBitmap(bitmap, IntPtr.Zero, Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
            var png = new PngBitmapEncoder(); png.Frames.Add(BitmapFrame.Create(image));
            var path = Path.Combine(output, name); using (var stream = File.Create(path)) png.Save(stream);
            captures.Add(new { name, width, height, dpi = GetDpiForWindow(handle), sha256 = Hash(path), mechanism = "Native primary-desktop BitBlt; no crop/resize", client = new { origin.X, origin.Y, bounds.Right, bounds.Bottom } });
        }
        finally { SelectObject(dc, previous); DeleteObject(bitmap); DeleteDC(dc); ReleaseDC(IntPtr.Zero, screen); }
    }
    private static async Task TypeChinese(Window window, TextBox box, string value)
    {
        window.Activate(); box.Focus(); box.Clear(); await Settle();
        Check(GetForegroundWindow() == new WindowInteropHelper(window).Handle && ReferenceEquals(Keyboard.FocusedElement, box), "native Unicode input has exact foreground textbox focus");
        Send(value.SelectMany(c => new[] { KeyInput(0, c, 4), KeyInput(0, c, 6) }).ToArray());
        await Settle(); box.GetBindingExpression(TextBox.TextProperty)?.UpdateSource();
        Check(box.Text == value, "ordinary Chinese/ASCII/punctuation accepted through native Unicode input; IME not claimed");
    }
    private static void NativeDialog(Action open, string? path, Action? whileOpen = null)
    {
        var driver = Task.Run(() => {
            var until = DateTime.UtcNow.AddSeconds(12);
            while (DateTime.UtcNow < until)
            {
                var handle = GetForegroundWindow(); GetWindowThreadProcessId(handle, out var pid);
                var cls = new StringBuilder(64); GetClassName(handle, cls, cls.Capacity);
                if (pid == Environment.ProcessId && cls.ToString() == "#32770")
                {
                    try
                    {
                    whileOpen?.Invoke();
                    if (path is null) Send([KeyInput(0x1b, 0, 0), KeyInput(0x1b, 0, 2)]);
                    else
                    {
                        var root = AutomationElement.FromHandle(handle);
                        var edit = root.FindFirst(TreeScope.Descendants, new AndCondition(
                            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
                            new PropertyCondition(AutomationElement.AutomationIdProperty, "1001")))
                            ?? throw new InvalidOperationException("Actual native File name edit (1001) not found.");
                        ((ValuePattern)edit.GetCurrentPattern(ValuePattern.Pattern)).SetValue(path);
                        var accept = root.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button))
                            .Cast<AutomationElement>().FirstOrDefault(e => e.Current.Name is "Save" or "Open" or "保存" or "保存(S)" or "打开" or "打开(O)")
                            ?? throw new InvalidOperationException("Actual native Save/Open button not found.");
                        ((InvokePattern)accept.GetCurrentPattern(InvokePattern.Pattern)).Invoke();
                    }
                        return;
                    }
                    catch
                    {
                        // Release a failed native picker so other independent component cases still run.
                        Send([KeyInput(0x1b, 0, 0), KeyInput(0x1b, 0, 2)]); throw;
                    }
                }
                Thread.Sleep(80);
            }
            throw new TimeoutException("Actual native file dialog did not appear within 12 seconds.");
        });
        open();
        if (!driver.Wait(TimeSpan.FromSeconds(14))) throw new TimeoutException("Native dialog driver exceeded its deadline.");
        driver.GetAwaiter().GetResult(); checks.Add(path is null ? "actual native dialog cancelled" : "actual native dialog selected permitted synthetic path");
    }
    [StructLayout(LayoutKind.Sequential)] private struct NativeInput { public uint Type; public InputUnion Data; }
    [StructLayout(LayoutKind.Explicit)] private struct InputUnion { [FieldOffset(0)] public KeyboardInput Keyboard; [FieldOffset(0)] public MouseInput Mouse; }
    [StructLayout(LayoutKind.Sequential)] private struct KeyboardInput { public ushort Key, Scan; public uint Flags, Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] private struct MouseInput { public int X, Y; public uint Data, Flags, Time; public UIntPtr Extra; }
    private static NativeInput KeyInput(ushort key, ushort scan, uint flags) => new() { Type = 1, Data = new() { Keyboard = new() { Key = key, Scan = scan, Flags = flags } } };
    private static void Send(NativeInput[] input) { if (SendInput((uint)input.Length, input, Marshal.SizeOf<NativeInput>()) != input.Length) throw new InvalidOperationException("BLOCKED: native SendInput incomplete."); }
    [StructLayout(LayoutKind.Sequential)] private struct RectNative { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct PointNative { public int X, Y; }
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, NativeInput[] inputs, int size);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out int pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int count);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr window, out RectNative bounds);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr window, ref PointNative point);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool EnumDisplaySettings(string? device, int mode, IntPtr settings);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int ChangeDisplaySettings(IntPtr settings, int flags);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int width, int height);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr item);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr item);
    [DllImport("gdi32.dll")] private static extern bool BitBlt(IntPtr destination, int x, int y, int width, int height, IntPtr source, int sx, int sy, uint op);
}
