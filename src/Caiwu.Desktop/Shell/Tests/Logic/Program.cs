using System.Text.Json;
using System.Security.Cryptography;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Desktop.Presentation;
using Caiwu.Desktop.Shell;
using Caiwu.Operators;
using Caiwu.Persistence.Sqlite;

var root = Path.GetFullPath(args.Length == 0 ? "." : args[0]);
var results = new List<string>();
void Check(bool test, string message) { if (!test) throw new Exception(message); results.Add(message); Console.WriteLine("PASS " + message); }
void Reject<T>(Action action, string message) where T : Exception
{ try { action(); } catch (T) { Check(true, message); return; } throw new Exception("Expected rejection: " + message); }

using (var source = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "docs/original-analysis/json/menus.json"))))
{
    void Compare(JsonElement[] expected, ShellMenu[] actual)
    {
        Check(expected.Length == actual.Length, "menu child count retained");
        for (var i = 0; i < actual.Length; i++)
        {
            var e = expected[i]; var a = actual[i];
            if (e.GetProperty("name").GetString() != a.Id || e.GetProperty("text").GetString() != a.Text ||
                e.GetProperty("visible").GetBoolean() != a.Visible || e.GetProperty("shortcut").GetString() != a.Shortcut)
                throw new Exception("Original menu deviated: " + a.Id);
            var children = e.GetProperty("children").EnumerateArray().ToArray();
            if (children.Length > 0) Compare(children, a.Children);
        }
    }
    Compare(source.RootElement.GetProperty("qingsong/main").GetProperty("m_frame_zw").GetProperty("items").EnumerateArray().ToArray(), OriginalShellCatalog.AccountingMenu);
    var operations = source.RootElement.GetProperty("qingsong/main").GetProperty("m_work_pz_pzxsb").GetProperty("items").EnumerateArray().Single(i => i.GetProperty("name").GetString() == "m_operation");
    Compare(operations.GetProperty("children").EnumerateArray().ToArray(), OriginalShellCatalog.VoucherOperations.Children);
    Check(OriginalShellCatalog.AccountingMenu.Where(m => m.Visible).Select(m => m.Text).SequenceEqual(new[] { "F.文件", "O日常业务", "I 基础档案", "S系统管理", "W.窗口", "H.帮助" }), "six original visible menu groups remain in order");
}
using (var source = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "docs/original-analysis/json/windows.json"))))
{
    var original = source.RootElement.GetProperty("qingsong/main").GetProperty("w_main1");
    var controls = new Dictionary<string, JsonElement>();
    void Collect(JsonElement items) { foreach (var item in items.EnumerateArray()) { controls.Add(item.GetProperty("name").GetString()!, item); Collect(item.GetProperty("children")); } }
    Collect(original.GetProperty("controls"));
    foreach (var link in OriginalShellCatalog.Workbench)
    {
        var p = controls[link.Id].GetProperty("props");
        if (double.Parse(p.GetProperty("x").GetString()!) != link.X || double.Parse(p.GetProperty("y").GetString()!) != link.Y)
            throw new Exception("Workbench relative position deviated: " + link.Id);
    }
    Check(true, "every implemented workbench anchor matches existing PBU source; no runtime pixel claim");
}
Check(ShellShortcuts.Parse("Delete") == new ShellGesture("Delete", ShellModifiers.None), "original unmodified Delete is a valid contextual shortcut");
Check(ShellShortcuts.Parse("Shift+F4") == new ShellGesture("F4", ShellModifiers.Shift) && ShellShortcuts.Parse("Ctrl+F4") == new ShellGesture("F4", ShellModifiers.Control), "close and arrange shortcuts retain distinct modifiers");
Check(ShellShortcuts.Parse("Ctrl+Ctrl+F4") is null && ShellShortcuts.Parse("Meta+F4") is null, "unknown or duplicate shortcut modifiers are not guessed");
Check(ShellLogin.ParseDate("2024-02-29") == new DateOnly(2024, 2, 29), "explicit leap date preserved");
foreach (var date in new[] { "2026-02-29", "2026-2-1", "", "2026-13-01", "2026-01-01 ", "today" })
    Reject<ArgumentException>(() => ShellLogin.ParseDate(date), "invalid date rejected: " + date);
