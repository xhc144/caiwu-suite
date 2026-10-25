using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Persistence.Sqlite;
using Microsoft.Data.Sqlite;

var directory = args.Length == 1 ? Path.GetFullPath(args[0]) : Path.Combine(Path.GetTempPath(), "caiwu-integration-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(directory);
var observations = new List<object>();
var assertions = 0;
void Equal<T>(T expected, T actual, string check)
{
    assertions++;
    if (!EqualityComparer<T>.Default.Equals(expected, actual))
        throw new InvalidOperationException($"{check}: expected {expected}, actual {actual}");
}
void True(bool condition, string check) => Equal(true, condition, check);
void Fails<T>(Action action, string check) where T : Exception
{
    assertions++;
    try { action(); }
    catch (T) { return; }
    throw new InvalidOperationException(check + ": expected " + typeof(T).Name);
}
string State(ILedgerStore store) => JsonSerializer.Serialize(store.Read());
void Rejected(ILedgerStore store, Action command, string check)
{
    var before = State(store);
    Fails<LedgerValidationException>(command, check);
    Equal(before, State(store), check + " leaves every DTO field and revision unchanged");
}
var jan1 = new DateOnly(2026, 1, 1);
var jan31 = new DateOnly(2026, 1, 31);
var feb1 = new DateOnly(2026, 2, 1);
VoucherDraft Draft(DateOnly date, string debit, string credit, decimal amount, string summary, int attachments = 0) =>
    new(null, date, "记", null, attachments, [new(debit, summary, amount, 0), new(credit, summary, 0, amount)]);

void CheckSample(LedgerService service, string capital, string income, string expense)
{
    var rows = service.GetTrialBalance(jan1, jan31);
    Equal(108800m, rows.Single(r => r.AccountCode == "1002").ClosingDebit, "bank closing debit");
    Equal(10000m, rows.Single(r => r.AccountCode == "1403").ClosingDebit, "materials closing debit");
    Equal(1200m, rows.Single(r => r.AccountCode == expense).ClosingDebit, "expense closing debit");
    Equal(20000m, rows.Single(r => r.AccountCode == income).ClosingCredit, "income closing credit");
    Equal(100000m, rows.Single(r => r.AccountCode == capital).ClosingCredit, "capital closing credit");
    Equal(31200m, rows.Where(r => r.IsLeaf).Sum(r => r.PeriodDebit), "period total debit");
    Equal(31200m, rows.Where(r => r.IsLeaf).Sum(r => r.PeriodCredit), "period total credit");
    Equal(120000m, rows.Where(r => r.IsLeaf).Sum(r => r.ClosingDebit), "closing total debit");
    Equal(120000m, rows.Where(r => r.IsLeaf).Sum(r => r.ClosingCredit), "closing total credit");
    var ledger = service.GetLedger("1002", jan1, jan31);
    Equal(4, ledger.Count, "bank detail rows including opening");
    Equal(100000m, ledger[0].RunningBalance, "opening detail");
    Equal(90000m, ledger[1].RunningBalance, "first detail");
    Equal(88800m, ledger[2].RunningBalance, "second detail");
    Equal(108800m, ledger[3].RunningBalance, "third detail");
    Equal("期初余额", ledger[0].Summary, "opening label");
    True(ledger[0].VoucherId is null && ledger[0].Date is null, "opening row has no voucher");
    foreach (var row in ledger.Skip(1))
    {
        var v = service.GetSnapshot().Vouchers.Single(v => v.Id == row.VoucherId);
        Equal(v.Date, row.Date!.Value, "drill-through date");
        Equal(v.Kind, row.VoucherKind, "drill-through kind");
        Equal(v.Number, row.VoucherNumber!.Value, "drill-through number");
        True(v.Lines.Any(l => l.AccountCode == "1002" && l.Summary == row.Summary && l.Debit == row.Debit && l.Credit == row.Credit), "drill-through exact bank line");
    }
}

foreach (var (regime, capital, income, expense) in new[]
{
    (AccountingRegime.Enterprise, "4001", "6001", "6602"),
    (AccountingRegime.SmallBusiness, "3001", "5001", "5602")
})
{
    var prefix = regime.ToString();
    var path = Path.Combine(directory, prefix + ".caiwu");
    var backupPath = Path.Combine(directory, prefix + ".backup");
    var restoredPath = Path.Combine(directory, prefix + ".restored.caiwu");
    var template = TemplateCatalog.Get(regime);
    var createdAt = new DateTimeOffset(2026, 1, 1, 9, 8, 7, TimeSpan.FromHours(8)).AddTicks(1234);
    var book = new BookInfo(Guid.NewGuid(), "组合核验" + regime, regime, template.Version, 2026, 1, 0, createdAt);
    string originalState;
    Guid[] voucherIds;

    using (var store = SqliteLedgerStore.Create(path, book, template.Accounts))
    {
        store.CheckIntegrity();
        Equal(0L, store.Read().Revision, "new book revision");
        Equal(book, store.Read().Book, "new book fields");
        var service = new LedgerService(store);
        service.SetOpeningBalances([new("1002", 100000m, 0), new(capital, 0, 100000m)], "期初员");
        var vouchers = new[]
        {
            service.SaveDraft(Draft(jan1, "1403", "1002", 10000m, "材料采购", 2), "制单员"),
            service.SaveDraft(Draft(new(2026, 1, 2), expense, "1002", 1200m, "管理费用", 1), "制单员"),
            service.SaveDraft(Draft(new(2026, 1, 3), "1002", income, 20000m, "销售收入", 3), "制单员")
        };
        voucherIds = vouchers.Select(v => v.Id).ToArray();
        Equal("1,2,3", string.Join(',', vouchers.Select(v => v.Number)), "three unique numbers");
        Equal(0m, service.GetTrialBalance(jan1, jan31).Sum(r => r.PeriodDebit), "drafts do not enter ledger");
        Rejected(store, () => service.CloseMonth(1, "结账员"), "drafts block closing");
        Rejected(store, () => service.Review(vouchers[0].Id, "制单员"), "same person cannot review");
        Rejected(store, () => service.SaveDraft(Draft(jan1, "1403", "1002", 1m, "重号") with { Number = 1 }, "制单员"), "explicit duplicate number");
        foreach (var v in vouchers) service.Review(v.Id, "审核员");
        Equal(0m, service.GetTrialBalance(jan1, jan31).Sum(r => r.PeriodDebit), "reviewed vouchers do not enter ledger");
        Rejected(store, () => service.CloseMonth(1, "结账员"), "reviewed vouchers block closing");
        foreach (var v in vouchers) service.Post(v.Id, "记账员");
        CheckSample(service, capital, income, expense);
        Equal(10L, service.GetSnapshot().Revision, "revision after openings and 3xsave/review/post");
        Rejected(store, () => service.Post(vouchers[0].Id, "记账员"), "repeat posting");
        Rejected(store, () => service.CancelReview(vouchers[0].Id, "审核员"), "posted reversal");
        Rejected(store, () => service.DeleteDraft(vouchers[0].Id, "制单员"), "posted deletion");
        Rejected(store, () => service.SetOpeningBalances([], "期初员"), "posted openings freeze");
        service.CloseMonth(1, "结账员");
        Equal(1, service.GetSnapshot().Book.ClosedThroughMonth, "January closed");
        Equal(11L, service.GetSnapshot().Revision, "closed revision");
        Equal(11, service.GetSnapshot().AuditEvents.Count, "one audit per successful command");
        Rejected(store, () => service.SaveDraft(Draft(jan1, "1403", "1002", 1m, "锁定月新增"), "制单员"), "closed period");
        store.CheckIntegrity();
        originalState = State(store);
        store.BackupTo(backupPath);
        Equal(originalState, State(store), "backup does not change live state");
        Fails<IOException>(() => store.BackupTo(path), "backup cannot overwrite source");
        Equal(originalState, State(store), "source survives rejected overwrite");
    }

    using (var reopened = SqliteLedgerStore.Open(path))
    {
        Equal(originalState, State(reopened), "all DTO fields/list ordering after close and reopen");
        Equal(createdAt, reopened.Read().Book.CreatedAt, "timestamp offset and ticks");
        CheckSample(new(reopened), capital, income, expense);
    }
    SqliteLedgerStore.RestoreBackup(backupPath, restoredPath);
    using (var backup = SqliteLedgerStore.Open(backupPath))
    using (var restored = SqliteLedgerStore.Open(restoredPath))
    {
        Equal(originalState, State(backup), "backup state");
        Equal(originalState, State(restored), "restored state");
        var service = new LedgerService(restored);
        CheckSample(service, capital, income, expense);
        Rejected(restored, () => service.SaveDraft(Draft(feb1, "1403", "1002", 1m, "改历史") with { Id = voucherIds[0] }, "制单员"), "restored history stays immutable");
        var future = service.SaveDraft(Draft(feb1, "1403", "1002", 20m, "恢复副本的新草稿"), "制单员");
        Equal(1, future.Number, "restored future month number starts at one");
        Equal(12L, restored.Read().Revision, "restored copy can advance independently");
        Equal(originalState, State(backup), "restored changes do not affect backup");
        using var original = SqliteLedgerStore.Open(path);
        Equal(originalState, State(original), "restored changes do not affect original");
        CheckSample(service, capital, income, expense);
    }

    // Independent SQL checks compare literal integer cents, rather than another Core calculation.
    using (var raw = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Mode = SqliteOpenMode.ReadOnly, Pooling = false }.ToString()))
    {
        raw.Open();
        object Scalar(string sql) { using var c = raw.CreateCommand(); c.CommandText = sql; return c.ExecuteScalar()!; }
        Equal(10000000L, (long)Scalar("SELECT opening_debit_cents FROM accounts WHERE code='1002'"), "raw bank opening cents");
        Equal("integer", (string)Scalar("SELECT typeof(opening_debit_cents) FROM accounts WHERE code='1002'"), "raw cents type");
        Equal(3120000L, (long)Scalar("SELECT sum(debit_cents) FROM voucher_lines"), "raw period debit cents");
        Equal(3120000L, (long)Scalar("SELECT sum(credit_cents) FROM voucher_lines"), "raw period credit cents");
        Equal(3L, (long)Scalar("SELECT count(*) FROM vouchers WHERE status=2 AND prepared_by='制单员' AND reviewed_by='审核员'"), "raw posted statuses and distinct actors");
        Equal(6L, (long)Scalar("SELECT count(*) FROM voucher_lines"), "raw line count");
        Equal(11L, (long)Scalar("SELECT count(*) FROM audit_events"), "raw audit count");
        Equal("ok", (string)Scalar("PRAGMA integrity_check"), "raw integrity check");
        observations.Add(new { scenario = prefix + " full lifecycle", revision = 11, bank = 108800m, periodDebit = 31200m, periodCredit = 31200m, closingDebit = 120000m, closingCredit = 120000m, sqlite = (string)Scalar("SELECT sqlite_version()") });
    }
}

