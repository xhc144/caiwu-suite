using System.Windows;

namespace Caiwu.Operators.Wpf;

public partial class ChangePasswordWindow : Window
{
    private readonly LocalOperatorService _service;
    private readonly OperatorSession _session;
    public ChangePasswordWindow(LocalOperatorService service, OperatorSession session)
    {
        InitializeComponent(); _service = service; _session = session; DialogSupport.Prepare(this);
        _service.RequirePermission(session, OperatorPermission.ReadLedger);
        Loaded += (_, _) => CurrentInput.Focus();
        Closed += (_, _) => { CurrentInput.Clear(); PasswordInput.Clear(); ConfirmInput.Clear(); };
    }
    private void Save_Click(object sender, RoutedEventArgs e)
    {
        if (!SaveButton.IsEnabled) return;
        SaveButton.IsEnabled = false; ErrorText.Text = "";
        try
        {
            if (PasswordInput.Password != ConfirmInput.Password) throw new OperatorValidationException("两次输入的密码不一致。");
            _service.ChangePassword(_session, CurrentInput.Password, PasswordInput.Password); DialogResult = true;
        }
        catch (Exception ex) { DialogSupport.Error(ErrorText, ex); }
        finally { SaveButton.IsEnabled = true; }
    }
}
