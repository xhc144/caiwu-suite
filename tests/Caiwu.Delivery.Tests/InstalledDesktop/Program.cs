using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Automation;
using System.Windows.Interop;
using System.Windows.Media.Imaging;
using Caiwu.Contracts;
using Caiwu.Delivery;
using Caiwu.Operators;
using Caiwu.Persistence.Sqlite;

internal static class Program
{
    private static readonly List<string> Checks = [];
    private static string evidence = "", install = "", data = "";
    private static Process? launcher, desktop;
    private static AutomationElement? main;
    private static bool normalLoginCompleted;
    private static bool migrationAttempted, originalBundleUnavailable;
    private static readonly string Password = Environment.GetEnvironmentVariable("CAIWU_INTERNAL_QA_PASSWORD") ?? "Synthetic!" + Guid.NewGuid().ToString("N");

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 4 && args[0] == "--internal-qa-manifest")
        {
            // Independent validation tool only, never included in the payload. This
            // advertises the composed managed capability for testing, not release approval.
            PayloadManifest.Create(args[1], args[2], args[3], true).Write(Path.Combine(args[1], PayloadManifest.FileName));
            return 0;
        }
        if (!OperatingSystem.IsWindows() || args.Length is < 3 or > 4) throw new ArgumentException("Windows: installRoot dataRoot evidence [hold]");
        using var watchdog = new Timer(_ => { Save(false, "Controller exceeded 5 minute deadline."); Environment.FailFast("Installed App controller watchdog."); }, null, 300000, Timeout.Infinite);
        install = Path.GetFullPath(args[0]); data = Path.GetFullPath(args[1]); evidence = Path.GetFullPath(args[2]); Directory.CreateDirectory(evidence);
        try
        {
            var current = Installation.ReadCurrent(install);
            Require(Path.GetFullPath(current.DataRoot) == data, "installed pointer binds the isolated data root");
            var versionRoot = Path.Combine(install, "versions", current.Version);
            var manifest = PayloadManifest.Read(Path.Combine(versionRoot, PayloadManifest.FileName)); manifest.Verify(versionRoot);
            Require(manifest.ManagedDataContract, "installed payload advertises the reviewed managed App contract");
            var identityRoot = Path.Combine(data, "Global", "Operators");
            var operators = new LocalOperatorService(new FileOperatorStore(identityRoot));
            var health = args.Length == 4 && args[3] == "health";
            var migration = args.Length == 4 && args[3] == "migration";
            if (!health)
            {
                Require(operators.IsFirstUse, "fixture starts with an unused isolated global identity directory");
                operators.InitializeAdministrator("fixture-admin", "虚构安装管理员", Password);
                var admin = operators.Login("fixture-admin", Password);
                var roles = OperatorRoles.Administrator | OperatorRoles.Accountant | OperatorRoles.Preparer | OperatorRoles.Reviewer | OperatorRoles.Poster;
                operators.AddOperator(admin, operators.GetDirectory(admin).Revision, "fixture-maker", "虚构安装制单人", Password, roles);
                operators.AddOperator(admin, operators.GetDirectory(admin).Revision, "fixture-reviewer", "虚构安装审核人", Password, roles);
                operators.Logout(admin);
            }
            else Require(!operators.IsFirstUse, "upgraded App retains initialized identities");
            var identityPath = Path.Combine(identityRoot, "operators.json");
            var identityBefore = PayloadManifest.Hash(identityPath);
            var helper = Path.Combine(versionRoot, "Caiwu.Delivery.exe");
            var start = new ProcessStartInfo(helper) { UseShellExecute = false, WorkingDirectory = evidence, RedirectStandardError = true, RedirectStandardOutput = true };
            start.ArgumentList.Add("launch-managed"); start.ArgumentList.Add(install);
            launcher = Process.Start(start) ?? throw new IOException("Installed launcher did not start.");
            var stdout = launcher.StandardOutput.ReadToEndAsync(); var stderr = launcher.StandardError.ReadToEndAsync();
            Until(() =>
            {
                desktop = Process.GetProcessesByName("Caiwu.Desktop").FirstOrDefault(p => string.Equals(p.MainModule?.FileName, Path.Combine(versionRoot, "Caiwu.Desktop.exe"), StringComparison.OrdinalIgnoreCase));
                return desktop is not null;
            }, "actual installed WPF process", 30000);
            Login("fixture-maker", rejectWrongFirst: true);
            main = Window(title => title == "财务套件 · 开发预览");
            Require(main.FindFirst(TreeScope.Descendants, Id("OperatorInput")) is { Current.IsEnabled: false }, "actual product login locks the current actor control");
            var modules = desktop!.Modules.Cast<ProcessModule>().Select(m => new { name = m.ModuleName, path = m.FileName }).ToArray();
            foreach (var native in new[] { "coreclr.dll", "hostfxr.dll" })
                Require(modules.Any(m => string.Equals(m.name, native, StringComparison.OrdinalIgnoreCase) && SafePaths.Contains(versionRoot, m.path)), "installed process resolves " + native + " from its own payload");
            var checkout = Environment.GetEnvironmentVariable("GITHUB_WORKSPACE");
            if (!string.IsNullOrWhiteSpace(checkout)) Require(modules.All(m => !SafePaths.Contains(checkout, m.path)), "actual product process loads no native/managed image from the source checkout");
            File.WriteAllText(Path.Combine(evidence, "loaded-native-modules.json"), JsonSerializer.Serialize(modules, PayloadManifest.Json));
            Capture("normal-login");
            if (migration)
            {
                var receiptPath = Path.Combine(data, "Global", "BackupReceipts", "carried-receipt.json");
                using var receipt = JsonDocument.Parse(File.ReadAllText(receiptPath));
                originalBundleUnavailable = !Directory.Exists(receipt.RootElement.GetProperty("Directory").GetString());
                Require(originalBundleUnavailable, "cross-root recovery fixture makes the original absolute bundle directory unavailable");
                Menu("文件", "从备份恢复副本…"); FileDialog("选择本机受管完整备份的可信哈希收据", receiptPath); Yes("完整恢复");
                migrationAttempted = true;
                Until(() => Text(main!, "NotificationText").Contains("完整恢复未完成", StringComparison.Ordinal), "normal new-root carried-receipt rejection");
                Require(Text(main, "NotificationText").Contains("受管备份收据无效", StringComparison.Ordinal), "unchanged carried receipt is rejected because its absolute bundle path is outside the new data root");
                Require(Directory.GetFiles(data, "*.caiwu", SearchOption.AllDirectories).All(p => p.Contains(".delivery-backups", StringComparison.Ordinal)), "rejected cross-root recovery publishes no live ledger");
                Require(PayloadManifest.Hash(identityPath) == identityBefore, "rejected cross-root recovery leaves the new root's global identities unchanged");
                Capture("cross-root-recovery-rejected"); Close(main);
                if (!launcher.WaitForExit(30000) || launcher.ExitCode != 0) throw new IOException("Migration limitation probe App did not close normally.");
                Save(true, null); return 0;
            }
            if (health)
            {
                Shortcut(0x4f); FileDialog("打开账套", Path.Combine(data, "安装 合成账套.caiwu"));
                Until(() => Text(main!, "BookNameText") == "安装合成账套", "upgraded normal App opens retained source book");
                Require(PayloadManifest.Hash(identityPath) == identityBefore, "upgraded real login leaves existing global identities unchanged");
                Capture("upgraded-normal-app"); Close(main);
                if (!launcher.WaitForExit(30000) || launcher.ExitCode != 0) throw new IOException("Upgraded App failed to close successfully.");
                Save(true, null); return 0;
            }

            Shortcut(0x4e, shift: true); // Ctrl+Shift+N, real product command.
            var newBook = Window(title => title == "新建账套");
            var edits = newBook.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit)).Cast<AutomationElement>().ToArray();
            SetValue(edits[0], "安装合成账套");
            Invoke(newBook, Name("选择保存位置…"));
            var bookPath = Path.Combine(data, "安装 合成账套.caiwu");
            FileDialog("保存新账套", bookPath);
            Until(() => File.Exists(bookPath) && Text(main!, "BookNameText") == "安装合成账套", "normal new book creation and display");
            Require(File.ReadAllText(Path.Combine(data, "managed-books.json")).Contains("安装", StringComparison.Ordinal) ||
                    JsonSerializer.Deserialize<ManagedBooks>(File.ReadAllText(Path.Combine(data, "managed-books.json")), PayloadManifest.Json)!.DatabasePaths.Contains(bookPath), "normal App create registers the actual physical book");
            Capture("new-book");

            Shortcut(0x4e); var voucher = Window(title => title == "记账凭证");
            var grid = voucher.FindFirst(TreeScope.Descendants, Id("LinesGrid")) ?? throw new InvalidDataException("Installed voucher grid absent.");
            Cell(grid, 0, 0, "安装验证借方"); Cell(grid, 0, 1, "1002"); Cell(grid, 0, 3, "123.45");
            Cell(grid, 1, 0, "安装验证贷方"); Cell(grid, 1, 1, "3001"); Cell(grid, 1, 4, "123.45");
            Capture("voucher-input"); Invoke(voucher, Id("SaveButton"));
            Until(() => !HasWindow("记账凭证"), "normal voucher save and close");
            Pass("normal installed voucher grid saves one balanced draft");

            Menu("系统管理", "注销并切换操作员…"); Login("fixture-reviewer");
            main = Window(title => title == "财务套件 · 开发预览");
            Shortcut(0x4f); FileDialog("打开账套", bookPath);
            Until(() => Text(main!, "BookNameText") == "安装合成账套", "reviewer opens existing physical book");
            var tabs = main.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TabItem));
            var vouchers = tabs.Cast<AutomationElement>().Single(e => e.Current.Name == "凭证序时簿"); ((SelectionItemPattern)vouchers.GetCurrentPattern(SelectionItemPattern.Pattern)).Select();
            var list = main.FindFirst(TreeScope.Descendants, Id("VoucherGrid"))!;
            var row = list.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.DataItem)) ?? throw new InvalidDataException("Saved draft row absent.");
            ((SelectionItemPattern)row.GetCurrentPattern(SelectionItemPattern.Pattern)).Select();
            Invoke(main, Name("审核 F4"));
            Until(() => Text(main!, "NotificationText").Contains("已审核", StringComparison.Ordinal), "normal reviewer approval");
            row = list.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.DataItem))!;
            ((SelectionItemPattern)row.GetCurrentPattern(SelectionItemPattern.Pattern)).Select();
            Invoke(main, Name("记账")); Yes("确认记账");
            Until(() => Text(main!, "NotificationText").Contains("已记账", StringComparison.Ordinal), "normal posting confirmation");
            Capture("posted-voucher"); Pass("separate real login reviews and posts the draft through installed controls");

            Menu("会计档案", "常用摘要管理…"); Yes("初始化摘要库");
            var summary = Window(title => title.Contains("常用摘要", StringComparison.Ordinal)); var summaryTitle = summary.Current.Name; Capture("summary-entry"); Close(summary);
            Until(() => !HasWindow(summaryTitle), "summary window closes");
            Menu("实务操作", "成本工作表（审核建议）…");
            var cost = Window(title => title.StartsWith("成本工作表 ·", StringComparison.Ordinal)); Capture("cost-entry"); Close(cost);
            Menu("会计档案", "复制账套…");
            var copy = Window(title => title.Contains("复制", StringComparison.Ordinal) && title.Contains("账套", StringComparison.Ordinal)); Capture("book-copy-entry"); Close(copy);
            Menu("实务操作", "复制凭证为新草稿…");
            var voucherCopy = Window(title => title == "复制为新草稿"); Capture("voucher-copy-entry"); Close(voucherCopy);
            Pass("actual installed summary initialization, cost and book-copy entrypoints open");

            var trial = main.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TabItem)).Cast<AutomationElement>().Single(e => e.Current.Name == "科目余额表");
            ((SelectionItemPattern)trial.GetCurrentPattern(SelectionItemPattern.Pattern)).Select(); Capture("trial-balance");
            Require(Text(main, "TrialTotalsText").Contains("123.45", StringComparison.Ordinal), "installed balance page displays posted synthetic amount");
            Menu("报表", "自定义当前账表…");
            var designer = Window(title => title == "自定义当前账表"); Capture("designer-entry"); Close(designer);
            Until(() => Text(main!, "NotificationText").Contains("模板 JSON", StringComparison.Ordinal), "installed designer close and attachment registration");
            var reports = main.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem)).Cast<AutomationElement>().First(e => e.Current.Name.StartsWith("报表", StringComparison.Ordinal));
            ((ExpandCollapsePattern)reports.GetCurrentPattern(ExpandCollapsePattern.Pattern)).Expand(); Thread.Sleep(100);
            var nonprofit = main.FindFirst(TreeScope.Descendants, Name("民非报表分类与预览（当前月）…"))!;
            Require(!nonprofit.Current.IsEnabled, "actual installed enterprise-regime App keeps the nonprofit-only entry disabled"); Key(0x1b);
            var loadedAfterPosting = desktop.Modules.Cast<ProcessModule>().Select(m => new { name = m.ModuleName, path = m.FileName }).ToArray();
            Require(loadedAfterPosting.Any(m => string.Equals(m.name, "e_sqlite3.dll", StringComparison.OrdinalIgnoreCase) && SafePaths.Contains(versionRoot, m.path)), "actual installed SQLite native dependency resolves from the payload");
            File.WriteAllText(Path.Combine(evidence, "loaded-after-posting.json"), JsonSerializer.Serialize(loadedAfterPosting, PayloadManifest.Json));

            Key(0x79); Yes("受管完整备份"); // F10.
            var receipts = Path.Combine(data, "Global", "BackupReceipts");
            Until(() => Directory.Exists(receipts) && Directory.GetFiles(receipts, "*.json").Length == 1, "normal complete backup receipt");
            var receipt = Directory.GetFiles(receipts, "*.json").Single();
            Menu("文件", "从备份恢复副本…"); FileDialog("选择本机受管完整备份的可信哈希收据", receipt); Yes("完整恢复");
            Until(() => Text(main!, "NotificationText").Contains("登记附件已恢复", StringComparison.Ordinal), "normal complete restore and open");
            Require(PayloadManifest.Hash(identityPath) == identityBefore, "normal single-book restore leaves active global operators unchanged");
            Pass("installed App complete backup/restore uses a trusted receipt and preserves global identities"); Capture("restored-book");
            File.WriteAllText(Path.Combine(evidence, "ready.json"), JsonSerializer.Serialize(new { desktopPid = desktop.Id, launcherPid = launcher.Id, bookPath, checkoutCommit = manifest.Commit }, PayloadManifest.Json));
            if (args.Length == 4 && args[3] == "hold") Until(() => File.Exists(Path.Combine(evidence, "stop")), "external in-use-upgrade probe completion", 120000);
            Close(main);
            if (!launcher.WaitForExit(30000)) throw new TimeoutException("Actual App launcher did not exit.");
            if (launcher.ExitCode != 0) throw new IOException("Installed App exited unsuccessfully: " + stderr.GetAwaiter().GetResult());
            _ = stdout.GetAwaiter().GetResult(); _ = stderr.GetAwaiter().GetResult();
            using (var store = SqliteLedgerStore.Open(bookPath))
            {
                var snapshot = store.Read(); var v = snapshot.Vouchers.Single();
                Require(v.Status == VoucherStatus.Posted && v.Lines.Count == 2 && v.Lines.Sum(l => l.Debit) == 123.45m && v.Lines.Sum(l => l.Credit) == 123.45m && v.PreparedBy != v.ReviewedBy, "independent persisted readback confirms exact posted two-line voucher and distinct actors");
            }
            Save(true, null); return 0;
        }
        catch (Exception ex) { try { Capture("failure"); } catch { } try { DumpTree(); } catch { } Save(false, ex.ToString()); Console.Error.WriteLine(ex.Message); return 1; }
        finally
        {
            try { if (desktop is { HasExited: false }) desktop.CloseMainWindow(); } catch { }
            if (launcher is { HasExited: false } && !launcher.WaitForExit(5000)) launcher.Kill(true);
        }
    }

    private static void Save(bool success, string? failure) { if (evidence.Length > 0) File.WriteAllText(Path.Combine(evidence, "installed-runtime.json"), JsonSerializer.Serialize(new { success, failure, windowsExecuted = true, normalProductLogin = normalLoginCompleted, sourceProjectsExecutedAsProduct = false, sourceCommit = Environment.GetEnvironmentVariable("GITHUB_SHA"), migrationAttempted, originalBundleUnavailable, portableBackupRestoreSupported = false, checks = Checks }, PayloadManifest.Json)); }
    private static void Pass(string name) { Checks.Add(name); Save(false, "In progress"); }
    private static void Require(bool value, string name) { if (!value) throw new InvalidDataException(name); Pass(name); }
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
    private static void Invoke(AutomationElement root, Condition condition) { var item = root.FindFirst(TreeScope.Descendants, condition) ?? throw new InvalidDataException("Control absent: " + condition); ((InvokePattern)item.GetCurrentPattern(InvokePattern.Pattern)).Invoke(); Thread.Sleep(150); }
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
        var input = dialog.FindFirst(TreeScope.Descendants, new AndCondition(Id("1001"), new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit))) ?? throw new InvalidDataException("Native filename edit absent.");
        SetValue(input, path); input.SetFocus(); Key(0x0d);
        Until(() => !HasWindow(title), "native path dialog acceptance");
    }
    private static void Cell(AutomationElement grid, int row, int column, string text)
    {
        var cell = ((GridPattern)grid.GetCurrentPattern(GridPattern.Pattern)).GetItem(row, column); var rectangle = cell.Current.BoundingRectangle;
        SetCursorPos((int)(rectangle.X + rectangle.Width / 2), (int)(rectangle.Y + rectangle.Height / 2));
        Send(new Input { Type = 0, Mouse = new Mouse { Flags = 2 } }); Send(new Input { Type = 0, Mouse = new Mouse { Flags = 4 } });
        Key(0x71); Shortcut(0x41); Type(text); Key(0x09); Thread.Sleep(60);
    }
    private static void Shortcut(ushort key, bool shift = false) { if (main is not null) SetForegroundWindow((IntPtr)main.Current.NativeWindowHandle); Down(0x11); if (shift) Down(0x10); Key(key); if (shift) Up(0x10); Up(0x11); Thread.Sleep(100); }
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
    [StructLayout(LayoutKind.Explicit, Size = 40)] private struct Input { [FieldOffset(0)] public uint Type; [FieldOffset(8)] public Keyboard Keyboard; [FieldOffset(8)] public Mouse Mouse; }
    [StructLayout(LayoutKind.Sequential)] private struct Keyboard { public ushort VirtualKey, Scan; public uint Flags, Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] private struct Mouse { public int X, Y; public uint Data, Flags, Time; public UIntPtr Extra; }
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, Input[] input, int size);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
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
