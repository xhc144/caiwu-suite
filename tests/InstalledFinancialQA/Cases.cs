using System.IO;
using System.Text.Json;
using System.Windows.Automation;
using Caiwu.Contracts;
using Caiwu.Costing;
using Caiwu.Delivery;
using Caiwu.Delivery.Modules;
using Caiwu.Persistence.Sqlite;
using Caiwu.ReportDesigner;

internal static partial class Program
{
    private static string costFile = "", classificationFile = "", templateFile = "", restoredBookPath = "";
    private static void Costing()
    {
        Menu("实务操作", "成本工作表（审核建议）…"); var window = Window(t => t.StartsWith("成本工作表 ·", StringComparison.Ordinal));
        Invoke(window, Name("载入合成样例")); Invoke(window, Name("计算 / 复算"));
        Require(HasText(window, "最终完工 250.00"), "installed cost sample calculates actual 250.00 before editing");
        Cell(window.FindFirst(TreeScope.Descendants, Id("Stages"))!, 0, 4, "84"); Invoke(window, Name("计算 / 复算"));
        Require(HasText(window, "最终完工 254.00"), "native DataGrid edit labor80 to84 recalculates actual final cost254");
        Tab(window, "5 分配审核明细"); Require(Grid(window, "AllocationRows").GetCurrentPattern(GridPattern.Pattern) is GridPattern { Current.RowCount: > 0 }, "actual installed allocation audit rows are rendered"); Capture("cost-allocation");
        Invoke(window, Name("保存并登记受管审核工作表")); Until(() => HasText(window, "已保存并登记，纳入完整备份"), "cost native managed save and registration");
        costFile = Directory.GetFiles(Path.Combine(Path.GetDirectoryName(moduleRoot)!, "Costing"), "*.json").Single();
        var saved = CostWorksheetExport.OpenJson(costFile, BookId);
        Require(saved.FinishedCost == 254m && saved.Input.Stages[0].DirectLabor == 84m, "independent registered cost JSON readback matches edited input84 and finished254");
        var costHash = PayloadManifest.Hash(costFile); Close(window);
        Menu("实务操作", "成本工作表（审核建议）…"); window = Window(t => t.StartsWith("成本工作表 ·", StringComparison.Ordinal));
        Invoke(window, Name("打开审核 JSON")); ChooseFile(costFile, false); Invoke(window, Name("计算 / 复算"));
        Require(HasText(window, "最终完工 254.00") && PayloadManifest.Hash(costFile) == costHash, "reopened installed cost window imports saved managed JSON and recalculates254 without changing file");
        Tab(window, "4 计算明细"); Capture("cost-reopened"); Close(window);
    }
    private static void Nonprofit()
    {
        Menu("报表", "民非报表分类与预览（当前月）…"); var window = Window(t => t == "民非报表分类 · 仅本地预览");
        Invoke(window, Name("导入分类JSON")); FileDialog("从宿主用户数据目录导入分类", Path.Combine(moduleRoot, "synthetic-input.json"));
        Tab(window, "1 科目语义");
        var accounts = VisibleGrid(window); Cell(accounts, 0, 6, "安装主界面实际编辑并复核的合成依据");
        Invoke(window, Name("校验并预览")); Require(HasText(window, "计算及两表勾稽通过"), "normal installed nonprofit explicit classification edit produces reconciled two-table preview");
        Tab(window, "资产负债表预览"); Require(HasText(window, "110.00"), "actual installed balance preview contains independent expected assets110"); Capture("nonprofit-balance");
        Tab(window, "业务活动表预览"); Require(HasText(window, "10.00"), "actual installed activity preview contains independent expected donation10"); Capture("nonprofit-activity");
        classificationFile = Path.Combine(moduleRoot, "installed-reviewed.json"); Invoke(window, Name("另存新分类JSON")); FileDialog("另存新的分类文件（不覆盖）", classificationFile);
        Until(() => File.Exists(classificationFile), "actual native classification save");
        Require(File.ReadAllText(classificationFile).Contains("安装主界面实际编辑并复核的合成依据", StringComparison.Ordinal) || File.ReadAllText(classificationFile).Contains("\\u5B89\\u88C5", StringComparison.OrdinalIgnoreCase), "saved classification contains the actual edited review evidence");
        Close(window); Until(() => Text(main!, "NotificationText").Contains("登记 2 个民非分类 JSON", StringComparison.Ordinal), "normal main window registers both explicit classification inputs");
        var savedHash = PayloadManifest.Hash(classificationFile);
        Menu("报表", "民非报表分类与预览（当前月）…"); window = Window(t => t == "民非报表分类 · 仅本地预览");
        Invoke(window, Name("导入分类JSON")); FileDialog("从宿主用户数据目录导入分类", classificationFile); Invoke(window, Name("校验并预览"));
        Require(HasText(window, "计算及两表勾稽通过"), "reopened actual installed nonprofit classification restores complete preview");
        Tab(window, "3 余额事实"); Cell(VisibleGrid(window), 0, 4, "MISSING-SYNTHETIC-ACCOUNT"); Invoke(window, Name("校验并预览"));
        Require(HasText(window, "引用不存在的科目"), "invalid explicit classification surfaces the actual product validation error");
        Require(!window.FindFirst(TreeScope.Descendants, Name("导出当前表CSV"))!.Current.IsEnabled && !window.FindFirst(TreeScope.Descendants, Name("导出当前表HTML"))!.Current.IsEnabled, "classification error disables both actual export controls");
        Tab(window, "资产负债表预览"); Require(((GridPattern)VisibleGrid(window).GetCurrentPattern(GridPattern.Pattern)).Current.RowCount == 0, "nonprofit validation error leaves zero old balance preview rows");
        Tab(window, "业务活动表预览"); Require(((GridPattern)VisibleGrid(window).GetCurrentPattern(GridPattern.Pattern)).Current.RowCount == 0, "nonprofit validation error leaves zero old activity preview rows"); Capture("nonprofit-error-cleared");
        Require(PayloadManifest.Hash(classificationFile) == savedHash, "classification validation failure preserves saved reviewed JSON");
        Close(window); Until(() => Text(main!, "NotificationText").Contains("民非分类 JSON", StringComparison.Ordinal), "nonprofit registration after validation failure");
    }
    private static void Designer()
    {
        Tab(main!, "科目余额表"); Menu("报表", "自定义当前账表…"); var window = Window(t => t == "自定义当前账表");
        SetValue(window.FindFirst(TreeScope.Descendants, Id("TitleEditor"))!, "合成安装报表计算模板");
        Invoke(window, Name("添加计算列")); var columns = Grid(window, "ColumnEditor"); var row = ((GridPattern)columns.GetCurrentPattern(GridPattern.Pattern)).Current.RowCount - 1;
        Cell(columns, row, 1, "合成差额"); Cell(columns, row, 2, "[periodDebit]-[periodCredit]");
        Invoke(window, Name("重新预览")); Require(HasText(window, "预览已更新"), "actual installed designer calculates native edited decimal formula");
        var preview = Grid(window, "PreviewGrid"); var pattern = (GridPattern)preview.GetCurrentPattern(GridPattern.Pattern);
        Require(pattern.Current.RowCount > 0 && FormulaCellIsTen(preview), "actual designer calculated-column bank cell equals independent debit-credit10"); Capture("designer-formula");
        templateFile = Path.Combine(Path.GetDirectoryName(moduleRoot)!, "Reports", "installed-template.json");
        Invoke(window, Name("保存模板")); ChooseFile(templateFile, true); Until(() => HasText(window, "模板已原子保存"), "normal designer template atomic save");
        var loaded = TemplateStore.Load(templateFile);
        Require(loaded.Template.Title == "合成安装报表计算模板" && loaded.Template.Columns.Any(c => c.Title == "合成差额" && c.Expression == "[periodDebit]-[periodCredit]"), "independent template native-codec readback verifies edited title and formula");
        var savedHash = PayloadManifest.Hash(templateFile); Close(window); Until(() => Text(main!, "NotificationText").Contains("登记 1 个模板 JSON", StringComparison.Ordinal), "actual MainWindow template attachment registration");
        Menu("报表", "自定义当前账表…"); window = Window(t => t == "自定义当前账表"); Invoke(window, Name("载入模板")); ChooseFile(templateFile, false);
        Until(() => HasText(window, "模板已读回并校验当前来源"), "reopened installed designer reads saved native template");
        Require(((ValuePattern)window.FindFirst(TreeScope.Descendants, Id("TitleEditor"))!.GetCurrentPattern(ValuePattern.Pattern)).Current.Value == "合成安装报表计算模板" && PayloadManifest.Hash(templateFile) == savedHash && FormulaCellIsTen(Grid(window, "PreviewGrid")), "reopened designer retains saved title and file hash and recalculates actual formula cell10"); Capture("designer-reopened"); Close(window);
        Until(() => Text(main!, "NotificationText").Contains("模板 JSON", StringComparison.Ordinal), "designer closes and validates attachments again");
    }
    private static void Restore()
    {
        Menu("会计档案", "常用摘要管理…"); Yes("初始化摘要库"); var summary = Window(t => t.Contains("常用摘要", StringComparison.Ordinal)); Close(summary);
        var inv = Inventory(); var source = inv.Books.Single(b => SafePaths.Child(data, b.RelativeDatabasePath).Equals(bookPath, StringComparison.OrdinalIgnoreCase));
        var attachments = inv.Attachments.Where(a => a.InstanceId == source.InstanceId).ToArray();
        Require(attachments.Length == 5 && attachments.Select(a => a.Codec).Distinct().Count() == 4, "actual App saved and registered five attachments covering all four native codecs including two classification files");
        File.WriteAllText(Path.Combine(evidence, "registered-before-backup.json"), JsonSerializer.Serialize(attachments.Select(a => new { a.Key, a.Codec, a.RelativePath, sha256 = PayloadManifest.Hash(SafePaths.Child(data, a.RelativePath)) }), PayloadManifest.Json));
        Menu("文件", "备份当前账套…"); Yes("受管完整备份");
        var receipts = Path.Combine(data, "Global", "BackupReceipts"); Until(() => Directory.Exists(receipts) && Directory.GetFiles(receipts, "*.json").Length == 1 && Text(main!, "NotificationText").Contains("独立可信哈希收据已保存", StringComparison.Ordinal), "actual App complete four-codec backup");
        var receiptPath = Directory.GetFiles(receipts, "*.json").Single();
        File.Copy(receiptPath, Path.Combine(evidence, "actual-trusted-receipt.json"));
        using (var receipt = JsonDocument.Parse(File.ReadAllText(receiptPath)))
        {
            var bundle = receipt.RootElement.GetProperty("Directory").GetString()!; var trustedHash = receipt.RootElement.GetProperty("ManifestSha256").GetString()!;
            var manifestPath = Path.Combine(bundle, "book-backup.json");
            // Keep the product's actual trusted receipt and manifest hash; no receipt rewriting.
            if (!File.Exists(manifestPath)) manifestPath = Directory.GetFiles(bundle, "*.json").Single(p => PayloadManifest.Hash(p).Equals(trustedHash, StringComparison.OrdinalIgnoreCase));
            Require(PayloadManifest.Hash(manifestPath).Equals(trustedHash, StringComparison.OrdinalIgnoreCase), "actual backup manifest matches the independently retained trusted receipt hash");
            File.Copy(manifestPath, Path.Combine(evidence, "actual-backup-manifest.json"));
        }
        Menu("文件", "从备份恢复副本…"); FileDialog("选择本机受管完整备份的可信哈希收据", receiptPath); Yes("完整恢复");
        Until(() => Text(main!, "NotificationText").Contains("登记附件已恢复", StringComparison.Ordinal), "actual installed App restores and opens a new physical target");
        inv = Inventory(); restoredBookPath = SafePaths.Child(data, inv.Books.Single(b => b.InstanceId != source.InstanceId).RelativeDatabasePath);
        Require(File.Exists(restoredBookPath) && PayloadManifest.Hash(identityPath) == identityHash && PayloadManifest.Hash(bookPath) == sourceBookHash, "actual restore target exists while original ledger and global identities remain byte-identical"); Capture("four-codec-restored");
    }
    private static void VerifyRestore()
    {
        using var leftStore = SqliteLedgerStore.Open(bookPath); using var rightStore = SqliteLedgerStore.Open(restoredBookPath); rightStore.CheckIntegrity();
        var left = leftStore.Read(); var right = rightStore.Read();
        var a = BookOperations.Inspect(install, Path.GetRelativePath(data, bookPath)); var b = BookOperations.Inspect(install, Path.GetRelativePath(data, restoredBookPath));
        var sourceBank = BankCodeBalance(left); var restoredBank = BankCodeBalance(right);
        File.WriteAllText(Path.Combine(evidence, "restore-ledger-diagnostics.json"), JsonSerializer.Serialize(new { source = a, actualRestoredTarget = b, explicitAccountCode = "1002", sourceAccountBalance = sourceBank, restoredAccountBalance = restoredBank }, PayloadManifest.Json));
        // BookOperations.BankBalance is optional and selected by the literal display
        // name 银行存款. This explicitly named synthetic bank must be checked by code.
        Require(a.BookId == b.BookId && a.Revision == b.Revision && a.SnapshotSha256 == b.SnapshotSha256 && a.PostedVoucherCount == 2 && b.PostedVoucherCount == 2 && a.BankBalance == b.BankBalance && sourceBank == 110m && restoredBank == 110m, "independent actual-restored SQLite readback matches full snapshot revision identity two posted vouchers and explicit bank1002 balance110");
        using var managed = Installation.OpenManagedData(install); var inv = managed.ReadInventory(); var source = managed.FindBook(bookPath, BookId); var target = managed.FindBook(restoredBookPath, BookId);
        var originals = inv.Attachments.Where(x => x.InstanceId == source.InstanceId).OrderBy(x => x.Key).ToArray(); var restored = inv.Attachments.Where(x => x.InstanceId == target.InstanceId).OrderBy(x => x.Key).ToArray();
        Require(originals.Length == 5 && restored.Length == originals.Length && originals.Select(x => x.Codec).Distinct().Count() == 4, "restored target has exact complete registered attachment membership across all four codecs");
        var codecs = new ManagedModuleHost(managed).Codecs; var evidenceRows = new List<object>();
        for (var i = 0; i < originals.Length; i++)
        {
            var x = originals[i]; var y = restored[i]; var xp = SafePaths.Child(data, x.RelativePath); var yp = SafePaths.Child(data, y.RelativePath); var codec = codecs.Single(c => c.Id == x.Codec);
            Require(x.Key == y.Key && x.Codec == y.Codec && PayloadManifest.Hash(xp) == PayloadManifest.Hash(yp), "exact restored attachment key codec and SHA256: " + x.Key);
            var xv = codec.ReadVersion(xp, left); var yv = codec.ReadVersion(yp, right); Require(xv == yv, "native codec content/version equality: " + x.Key);
            evidenceRows.Add(new { x.Key, x.Codec, source = x.RelativePath, restored = y.RelativePath, sourceSha256 = PayloadManifest.Hash(xp), restoredSha256 = PayloadManifest.Hash(yp), sourceVersion = xv, restoredVersion = yv });
        }
        File.WriteAllText(Path.Combine(evidence, "actual-restored-readback.json"), JsonSerializer.Serialize(new { source = a, actualRestoredTarget = b, explicitAccountCode = "1002", sourceAccountBalance = sourceBank, restoredAccountBalance = restoredBank, originalLedgerSha256 = sourceBookHash, identityUnchanged = PayloadManifest.Hash(identityPath) == identityHash, attachments = evidenceRows }, PayloadManifest.Json));
    }
    private static decimal BankCodeBalance(LedgerSnapshot snapshot)
    {
        var account = snapshot.Accounts.Single(a => a.Code == "1002");
        return account.OpeningDebit - account.OpeningCredit + snapshot.Vouchers.Where(v => v.Status == VoucherStatus.Posted).SelectMany(v => v.Lines).Where(l => l.AccountCode == account.Code).Sum(l => l.Debit - l.Credit);
    }
    private static bool FormulaCellIsTen(AutomationElement grid)
    {
        var pattern = (GridPattern)grid.GetCurrentPattern(GridPattern.Pattern);
        var cell = pattern.GetItem(0, pattern.Current.ColumnCount - 1);
        if (cell.TryGetCurrentPattern(ScrollItemPattern.Pattern, out var scroll)) ((ScrollItemPattern)scroll).ScrollIntoView();
        Thread.Sleep(150);
        return cell.Current.Name == "10.00" || cell.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Text)).Cast<AutomationElement>().Any(e => e.Current.Name == "10.00");
    }
    private static ManagedModuleInventory Inventory() => JsonSerializer.Deserialize<ManagedModuleInventory>(File.ReadAllText(Path.Combine(data, "managed-modules.json")), PayloadManifest.Json)!;
    private static AutomationElement Grid(AutomationElement window, string id) => window.FindFirst(TreeScope.Descendants, Id(id)) ?? throw new InvalidDataException("Grid absent: " + id);
    private static AutomationElement VisibleGrid(AutomationElement window) => window.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.DataGrid)).Cast<AutomationElement>().Single(g => !g.Current.IsOffscreen);
    private static bool HasText(AutomationElement root, string text) => root.FindAll(TreeScope.Descendants, Condition.TrueCondition).Cast<AutomationElement>().Any(e => e.Current.Name.Contains(text, StringComparison.Ordinal));
    private static void Tab(AutomationElement root, string title) { var tab = root.FindFirst(TreeScope.Descendants, new AndCondition(Name(title), new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TabItem))) ?? throw new InvalidDataException("Tab absent: " + title); ((SelectionItemPattern)tab.GetCurrentPattern(SelectionItemPattern.Pattern)).Select(); Thread.Sleep(200); }
    private static void ChooseFile(string path, bool saving)
    {
        var dialog = Window(t => t is "Open" or "打开" or "Save As" or "另存为" or "保存为" || t.StartsWith("保存", StringComparison.Ordinal));
        FileDialog(dialog.Current.Name, path);
    }
}
