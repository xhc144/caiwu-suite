using System.IO;
using System.Windows;
using System.Windows.Controls;
using Caiwu.Contracts;
using Caiwu.Desktop.Shell;
using Caiwu.Desktop.Shell.Wpf;
using Caiwu.Operators.Wpf;

namespace Caiwu.Desktop;

public partial class MainWindow
{
    private readonly Dictionary<string, MenuItem> shellMenus = [];
    private readonly Dictionary<int, UIElement> shellPages = [];
    private readonly MenuItem operationMenu = new() { Header = "O.操作" };
    private readonly MenuItem extensionMenu = new() { Header = "当前基础实现工具（原窗口未完成）" };
    private readonly Dictionary<ShellOriginalWindow, ShellModuleWindows> registeredWindows = [];
    private WorkbenchControl? shellWorkbench;
    private bool changingSheet, loginFrameOnly;
    private string browseKind = "";
    private int? browseFirst, browseLast;
    private DateOnly operationDate = DateOnly.FromDateTime(DateTime.Today);
    public bool BookSwitchRequested { get; private set; }
    public string? SelectedLoginBookPath { get; private set; }
    public DateOnly OperationDate => operationDate;

    internal void PrepareLoginFrame()
    {
        loginFrameOnly = true; ShellMenuBar.IsEnabled = false; WelcomePanel.Visibility = Visibility.Collapsed;
        NotificationText.Text = "请选择套账、用户与操作日期并登录。";
    }
    private MenuItem ShellMenu(string id) => shellMenus[id];
    private void InitializeShell()
    {
        foreach (var definition in OriginalShellCatalog.AccountingMenu) ShellMenuBar.Items.Add(BuildShellMenu(definition));
        ShellMenuBar.Items.Insert(ShellMenuBar.Items.IndexOf(ShellMenu("m_window")), operationMenu);
        for (var index = 0; index < Pages.Items.Count; index++)
        {
            var tab = (TabItem)Pages.Items[index];
            if (tab.Content is UIElement content) { tab.Content = null; shellPages[index] = content; }
        }
        shellWorkbench = new WorkbenchControl(
            link => CanOpenOriginalWindow(link.OriginalWindow, WorkbenchEntry(link)),
            link => OpenOriginalWindow(link.OriginalWindow, WorkbenchEntry(link)), RequestBookSwitch);
        shellPages[0] = shellWorkbench;
        Workspace.CanClose = id =>
        {
            if (id != "3" || !_openingDirty) return true;
            if (!ConfirmDiscardOpening()) return false;
            ReloadOpeningRows(); return true;
        };
        Workspace.ActiveChanged += id =>
        {
            if (id is null) { UpdateOperationMenu(-1); return; }
            changingSheet = true;
            try { Pages.SelectedIndex = int.Parse(id, System.Globalization.CultureInfo.InvariantCulture); }
            finally { changingSheet = false; }
            UpdateOperationMenu(Pages.SelectedIndex);
        };
        UpdateOperationMenu(-1);
    }
    private object BuildShellMenu(ShellMenu definition)
    {
        if (definition.Text == "-") return new Separator { Visibility = definition.Visible ? Visibility.Visible : Visibility.Collapsed };
        var item = new MenuItem { Header = definition.Text, InputGestureText = definition.Text.Contains(definition.Shortcut, StringComparison.Ordinal) ? "" : definition.Shortcut,
            Visibility = definition.Visible ? Visibility.Visible : Visibility.Collapsed, Tag = definition };
        shellMenus[definition.Id] = item;
        System.Windows.Automation.AutomationProperties.SetAutomationId(item, definition.Id);
        foreach (var child in definition.Children) item.Items.Add(BuildShellMenu(child));
        if (definition.Children.Length == 0)
        {
            var action = OriginalAction(definition);
            item.IsEnabled = action is not null;
            item.ToolTip = action is null ? $"未完成：{(definition.OriginalWindow.Length > 0 ? definition.OriginalWindow : definition.Text)} 尚未接入。"
                : "已接入当前基础实现；完整原窗口、数据格式与权限仍待验收。";
            ToolTipService.SetShowOnDisabled(item, true);
            item.Click += (_, e) =>
            {
                var current = OriginalAction(definition);
                if (current is not null) { e.Handled = true; current(); }
            };
        }
        return item;
    }
    private static string WorkbenchEntry(WorkbenchLink link) => "w_main1/" + link.Id + ".clicked";
    private static string MenuEntry(ShellMenu item) => (OriginalShellCatalog.VoucherOperations.Children.Any(d => d.Id == item.Id) ? "m_work_pz_pzxsb/" : "m_frame_zw/") + item.Id;
    private Action? OriginalAction(ShellMenu item)
    {
        var key = new ShellOriginalWindow("qingsong/main", item.OriginalWindow, MenuEntry(item));
        if (registeredWindows.ContainsKey(key)) return () => OpenRegisteredWindow(key);
        return item.Id switch
        {
        "m_system_closesheet" or "m_f" => CloseCurrentSheet,
        "m_system_closeall" => CloseAllSheets,
        "m_system_trans" => RequestBookSwitch,
        "m_useright" => ManageOperators,
        "m_changepswd" => ChangeOperatorPassword,
        "m_system_exit" => Close,
        "m_window_cascade" => () => Workspace.Arrange(MdiArrangement.Cascade),
        "m_window_htile" => () => Workspace.Arrange(MdiArrangement.Horizontal),
        "m_window_vtile" => () => Workspace.Arrange(MdiArrangement.Vertical),
        "m_window_layer" => () => Workspace.Arrange(MdiArrangement.Fill),
        "m_window_arrangeicons" => () => Workspace.Arrange(MdiArrangement.Icons),
        "m_help_sys" or "m_help_about" => () => About_Click(this, new RoutedEventArgs()),
        "m_help_calc" => () => Run(() => System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("calc.exe") { UseShellExecute = true }), requireBook: false),
        "m_operation_refrash" => () => Run(Reload, discardOpening: true),
        "m_operation_add" => () => NewVoucher_Click(this, new RoutedEventArgs()),
        "m_operation_modify" => () => EditVoucher_Click(this, new RoutedEventArgs()),
        "m_i20" => null,
        "m_operation_ck" => () => ViewSelectedVoucher(),
        "m_operation_ps" => () => Review_Click(this, new RoutedEventArgs()),
        "m_operation_qxsh" => () => CancelReview_Click(this, new RoutedEventArgs()),
        _ => CanOpenOriginalWindow(item.OriginalWindow, MenuEntry(item)) ? () => OpenOriginalWindow(item.OriginalWindow, MenuEntry(item)) : null
        };
    }
    private bool CanOpenOriginalWindow(string name, string entry = "") => registeredWindows.ContainsKey(new("qingsong/main", name, entry)) || name is
        "w_pz_pzxsb" or "w_pz_see" or "w_xt_kmwh" or "w_xt_ye_nf" or "w_xt_ye" or "w_zw_ye" or
        "w_zc_slz" or "w_xt_dlxx" or "w_xt_tz" or "w_tzjl" or "w_bf" or "w_hf" or "w_zw_fz" or
        "w_login" or "w_xt_users" or "w_pass" or "w_login_1" or "w_bb_main" or "w_xt_zy";
    private void OpenOriginalWindow(string name, string entry = "")
    {
        var key = new ShellOriginalWindow("qingsong/main", name, entry);
        if (registeredWindows.ContainsKey(key)) { OpenRegisteredWindow(key); return; }
        switch (name)
        {
            case "w_pz_pzxsb": ShowPage(1); break;
            case "w_pz_see": BrowseVouchers(); break;
            case "w_xt_kmwh": ShowPage(2); break;
            case "w_xt_ye_nf": case "w_xt_ye": ShowPage(3); break;
            case "w_zw_ye": ShowPage(4); break;
            case "w_zc_slz": ShowPage(5); break;
            case "w_xt_dlxx": ShowPage(6); break;
            case "w_xt_tz": BookInfo_Click(this, new RoutedEventArgs()); break;
            case "w_tzjl": ShowBookManager(); break;
            case "w_bf": Backup_Click(this, new RoutedEventArgs()); break;
            case "w_hf": Restore_Click(this, new RoutedEventArgs()); break;
            case "w_zw_fz": CloseMonth_Click(this, new RoutedEventArgs()); break;
            case "w_xt_users": ManageOperators(); break;
            case "w_pass": ChangeOperatorPassword(); break;
            case "w_login": RequestBookSwitch(); break;
            case "w_login_1": RequestOperatorSwitch(); break;
            case "w_xt_zy": ShellMenu("m_i20").RaiseEvent(new RoutedEventArgs(MenuItem.ClickEvent)); break;
            case "w_bb_main": ReportCenter_Click(this, new RoutedEventArgs()); break;
            default: NotificationText.Text = $"未完成：原窗口 {name} 尚未接入。"; break;
        }
    }
    /// <summary>Register real module handlers before enabling matching original entries. No metadata-only registration.</summary>
    public void RegisterModuleWindows(ShellModuleWindows registration)
    {
        ArgumentNullException.ThrowIfNull(registration);
        if (string.IsNullOrWhiteSpace(registration.ModuleId) || registration.ContractVersion != 1 || registration.Open is null ||
            registration.OriginalWindows is null || registration.OriginalWindows.Count == 0 ||
            !Enum.IsDefined(registration.Permission)) throw new ArgumentException("模块注册必须提供版本、真实窗口处理器、权限和原入口。");
        var keys = registration.OriginalWindows.ToArray();
        if (keys.Any(k => k is null || string.IsNullOrWhiteSpace(k.Product) || string.IsNullOrWhiteSpace(k.ObjectName) || string.IsNullOrWhiteSpace(k.Entry)) ||
            keys.Distinct().Count() != keys.Length || keys.Any(registeredWindows.ContainsKey))
            throw new ArgumentException("原窗口注册存在空字段、重复或已占用入口。");
        foreach (var key in keys) registeredWindows.Add(key, registration);
        foreach (var item in shellMenus.Values.Where(m => m.Tag is ShellMenu))
        {
            var definition = (ShellMenu)item.Tag;
            if (definition.Children.Length == 0 && definition.Id != "m_i20") item.IsEnabled = OriginalAction(definition) is not null;
        }
        shellWorkbench?.RefreshAvailability(link => CanOpenOriginalWindow(link.OriginalWindow, WorkbenchEntry(link)));
        UpdateOperationMenu(Workspace.ActiveId is null ? -1 : Pages.SelectedIndex);
    }
    private void OpenRegisteredWindow(ShellOriginalWindow key) => Run(() =>
    {
        var registration = registeredWindows[key];
        var binding = CaptureDisplayedFeature(_displayOrigin);
        binding.Authentication.Demand(registration.Permission);
        binding.DemandCurrent();
        registration.Open(new(this, binding, operationDate, key));
    });

    private void UpdateOperationMenu(int index)
    {
        operationMenu.Items.Clear();
        operationMenu.Visibility = index > 0 ? Visibility.Visible : Visibility.Collapsed;
        if (index == 1)
            foreach (var definition in OriginalShellCatalog.VoucherOperations.Children) operationMenu.Items.Add(BuildShellMenu(definition));
        else if (index > 0)
        {
            var refresh = new MenuItem { Header = "刷新当前基础数据" }; refresh.Click += (_, _) => Run(Reload, discardOpening: true); operationMenu.Items.Add(refresh);
            var close = new MenuItem { Header = "F.返回 Ctrl+F4", InputGestureText = "Ctrl+F4" }; close.Click += (_, _) => CloseCurrentSheet(); operationMenu.Items.Add(close);
        }
        if (extensionMenu.Items.Count > 0) { operationMenu.Items.Add(new Separator()); operationMenu.Items.Add(extensionMenu); }
    }
    private void EnsureShellPage(int index)
    {
        if (!HasBook || !shellPages.TryGetValue(index, out var content)) return;
        Workspace.Visibility = Visibility.Visible; Pages.Visibility = Visibility.Collapsed;
        Workspace.Open(index.ToString(System.Globalization.CultureInfo.InvariantCulture), index switch
        {
            0 => "工作台", 1 => "凭证序时簿（基础实现）", 2 => "科目维护（基础实现）", 3 => "期初余额（基础实现）",
            4 => "汇总余额表（基础实现）", 5 => "明细账（基础实现）", _ => "操作日志"
        }, content);
        UpdateWriteAccess(this);
    }
    private bool TryShellShortcut(System.Windows.Input.Key key, System.Windows.Input.ModifierKeys modifiers)
    {
        IEnumerable<ShellMenu> VisibleLeaves(IEnumerable<ShellMenu> definitions)
        {
            foreach (var definition in definitions.Where(d => d.Visible))
            {
                if (definition.Children.Length == 0) yield return definition;
                else foreach (var child in VisibleLeaves(definition.Children)) yield return child;
            }
        }
        var candidates = Pages.SelectedIndex == 1 && Workspace.ActiveId == "1"
            ? VisibleLeaves(OriginalShellCatalog.VoucherOperations.Children).Concat(VisibleLeaves(OriginalShellCatalog.AccountingMenu))
            : VisibleLeaves(OriginalShellCatalog.AccountingMenu);
        foreach (var definition in candidates.Where(d => d.Shortcut.Length > 0))
        {
            var flags = ShellModifiers.None;
            if (modifiers.HasFlag(System.Windows.Input.ModifierKeys.Control)) flags |= ShellModifiers.Control;
            if (modifiers.HasFlag(System.Windows.Input.ModifierKeys.Alt)) flags |= ShellModifiers.Alt;
            if (modifiers.HasFlag(System.Windows.Input.ModifierKeys.Shift)) flags |= ShellModifiers.Shift;
            if (modifiers.HasFlag(System.Windows.Input.ModifierKeys.Windows) || ShellShortcuts.Parse(definition.Shortcut) is not { } gesture ||
                gesture.Key != key.ToString() || gesture.Modifiers != flags) continue;
            var action = OriginalAction(definition);
            if (action is null) continue;
            action(); return true;
        }
        return false;
    }
    private void CloseCurrentSheet()
    {
        if (featureOpening) { NotificationText.Text = "后台操作尚未完成，请稍后关闭窗口。"; return; }
        if (Workspace.ActiveId is { } id) Workspace.Close(id);
    }
    private void CloseAllSheets()
    {
        if (featureOpening) return;
        if (Workspace.CloseAll() && HasBook) EnsureShellPage(0);
    }
    private void RequestBookSwitch() { BookSwitchRequested = true; SelectedLoginBookPath = _session?.DatabasePath; RequestOperatorSwitch(); }
    private void ManageOperators()
    {
        if (featureOpening) return;
        try { var auth = featureAuthentication ?? throw new InvalidOperationException("请先登录。"); OperatorDialogs.Manage(this, auth.Operators, auth.Session); }
        catch (Exception ex) { NotificationText.Text = "用户管理未完成：" + ex.Message; }
    }
    private void ChangeOperatorPassword()
    {
        if (featureOpening || !ConfirmDiscardOpening()) return;
        try
        {
            var auth = featureAuthentication ?? throw new InvalidOperationException("请先登录。");
            if (OperatorDialogs.ChangePassword(this, auth.Operators, auth.Session)) { _openingDirty = false; RequestOperatorSwitch(); }
        }
        catch (Exception ex) { NotificationText.Text = "自改密码未完成：" + ex.Message; }
    }
    private void ViewSelectedVoucher() => Run(() =>
    {
        var voucher = SelectedVoucher(); var shown = Service.GetSnapshot();
        var dialog = new Dialogs.VoucherEditorWindow(shown.Book, shown.Accounts, voucher, OperatorName(),
            _ => throw new InvalidOperationException("查看凭证只读。"), forceReadOnly: true) { Owner = this };
        dialog.ShowDialog();
    });
    private void BrowseVouchers() => Run(() =>
    {
        var filter = new VoucherBrowseWindow(Snapshot.Book) { Owner = this };
        if (filter.ShowDialog() != true) return;
        VoucherFrom.SelectedDate = filter.From.ToDateTime(TimeOnly.MinValue); VoucherTo.SelectedDate = filter.To.ToDateTime(TimeOnly.MinValue);
        browseKind = filter.Kind; browseFirst = filter.FirstNumber; browseLast = filter.LastNumber;
        VoucherSearch.Text = ""; VoucherStatusInput.SelectedIndex = 0;
        ShowPage(1); QueryVouchers();
    });
    private void ShowBookManager() => Run(() =>
    {
        var choices = RegisteredShellBooks();
        var manager = new BookManagerWindow(choices,
            () => NewBook_Click(this, new RoutedEventArgs()),
            () => Restore_Click(this, new RoutedEventArgs()),
            () => shellBookCopy?.RaiseEvent(new RoutedEventArgs(MenuItem.ClickEvent)),
            selected => shellBookCopy?.IsEnabled == true && selected is not null && string.Equals(selected.Path, _session?.DatabasePath, StringComparison.OrdinalIgnoreCase),
            _session?.DatabasePath) { Owner = this };
        if (manager.ShowDialog() == true && manager.Selected is { } selected)
        { BookSwitchRequested = true; SelectedLoginBookPath = selected.Path; RequestOperatorSwitch(); }
    }, requireBook: false);
    private IReadOnlyList<ShellBookChoice> RegisteredShellBooks() => managedFeatureContext is { } managed
        ? managed.Data.ReadInventory().Books.Select(b => new ShellBookChoice(Caiwu.Delivery.SafePaths.Child(managed.Data.DataRoot, b.RelativeDatabasePath),
            b.BookId == _displayBook?.Id ? _displayBook.Name : b.RelativeDatabasePath)).ToArray()
        : _session?.DatabasePath is { } path ? [new(path, Snapshot.Book.Name)] : [];

    public void OpenLoginBook(ShellLoginResult login)
    {
        _session!.Open(login.Book.Path);
        if (Snapshot.Book.Id != login.BookId) { _session.Close(); throw new InvalidDataException("所选账套身份发生变化，请重新登录核对。"); }
        ShellLogin.ValidateDate(login.OperationDate, Snapshot.Book.FiscalYear, Snapshot.Book.StartMonth);
        operationDate = login.OperationDate; OperationDateText.Text = $"操作日期：{operationDate:yyyy-MM-dd}";
        BookOpened(); EnsureShellPage(0);
    }
}
