using System.Windows;
using System.Windows.Controls;
using Caiwu.Desktop.Presentation;
using Caiwu.Operators;

namespace Caiwu.Desktop.Shell.Wpf;

/// <summary>w_login_1: user code/password only; book and explicit operation date stay fixed.</summary>
public sealed class ShellUserSwitchWindow : Window
{
    private readonly ComboBox user = new() { IsEditable = true, MinWidth = 245 };
    private readonly PasswordBox password = new() { MaxLength = 128 };
    private readonly TextBlock error = new() { TextWrapping = TextWrapping.Wrap };
    public ShellLoginResult? Result { get; private set; }
    public ShellUserSwitchWindow(LocalOperatorService operators, Func<OperatorSession, DesktopBackend> backend,
        ShellBookChoice selectedBook, DateOnly operationDate)
    {
        Title = "切换用户"; Width = 510; SizeToContent = SizeToContent.Height; ResizeMode = ResizeMode.NoResize;
        WindowStartupLocation = WindowStartupLocation.CenterScreen; SetResourceReference(StyleProperty, typeof(Window));
        var form = new Grid { Margin = new Thickness(24) }; Content = form;
        form.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(100) }); form.ColumnDefinitions.Add(new ColumnDefinition());
        for (var i = 0; i < 4; i++) form.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        var userLabel = new Label { Content = "用户代码", Target = user, VerticalAlignment = VerticalAlignment.Center }; form.Children.Add(userLabel);
        user.ItemsSource = operators.GetLoginNames(); Grid.SetColumn(user, 1); user.Margin = new Thickness(0, 0, 0, 12); form.Children.Add(user);
        var passwordLabel = new Label { Content = "用户密码", Target = password, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetRow(passwordLabel, 1); form.Children.Add(passwordLabel); Grid.SetRow(password, 1); Grid.SetColumn(password, 1); form.Children.Add(password);
        Grid.SetRow(error, 2); Grid.SetColumnSpan(error, 2); error.Margin = new Thickness(0, 12, 0, 0); form.Children.Add(error);
        var actions = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 20, 0, 0) };
        var confirm = new Button { Content = "_Y. 确认", MinWidth = 105 }; var exit = new Button { Content = "_E. 退出", MinWidth = 105 };
        actions.Children.Add(confirm); actions.Children.Add(exit); Grid.SetRow(actions, 3); Grid.SetColumnSpan(actions, 2); form.Children.Add(actions);
        confirm.Click += (_, _) =>
        {
            if (!confirm.IsEnabled) return;
            confirm.IsEnabled = false;
            try
            {
                Result = new ShellLoginCoordinator(operators, backend).Login(selectedBook, user.Text, password.Password, operationDate.ToString("yyyy-MM-dd"));
                password.Clear(); DialogResult = true;
            }
            catch (Exception ex) { error.Text = "切换用户未完成：" + ex.Message; }
            finally { confirm.IsEnabled = true; password.Clear(); }
        };
        exit.Click += (_, _) => DialogResult = false; Closed += (_, _) => password.Clear();
        System.Windows.Automation.AutomationProperties.SetAutomationId(user, "ParitySwitchUser");
        System.Windows.Automation.AutomationProperties.SetAutomationId(password, "ParitySwitchPassword");
    }
}
