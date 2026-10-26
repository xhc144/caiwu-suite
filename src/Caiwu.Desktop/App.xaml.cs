using System.Windows;
using Caiwu.Core;
using Caiwu.Delivery;
using Caiwu.Persistence.Sqlite;
using Caiwu.Desktop.Presentation;
using Caiwu.Desktop.Features;
using Caiwu.Operators;
using Caiwu.Operators.Wpf;
using System.IO;
using Caiwu.Desktop.Shell;
using Caiwu.Desktop.Shell.Wpf;
using Caiwu.Desktop.Dialogs;
using Microsoft.Win32;

namespace Caiwu.Desktop;

public partial class App : Application
{
    // Validate untrusted files read-only before Storage's write-capability probe or restore.
    public static DesktopBackend CreateAuthenticatedBackend(LocalOperatorService operators, OperatorSession fixedLogin, ParityModuleWritePolicy? moduleWritePermissions = null) => new(
        path => operators.Execute(fixedLogin, OperatorPermission.ReadLedger, _ =>
        { LedgerFilePolicy.Validate(path); return (Caiwu.Contracts.ILedgerStore)SqliteLedgerStore.Open(path); }),
        (path, book, accounts) => operators.Execute(fixedLogin, OperatorPermission.RestoreLedger, _ =>
            (Caiwu.Contracts.ILedgerStore)SqliteLedgerStore.Create(path, book, accounts)),
        (backup, destination) => operators.Execute(fixedLogin, OperatorPermission.RestoreLedger, _ =>
        { LedgerFilePolicy.Validate(backup); SqliteLedgerStore.RestoreBackup(backup, destination); return true; }),
        AuthorizedLedgerServiceFactory.BindSession(operators, fixedLogin,
            store => new PreviewLedgerService(new LedgerService(store)), moduleWritePermissions), TemplateCatalog.All);

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

    private string? selectedLoginBookPath;
    private DateOnly? selectedOperationDate;

    private void LoginAndShowMain(bool userOnly = false)
    {
        var service = operators ?? throw new InvalidOperationException("操作员服务未初始化。");
        var features = managedFeatures ?? throw new InvalidOperationException("受管数据会话未建立。");
        if (service.IsFirstUse)
        {
            var setup = new FirstUseWindow(service);
            if (setup.ShowDialog() != true) { Shutdown(); return; }
        }
        using var frameScope = new LoginFrameScope(this);
        var loginFrame = frameScope.Frame;
        DesktopBackend Backend(OperatorSession session) => features.BindBackend(CreateAuthenticatedBackend(service, session));
        var books = features.Data.ReadInventory().Books.Select(book => new ShellBookChoice(
            Caiwu.Delivery.SafePaths.Child(features.Data.DataRoot, book.RelativeDatabasePath), book.RelativeDatabasePath));
        ShellLoginResult? result;
        if (userOnly && selectedLoginBookPath is { } fixedPath && selectedOperationDate is { } fixedDate)
        {
            var changeUser = new ShellUserSwitchWindow(service, Backend,
                new(fixedPath, Path.GetFileNameWithoutExtension(fixedPath)), fixedDate) { Owner = loginFrame, WindowStartupLocation = WindowStartupLocation.CenterOwner };
            if (changeUser.ShowDialog() != true || changeUser.Result is null) { Shutdown(); return; }
            result = changeUser.Result;
        }
        else
        {
            var loginWindow = new ShellLoginWindow(service, books, features.Data.DataRoot, Backend,
                (session, owner) => CreateLoginBook(Backend(session), owner, features.Data.DataRoot), selectedLoginBookPath, selectedOperationDate) { Owner = loginFrame, WindowStartupLocation = WindowStartupLocation.CenterOwner };
            if (loginWindow.ShowDialog() != true || loginWindow.Result is null) { Shutdown(); return; }
            result = loginWindow.Result;
        }
        var login = result.Session;
        MainWindow? main = null;
        try
        {
            var authentication = new FeatureAuthentication(service, login);
            main = new MainWindow(Backend(login), authentication, features.Options(authentication));
            main.OpenLoginBook(result);
            MainWindow = main;
            var opened = main;
            main.Closed += (_, _) =>
            {
                service.Logout(login);
                if (opened.LoginSwitchRequested)
                {
                    selectedLoginBookPath = opened.SelectedLoginBookPath;
                    selectedOperationDate = opened.OperationDate;
                    Dispatcher.BeginInvoke(new Action(() =>
                    {
                        try { LoginAndShowMain(userOnly: !opened.BookSwitchRequested); }
                        catch (Exception ex) { MessageBox.Show(ex.Message, "登录未完成", MessageBoxButton.OK, MessageBoxImage.Warning); Shutdown(1); }
                    }));
                }
                else Shutdown();
            };
            main.Show();
        }
        catch { service.Logout(login); main?.Close(); throw; }
    }

    private sealed class LoginFrameScope : IDisposable
    {
        public MainWindow Frame { get; }
        public LoginFrameScope(App app)
        {
            Frame = new MainWindow(); Frame.PrepareLoginFrame(); app.MainWindow = Frame; Frame.Show();
        }
        public void Dispose() => Frame.Close();
    }

    private static string? CreateLoginBook(DesktopBackend backend, Window owner, string dataRoot)
    {
        var dialog = new NewBookWindow(backend.Templates) { Owner = owner };
        if (dialog.ShowDialog() != true || dialog.Book is null || dialog.SelectedTemplate is null) return null;
        var save = new SaveFileDialog { Title = "保存当前格式新账套（原初始化向导未完成）", InitialDirectory = dataRoot,
            Filter = "当前账套 (*.caiwu)|*.caiwu", DefaultExt = ".caiwu", FileName = "book-" + Guid.NewGuid().ToString("N") + ".caiwu", AddExtension = true };
        if (save.ShowDialog(owner) != true) return null;
        if (File.Exists(save.FileName)) throw new InvalidDataException("新账套不能覆盖已有文件。");
        using var created = backend.Create(save.FileName, dialog.Book, dialog.SelectedTemplate.Accounts);
        created.CheckIntegrity();
        return created.DatabasePath;
    }

    protected override void OnExit(ExitEventArgs e)
    { managedData?.Dispose(); base.OnExit(e); }
}
