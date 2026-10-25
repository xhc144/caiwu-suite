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
    private ManagedDataSession? managedData;
    private ManagedFeatureContext? managedFeatures;

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
            var install = Environment.GetEnvironmentVariable("CAIWU_INSTALL_ROOT");
            var data = Environment.GetEnvironmentVariable("CAIWU_DATA_ROOT");
            if (string.IsNullOrWhiteSpace(install) || string.IsNullOrWhiteSpace(data))
                throw new InvalidOperationException("请从受管启动器 launch-managed 启动；缺少明确的安装/数据根，未访问用户数据。");
            managedData = ManagedDesktopLaunch.OpenSession(install, data,
                Environment.ProcessPath ?? throw new InvalidDataException("缺少实际可执行文件路径。"));
            managedFeatures = new(managedData);
            operators = new(new FileOperatorStore(managedData.OperatorsDirectory));
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
            var features = managedFeatures ?? throw new InvalidOperationException("受管数据会话未建立。");
            var options = features.Options(authentication);
            var main = new MainWindow(features.BindBackend(CreateAuthenticatedBackend(service, login)), authentication, options);
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

    protected override void OnExit(ExitEventArgs e)
    { managedData?.Dispose(); base.OnExit(e); }
}
