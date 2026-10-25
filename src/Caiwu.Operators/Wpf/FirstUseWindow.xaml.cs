using System.Windows;

namespace Caiwu.Operators.Wpf;

public partial class FirstUseWindow : Window
{
    private readonly LocalOperatorService _service;
    public FirstUseWindow(LocalOperatorService service)
    {
        InitializeComponent(); _service = service; DialogSupport.Prepare(this);
        Loaded += (_, _) => LoginInput.Focus();
        Closed += (_, _) => { PasswordInput.Clear(); ConfirmInput.Clear(); };
    }
    private void Save_Click(object sender, RoutedEventArgs e)
    {
        if (!SaveButton.IsEnabled) return;
        SaveButton.IsEnabled = false; ErrorText.Text = "";
        try
        {
            if (PasswordInput.Password != ConfirmInput.Password) throw new OperatorValidationException("两次输入的密码不一致。");
            _service.InitializeAdministrator(LoginInput.Text, DisplayInput.Text, PasswordInput.Password);
            PasswordInput.Clear(); ConfirmInput.Clear(); DialogResult = true;
        }
        catch (Exception ex) { DialogSupport.Error(ErrorText, ex); }
        finally { SaveButton.IsEnabled = true; }
    }
}
