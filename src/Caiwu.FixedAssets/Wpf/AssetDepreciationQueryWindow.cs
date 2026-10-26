using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Caiwu.FixedAssets.Wpf;

public sealed class AssetDepreciationQueryWindow : Window
{
    public AssetDepreciationQueryWindow(AssetBookService service)
    {
        Title = "折旧查询"; Width = 1180; Height = 560;
        System.Windows.Automation.AutomationProperties.SetAutomationId(this, "w_zjgl");
        var root = new DockPanel(); var menu = new Menu(); DockPanel.SetDock(menu, Dock.Top); root.Children.Add(menu);
        var operation = new MenuItem { Header = "O.操作" }; menu.Items.Add(operation);
        var canvas = new Canvas { Width = 3781, Height = 1328, Background = Brushes.White };
        root.Children.Add(new Viewbox { Stretch = Stretch.Uniform, Child = canvas }); Content = root;
        T Put<T>(T element, string name, double x, double y, double width, double height) where T : FrameworkElement
        {
            System.Windows.Automation.AutomationProperties.SetAutomationId(element, name);
            element.Width = width; element.Height = height; Canvas.SetLeft(element, x); Canvas.SetTop(element, y); canvas.Children.Add(element); return element;
        }
        void Text(string id, string value, double x, double y, double w, double h) => Put(new TextBlock { Text = value, FontSize = 44 }, id, x, y, w, h);
        Text("st_nf", "会计年度", 69, 220, 229, 72); Text("st_3", "月份从", 649, 220, 261, 72); Text("st_4", "到", 1170, 220, 123, 72);
        var period = service.Read().Batches.Where(x => !x.Cancelled).OrderByDescending(x => x.Period).Select(x => x.Period).FirstOrDefault(service.Read().Settings.OpeningPeriod);
        var year = Put(new TextBox { FontSize = 44, Text = period.Year.ToString(CultureInfo.InvariantCulture) }, "em_nf", 302, 212, 306, 92);
        var first = Put(new TextBox { FontSize = 44, Text = "1" }, "em_1", 928, 212, 224, 92);
        var last = Put(new TextBox { FontSize = 44, Text = "12" }, "em_2", 1321, 212, 224, 92);
        var hide = Put(new CheckBox { FontSize = 44, Content = "折旧为零不显示" }, "cbx_1", 2098, 208, 512, 96);
        var grid = Put(new DataGrid { IsReadOnly = true, AutoGenerateColumns = true, CanUserAddRows = false, FontSize = 42, RowHeight = 78 },
            "dw_master", 9, 316, 3392, 676);
        AssetDepreciationBatch[] batches = [];
        void Search()
        {
            try
            {
                var y = int.Parse(year.Text, CultureInfo.InvariantCulture); var f = int.Parse(first.Text, CultureInfo.InvariantCulture);
                var l = int.Parse(last.Text, CultureInfo.InvariantCulture);
                _ = service.DepreciationQuery(y, f, l, hide.IsChecked == true);
                batches = service.Read().Batches.Where(x => !x.Cancelled && x.Period.Year == y && x.Period.Month >= f && x.Period.Month <= l).ToArray();
                grid.ItemsSource = batches.SelectMany(b => b.Lines.Where(x => hide.IsChecked != true || x.Amount != 0).Select(x => new
                { 批次 = b.Id, 年 = b.Period.Year, 月 = b.Period.Month, 设备编号 = x.AssetCode, 名称 = x.AssetName,
                    使用部门 = x.DepartmentCode, 用途 = x.PurposeCode, 折旧方法 = x.Method, 月工作量 = x.Workload, 月折旧额 = x.Amount })).ToArray();
            }
            catch (Exception ex) when (ex is FormatException or OverflowException or AssetRuleException or System.IO.IOException)
            { MessageBox.Show(this, ex.Message, Title); }
        }
        var search = Put(new Button { Content = "搜索", FontSize = 44 }, "cb_1", 1614, 204, 343, 104); search.Click += (_, _) => Search();
        var refresh = new MenuItem { Header = "刷新 Ctrl+F" }; refresh.Click += (_, _) => Search(); operation.Items.Add(refresh);
        var plan = new MenuItem { Header = "凭证制作" }; plan.Click += (_, _) =>
        {
            try
            {
                if (grid.SelectedItem is null) throw new AssetRuleException("selection-required", "请先选择计提月份的折旧明细。");
                var id = (Guid)grid.SelectedItem.GetType().GetProperty("批次")!.GetValue(grid.SelectedItem)!;
                new AssetVoucherPlanWindow(service, AssetVoucherKind.Depreciation, id) { Owner = this }.ShowDialog();
            }
            catch (Exception ex) when (ex is AssetRuleException or System.IO.IOException) { MessageBox.Show(this, ex.Message, Title); }
        }; operation.Items.Add(plan);
        Search();
    }
}
