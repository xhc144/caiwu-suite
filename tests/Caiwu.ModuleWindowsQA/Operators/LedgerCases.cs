using System.IO;
using System.Windows;
using System.Windows.Controls;
using Caiwu.Contracts;
using Caiwu.Desktop.Presentation;
using Caiwu.Operators;
using Caiwu.Operators.Tests.WindowsSmoke;
using Caiwu.Persistence.Sqlite;

internal static partial class Program
{
    private static readonly Account[] Accounts = [new("1002", "银行存款", null, BalanceDirection.Debit, true, 0, 0), new("3001", "实收资本", null, BalanceDirection.Credit, true, 0, 0)];
    private static BookInfo NewBook(string title) => new(Guid.NewGuid(), title, AccountingRegime.SmallBusiness, "synthetic-operators-qa", 2026, 1, 0, DateTimeOffset.UtcNow);
    private static LedgerMutationContext Context(ILedgerService service) { var s = service.GetSnapshot(); return new(s.Book.Id, s.Revision); }
    private static VoucherDraft Draft(LedgerSnapshot s, Guid? id = null, decimal amount = 10m) => new(id, new(2026, 1, 1), "记", null, 0,
        [new("1002", "虚构注资", amount, 0), new("3001", "虚构注资", 0, amount)], s.Revision, s.Book.Id);
    private static void LedgerLoop()
    {
        var path = Path.Combine(temporary, "ledger-loop.caiwu");
        using (var creator = new LedgerSession(DesktopCompositionExample.CreateBackend(operators, admin))) creator.Create(path, NewBook("合成授权闭环"), Accounts);
        using var administrative = new LedgerSession(DesktopCompositionExample.CreateBackend(operators, admin)); administrative.Open(path);
        var before = administrative.Service!.GetSnapshot();
        // An administrator does not obtain accounting roles simply by choosing an actor-looking UI string.
        Reject<OperatorAuthorizationException>(() => administrative.Service.SaveDraft(Draft(before), "虚构制单人"));
        Require(administrative.Service.GetSnapshot().Revision == before.Revision, "Denied administrator draft changed ledger.");
        var maker = NativeLogin("qa-maker", Password); var reviewer = NativeLogin("qa-reviewer", Password);
        using var making = new LedgerSession(DesktopCompositionExample.CreateBackend(operators, maker)); making.Open(path);
        using var reviewing = new LedgerSession(DesktopCompositionExample.CreateBackend(operators, reviewer)); reviewing.Open(path);
        var write = making.Service!; var review = reviewing.Service!;
        write.SaveAccount(Accounts[0] with { Name = "合成银行" }, reviewer.Identity.ActorKey, Context(write));
        write.SetOpeningBalances([new("1002", 100m, 0), new("3001", 0, 100m)], reviewer.Identity.DisplayName, Context(write));
        var voucher = write.SaveDraft(Draft(write.GetSnapshot()), reviewer.Identity.ActorKey);
        Require(voucher.PreparedBy == maker.Identity.ActorKey && voucher.PreparedBy != maker.Identity.DisplayName, "UI actor parameter impersonated the trusted preparer.");
        var unchanged = write.GetSnapshot();
        Reject<OperatorAuthorizationException>(() => write.Review(voucher.Id, reviewer.Identity.ActorKey, Context(write)));
        Reject<OperatorAuthorizationException>(() => review.SaveDraft(Draft(review.GetSnapshot(), voucher.Id), maker.Identity.ActorKey));
        Require(write.GetSnapshot().Revision == unchanged.Revision && write.GetSnapshot().AuditEvents.Count == unchanged.AuditEvents.Count, "Rejected impersonation changed revision/audit.");
        var oldService = write;
        var directory = operators.GetDirectory(admin);
        var originalIdentity = directory.Operators.Single(x => x.Id == maker.Identity.Id);
        operators.UpdateOperator(admin, directory.Revision, originalIdentity.Id, "虚构改名制单人", originalIdentity.Roles, true);
        Reject<OperatorAuthorizationException>(() => oldService.GetSnapshot());
        maker = NativeLogin("qa-maker", Password);
        using var renamed = new LedgerSession(DesktopCompositionExample.CreateBackend(operators, maker)); renamed.Open(path); write = renamed.Service!;
        Require(maker.Identity.ActorKey == originalIdentity.ActorKey && maker.Identity.DisplayName != originalIdentity.DisplayName, "Rename changed actor key or failed.");
        Require(operators.ResolveActor(maker, voucher.PreparedBy)?.DisplayName == maker.Identity.DisplayName, "Historical actor failed to resolve after rename.");
        Reject<OperatorAuthorizationException>(() => write.Review(voucher.Id, "虚构审核人", Context(write)));
        review.Review(voucher.Id, maker.Identity.DisplayName, Context(review));
        Require(review.GetSnapshot().Vouchers.Single().ReviewedBy == reviewer.Identity.ActorKey, "Reviewer UI name overrode session actor.");
        review.CancelReview(voucher.Id, maker.Identity.ActorKey, Context(review));
        review.Review(voucher.Id, maker.Identity.ActorKey, Context(review));
        write.Post(voucher.Id, reviewer.Identity.ActorKey, Context(write));
        var final = write.GetSnapshot(); var posted = final.Vouchers.Single();
        Require(posted.Status == VoucherStatus.Posted && posted.PreparedBy == maker.Identity.ActorKey && posted.ReviewedBy == reviewer.Identity.ActorKey, "Persisted status/actors wrong.");
        Require(final.AuditEvents.All(x => x.OperatorName == maker.Identity.ActorKey || x.OperatorName == reviewer.Identity.ActorKey), "Audit contains caller-controlled identity.");
        var balance = write.GetTrialBalance(new(2026, 1, 1), new(2026, 1, 31));
        Require(balance.Single(x => x.AccountCode == "1002").ClosingDebit == 110m && balance.Single(x => x.AccountCode == "3001").ClosingCredit == 110m, "Independent opening 100 + posted 10 calculation failed.");
        Require(write.GetLedger("1002", new(2026, 1, 1), new(2026, 1, 31)).Last().RunningBalance == 110m, "Ledger drillthrough ending balance incorrect.");
        write.CloseMonth(1, reviewer.Identity.DisplayName, Context(write));
        Require(write.GetSnapshot().Book.ClosedThroughMonth == 1, "Authorized close did not persist.");
        operators.Logout(maker); operators.Logout(reviewer);
    }
    private static void PhysicalSessions()
    {
        var source = Path.Combine(temporary, "physical-source.caiwu");
        var backup = Path.Combine(temporary, "physical.backup"); var restored = Path.Combine(temporary, "physical-restored.caiwu");
        using (var creator = new LedgerSession(DesktopCompositionExample.CreateBackend(operators, admin))) creator.Create(source, NewBook("合成物理会话"), Accounts);
        var login = NativeLogin("qa-maker", Password);
        using var session = new LedgerSession(DesktopCompositionExample.CreateBackend(operators, login)); session.Open(source);
        var service = session.Service!; var voucher = service.SaveDraft(Draft(service.GetSnapshot()), "任意显示名");
        var original = service.GetSnapshot(); var bound = new SessionBoundMutation(session, original);
        DesktopCompositionExample.Backup(operators, login, session, backup);
        // Restore uses the normally authorized administrator backend; neither source nor existing files are overwritten.
        using (var restoration = new LedgerSession(DesktopCompositionExample.CreateBackend(operators, admin))) restoration.RestoreTo(backup, restored);
        var owner = new Window { Title = "合成组件会话宿主", Width = 420, Height = 200, Content = new TextBlock { Text = "仅临时合成账套；独立组件验收" } }; owner.Show(); NativeInput.Pump();
        var oldEditor = DesktopCompositionExample.CaptureVoucherEditor(session, login, voucher.Id, owner);
        Modal(oldEditor, window =>
        {
            session.Open(restored); var replacement = session.Service!.GetSnapshot();
            Require(replacement.Book.Id == original.Book.Id && replacement.Revision == original.Revision && session.DatabasePath != source, "Restore fixture did not preserve same ID/revision in another physical file.");
            Reject<StoreConcurrencyException>(() => bound.GetService());
            // Keep the old editor's actual loaded inputs; submit through its original compiled save closure.
            NativeInput.Click(window, "SaveButton");
            Require(window.IsVisible && oldEditor.SavedVoucher is null && Error(window).Length > 0, "Old editor saved into a replacement physical session.");
            Require(session.Service.GetSnapshot().Revision == replacement.Revision, "Old editor changed replacement revision.");
            Capture(window, "stale-physical-editor");
            // Close without dirty edits: this probe does not invoke a confirmation shortcut.
            window.DialogResult = false;
        });
        owner.Close();
        var restoredSnapshot = session.Service!.GetSnapshot(); session.Close(); session.Open(restored);
        var sameFileBound = new SessionBoundMutation(session, session.Service!.GetSnapshot()); session.Close(); session.Open(restored);
        Reject<StoreConcurrencyException>(() => sameFileBound.GetService());
        Require(session.Service!.GetSnapshot().Revision == restoredSnapshot.Revision, "Same-file reopen stale guard changed state.");
        using var sourceStore = SqliteLedgerStore.Open(source); using var targetStore = SqliteLedgerStore.Open(restored);
        Require(sourceStore.Read().Revision == original.Revision && targetStore.Read().Revision == original.Revision, "A rejected stale action changed either physical file.");
        operators.Logout(login);
    }
    private static void LogoutBoundary()
    {
        var path = Path.Combine(temporary, "logout.caiwu");
        using (var creator = new LedgerSession(DesktopCompositionExample.CreateBackend(operators, admin))) creator.Create(path, NewBook("合成退出"), Accounts);
        var oldLogin = NativeLogin("qa-maker", Password);
        var backend = DesktopCompositionExample.CreateBackend(operators, oldLogin);
        using var oldSession = new LedgerSession(backend); oldSession.Open(path); var oldService = oldSession.Service!;
        var shown = oldService.GetSnapshot();
        var closed = false; DesktopCompositionExample.Logout(operators, oldLogin, () => closed = true);
        Require(closed, "Compiled logout composition failed to close captured UI.");
        var replacement = NativeLogin("qa-reviewer", Password);
        Reject<OperatorAuthorizationException>(() => oldService.GetSnapshot());
        Reject<OperatorAuthorizationException>(() => oldService.SaveDraft(Draft(shown), replacement.Identity.ActorKey));
        Reject<OperatorAuthorizationException>(() => backend.Open(path));
        using var store = SqliteLedgerStore.Open(path);
        Reject<OperatorAuthorizationException>(() => backend.CreateService(store));
        Require(store.Read().Revision == shown.Revision && store.Read().Vouchers.Count == 0, "Revoked session or factory mutated ledger after another login.");
        operators.Logout(replacement);
    }
}
