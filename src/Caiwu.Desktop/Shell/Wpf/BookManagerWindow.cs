using System.Windows;
using System.Windows.Controls;

namespace Caiwu.Desktop.Shell.Wpf;

public sealed class BookManagerWindow : Window
{
    private readonly ListBox list = new() { DisplayMemberPath = nameof(ShellBookChoice.Display) };
    public ShellBookChoice? Selected => list.SelectedItem as ShellBookChoice;
    public BookManagerWindow(IEnumerable<ShellBookChoice> books, Action create, Action restore, Action copy, Func<ShellBookChoice?, bool> canCopy, string? currentPath)
    {
        Title = "套帐管理（当前格式适配）"; Width = 780; Height = 520; MinWidth = 650; MinHeight = 420; WindowStartupLocation = WindowStartupLocation.CenterOwner;
        SetResourceReference(StyleProperty, typeof(Window));
        var layout = new DockPanel { Margin = new Thickness(20) }; Content = layout;
        var notice = new TextBlock { Text = "当前仅管理已登记 .caiwu 账套。原两位账套代码、原备份引入、删除与自动备份尚未接入；新增仍为实验建账表单。", TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 16) };
        DockPanel.SetDock(notice, Dock.Top); layout.Children.Add(notice);
        var auto = new Button { Content = "自动备份设置（未完成）", IsEnabled = false, HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 12, 0, 0) };
        DockPanel.SetDock(auto, Dock.Bottom); layout.Children.Add(auto);
        var actions = new StackPanel { Width = 125, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(15, 0, 0, 0) };
        DockPanel.SetDock(actions, Dock.Right); layout.Children.Add(actions);
        Button Add(string text, Action? action, bool enabled = true, string? tooltip = null)
        {
            var button = new Button { Content = text, Margin = new Thickness(0, 0, 0, 8), IsEnabled = enabled, ToolTip = tooltip };
            ToolTipService.SetShowOnDisabled(button, true); if (action is not null) button.Click += (_, _) => action(); actions.Children.Add(button); return button;
        }
        Add("新增", () => { DialogResult = false; create(); }, tooltip: "创建当前实验格式；原初始化向导未完成。");
        Add("引入", () => { DialogResult = false; restore(); }, tooltip: "当前受管完整备份恢复副本；原版备份格式未接入。");
        Add("删除（未完成）", null, false, "原账套代码/管理员校验/删除事务尚未接入，未执行删除。");
        var copyButton = Add("复制", () => { if (canCopy(Selected)) { DialogResult = false; copy(); } }, false, "复制当前已打开的账套，保留源；其他目录行的复制尚未接入。");
        Add("确定", () => { if (Selected is not null) DialogResult = true; });
        Add("取消", () => DialogResult = false);
        list.ItemsSource = books.ToArray();
        list.SelectionChanged += (_, _) => copyButton.IsEnabled = canCopy(Selected);
        list.SelectedItem = list.Items.OfType<ShellBookChoice>().FirstOrDefault(b => string.Equals(b.Path, currentPath, StringComparison.OrdinalIgnoreCase));
        layout.Children.Add(list);
    }
}
