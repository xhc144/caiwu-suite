// External UIA and native input/capture helpers adapted from the reviewed InstalledDesktop controller.
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Automation;
using System.Windows.Interop;
using System.Windows.Media.Imaging;
using Caiwu.Delivery;
internal static partial class Program
{
    private static Condition Id(string id) => new PropertyCondition(AutomationElement.AutomationIdProperty, id);
    private static Condition Name(string name) => new PropertyCondition(AutomationElement.NameProperty, name);
    private static string Text(AutomationElement root, string id) => root.FindFirst(TreeScope.Descendants, Id(id))?.Current.Name ?? "";
    private static void Until(Func<bool> predicate, string description, int timeout = 15000)
    {
        var watch = Stopwatch.StartNew(); while (watch.ElapsedMilliseconds < timeout) { try { if (predicate()) return; } catch (ElementNotAvailableException) { } Thread.Sleep(100); }
        throw new TimeoutException(description);
    }
    private static AutomationElement Window(Func<string, bool> matches)
    {
        AutomationElement? found = null; Until(() => { found = ProductWindows().FirstOrDefault(e => matches(e.Current.Name)); return found is not null; }, "product window"); return found!;
    }
    private static IEnumerable<AutomationElement> ProductWindows()
    {
        // WPF owned ShowDialog windows are children of their owner in the UIA
        // tree even though they have native HWNDs. Native file dialogs may be roots.
        var roots = AutomationElement.RootElement.FindAll(TreeScope.Children, new PropertyCondition(AutomationElement.ProcessIdProperty, desktop!.Id)).Cast<AutomationElement>();
        foreach (var root in roots)
        {
            yield return root;
            foreach (var child in root.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Window)).Cast<AutomationElement>()) yield return child;
        }
    }
    private static bool HasWindow(string title) => ProductWindows().Any(e => e.Current.Name == title);
    private static void Invoke(AutomationElement root, Condition condition)
    {
        AutomationElement? item = null;
        Until(() => { item = root.FindFirst(TreeScope.Descendants, condition); return item?.Current.IsEnabled == true; }, "actual enabled control: " + condition);
        ((InvokePattern)item!.GetCurrentPattern(InvokePattern.Pattern)).Invoke(); Thread.Sleep(150);
    }
    private static void SetValue(AutomationElement element, string text) => ((ValuePattern)element.GetCurrentPattern(ValuePattern.Pattern)).SetValue(text);
    private static void Close(AutomationElement window) { ((WindowPattern)window.GetCurrentPattern(WindowPattern.Pattern)).Close(); Thread.Sleep(150); }
    private static void Login(string login, bool rejectWrongFirst = false)
    {
        var window = Window(title => title == "操作员登录"); SetValue(window.FindFirst(TreeScope.Descendants, Id("OperatorLoginName"))!, login);
        var password = window.FindFirst(TreeScope.Descendants, Id("OperatorLoginPassword"))!;
        password.SetFocus(); Type(rejectWrongFirst ? "deliberately-wrong-synthetic-password" : Password); Invoke(window, Id("LoginButton"));
        if (rejectWrongFirst) { Until(() => !string.IsNullOrWhiteSpace(Text(window, "ErrorText")), "explicit invalid-password error from normal product login"); Require(HasWindow("操作员登录"), "normal product rejects a wrong synthetic password"); password.SetFocus(); Type(Password); Invoke(window, Id("LoginButton")); }
        Until(() => !HasWindow("操作员登录"), "normal explicit product login");
        normalLoginCompleted = true;
    }
    private static void Menu(string group, string item)
    {
        var parent = main!.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem)).Cast<AutomationElement>().First(e => e.Current.Name.StartsWith(group, StringComparison.Ordinal));
        ((ExpandCollapsePattern)parent.GetCurrentPattern(ExpandCollapsePattern.Pattern)).Expand(); Thread.Sleep(100); Invoke(main, Name(item));
    }
    private static void Yes(string title)
    {
        var dialog = Window(name => name == title);
        var yes = dialog.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button)).Cast<AutomationElement>().Single(e => e.Current.Name.StartsWith("是", StringComparison.Ordinal) || e.Current.Name.StartsWith("Yes", StringComparison.OrdinalIgnoreCase));
        ((InvokePattern)yes.GetCurrentPattern(InvokePattern.Pattern)).Invoke(); Thread.Sleep(150);
    }
    private static void FileDialog(string title, string path)
    {
        var dialog = Window(name => name == title);
        // Native common dialogs reuse numeric control IDs. Focus the actual filename
        // edit by its standard mnemonic and type real input so the dialog commits it.
        SetForegroundWindow((IntPtr)dialog.Current.NativeWindowHandle);
        Down(0x12); Key(0x4e); Up(0x12); Thread.Sleep(150); // Alt+N: File name / 文件名.
        var focused = AutomationElement.FocusedElement;
        if (focused.Current.ControlType != ControlType.Edit) throw new InvalidDataException("Native filename mnemonic did not focus an edit control.");
        ControlKey(0x41); Type(path);
        // SendInput enqueues long UTF-16 paths; wait for actual native edit consumption.
        // Do not accept a prefix or confirm before exact full-path readback.
        Until(() => string.Equals(((ValuePattern)focused.GetCurrentPattern(ValuePattern.Pattern)).Current.Value.Trim('"'), path, StringComparison.OrdinalIgnoreCase), "native filename consumes the entire requested path", 15000);
        var entered = ((ValuePattern)focused.GetCurrentPattern(ValuePattern.Pattern)).Current.Value;
        var normalized = Path.GetFullPath(entered.Trim('"'));
        File.WriteAllText(Path.Combine(evidence, "native-path-" + Guid.NewGuid().ToString("N") + ".json"), JsonSerializer.Serialize(new { title, controlName = focused.Current.Name, automationId = focused.Current.AutomationId, entered, normalized, expected = path }, PayloadManifest.Json));
        if (!string.Equals(normalized, Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Native filename input did not read back as the exact requested path.");
        Key(0x09); Thread.Sleep(100); // Commit the filename field before explicit confirmation.
        var saving = title.StartsWith("保存", StringComparison.Ordinal) || title.Contains("另存", StringComparison.Ordinal) || title.Contains("导出", StringComparison.Ordinal) || title.Contains("Save", StringComparison.OrdinalIgnoreCase);
        var confirm = dialog.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button)).Cast<AutomationElement>().FirstOrDefault(e => saving
            ? e.Current.Name.StartsWith("Save", StringComparison.OrdinalIgnoreCase) || e.Current.Name.Contains("保存", StringComparison.Ordinal)
            : e.Current.Name.StartsWith("Open", StringComparison.OrdinalIgnoreCase) || e.Current.Name.Contains("打开", StringComparison.Ordinal)) ?? throw new InvalidDataException("Native Save/Open confirmation button absent.");
        ((InvokePattern)confirm.GetCurrentPattern(InvokePattern.Pattern)).Invoke();
        Until(() => !HasWindow(title), "native path dialog acceptance");
    }
    private static void Cell(AutomationElement grid, int row, int column, string text)
    {
        var cell = ((GridPattern)grid.GetCurrentPattern(GridPattern.Pattern)).GetItem(row, column);
        if (cell.TryGetCurrentPattern(ScrollItemPattern.Pattern, out var scroll)) ((ScrollItemPattern)scroll).ScrollIntoView();
        Thread.Sleep(100); var rectangle = cell.Current.BoundingRectangle;
        if (rectangle.IsEmpty || rectangle.Width < 1 || rectangle.Height < 1) throw new InvalidDataException("Actual editable cell is not visible.");
        SetCursorPos((int)(rectangle.X + rectangle.Width / 2), (int)(rectangle.Y + rectangle.Height / 2));
        Send(new Input { Type = 0, Mouse = new Mouse { Flags = 2 } }); Send(new Input { Type = 0, Mouse = new Mouse { Flags = 4 } });
        Key(0x71); ControlKey(0x41); Type(text); Key(0x09); Thread.Sleep(60);
    }
    private static void ControlKey(ushort key, bool shift = false) { Down(0x11); if (shift) Down(0x10); Key(key); if (shift) Up(0x10); Up(0x11); Thread.Sleep(100); }
    private static void Shortcut(ushort key, bool shift = false) { if (main is not null) SetForegroundWindow((IntPtr)main.Current.NativeWindowHandle); ControlKey(key, shift); }
    private static void Key(ushort key) { Down(key); Up(key); }
    private static void Down(ushort key) => Send(new Input { Type = 1, Keyboard = new Keyboard { VirtualKey = key } });
    private static void Up(ushort key) => Send(new Input { Type = 1, Keyboard = new Keyboard { VirtualKey = key, Flags = 2 } });
    private static void Type(string text) { foreach (var ch in text) { Send(new Input { Type = 1, Keyboard = new Keyboard { Scan = ch, Flags = 4 } }); Send(new Input { Type = 1, Keyboard = new Keyboard { Scan = ch, Flags = 6 } }); } Thread.Sleep(150); }
    private static void Send(Input input) { if (SendInput(1, [input], Marshal.SizeOf<Input>()) != 1) throw new IOException("Native input was rejected."); }
    private static void DumpTree()
    {
        var windows = AutomationElement.RootElement.FindAll(TreeScope.Children, new PropertyCondition(AutomationElement.ProcessIdProperty, desktop!.Id)).Cast<AutomationElement>();
        var nodes = windows.SelectMany(w => w.FindAll(TreeScope.Subtree, Condition.TrueCondition).Cast<AutomationElement>()).Select(e => new { e.Current.Name, e.Current.AutomationId, type = e.Current.ControlType.ProgrammaticName, e.Current.IsEnabled }).ToArray();
        File.WriteAllText(Path.Combine(evidence, "failure-ui-tree.json"), JsonSerializer.Serialize(nodes, PayloadManifest.Json));
    }
    private static void Capture(string name)
    {
        GetWindowThreadProcessId(GetForegroundWindow(), out var foregroundProcess);
        if (foregroundProcess != desktop?.Id) throw new InvalidOperationException("Actual product must be foreground for native evidence capture.");
        var screen = GetDC(IntPtr.Zero); var width = GetSystemMetrics(0); var height = GetSystemMetrics(1); var memory = CreateCompatibleDC(screen); var bitmap = CreateCompatibleBitmap(screen, width, height); var old = SelectObject(memory, bitmap);
        try { if (!BitBlt(memory, 0, 0, width, height, screen, 0, 0, 0x40CC0020)) throw new IOException("Native capture failed."); var source = Imaging.CreateBitmapSourceFromHBitmap(bitmap, IntPtr.Zero, System.Windows.Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions()); var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(source)); using var file = File.Create(Path.Combine(evidence, name + ".png")); encoder.Save(file); }
        finally { SelectObject(memory, old); DeleteObject(bitmap); DeleteDC(memory); ReleaseDC(IntPtr.Zero, screen); }
    }
    private sealed class DesktopMode : IDisposable
    {
        private IntPtr mode = Marshal.AllocHGlobal(220);
        private byte[]? original;
        public DesktopMode()
        {
            try
            {
                SetProcessDpiAwarenessContext(new IntPtr(-4));
                Marshal.Copy(new byte[220], 0, mode, 220); Marshal.WriteInt16(mode, 68, 220);
                if (!EnumDisplaySettings(null, -1, mode)) throw new InvalidOperationException("Cannot read native desktop display mode.");
                original = new byte[220]; Marshal.Copy(mode, original, 0, 220);
                if (GetSystemMetrics(0) < 1920 || GetSystemMetrics(1) < 1080)
                {
                    Marshal.WriteInt32(mode, 72, Marshal.ReadInt32(mode, 72) | 0x180000);
                    Marshal.WriteInt32(mode, 172, 1920); Marshal.WriteInt32(mode, 176, 1080);
                    if (ChangeDisplaySettings(mode, 2) != 0 || ChangeDisplaySettings(mode, 0) != 0) throw new InvalidOperationException("Disposable runner cannot provide a real 1920x1080 desktop.");
                }
                if (GetSystemMetrics(0) < 1920 || GetSystemMetrics(1) < 1080) throw new InvalidOperationException("Native desktop is too small for the actual voucher grid; no resized image/input substitute is used.");
            }
            catch { Dispose(); throw; }
        }
        public void Dispose()
        {
            if (mode == IntPtr.Zero) return;
            if (original is not null) { Marshal.Copy(original, 0, mode, 220); ChangeDisplaySettings(mode, 0); }
            Marshal.FreeHGlobal(mode); mode = IntPtr.Zero;
        }
    }
    [StructLayout(LayoutKind.Explicit, Size = 40)] private struct Input { [FieldOffset(0)] public uint Type; [FieldOffset(8)] public Keyboard Keyboard; [FieldOffset(8)] public Mouse Mouse; }
    [StructLayout(LayoutKind.Sequential)] private struct Keyboard { public ushort VirtualKey, Scan; public uint Flags, Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] private struct Mouse { public int X, Y; public uint Data, Flags, Time; public UIntPtr Extra; }
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, Input[] input, int size);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool EnumDisplaySettings(string? device, int mode, IntPtr settings);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int ChangeDisplaySettings(IntPtr settings, int flags);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int width, int height);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr value);
    [DllImport("gdi32.dll")] private static extern bool BitBlt(IntPtr dc, int x, int y, int width, int height, IntPtr source, int sx, int sy, uint flags);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr value);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
}
