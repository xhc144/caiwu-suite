using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Caiwu.Operators;
using Caiwu.Operators.Wpf;

internal static class Program
{
    private static readonly List<object> Results = [];
    private static string output = "";
    private static readonly string Password = "Synthetic-WPF-fixture-only";
    [STAThread] private static int Main(string[] args)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Requires actual Windows WPF.");
        output = Path.GetFullPath(args.Length > 0 ? args[0] : "artifacts/operators-windows"); Directory.CreateDirectory(output);
        var temporary = Path.Combine(Path.GetTempPath(), "caiwu-operators-smoke-" + Guid.NewGuid().ToString("N"));
        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        // Use actual host global resources. Product windows supply no competing implicit styles.
        app.Resources.MergedDictionaries.Add(new ResourceDictionary
        { Source = new Uri("/Caiwu.Desktop;component/Themes/Modern.xaml", UriKind.Relative) });
        var service = new LocalOperatorService(new(temporary)); var failures = 0;
        void Case(string id, Action body)
        {
            try { body(); Results.Add(new { id, status = "PASS" }); }
            catch (Exception ex) { failures++; Results.Add(new { id, status = "FAIL", error = ex.GetType().Name, message = ex.Message }); }
        }
        try
        {
            Case("setup-cancel-no-session", () =>
            {
                var window = new FirstUseWindow(service);
                Modal(window, w => { Text(w, "LoginInput", "cancel-test"); w.DialogResult = false; });
                Check(service.IsFirstUse, "Cancelled setup persisted an administrator.");
            });
            Case("setup-validation-then-create", () =>
            {
                var window = new FirstUseWindow(service);
                Modal(window, w =>
                {
                    Text(w, "LoginInput", "admin-test"); Text(w, "DisplayInput", "虚构管理员");
                    Secret(w, "PasswordInput", Password); Secret(w, "ConfirmInput", "mismatch"); Click(w, "SaveButton");
                    Check(w.IsVisible && Error(w).Length > 0 && service.IsFirstUse, "Validation closed setup or wrote data.");
                    Capture(w, "setup-validation.png"); Secret(w, "ConfirmInput", Password); Click(w, "SaveButton");
                });
                Check(window.DialogResult == true && !service.IsFirstUse, "Setup did not create administrator.");
            });
            Case("login-cancel-no-session", () =>
            {
                var window = new LoginWindow(service);
                Modal(window, w => { Text(w, "LoginInput", "admin-test"); Secret(w, "PasswordInput", Password); w.DialogResult = false; });
                Check(window.Session is null, "Cancel created a session.");
                Check(((PasswordBox)window.FindName("PasswordInput")).Password.Length == 0, "Cancelled password was retained.");
            });
            OperatorSession? admin = null;
            Case("login-error-stays-open-then-success", () =>
            {
                var window = new LoginWindow(service);
                Modal(window, w =>
                {
                    Text(w, "LoginInput", "admin-test"); Secret(w, "PasswordInput", "wrong"); Click(w, "LoginButton");
                    Check(w.IsVisible && window.Session is null && Error(w).Length > 0, "Invalid login closed or authenticated.");
                    Check(((PasswordBox)w.FindName("PasswordInput")).Password.Length == 0, "Invalid password was retained.");
                    Capture(w, "login-validation.png"); Secret(w, "PasswordInput", Password); Click(w, "LoginButton");
                });
                admin = window.Session; Check(admin is not null && window.DialogResult == true, "Correct login failed.");
            });
            Case("management-create-and-disable", () =>
            {
                Check(admin is not null, "Login prerequisite failed.");
                var window = new OperatorManagementWindow(service, admin!);
                Modal(window, w =>
                {
                    Text(w, "LoginInput", "reader-test"); Text(w, "DisplayInput", "虚构只读员"); Click(w, "SaveButton");
                    Check(w.IsVisible && Error(w).Length > 0, "Missing password closed or saved.");
                    Secret(w, "PasswordInput", Password); Secret(w, "ConfirmInput", Password); Click(w, "SaveButton");
                    var user = service.GetDirectory(admin!).Operators.Single(x => x.LoginName == "READER-TEST");
                    var grid = (DataGrid)w.FindName("OperatorGrid"); grid.SelectedItem = grid.Items.Cast<OperatorIdentity>().Single(x => x.Id == user.Id);
                    ((CheckBox)w.FindName("EnabledInput")).IsChecked = false; Click(w, "SaveButton");
                    Check(!service.GetDirectory(admin!).Operators.Single(x => x.Id == user.Id).IsEnabled, "Disable did not persist.");
                    Capture(w, "operator-management.png"); w.DialogResult = false;
                });
            });
            Case("management-constructor-requires-admin", () =>
            {
                var user = service.AddOperator(admin!, service.GetDirectory(admin!).Revision, "ordinary-test", "虚构普通操作员", Password, OperatorRoles.Reader);
                var session = service.Login(user.LoginName, Password);
                try { _ = new OperatorManagementWindow(service, session); throw new InvalidOperationException("Non-admin window opened."); }
                catch (OperatorAuthorizationException) { }
            });
            Case("change-password-validation-and-relogin", () =>
            {
                var old = admin!; var window = new ChangePasswordWindow(service, old);
                Modal(window, w =>
                {
                    Secret(w, "CurrentInput", "wrong"); Secret(w, "PasswordInput", Password + "-changed"); Secret(w, "ConfirmInput", Password + "-changed");
                    Click(w, "SaveButton"); Check(w.IsVisible && Error(w).Length > 0, "Invalid old password closed window.");
                    Secret(w, "CurrentInput", Password); Click(w, "SaveButton");
                });
                try { service.RequirePermission(old, OperatorPermission.ReadLedger); throw new InvalidOperationException("Old session remained valid."); }
                catch (OperatorAuthorizationException) { }
                var fresh = service.Login("admin-test", Password + "-changed"); service.Logout(fresh);
                try { service.RequirePermission(fresh, OperatorPermission.ReadLedger); throw new InvalidOperationException("Logout did not revoke session."); }
                catch (OperatorAuthorizationException) { }
            });
        }
        finally
        {
            foreach (var window in app.Windows.Cast<Window>().ToArray()) window.Close();
            app.Shutdown(); if (Directory.Exists(temporary)) Directory.Delete(temporary, true);
            File.WriteAllText(Path.Combine(output, "operators-windows-results.json"), JsonSerializer.Serialize(new
            {
                actualWindowsWpf = true, physicalKeyboardOrImeTested = false,
                mechanism = "Actual modal WPF windows, routed Button.Click handlers and current host Modern.xaml resources; synthetic temporary identities only.",
                commit = Environment.GetEnvironmentVariable("CAIWU_OPERATORS_COMMIT"), failures, results = Results
            }, new JsonSerializerOptions { WriteIndented = true }));
        }
        return failures == 0 ? 0 : 1;
    }
    private static void Modal(Window window, Action<Window> test)
    {
        Exception? failure = null;
        window.Loaded += (_, _) => window.Dispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle, new Action(() =>
        {
            try
            {
                window.UpdateLayout();
                Check(ReferenceEquals(window.Style, Application.Current.TryFindResource(typeof(Window))), "Dialog did not inherit host Window style.");
                test(window);
            }
            catch (Exception ex) { failure = ex; }
            finally { if (window.IsVisible) window.DialogResult = false; }
        }));
        window.ShowDialog(); if (failure is not null) throw failure;
    }
    private static void Text(Window window, string name, string value) => ((TextBox)window.FindName(name)).Text = value;
    private static void Secret(Window window, string name, string value) => ((PasswordBox)window.FindName(name)).Password = value;
    private static string Error(Window window) => ((TextBlock)window.FindName("ErrorText")).Text;
    private static void Click(Window window, string name) => ((Button)window.FindName(name)).RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
    private static void Check(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
    private static void Capture(Window window, string name)
    {
        window.UpdateLayout();
        var image = new RenderTargetBitmap((int)window.ActualWidth, (int)window.ActualHeight, 96, 96, PixelFormats.Pbgra32); image.Render(window);
        var png = new PngBitmapEncoder(); png.Frames.Add(BitmapFrame.Create(image));
        using var stream = File.Create(Path.Combine(output, name)); png.Save(stream);
    }
}
