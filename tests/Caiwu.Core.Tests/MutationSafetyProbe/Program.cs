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
LedgerMutationContext Ctx(LedgerSnapshot shown) => new(shown.Book.Id, shown.Revision);
VoucherDraft At(LedgerSnapshot shown, VoucherDraft input) => input with
{ ExpectedBookId = shown.Book.Id, ExpectedRevision = shown.Revision };
string State(ILedgerStore store) => JsonSerializer.Serialize(store.Read());
SqliteLedgerStore Create(string name) => SqliteLedgerStore.Create(Path.Combine(directory, name + ".caiwu"),
    new(Guid.NewGuid(), name, AccountingRegime.Enterprise, "adjacent-mutation-probe", 2026, 1, 0, DateTimeOffset.UtcNow),
    TemplateCatalog.Get(AccountingRegime.Enterprise).Accounts);
VoucherDraft NewDraft(decimal amount = 10m, string debit = "1002") => new(null, new(2026, 1, 1), "记", null, 0,
    [new(debit, "独立业务", amount, 0), new("4001", "独立业务", 0, amount)]);
VoucherDraft Edit(LedgerSnapshot opened, Guid id, decimal amount) => NewDraft(amount) with
{ Id = id, ExpectedRevision = opened.Revision, ExpectedBookId = opened.Book.Id };
void Openings(ILedgerService s, decimal amount, LedgerSnapshot shown) => s.SetOpeningBalances([new("1002", amount, 0), new("4001", 0, amount)], "opening-user", Ctx(shown));