// A small exact-decimal and hierarchy round trip using real SQLite, not the memory double.
var hierarchyPath = Path.Combine(directory, "hierarchy.caiwu");
var hierarchyBook = new BookInfo(Guid.NewGuid(), "层级精度", AccountingRegime.Enterprise, TemplateCatalog.Get(AccountingRegime.Enterprise).Version, 2026, 1, 0, DateTimeOffset.UtcNow);
using (var store = SqliteLedgerStore.Create(hierarchyPath, hierarchyBook, TemplateCatalog.Get(AccountingRegime.Enterprise).Accounts))
{
    var s = new LedgerService(store);
    s.SaveAccount(new("100201", "银行明细", "1002", BalanceDirection.Debit, true, 0, 0), "科目员");
    s.SetOpeningBalances([new("100201", 1m, 0), new("4001", 0, 1m)], "期初员");
    var v = s.SaveDraft(new(null, jan1, "记", null, 0,
        [new("1403", "一角", 0.1m, 0), new("1403", "两角", 0.2m, 0), new("100201", "三角", 0, 0.3m)]), "制单员");
    s.Review(v.Id, "审核员");
    s.Post(v.Id, "记账员");
}
using (var store = SqliteLedgerStore.Open(hierarchyPath))
{
    var s = new LedgerService(store);
    var rows = s.GetTrialBalance(jan1, jan31);
    Equal(0.7m, rows.Single(r => r.AccountCode == "1002").ClosingDebit, "parent exact 0.7");
    Equal(0.7m, rows.Single(r => r.AccountCode == "100201").ClosingDebit, "leaf exact 0.7");
    Equal(0.3m, rows.Single(r => r.AccountCode == "1403").ClosingDebit, "0.1+0.2 is 0.3");
    Equal(0.3m, rows.Where(r => r.IsLeaf).Sum(r => r.PeriodDebit), "leaf total avoids parent double count");
    Equal(2, s.GetLedger("1002", jan1, jan31).Count, "parent detail line count");
    Equal(0.7m, s.GetLedger("1002", jan1, jan31)[1].RunningBalance, "parent drill-through running balance");
    observations.Add(new { scenario = "decimal and hierarchy reopen", bank = 0.7m, materials = 0.3m });
}

