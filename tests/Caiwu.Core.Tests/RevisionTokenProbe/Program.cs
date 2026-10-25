using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Persistence.Sqlite;

var directory = Path.Combine(Path.GetTempPath(), "caiwu-acc002-token-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(directory);
var results = new List<object>();
var passed = 0; var failed = 0;
void Assert(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
void Case(string id, Action test)
{
    try { test(); passed++; results.Add(new { id, status = "PASS" }); Console.WriteLine("PASS " + id); }
    catch (Exception error) { failed++; results.Add(new { id, status = "FAIL", detail = error.Message }); Console.WriteLine("FAIL " + id + ": " + error.Message); }
}
SqliteLedgerStore NewStore(string name) => SqliteLedgerStore.Create(Path.Combine(directory, name + ".caiwu"),
    new(Guid.NewGuid(), name, AccountingRegime.Enterprise, "acc002-token-test", 2026, 1, 0, DateTimeOffset.UtcNow),
    [new("1002", "银行", null, BalanceDirection.Debit, true, 0, 0), new("4001", "资本", null, BalanceDirection.Credit, true, 0, 0)]);
VoucherDraft Draft(decimal amount = 10) => new(null, new(2026, 1, 1), "记", null, 0,
    [new("1002", "独立输入", amount, 0), new("4001", "独立输入", 0, amount)]);
VoucherDraft From(LedgerSnapshot loaded, decimal amount) => Draft(amount) with
{
    Id = loaded.Vouchers.Single().Id,
    Number = loaded.Vouchers.Single().Number,
    ExpectedRevision = loaded.Revision,
    ExpectedBookId = loaded.Book.Id
};
VoucherDraft At(LedgerSnapshot shown, VoucherDraft input) => input with
{ ExpectedBookId = shown.Book.Id, ExpectedRevision = shown.Revision };
string State(ILedgerStore s) => JsonSerializer.Serialize(s.Read());
void MustConflict(ILedgerStore s, Action action)
{
    var original = State(s);
    try { action(); }
    catch (StoreConcurrencyException)
    {
        Assert(original == State(s), "Conflict changed durable values/audit/revision.");
        return;
    }
    throw new InvalidOperationException("Expected StoreConcurrencyException, but save succeeded; amount=" + s.Read().Vouchers.Single().Lines[0].Debit + ", revision=" + s.Read().Revision);
}

try
{
    Case("ACC002-FRESH", () =>
    {
        using var store = NewStore("fresh"); var s = new LedgerService(store);
        s.SaveDraft(At(s.GetSnapshot(), Draft()), "A"); var loaded = s.GetSnapshot();
        s.SaveDraft(From(loaded, 20), "A");
        Assert(store.Read().Vouchers.Single().Lines[0].Debit == 20m && store.Read().Revision == 2, "Fresh token did not save20 exactly once.");
    });
    Case("ACC002-TWO-CONNECTIONS-STALE", () =>
    {
        using var oneStore = NewStore("stale"); var one = new LedgerService(oneStore); one.SaveDraft(At(one.GetSnapshot(), Draft()), "A");
        using var twoStore = SqliteLedgerStore.Open(oneStore.DatabasePath); var two = new LedgerService(twoStore);
        // These snapshots and drafts are captured before A commits its new value.
        var documentA = one.GetSnapshot(); var documentB = two.GetSnapshot();
        var oldVoucherB = documentB.Vouchers.Single();
        var staleInputB = new VoucherDraft(oldVoucherB.Id, oldVoucherB.Date, oldVoucherB.Kind, oldVoucherB.Number,
            oldVoucherB.AttachmentCount, oldVoucherB.Lines, documentB.Revision, documentB.Book.Id);
        one.SaveDraft(From(documentA, 20m), "A");
        Assert(oneStore.Read().Vouchers.Single().Lines[0].Debit == 20m, "WriterA did not save20.");
        MustConflict(twoStore, () => two.SaveDraft(staleInputB, "B"));
        Assert(oneStore.Read().Vouchers.Single().Lines[0].Debit == 20m, "Stale window overwrote20.");
    });
    Case("ACC002-MISSING", () =>
    {
        using var store = NewStore("missing"); var s = new LedgerService(store); s.SaveDraft(At(s.GetSnapshot(), Draft()), "A");
        var input = From(s.GetSnapshot(), 20) with { ExpectedRevision = null };
        MustConflict(store, () => s.SaveDraft(input, "B"));
    });
    Case("ACC002-FUTURE", () =>
    {
        using var store = NewStore("future"); var s = new LedgerService(store); s.SaveDraft(At(s.GetSnapshot(), Draft()), "A");
        var loaded = s.GetSnapshot(); var input = From(loaded, 20) with { ExpectedRevision = loaded.Revision + 1 };
        MustConflict(store, () => s.SaveDraft(input, "B"));
    });
    Case("ACC002-NEGATIVE", () =>
    {
        using var store = NewStore("negative"); var s = new LedgerService(store); s.SaveDraft(At(s.GetSnapshot(), Draft()), "A");
        var input = From(s.GetSnapshot(), 20) with { ExpectedRevision = -1 };
        MustConflict(store, () => s.SaveDraft(input, "B"));
    });
    Case("ACC002-ACCEPTED-VERSION-SECOND-SAVE", () =>
    {
        using var store = NewStore("second-save"); var s = new LedgerService(store); s.SaveDraft(At(s.GetSnapshot(), Draft()), "A");
        var loaded = s.GetSnapshot();
        var edit = From(loaded, 20); s.SaveDraft(edit, "A");
        // Carry only the accepted version+1 after success; never read a fresh token for old input.
        s.SaveDraft(edit with { ExpectedRevision = edit.ExpectedRevision + 1, Lines = Draft(30).Lines }, "A");
        Assert(store.Read().Revision == 3 && store.Read().Vouchers.Single().Lines[0].Debit == 30m, "Second legitimate save failed.");
    });
    Case("V12-LEGACY-NEW-REJECTED", () =>
    {
        using var store = NewStore("legacy-new"); var s = new LedgerService(store);
        MustConflict(store, () => s.SaveDraft(Draft(), "A"));
        Assert(store.Read().Revision == 0 && store.Read().Vouchers.Count == 0, "Missing new-draft context changed state.");
    });
    Case("ACC002-NEW-CORRECT", () =>
    {
        using var store = NewStore("new-correct"); var s = new LedgerService(store);
        var opened = s.GetSnapshot();
        s.SaveDraft(Draft() with { ExpectedRevision = opened.Revision, ExpectedBookId = opened.Book.Id }, "A");
        Assert(store.Read().Revision == 1, "Correct new-draft token failed.");
    });
    Case("ACC002-NEW-WRONG", () =>
    {
        using var store = NewStore("new-wrong"); var s = new LedgerService(store);
        var opened = s.GetSnapshot();
        MustConflict(store, () => s.SaveDraft(Draft() with { ExpectedRevision = opened.Revision + 1, ExpectedBookId = opened.Book.Id }, "A"));
    });
    Case("ACC002-STORE-CAS-AFTER-READ", () =>
    {
        using var oneStore = NewStore("read-write-gap"); new LedgerService(oneStore).SaveDraft(At(oneStore.Read(), Draft()), "A");
        var opened = oneStore.Read();
        using var twoStore = SqliteLedgerStore.Open(oneStore.DatabasePath);
        var two = new LedgerService(twoStore);
        var hooked = new ReadHookStore(oneStore, () => two.SaveDraft(From(two.GetSnapshot(), 20m), "B"));
        var one = new LedgerService(hooked);
        try { one.SaveDraft(From(opened, 10m), "A"); }
        catch (StoreConcurrencyException)
        {
            Assert(oneStore.Read().Revision == 2 && oneStore.Read().AuditEvents.Count == 2 &&
                oneStore.Read().Vouchers.Single().Lines[0].Debit == 20m, "CAS failure lost the competing writer or added audit.");
            return;
        }
        throw new InvalidOperationException("Read/Write gap did not retain store CAS.");
    });
    Case("ACC002-MISSING-BOOK", () =>
    {
        using var store = NewStore("missing-book"); var s = new LedgerService(store); s.SaveDraft(At(s.GetSnapshot(), Draft()), "A");
        var input = From(s.GetSnapshot(), 20) with { ExpectedBookId = null };
        MustConflict(store, () => s.SaveDraft(input, "A"));
    });
    Case("ACC002-OTHER-BOOK-SAME-REVISION", () =>
    {
        using var target = NewStore("target-book"); var one = new LedgerService(target); one.SaveDraft(At(one.GetSnapshot(), Draft()), "A");
        using var unrelated = NewStore("unrelated-book"); var two = new LedgerService(unrelated); two.SaveDraft(At(two.GetSnapshot(), Draft()), "B");
        var targetLoaded = one.GetSnapshot(); var otherLoaded = two.GetSnapshot();
        Assert(targetLoaded.Revision == otherLoaded.Revision && targetLoaded.Book.Id != otherLoaded.Book.Id, "Invalid same-revision cross-book setup.");
        var input = From(targetLoaded, 20) with { ExpectedRevision = otherLoaded.Revision, ExpectedBookId = otherLoaded.Book.Id };
        MustConflict(target, () => one.SaveDraft(input, "A"));
    });
    Case("ACC002-NEW-WRONG-BOOK", () =>
    {
        using var store = NewStore("new-wrong-book"); var s = new LedgerService(store); var opened = s.GetSnapshot();
        MustConflict(store, () => s.SaveDraft(Draft() with { ExpectedRevision = opened.Revision, ExpectedBookId = Guid.NewGuid() }, "A"));
    });
}
finally
{
    var report = new
    {
        targetCommit = Environment.GetEnvironmentVariable("CAIWU_TOKEN_TARGET_COMMIT") ?? "not supplied",
        actualCoreAndTwoSqliteConnections = true,
        expectedRevisionCapturedAtLoad = true,
        bookIdentityFieldPresent = typeof(VoucherDraft).GetProperty("ExpectedBookId") is not null || typeof(VoucherDraft).GetProperty("EditToken") is not null,
        wpfExecuted = false,
        passed, failed, results
    };
    File.WriteAllText(args[0], JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
    Directory.Delete(directory, true);
}
Console.WriteLine($"ACC002 focused: passed={passed}, failed={failed}");
return failed == 0 ? 0 : 1;

sealed class ReadHookStore(ILedgerStore actual, Action afterFirstRead) : ILedgerStore
{
    private bool fired;
    public string DatabasePath => actual.DatabasePath;
    public LedgerSnapshot Read()
    {
        var captured = actual.Read();
        if (!fired) { fired = true; afterFirstRead(); }
        return captured;
    }
    public void Write(LedgerSnapshot next, long expectedRevision) => actual.Write(next, expectedRevision);
    public void BackupTo(string destinationPath) => actual.BackupTo(destinationPath);
    public void CheckIntegrity() => actual.CheckIntegrity();
    public void Dispose() { }
}
