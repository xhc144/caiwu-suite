using System.Text.Json;
using Caiwu.Acceptance;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Desktop.Presentation;
using Caiwu.Persistence.Sqlite;

var root = Path.Combine(Path.GetTempPath(), "caiwu-v12-independent-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(root);
var cases = new List<object>(); var failed = 0;
var backend = new DesktopBackend(SqliteLedgerStore.Open, SqliteLedgerStore.Create, SqliteLedgerStore.RestoreBackup,
    store => new PreviewLedgerService(new LedgerService(store)), TemplateCatalog.All);
void Require(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
void Case(string name, Action test)
{ try { test(); cases.Add(new { name, status = "PASS" }); Console.WriteLine("PASS " + name); }
  catch (Exception e) { failed++; cases.Add(new { name, status = "FAIL", detail = e.ToString() }); Console.Error.WriteLine("FAIL " + name + " " + e.Message); } }
BookInfo Book(string name) => new(Guid.NewGuid(), name, AccountingRegime.SmallBusiness, "independent", 2026, 10, 9, DateTimeOffset.UtcNow);
Account[] Accounts() => [new("1001", "现金", null, BalanceDirection.Debit, true, 0, 0), new("1002", "银行", null, BalanceDirection.Debit, true, 0, 0), new("3001", "资本", null, BalanceDirection.Credit, true, 0, 0)];
SqliteLedgerStore Store(string name) => SqliteLedgerStore.Create(Path.Combine(root, name + ".caiwu"), Book(name), Accounts());
LedgerMutationContext Context(LedgerSnapshot shown) => new(shown.Book.Id, shown.Revision);
VoucherDraft Request(LedgerSnapshot shown, decimal amount, Guid? id = null) => new(id, new(2026, 10, 1), "记", null, 0,
    [new("1002", "保留的输入", amount, 0), new("3001", "保留的输入", 0, amount)], shown.Revision, shown.Book.Id);
Voucher Seed(ILedgerService service) { var plan = service.GetSnapshot(); return service.SaveDraft(Request(plan, 10), "甲"); }
string State(ILedgerService service) => JsonSerializer.Serialize(service.GetSnapshot());
void RejectUnchanged(ILedgerService service, Action test)
{
    var before = State(service); var rejected = false;
    try { test(); } catch (StoreConcurrencyException) { rejected = true; }
    Require(rejected && State(service) == before, "Expected snapshot/session conflict with every persisted field/audit/revision unchanged.");
}
void Opening(ILedgerService service, LedgerSnapshot shown, decimal amount) => service.SetOpeningBalances([new("1002", amount, 0), new("3001", 0, amount)], "期初", Context(shown));
try
{
    Case("STALE-OPENING-200-CANNOT-BE-REPLACED-BY-OLD-100", () =>
    {
        using var s = Store("opening"); ILedgerService a = new LedgerService(s); var seed = a.GetSnapshot(); Opening(a, seed, 100);
        var oldEditor = a.GetSnapshot(); using var other = SqliteLedgerStore.Open(s.DatabasePath); ILedgerService b = new LedgerService(other);
        var otherPlan = b.GetSnapshot(); Opening(b, otherPlan, 200);
        RejectUnchanged(a, () => Opening(a, oldEditor, 100)); Require(a.GetSnapshot().Accounts.Single(x => x.Code == "1002").OpeningDebit == 200, "New opening lost.");
    });
    Case("STALE-ACCOUNT-CANNOT-REENABLE-NEWLY-DISABLED-ACCOUNT", () =>
    {
        using var s = Store("account"); ILedgerService service = new LedgerService(s); var shown = service.GetSnapshot(); var old = shown.Accounts.Single(x => x.Code == "1001");
        using var other = SqliteLedgerStore.Open(s.DatabasePath); ILedgerService writer = new LedgerService(other); var writerPlan = writer.GetSnapshot();
        writer.SaveAccount(old with { IsActive = false }, "乙", Context(writerPlan));
        RejectUnchanged(service, () => service.SaveAccount(old with { Name = "旧表单改名" }, "甲", Context(shown)));
        Require(!service.GetSnapshot().Accounts.Single(x => x.Code == "1001").IsActive, "Disabled account reenabled.");
    });
    foreach (var operation in new[] { "DeleteDraft", "Review" })
        Case("STALE-" + operation.ToUpperInvariant() + "-CANNOT-ACT-ON-UNSEEN-20", () =>
        {
            using var s = Store(operation); ILedgerService service = new LedgerService(s); var v = Seed(service); var selection = service.GetSnapshot();
            using var other = SqliteLedgerStore.Open(s.DatabasePath); ILedgerService writer = new LedgerService(other); var writerPlan = writer.GetSnapshot(); writer.SaveDraft(Request(writerPlan, 20, v.Id), "甲");
            RejectUnchanged(service, () => { if (operation == "DeleteDraft") service.DeleteDraft(v.Id, "甲", Context(selection)); else service.Review(v.Id, "乙", Context(selection)); });
            Require(service.GetSnapshot().Vouchers.Single().Lines[0].Debit == 20 && service.GetSnapshot().Vouchers.Single().Status == VoucherStatus.Draft, "Unseen voucher changed status/data.");
        });
    Case("POST-CONFIRMED-10-CANNOT-POST-CHANGED-20", () =>
    {
        using var s = Store("post"); ILedgerService service = new LedgerService(s); var v = Seed(service); var reviewPlan = service.GetSnapshot(); service.Review(v.Id, "乙", Context(reviewPlan));
        var confirmation = service.GetSnapshot(); Require(confirmation.Vouchers.Single().Lines[0].Debit == 10, "Confirmation fixture did not show 10.");
        using var other = SqliteLedgerStore.Open(s.DatabasePath); ILedgerService writer = new LedgerService(other);
        var cancelPlan = writer.GetSnapshot(); writer.CancelReview(v.Id, "乙", Context(cancelPlan));
        var editPlan = writer.GetSnapshot(); writer.SaveDraft(Request(editPlan, 20, v.Id), "甲");
        var secondReview = writer.GetSnapshot(); writer.Review(v.Id, "乙", Context(secondReview));
        RejectUnchanged(service, () => service.Post(v.Id, "乙", Context(confirmation)));
        Require(service.GetSnapshot().Vouchers.Single().Status == VoucherStatus.Reviewed && service.GetSnapshot().Vouchers.Single().Lines[0].Debit == 20, "Confirmation posted unseen data.");
    });
    foreach (var operation in new[] { "SaveAccount", "DeleteAccount", "SetOpeningBalances", "DeleteDraft", "Review", "CancelReview", "Post", "CloseMonth" })
        Case("LEGACY-NO-CONTEXT-" + operation, () =>
        {
            using var s = Store("legacy-" + operation); ILedgerService service = new LedgerService(s); var v = Seed(service); var shown = service.GetSnapshot();
            RejectUnchanged(service, () => Invoke(service, operation, shown, v.Id, null));
        });
    foreach (var missing in new[] { "both", "book", "revision" })
        Case("NEW-DRAFT-REQUIRES-" + missing, () =>
        {
            using var s = Store("new-" + missing); ILedgerService service = new LedgerService(s); var shown = service.GetSnapshot();
            var request = Request(shown, 10) with { ExpectedBookId = missing is "both" or "book" ? null : shown.Book.Id, ExpectedRevision = missing is "both" or "revision" ? null : shown.Revision };
            RejectUnchanged(service, () => service.SaveDraft(request, "甲"));
        });
    Case("CROSS-BOOK-SAME-REVISION-SAME-ID", () =>
    {
        using var a = Store("cross-a"); ILedgerService serviceA = new LedgerService(a); var v = Seed(serviceA); var shownA = serviceA.GetSnapshot();
        using var b = Store("cross-b"); var seedB = b.Read(); b.Write(seedB with { Revision = 1, Vouchers = [v] }, 0); ILedgerService serviceB = new LedgerService(b);
        Require(b.Read().Revision == shownA.Revision && b.Read().Vouchers.Single().Id == v.Id && b.Read().Book.Id != shownA.Book.Id, "Cross-book setup would reject for another reason.");
        RejectUnchanged(serviceB, () => serviceB.Review(v.Id, "乙", Context(shownA)));
        RejectUnchanged(serviceB, () => serviceB.SaveDraft(Request(shownA, 20, v.Id), "甲"));
    });
    Case("NONEXISTENT-ID-WITH-CORRECT-CONTEXT", () =>
    {
        using var s = Store("missing-id"); ILedgerService service = new LedgerService(s); Seed(service); var shown = service.GetSnapshot(); var before = State(service); var rejected = false;
        try { service.DeleteDraft(Guid.NewGuid(), "甲", Context(shown)); } catch (LedgerValidationException) { rejected = true; }
        Require(rejected && State(service) == before, "Nonexistent ID created/deleted/mutated state.");
    });
    Case("PREVIEW-WRAPPER-FORWARDS-ORIGINAL-CONTEXT-REFERENCE", () =>
    {
        using var s = Store("preview"); ILedgerService real = new LedgerService(s); var v = Seed(real); var seen = new List<SeenMutation>();
        var preview = new PreviewLedgerService(new ObservedLedgerService(real, seen)); var shown = preview.GetSnapshot(); var original = Context(shown);
        real.SaveDraft(Request(shown, 20, v.Id), "甲"); RejectUnchanged(preview, () => preview.Review(v.Id, "乙", original));
        Require(seen.Count == 1 && ReferenceEquals(seen[0].Context, original), "Preview wrapper substituted context.");
    });
    Case("SAME-BOOK-ID-REVISION-RESTORE-INVALIDATES-OLD-SESSION", () =>
    {
        using var session = new LedgerSession(backend); var path = Path.Combine(root, "session.caiwu"); session.Create(path, Book("session"), Accounts());
        var v = Seed(session.Service!); session.Refresh(); var shown = session.Snapshot!; var old = new SessionBoundMutation(session, shown); var oldRequest = Request(shown, 30, v.Id);
        var clone = Path.Combine(root, "clone.caiwu"); session.BackupTo(clone); var oldGeneration = session.Generation;
        session.Open(clone); var restored = session.Service!.GetSnapshot();
        Require(restored.Book.Id == shown.Book.Id && restored.Revision == shown.Revision && session.Generation != oldGeneration, "Clone did not preserve identity/revision or change session.");
        RejectUnchanged(session.Service, () => old.GetService().SaveDraft(oldRequest, "甲"));
        var fresh = new SessionBoundMutation(session, restored); fresh.GetService().SaveDraft(Request(restored, 20, v.Id), "甲");
        using var original = SqliteLedgerStore.Open(path); Require(original.Read().Vouchers.Single().Lines[0].Debit == 10 && session.Service.GetSnapshot().Vouchers.Single().Lines[0].Debit == 20, "Reopened clone wrote the source file.");
    });
    Case("FAILED-OPEN-KEEPS-VALID-PENDING-ORIGIN", () =>
    {
        using var session = new LedgerSession(backend); session.Create(Path.Combine(root, "good.caiwu"), Book("good"), Accounts());
        var v = Seed(session.Service!); var shown = session.Service!.GetSnapshot(); var pending = new SessionBoundMutation(session, shown); var generation = session.Generation;
        var bad = Path.Combine(root, "bad.caiwu"); File.WriteAllText(bad, "bad"); try { session.Open(bad); } catch (Exception) { }
        Require(session.Generation == generation, "Failed open invalidated a still-active session.");
        pending.GetService().SaveDraft(Request(shown, 20, v.Id), "甲"); Require(session.Service.GetSnapshot().Vouchers.Single().Lines[0].Debit == 20, "Valid pending input could not recover.");
    });
    Case("CLOSE-REOPEN-SAME-FILE-DOES-NOT-REVIVE-OLD-ORIGIN", () =>
    {
        using var session = new LedgerSession(backend); var path = Path.Combine(root, "reopen.caiwu"); session.Create(path, Book("reopen"), Accounts());
        var v = Seed(session.Service!); var shown = session.Service!.GetSnapshot(); var origin = new SessionBoundMutation(session, shown);
        session.Close(); session.Open(path); RejectUnchanged(session.Service!, () => origin.GetService().DeleteDraft(v.Id, "甲", origin.Context));
    });
}
finally
{
    var output = Path.GetFullPath(args.Length > 0 ? args[0] : "artifacts/revalidation/core-v12.json"); Directory.CreateDirectory(Path.GetDirectoryName(output)!);
    File.WriteAllText(output, JsonSerializer.Serialize(new { coreCommit = "66621203066488c7e7a4115ede508e88ec58e3fa", contractCommit = "bb76658c19df94ab79e257db076d2ac8a39b7997",
        combinationCommit = Environment.GetEnvironmentVariable("CAIWU_REVALIDATION_COMMIT"),
        actualSqlite = true, actualDesktopSessionAndPreviewSourcesLinked = true, windowsWpfExecuted = false,
        fixturePolicy = "Mutation arguments originate in explicit displayed/planned snapshots; no save/retry helper reads replacement tokens.",
        runtime = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription, os = System.Runtime.InteropServices.RuntimeInformation.OSDescription,
        passed = cases.Count - failed, failed, cases }, new JsonSerializerOptions { WriteIndented = true }));
    Directory.Delete(root, true);
}
return failed == 0 ? 0 : 1;

static void Invoke(ILedgerService s, string op, LedgerSnapshot shown, Guid id, LedgerMutationContext? context)
{
    switch (op)
    {
        case "SaveAccount": s.SaveAccount(shown.Accounts[0], "甲", context); break;
        case "DeleteAccount": s.DeleteAccount("1001", "甲", context); break;
        case "SetOpeningBalances": s.SetOpeningBalances([], "甲", context); break;
        case "DeleteDraft": s.DeleteDraft(id, "甲", context); break;
        case "Review": s.Review(id, "乙", context); break;
        case "CancelReview": s.CancelReview(id, "乙", context); break;
        case "Post": s.Post(id, "乙", context); break;
        case "CloseMonth": s.CloseMonth(10, "乙", context); break;
        default: throw new InvalidOperationException(op);
    }
}
