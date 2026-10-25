using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Caiwu.Operators;
using Caiwu.Operators.Wpf;
using Caiwu.Desktop.Presentation;
using Caiwu.Operators.Tests.WindowsSmoke;

internal static partial class Program
{
    private static readonly List<CaseResult> Results = [];
    private static string evidence = "", temporary = "";
    // Generated inside the isolated test process. Never arguments, environment, logs, or production defaults.
    private static readonly string Password = Convert.ToBase64String(RandomNumberGenerator.GetBytes(30));
    private static readonly string ChangedPassword = Convert.ToBase64String(RandomNumberGenerator.GetBytes(30));
    private static LocalOperatorService operators = null!;
    private static OperatorSession admin = null!;
    private sealed record CaseResult(string Id, bool Passed, string? ErrorType = null, string? Failure = null);

    [STAThread] private static int Main(string[] args)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Actual Windows WPF is required.");
        evidence = Path.GetFullPath(args.Length == 1 ? args[0] : throw new ArgumentException("Evidence directory required."));
        Directory.CreateDirectory(evidence);
        temporary = Path.Combine(Path.GetTempPath(), "caiwu-operators-qa-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temporary);
        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        app.Resources.MergedDictionaries.Add(new ResourceDictionary { Source = new Uri("/Caiwu.Desktop;component/Themes/Modern.xaml", UriKind.Relative) });
        SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext());
        using var watchdog = new System.Threading.Timer(_ => Environment.FailFast("Bounded Operators component probe timed out."), null, 150000, Timeout.Infinite);
        operators = new(new FileOperatorStore(Path.Combine(temporary, "identities")));
        try
        {
            Case("FIRST-USE-CANCEL-NO-IDENTITY", () =>
            {
                var login = LoginFlow(operators, (window, _) => NativeInput.Press(window, 0x1B));
                Require(login is null && operators.IsFirstUse, "Cancelled first use persisted identity or session.");
            });
            Case("FIRST-USE-VALIDATION-EXPLICIT-LOGIN-CANCEL", () =>
            {
                var seen = 0;
                var login = LoginFlow(operators, (window, index) =>
                {
                    seen++;
                    if (index == 0)
                    {
                        Require(window is FirstUseWindow, "First-use dialog missing.");
                        NativeInput.Fill(window, "LoginInput", "qa-admin"); NativeInput.Tab(window, "LoginInput", "DisplayInput");
                        NativeInput.Fill(window, "DisplayInput", "虚构管理员");
                        NativeInput.Fill(window, "PasswordInput", Password); NativeInput.Fill(window, "ConfirmInput", ChangedPassword);
                        NativeInput.Click(window, "SaveButton");
                        Require(window.IsVisible && operators.IsFirstUse && Error(window).Length > 0, "Invalid setup closed or persisted identity.");
                        ClearSecrets(window); Capture(window, "first-use-validation");
                        NativeInput.Fill(window, "PasswordInput", Password); NativeInput.Fill(window, "ConfirmInput", Password);
                        NativeInput.Click(window, "SaveButton");
                        Require(!window.IsVisible && !operators.IsFirstUse, "Valid setup did not finish.");
                    }
                    else
                    {
                        Require(window is LoginWindow w && w.Session is null, "Setup must require a separate explicit login.");
                        NativeInput.Press(window, 0x1B);
                    }
                });
                Require(seen == 2 && login is null && !operators.IsFirstUse, "First-use/login cancellation composition failed.");
            });
            Case("LOGIN-WRONG-PASSWORD-RETAINS-WINDOW-NATIVE-ENTER", () =>
            {
                var window = new LoginWindow(operators);
                Modal(window, w =>
                {
                    NativeInput.Fill(w, "LoginInput", "qa-admin"); NativeInput.Tab(w, "LoginInput", "PasswordInput");
                    NativeInput.Fill(w, "PasswordInput", ChangedPassword); NativeInput.Press(w, 0x0D);
                    Require(w.IsVisible && window.Session is null && Error(w).Length > 0, "Wrong password authenticated or closed dialog.");
                    Require(((PasswordBox)w.FindName("PasswordInput")).Password.Length == 0, "Rejected login retained secret.");
                    Require(((PasswordBox)w.FindName("PasswordInput")).IsKeyboardFocusWithin, "Rejected login lost retry focus.");
                    Capture(w, "login-rejected"); NativeInput.Fill(w, "PasswordInput", Password); NativeInput.Press(w, 0x0D);
                });
                admin = window.Session ?? throw new InvalidOperationException("Explicit native login issued no session.");
                Require(window.DialogResult == true, "Valid login failed.");
                Require(((PasswordBox)window.FindName("PasswordInput")).Password.Length == 0, "Closed login retained secret.");
            });
            Case("LOGIN-CANCEL-CLEARS-SECRET", () =>
            {
                var window = new LoginWindow(operators);
                Modal(window, w => { NativeInput.Fill(w, "LoginInput", "qa-admin"); NativeInput.Fill(w, "PasswordInput", Password); NativeInput.Press(w, 0x1B); });
                Require(window.Session is null && ((PasswordBox)window.FindName("PasswordInput")).Password.Length == 0, "Cancelled login issued session or retained secret.");
            });
            Case("ADMIN-MANAGEMENT-ADD-ROLE-CHANGE-DISABLE", Management);
            Case("NONADMIN-MANAGEMENT-REJECTED", () =>
            {
                var reader = operators.Login("qa-reviewer", Password);
                Reject<OperatorAuthorizationException>(() => _ = new OperatorManagementWindow(operators, reader));
                operators.Logout(reader);
            });
            Case("AUTHORIZED-CORE-SQLITE-CLOSED-LOOP-ACTOR-BOUNDARY", LedgerLoop);
            Case("SAME-BOOK-DIFFERENT-PHYSICAL-SESSION-STALE-EDITOR", PhysicalSessions);
            Case("PASSWORD-CHANGE-REVOKES-OLD-SESSION", () =>
            {
                var window = new ChangePasswordWindow(operators, admin);
                Modal(window, w =>
                {
                    NativeInput.Fill(w, "CurrentInput", ChangedPassword); NativeInput.Fill(w, "PasswordInput", ChangedPassword); NativeInput.Fill(w, "ConfirmInput", ChangedPassword);
                    NativeInput.Click(w, "SaveButton"); Require(w.IsVisible && Error(w).Length > 0, "Wrong current password closed change dialog.");
                    ClearSecrets(w); Capture(w, "password-change-rejected");
                    NativeInput.Fill(w, "CurrentInput", Password); NativeInput.Fill(w, "PasswordInput", ChangedPassword); NativeInput.Fill(w, "ConfirmInput", ChangedPassword);
                    NativeInput.Click(w, "SaveButton");
                });
                Require(window.DialogResult == true, "Valid password change failed.");
                Require(Visuals<PasswordBox>(window).All(p => p.Password.Length == 0), "Closed password change retained secrets.");
                Reject<OperatorAuthorizationException>(() => operators.RequirePermission(admin, OperatorPermission.ReadLedger));
                Reject<OperatorAuthorizationException>(() => operators.Login("qa-admin", Password));
                admin = NativeLogin("qa-admin", ChangedPassword);
            });
            Case("LOGOUT-OLD-ADAPTER-AND-FACTORY-REMAIN-REVOKED", LogoutBoundary);
        }
        finally
        {
            foreach (var window in app.Windows.Cast<Window>().ToArray()) { ClearSecrets(window); window.Close(); }
            operators.Logout(admin); app.Shutdown();
            try { Directory.Delete(temporary, true); } catch (IOException) { /* No identity files are ever uploaded. */ }
            SaveResults();
        }
        return Results.Count == 10 && Results.All(r => r.Passed) ? 0 : 1;
    }
    private static void Management()
    {
        Modal(new OperatorManagementWindow(operators, admin), window =>
        {
            NativeInput.Fill(window, "LoginInput", "qa-invalid"); NativeInput.Fill(window, "DisplayInput", "虚构验证"); NativeInput.Click(window, "SaveButton");
            Require(window.IsVisible && Error(window).Length > 0 && !operators.GetDirectory(admin).Operators.Any(x => x.LoginName == "QA-INVALID"), "Missing password saved operator or closed management.");
            AddFromUi(window, "qa-maker", "虚构制单人", ["AccountantRole", "PreparerRole", "ReviewerRole", "PosterRole", "PeriodCloserRole"]);
            AddFromUi(window, "qa-reviewer", "虚构审核人", ["PreparerRole", "ReviewerRole"]);
            AddFromUi(window, "qa-revoked", "虚构撤销测试", ["ReaderRole"]);
            var path = Path.Combine(temporary, "role-revocation.caiwu");
            using (var creator = new LedgerSession(DesktopCompositionExample.CreateBackend(operators, admin))) creator.Create(path, NewBook("合成角色撤销"), Accounts);
            var oldReader = NativeLogin("qa-revoked", Password);
            using var readerBook = new LedgerSession(DesktopCompositionExample.CreateBackend(operators, oldReader)); readerBook.Open(path);
            var before = readerBook.Service!.GetSnapshot();
            NativeInput.Foreground(window); SelectOperator(window, "QA-REVOKED");
            NativeInput.Toggle(window, "PreparerRole", true); NativeInput.Toggle(window, "ReaderRole", false); NativeInput.Click(window, "SaveButton");
            Reject<OperatorAuthorizationException>(() => operators.RequirePermission(oldReader, OperatorPermission.ReadLedger));
            Reject<OperatorAuthorizationException>(() => readerBook.Service.GetSnapshot());
            Reject<OperatorAuthorizationException>(() => readerBook.Service.SaveDraft(Draft(before), "虚构制单人"));
            var fresh = operators.Login("qa-revoked", Password); operators.RequirePermission(fresh, OperatorPermission.PrepareVoucher);
            using var freshBook = new LedgerSession(DesktopCompositionExample.CreateBackend(operators, fresh)); freshBook.Open(path);
            SelectOperator(window, "QA-REVOKED"); NativeInput.Toggle(window, "EnabledInput", false); NativeInput.Click(window, "SaveButton");
            Require(!operators.GetDirectory(admin).Operators.Single(x => x.LoginName == "QA-REVOKED").IsEnabled, "UI disable did not persist.");
            Reject<OperatorAuthorizationException>(() => operators.RequirePermission(fresh, OperatorPermission.ReadLedger));
            Reject<OperatorAuthorizationException>(() => freshBook.Service!.SaveDraft(Draft(before), "虚构制单人"));
            Reject<OperatorAuthorizationException>(() => operators.Login("qa-revoked", Password));
            using (var persisted = Caiwu.Persistence.Sqlite.SqliteLedgerStore.Open(path))
                Require(persisted.Read().Revision == before.Revision && persisted.Read().Vouchers.Count == 0, "Role/disable-revoked adapter mutated ledger.");
            SelectOperator(window, "QA-ADMIN"); NativeInput.Toggle(window, "EnabledInput", false); NativeInput.Click(window, "SaveButton");
            Require(window.IsVisible && Error(window).Length > 0 && operators.GetDirectory(admin).Operators.Single(x => x.LoginName == "QA-ADMIN").IsEnabled, "Last administrator protection failed.");
            ClearSecrets(window); foreach (var scroll in Visuals<ScrollViewer>(window)) scroll.ScrollToTop(); NativeInput.Pump();
            Capture(window, "management-synthetic"); NativeInput.Press(window, 0x1B);
        });
    }
    private static void AddFromUi(Window window, string login, string display, string[] roles)
    {
        NativeInput.Click(window, Visuals<Button>(window).Single(b => Equals(b.Content, "新增")));
        NativeInput.Fill(window, "LoginInput", login); NativeInput.Fill(window, "DisplayInput", display);
        foreach (var role in new[] { "AdministratorRole", "AccountantRole", "PreparerRole", "ReviewerRole", "PosterRole", "PeriodCloserRole", "ReaderRole" })
            NativeInput.Toggle(window, role, roles.Contains(role));
        NativeInput.Fill(window, "PasswordInput", Password); NativeInput.Fill(window, "ConfirmInput", Password); NativeInput.Click(window, "SaveButton");
        Require(operators.GetDirectory(admin).Operators.Any(x => x.LoginName == login.ToUpperInvariant()), "UI operator creation failed.");
        Require(Visuals<PasswordBox>(window).All(p => p.Password.Length == 0), "Management retained saved password.");
    }
    private static void SelectOperator(Window window, string login)
    {
        var grid = (DataGrid)window.FindName("OperatorGrid");
        var item = grid.Items.Cast<OperatorIdentity>().Single(x => x.LoginName == login);
        grid.ScrollIntoView(item); grid.UpdateLayout(); NativeInput.Pump();
        var row = (DataGridRow)grid.ItemContainerGenerator.ContainerFromItem(item);
        NativeInput.Click(window, row);
        Require(ReferenceEquals(grid.SelectedItem, item), "Native directory row selection failed.");
    }
    private static OperatorSession NativeLogin(string login, string password)
    {
        var window = new LoginWindow(operators);
        Modal(window, w => { NativeInput.Fill(w, "LoginInput", login); NativeInput.Fill(w, "PasswordInput", password); NativeInput.Press(w, 0x0D); });
        return window.Session ?? throw new InvalidOperationException("Native explicit login failed.");
    }
    private static OperatorSession? LoginFlow(LocalOperatorService service, Action<Window, int> action)
    {
        Exception? failure = null; var handled = new HashSet<Window>(); var running = false;
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(70) };
        timer.Tick += (_, _) =>
        {
            if (running) return;
            var window = Application.Current.Windows.Cast<Window>().FirstOrDefault(w => w.IsVisible && !handled.Contains(w));
            if (window is null) return;
            running = true; var index = handled.Count; handled.Add(window);
            try { NativeInput.Foreground(window); action(window, index); }
            catch (Exception ex) { failure = ex; window.Close(); }
            finally { running = false; }
        };
        timer.Start(); OperatorSession? result;
        try { result = OperatorDialogs.Login(null, service); } finally { timer.Stop(); }
        if (failure is not null) throw failure; return result;
    }
    private static void Modal(Window window, Action<Window> action)
    {
        Exception? failure = null;
        window.Loaded += (_, _) => window.Dispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle, new Action(() =>
        {
            try
            {
                window.UpdateLayout(); NativeInput.Foreground(window);
                if (window.GetType().Namespace == "Caiwu.Operators.Wpf")
                    Require(ReferenceEquals(window.Style, Application.Current.TryFindResource(typeof(Window))), "Host theme Window style not inherited.");
                action(window);
            }
            catch (Exception ex) { failure = ex; }
            finally { if (window.IsVisible) { ClearSecrets(window); window.DialogResult = false; } }
        }));
        window.ShowDialog(); if (failure is not null) throw failure;
    }
    internal static void Require(bool condition, string reason) { if (!condition) throw new InvalidOperationException(reason); }
    private static void Reject<T>(Action action) where T : Exception
    {
        try { action(); } catch (T) { return; }
        throw new InvalidOperationException("Expected rejection was not enforced: " + typeof(T).Name);
    }
    private static void Case(string id, Action body)
    {
        try { body(); Results.Add(new(id, true)); }
        catch (Exception ex) { Results.Add(new(id, false, ex.GetType().Name, ex is InvalidOperationException ? ex.Message : "Operation failed; no identity data or credentials recorded.")); }
        SaveResults();
    }
    private static void SaveResults() => File.WriteAllText(Path.Combine(evidence, "results.json"), JsonSerializer.Serialize(new
    {
        checkoutCommit = Environment.GetEnvironmentVariable("CAIWU_OPERATORS_QA_COMMIT"),
        productionSourceTree = Environment.GetEnvironmentVariable("CAIWU_OPERATORS_QA_SOURCE_TREE"),
        windowsExecuted = true, productAppStartupTested = false, independentComponentHost = true,
        nativeSendInputEvents = NativeInput.DeliveredEvents, unicodeInjectionTested = true,
        physicalHumanKeyboardTested = false, imeTested = false, screenReaderTested = false,
        os = Environment.OSVersion.ToString(), results = Results
    }, new JsonSerializerOptions { WriteIndented = true }));
    private static string Error(Window window) => ((TextBlock)window.FindName("ErrorText")).Text;
    private static void ClearSecrets(Window window) { foreach (var box in Visuals<PasswordBox>(window)) box.Clear(); }
    private static void Capture(Window window, string name)
    {
        Require(Visuals<PasswordBox>(window).All(p => p.Password.Length == 0 && p.PasswordChar != '\0'), "Capture requires empty masked password fields.");
        window.UpdateLayout();
        var image = new RenderTargetBitmap((int)window.ActualWidth, (int)window.ActualHeight, 96, 96, PixelFormats.Pbgra32); image.Render(window);
        var png = new PngBitmapEncoder(); png.Frames.Add(BitmapFrame.Create(image));
        using var stream = File.Create(Path.Combine(evidence, name + ".png")); png.Save(stream);
    }
    private static IEnumerable<T> Visuals<T>(DependencyObject root) where T : DependencyObject
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++)
        {
            var child = VisualTreeHelper.GetChild(root, i); if (child is T found) yield return found;
            foreach (var nested in Visuals<T>(child)) yield return nested;
        }
    }
}
