using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Desktop;
using Caiwu.Desktop.Features;
using Caiwu.Desktop.Presentation;
using Caiwu.Desktop.Shell;
using Caiwu.Desktop.Shell.Wpf;
using Caiwu.Operators;
using Caiwu.Persistence.Sqlite;

internal static class Program
{
    private static readonly List<string> passed = [];
    private static string output = "";
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); passed.Add(message); Console.WriteLine("PASS " + message); }
    [STAThread]
    private static int Main(string[] args)
    {
        if (!OperatingSystem.IsWindows()) { Console.Error.WriteLine("Requires actual Windows WPF. No original program is executed."); return 2; }
        output = Path.GetFullPath(args.Length == 0 ? "artifacts/parity-shell-native" : args[0]); Directory.CreateDirectory(output);
        var temporary = Path.Combine(Path.GetTempPath(), "caiwu-shell-native-synthetic-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(temporary);
        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        app.Resources.MergedDictionaries.Add(new ResourceDictionary { Source = new Uri("/Caiwu.Desktop;component/Themes/Modern.xaml", UriKind.Relative) });
        var failures = new List<string>();
        try { Run(temporary); }
        catch (Exception ex) { failures.Add(ex.ToString()); Console.Error.WriteLine(ex); }
        finally
        {
            foreach (var window in app.Windows.OfType<Window>().ToArray()) window.Close();
            app.Shutdown();
            try { Directory.Delete(temporary, true); } catch (IOException) { }
        }
        File.WriteAllText(Path.Combine(output, "native-shell.json"), JsonSerializer.Serialize(new
        {
            kind = "actual-windows-wpf-synthetic-shell", sourceSha = Environment.GetEnvironmentVariable("CAIWU_SHELL_SOURCE_SHA") ?? "not-supplied",
            originalProgramExecuted = false, realBooksAccessed = false, physicalKeyboardTested = false,
            passed, failures, succeeded = failures.Count == 0
        }, new JsonSerializerOptions { WriteIndented = true }));
        return failures.Count == 0 ? 0 : 1;
    }
    private static void Run(string temporary)
    {
        var operators = new LocalOperatorService(new FileOperatorStore(Path.Combine(temporary, "operators")));
        operators.InitializeAdministrator("synthetic", "合成操作员", "Synthetic-Window-9!");
        var template = TemplateCatalog.Get(AccountingRegime.SmallBusiness);
        var book = new BookInfo(Guid.NewGuid(), "仅合成 shell 验收", AccountingRegime.SmallBusiness, template.Version, 2026, 10, 9, DateTimeOffset.UtcNow);
        var path = Path.Combine(temporary, "synthetic.caiwu"); using (SqliteLedgerStore.Create(path, book, template.Accounts)) { }
        DesktopBackend Backend(OperatorSession login) => new(
            file => operators.Execute(login, OperatorPermission.ReadLedger, _ => (ILedgerStore)SqliteLedgerStore.Open(file)),
            (file, info, accounts) => operators.Execute(login, OperatorPermission.RestoreLedger, _ => (ILedgerStore)SqliteLedgerStore.Create(file, info, accounts)),
            (_, _) => throw new NotSupportedException(), store => new AuthorizedLedgerService(new LedgerService(store), operators, login), [template]);
        var loginWindow = new ShellLoginWindow(operators, [new(path, book.Name)], temporary, Backend, (_, _) => throw new Exception("Unexpected create"));
        Exception? loginFailure = null;
        loginWindow.Dispatcher.BeginInvoke(new Action(() =>
        {
            try
            {
                ((ComboBox)loginWindow.FindName("BookInput")).SelectedIndex = 0;
                ((ComboBox)loginWindow.FindName("UserInput")).Text = "synthetic";
                ((PasswordBox)loginWindow.FindName("PasswordInput")).Password = "Synthetic-Window-9!";
                ((TextBox)loginWindow.FindName("DateInput")).Text = "2026-10-08";
                loginWindow.UpdateLayout();
                FrameworkElement Field(string name) => (FrameworkElement)loginWindow.FindName(name);
                Point Position(string name) => Field(name).TransformToAncestor(loginWindow).Transform(new Point());
                Check(Position("BookInput").Y < Position("UserInput").Y && Position("UserInput").Y < Position("PasswordInput").Y && Position("PasswordInput").Y < Position("DateInput").Y,
                    "login fields remain book/user/password/date from top to bottom");
                Check(Position("NewButton").X < Position("ConfirmButton").X, "new book remains left of confirm");
                Capture(loginWindow, "login.png");
                ((Button)loginWindow.FindName("ConfirmButton")).RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
            }
            catch (Exception ex) { loginFailure = ex; loginWindow.DialogResult = false; }
        }), DispatcherPriority.ContextIdle);
        Check(loginWindow.ShowDialog() == true && loginFailure is null && loginWindow.Result is not null, "production login controls authenticate and select synthetic book");
        var result = loginWindow.Result!;
        var authentication = new FeatureAuthentication(operators, result.Session);
        var main = new MainWindow(Backend(result.Session), authentication);
        main.OpenLoginBook(result); main.Show(); Pump();
        var workspace = (MdiWorkspace)main.FindName("Workspace");
        Check(workspace.OpenSheets.Count == 1 && workspace.ActiveId == "0", "authenticated login opens accounting workbench sheet");
        var menu = (Menu)main.FindName("ShellMenuBar");
        Check(menu.Items.OfType<MenuItem>().Where(i => i.Visibility == Visibility.Visible).Select(i => (string)i.Header).SequenceEqual(
            new[] { "F.文件", "O日常业务", "I 基础档案", "S系统管理", "W.窗口", "H.帮助" }), "workbench shows six original menu groups");
        Capture(main, "workbench.png");
        Click(main, "m_i10"); Click(main, "m_o20_30"); Pump();
        Check(workspace.OpenSheets.Count == 3 && workspace.ActiveId == "4", "account and balance sheets coexist with workbench");
        Click(main, "m_window_vtile"); Pump(); Capture(main, "mdi-vertical.png");
        Click(main, "m_system_closesheet"); Check(workspace.OpenSheets.Count == 2, "close current window leaves other sheets open");
        Click(main, "m_system_closeall"); Check(workspace.OpenSheets.Count == 1 && workspace.ActiveId == "0", "close all returns to workbench");
        var unimplemented = Find(main, "m_o50_10"); Check(!unimplemented.IsEnabled && unimplemented.ToolTip!.ToString()!.Contains("未完成"), "unwired original module is disabled and explicitly unfinished");
        var invoked = false;
        main.RegisterModuleWindows(new("synthetic-registry-probe", 1, [new("qingsong/main", "w_fx_nd", "m_frame_zw/m_o50_10")], OperatorPermission.ReadLedger,
            context => { invoked = context.Session.DemandCurrent().GetSnapshot().Book.Id == book.Id && context.OperationDate == result.OperationDate; }));
        Click(main, "m_o50_10"); Check(invoked, "registered original entry invokes bound handler with authenticated book/date context");
        Check(main.OperationDate == new DateOnly(2026, 10, 8), "explicit operation date remains after opening and arranging sheets");
        main.Close(); operators.Logout(result.Session);
    }
    private static MenuItem Find(MainWindow main, string id)
    {
        IEnumerable<MenuItem> Descend(ItemsControl parent)
        { foreach (var item in parent.Items.OfType<MenuItem>()) { yield return item; foreach (var child in Descend(item)) yield return child; } }
        return Descend((Menu)main.FindName("ShellMenuBar")).Single(i => i.Tag is ShellMenu definition && definition.Id == id);
    }
    private static void Click(MainWindow main, string id) { var item = Find(main, id); if (!item.IsEnabled) throw new Exception("Disabled command " + id); item.RaiseEvent(new RoutedEventArgs(MenuItem.ClickEvent)); Pump(); }
    private static void Pump()
    {
        var frame = new DispatcherFrame(); var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
        timer.Tick += (_, _) => { timer.Stop(); frame.Continue = false; }; timer.Start(); Dispatcher.PushFrame(frame);
    }
    private static void Capture(Window window, string name)
    {
        window.UpdateLayout(); var bitmap = new RenderTargetBitmap((int)Math.Ceiling(window.ActualWidth), (int)Math.Ceiling(window.ActualHeight), 96, 96, PixelFormats.Pbgra32);
        bitmap.Render(window); var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap)); using var target = File.Create(Path.Combine(output, name)); encoder.Save(target);
    }
}
