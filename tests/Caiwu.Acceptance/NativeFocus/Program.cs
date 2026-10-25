using Caiwu.Desktop.Testing;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using Caiwu.Desktop;
using Caiwu.Desktop.Dialogs;
using Caiwu.Desktop.Presentation;
using Caiwu.Desktop.Verification;

internal static class Program
{
    private static readonly List<object> results = [];
    private static readonly List<object> observations = [];
    private static string output = "";
    [STAThread] private static int Main(string[] args)
    {
        if (!OperatingSystem.IsWindows()) { Console.Error.WriteLine("BLOCKED: native Windows input required."); return 2; }
        output = Path.GetFullPath(args[0]); Directory.CreateDirectory(output);
        var app = new IndependentDesktopApplication(); app.InitializeComponent(); app.ShutdownMode = ShutdownMode.OnExplicitShutdown;
        SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext());
        var run = RunAsync(); var frame = new DispatcherFrame();
        _ = run.ContinueWith(_ => app.Dispatcher.BeginInvoke(() => frame.Continue = false), TaskScheduler.Default);
        Dispatcher.PushFrame(frame);
        try { run.GetAwaiter().GetResult(); }
        catch (Exception ex) { results.Add(new { id = "HARNESS", status = "FAIL", detail = ex.ToString() }); }
        var failures = results.Count(r => JsonSerializer.SerializeToElement(r).GetProperty("status").GetString() != "PASS");
        File.WriteAllText(Path.Combine(output, "native-focus-results.json"), JsonSerializer.Serialize(new
        {
            checkoutCommit = Environment.GetEnvironmentVariable("CAIWU_REVALIDATION_COMMIT"),
            productionSourceTree = Environment.GetEnvironmentVariable("CAIWU_FOCUS_SOURCE_TREE"),
            actualWindowsWpf = true, nativeKeyboardInput = true, physicalKeyboardOrImeTested = false,
            mechanism = "Actual production MainWindow/editor/account picker and SQLite; native SendInput F4/Escape/Enter/Unicode. Focus is prepared only before each scenario, never restored by the probe after a modal closes.",
            os = RuntimeInformation.OSDescription, executedAtUtc = DateTimeOffset.UtcNow,
            failures, results, observations
        }, new JsonSerializerOptions { WriteIndented = true }));
        app.Shutdown(); return failures == 0 ? 0 : 1;
    }
    private static async Task RunAsync()
    {
        foreach (var accept in new[] { false, true })
        {
            var id = accept ? "F4-ACCEPT-NEXT-CELL-NATIVE-INPUT" : "F4-CANCEL-RETAINS-FOCUS-INPUT";
            try { await ProbeAsync(id, accept); results.Add(new { id, status = "PASS" }); Console.WriteLine("PASS " + id); }
            catch (BlockedException ex) { results.Add(new { id, status = "BLOCKED", detail = ex.Message }); Console.Error.WriteLine("BLOCKED " + id + ": " + ex.Message); }
            catch (Exception ex) { results.Add(new { id, status = "FAIL", detail = ex.ToString() }); Console.Error.WriteLine("FAIL " + id + ": " + ex.Message); }
            finally
            {
                // Cleanup follows the assertions; it cannot establish focus, input retention or a pass.
                foreach (var w in Application.Current.Windows.Cast<Window>().Reverse().ToArray())
                {
                    w.GetType().GetField("_dirty", BindingFlags.Instance | BindingFlags.NonPublic)?.SetValue(w, false);
                    w.Close();
                }
                await SettleAsync();
            }
        }
    }
    private static async Task ProbeAsync(string id, bool accept)
    {
        var backend = SyntheticDesktopIdentity.Backend;
        var path = Path.Combine(output, id + ".caiwu"); SyntheticDesktopIdentity.SeedSample(path);
        var main = SyntheticDesktopIdentity.CreateMain(backend); Application.Current.MainWindow = main; main.Show();
        Call(main, "OpenVerificationBook", path);
        var editor = (VoucherEditorWindow)Call(main, "CreateVerificationEditor", (object?)null)!; editor.Show();
        await SettleAsync();
        using var reader = backend.Open(path); var before = JsonSerializer.Serialize(reader.Read());
        var grid = (DataGrid)editor.FindName("LinesGrid");
        var rows = (ObservableCollection<VoucherLineEdit>)grid.ItemsSource; var row = rows[0];
        grid.ScrollIntoView(row, grid.Columns[0]); grid.CurrentCell = new(row, grid.Columns[0]);
        grid.Focus(); Require(grid.BeginEdit(), "Could not begin actual summary-cell editing."); await SettleAsync();
        var cell = grid.Columns[0].GetCellContent(row);
        Require(cell is TextBox, "Actual editing TextBox was not realized."); ((TextBox)cell!).Focus();
        editor.Activate(); SetForegroundWindow(new WindowInteropHelper(editor).Handle); await SettleAsync();
        Unicode(editor, "focus-input-keep-314"); await SettleAsync();
        Require(row.Summary == "focus-input-keep-314", "Native summary input did not reach the focused production cell.");
        Key(editor, 0x73); // F4; the real grid route opens the production modal picker.
        var picker = await WindowAsync<AccountPickerWindow>(); await SettleAsync();
        var search = Visuals<TextBox>(picker).Single();
        Require(search.IsKeyboardFocused, "Picker did not focus its search field on opening.");
        Unicode(picker, "1002"); await SettleAsync();
        var pickerGrid = Visuals<DataGrid>(picker).Single();
        Require(pickerGrid.Items.Count == 1, "Native picker search did not narrow to the synthetic bank account.");
        observations.Add(new { id, stage = "picker-search", search = search.Text, focused = Keyboard.FocusedElement?.GetType().Name, dpi = GetDpiForWindow(new WindowInteropHelper(picker).Handle) });
        Key(picker, accept ? (ushort)0x0D : (ushort)0x1B);
        await WaitAsync(() => !picker.IsVisible, "Native Enter/Escape did not close the actual modal picker."); await SettleAsync();
        Require(GetForegroundWindow() == new WindowInteropHelper(editor).Handle, "Editor did not regain native foreground after the modal closed.");
        Require(grid.IsKeyboardFocusWithin, "Keyboard focus did not return to the editor grid.");
        Require(ReferenceEquals(grid.CurrentCell.Item, row), "Returning from picker changed the active business row.");
        Require(row.Summary == "focus-input-keep-314", "Picker acceptance/cancellation lost pending summary input.");
        if (accept)
        {
            Require(row.AccountCode == "1002", "Actual picker acceptance did not write the selected account.");
            Require(grid.CurrentColumn.DisplayIndex == 3, "Picker acceptance did not advance to the debit cell.");
            Require(Keyboard.FocusedElement is TextBox, "Debit cell did not have a focused editing TextBox.");
            Unicode(editor, "42.75"); await SettleAsync();
            Require(row.DebitText == "42.75", "Native amount input did not reach the returned debit-cell editor.");
        }
        else
        {
            Require(string.IsNullOrEmpty(row.AccountCode), "Picker cancellation changed the pending account.");
            Require(grid.CurrentColumn.DisplayIndex == 0, "Picker cancellation changed the active summary column.");
        }
        Require(JsonSerializer.Serialize(reader.Read()) == before, "Unsaved focus scenario changed persisted snapshot/audit/revision.");
        observations.Add(new { id, stage = "returned-editor", row.Summary, row.AccountCode, row.DebitText, column = grid.CurrentColumn.DisplayIndex,
            focused = Keyboard.FocusedElement?.GetType().Name, gridFocusWithin = grid.IsKeyboardFocusWithin, dpi = GetDpiForWindow(new WindowInteropHelper(editor).Handle) });
    }
    private static async Task<T> WindowAsync<T>() where T : Window
    {
        await WaitAsync(() => Application.Current.Windows.OfType<T>().Any(w => w.IsVisible), "Production modal window did not appear: " + typeof(T).Name);
        return Application.Current.Windows.OfType<T>().Single(w => w.IsVisible);
    }
    private static async Task WaitAsync(Func<bool> ready, string reason)
    {
        var watch = Stopwatch.StartNew();
        while (!ready()) { if (watch.Elapsed > TimeSpan.FromSeconds(8)) throw new BlockedException(reason); await SettleAsync(); }
    }
    private static async Task SettleAsync()
    {
        await Dispatcher.CurrentDispatcher.InvokeAsync(() => { }, DispatcherPriority.ApplicationIdle);
        await Task.Delay(100);
    }
    private static object? Call(object target, string name, params object?[] args) => target.GetType().GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(target, args);
    private static void Require(bool condition, string reason) { if (!condition) throw new InvalidOperationException(reason); }
    private sealed class BlockedException(string reason) : Exception(reason);
    private static IEnumerable<T> Visuals<T>(DependencyObject root) where T : DependencyObject
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++)
        {
            var child = VisualTreeHelper.GetChild(root, i); if (child is T found) yield return found;
            foreach (var descendant in Visuals<T>(child)) yield return descendant;
        }
    }
    // Explicit union retains the Win32 INPUT layout on both 32-bit and 64-bit targets.
    [StructLayout(LayoutKind.Sequential)] private struct Input { public uint Type; public InputUnion Data; }
    [StructLayout(LayoutKind.Explicit)] private struct InputUnion
    {
        [FieldOffset(0)] public KeyboardInput Keyboard;
        [FieldOffset(0)] public MouseInput Mouse;
    }
    [StructLayout(LayoutKind.Sequential)] private struct KeyboardInput { public ushort Key, Scan; public uint Flags, Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] private struct MouseInput { public int X, Y; public uint Data, Flags, Time; public UIntPtr Extra; }
    private static void Key(Window target, ushort key) => Send(target, [NativeKeyInput(key, 0, 0), NativeKeyInput(key, 0, 2)]);
    private static void Unicode(Window target, string text) => Send(target, text.SelectMany(c => new[] { NativeKeyInput(0, c, 4), NativeKeyInput(0, c, 6) }).ToArray());
    private static Input NativeKeyInput(ushort key, ushort scan, uint flags) => new() { Type = 1, Data = new() { Keyboard = new() { Key = key, Scan = scan, Flags = flags } } };
    private static void Send(Window target, Input[] inputs)
    {
        if (GetForegroundWindow() != new WindowInteropHelper(target).Handle) throw new BlockedException("Native input target is not this scenario's foreground window.");
        var sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<Input>());
        if (sent != inputs.Length) throw new BlockedException($"SendInput delivered {sent}/{inputs.Length}; no input success inferred.");
    }
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
}
