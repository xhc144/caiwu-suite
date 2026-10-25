using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Persistence.Sqlite;

var output = args.Length == 1 ? Path.GetFullPath(args[0]) : Path.Combine(Path.GetTempPath(), "mutation-probe-" + Guid.NewGuid().ToString("N") + ".json");
Directory.CreateDirectory(Path.GetDirectoryName(output)!);
var directory = Path.Combine(Path.GetTempPath(), "caiwu-mutation-probe-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(directory);
var results = new List<object>();
var risks = 0; var safetyPassed = 0; var safetyFailed = 0; var blockedRisks = 0;
void Check(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
string State(ILedgerStore store) => JsonSerializer.Serialize(store.Read());
SqliteLedgerStore Create(string name) => SqliteLedgerStore.Create(Path.Combine(directory, name + ".caiwu"),
    new(Guid.NewGuid(), name, AccountingRegime.Enterprise, "adjacent-mutation-probe", 2026, 1, 0, DateTimeOffset.UtcNow),
    TemplateCatalog.Get(AccountingRegime.Enterprise).Accounts);
VoucherDraft NewDraft(decimal amount = 10m, string debit = "1002") => new(null, new(2026, 1, 1), "记", null, 0,
    [new(debit, "独立业务", amount, 0), new("4001", "独立业务", 0, amount)]);
VoucherDraft Edit(LedgerSnapshot opened, Guid id, decimal amount) => NewDraft(amount) with
{ Id = id, ExpectedRevision = opened.Revision, ExpectedBookId = opened.Book.Id };
void Openings(ILedgerService s, decimal amount) => s.SetOpeningBalances([new("1002", amount, 0), new("4001", 0, amount)], "opening-user");

// A rejected command must preserve all durable fields, including audit/revision.
bool TryStale(ILedgerStore store, Action action)
{
    var before = State(store);
    try { action(); return true; }
    catch (Exception e) when (e is LedgerValidationException or StoreConcurrencyException)
    {
        Check(before == State(store), "Rejected stale command changed durable snapshot.");
        return false;
    }
}
void Risk(string id, Func<(bool Accepted, object Details)> test)
{
    try
    {
        var r = test();
        if (r.Accepted) { risks++; Console.WriteLine("RISK " + id); }
        else { blockedRisks++; Console.WriteLine("PROTECTED " + id); }
        results.Add(new { id, status = r.Accepted ? "RISK_CONFIRMED" : "PROTECTED", details = r.Details });
    }
    catch (Exception e)
    {
        safetyFailed++; results.Add(new { id, status = "PROBE_FAILURE", detail = e.Message });
        Console.WriteLine("PROBE_FAILURE " + id + ": " + e.Message);
    }
}
void Safe(string id, Action test)
{
    try { test(); safetyPassed++; results.Add(new { id, status = "PASS" }); Console.WriteLine("PASS " + id); }
    catch (Exception e) { safetyFailed++; results.Add(new { id, status = "FAIL", detail = e.Message }); Console.WriteLine("FAIL " + id + ": " + e.Message); }
}
void RejectUnchanged(ILedgerStore store, Action action)
{
    Check(!TryStale(store, action), "Expected a current-state guard to reject, but mutation succeeded.");
}

try
{
    Risk("STALE-OPENING-BALANCES", () =>
    {
        using var first = Create("opening"); var a = new LedgerService(first); Openings(a, 100);
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var b = new LedgerService(second);
        var openedB = b.GetSnapshot();
        var oldRows = openedB.Accounts.Select(x => new OpeningBalance(x.Code, x.OpeningDebit, x.OpeningCredit)).ToArray();
        Openings(a, 200);
        var before = first.Read().Revision;
        var accepted = TryStale(second, () => b.SetOpeningBalances(oldRows, "old-opening-editor"));
        var bank = first.Read().Accounts.Single(x => x.Code == "1002").OpeningDebit;
        if (accepted) Check(bank == 100m, "Expected old100 to overwrite new200.");
        return (accepted, new { shownToB = 100m, newerSavedByA = 200m, finalBank = bank, revisionBeforeB = before, revisionAfterB = first.Read().Revision });
    });
    Risk("STALE-ACCOUNT-REACTIVATION", () =>
    {
        using var first = Create("account"); var a = new LedgerService(first);
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var b = new LedgerService(second);
        var oldCash = b.GetSnapshot().Accounts.Single(x => x.Code == "1001");
        a.SaveAccount(oldCash with { IsActive = false }, "disable-user");
        var accepted = TryStale(second, () => b.SaveAccount(oldCash with { Name = "B修改显示名称" }, "old-account-editor"));
        var after = first.Read().Accounts.Single(x => x.Code == "1001");
        if (accepted) Check(after.IsActive && after.Name == "B修改显示名称", "Expected stale active=true to replace A's disabled value.");
        return (accepted, new { oldActive = true, newerSavedActive = false, finalActive = after.IsActive, finalName = after.Name });
    });
    Risk("STALE-DELETE-UPDATED-DRAFT", () =>
    {
        using var first = Create("delete"); var a = new LedgerService(first); var original = a.SaveDraft(NewDraft(), "maker");
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var b = new LedgerService(second);
        var oldRow = b.GetSnapshot().Vouchers.Single();
        var editingA = a.GetSnapshot(); a.SaveDraft(Edit(editingA, original.Id, 20), "maker");
        var accepted = TryStale(second, () => b.DeleteDraft(oldRow.Id, "old-list-user"));
        if (accepted) Check(first.Read().Vouchers.Count == 0, "Expected new20 to be deleted by old10 selection.");
        return (accepted, new { shownToB = 10m, newerSavedByA = 20m, finalVoucherCount = first.Read().Vouchers.Count });
    });
    Risk("STALE-REVIEW-UNSEEN-AMOUNT", () =>
    {
        using var first = Create("review"); var a = new LedgerService(first); var original = a.SaveDraft(NewDraft(), "maker");
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var b = new LedgerService(second);
        var shownB = b.GetSnapshot().Vouchers.Single();
        var editingA = a.GetSnapshot(); a.SaveDraft(Edit(editingA, original.Id, 20), "maker");
        var accepted = TryStale(second, () => b.Review(shownB.Id, "reviewer"));
        var reviewed = first.Read().Vouchers.Single();
        if (accepted) Check(reviewed.Status == VoucherStatus.Reviewed && reviewed.Lines[0].Debit == 20m, "Expected review to apply to unseen20.");
        return (accepted, new { shownToReviewer = shownB.Lines[0].Debit, reviewedAmount = reviewed.Lines[0].Debit, status = reviewed.Status.ToString() });
    });
    Risk("POST-CONFIRMATION-AMOUNT-MISMATCH", () =>
    {
        using var first = Create("post-confirm"); var a = new LedgerService(first); var original = a.SaveDraft(NewDraft(), "maker");
        a.Review(original.Id, "reviewer1");
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var b = new LedgerService(second);
        var shownB = b.GetSnapshot().Vouchers.Single();
        a.CancelReview(original.Id, "reviewer1");
        var editingA = a.GetSnapshot(); a.SaveDraft(Edit(editingA, original.Id, 20), "maker");
        a.Review(original.Id, "reviewer2");
        var accepted = TryStale(second, () => b.Post(shownB.Id, "posting-user"));
        var posted = first.Read().Vouchers.Single();
        if (accepted) Check(posted.Status == VoucherStatus.Posted && posted.Lines[0].Debit == 20m && posted.ReviewedBy == "reviewer2", "Expected current reviewed20 to be posted.");
        // The state machine is valid; the defect is that UI confirmation10 is not bound to this current version20.
        return (accepted, new { shownInConfirmation = shownB.Lines[0].Debit, postedAmount = posted.Lines[0].Debit,
            currentVersionHasIndependentReview = posted.ReviewedBy == "reviewer2", status = posted.Status.ToString() });
    });

    // Every mutation below reads before a real competing connection commits, then reaches its unchanged store CAS.
    foreach (var operation in new[] { "SaveAccount", "DeleteAccount", "SetOpeningBalances", "DeleteDraft", "Review", "CancelReview", "Post", "CloseMonth" })
    Safe("REAL-CAS-" + operation, () =>
    {
        using var first = Create("cas-" + operation); var setup = new LedgerService(first);
        Guid? id = null;
        if (operation is "DeleteDraft" or "Review" or "CancelReview" or "Post" or "CloseMonth")
        {
            id = setup.SaveDraft(NewDraft(), "maker").Id;
            if (operation is "CancelReview" or "Post" or "CloseMonth") setup.Review(id.Value, "reviewer");
            if (operation == "CloseMonth") setup.Post(id.Value, "posting-user");
        }
        var bank = first.Read().Accounts.Single(x => x.Code == "1002");
        using var otherStore = SqliteLedgerStore.Open(first.DatabasePath); var other = new LedgerService(otherStore);
        string? committedByOther = null;
        var hook = new ReadHookStore(first, () =>
        {
            other.SaveDraft(NewDraft(debit: operation == "DeleteAccount" ? "1001" : "1002"), "parallel-maker");
            committedByOther = State(otherStore);
        });
        var target = new LedgerService(hook);
        Action command = operation switch
        {
            "SaveAccount" => () => target.SaveAccount(bank with { Name = "被CAS阻止的改名" }, "A"),
            "DeleteAccount" => () => target.DeleteAccount("1001", "A"),
            "SetOpeningBalances" => () => Openings(target, 100),
            "DeleteDraft" => () => target.DeleteDraft(id!.Value, "A"),
            "Review" => () => target.Review(id!.Value, "other-reviewer"),
            "CancelReview" => () => target.CancelReview(id!.Value, "reviewer"),
            "Post" => () => target.Post(id!.Value, "posting-user"),
            "CloseMonth" => () => target.CloseMonth(1, "A"),
            _ => throw new InvalidOperationException(operation)
        };
        try { command(); } catch (StoreConcurrencyException)
        {
            Check(committedByOther is not null && committedByOther == State(first), "CAS failure changed another writer's snapshot/audit/revision.");
            first.CheckIntegrity(); return;
        }
        throw new InvalidOperationException("Expected a real SQLite revision conflict.");
    });

    Safe("FRESH-OPENING-POSTED-LOCK", () =>
    {
        using var first = Create("opening-lock"); var a = new LedgerService(first);
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var b = new LedgerService(second);
        var old = b.GetSnapshot().Accounts.Select(x => new OpeningBalance(x.Code, 0, 0)).ToArray();
        var id = a.SaveDraft(NewDraft(), "maker").Id; a.Review(id, "reviewer"); a.Post(id, "poster");
        RejectUnchanged(second, () => b.SetOpeningBalances(old, "B"));
    });
    Safe("FRESH-ACCOUNT-OPENING-BALANCE-GUARD", () =>
    {
        using var first = Create("account-money"); var a = new LedgerService(first); Openings(a, 100);
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var b = new LedgerService(second);
        var oldBank = b.GetSnapshot().Accounts.Single(x => x.Code == "1002");
        Openings(a, 200);
        RejectUnchanged(second, () => b.SaveAccount(oldBank with { Name = "旧余额改名" }, "B"));
    });
    Safe("FRESH-DELETE-ACCOUNT-NOW-REFERENCED", () =>
    {
        using var first = Create("delete-account-ref"); var a = new LedgerService(first);
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var b = new LedgerService(second); _ = b.GetSnapshot();
        a.SaveDraft(NewDraft(debit: "1001"), "maker");
        RejectUnchanged(second, () => b.DeleteAccount("1001", "B"));
    });
    foreach (var operation in new[] { "Review", "CancelReview", "DeleteDraft" })
    Safe("FRESH-" + operation + "-NOW-POSTED", () =>
    {
        using var first = Create("posted-" + operation); var a = new LedgerService(first); var id = a.SaveDraft(NewDraft(), "maker").Id;
        a.Review(id, "reviewer");
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var b = new LedgerService(second); _ = b.GetSnapshot();
        a.Post(id, "poster");
        RejectUnchanged(second, operation switch
        {
            "Review" => () => b.Review(id, "reviewer2"),
            "CancelReview" => () => b.CancelReview(id, "reviewer"),
            _ => () => b.DeleteDraft(id, "B")
        });
    });
    Safe("FRESH-POST-NOW-CANCELED", () =>
    {
        using var first = Create("post-canceled"); var a = new LedgerService(first); var id = a.SaveDraft(NewDraft(), "maker").Id;
        a.Review(id, "reviewer");
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var b = new LedgerService(second); _ = b.GetSnapshot();
        a.CancelReview(id, "reviewer"); RejectUnchanged(second, () => b.Post(id, "poster"));
    });
    Safe("FRESH-CLOSE-NEW-UNPOSTED", () =>
    {
        using var first = Create("close-unposted"); var a = new LedgerService(first);
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var b = new LedgerService(second); _ = b.GetSnapshot();
        a.SaveDraft(NewDraft(), "maker"); RejectUnchanged(second, () => b.CloseMonth(1, "B"));
    });
    foreach (var operation in new[] { "Review", "CancelReview", "Post", "DeleteDraft" })
    Safe("OTHER-BOOK-VOUCHER-ID-" + operation, () =>
    {
        using var source = Create("foreign-source-" + operation); var sourceService = new LedgerService(source);
        var foreign = sourceService.SaveDraft(NewDraft(), "maker");
        using var target = Create("foreign-target-" + operation); var t = new LedgerService(target); t.SaveDraft(NewDraft(30), "other-maker");
        RejectUnchanged(target, operation switch
        {
            "Review" => () => t.Review(foreign.Id, "reviewer"),
            "CancelReview" => () => t.CancelReview(foreign.Id, "reviewer"),
            "Post" => () => t.Post(foreign.Id, "poster"),
            _ => () => t.DeleteDraft(foreign.Id, "B")
        });
    });
}
finally
{
    File.WriteAllText(output, JsonSerializer.Serialize(new
    {
        targetCommit = Environment.GetEnvironmentVariable("CAIWU_MUTATION_TARGET_COMMIT") ?? "not supplied",
        actualSqlite = true, saveDraftThirteenCasesRepeated = false, wpfExecuted = false,
        risksConfirmed = risks, risksAlreadyBlocked = blockedRisks, safetyPassed, safetyFailed, results
    }, new JsonSerializerOptions { WriteIndented = true }));
    Directory.Delete(directory, true);
}
Console.WriteLine($"Adjacent mutations: risks={risks}, protected={blockedRisks}, safetyPassed={safetyPassed}, safetyFailed={safetyFailed}");
return risks == 0 && safetyFailed == 0 ? 0 : 1;

sealed class ReadHookStore(ILedgerStore actual, Action afterRead) : ILedgerStore
{
    private bool fired;
    public string DatabasePath => actual.DatabasePath;
    public LedgerSnapshot Read() { var captured = actual.Read(); if (!fired) { fired = true; afterRead(); } return captured; }
    public void Write(LedgerSnapshot next, long expectedRevision) => actual.Write(next, expectedRevision);
    public void BackupTo(string destinationPath) => actual.BackupTo(destinationPath);
    public void CheckIntegrity() => actual.CheckIntegrity();
    public void Dispose() { }
}
