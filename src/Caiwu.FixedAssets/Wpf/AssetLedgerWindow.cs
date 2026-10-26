using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;

namespace Caiwu.FixedAssets.Wpf;

/// <summary>
/// Standalone module review surface. Only implemented operations are rendered; unimplemented original menus remain in handoff.
/// The host owns MDI/menu integration. DataWindow visual column order remains unverified; this grid is not a parity claim.
/// </summary>
public sealed class AssetLedgerWindow : Window
{
    private readonly AssetBookService service;
    private readonly DataGrid ledger = new() { IsReadOnly = true, AutoGenerateColumns = false, CanUserAddRows = false };
    public AssetLedgerWindow(AssetBookService service)
    {
        this.service = service;
        Title = "固定资产管理"; Width = 1120; Height = 500;
        AutomationProperties.SetAutomationId(this, "w_zc_zcgl");
        AutomationProperties.SetAutomationId(ledger, "dw_master");
        var root = new DockPanel(); var menu = new Menu(); DockPanel.SetDock(menu, Dock.Top); root.Children.Add(menu);
        var operations = new MenuItem { Header = "O.操作" }; menu.Items.Add(operations);
        Add(operations, "刷新 Ctrl+F", Refresh, Key.F, ModifierKeys.Control);
        Add(operations, "新增资产 Ctrl+A", AddCard, Key.A, ModifierKeys.Control);
        Add(operations, "修改", EditCard);
        Add(operations, "原值调整", () => Selected(id => new AssetOriginalCostWindow(service, id) { Owner = this }.ShowDialog()));
        Add(operations, "注销", () => Selected(id => new AssetDisposalWindow(service, id) { Owner = this }.ShowDialog()));
        Add(operations, "删除资产 Ctrl+D", DeleteCard, Key.D, ModifierKeys.Control);
        Add(operations, "F.返回 Ctrl+F4", Close, Key.F4, ModifierKeys.Control);
        var daily = new MenuItem { Header = "O日常业务" }; menu.Items.Add(daily);
        Add(daily, "计提折旧", () => { new AssetDepreciationWindow(service) { Owner = this }.ShowDialog(); Refresh(); });
        Add(daily, "生成凭证", QueryDepreciation);
        Add(daily, "折旧查询", QueryDepreciation);
        Add(daily, "凭证计划", ViewPlans);
        var system = new MenuItem { Header = "S系统管理" }; menu.Items.Add(system);
        Add(system, "取消折旧", () => { new AssetCancelDepreciationWindow(service) { Owner = this }.ShowDialog(); Refresh(); });
        AddColumn("设备编号", nameof(AssetLedgerRow.Code), 110); AddColumn("设备名称", nameof(AssetLedgerRow.Name), 160);
        AddColumn("类别", nameof(AssetLedgerRow.CategoryCode), 70); AddColumn("使用部门", nameof(AssetLedgerRow.DepartmentCode), 90);
        AddColumn("使用日期", nameof(AssetLedgerRow.UseDate), 105, "yyyy-MM-dd");
        AddColumn("原值", nameof(AssetLedgerRow.OriginalCost), 100, "N2"); AddColumn("预计残值", nameof(AssetLedgerRow.ResidualValue), 100, "N2");
        AddColumn("累计折旧额", nameof(AssetLedgerRow.AccumulatedDepreciation), 115, "N2");
        AddColumn("净值", nameof(AssetLedgerRow.NetValue), 100, "N2"); AddColumn("注销日期", nameof(AssetLedgerRow.DisposalDate), 105, "yyyy-MM-dd");
        ledger.MouseDoubleClick += (_, _) => Run(EditCard);
        // Keep the known dw_master outer bounds in source PBU; inherited toolbar order/visibility remains unverified.
        var canvas = new Canvas { Width = 3419, Height = 1240, Background = Brushes.White };
        ledger.Width = 2400; ledger.Height = 676; ledger.FontSize = 42; ledger.RowHeight = 78;
        foreach (var column in ledger.Columns) column.Width = column.Width.Value * 3;
        Canvas.SetLeft(ledger, 23); Canvas.SetTop(ledger, 204); canvas.Children.Add(ledger);
        root.Children.Add(new Viewbox { Stretch = Stretch.Uniform, Child = canvas }); Content = root; Refresh();
    }
    private void AddColumn(string caption, string path, double width, string? format = null) => ledger.Columns.Add(
        new DataGridTextColumn { Header = caption, Binding = new Binding(path) { StringFormat = format }, Width = width });
    private void Add(MenuItem parent, string caption, Action action, Key key = Key.None, ModifierKeys modifiers = ModifierKeys.None)
    {
        var item = new MenuItem { Header = caption }; item.Click += (_, _) => Run(action); parent.Items.Add(item);
        if (key != Key.None)
        {
            var command = new RoutedCommand(); CommandBindings.Add(new CommandBinding(command, (_, _) => Run(action)));
            InputBindings.Add(new KeyBinding(command, key, modifiers));
        }
    }
    private void Run(Action action)
    {
        try { action(); }
        catch (Exception ex) when (ex is AssetRuleException or System.IO.IOException or FormatException or OverflowException)
        { MessageBox.Show(this, ex.Message, Title, MessageBoxButton.OK, MessageBoxImage.Information); }
    }
    public void Refresh() => ledger.ItemsSource = service.Ledger();
    private void AddCard()
    {
        new AssetCardWindow(service) { Owner = this }.ShowDialog(); Refresh();
    }
    private void EditCard()
    {
        if (ledger.SelectedItem is not AssetLedgerRow row) return;
        new AssetCardWindow(service, row.AssetId) { Owner = this }.ShowDialog(); Refresh();
    }
    private void DeleteCard()
    {
        if (ledger.SelectedItem is not AssetLedgerRow row) return;
        var revision = service.Read().Revision;
        if (MessageBox.Show(this, $"是否删除 {row.Code}？", Title, MessageBoxButton.YesNo) == MessageBoxResult.Yes)
            service.DeleteCard(revision, row.AssetId);
        Refresh();
    }
    private void Selected(Func<Guid, bool?> action)
    {
        if (ledger.SelectedItem is not AssetLedgerRow row) throw new AssetRuleException("selection-required", "请先选择设备。");
        action(row.AssetId); Refresh();
    }
    private void ViewPlans()
    {
        var snapshot = service.Read();
        var grid = new DataGrid { IsReadOnly = true, AutoGenerateColumns = true, CanUserAddRows = false,
            ItemsSource = snapshot.VoucherPlans.Where(x => !x.Voided).Select(x => new
            { x.Id, 日期 = x.Date, 类型 = x.VoucherType, 编号 = x.VoucherNumber, 借方 = x.DebitTotal, 贷方 = x.CreditTotal }).ToArray() };
        var window = new Window { Title = "凭证计划", Width = 900, Height = 500, Owner = this, Content = grid };
        grid.MouseDoubleClick += (_, _) =>
        {
            if (grid.SelectedItem is null) return;
            var id = (Guid)grid.SelectedItem.GetType().GetProperty("Id")!.GetValue(grid.SelectedItem)!;
            AssetVoucherPlanWindow.ShowPlan(window, service, snapshot.VoucherPlans.Single(x => x.Id == id));
            window.Close();
        };
        window.ShowDialog();
    }
    private void QueryDepreciation() => new AssetDepreciationQueryWindow(service) { Owner = this }.ShowDialog();
}
