using System.Windows;
using Caiwu.Core;
using Caiwu.Delivery;
using Caiwu.Persistence.Sqlite;
using Caiwu.Desktop.Presentation;
using Caiwu.Desktop.Verification;

namespace Caiwu.Desktop;

public partial class App : Application
{
    // Validate untrusted files read-only before Storage's write-capability probe or restore.
    internal static DesktopBackend CreateBackend() => new(
        path => { LedgerFilePolicy.Validate(path); return SqliteLedgerStore.Open(path); },
        SqliteLedgerStore.Create,
        (backup, destination) => { LedgerFilePolicy.Validate(backup); SqliteLedgerStore.RestoreBackup(backup, destination); },
        store => new PreviewLedgerService(new LedgerService(store)), TemplateCatalog.All);

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        var backend = CreateBackend();
        if (e.Args.Length == 2 && e.Args[0] == "--smoke-test")
        {
            UiVerification.Run(this, backend, e.Args[1]);
            return;
        }
        MainWindow = new MainWindow(backend);
        MainWindow.Show();
    }
}
