using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace Caiwu.Reporting.Wpf;

/// <summary>w_pz_km_find: list above search controls, search/confirm and keyboard instructions below.</summary>
internal sealed class BooksAccountSearchWindow : Window
{
    private readonly BooksQueryWindow.AccountOption[] accounts;
    private readonly ListBox list = new() { Name = "dw_1", DisplayMemberPath = "Display", FontSize = 56 };
    private readonly TextBox search = new() { Name = "sle_1" };
    public string? SelectedCode => (list.SelectedItem as BooksQueryWindow.AccountOption)?.Code;
    internal BooksAccountSearchWindow(IEnumerable<BooksQueryWindow.AccountOption> accounts)
    {
        this.accounts = accounts.ToArray();
        Name = "w_pz_km_find"; Title = "科目查找"; SizeToContent = SizeToContent.WidthAndHeight; ResizeMode = ResizeMode.NoResize;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        var canvas = new Canvas { Width = 3630, Height = 1860 };
        Content = new Viewbox { Width = 900, Height = 470, Child = canvas };
        BooksQueryWindow.Add(canvas, list, 0, 4, 3593, 1436);
        BooksQueryWindow.Add(canvas, new TextBlock { Text = "搜索内容：" }, 699, 1496, 379, 72);
        BooksQueryWindow.Add(canvas, search, 1061, 1488, 1038, 88);
        BooksQueryWindow.Add(canvas, BooksQueryWindow.Button("开始搜索", Filter, "cb_1"), 937, 1616, 398, 108);
        BooksQueryWindow.Add(canvas, BooksQueryWindow.Button("确定", Confirm, "cb_2"), 1527, 1616, 398, 108);
        BooksQueryWindow.Add(canvas, new TextBlock { Text = "键盘操作说明：" }, 2290, 1472, 526, 68);
        BooksQueryWindow.Add(canvas, new TextBlock { Text = "1）按上下箭头选择科目" }, 2350, 1552, 585, 76);
        BooksQueryWindow.Add(canvas, new TextBlock { Text = "2）找到后按回车确认（或者鼠标双击）" }, 2359, 1640, 969, 76);
        list.MouseDoubleClick += (_, _) => Confirm();
        list.KeyDown += (_, e) => { if (e.Key == Key.Enter) { Confirm(); e.Handled = true; } };
        search.KeyDown += (_, e) => { if (e.Key == Key.Enter) { Filter(); e.Handled = true; } };
        Filter();
    }
    private void Filter()
    {
        var term = search.Text.Trim();
        list.ItemsSource = accounts.Where(a => a.Code.Contains(term, StringComparison.OrdinalIgnoreCase) ||
            a.Name.Contains(term, StringComparison.OrdinalIgnoreCase)).ToArray();
        if (list.Items.Count > 0) list.SelectedIndex = 0;
    }
    private void Confirm() { if (SelectedCode is not null) DialogResult = true; }
}
