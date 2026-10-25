using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Desktop.Presentation;
using Caiwu.Persistence.Sqlite;

var folder = Path.Combine(Path.GetTempPath(), "caiwu-independent-53fe-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(folder);
var output = args[0]; var results = new List<object>(); var passed = 0; var failed = 0;
void Assert(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
void Case(string id, Action action)
{
    try { action(); passed++; results.Add(new { id, status = "PASS" }); Console.WriteLine("PASS " + id); }
    catch (Exception e) { failed++; results.Add(new { id, status = "FAIL", error = e.ToString() }); Console.WriteLine("FAIL " + id + " " + e.Message); }
}
Account[] Accounts() => [new("1001", "现金", null, BalanceDirection.Debit, true, 0, 0),
    new("1002", "银行", null, BalanceDirection.Debit, true, 0, 0), new("3001", "资本", null, BalanceDirection.Credit, true, 0, 0)];
SqliteLedgerStore Store(string name) => SqliteLedgerStore.Create(Path.Combine(folder, name + ".caiwu"),
    new(Guid.NewGuid(), name, AccountingRegime.SmallBusiness, "acceptance", 2026, 10, 9, DateTimeOffset.UtcNow), Accounts());
VoucherDraft New(decimal amount = 10) => new(null, new(2026, 10, 1), "记", null, 0,
    [new("1002", "编辑开始原始摘要", amount, 0), new("3001", "编辑开始原始摘要", 0, amount)]);
// One read at editor opening. The voucher and BOTH tokens always come from this same object.
VoucherDraft BeginEdit(ILedgerService service, Guid id)
{
    var openingSnapshot = service.GetSnapshot(); var voucher = openingSnapshot.Vouchers.Single(v => v.Id == id);
    return new(voucher.Id, voucher.Date, voucher.Kind, voucher.Number, voucher.AttachmentCount, voucher.Lines,
        openingSnapshot.Revision, openingSnapshot.Book.Id);
}
VoucherDraft Amount(VoucherDraft request, decimal amount) => request with
    { Lines = [new("1002", "编辑中保留摘要", amount, 0), new("3001", "编辑中保留摘要", 0, amount)] };
string Snapshot(ILedgerStore store) => JsonSerializer.Serialize(store.Read());
void RejectUnchanged<T>(ILedgerStore store, Action action) where T : Exception
{
    var before = Snapshot(store); T? rejection = null;
    try { action(); } catch (T e) { rejection = e; }
    Assert(rejection is not null, "Expected " + typeof(T).Name + " but operation succeeded.");
    Assert(Snapshot(store) == before, "Rejected command changed persisted values, audit, or revision.");
}
try
{
    Case("VALID-EDIT-DURABLE", () =>
    {
        var path = ""; Guid id;
        using (var s = Store("valid"))
        {
            path = s.DatabasePath; ILedgerService service = new LedgerService(s); id = service.SaveDraft(New(), "甲").Id;
            var editor = BeginEdit(service, id); var edited = service.SaveDraft(Amount(editor, 20), "甲");
            Assert(edited.Id == id && edited.Lines[0].Debit == 20 && s.Read().Vouchers.Count == 1, "Valid edit appended or failed.");
        }
        using var reopened = SqliteLedgerStore.Open(path);
        Assert(reopened.Read().Vouchers.Single().Id == id && reopened.Read().Vouchers.Single().Lines[0].Debit == 20, "Edit was not durable.");
    });
    Case("ACC002-TWO-REAL-CONNECTIONS-STALE-EDITOR", () =>
    {
        using var a = Store("stale"); ILedgerService one = new LedgerService(a); var id = one.SaveDraft(New(), "甲").Id;
        using var b = SqliteLedgerStore.Open(a.DatabasePath); ILedgerService two = new LedgerService(b);
        var editorA = BeginEdit(one, id); var editorB = BeginEdit(two, id); var bInput = Amount(editorB, 30);
        one.SaveDraft(Amount(editorA, 20), "甲"); var inputBefore = JsonSerializer.Serialize(bInput);
        RejectUnchanged<StoreConcurrencyException>(b, () => two.SaveDraft(bInput, "甲"));
        Assert(a.Read().Vouchers.Single().Lines[0].Debit == 20 && JsonSerializer.Serialize(bInput) == inputBefore, "Conflict replaced new data or altered caller input.");
    });
    foreach (var missing in new[] { "both", "revision", "book" })
        Case("EXISTING-MISSING-" + missing.ToUpperInvariant(), () =>
        {
            using var s = Store("missing-" + missing); ILedgerService service = new LedgerService(s); var id = service.SaveDraft(New(), "甲").Id;
            var editor = BeginEdit(service, id);
            editor = editor with { ExpectedRevision = missing is "both" or "revision" ? null : editor.ExpectedRevision,
                ExpectedBookId = missing is "both" or "book" ? null : editor.ExpectedBookId };
            RejectUnchanged<StoreConcurrencyException>(s, () => service.SaveDraft(Amount(editor, 20), "甲"));
        });
    Case("CROSS-BOOK-SAME-REVISION-SAME-VOUCHER-ID", () =>
    {
        using var a = Store("cross-a"); ILedgerService one = new LedgerService(a); var v = one.SaveDraft(New(), "甲");
        var editorA = BeginEdit(one, v.Id);
        using var b = Store("cross-b"); var fixture = b.Read();
        // Deliberate fixture: the ID exists in B and the revisions are equal, so neither a
        // missing ID nor stale revision can accidentally make this cross-book test pass.
        b.Write(fixture with { Revision = fixture.Revision + 1, Vouchers = [v] }, fixture.Revision);
        ILedgerService two = new LedgerService(b); var openingB = two.GetSnapshot();
        Assert(openingB.Revision == editorA.ExpectedRevision && openingB.Vouchers.Single().Id == editorA.Id && openingB.Book.Id != editorA.ExpectedBookId,
            "Cross-book fixture failed to equalize ID/revision.");
        var beforeA = Snapshot(a);
        RejectUnchanged<StoreConcurrencyException>(b, () => two.SaveDraft(Amount(editorA, 99), "甲"));
        Assert(Snapshot(a) == beforeA, "Wrong-book rejection changed source book.");
    });
    Case("EXISTING-STALE-REVISION-AFTER-UNRELATED-WRITE", () =>
    {
        using var s = Store("unrelated"); ILedgerService service = new LedgerService(s); var id = service.SaveDraft(New(), "甲").Id;
        var editor = BeginEdit(service, id); var account = service.GetSnapshot().Accounts.Single(a => a.Code == "1001");
        service.SaveAccount(account with { Name = "别处更新科目" }, "乙");
        RejectUnchanged<StoreConcurrencyException>(s, () => service.SaveDraft(Amount(editor, 20), "甲"));
    });
    foreach (var revision in new[] { -1L, long.MaxValue })
        Case("EXISTING-INVALID-REVISION-" + revision, () =>
        {
            using var s = Store("badrevision-" + revision); ILedgerService service = new LedgerService(s); var id = service.SaveDraft(New(), "甲").Id;
            var editor = BeginEdit(service, id) with { ExpectedRevision = revision };
            RejectUnchanged<StoreConcurrencyException>(s, () => service.SaveDraft(editor, "甲"));
        });
    Case("NONEXISTENT-ID-WITH-CORRECT-OPENING-TOKEN", () =>
    {
        using var s = Store("nonexistent"); ILedgerService service = new LedgerService(s); var id = service.SaveDraft(New(), "甲").Id;
        var editor = BeginEdit(service, id) with { Id = Guid.NewGuid() };
        RejectUnchanged<LedgerValidationException>(s, () => service.SaveDraft(editor, "甲"));
    });
    Case("NONEXISTENT-ID-WITHOUT-TOKEN", () =>
    {
        using var s = Store("nonexistent-no-token"); ILedgerService service = new LedgerService(s);
        RejectUnchanged<StoreConcurrencyException>(s, () => service.SaveDraft(New() with { Id = Guid.NewGuid() }, "甲"));
    });
    Case("DOMAIN-FAILURE-CAN-CORRECT-INPUT-WITH-SAME-OPENING-TOKEN", () =>
    {
        using var s = Store("correct-input"); ILedgerService service = new LedgerService(s); var id = service.SaveDraft(New(), "甲").Id;
        var editor = BeginEdit(service, id);
        var invalid = editor with { Lines = [new("1002", "保留摘要", 20, 0), new("3001", "保留摘要", 0, 19)] };
        RejectUnchanged<LedgerValidationException>(s, () => service.SaveDraft(invalid, "甲"));
        // No new GetSnapshot/token read here: the rejected attempt changed nothing.
        service.SaveDraft(Amount(editor, 20), "甲"); Assert(s.Read().Vouchers.Single().Lines[0].Debit == 20, "Corrected retry failed.");
    });
    Case("CAS-RACE-AFTER-TOKEN-CHECK-REAL-SQLITE", () =>
    {
        using var underlying = Store("race"); using var competitor = SqliteLedgerStore.Open(underlying.DatabasePath);
        var gate = new BeforeWriteStore(underlying); ILedgerService service = new LedgerService(gate); var id = service.SaveDraft(New(), "甲").Id;
        var editor = BeginEdit(service, id); string? afterCompetitor = null;
        gate.BeforeWrite = () => { new LedgerService(competitor).SaveDraft(New(7), "乙"); afterCompetitor = Snapshot(competitor); };
        var rejected = false;
        try { service.SaveDraft(Amount(editor, 20), "甲"); } catch (StoreConcurrencyException) { rejected = true; }
        Assert(rejected && afterCompetitor is not null && Snapshot(underlying) == afterCompetitor, "CAS race overwrote competitor or persisted outer audit.");
        Assert(underlying.Read().Vouchers.Single(v => v.Id == id).Lines[0].Debit == 10, "Stale edit persisted in race.");
    });
    Case("NEW-NO-TOKEN-REMAINS-SUPPORTED", () =>
    { using var s = Store("new-compatible"); ILedgerService service = new LedgerService(s); service.SaveDraft(New(), "甲"); Assert(s.Read().Vouchers.Count == 1, "Legacy create failed."); });
    Case("NEW-PROVIDED-STALE-TOKEN-REJECTED", () =>
    {
        using var s = Store("new-stale"); ILedgerService service = new LedgerService(s); var opening = service.GetSnapshot();
        var editor = New() with { ExpectedRevision = opening.Revision, ExpectedBookId = opening.Book.Id };
        service.SaveDraft(New(5), "乙"); RejectUnchanged<StoreConcurrencyException>(s, () => service.SaveDraft(editor, "甲"));
    });
    Case("NEW-PROVIDED-WRONG-BOOK-REJECTED", () =>
    {
        using var s = Store("new-wrong-book"); ILedgerService service = new LedgerService(s); var opening = service.GetSnapshot();
        var editor = New() with { ExpectedRevision = opening.Revision, ExpectedBookId = Guid.NewGuid() };
        RejectUnchanged<StoreConcurrencyException>(s, () => service.SaveDraft(editor, "甲"));
    });
    Case("POSTED-STILL-IMMUTABLE-WITH-CURRENT-TOKEN", () =>
    {
        using var s = Store("posted"); ILedgerService service = new LedgerService(s); var id = service.SaveDraft(New(), "甲").Id;
        service.Review(id, "乙"); service.Post(id, "乙"); var editor = BeginEdit(service, id);
        RejectUnchanged<LedgerValidationException>(s, () => service.SaveDraft(Amount(editor, 20), "甲"));
    });
    Case("ACC003-UI-ROWS-DISABLED-ZERO-LEAF", () =>
    {
        using var s = Store("opening-zero"); ILedgerService service = new LedgerService(s); var account = service.GetSnapshot().Accounts.Single(a => a.Code == "1001");
        service.SaveAccount(account with { IsActive = false }, "甲"); var opening = service.GetSnapshot();
        var rows = opening.Accounts.Where(a => !opening.Accounts.Any(c => c.ParentCode == a.Code)).Select(a => new OpeningBalanceEdit(a)).ToArray();
        rows.Single(r => r.Code == "1002").DebitText = "100.01"; rows.Single(r => r.Code == "3001").CreditText = "100.01";
        service.SetOpeningBalances(rows.Select(r => r.ToBalance()).ToArray(), "甲");
        Assert(s.Read().Accounts.Single(a => a.Code == "1002").OpeningDebit == 100.01m && !s.Read().Accounts.Single(a => a.Code == "1001").IsActive, "Disabled zero row prevented or changed opening.");
    });
    Case("DISABLED-NONZERO-OPENING-PRESERVED", () =>
    {
        using var s = Store("opening-preserve"); ILedgerService service = new LedgerService(s);
        service.SetOpeningBalances([new("1002", 100, 0), new("3001", 0, 100)], "甲");
        var account = service.GetSnapshot().Accounts.Single(a => a.Code == "1002"); service.SaveAccount(account with { IsActive = false }, "甲");
        service.SetOpeningBalances([new("1001", 20, 0), new("1002", 100, 0), new("3001", 0, 120)], "甲");
        Assert(s.Read().Accounts.Single(a => a.Code == "1002").OpeningDebit == 100, "Disabled history cleared.");
    });
    Case("DISABLED-NONZERO-OMITTED-REJECTED", () =>
    {
        using var s = Store("opening-omit"); ILedgerService service = new LedgerService(s);
        service.SetOpeningBalances([new("1002", 100, 0), new("3001", 0, 100)], "甲");
        service.SaveAccount(service.GetSnapshot().Accounts.Single(a => a.Code == "1002") with { IsActive = false }, "甲");
        RejectUnchanged<LedgerValidationException>(s, () => service.SetOpeningBalances([], "甲"));
    });
    Case("DISABLED-NONZERO-EXPLICIT-ZERO-REJECTED", () =>
    {
        using var s = Store("opening-clear"); ILedgerService service = new LedgerService(s);
        service.SetOpeningBalances([new("1002", 100, 0), new("3001", 0, 100)], "甲");
        service.SaveAccount(service.GetSnapshot().Accounts.Single(a => a.Code == "1002") with { IsActive = false }, "甲");
        RejectUnchanged<LedgerValidationException>(s, () => service.SetOpeningBalances([new("1002", 0, 0)], "甲"));
    });
    Case("DISABLED-ZERO-CANNOT-GAIN-OPENING", () =>
    {
        using var s = Store("opening-add-disabled"); ILedgerService service = new LedgerService(s);
        service.SaveAccount(service.GetSnapshot().Accounts.Single(a => a.Code == "1002") with { IsActive = false }, "甲");
        RejectUnchanged<LedgerValidationException>(s, () => service.SetOpeningBalances([new("1002", 10, 0), new("3001", 0, 10)], "甲"));
    });
    Case("DISABLED-ACCOUNT-STILL-REJECTED-IN-VOUCHER", () =>
    {
        using var s = Store("opening-no-permission-widen"); ILedgerService service = new LedgerService(s);
        service.SaveAccount(service.GetSnapshot().Accounts.Single(a => a.Code == "1002") with { IsActive = false }, "甲");
        RejectUnchanged<LedgerValidationException>(s, () => service.SaveDraft(New(), "甲"));
    });
}
finally
{
    Directory.CreateDirectory(Path.GetDirectoryName(output)!);
    File.WriteAllText(output, JsonSerializer.Serialize(new
    {
        coreFixCommit = "53fe0f2d2744e557dab98bf2652ffa5fce644c25",
        integrationContractComparedAt = "ce6064dc9a6e0831560314b0340d45da63a2f140",
        checkoutCommit = Environment.GetEnvironmentVariable("CAIWU_REVIEW_CHECKOUT_COMMIT"),
        coreBlob = Environment.GetEnvironmentVariable("CAIWU_REVIEW_CORE_BLOB"),
        contractsTree = Environment.GetEnvironmentVariable("CAIWU_REVIEW_CONTRACTS_TREE"),
        sqliteTree = Environment.GetEnvironmentVariable("CAIWU_REVIEW_SQLITE_TREE"),
        executedAtUtc = DateTimeOffset.UtcNow,
        runtime = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
        os = System.Runtime.InteropServices.RuntimeInformation.OSDescription,
        tokenFixturePolicy = "Capture voucher and both tokens from one opening snapshot; never refresh tokens inside save/retry.",
        actualSqlite = true, wpfExecuted = false, passed, failed, results
    }, new JsonSerializerOptions { WriteIndented = true }));
    Directory.Delete(folder, true);
}
Console.WriteLine($"Independent 53fe revalidation: {passed} PASS, {failed} FAIL; {output}");
return failed == 0 ? 0 : 1;

sealed class BeforeWriteStore(ILedgerStore inner) : ILedgerStore
{
    public Action? BeforeWrite { get; set; }
    public string DatabasePath => inner.DatabasePath;
    public LedgerSnapshot Read() => inner.Read();
    public void Write(LedgerSnapshot next, long expectedRevision)
    { var hook = BeforeWrite; BeforeWrite = null; hook?.Invoke(); inner.Write(next, expectedRevision); }
    public void BackupTo(string path) => inner.BackupTo(path);
    public void CheckIntegrity() => inner.CheckIntegrity();
    public void Dispose() { } // Fixture owns the actual SQLite connection.
}