Reject<ArgumentException>(() => ShellLogin.ValidateDate(new(2026, 9, 30), 2026, 10), "date before opening rejected");
Reject<ArgumentException>(() => ShellLogin.ValidateDate(new(2027, 1, 1), 2026, 10), "unsupported later year explicitly rejected");
var choices = new[] { new ShellBookChoice("/synthetic/a", "合成 A", "02"), new ShellBookChoice("/synthetic/b", "合成 b", "01") };
Check(ShellLogin.Search(choices, "合成").Select(b => b.Code).SequenceEqual(new[] { "01", "02" }) && ShellLogin.Search(choices, "B").Single().Code == "01", "book search by name/code is deterministic");
foreach (var arrange in Enum.GetValues<MdiArrangement>())
{
    Check(MdiLayout.Arrange(arrange, 0, 1280, 720).Length == 0, "empty MDI arrangement " + arrange);
    var sheets = MdiLayout.Arrange(arrange, 5, 1280, 720);
    Check(sheets.Length == 5 && sheets.All(b => b.X >= 0 && b.Y >= 0 && b.Width > 0 && b.Height > 0 && double.IsFinite(b.Width)), "finite MDI bounds " + arrange);
    if (arrange == MdiArrangement.Vertical) Check(sheets.Zip(sheets.Skip(1)).All(p => p.First.X + p.First.Width <= p.Second.X), "vertical tiles do not overlap even when scrolling is required");
    if (arrange == MdiArrangement.Horizontal) Check(sheets.Zip(sheets.Skip(1)).All(p => p.First.Y + p.First.Height <= p.Second.Y), "horizontal tiles do not overlap even when scrolling is required");
}
Reject<ArgumentOutOfRangeException>(() => MdiLayout.Arrange(MdiArrangement.Fill, 2, double.NaN, 500), "nonfinite workspace rejected");

