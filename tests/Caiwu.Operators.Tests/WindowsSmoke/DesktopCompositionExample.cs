using System.Windows;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Delivery;
using Caiwu.Desktop;
using Caiwu.Desktop.Dialogs;
using Caiwu.Desktop.Presentation;
using Caiwu.Operators;
using Caiwu.Operators.Wpf;
using Caiwu.Persistence.Sqlite;

namespace Caiwu.Operators.Tests.WindowsSmoke;

/// <summary>
/// Compiled integration example, not an alternate Desktop entry point. The Desktop owner copies/adapts these
/// calls into its composition root. Raw Core creation exists only inside the factory closure.
/// </summary>
public static class DesktopCompositionExample
{
    public static DesktopBackend CreateBackend(LocalOperatorService operators, OperatorSession fixedLogin)
    {
        var createService = AuthorizedLedgerServiceFactory.BindSession(operators, fixedLogin,
            store => new PreviewLedgerService(new LedgerService(store)));
        return new DesktopBackend(
            path => operators.Execute(fixedLogin, OperatorPermission.ReadLedger, _ =>
            { LedgerFilePolicy.Validate(path); return (ILedgerStore)SqliteLedgerStore.Open(path); }),
            (path, book, accounts) => operators.Execute(fixedLogin, OperatorPermission.RestoreLedger, _ =>
                (ILedgerStore)SqliteLedgerStore.Create(path, book, accounts)),
            (backup, destination) => operators.Execute(fixedLogin, OperatorPermission.RestoreLedger, _ =>
            { LedgerFilePolicy.Validate(backup); SqliteLedgerStore.RestoreBackup(backup, destination); return true; }),
            createService, TemplateCatalog.All);
    }

    // Call while the application uses OnExplicitShutdown, so a cancelled login can shut down cleanly.
    public static (OperatorSession Login, MainWindow Main)? LoginAndCreateMain(Window? owner, LocalOperatorService operators)
    {
        var login = OperatorDialogs.Login(owner, operators);
        if (login is null) return null;
        try
        {
            var main = new MainWindow(CreateBackend(operators, login));
            main.Closed += (_, _) => operators.Logout(login);
            return (login, main);
        }
        catch { operators.Logout(login); throw; }
    }

    // Confirm/discard dirty work BEFORE calling this method. It revokes first; closing UI never holds identity locks.
    // Then show login again and construct a new backend/main window. Do not swap a session getter in an old factory.
    public static void Logout(LocalOperatorService operators, OperatorSession login, Action closeOldEditorsAndMain)
    {
        operators.Logout(login);
        closeOldEditorsAndMain();
    }

    public static VoucherEditorWindow CaptureVoucherEditor(LedgerSession bookSession, OperatorSession fixedLogin,
        Guid? id, Window owner)
    {
        var service = bookSession.Service ?? throw new StoreConcurrencyException("请先打开账套。");
        var shown = service.GetSnapshot();
        var origin = new SessionBoundMutation(bookSession, shown);
        var voucher = id is { } value ? shown.Vouchers.Single(v => v.Id == value) : null;
        return new VoucherEditorWindow(shown.Book, shown.Accounts, voucher, fixedLogin.Identity.DisplayName,
            draft => origin.GetService().SaveDraft(draft, string.Empty),
            forceReadOnly: !PreviewLedgerService.AllowsWrites(shown.Book), expectedRevision: shown.Revision) { Owner = owner };
    }

    // LedgerSession.BackupTo operates on ILedgerStore, outside ILedgerService. Its existing handler must use this guard.
    public static void Backup(LocalOperatorService operators, OperatorSession fixedLogin, LedgerSession bookSession, string destination)
        => operators.Execute(fixedLogin, OperatorPermission.BackupLedger, _ => { bookSession.BackupTo(destination); return true; });
}
