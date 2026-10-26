using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Caiwu.Desktop.Shell.Wpf;

public sealed class WorkbenchControl : Grid
{
    private readonly List<(Button Button, WorkbenchLink Link)> links = [];
    public WorkbenchControl(Func<WorkbenchLink, bool> available, Action<WorkbenchLink> open, Action switchBookAction)
    {
        RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(245) });
        ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var shortcuts = new Canvas { Width = 900, Height = 2800, Background = Brushes.White };
        foreach (var link in OriginalShellCatalog.Workbench.Where(l => l.Page == 0))
        {
            var button = Link(link, available, open, false);
            Canvas.SetLeft(button, link.X); Canvas.SetTop(button, link.Y - 500); button.Width = link.Width; button.Height = 78;
            shortcuts.Children.Add(button); links.Add((button, link));
        }
        var left = new Viewbox { Stretch = Stretch.Uniform, StretchDirection = StretchDirection.Both, VerticalAlignment = VerticalAlignment.Top, Child = shortcuts };
        var shortcutScroll = new ScrollViewer { Content = left, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
        SetRow(shortcutScroll, 1); Children.Add(shortcutScroll);
        var switchBook = new Button { Content = "切换套账", HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(8), ToolTip = "原工作台 p_rjsj 入口" };
        switchBook.Click += (_, _) => switchBookAction(); SetColumnSpan(switchBook, 2); Children.Add(switchBook);
        var tabs = new TabControl { Margin = new Thickness(8), HorizontalContentAlignment = HorizontalAlignment.Stretch };
        SetColumn(tabs, 1); SetRow(tabs, 1); Children.Add(tabs);
        for (var page = 1; page <= 3; page++)
        {
            var canvas = new Canvas { Width = 3500, Height = 2500, Background = Brushes.White };
            foreach (var link in OriginalShellCatalog.Workbench.Where(l => l.Page == page))
            {
                var button = Link(link, available, open, link.Height > 100);
                button.Width = link.Height > 100 ? Math.Max(link.Width, 560) : Math.Max(link.Width, 658);
                button.Height = link.Height > 100 ? link.Height + 55 : 100;
                Canvas.SetLeft(button, link.X); Canvas.SetTop(button, link.Y); canvas.Children.Add(button); links.Add((button, link));
            }
            tabs.Items.Add(new TabItem { Header = page.ToString(), ToolTip = "原页签标题未记录；暂以原页对象顺序编号。",
                Content = new ScrollViewer { HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                    Content = new Viewbox { Child = canvas, Stretch = Stretch.Uniform, VerticalAlignment = VerticalAlignment.Top } } });
        }
    }
    public void RefreshAvailability(Func<WorkbenchLink, bool> available)
    {
        foreach (var (button, link) in links)
        {
            button.IsEnabled = available(link);
            button.ToolTip = button.IsEnabled ? $"原入口：{link.OriginalWindow}；已绑定实际窗口处理器。" : $"未完成：{link.OriginalWindow} 尚未接入。";
        }
    }
    private static Button Link(WorkbenchLink link, Func<WorkbenchLink, bool> available, Action<WorkbenchLink> open, bool icon)
    {
        var enabled = available(link);
        var content = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        if (icon) content.Children.Add(new TextBlock { Text = "◇", FontSize = 82, HorizontalAlignment = HorizontalAlignment.Center, Foreground = new SolidColorBrush(Color.FromRgb(34, 79, 119)) });
        content.Children.Add(new TextBlock { Text = link.Text, TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center, FontSize = icon ? 47 : 48 });
        var button = new Button { Content = content, IsEnabled = enabled, Margin = new Thickness(0), Padding = new Thickness(6),
            Background = icon ? new SolidColorBrush(Color.FromRgb(242, 247, 252)) : Brushes.Transparent,
            BorderThickness = new Thickness(icon ? 2 : 0),
            ToolTip = enabled ? $"原入口：{link.OriginalWindow}；当前基础实现，完整原窗口待验。" : $"未完成：{link.OriginalWindow} 尚未接入。" };
        ToolTipService.SetShowOnDisabled(button, true);
        System.Windows.Automation.AutomationProperties.SetAutomationId(button, link.Id);
        System.Windows.Automation.AutomationProperties.SetName(button, link.Text + (enabled ? "" : "（未完成）"));
        button.Click += (_, _) => open(link); return button;
    }
}