var folder = Path.Combine(Path.GetTempPath(), "caiwu-shell-synthetic-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(folder);
try
{
    var identityDirectory = Path.Combine(folder, "operators");
    var service = new LocalOperatorService(new FileOperatorStore(identityDirectory));
    Check(service.GetLoginNames().Count == 0 && service.IsFirstUse, "login picker does not initialize administrator or grant a session");
    service.InitializeAdministrator("admin", "合成管理员", "Synthetic-Admin-9!");
    var admin = service.Login("admin", "Synthetic-Admin-9!");
    service.AddOperator(admin, service.GetDirectory(admin).Revision, "reviewer", "合成审核员", "Synthetic-Review-9!", OperatorRoles.Reviewer | OperatorRoles.Poster | OperatorRoles.Reader);
    service.AddOperator(admin, service.GetDirectory(admin).Revision, "preparer", "合成制单员", "Synthetic-Prepare-9!", OperatorRoles.Preparer | OperatorRoles.Accountant | OperatorRoles.Reader);
    var reader = service.AddOperator(admin, service.GetDirectory(admin).Revision, "reader", "合成只读", "Synthetic-Reader-9!", OperatorRoles.Reader);
    service.UpdateOperator(admin, service.GetDirectory(admin).Revision, reader.Id, reader.DisplayName, reader.Roles, false);
    var identityPath = Path.Combine(identityDirectory, "operators.json"); var identityBefore = SHA256.HashData(File.ReadAllBytes(identityPath));
    Check(service.GetLoginNames().SequenceEqual(new[] { "ADMIN", "PREPARER", "REVIEWER" }), "login picker includes only enabled local login codes");
    Check(identityBefore.SequenceEqual(SHA256.HashData(File.ReadAllBytes(identityPath))), "listing login codes leaves identities and hashes unchanged");
    Reject<OperatorAuthorizationException>(() => service.Login("admin", "wrong"), "login picker never bypasses password validation");
    var template = TemplateCatalog.Get(AccountingRegime.SmallBusiness);
    var book = new BookInfo(Guid.NewGuid(), "仅合成 shell fixture", AccountingRegime.SmallBusiness, template.Version, 2026, 10, 9, DateTimeOffset.UtcNow);
    var first = Path.Combine(folder, "first.caiwu"); var second = Path.Combine(folder, "second.caiwu");
    using (SqliteLedgerStore.Create(first, book, template.Accounts)) { }
    using (SqliteLedgerStore.Create(second, book with { Id = Guid.NewGuid(), Name = "第二合成账套" }, template.Accounts)) { }
    DesktopBackend Backend(OperatorSession login) => new(
        path => service.Execute(login, OperatorPermission.ReadLedger, _ => (ILedgerStore)SqliteLedgerStore.Open(path)),
        (path, info, accounts) => service.Execute(login, OperatorPermission.RestoreLedger, _ => (ILedgerStore)SqliteLedgerStore.Create(path, info, accounts)),
        (_, _) => throw new NotSupportedException(),
        store => new AuthorizedLedgerService(new LedgerService(store), service, login), [template]);
    var coordinator = new ShellLoginCoordinator(service, Backend);
    Reject<ArgumentException>(() => coordinator.Login(null, "admin", "Synthetic-Admin-9!", "2026-10-08"), "missing book rejected before authentication");
    var named = new ShellBookChoice(first, "not trusted display text");
    var loginResult = coordinator.Login(named, "preparer", "Synthetic-Prepare-9!", "2026-10-08")!;
    Check(loginResult.BookId == book.Id && loginResult.Book.Name == book.Name && loginResult.OperationDate == new DateOnly(2026, 10, 8), "login binds real book identity/name and explicit operation date");
    using var session = new LedgerSession(Backend(loginResult.Session)); session.Open(first);
    var shown = session.Snapshot!; var binding = new SessionBoundMutation(session, shown);
    var draft = session.Service!.SaveDraft(new(null, loginResult.OperationDate, "记", null, 0,
        [new("1002", "合成 shell 录入", 25m, 0), new("3001", "合成 shell 录入", 0, 25m)], shown.Revision, shown.Book.Id), "forged UI name");
    Check(draft.Date == loginResult.OperationDate && draft.PreparedBy == loginResult.Session.Identity.ActorKey, "existing real save behavior and authenticated actor survive shell integration");
    Reject<OperatorAuthorizationException>(() => session.Service.Review(draft.Id, "forged reviewer", new(book.Id, session.Service.GetSnapshot().Revision)), "preparer cannot self-review through shell");
    session.Open(second);
    Reject<StoreConcurrencyException>(() => binding.GetService(), "old displayed mutation cannot target switched book");
    Reject<OperatorStorageException>(() => session.Open(Path.Combine(folder, "missing.caiwu")), "missing replacement book rejected");
    Check(session.Snapshot!.Book.Name == "第二合成账套", "failed book open preserves current session");
    var reviewLogin = coordinator.Login(named, "reviewer", "Synthetic-Review-9!", "2026-10-08")!;
    using (var reviewSession = new LedgerSession(Backend(reviewLogin.Session)))
    {
        reviewSession.Open(first); var ledger = reviewSession.Service!;
        ledger.Review(draft.Id, "ignored", new(book.Id, ledger.GetSnapshot().Revision));
        ledger.Post(draft.Id, "ignored", new(book.Id, ledger.GetSnapshot().Revision));
        Check(ledger.GetSnapshot().Vouchers.Single().Status == VoucherStatus.Posted && ledger.GetTrialBalance(new(2026, 10, 1), new(2026, 10, 31)).Single(r => r.AccountCode == "1002").PeriodDebit == 25m,
            "separate reviewer posts real synthetic voucher and balance query reads persisted result");
    }
    service.Logout(loginResult.Session);
    Reject<OperatorAuthorizationException>(() => session.Service!.GetSnapshot(), "logout revokes old fixed-login backend");
    OperatorSession? cancelled = null;
    var cancellation = coordinator.Login(null, "admin", "Synthetic-Admin-9!", "2026-10-08", issued => { cancelled = issued; return null; });
    Check(cancellation is null, "cancelled creation returns no successful login");
    Reject<OperatorAuthorizationException>(() => service.RequirePermission(cancelled!, OperatorPermission.ReadLedger), "cancelled login releases issued session");
    OperatorSession? badDate = null;
    Reject<ArgumentException>(() => coordinator.Login(null, "admin", "Synthetic-Admin-9!", "2026-09-30", issued => { badDate = issued; return named; }), "book/date validation fails after authentication");
    Reject<OperatorAuthorizationException>(() => service.RequirePermission(badDate!, OperatorPermission.ReadLedger), "failed date validation releases issued session");
    OperatorSession? badOpen = null;
    Reject<OperatorStorageException>(() => coordinator.Login(null, "admin", "Synthetic-Admin-9!", "2026-10-08", issued => { badOpen = issued; return new(Path.Combine(folder, "missing.caiwu"), "missing"); }), "book open failure prevents login result");
    Reject<OperatorAuthorizationException>(() => service.RequirePermission(badOpen!, OperatorPermission.ReadLedger), "failed open releases issued session");
    service.Logout(reviewLogin.Session); service.Logout(admin);
}
finally { Directory.Delete(folder, true); }
Console.WriteLine(JsonSerializer.Serialize(new { kind = "synthetic-linux-shell-logic-and-sqlite", passed = results.Count, windowsUiExecuted = false, originalProgramExecuted = false, results }));
