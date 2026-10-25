using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Desktop.Features;
using Caiwu.Desktop.Presentation;
using Caiwu.Persistence.Sqlite;
using Caiwu.Summaries;
using Caiwu.VoucherTools;
using Caiwu.Operators;

var results = new List<object>();
var root = Path.Combine(Path.GetTempPath(), "caiwu-feature-synthetic-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var accounts = new Account[] { new("1002", "银行存款", null, BalanceDirection.Debit, true, 0, 0), new("3001", "实收资本", null, BalanceDirection.Credit, true, 0, 0) };
var book = new BookInfo(Guid.NewGuid(), "合成桌面接入账套", AccountingRegime.SmallBusiness, "synthetic-feature-v1", 2026, 1, 0, DateTimeOffset.UtcNow);
var path = Path.Combine(root, "source.caiwu");
using (var seed = SqliteLedgerStore.Create(path, book, accounts))
{
    var service = new LedgerService(seed); var shown = service.GetSnapshot();
    service.SaveDraft(new(null, new(2026, 1, 1), "记", 1, 0,
        [new("1002", "合成源", 100.25m, 0), new("3001", "合成源", 0, 100.25m)], shown.Revision, shown.Book.Id), "源制单人");
}
const string syntheticPassword = "Feature-Only-Synthetic-Password!2026";
var operators = new LocalOperatorService(new FileOperatorStore(Path.Combine(root, "synthetic-operators")));
operators.InitializeAdministrator("fixture-admin", "合成管理员", syntheticPassword);
var admin = operators.Login("fixture-admin", syntheticPassword);
var maker = operators.AddOperator(admin, operators.GetDirectory(admin).Revision, "fixture-maker", "合成制单人", syntheticPassword,
    OperatorRoles.Preparer | OperatorRoles.Accountant | OperatorRoles.Administrator);
var login = operators.Login(maker.LoginName, syntheticPassword);
var authentication = new FeatureAuthentication(operators, login);
DesktopBackend Backend(OperatorSession fixedLogin) => new(p => SqliteLedgerStore.Open(p),
    (p, b, a) => SqliteLedgerStore.Create(p, b, a), SqliteLedgerStore.RestoreBackup,
    AuthorizedLedgerServiceFactory.BindSession(operators, fixedLogin, s => new PreviewLedgerService(new LedgerService(s))), []);
var backend = Backend(login);
using var session = new LedgerSession(backend); session.Open(path);
void Assert(bool value, string message) { if (!value) throw new Exception(message); }
async Task Reject<T>(Func<Task> action) where T : Exception
{ try { await action(); } catch (T) { return; } throw new Exception("Expected rejection: " + typeof(T).Name); }
async Task Check(string id, Func<Task> action)
{
    try { await action(); results.Add(new { id, passed = true }); Console.WriteLine("PASS " + id); }
    catch (Exception ex) { results.Add(new { id, passed = false, error = ex.ToString() }); Console.WriteLine("FAIL " + id + " " + ex.Message); }
}
PendingVoucherCopy Pending(int number)
{
    var shown = session.Snapshot!;
    var plan = new VoucherCopyPlanner().Plan(shown, shown.Vouchers[0].Id, new(new(2026, 1, 2), "记", number, 2, authentication.ActorKey)).Plan!;
    return new(new(session, shown, authentication), plan);
}
await Check("COPY-PLAN-AND-CANCEL-DO-NOT-WRITE", () =>
{
    var before = session.Service!.GetSnapshot(); var pending = Pending(2);
    Assert(pending.Plan.Draft.Id is null && pending.Plan.PreparedBy == authentication.ActorKey, "New identity/operator lost");
    Assert(session.Service.GetSnapshot().Revision == before.Revision, "Preparing/cancelling wrote data");
    Assert(pending.Plan.Draft.ExpectedRevision == before.Revision, "Original token lost"); return Task.CompletedTask;
});
await Check("COPY-EXPLICIT-SAVE-IS-NEW-DRAFT-ONCE", async () =>
{
    var pending = Pending(2); var saved = await pending.SaveAsync(pending.Plan.Draft);
    Assert(saved.Id != pending.Plan.SourceVoucherId && saved.Status == VoucherStatus.Draft && saved.ReviewedBy is null, "Source identity/status carried over");
    Assert(saved.PreparedBy == authentication.ActorKey && saved.Lines.SequenceEqual(pending.Plan.Draft.Lines), "Content/operator lost");
    await Reject<LedgerValidationException>(() => pending.SaveAsync(pending.Plan.Draft));
    Assert(session.Service!.GetSnapshot().Vouchers.Count == 2, "Duplicate write"); session.Refresh();
});
await Check("COPY-FAILURE-RETAINS-PLAN-AND-EDIT", async () =>
{
    var pending = Pending(3); var before = session.Service!.GetSnapshot();
    var invalid = pending.Plan.Draft with { Lines = [new("1002", "保留的人工输入", 2, 0), new("3001", "保留的人工输入", 0, 1)] };
    await Reject<LedgerValidationException>(() => pending.SaveAsync(invalid));
    Assert(pending.SavedVoucher is null && invalid.Lines[0].Summary == "保留的人工输入", "Failure consumed/changed pending input");
    Assert(session.Service.GetSnapshot().Revision == before.Revision, "Failed validation mutated ledger");
    var fixedDraft = invalid with { Lines = [new("1002", "保留的人工输入", 2, 0), new("3001", "保留的人工输入", 0, 2)] };
    await pending.SaveAsync(fixedDraft); session.Refresh();
});
await Check("COPY-FOREIGN-TOKEN-AND-ID-REJECTED", async () =>
{
    var pending = Pending(4);
    await Reject<StoreConcurrencyException>(() => pending.SaveAsync(pending.Plan.Draft with { ExpectedRevision = 999 }));
    await Reject<StoreConcurrencyException>(() => pending.SaveAsync(pending.Plan.Draft with { Id = Guid.NewGuid() }));
});
await Check("COPY-SAME-BOOK-ID-RESTORE-INVALIDATES", async () =>
{
    var pending = Pending(4); var backup = Path.Combine(root, "restore-source.caiwubak");
    session.BackupTo(backup); var restored = Path.Combine(root, "restored.caiwu"); session.RestoreTo(backup, restored); session.Open(restored);
    Assert(session.Snapshot!.Book.Id == pending.Binding.Shown.Book.Id, "Fixture changed BookId");
    await Reject<StoreConcurrencyException>(() => pending.SaveAsync(pending.Plan.Draft));
    Assert(pending.SavedVoucher is null && session.Service!.GetSnapshot().Vouchers.Count == 3, "Old window wrote restored book");
});
await Check("COPY-EXTERNAL-WRITER-DOES-NOT-REFRESH-TOKEN", async () =>
{
    var pending = Pending(4); var revision = pending.Plan.Draft.ExpectedRevision;
    using var other = SqliteLedgerStore.Open(session.DatabasePath!); var service = new LedgerService(other); var before = service.GetSnapshot();
    service.SaveDraft(new(null, new(2026, 1, 3), "记", 5, 0,
        [new("1002", "另一个窗口", 5, 0), new("3001", "另一个窗口", 0, 5)], before.Revision, before.Book.Id), "另一人");
    await Reject<StoreConcurrencyException>(() => pending.SaveAsync(pending.Plan.Draft));
    Assert(pending.Plan.Draft.ExpectedRevision == revision && pending.SavedVoucher is null, "Conflict refreshed token/consumed plan"); session.Refresh();
});
var catalogLocation = new SummaryCatalogLocation(root, Path.Combine(root, "summaries", "current.json"), book.Id);
var catalog = JsonSummaryCatalog.Create(catalogLocation);
await Check("SUMMARY-ATOMIC-EDIT-AND-BACKUP-REGISTRATION", () =>
{
    var bound = new SessionSummaryCatalog(new(session, session.Snapshot!, authentication), catalog); var before = bound.Read();
    var withCategory = bound.AddCategory("合成分类", before.Version);
    var next = bound.AddSummary(withCategory.Categories[0].Id, "合成摘要", withCategory.Version);
    var backup = bound.ExportBackup(Path.Combine(root, "attachments", "summary.json"));
    Assert(backup.BookId == book.Id && backup.Revision == next.Version.Revision && backup.Sha256 == next.Version.Sha256, "Backup receipt not exact version");
    Assert(bound.ValidateBackup(backup.Path, backup.Sha256) == backup, "Backup validation differs");
    return Task.CompletedTask;
});
await Check("SUMMARY-CONFLICT-RETAINS-EDIT-VERSION", () =>
{
    var bound = new SessionSummaryCatalog(new(session, session.Snapshot!, authentication), catalog);
    var state = new SummaryManagerState(bound, book.Name); Assert(state.Refresh(), "Refresh failed");
    Assert(state.BeginAddCategory(), "Begin failed"); state.DraftText = "保留分类名"; var token = state.EditVersion;
    catalog.AddCategory("并发分类", catalog.Read().Version);
    Assert(!state.Save() && state.DraftText == "保留分类名" && state.EditVersion == token && state.HasPendingEdit, "Conflict discarded/rebound edit");
    return Task.CompletedTask;
});
await Check("SUMMARY-SAME-BOOK-REOPEN-BLOCKS-OLD-WINDOW", async () =>
{
    var bound = new SessionSummaryCatalog(new(session, session.Snapshot!, authentication), catalog); var before = bound.Read();
    session.Open(session.DatabasePath!);
    await Reject<SummaryConflictException>(() => Task.Run(() => bound.AddCategory("不得写入", before.Version)));
    Assert(catalog.Read().Version == before.Version, "Old summary window wrote");
});
await Check("SUMMARY-ASYNC-ADAPTER-PERSISTS-ORIGINAL-EDIT-ID", async () =>
{
    var adapter = new AsyncSummaryStateAdapter(catalog, book.Name); Assert(await adapter.RefreshAsync(), "Initial async load failed");
    var state = adapter.State; var category = state.Categories[0]; state.SelectedCategoryId = category.Id;
    Assert(adapter.BeginEdit(state.BeginAddSummary), "Begin async summary failed"); state.DraftText = "异步管理原始摘要";
    Assert(await adapter.SaveAsync(), "Async create failed");
    var id = state.SelectedEntryId; Assert(id.HasValue, "New selection lost");
    Assert(adapter.BeginEdit(state.BeginEditSummary), "Begin edit failed"); state.DraftText = "搜索后仍编辑原ID";
    state.Query = "不存在的筛选"; Assert(state.SelectedEntryId is null, "Fixture should clear current selection");
    Assert(await adapter.SaveAsync(), "Changing filter changed frozen edit identity");
    Assert(catalog.Read().Entries.Single(e => e.Id == id).Text == "搜索后仍编辑原ID", "Wrong entry edited");
});
await Check("SUMMARY-ASYNC-CONFLICT-RETAINS-INPUT-AND-ORIGINAL-VERSION", async () =>
{
    var adapter = new AsyncSummaryStateAdapter(catalog, book.Name); await adapter.RefreshAsync(); var state = adapter.State;
    Assert(adapter.BeginEdit(state.BeginAddCategory), "Begin failed"); state.DraftText = "异步冲突保留"; var token = state.EditVersion;
    catalog.AddCategory("异步外部写入", catalog.Read().Version);
    Assert(!await adapter.SaveAsync(), "Late save succeeded");
    Assert(state.HasPendingEdit && state.DraftText == "异步冲突保留" && state.EditVersion == token, "Async conflict lost input/version");
});
await Check("SUMMARY-ASYNC-CANCEL-HAS-NO-WRITE", async () =>
{
    var adapter = new AsyncSummaryStateAdapter(catalog, book.Name); await adapter.RefreshAsync(); var before = catalog.Read().Version;
    adapter.BeginEdit(adapter.State.BeginAddCategory); adapter.State.DraftText = "取消不写入"; adapter.State.CancelEdit();
    Assert(!await adapter.SaveAsync() && catalog.Read().Version == before, "Cancel wrote or saved");
});
await Check("BINDING-CLOSE-AND-REFRESH-INVALIDATION", () =>
{
    var binding = new FeatureSessionBinding(session, session.Snapshot!, authentication); session.Close(); Assert(!binding.IsCurrent, "Close did not invalidate");
    session.Open(path); var refreshed = new FeatureSessionBinding(session, session.Snapshot!, authentication);
    Assert(refreshed.IsCurrent, "Fresh displayed binding invalid"); return Task.CompletedTask;
});
await Check("AUTH-MISSING-LOGIN-AND-RAW-SERVICE-FAIL-CLOSED", async () =>
{
    await Reject<OperatorAuthorizationException>(() => Task.Run(() => new FeatureSessionBinding(session, session.Snapshot!, null!)));
    var rawBackend = backend with { CreateService = s => new PreviewLedgerService(new LedgerService(s)) };
    using var rawSession = new LedgerSession(rawBackend); rawSession.Open(path);
    await Reject<OperatorAuthorizationException>(() => Task.Run(() => new FeatureSessionBinding(rawSession, rawSession.Snapshot!, authentication)));
});
await Check("AUTH-READER-CANNOT-SAVE-COPIED-DRAFT", async () =>
{
    var reader = operators.AddOperator(admin, operators.GetDirectory(admin).Revision, "fixture-reader", "合成只读员", syntheticPassword, OperatorRoles.Reader);
    var readerLogin = operators.Login(reader.LoginName, syntheticPassword); var readerAuth = new FeatureAuthentication(operators, readerLogin);
    using var readerBook = new LedgerSession(Backend(readerLogin)); readerBook.Open(path); var shown = readerBook.Snapshot!;
    var plan = new VoucherCopyPlanner().Plan(shown, shown.Vouchers[0].Id, new(new(2026, 1, 2), "记", 6, 0, readerAuth.ActorKey)).Plan!;
    var pending = new PendingVoucherCopy(new(readerBook, shown, readerAuth), plan);
    await Reject<OperatorAuthorizationException>(() => pending.SaveAsync(plan.Draft));
    Assert(readerBook.Service!.GetSnapshot().Revision == shown.Revision && pending.SavedVoucher is null, "Reader reached ledger write"); operators.Logout(readerLogin);
});
await Check("AUTH-LOGOUT-NEW-LOGIN-DOES-NOT-REACTIVATE-OLD-WINDOW", async () =>
{
    var pending = Pending(6); var oldSummary = new SessionSummaryCatalog(pending.Binding, catalog); var version = catalog.Read().Version;
    operators.Logout(login); var replacement = operators.Login(maker.LoginName, syntheticPassword);
    await Reject<OperatorAuthorizationException>(() => pending.SaveAsync(pending.Plan.Draft));
    await Reject<SummaryConflictException>(() => Task.Run(() => oldSummary.AddCategory("注销不得写入", version)));
    await authentication.CheckAsync(); Assert(!pending.Binding.IsCurrent, "Revoked operator still current");
    using var fresh = new LedgerSession(Backend(replacement)); fresh.Open(path);
    Assert(fresh.Service!.GetSnapshot().Book.Id == book.Id && catalog.Read().Version == version, "New login failed or old summary wrote");
    operators.Logout(replacement);
});
var failed = results.Any(r => (bool)r.GetType().GetProperty("passed")!.GetValue(r)! == false);
var evidence = new { framework = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription, syntheticOnly = true,
    windowsExecuted = false, results };
if (args.Length > 0) { var target = Path.GetFullPath(args[0]); Directory.CreateDirectory(Path.GetDirectoryName(target)!); File.WriteAllText(target, JsonSerializer.Serialize(evidence, new JsonSerializerOptions { WriteIndented = true })); }
Console.WriteLine(JsonSerializer.Serialize(evidence));
session.Close(); Directory.Delete(root, true);
return failed ? 1 : 0;
