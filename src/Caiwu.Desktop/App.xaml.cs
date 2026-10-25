using System.Windows;
using Caiwu.Core;
using Caiwu.Persistence.Sqlite;
using Caiwu.Desktop.Presentation;
using Caiwu.Desktop.Verification;

namespace Caiwu.Desktop;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        var backend = new DesktopBackend(SqliteLedgerStore.Open, SqliteLedgerStore.Create,
            SqliteLedgerStore.RestoreBackup, store => new LedgerService(store), TemplateCatalog.All);
        if (e.Args.Length == 2 && e.Args[0] == "--smoke-test")
        {
            UiVerification.Run(this, backend, e.Args[1]);
            return;
        }
        MainWindow = new MainWindow(backend);
        MainWindow.Show();
    }
}
