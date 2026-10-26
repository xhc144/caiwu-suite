using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Microsoft.Win32;

namespace Caiwu.Desktop.Shell.Wpf;

public sealed class BookSearchWindow : Window
{
    private readonly IReadOnlyList<ShellBookChoice> books;
    private readonly TextBox search = new() { MinWidth = 230 };
    private readonly DataGrid grid = new() { AutoGenerateColumns = false, IsReadOnly = true, CanUserAddRows = false,
        CanUserDeleteRows = false, SelectionMode = DataGridSelectionMode.Single, SelectionUnit = DataGridSelectionUnit.FullRow };
    public ShellBookChoice? Selected { get; private set; }
    public BookSearchWindow(IEnumerable<ShellBookChoice> choices, string dataRoot)
    {
        books = choices.ToArray(); Title = "套账查找"; Width = 650; Height = 500; MinWidth = 530; MinHeight = 350;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        SetResourceReference(StyleProperty, typeof(Window));
        var panel = new DockPanel { Margin = new Thickness(18) }; Content = panel;
        var top = new DockPanel { Margin = new Thickness(0, 0, 0, 12) }; DockPanel.SetDock(top, Dock.Top); panel.Children.Add(top);
        top.Children.Add(new Label { Content = "搜索内容：" });
        var find = new Button { Content = "开始搜索", MinWidth = 90 }; DockPanel.SetDock(find, Dock.Right); top.Children.Add(find); top.Children.Add(search);
        find.Click += (_, _) => Filter(); search.KeyDown += (_, e) => { if (e.Key == Key.Enter) { Filter(); e.Handled = true; grid.Focus(); } };
        var footer = new StackPanel { Margin = new Thickness(0, 12, 0, 0) }; DockPanel.SetDock(footer, Dock.Bottom); panel.Children.Add(footer);
        footer.Children.Add(new TextBlock { Text = "键盘操作说明：上下箭头选择套账，回车确认（或者鼠标双击）", TextWrapping = TextWrapping.Wrap });
        var browse = new Button { Content = "选择尚未登记的 .caiwu 账套…", HorizontalAlignment = HorizontalAlignment.Left,
            Margin = new Thickness(0, 12, 0, 0), ToolTip = "当前格式适配入口；原版账套引入尚未完成。" };
        browse.Click += (_, _) =>
        {
            var file = new OpenFileDialog { Title = "选择受管 .caiwu 账套", InitialDirectory = dataRoot, Filter = "当前账套 (*.caiwu)|*.caiwu", CheckFileExists = true };
            if (file.ShowDialog(this) != true) return;
            Selected = new(file.FileName, Path.GetFileNameWithoutExtension(file.FileName)); DialogResult = true;
        };
        footer.Children.Add(browse);
        grid.Columns.Add(new DataGridTextColumn { Header = "账套代码（待原格式接入）", Binding = new System.Windows.Data.Binding(nameof(ShellBookChoice.Code)), Width = 170 });
        grid.Columns.Add(new DataGridTextColumn { Header = "套账名称 / 已登记位置", Binding = new System.Windows.Data.Binding(nameof(ShellBookChoice.Name)), Width = new DataGridLength(1, DataGridLengthUnitType.Star) });
        grid.MouseDoubleClick += (_, _) => Accept();
        grid.PreviewKeyDown += (_, e) => { if (e.Key == Key.Enter) { Accept(); e.Handled = true; } };
        panel.Children.Add(grid); Filter();
    }
    private void Filter() { grid.ItemsSource = ShellLogin.Search(books, search.Text); grid.SelectedIndex = grid.Items.Count > 0 ? 0 : -1; }
    private void Accept() { if (grid.SelectedItem is ShellBookChoice selected) { Selected = selected; DialogResult = true; } }
}