// Force a real SQLite failure after snapshot deletion/insertion has started; require full rollback.
var transactionalPath = Path.Combine(directory, "Enterprise.restored.caiwu");
using (var store = SqliteLedgerStore.Open(transactionalPath))
{
    var before = State(store);
    using var raw = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = transactionalPath, Mode = SqliteOpenMode.ReadWrite, Pooling = false }.ToString());
    raw.Open();
    void Execute(string sql) { using var c = raw.CreateCommand(); c.CommandText = sql; c.ExecuteNonQuery(); }
    Execute("CREATE TRIGGER probe_reject_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'probe injected audit failure'); END;");
    Fails<SqliteException>(() => new LedgerService(store).SaveDraft(Draft(feb1, "1403", "1002", 1m, "回滚注入"), "制单员"), "real SQLite audit insert failure propagates");
    Equal(before, State(store), "real SQLite failure rolls back revision, book, accounts, vouchers, lines and audit");
    Execute("DROP TRIGGER probe_reject_audit;");
    store.CheckIntegrity();
    observations.Add(new { scenario = "real SQLite rollback on audit failure", revision = store.Read().Revision, preserved = true });
}

// Both Core services read the same real revision before contending on independent SQLite handles.
using (var first = SqliteLedgerStore.Open(transactionalPath))
using (var second = SqliteLedgerStore.Open(transactionalPath))
using (var barrier = new Barrier(2))
{
    var expected = first.Read().Revision;
    var tasks = new[] { first, second }.Select((actual, index) => Task.Run<Exception?>(() =>
    {
        using var wrapper = new ReadBarrierStore(actual, barrier);
        try { new LedgerService(wrapper).SaveDraft(Draft(feb1, "1403", "1002", 1m, "真实并发"), "制单" + index); return null; }
        catch (Exception error) { return error; }
    })).ToArray();
    var errors = await Task.WhenAll(tasks);
    Equal(1, errors.Count(e => e is null), "one SQLite service race succeeds");
    Equal(1, errors.Count(e => e is StoreConcurrencyException), "one SQLite service race reports stale revision");
    Equal(expected + 1, first.Read().Revision, "race increments once");
    Equal("1,2", string.Join(',', first.Read().Vouchers.Where(v => v.Date == feb1).OrderBy(v => v.Number).Select(v => v.Number)), "race cannot duplicate month numbers");
    first.CheckIntegrity();
    observations.Add(new { scenario = "two real SQLite stores and two Core services", succeeded = 1, staleRevisionRejected = 1, revision = first.Read().Revision });
}

var result = new { result = "PASS", assertions, dataDirectory = directory, observations };
var json = JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true });
File.WriteAllText(Path.Combine(directory, "result.json"), json);
Console.WriteLine(json);

sealed class ReadBarrierStore(ILedgerStore actual, Barrier barrier) : ILedgerStore
{
    public string DatabasePath => actual.DatabasePath;
    public LedgerSnapshot Read()
    {
        var captured = actual.Read();
        if (!barrier.SignalAndWait(TimeSpan.FromSeconds(15))) throw new TimeoutException("probe read barrier timed out");
        return captured;
    }
    public void Write(LedgerSnapshot next, long expectedRevision) => actual.Write(next, expectedRevision);
    public void BackupTo(string destinationPath) => actual.BackupTo(destinationPath);
    public void CheckIntegrity() => actual.CheckIntegrity();
    public void Dispose() { } // The probe's outer scope owns the real stores.
}
