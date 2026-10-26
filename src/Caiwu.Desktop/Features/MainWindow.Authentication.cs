using System.Windows;
using System.Windows.Controls;
using Caiwu.Operators.Wpf;

namespace Caiwu.Desktop;

public partial class MainWindow
{
    public bool LoginSwitchRequested { get; private set; }

    private void RequestOperatorSwitch()
    {
        if (featureOpening) { NotificationText.Text = "正在完成新功能操作，请等待结果后注销或换人。"; return; }
        if (!ConfirmDiscardOpening()) return;
        SelectedLoginBookPath ??= _session?.DatabasePath;
        _openingDirty = false;
        featureAuthentication?.Operators.Logout(featureAuthentication.Session);
        _session?.Close(); // Increment generation before any new login or restored copy can be opened.
        LoginSwitchRequested = true;
        Close();
    }
}
