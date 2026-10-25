using System.Windows;

namespace Caiwu.Operators.Wpf;

public partial class LoginWindow : Window
{
    private readonly LocalOperatorService _service;
    public OperatorSession? Session { get; private set; }
    public LoginWindow(LocalOperatorService service)
    {
        InitializeComponent(); _service = service; DialogSupport.Prepare(this);
        Loaded += (_, _) => LoginInput.Focus();
        Closed += (_, _) => PasswordInput.Clear();
    }
    private void Login_Click(object sender, RoutedEventArgs e)
    {
        if (!LoginButton.IsEnabled) return;
        LoginButton.IsEnabled = false; ErrorText.Text = "";
        try
        {
            Session = _service.Login(LoginInput.Text, PasswordInput.Password);
            PasswordInput.Clear(); DialogResult = true;
        }
        catch (Exception ex) { DialogSupport.Error(ErrorText, ex); PasswordInput.Clear(); PasswordInput.Focus(); }
        finally { LoginButton.IsEnabled = true; }
    }
}
