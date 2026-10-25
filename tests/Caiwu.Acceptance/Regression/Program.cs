using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Desktop.Presentation;
using Caiwu.Persistence.Sqlite;
using Microsoft.Data.Sqlite;

var output = args.Length > 0 ? Path.GetFullPath(args[0]) : Path.GetFullPath("tests/Caiwu.Acceptance/evidence/regression-037a075.json");
var folder = Path.Combine(Path.GetTempPath(), "caiwu-independent-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(folder);
var results = new List<object>();
var passed = 0; var failed = 0;
var backend = new DesktopBackend(SqliteLedgerStore.Open, SqliteLedgerStore.Create,
    SqliteLedgerStore.RestoreBackup, s => new LedgerService(s), TemplateCatalog.All);
var testCulture = CultureInfo.GetCultureInfo("zh-CN");
CultureInfo.CurrentCulture = testCulture;
CultureInfo.CurrentUICulture = testCulture;
void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }
void Case(string id, string name, Action test)
{
    try { test(); passed++; results.Add(new { id, name, status = "PASS" }); Console.WriteLine($"PASS {id} {name}"); }
    catch (Exception e) { failed++; results.Add(new { id, name, status = "FAIL", exception = e.GetType().FullName, detail = e.Message }); Console.WriteLine($"FAIL {id} {name}: {e.GetType().Name}: {e.Message}"); }
}
T Reject<T>(Action operation) where T : Exception
{
    try { operation(); } catch (T e) { return e; }
    throw new Exception("Expected rejection " + typeof(T).Name + "; operation succeeded.");
}
string PathFor(string name) => Path.Combine(folder, name);
BookInfo Book(string name, int month = 10) => new(Guid.NewGuid(), name, AccountingRegime.SmallBusiness,
    "independent-test", 2026, month, month - 1, DateTimeOffset.UtcNow);
Account[] Accounts() => [new("1001", "现金", null, BalanceDirection.Debit, true, 0, 0),
    new("1002", "银行", null, BalanceDirection.Debit, true, 0, 0),
    new("3001", "资本", null, BalanceDirection.Credit, true, 0, 0)];
SqliteLedgerStore NewStore(string name) => SqliteLedgerStore.Create(PathFor(name + ".caiwu"), Book(name), Accounts());
VoucherDraft Draft(decimal amount = 11.23m, Guid? id = null, string summary = "独立录入") => new(id, new(2026, 10, 9), "记", null, 0,
    [new("1002", summary, amount, 0), new("3001", summary, 0, amount)]);
