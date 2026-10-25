using System.Windows;
using System.Windows.Controls;
using Caiwu.Operators.Wpf;

namespace Caiwu.Desktop;

public partial class MainWindow
{
    public bool LoginSwitchRequested { get; private set; }

    private void InitializeOperatorMenus(MenuItem system)
    {
        var manage = new MenuItem { Header = "操作员管理…", IsEnabled = featureAuthentication is not null };
        var password = new MenuItem { Header = "修改本人密码…", IsEnabled = featureAuthentication is not null };
        var switchOperator = new MenuItem { Header = "注销并切换操作员…", IsEnabled = featureAuthentication is not null };
        system.Items.Add(new Separator()); system.Items.Add(manage); system.Items.Add(password); system.Items.Add(switchOperator);
        manage.Click += (_, _) =>
        {
            if (featureOpening) { NotificationText.Text = "正在完成新功能操作，请等待结果后管理操作员。"; return; }
            try
            {
                var auth = featureAuthentication ?? throw new InvalidOperationException("请先登录。");
                OperatorDialogs.Manage(this, auth.Operators, auth.Session);
            }
            catch (Exception ex) { NotificationText.Text = "操作员管理未打开：" + ex.Message; }
        };
        password.Click += (_, _) =>
        {
            if (featureOpening) { NotificationText.Text = "正在完成新功能操作，请等待结果后修改密码。"; return; }
            try
            {
                if (!ConfirmDiscardOpening()) return;
                var auth = featureAuthentication ?? throw new InvalidOperationException("请先登录。");
                if (OperatorDialogs.ChangePassword(this, auth.Operators, auth.Session))
                { _openingDirty = false; RequestOperatorSwitch(); }
            }
            catch (Exception ex) { NotificationText.Text = "修改密码未完成：" + ex.Message; }
        };
        switchOperator.Click += (_, _) => RequestOperatorSwitch();
    }

    private void RequestOperatorSwitch()
    {
        if (featureOpening) { NotificationText.Text = "正在完成新功能操作，请等待结果后注销或换人。"; return; }
        if (!ConfirmDiscardOpening()) return;
        _openingDirty = false;
        featureAuthentication?.Operators.Logout(featureAuthentication.Session);
        _session?.Close(); // Increment generation before any new login or restored copy can be opened.
        LoginSwitchRequested = true;
        Close();
    }
}
