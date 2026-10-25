using System.IO;
using System.Windows;
using System.Windows.Controls;
using Caiwu.Summaries;
using Caiwu.Summaries.Wpf;

internal static class Program
{
    [STAThread]
    private static int Main()
    {
        var app = new Application();
        app.Resources.MergedDictionaries.Add(new ResourceDictionary
        { Source = new Uri("pack://application:,,,/PresentationFramework.Fluent;component/Themes/Fluent.xaml") });
        try
        {
            // An independent synthetic catalog, retained across demo launches in user data, never beside binaries.
            var bookId = Guid.Parse("7a61595e-0edc-4353-8941-7e82910956bf");
            var dataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Caiwu", "SummaryManagerDemo");
            var location = new SummaryCatalogLocation(dataRoot, Path.Combine(dataRoot, "synthetic-book", "catalog.json"), bookId);
            JsonSummaryCatalog catalog;
            if (File.Exists(location.CatalogPath)) catalog = JsonSummaryCatalog.Open(location);
            else
            {
                catalog = JsonSummaryCatalog.Create(location);
                var initial = catalog.AddCategory("合成示例", catalog.Read().Version);
                catalog.AddSummary(initial.Categories[0].Id, "合成示例：支付办公用品费", initial.Version);
            }

            var owner = new Window { Title = "摘要库独立宿主 · 合成账套演示", Width = 720, Height = 340,
                WindowStartupLocation = WindowStartupLocation.CenterScreen, FontSize = 14 };
            var root = new DockPanel();
            var menu = new Menu(); DockPanel.SetDock(menu, Dock.Top); root.Children.Add(menu);
            var tools = new MenuItem { Header = "工具(_T)" }; menu.Items.Add(tools);
            var manage = new MenuItem { Header = "摘要库管理与选择…" }; tools.Items.Add(manage);
            var content = new StackPanel { Margin = new Thickness(24) }; root.Children.Add(content);
            content.Children.Add(new TextBlock { Text = "合成账套演示", FontSize = 24, FontWeight = FontWeights.SemiBold });
            content.Children.Add(new TextBlock { Text = "从工具菜单或下方按钮打开摘要库；取消选择会保留原文字。", Margin = new Thickness(0, 10, 0, 12), TextWrapping = TextWrapping.Wrap });
            var field = new TextBox { Text = "原分录手写摘要", Padding = new Thickness(10), AcceptsReturn = true, Height = 70, TextWrapping = TextWrapping.Wrap };
            content.Children.Add(field);
            var button = new Button { Content = "管理或选择摘要…", Padding = new Thickness(14, 8, 14, 8), Margin = new Thickness(0, 12, 0, 0), HorizontalAlignment = HorizontalAlignment.Left };
            content.Children.Add(button);
            Guid? selectedId = null;
            void OpenManager(object sender, RoutedEventArgs e)
            {
                var result = SummaryManagementDialogs.ShowManager(owner, catalog, "合成账套演示", selectedId, field);
                if (result.Accepted) { field.Text = result.Value!.Text; selectedId = result.Value.Id; }
            }
            manage.Click += OpenManager; button.Click += OpenManager;
            owner.Content = root;
            return app.Run(owner);
        }
        catch (Exception ex)
        {
            MessageBox.Show("演示摘要库无法打开。保留原文件，未重建空库。\n" + ex.Message, "摘要库演示", MessageBoxButton.OK, MessageBoxImage.Error);
            return 1;
        }
    }
}