void Unchanged(ILedgerStore s, Action action)
{
    var before = JsonSerializer.Serialize(s.Read());
    Reject<LedgerValidationException>(action);
    Assert(JsonSerializer.Serialize(s.Read()) == before, "Rejected command changed persisted snapshot or audit/revision.");
}
try
{
    Case("FLOW-01", "Create, opening, draft, distinct reviewer, post, reopen and exact balances", () =>
    {
        var p = PathFor("flow.caiwu"); Guid id;
        using (var s = SqliteLedgerStore.Create(p, Book("流程"), Accounts()))
        {
            var service = new LedgerService(s);
            service.SetOpeningBalances([new("1002", 100.01m, 0), new("3001", 0, 100.01m)], "甲");
            var v = service.SaveDraft(Draft(), "甲"); id = v.Id;
            Assert(service.GetTrialBalance(new(2026, 10, 1), new(2026, 10, 31)).Single(r => r.AccountCode == "1002").ClosingDebit == 100.01m, "Draft affected ledger.");
            Unchanged(s, () => service.Review(id, "甲"));
            service.Review(id, "乙");
            Assert(service.GetLedger("1002", new(2026, 10, 1), new(2026, 10, 31)).Count == 1, "Reviewed voucher affected ledger.");
            service.Post(id, "乙");
        }
        using var reopened = SqliteLedgerStore.Open(p); var actual = new LedgerService(reopened);
        Assert(actual.GetSnapshot().Vouchers.Single().Id == id && actual.GetSnapshot().Vouchers.Single().Status == VoucherStatus.Posted, "Posting was not durable.");
        var ledger = actual.GetLedger("1002", new(2026, 10, 1), new(2026, 10, 31));
        Assert(ledger.Count == 2 && ledger[^1].RunningBalance == 111.24m && ledger[^1].VoucherId == id, "Ledger value/trace mismatch.");
        Assert(actual.GetTrialBalance(new(2026, 10, 1), new(2026, 10, 31)).Single(r => r.AccountCode == "1002").ClosingDebit == 111.24m, "Trial mismatch.");
    });
    Case("IMMUTABLE-01", "Posted edits/delete/cancel/repeat post reject without additional audit/revision", () =>
    {
        using var s = NewStore("immutable"); var service = new LedgerService(s);
        var v = service.SaveDraft(Draft(), "甲"); service.Review(v.Id, "乙"); service.Post(v.Id, "乙");
        Unchanged(s, () => service.SaveDraft(Draft(12m, v.Id), "甲"));
        Unchanged(s, () => service.DeleteDraft(v.Id, "甲"));
        Unchanged(s, () => service.CancelReview(v.Id, "乙"));
        Unchanged(s, () => service.Post(v.Id, "乙"));
    });
    Case("LOCK-01", "Close month durably locks every voucher mutation and opening", () =>
    {
        var p = PathFor("lock.caiwu");
        using (var s = SqliteLedgerStore.Create(p, Book("锁期"), Accounts()))
        {
            var service = new LedgerService(s); service.CloseMonth(10, "乙");
        }
        using var reopened = SqliteLedgerStore.Open(p); var actual = new LedgerService(reopened);
        Assert(actual.GetSnapshot().Book.ClosedThroughMonth == 10, "Lock missing after reopen.");
        Unchanged(reopened, () => actual.SaveDraft(Draft(), "甲"));
        Unchanged(reopened, () => actual.SetOpeningBalances([], "甲"));
        Unchanged(reopened, () => actual.CloseMonth(10, "甲"));
        Unchanged(reopened, () => actual.CloseMonth(12, "甲"));
        actual.SaveDraft(Draft() with { Date = new(2026, 11, 1) }, "甲");
    });
    Case("LOCK-02", "Unposted voucher prevents close and does not mutate the book", () =>
    {
        using var s = NewStore("unposted"); var service = new LedgerService(s); service.SaveDraft(Draft(), "甲");
        Unchanged(s, () => service.CloseMonth(10, "乙"));
    });
    Case("INPUT-01", "Invalid draft leaves all persisted data unchanged", () =>
    {
        using var s = NewStore("invalid"); var service = new LedgerService(s);
        Unchanged(s, () => service.SaveDraft(Draft(1.001m), "甲"));
        Unchanged(s, () => service.SaveDraft(Draft(-1m), "甲"));
        Unchanged(s, () => service.SaveDraft(Draft() with { Lines = [new("1002", "银行", 10, 0), new("3001", "资本", 0, 9)] }, "甲"));
        Unchanged(s, () => service.SaveDraft(Draft() with { Date = new(2025, 10, 9) }, "甲"));
        Unchanged(s, () => service.SaveDraft(Draft() with { Lines = [new("9999", "不存在", 10, 0), new("3001", "资本", 0, 10)] }, "甲"));
    });
    Case("BACKUP-01", "Backup/restore exact snapshot and independent subsequent writes", () =>
    {
        using var s = NewStore("backup"); var service = new LedgerService(s); service.SaveDraft(Draft(), "甲");
        var backup = PathFor("backup.caiwubak"); var restored = PathFor("restored.caiwu");
        var expected = JsonSerializer.Serialize(s.Read()); s.BackupTo(backup); SqliteLedgerStore.RestoreBackup(backup, restored);
        using var copy = SqliteLedgerStore.Open(restored);
        Assert(JsonSerializer.Serialize(copy.Read()) == expected, "Restored snapshot differs.");
        service.SaveDraft(Draft(22m), "甲"); Assert(JsonSerializer.Serialize(copy.Read()) == expected, "Restored book shared mutable state.");
    });
    Case("BACKUP-02", "Backup/restore cannot overwrite existing destinations", () =>
    {
        using var s = NewStore("backup-no-overwrite"); var path = PathFor("sentinel.txt"); File.WriteAllText(path, "keep");
        Reject<IOException>(() => s.BackupTo(path));
        Reject<IOException>(() => SqliteLedgerStore.RestoreBackup(s.DatabasePath, path));
        Assert(File.ReadAllText(path) == "keep", "Existing file changed.");
    });
    Case("RESTORE-01", "Corrupt backup leaves current session and destination unchanged", () =>
    {
        using var session = new LedgerSession(backend); session.Create(PathFor("restore-source.caiwu"), Book("源"), Accounts());
        var id = session.Snapshot!.Book.Id; var corrupt = PathFor("bad.caiwubak"); File.WriteAllText(corrupt, "not sqlite");
        var destination = PathFor("bad-restored.caiwu");
        try { session.RestoreTo(corrupt, destination); throw new Exception("Corrupt restore succeeded."); }
        catch (SqliteException) { }
        Assert(!File.Exists(destination) && session.Snapshot.Book.Id == id && session.IsOpen, "Restore failure changed state.");
    });
    Case("SESSION-01", "Real session switch isolates account books and rejects corrupt open", () =>
    {
        using var session = new LedgerSession(backend);
        var a = PathFor("session-a.caiwu"); var b = PathFor("session-b.caiwu");
        session.Create(a, Book("A"), Accounts()); session.Service!.SaveDraft(Draft(), "甲"); session.Refresh();
        var idA = session.Snapshot!.Book.Id; session.Create(b, Book("B"), Accounts());
        Assert(session.Snapshot!.Vouchers.Count == 0 && session.Snapshot.Book.Id != idA, "A data leaked to B.");
        session.Service!.SaveDraft(Draft(88m), "乙"); session.Open(a);
        Assert(session.Snapshot!.Book.Id == idA && session.Snapshot.Vouchers.Single().Lines[0].Debit == 11.23m, "B overwrote A.");
        var bad = PathFor("bad-open.caiwu"); File.WriteAllText(bad, "bad");
        try { session.Open(bad); throw new Exception("Bad open succeeded."); } catch (SqliteException) { }
        Assert(session.Snapshot.Book.Id == idA && session.IsOpen, "Failed open discarded A.");
        session.Close(); Assert(!session.IsOpen && session.Snapshot is null && session.Service is null, "Close retained session.");
    });
    Case("STORE-CAS-01", "Low-level stale revision rejected without mutation", () =>
    {
        using var s1 = NewStore("cas"); using var s2 = SqliteLedgerStore.Open(s1.DatabasePath);
        var stale = s1.Read(); new LedgerService(s2).SaveDraft(Draft(), "甲"); var latest = JsonSerializer.Serialize(s2.Read());
        Reject<StoreConcurrencyException>(() => s1.Write(stale with { Revision = stale.Revision + 1 }, stale.Revision));
        Assert(JsonSerializer.Serialize(s2.Read()) == latest, "Stale CAS changed data.");
    });
    Case("ACC-002", "Stale draft from second editor must reject instead of silently overwriting newer draft", () =>
    {
        using var s1 = NewStore("stale-editor"); var one = new LedgerService(s1);
        var saved = one.SaveDraft(Draft(10m), "甲");
        using var s2 = SqliteLedgerStore.Open(s1.DatabasePath); var two = new LedgerService(s2);
        var oldEditor = two.GetSnapshot().Vouchers.Single();
        one.SaveDraft(Draft(20m, saved.Id, "另一窗口新值"), "甲");
        var latest = JsonSerializer.Serialize(s1.Read());
        try { two.SaveDraft(new(oldEditor.Id, oldEditor.Date, oldEditor.Kind, oldEditor.Number, oldEditor.AttachmentCount, oldEditor.Lines), "甲"); }
        catch (StoreConcurrencyException) { Assert(JsonSerializer.Serialize(s1.Read()) == latest, "Rejected edit mutated data."); return; }
        throw new Exception($"Stale editor overwrote amount 20.00 with {s1.Read().Vouchers.Single().Lines[0].Debit:0.00}; current revision {s1.Read().Revision}. No conflict was raised.");
    });
    Case("ACC-003", "Opening grid can save all visible zero rows after disabling an unused leaf", () =>
    {
        using var s = NewStore("inactive-opening"); var service = new LedgerService(s);
        service.SaveAccount(s.Read().Accounts.Single(a => a.Code == "1001") with { IsActive = false }, "甲");
        var snapshot = service.GetSnapshot();
        var visibleRows = snapshot.Accounts.Where(a => !snapshot.Accounts.Any(child => child.ParentCode == a.Code)).Select(a => new OpeningBalanceEdit(a)).ToArray();
        visibleRows.Single(r => r.Code == "1002").DebitText = "100.01";
        visibleRows.Single(r => r.Code == "3001").CreditText = "100.01";
        service.SetOpeningBalances(visibleRows.Select(r => r.ToBalance()).ToArray(), "甲");
        Assert(service.GetSnapshot().Accounts.Single(a => a.Code == "1002").OpeningDebit == 100.01m, "Opening was not saved.");
    });
    Case("AMOUNT-01", "Chinese culture accepts valid decimal/grouping and rejects unsupported negative/exponent/precision", () =>
    {
        Assert(AmountInput.Parse("1,234.56", "金额") == 1234.56m && AmountInput.Parse("0.01", "金额") == 0.01m, "Valid amount rejected.");
        foreach (var text in new[] { "1.001", "-1", "1e4", "不是金额" }) Reject<LedgerValidationException>(() => AmountInput.Parse(text, "金额"));
    });
    Case("ACC-004", "Malformed thousands grouping must reject instead of silently increasing monetary value", () =>
    {
        var accepted = new List<string>();
        foreach (var text in new[] { "1,23", "1,,2", "12,34.56", "100,00" })
        {
            try { accepted.Add(text + " => " + AmountInput.Parse(text, "金额").ToString("0.00", CultureInfo.InvariantCulture)); }
            catch (LedgerValidationException) { }
        }
        Assert(accepted.Count == 0, "Malformed values accepted: " + string.Join("; ", accepted));
    });
    Case("REPEAT-01", "Duplicate review on same ID rejects and adds no audit/revision", () =>
    {
        using var s = NewStore("review-repeat"); var service = new LedgerService(s); var v = service.SaveDraft(Draft(), "甲");
        service.Review(v.Id, "乙"); Unchanged(s, () => service.Review(v.Id, "乙"));
    });
    Case("STALE-POSTED-01", "Stale draft cannot overwrite a voucher posted by another session", () =>
    {
        using var s1 = NewStore("stale-posted"); var one = new LedgerService(s1); var v = one.SaveDraft(Draft(), "甲");
        using var s2 = SqliteLedgerStore.Open(s1.DatabasePath); var two = new LedgerService(s2);
        one.Review(v.Id, "乙"); one.Post(v.Id, "乙"); Unchanged(s2, () => two.SaveDraft(Draft(77m, v.Id), "甲"));
    });
    Case("ACC-005", "Actual SQLite busy save exception matches voucher editor's error-preserving catch filter", () =>
    {
        using var s = NewStore("busy"); var service = new LedgerService(s);
        using var blocker = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = s.DatabasePath, Pooling = false }.ToString());
        blocker.Open(); using var transaction = blocker.BeginTransaction(deferred: false);
        Exception? failure = null;
        try { service.SaveDraft(Draft(), "甲"); } catch (Exception e) { failure = e; }
        transaction.Rollback();
        Assert(failure is not null, "Busy writer unexpectedly succeeded.");
        // Exact filter from VoucherEditorWindow.Save at target commit, not a proposed replacement.
        var handled = failure is LedgerValidationException or StoreConcurrencyException or ArgumentException
            or InvalidOperationException or OverflowException or IOException;
        Assert(handled, $"Actual save threw {failure!.GetType().FullName} ({failure.Message}), excluded by VoucherEditorWindow.Save filter. WPF crash/lost input itself not executed on Linux.");
    });
    Case("TEMPLATES-01", "Every actual template supports initial opening and saving a one-cent voucher", () =>
    {
        foreach (var template in TemplateCatalog.All)
        {
            var b = Book(template.Id, 12) with { Regime = template.Regime, TemplateVersion = template.Version };
            using var s = SqliteLedgerStore.Create(PathFor(template.Id + ".caiwu"), b, template.Accounts); var service = new LedgerService(s);
            service.SetOpeningBalances([], "甲");
            var credit = template.Accounts.First(a => a.Direction == BalanceDirection.Credit && !template.Accounts.Any(c => c.ParentCode == a.Code));
            service.SaveDraft(new(null, new(2026, 12, 1), "记", null, 0, [new("1002", "一分", .01m, 0), new(credit.Code, "一分", 0, .01m)]), "甲");
        }
    });
}
finally
{
    Directory.CreateDirectory(Path.GetDirectoryName(output)!);
    File.WriteAllText(output, JsonSerializer.Serialize(new
    {
        baselineCommit = "037a07585078d4dfcd443a2cc4a237c88aed07a0",
        checkoutCommit = Environment.GetEnvironmentVariable("CAIWU_ACCEPTANCE_CHECKOUT_COMMIT") ?? "not supplied",
        productionSourceTree = Environment.GetEnvironmentVariable("CAIWU_ACCEPTANCE_SOURCE_TREE") ?? "not supplied",
        observedAtUtc = DateTimeOffset.UtcNow,
        environment = new { os = System.Runtime.InteropServices.RuntimeInformation.OSDescription,
            framework = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription, culture = testCulture.Name,
            actualCoreAndSqlite = true, actualDesktopDataModels = true, wpfExecuted = false },
        passed, failed, results
    }, new JsonSerializerOptions { WriteIndented = true }));
    Directory.Delete(folder, true);
}
Console.WriteLine($"Independent regression: passed={passed}, failed={failed}; output={output}");
return failed == 0 ? 0 : 1;
