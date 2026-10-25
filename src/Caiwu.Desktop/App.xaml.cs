using System.Windows;
using Caiwu.Core;
using Caiwu.Delivery;
using Caiwu.Persistence.Sqlite;
using Caiwu.Desktop.Presentation;
using Caiwu.Desktop.Features;
using Caiwu.Operators;
using Caiwu.Operators.Wpf;
using System.IO;

namespace Caiwu.Desktop;

public partial class App : Application
{
    // Validate untrusted files read-only before Storage's write-capability probe or restore.
    public static DesktopBackend CreateAuthenticatedBackend(LocalOperatorService operators, OperatorSession fixedLogin) => new(
        path => operators.Execute(fixedLogin, OperatorPermission.ReadLedger, _ =>
        { LedgerFilePolicy.Validate(path); return (Caiwu.Contracts.ILedgerStore)SqliteLedgerStore.Open(path); }),
        (path, book, accounts) => operators.Execute(fixedLogin, OperatorPermission.RestoreLedger, _ =>
            (Caiwu.Contracts.ILedgerStore)SqliteLedgerStore.Create(path, book, accounts)),
        (backup, destination) => operators.Execute(fixedLogin, OperatorPermission.RestoreLedger, _ =>
        { LedgerFilePolicy.Validate(backup); SqliteLedgerStore.RestoreBackup(backup, destination); return true; }),
        AuthorizedLedgerServiceFactory.BindSession(operators, fixedLogin,
            store => new PreviewLedgerService(new LedgerService(store))), TemplateCatalog.All);

    private LocalOperatorService? operators;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        ShutdownMode = ShutdownMode.OnExplicitShutdown;
        if (e.Args.Contains("--smoke-test", StringComparer.Ordinal))
        {
            System.Diagnostics.Trace.TraceError("Synthetic verification runs only in independent test hosts; production authentication cannot be bypassed.");
            Shutdown(2); return;
        }
        try
        {
            var data = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (string.IsNullOrWhiteSpace(data)) throw new InvalidOperationException("无法确定当前用户的数据目录，未建立账务会话。");
            operators = new(new FileOperatorStore(Path.Combine(data, "CaiwuSuite", "Operators")));
            LoginAndShowMain();
        }
        catch (Exception ex) { MessageBox.Show(ex.Message, "启动未完成", MessageBoxButton.OK, MessageBoxImage.Warning); Shutdown(1); }
    }

    private void LoginAndShowMain()
    {
        var service = operators ?? throw new InvalidOperationException("操作员服务未初始化。");
        var login = OperatorDialogs.Login(null, service);
        if (login is null) { Shutdown(); return; } // Setup is not login; cancellation creates no writable book session.
        try
        {
            var authentication = new FeatureAuthentication(service, login);
            var main = new MainWindow(CreateAuthenticatedBackend(service, login), authentication);
            MainWindow = main;
            main.Closed += (_, _) =>
            {
                service.Logout(login); // This exact old object; never a global current-login getter.
                if (main.LoginSwitchRequested) Dispatcher.BeginInvoke(new Action(() =>
                {
                    try { LoginAndShowMain(); }
                    catch (Exception ex) { MessageBox.Show(ex.Message, "登录未完成", MessageBoxButton.OK, MessageBoxImage.Warning); Shutdown(1); }
                }));
                else Shutdown();
            };
            main.Show();
        }
        catch { service.Logout(login); throw; }
    }
}