// A rejected command must preserve all durable fields, including audit/revision.
bool TryStale(ILedgerStore store, Action action, bool contextConflict = false)
{
    var before = State(store);
    try { action(); return true; }
    catch (Exception e) when (e is LedgerValidationException or StoreConcurrencyException)
    {
        Check(!contextConflict || e is StoreConcurrencyException, "Old context was not rejected by the context guard.");
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
void RejectContextUnchanged(ILedgerStore store, Action action)
{
    Check(!TryStale(store, action, contextConflict: true), "Expected missing/stale/foreign context to be rejected.");
    store.CheckIntegrity();
}
LedgerSnapshot Prepare(LedgerService service, string operation)
{
    if (operation is "DeleteDraft" or "Review" or "CancelReview" or "Post" or "CloseMonth")
    {
        var id = service.SaveDraft(At(service.GetSnapshot(), NewDraft()), "maker").Id;
        if (operation is "CancelReview" or "Post" or "CloseMonth")
            service.Review(id, "reviewer", Ctx(service.GetSnapshot()));
        if (operation == "CloseMonth") service.Post(id, "poster", Ctx(service.GetSnapshot()));
    }
    return service.GetSnapshot();
}
void Invoke(ILedgerService service, string operation, LedgerSnapshot shown, LedgerMutationContext? context)
{
    var id = shown.Vouchers.FirstOrDefault()?.Id ?? Guid.Empty;
    switch (operation)
    {
        case "SaveAccount": service.SaveAccount(shown.Accounts.Single(a => a.Code == "1002") with { Name = "核对后改名" }, "editor", context); break;
        case "DeleteAccount": service.DeleteAccount("1001", "editor", context); break;
        case "SetOpeningBalances": service.SetOpeningBalances([new("1002", 100, 0), new("4001", 0, 100)], "editor", context); break;
        case "DeleteDraft": service.DeleteDraft(id, "editor", context); break;
        case "Review": service.Review(id, "reviewer", context); break;
        case "CancelReview": service.CancelReview(id, "reviewer", context); break;
        case "Post": service.Post(id, "poster", context); break;
        case "CloseMonth": service.CloseMonth(1, "editor", context); break;
        default: throw new ArgumentOutOfRangeException(nameof(operation));
    }
}
void Legacy(LedgerService service, string operation, LedgerSnapshot shown)
{
    var id = shown.Vouchers.FirstOrDefault()?.Id ?? Guid.Empty;
    switch (operation)
    {
        case "SaveAccount": service.SaveAccount(shown.Accounts.Single(a => a.Code == "1002"), "editor"); break;
        case "DeleteAccount": service.DeleteAccount("1001", "editor"); break;
        case "SetOpeningBalances": service.SetOpeningBalances([], "editor"); break;
        case "DeleteDraft": service.DeleteDraft(id, "editor"); break;
        case "Review": service.Review(id, "reviewer"); break;
        case "CancelReview": service.CancelReview(id, "reviewer"); break;
        case "Post": service.Post(id, "poster"); break;
        case "CloseMonth": service.CloseMonth(1, "editor"); break;
    }
}

try
{
    Risk("STALE-OPENING-BALANCES", () =>
    {
        using var first = Create("opening"); var a = new LedgerService(first); Openings(a, 100, a.GetSnapshot());
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var b = new LedgerService(second);
        var openedB = b.GetSnapshot();
        var oldRows = openedB.Accounts.Select(x => new OpeningBalance(x.Code, x.OpeningDebit, x.OpeningCredit)).ToArray();
        Openings(a, 200, a.GetSnapshot());
        var before = first.Read().Revision;
        var accepted = TryStale(second, () => b.SetOpeningBalances(oldRows, "old-opening-editor", Ctx(openedB)), contextConflict: true);
        var bank = first.Read().Accounts.Single(x => x.Code == "1002").OpeningDebit;
        if (accepted) Check(bank == 100m, "Expected old100 to overwrite new200.");
        return (accepted, new { shownToB = 100m, newerSavedByA = 200m, finalBank = bank, revisionBeforeB = before, revisionAfterB = first.Read().Revision });
    });
    Risk("STALE-ACCOUNT-REACTIVATION", () =>
    {
        using var first = Create("account"); var a = new LedgerService(first);
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var b = new LedgerService(second);
        var openedB = b.GetSnapshot(); var oldCash = openedB.Accounts.Single(x => x.Code == "1001");
        a.SaveAccount(oldCash with { IsActive = false }, "disable-user", Ctx(a.GetSnapshot()));
        var accepted = TryStale(second, () => b.SaveAccount(oldCash with { Name = "B修改显示名称" }, "old-account-editor", Ctx(openedB)), contextConflict: true);
        var after = first.Read().Accounts.Single(x => x.Code == "1001");
        if (accepted) Check(after.IsActive && after.Name == "B修改显示名称", "Expected stale active=true to replace A's disabled value.");
        return (accepted, new { oldActive = true, newerSavedActive = false, finalActive = after.IsActive, finalName = after.Name });
    });
    Risk("STALE-DELETE-UPDATED-DRAFT", () =>
    {
        using var first = Create("delete"); var a = new LedgerService(first); var original = a.SaveDraft(At(a.GetSnapshot(), NewDraft()), "maker");
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var b = new LedgerService(second);
        var openedB = b.GetSnapshot(); var oldRow = openedB.Vouchers.Single();
        var editingA = a.GetSnapshot(); a.SaveDraft(Edit(editingA, original.Id, 20), "maker");
        var accepted = TryStale(second, () => b.DeleteDraft(oldRow.Id, "old-list-user", Ctx(openedB)), contextConflict: true);
        if (accepted) Check(first.Read().Vouchers.Count == 0, "Expected new20 to be deleted by old10 selection.");
        return (accepted, new { shownToB = 10m, newerSavedByA = 20m, finalVoucherCount = first.Read().Vouchers.Count });
    });
    Risk("STALE-REVIEW-UNSEEN-AMOUNT", () =>
    {
        using var first = Create("review"); var a = new LedgerService(first); var original = a.SaveDraft(At(a.GetSnapshot(), NewDraft()), "maker");
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var b = new LedgerService(second);
        var openedB = b.GetSnapshot(); var shownB = openedB.Vouchers.Single();
        var editingA = a.GetSnapshot(); a.SaveDraft(Edit(editingA, original.Id, 20), "maker");
        var accepted = TryStale(second, () => b.Review(shownB.Id, "reviewer", Ctx(openedB)), contextConflict: true);
        var reviewed = first.Read().Vouchers.Single();
        if (accepted) Check(reviewed.Status == VoucherStatus.Reviewed && reviewed.Lines[0].Debit == 20m, "Expected review to apply to unseen20.");
        return (accepted, new { shownToReviewer = shownB.Lines[0].Debit, reviewedAmount = reviewed.Lines[0].Debit, status = reviewed.Status.ToString() });
    });
    Risk("POST-CONFIRMATION-AMOUNT-MISMATCH", () =>
    {
        using var first = Create("post-confirm"); var a = new LedgerService(first); var original = a.SaveDraft(At(a.GetSnapshot(), NewDraft()), "maker");
        a.Review(original.Id, "reviewer1", Ctx(a.GetSnapshot()));
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var b = new LedgerService(second);
        var openedB = b.GetSnapshot(); var shownB = openedB.Vouchers.Single();
        a.CancelReview(original.Id, "reviewer1", Ctx(a.GetSnapshot()));
        var editingA = a.GetSnapshot(); a.SaveDraft(Edit(editingA, original.Id, 20), "maker");
        a.Review(original.Id, "reviewer2", Ctx(a.GetSnapshot()));
        var accepted = TryStale(second, () => b.Post(shownB.Id, "posting-user", Ctx(openedB)), contextConflict: true);
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
            id = setup.SaveDraft(At(setup.GetSnapshot(), NewDraft()), "maker").Id;
            if (operation is "CancelReview" or "Post" or "CloseMonth") setup.Review(id.Value, "reviewer", Ctx(setup.GetSnapshot()));
            if (operation == "CloseMonth") setup.Post(id.Value, "posting-user", Ctx(setup.GetSnapshot()));
        }
        var targetOpened = first.Read();
        var bank = targetOpened.Accounts.Single(x => x.Code == "1002");
        using var otherStore = SqliteLedgerStore.Open(first.DatabasePath); var other = new LedgerService(otherStore);
        string? committedByOther = null;
        var hook = new ReadHookStore(first, () =>
        {
            other.SaveDraft(At(other.GetSnapshot(), NewDraft(debit: operation == "DeleteAccount" ? "1001" : "1002")), "parallel-maker");
            committedByOther = State(otherStore);
        });
        var target = new LedgerService(hook);
        Action command = operation switch
        {
            "SaveAccount" => () => target.SaveAccount(bank with { Name = "被CAS阻止的改名" }, "A", Ctx(targetOpened)),
            "DeleteAccount" => () => target.DeleteAccount("1001", "A", Ctx(targetOpened)),
            "SetOpeningBalances" => () => Openings(target, 100, targetOpened),
            "DeleteDraft" => () => target.DeleteDraft(id!.Value, "A", Ctx(targetOpened)),
            "Review" => () => target.Review(id!.Value, "other-reviewer", Ctx(targetOpened)),
            "CancelReview" => () => target.CancelReview(id!.Value, "reviewer", Ctx(targetOpened)),
            "Post" => () => target.Post(id!.Value, "posting-user", Ctx(targetOpened)),
            "CloseMonth" => () => target.CloseMonth(1, "A", Ctx(targetOpened)),
            _ => throw new InvalidOperationException(operation)
        };
        try { command(); } catch (StoreConcurrencyException)
        {
            Check(committedByOther is not null && committedByOther == State(first), "CAS failure changed another writer's snapshot/audit/revision.");
            Check(hook.WriteAttempts == 1, "The competing write must be rejected by real store CAS, after context validation.");
            first.CheckIntegrity(); return;
        }
        throw new InvalidOperationException("Expected a real SQLite revision conflict.");
    });

    Safe("FRESH-OPENING-POSTED-LOCK", () =>
    {
        using var first = Create("opening-lock"); var a = new LedgerService(first);
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var b = new LedgerService(second);
        var old = b.GetSnapshot().Accounts.Select(x => new OpeningBalance(x.Code, 0, 0)).ToArray();
        var id = a.SaveDraft(At(a.GetSnapshot(), NewDraft()), "maker").Id; a.Review(id, "reviewer", Ctx(a.GetSnapshot())); a.Post(id, "poster", Ctx(a.GetSnapshot()));
        RejectUnchanged(second, () => b.SetOpeningBalances(old, "B", Ctx(b.GetSnapshot())));
    });
    Safe("FRESH-ACCOUNT-OPENING-BALANCE-GUARD", () =>
    {
        using var first = Create("account-money"); var a = new LedgerService(first); Openings(a, 100, a.GetSnapshot());
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var b = new LedgerService(second);
        var oldBank = b.GetSnapshot().Accounts.Single(x => x.Code == "1002");
        Openings(a, 200, a.GetSnapshot());
        RejectUnchanged(second, () => b.SaveAccount(oldBank with { Name = "旧余额改名" }, "B", Ctx(b.GetSnapshot())));
    });
    Safe("FRESH-DELETE-ACCOUNT-NOW-REFERENCED", () =>
    {
        using var first = Create("delete-account-ref"); var a = new LedgerService(first);
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var b = new LedgerService(second); _ = b.GetSnapshot();
        a.SaveDraft(At(a.GetSnapshot(), NewDraft(debit: "1001")), "maker");
        RejectUnchanged(second, () => b.DeleteAccount("1001", "B", Ctx(b.GetSnapshot())));
    });
    foreach (var operation in new[] { "Review", "CancelReview", "DeleteDraft" })
    Safe("FRESH-" + operation + "-NOW-POSTED", () =>
    {
        using var first = Create("posted-" + operation); var a = new LedgerService(first); var id = a.SaveDraft(At(a.GetSnapshot(), NewDraft()), "maker").Id;
        a.Review(id, "reviewer", Ctx(a.GetSnapshot()));
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var b = new LedgerService(second); _ = b.GetSnapshot();
        a.Post(id, "poster", Ctx(a.GetSnapshot()));
        RejectUnchanged(second, operation switch
        {
            "Review" => () => b.Review(id, "reviewer2", Ctx(b.GetSnapshot())),
            "CancelReview" => () => b.CancelReview(id, "reviewer", Ctx(b.GetSnapshot())),
            _ => () => b.DeleteDraft(id, "B", Ctx(b.GetSnapshot()))
        });
    });
    Safe("FRESH-POST-NOW-CANCELED", () =>
    {
        using var first = Create("post-canceled"); var a = new LedgerService(first); var id = a.SaveDraft(At(a.GetSnapshot(), NewDraft()), "maker").Id;
        a.Review(id, "reviewer", Ctx(a.GetSnapshot()));
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var b = new LedgerService(second); _ = b.GetSnapshot();
        a.CancelReview(id, "reviewer", Ctx(a.GetSnapshot())); RejectUnchanged(second, () => b.Post(id, "poster", Ctx(b.GetSnapshot())));
    });
    Safe("FRESH-CLOSE-NEW-UNPOSTED", () =>
    {
        using var first = Create("close-unposted"); var a = new LedgerService(first);
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var b = new LedgerService(second); _ = b.GetSnapshot();
        a.SaveDraft(At(a.GetSnapshot(), NewDraft()), "maker"); RejectUnchanged(second, () => b.CloseMonth(1, "B", Ctx(b.GetSnapshot())));
    });
    foreach (var operation in new[] { "Review", "CancelReview", "Post", "DeleteDraft" })
    Safe("OTHER-BOOK-VOUCHER-ID-" + operation, () =>
    {
        using var source = Create("foreign-source-" + operation); var sourceService = new LedgerService(source);
        var foreign = sourceService.SaveDraft(At(sourceService.GetSnapshot(), NewDraft()), "maker");
        using var target = Create("foreign-target-" + operation); var t = new LedgerService(target); t.SaveDraft(At(t.GetSnapshot(), NewDraft(30)), "other-maker");
        RejectUnchanged(target, operation switch
        {
            "Review" => () => t.Review(foreign.Id, "reviewer", Ctx(t.GetSnapshot())),
            "CancelReview" => () => t.CancelReview(foreign.Id, "reviewer", Ctx(t.GetSnapshot())),
            "Post" => () => t.Post(foreign.Id, "poster", Ctx(t.GetSnapshot())),
            _ => () => t.DeleteDraft(foreign.Id, "B", Ctx(t.GetSnapshot()))
        });
    });

    // Fail-closed API migration and legitimate writes, against actual independent SQLite handles.
    foreach (var operation in new[] { "SaveAccount", "DeleteAccount", "SetOpeningBalances", "DeleteDraft", "Review", "CancelReview", "Post", "CloseMonth" })
    foreach (var mode in new[] { "legacy", "explicit-null", "stale", "foreign-same-revision", "empty-book", "negative", "future", "current" })
    Safe("V12-" + operation + "-" + mode, () =>
    {
        using var first = Create("v12-" + operation + "-" + mode);
        var setup = new LedgerService(first); var shown = Prepare(setup, operation);
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var target = new LedgerService(second);
        LedgerMutationContext? context = Ctx(shown);
        if (mode == "stale") setup.SaveDraft(At(setup.GetSnapshot(), NewDraft()), "competing-maker");
        if (mode == "foreign-same-revision")
        {
            using var foreign = Create("foreign-context-" + operation); var other = new LedgerService(foreign);
            while (foreign.Read().Revision < shown.Revision)
                other.SaveDraft(At(other.GetSnapshot(), NewDraft()), "foreign-maker");
            var foreignShown = other.GetSnapshot();
            Check(foreignShown.Revision == shown.Revision && foreignShown.Book.Id != shown.Book.Id, "Cross-book test must use a real other book at the same revision.");
            context = Ctx(foreignShown);
        }
        context = mode switch
        {
            "explicit-null" => null,
            "empty-book" => context with { ExpectedBookId = Guid.Empty },
            "negative" => context with { ExpectedRevision = -1 },
            "future" => context with { ExpectedRevision = shown.Revision + 1 },
            _ => context
        };
        var inputBefore = JsonSerializer.Serialize(shown);
        if (mode == "current")
        {
            Invoke(target, operation, shown, context);
            var after = first.Read();
            Check(after.Revision == shown.Revision + 1 && after.AuditEvents.Count == shown.AuditEvents.Count + 1 &&
                after.AuditEvents[^1].Action == operation, "Accepted command must commit exactly once with one correct audit.");
            // An accepted context is single-use even if the requested operation could otherwise be repeated.
            RejectContextUnchanged(second, () => Invoke(target, operation, shown, context));
        }
        else if (mode == "legacy") RejectContextUnchanged(second, () => Legacy(target, operation, shown));
        else RejectContextUnchanged(second, () => Invoke(target, operation, shown, context));
        Check(inputBefore == JsonSerializer.Serialize(shown), "Rejected/successful command mutated the user's source snapshot.");
    });

    // v1.2 also closes the historical token-free creation path; no edit-token suite is repeated here.
    foreach (var mode in new[] { "missing-both", "missing-book", "missing-revision", "stale", "foreign-same-revision", "current" })
    Safe("V12-NewDraft-" + mode, () =>
    {
        using var first = Create("new-v12-" + mode); var setup = new LedgerService(first);
        using var second = SqliteLedgerStore.Open(first.DatabasePath); var target = new LedgerService(second);
        var shown = target.GetSnapshot();
        var input = At(shown, NewDraft());
        if (mode == "stale") setup.SaveDraft(At(setup.GetSnapshot(), NewDraft()), "competing-maker");
        if (mode == "foreign-same-revision")
        {
            using var foreign = Create("new-v12-foreign"); var otherShown = foreign.Read();
            Check(shown.Revision == otherShown.Revision, "New draft cross-book setup must have equal revisions.");
            input = input with { ExpectedBookId = otherShown.Book.Id, ExpectedRevision = otherShown.Revision };
        }
        input = mode switch
        {
            "missing-both" => input with { ExpectedBookId = null, ExpectedRevision = null },
            "missing-book" => input with { ExpectedBookId = null },
            "missing-revision" => input with { ExpectedRevision = null },
            _ => input
        };
        var inputBefore = JsonSerializer.Serialize(input);
        if (mode == "current")
        {
            var saved = target.SaveDraft(input, "maker");
            Check(saved.Number == 1 && first.Read().Revision == 1 && first.Read().AuditEvents.Count == 1,
                "Legitimate new draft must allocate one number and one audit.");
            RejectContextUnchanged(second, () => target.SaveDraft(input, "maker"));
        }
        else RejectContextUnchanged(second, () => target.SaveDraft(input, "maker"));
        Check(inputBefore == JsonSerializer.Serialize(input), "New-draft input or its token was mutated.");
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
    public int WriteAttempts { get; private set; }
    public void Write(LedgerSnapshot next, long expectedRevision) { WriteAttempts++; actual.Write(next, expectedRevision); }
    public void BackupTo(string destinationPath) => actual.BackupTo(destinationPath);
    public void CheckIntegrity() => actual.CheckIntegrity();
    public void Dispose() { }
}
