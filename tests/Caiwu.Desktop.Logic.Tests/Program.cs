using System.Globalization;
using Caiwu.Contracts;
using Caiwu.Desktop.Presentation;

CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("zh-CN");
var passed = 0;
void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
    passed++; Console.WriteLine("PASS " + message);
}
Check(AmountInput.Parse("0.10", "金额") + AmountInput.Parse("0.20", "金额") == 0.30m, "金额输入保持十进制精度");
Check(AmountInput.Parse("", "金额") == 0m && AmountInput.Parse("1,234.50", "金额") == 1234.50m, "空金额和千分位输入");
foreach (var invalid in new[] { "1.001", "-1", "1e4", "不是金额" })
{
    var rejected = false;
    try { AmountInput.Parse(invalid, "测试金额"); } catch (LedgerValidationException) { rejected = true; }
    Check(rejected, "拒绝非法金额：" + invalid);
}

var account = new Account("1002", "银行存款", null, BalanceDirection.Debit, true, 100000m, 0m);
var book = new BookInfo(Guid.NewGuid(), "界面会话测试", AccountingRegime.SmallBusiness, "test", 2026, 10, 9, DateTimeOffset.UtcNow);
var snapshot = new LedgerSnapshot(0, book, [account], [], []);
var stores = new Dictionary<string, FakeStore>
{
    ["first"] = new(snapshot), ["broken"] = new(snapshot) { FailRead = true }, ["second"] = new(snapshot)
};
var backend = new DesktopBackend(path => stores[path], (_, _, _) => throw new NotSupportedException(),
    (_, _) => throw new NotSupportedException(), store => new FakeService(store), []);
using (var session = new LedgerSession(backend))
{
    session.Open("first");
    Check(session.IsOpen && session.Snapshot?.Book.Name == "界面会话测试", "会话读取实际store快照");
    try { session.Open("broken"); } catch (IOException) { }
    Check(session.IsOpen && stores["first"].Disposed == 0 && stores["broken"].Disposed == 1,
        "打开损坏账套失败时保留原会话并释放失败store");
    session.Open("second");
    Check(stores["first"].Disposed == 1 && stores["second"].Disposed == 0, "切换成功后只释放旧账套");
    session.Close(); Check(!session.IsOpen && stores["second"].Disposed == 1, "关闭账套释放store并清除界面快照");
}

var folder = Path.Combine(Path.GetTempPath(), "caiwu-ui-tests-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(folder);
try
{
    var file = Path.Combine(folder, "export.csv");
    CsvExporter.Write(file, ["摘要", "金额"], [new object?[] { "=HYPERLINK(\"https://invalid.example\")", 0.30m },
        new object?[] { "中文,\"引号\"\n第二行", 1234.50m }]);
    var bytes = File.ReadAllBytes(file); var text = File.ReadAllText(file);
    Check(bytes.Take(3).SequenceEqual(new byte[] { 0xEF, 0xBB, 0xBF }), "中文CSV带UTF-8 BOM");
    Check(text.Contains("\"'=HYPERLINK("), "摘要公式按文本导出，避免表格执行");
    Check(text.Contains("中文,\"\"引号\"\"\n第二行") && text.Contains(",1234.50"), "CSV保留逗号换行引号与独立金额格式");
}
finally { Directory.Delete(folder, true); }
Console.WriteLine($"Desktop presentation checks passed: {passed}");

sealed class FakeStore(LedgerSnapshot snapshot) : ILedgerStore
{
    public bool FailRead { get; init; }
    public int Disposed { get; private set; }
    public string DatabasePath => "fake-session-lifecycle-only";
    public LedgerSnapshot Read() => FailRead ? throw new IOException("测试损坏快照") : snapshot;
    public void CheckIntegrity() { }
    public void Write(LedgerSnapshot next, long expectedRevision) => throw new NotSupportedException();
    public void BackupTo(string destinationPath) => throw new NotSupportedException();
    public void Dispose() => Disposed++;
}
sealed class FakeService(ILedgerStore store) : ILedgerService
{
    public LedgerSnapshot GetSnapshot() => store.Read();
    public void SaveAccount(Account a, string o) => throw new NotSupportedException();
    public void DeleteAccount(string a, string o) => throw new NotSupportedException();
    public void SetOpeningBalances(IReadOnlyList<OpeningBalance> b, string o) => throw new NotSupportedException();
    public Voucher SaveDraft(VoucherDraft d, string o) => throw new NotSupportedException();
    public void DeleteDraft(Guid id, string o) => throw new NotSupportedException();
    public void Review(Guid id, string o) => throw new NotSupportedException();
    public void CancelReview(Guid id, string o) => throw new NotSupportedException();
    public void Post(Guid id, string o) => throw new NotSupportedException();
    public void CloseMonth(int m, string o) => throw new NotSupportedException();
    public IReadOnlyList<TrialBalanceRow> GetTrialBalance(DateOnly f, DateOnly t) => throw new NotSupportedException();
    public IReadOnlyList<LedgerEntryRow> GetLedger(string a, DateOnly f, DateOnly t) => throw new NotSupportedException();
}
