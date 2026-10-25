using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Security.Cryptography;
using System.Windows.Automation;
using System.Windows.Interop;
using System.Windows.Media.Imaging;
using Caiwu.Contracts;
using Caiwu.Delivery;
using Caiwu.Delivery.Modules;
using Caiwu.Operators;
using Caiwu.Persistence.Sqlite;
using Caiwu.Summaries;

internal static class Program
{
    private static readonly List<string> Checks = [];
    private static string evidence = "", install = "", data = "";
    private static Process? launcher, desktop;
    private static AutomationElement? main;
    private static bool normalLoginCompleted;
    private sealed record CaseResult(string name, string status, string? reason = null);
    private static readonly List<CaseResult> Cases = [];
    private static readonly List<string> Failures = [];
    private static string bookPath = "", copiedBookPath = "", restoredBookPath = "", originalVoucherJson = "";
    private static LedgerSnapshot? baseline;
    private static readonly string[] ExpectedCases = ["voucher-cancel", "voucher-execute-save-repeat", "voucher-duplicate-refused", "summary-manage", "summary-refill", "book-preview-cancel-stale-approval", "book-copy-new-identity", "book-duplicate-destination-refused", "backup-restore-same-identity", "physical-instance-summary-isolation", "trial-balance-visible-native", "independent-readback", "stale-source-revision"];

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
        if (!OperatingSystem.IsWindows() || args.Length != 3) throw new ArgumentException("Windows: installRoot dataRoot evidence");
        using var watchdog = new Timer(_ => { Save(false, "Controller exceeded 10 minute deadline."); Environment.FailFast("Installed App controller watchdog."); }, null, 600000, Timeout.Infinite);
        install = Path.GetFullPath(args[0]); data = Path.GetFullPath(args[1]); evidence = Path.GetFullPath(args[2]); Directory.CreateDirectory(evidence);
        DesktopMode? display = null;
        try
        {
            display = new DesktopMode();
            var current = Installation.ReadCurrent(install);
            Require(Path.GetFullPath(current.DataRoot) == data, "installed pointer binds the isolated data root");
            var versionRoot = Path.Combine(install, "versions", current.Version);
            var manifest = PayloadManifest.Read(Path.Combine(versionRoot, PayloadManifest.FileName)); manifest.Verify(versionRoot);
            Require(manifest.ManagedDataContract, "installed payload advertises the reviewed managed App contract");
            var identityRoot = Path.Combine(data, "Global", "Operators");
            var operators = new LocalOperatorService(new FileOperatorStore(identityRoot));
            Require(operators.IsFirstUse, "fixture uses a fresh synthetic identity store");
            operators.InitializeAdministrator("fixture-admin", "虚构安装管理员", Password);
            var admin = operators.Login("fixture-admin", Password);
            var roles = OperatorRoles.Administrator | OperatorRoles.Accountant | OperatorRoles.Preparer | OperatorRoles.Reviewer | OperatorRoles.Poster;
            operators.AddOperator(admin, operators.GetDirectory(admin).Revision, "fixture-maker", "虚构安装制单人", Password, roles);
            operators.AddOperator(admin, operators.GetDirectory(admin).Revision, "fixture-reviewer", "虚构安装审核人", Password, roles);
            operators.Logout(admin);
            var identityPath = Path.Combine(identityRoot, "operators.json");
            var identityBefore = Hash(identityPath);
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
            Shortcut(0x4e, shift: true); // Ctrl+Shift+N, real product command.
            var newBook = Window(title => title == "新建账套");
            var edits = newBook.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit)).Cast<AutomationElement>().ToArray();
            SetValue(edits[0], "安装合成账套");
            Invoke(newBook, Name("选择保存位置…"));
            bookPath = Path.Combine(data, "安装 合成账套.caiwu");
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


            baseline = Read(bookPath); originalVoucherJson = JsonSerializer.Serialize(baseline.Vouchers.Single(), PayloadManifest.Json);
            CheckLeases();
            Case("voucher-cancel", () => {
                var before = Hash(bookPath);
                var choice = VoucherChoice(2); Capture("voucher-choice-cancel"); Invoke(choice, Name("取消"));
                Until(() => !HasWindow("复制为新草稿"), "choice cancelled");
                choice = VoucherChoice(2); Invoke(choice, Id("ConfirmCopy"));
                var editor = Window(t => t == "复制凭证 · 未保存的新草稿"); Capture("voucher-editor-cancel"); Invoke(editor, Name("取消并关闭"));
                Until(() => !HasWindow("复制凭证 · 未保存的新草稿"), "unsaved copied editor cancelled");
                Require(Hash(bookPath) == before && Read(bookPath).Vouchers.Count == 1, "both copied-voucher cancellations leave exact source bytes and voucher count unchanged");
            });
            Case("voucher-execute-save-repeat", () => {
                var choice = VoucherChoice(2); Invoke(choice, Id("ConfirmCopy"));
                var editor = Window(t => t == "复制凭证 · 未保存的新草稿");
                Require(Read(bookPath).Vouchers.Count == 1, "confirmation alone does not save a copied voucher");
                Capture("voucher-copy-before-save");
                NativeDoubleClick(editor.FindFirst(TreeScope.Descendants, Id("Feature.Copy.Save"))!);
                Until(() => !HasWindow("复制凭证 · 未保存的新草稿"), "real copied draft save");
                Until(() => Text(main!, "NotificationText").Contains("复制凭证已保存为新草稿", StringComparison.Ordinal), "host confirms actual copied draft persistence");
                var saved = Read(bookPath); var copied = saved.Vouchers.Single(v => v.Id != baseline!.Vouchers.Single().Id);
                Require(saved.Vouchers.Count == 2 && copied.Status == VoucherStatus.Draft && copied.Number == 2 && copied.ReviewedBy is null, "native repeated save produces exactly one fresh unreviewed draft");
                Require(copied.PreparedBy == baseline!.Vouchers.Single().ReviewedBy && copied.PreparedBy != baseline.Vouchers.Single().PreparedBy, "copy takes the actual fixed logged-in actor rather than source preparer");
                Require(JsonSerializer.Serialize(copied.Lines, PayloadManifest.Json) == JsonSerializer.Serialize(baseline.Vouchers.Single().Lines, PayloadManifest.Json), "all copied voucher lines and exact amounts persist");
                AssertOriginal(saved); Capture("voucher-copy-saved");
            });
            Case("voucher-duplicate-refused", () => {
                var before = Hash(bookPath); var choice = VoucherChoice(2);
                Invoke(choice, Id("ConfirmCopy"));
                Until(() => Text(choice, "CopyErrors").Contains("编号已存在", StringComparison.Ordinal), "duplicate voucher number is refused");
                Capture("voucher-duplicate-rejected");
                Require(HasWindow("复制为新草稿") && Hash(bookPath) == before, "duplicate number retains choice and changes no ledger bytes");
                Invoke(choice, Name("取消"));
            });
            Case("summary-manage", () => {
                Menu("会计档案", "常用摘要管理…"); Yes("初始化摘要库");
                var manager = Window(t => t.StartsWith("常用摘要管理 ·", StringComparison.Ordinal));
                Invoke(manager, Name("新增分类")); Set(manager, "Feature.Summary.Draft", "安装合成分类");
                Invoke(manager, Id("Feature.Summary.Save"));
                Until(() => Summary(bookPath).Categories.Count == 1, "actual category persists");
                Invoke(manager, Name("新增摘要")); Set(manager, "Feature.Summary.Draft", "安装合成摘要：支付办公费");
                Invoke(manager, Id("Feature.Summary.Save"));
                Until(() => Summary(bookPath).Entries.Count == 1, "actual summary persists");
                var before = Summary(bookPath).Version;
                Invoke(manager, Name("新增摘要")); Set(manager, "Feature.Summary.Draft", "取消编辑不落盘"); Invoke(manager, Name("取消本次编辑"));
                Require(Summary(bookPath).Version == before && Summary(bookPath).Entries.Single().Text == "安装合成摘要：支付办公费", "cancelled summary edit preserves independently read version and original text");
                Capture("summary-persisted"); Close(manager);
                Menu("会计档案", "常用摘要管理…"); manager = Window(t => t.StartsWith("常用摘要管理 ·", StringComparison.Ordinal));
                Until(() => manager.FindFirst(TreeScope.Descendants, Id("Feature.Summary.Entries"))?.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ListItem)).Count == 1, "closed and reopened installed manager reads saved summary");
                Capture("summary-reopened"); Close(manager);
            });
            Case("summary-refill", () => {
                Shortcut(0x4e); var editor = Window(t => t == "记账凭证");
                var buttons = editor.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button)).Cast<AutomationElement>().Select(e => new { e.Current.Name, e.Current.AutomationId }).ToArray();
                File.WriteAllText(Path.Combine(evidence, "summary-refill-controls.json"), JsonSerializer.Serialize(buttons, PayloadManifest.Json));
                Capture("summary-refill-missing-entry");
                var refill = editor.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button)).Cast<AutomationElement>().FirstOrDefault(e => e.Current.Name.Contains("摘要", StringComparison.Ordinal));
                Close(editor);
                Require(refill is not null, "PRODUCT GAP: installed voucher editor has no summary selection/refill control; saved summaries cannot be returned to a voucher through the normal UI");
                throw new InvalidOperationException("Summary refill control changed: implement and independently validate actual choose, fill, cancel and save before passing.");
            });
            Case("book-preview-cancel-stale-approval", () => {
                var before = Hash(bookPath); var target = Path.Combine(data, "cancelled-copy.caiwu");
                var window = BookChoice(target, "取消的账套"); Invoke(window, Name("生成复制前预览"));
                var confirmation = window.FindFirst(TreeScope.Descendants, Id("Confirmation"))!;
                Until(() => confirmation.Current.IsEnabled, "copy preview permits explicit approval");
                ((TogglePattern)confirmation.GetCurrentPattern(TogglePattern.Pattern)).Toggle();
                var edits = Edits(window); SetValue(edits[0], "预览后改变名称");
                Require(!window.FindFirst(TreeScope.Descendants, Id("ExecuteButton"))!.Current.IsEnabled && ((TogglePattern)confirmation.GetCurrentPattern(TogglePattern.Pattern)).Current.ToggleState == ToggleState.Off, "changed input invalidates stale preview approval and rejects execution");
                Capture("book-stale-preview-rejected"); Invoke(window, Name("取消"));
                Require(!File.Exists(target) && Hash(bookPath) == before, "cancelled book-copy preview publishes nothing and preserves source bytes");
            });
            Case("book-copy-new-identity", () => {
                copiedBookPath = Path.Combine(data, "复制 独立身份账套.caiwu"); var before = Hash(bookPath);
                var window = BookChoice(copiedBookPath, "安装复制独立身份"); Invoke(window, Name("生成复制前预览"));
                ApproveBook(window); Capture("book-copy-approved"); NativeDoubleClick(window.FindFirst(TreeScope.Descendants, Id("ExecuteButton"))!);
                Until(() => !HasWindow("复制为新账套") && File.Exists(copiedBookPath) && Text(main!, "NotificationText").Contains("新账套已复制并登记", StringComparison.Ordinal), "actual book copy execution registration and close", 30000);
                var saved = Read(copiedBookPath); var source = Read(bookPath);
                Require(saved.Book.Id != source.Book.Id && saved.Book.Name == "安装复制独立身份" && saved.Revision == 1 && saved.Vouchers.Count == source.Vouchers.Count, "structured full copy reopens with new identity revision one and complete vouchers");
                var provenance = saved.AuditEvents.Single(a => a.Action == "BookCopiedAsNew");
                using var detail = JsonDocument.Parse(provenance.Detail);
                Require(detail.RootElement.GetProperty("SourceBookId").GetGuid() == source.Book.Id && detail.RootElement.GetProperty("SourceRevision").GetInt64() == source.Revision && detail.RootElement.GetProperty("SourceFingerprint").GetString() == ProvenanceFingerprint.Compute(source), "persisted copy audit binds exact source identity revision and semantic hash");
                Require(Hash(bookPath) == before && Text(main!, "BookNameText") == "安装合成账套", "executed copy preserves exact source bytes and active source session");
                Require(Inventory().Books.Count(b => b.RelativeDatabasePath.EndsWith("复制 独立身份账套.caiwu", StringComparison.Ordinal)) == 1, "repeat native confirm registers exactly one target");
                CheckLeases(); Capture("book-copy-saved");
            });
            Case("book-duplicate-destination-refused", () => {
                var before = Hash(copiedBookPath); var source = Hash(bookPath);
                var window = BookChoice(copiedBookPath, "重复目标必须拒绝"); Invoke(window, Name("生成复制前预览"));
                Until(() => !string.IsNullOrWhiteSpace(Text(window, "StatusText")), "existing destination refusal");
                Require(!window.FindFirst(TreeScope.Descendants, Id("ExecuteButton"))!.Current.IsEnabled && !window.FindFirst(TreeScope.Descendants, Id("Confirmation"))!.Current.IsEnabled, "existing destination cannot be approved or executed");
                Capture("book-duplicate-target-rejected"); Invoke(window, Name("取消"));
                Require(Hash(copiedBookPath) == before && Hash(bookPath) == source, "duplicate operation retains exact winner and source file hashes");
            });
            Case("backup-restore-same-identity", () => {
                var before = Hash(bookPath); var inventory = Inventory();
                Menu("文件", "备份当前账套…"); Yes("受管完整备份");
                var receipts = Path.Combine(data, "Global", "BackupReceipts");
                Until(() => Directory.Exists(receipts) && Directory.GetFiles(receipts, "*.json").Length == 1 && Text(main!, "NotificationText").Contains("独立可信哈希收据已保存", StringComparison.Ordinal), "actual full backup trusted receipt");
                var receipt = Directory.GetFiles(receipts, "*.json").Single();
                Menu("文件", "从备份恢复副本…"); FileDialog("选择本机受管完整备份的可信哈希收据", receipt); Yes("完整恢复");
                Until(() => Text(main!, "NotificationText").Contains("登记附件已恢复", StringComparison.Ordinal), "normal full restore completion", 30000);
                var source = Read(bookPath); var recovered = Inventory().Books.Single(b => !inventory.Books.Any(old => old.InstanceId == b.InstanceId));
                restoredBookPath = SafePaths.Child(data, recovered.RelativeDatabasePath); var restored = Read(restoredBookPath);
                Require(restored.Book.Id == source.Book.Id && restored.Revision == source.Revision && JsonSerializer.Serialize(restored, PayloadManifest.Json) == JsonSerializer.Serialize(source, PayloadManifest.Json), "restore preserves identity revision and exact semantic snapshot unlike copy-as-new");
                Require(Hash(bookPath) == before && Hash(identityPath) == identityBefore, "restore preserves exact source ledger and global identity bytes");
                var originalAttachment = Attachment(bookPath); var restoredAttachment = Attachment(restoredBookPath);
                Require(originalAttachment.InstanceId != restoredAttachment.InstanceId && originalAttachment.RelativePath != restoredAttachment.RelativePath && Hash(SafePaths.Child(data, originalAttachment.RelativePath)) == Hash(SafePaths.Child(data, restoredAttachment.RelativePath)), "same-identity restored physical instance has an isolated path with initially identical summary file hash");
                Capture("same-identity-restored");
            });
            Case("physical-instance-summary-isolation", () => {
                var originalAttachment = Attachment(bookPath); var originalHash = Hash(SafePaths.Child(data, originalAttachment.RelativePath));
                var before = Summary(bookPath); var restored = Summary(restoredBookPath);
                Menu("会计档案", "常用摘要管理…"); var manager = Window(t => t.StartsWith("常用摘要管理 ·", StringComparison.Ordinal));
                Invoke(manager, Name("新增分类")); Set(manager, "Feature.Summary.Draft", "仅第二物理副本"); Invoke(manager, Id("Feature.Summary.Save"));
                Until(() => Summary(restoredBookPath).Categories.Count == restored.Categories.Count + 1, "second physical instance summary saved");
                Capture("second-instance-summary-saved"); Close(manager);
                Require(Hash(SafePaths.Child(data, originalAttachment.RelativePath)) == originalHash && Summary(bookPath).Version == before.Version && !Summary(bookPath).Categories.Any(c => c.Name == "仅第二物理副本"), "same BookId does not alias catalogs: second physical instance update preserves first catalog bytes version and categories");
                OpenBook(bookPath); Menu("会计档案", "常用摘要管理…"); manager = Window(t => t.StartsWith("常用摘要管理 ·", StringComparison.Ordinal));
                Require(Summary(bookPath).Categories.Count == before.Categories.Count, "normal source reopen resolves its own original physical catalog"); Capture("source-instance-still-isolated"); Close(manager);
            });
            Case("trial-balance-visible-native", () => {
                OpenBook(bookPath);
                var tab = main!.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TabItem)).Cast<AutomationElement>().Single(e => e.Current.Name == "科目余额表");
                SetForegroundWindow((IntPtr)main.Current.NativeWindowHandle);
                NativeDoubleClick(tab);
                AutomationElement? grid = null, totals = null;
                Until(() => {
                    grid = main.FindFirst(TreeScope.Descendants, Id("TrialGrid")); totals = main.FindFirst(TreeScope.Descendants, Id("TrialTotalsText"));
                    return ((SelectionItemPattern)tab.GetCurrentPattern(SelectionItemPattern.Pattern)).Current.IsSelected && grid is not null && !grid.Current.IsOffscreen && grid.Current.BoundingRectangle.Height > 100 && totals is not null && !totals.Current.IsOffscreen && totals.Current.Name.Contains("123.45", StringComparison.Ordinal);
                }, "actual selected balance page, visible grid and exact posted amount");
                Require(main.FindFirst(TreeScope.Descendants, Name("仅含已记账凭证 · 双击查看明细")) is { Current.IsOffscreen: false }, "visible balance-page explanatory heading confirms actual page content");
                var visibleGrid = grid ?? throw new InvalidDataException("Visible balance grid disappeared.");
                var visibleTotals = totals ?? throw new InvalidDataException("Visible balance totals disappeared.");
                desktop!.WaitForInputIdle(5000); Thread.Sleep(500); DwmFlush(); Thread.Sleep(250);
                Require(((SelectionItemPattern)tab.GetCurrentPattern(SelectionItemPattern.Pattern)).Current.IsSelected && !visibleGrid.Current.IsOffscreen && !visibleTotals.Current.IsOffscreen && visibleTotals.Current.Name.Contains("123.45", StringComparison.Ordinal), "balance page and amount remain visible after actual layout/compositor settle");
                Capture("trial-balance-confirmed-native");
                File.WriteAllText(Path.Combine(evidence, "trial-balance-visible-receipt.json"), JsonSerializer.Serialize(new { sourceCommit = Environment.GetEnvironmentVariable("GITHUB_SHA"), selectedPageTitle = tab.Current.Name, selected = ((SelectionItemPattern)tab.GetCurrentPattern(SelectionItemPattern.Pattern)).Current.IsSelected, gridVisible = !visibleGrid.Current.IsOffscreen, gridBounds = visibleGrid.Current.BoundingRectangle.ToString(), rowCount = ((GridPattern)visibleGrid.GetCurrentPattern(GridPattern.Pattern)).Current.RowCount, totalsVisible = !visibleTotals.Current.IsOffscreen, actualTotals = visibleTotals.Current.Name, expectedPostedAmount = "123.45", nativeWidth = GetSystemMetrics(0), nativeHeight = GetSystemMetrics(1), pngSha256 = Hash(Path.Combine(evidence, "trial-balance-confirmed-native.png")) }, PayloadManifest.Json));
            });
            Cases.Add(new("stale-source-revision", "not-run", "No supported normal installed UI action changes a source revision while its owned modal editor remains open. Do not mutate SQLite behind the App-owned managed-data lease or change credentials/permissions to manufacture expiry. Preview approval invalidation is verified separately and is not claimed as this case."));
            CheckLeases();
            Close(main);
            if (!launcher.WaitForExit(30000) || launcher.ExitCode != 0) throw new IOException("Installed App did not exit normally.");
            _ = stdout.GetAwaiter().GetResult(); _ = stderr.GetAwaiter().GetResult();
            Case("independent-readback", () => {
                AssertOriginal(Read(bookPath));
                using var managed = Installation.OpenManagedData(install);
                var source = managed.FindBook(bookPath, Read(bookPath).Book.Id); var copied = managed.FindBook(copiedBookPath, Read(copiedBookPath).Book.Id); var restored = managed.FindBook(restoredBookPath, Read(restoredBookPath).Book.Id);
                Require(source.InstanceId != restored.InstanceId && source.BookId == restored.BookId && copied.BookId != source.BookId, "reacquired actual managed session independently resolves all three physical identities");
                File.WriteAllText(Path.Combine(evidence, "readback.json"), JsonSerializer.Serialize(new { source = Read(bookPath), copied = Read(copiedBookPath), restored = Read(restoredBookPath), inventory = managed.ReadInventory(), sourceSummary = Summary(bookPath).Version, restoredSummary = Summary(restoredBookPath).Version }, PayloadManifest.Json));
            });
            Save(Failures.Count == 0, Failures.Count > 0 ? string.Join("\n", Failures) : null); return Failures.Count > 0 ? 1 : 0;
        }
        catch (Exception ex) { try { Capture("failure"); } catch { } try { DumpTree(); } catch { } Save(false, ex.ToString()); Console.Error.WriteLine(ex.Message); return 1; }
        finally {
            try { if (desktop is { HasExited: false }) desktop.CloseMainWindow(); } catch { }
            if (launcher is { HasExited: false } && !launcher.WaitForExit(5000)) launcher.Kill(true);
            display?.Dispose();
        }
    }
    private static void Case(string name, Action action) {
        try { action(); Cases.Add(new(name, "passed")); }
        catch (Exception ex) {
            Failures.Add(name + ": " + ex.Message); Cases.Add(new(name, "failed", ex.ToString()));
            try { Capture(name + "-failure"); DumpTree(name + "-ui-tree"); } catch { }
            // Close owned product dialogs to continue independent cases; no synthetic business writes here.
            var ownerHandle = main?.Current.NativeWindowHandle ?? 0;
            foreach (var window in ProductWindows().Reverse().ToArray()) { try { if (window.Current.NativeWindowHandle != ownerHandle) Close(window); } catch { } }
        }
        Save(false, "In progress");
    }
    private static void Save(bool success, string? failure) {
        if (evidence.Length == 0) return;
        var results = ExpectedCases.Select(name => Cases.FirstOrDefault(c => c.name == name) ?? new CaseResult(name, "not-run", "Controller has not reached this case.")).ToArray();
        success = success && results.All(c => c.status == "passed");
        File.WriteAllText(Path.Combine(evidence, "installed-bookflows.json"), JsonSerializer.Serialize(new { success, failure, windowsExecuted = true, normalProductLogin = normalLoginCompleted, sourceProjectsExecutedAsProduct = false, sourceCommit = Environment.GetEnvironmentVariable("GITHUB_SHA"), productionBaseline = "dece298946d03ad88c5031eb02dab8f87c330046", checks = Checks, cases = results, expectedCases = ExpectedCases }, PayloadManifest.Json));
    }
    private static void Pass(string name) { Checks.Add(name); Save(false, "In progress"); }
    private static void Require(bool value, string name) { if (!value) throw new InvalidDataException(name); Pass(name); }
    private static LedgerSnapshot Read(string path) {
        // Source is opened read-only by RestoreBackup; only a new disposable snapshot is opened writable.
        var capture = Path.Combine(Path.GetTempPath(), "installed-bookflows-read-" + Guid.NewGuid().ToString("N") + ".caiwu");
        try { SqliteLedgerStore.RestoreBackup(path, capture); using var store = SqliteLedgerStore.Open(capture); store.CheckIntegrity(); return store.Read(); }
        finally { foreach (var suffix in new[] { "", "-wal", "-shm", "-journal" }) if (File.Exists(capture + suffix)) File.Delete(capture + suffix); }
    }
    private static string Hash(string path) {
        // Read the real file without excluding SQLite's already open writer handle. This does not acquire or bypass the managed data lease.
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        return Convert.ToHexStringLower(SHA256.HashData(stream));
    }
    private static void AssertOriginal(LedgerSnapshot snapshot) => Require(JsonSerializer.Serialize(snapshot.Vouchers.Single(v => v.Id == baseline!.Vouchers.Single().Id), PayloadManifest.Json) == originalVoucherJson, "source posted voucher identity lines actors signatures and status remain byte-for-byte semantically unchanged");
    private static ManagedModuleInventory Inventory() => JsonSerializer.Deserialize<ManagedModuleInventory>(File.ReadAllText(Path.Combine(data, "managed-modules.json")), PayloadManifest.Json)!;
    private static ManagedAttachment Attachment(string path) { var inv = Inventory(); var book = inv.Books.Single(b => string.Equals(SafePaths.Child(data, b.RelativeDatabasePath), path, StringComparison.OrdinalIgnoreCase)); return inv.Attachments.Single(a => a.InstanceId == book.InstanceId && a.Key == "summaries"); }
    private static SummarySnapshot Summary(string path) { var a = Attachment(path); return JsonSummaryCatalog.Open(new(data, SafePaths.Child(data, a.RelativePath), a.BookId)).Read(); }
    private static void Set(AutomationElement root, string id, string text) => SetValue(root.FindFirst(TreeScope.Descendants, Id(id))!, text);
    private static AutomationElement[] Edits(AutomationElement root) => root.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit)).Cast<AutomationElement>().ToArray();
    private static void SelectSource() {
        var tab = main!.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TabItem)).Cast<AutomationElement>().Single(e => e.Current.Name == "凭证序时簿"); ((SelectionItemPattern)tab.GetCurrentPattern(SelectionItemPattern.Pattern)).Select();
        var list = main.FindFirst(TreeScope.Descendants, Id("VoucherGrid"))!;
        var row = list.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.DataItem)).Cast<AutomationElement>().First(); ((SelectionItemPattern)row.GetCurrentPattern(SelectionItemPattern.Pattern)).Select();
    }
    private static AutomationElement VoucherChoice(int number) { SelectSource(); Menu("实务操作", "复制凭证为新草稿…"); var w = Window(t => t == "复制为新草稿"); Set(w, "CopyDate", baseline!.Vouchers.Single().Date.ToString("yyyy-MM-dd")); Set(w, "CopyKind", "记"); Set(w, "CopyNumber", number.ToString()); Set(w, "CopyAttachments", "0"); return w; }
    private static AutomationElement BookChoice(string destination, string name) { Menu("会计档案", "复制账套…"); var w = Window(t => t == "复制为新账套"); var edits = Edits(w); SetValue(edits[0], name); SetValue(edits[1], destination); Require(((ValuePattern)edits[2].GetCurrentPattern(ValuePattern.Pattern)).Current.IsReadOnly, "installed host fixes book-copy audit actor"); return w; }
    private static void ApproveBook(AutomationElement w) { var c = w.FindFirst(TreeScope.Descendants, Id("Confirmation"))!; Until(() => c.Current.IsEnabled, "preview ready for approval"); ((TogglePattern)c.GetCurrentPattern(TogglePattern.Pattern)).Toggle(); Until(() => w.FindFirst(TreeScope.Descendants, Id("ExecuteButton"))!.Current.IsEnabled, "explicit approval enables execution"); }
    private static void OpenBook(string path) { Shortcut(0x4f); FileDialog("打开账套", path); Until(() => Text(main!, "NotificationText").Contains("账套已打开", StringComparison.Ordinal), "normal book reopen"); }
    private static void CheckLeases() { foreach (var path in new[] { Path.Combine(install, ".delivery.lock"), Path.Combine(data, ".delivery-data.lock") }) { var rejected = false; try { using var file = File.Open(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None); } catch (IOException) { rejected = true; } Require(rejected, "actual installed App retains exclusive OS lease: " + Path.GetFileName(path)); } }
    private static void NativeDoubleClick(AutomationElement control) { var r = control.Current.BoundingRectangle; SetCursorPos((int)(r.X + r.Width / 2), (int)(r.Y + r.Height / 2)); for (var i = 0; i < 2; i++) { Send(new Input { Type = 0, Mouse = new Mouse { Flags = 2 } }); Send(new Input { Type = 0, Mouse = new Mouse { Flags = 4 } }); Thread.Sleep(20); } }
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
        var entered = ((ValuePattern)focused.GetCurrentPattern(ValuePattern.Pattern)).Current.Value;
        var normalized = Path.GetFullPath(entered.Trim('"'));
        File.WriteAllText(Path.Combine(evidence, "native-path-" + Guid.NewGuid().ToString("N") + ".json"), JsonSerializer.Serialize(new { title, controlName = focused.Current.Name, automationId = focused.Current.AutomationId, entered, normalized, expected = path }, PayloadManifest.Json));
        if (!string.Equals(normalized, Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Native filename input did not read back as the exact requested path.");
        Key(0x09); Thread.Sleep(100); // Commit the filename field before explicit confirmation.
        var saving = title.StartsWith("保存", StringComparison.Ordinal);
        var confirm = dialog.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button)).Cast<AutomationElement>().FirstOrDefault(e => saving
            ? e.Current.Name.StartsWith("Save", StringComparison.OrdinalIgnoreCase) || e.Current.Name.Contains("保存", StringComparison.Ordinal)
            : e.Current.Name.StartsWith("Open", StringComparison.OrdinalIgnoreCase) || e.Current.Name.Contains("打开", StringComparison.Ordinal)) ?? throw new InvalidDataException("Native Save/Open confirmation button absent.");
        ((InvokePattern)confirm.GetCurrentPattern(InvokePattern.Pattern)).Invoke();
        Until(() => !HasWindow(title), "native path dialog acceptance");
    }
    private static void Cell(AutomationElement grid, int row, int column, string text)
    {
        var cell = ((GridPattern)grid.GetCurrentPattern(GridPattern.Pattern)).GetItem(row, column); var rectangle = cell.Current.BoundingRectangle;
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
    private static void DumpTree(string name = "failure-ui-tree")
    {
        var windows = AutomationElement.RootElement.FindAll(TreeScope.Children, new PropertyCondition(AutomationElement.ProcessIdProperty, desktop!.Id)).Cast<AutomationElement>();
        var nodes = windows.SelectMany(w => w.FindAll(TreeScope.Subtree, Condition.TrueCondition).Cast<AutomationElement>()).Select(e => new { e.Current.Name, e.Current.AutomationId, type = e.Current.ControlType.ProgrammaticName, e.Current.IsEnabled }).ToArray();
        File.WriteAllText(Path.Combine(evidence, name + ".json"), JsonSerializer.Serialize(nodes, PayloadManifest.Json));
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
    [DllImport("dwmapi.dll")] private static extern int DwmFlush();
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
