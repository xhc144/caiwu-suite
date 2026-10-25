using System.Windows;
using System.Windows.Controls;

namespace Caiwu.Operators.Wpf;

public partial class OperatorManagementWindow : Window
{
    private readonly LocalOperatorService _service;
    private readonly OperatorSession _session;
    private OperatorDirectory? _directory;
    private Guid? _editing;
    public OperatorManagementWindow(LocalOperatorService service, OperatorSession session)
    {
        InitializeComponent(); _service = service; _session = session; DialogSupport.Prepare(this);
        // Constructor checks permission too: hiding the menu is insufficient.
        _service.RequirePermission(session, OperatorPermission.ManageOperators);
        Loaded += (_, _) => Run(Refresh);
        Closed += (_, _) => ClearPasswords();
    }
    private void Refresh()
    {
        _directory = _service.GetDirectory(_session);
        OperatorGrid.ItemsSource = _directory.Operators; NewEditor();
    }
    private void NewEditor()
    {
        _editing = null; OperatorGrid.SelectedItem = null; EditorTitle.Text = "新增操作员";
        LoginInput.IsReadOnly = false; LoginInput.Text = ""; DisplayInput.Text = ""; EnabledInput.IsChecked = true;
        EnabledInput.IsEnabled = false; SetRoles(OperatorRoles.Reader); ActorText.Text = ""; ResetButton.IsEnabled = false; ClearPasswords();
    }
    private void Selection_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (OperatorGrid.SelectedItem is not OperatorIdentity op) return;
        _editing = op.Id; EditorTitle.Text = "编辑操作员"; LoginInput.IsReadOnly = true;
        LoginInput.Text = op.LoginName; DisplayInput.Text = op.DisplayName; EnabledInput.IsChecked = op.IsEnabled;
        EnabledInput.IsEnabled = true; SetRoles(op.Roles); ActorText.Text = "账务身份：" + op.ActorKey;
        ResetButton.IsEnabled = true; ClearPasswords(); ErrorText.Text = "";
    }
    private void Save_Click(object sender, RoutedEventArgs e) => Run(() =>
    {
        if (_directory is null) throw new OperatorValidationException("请先刷新操作员资料。");
        if (_editing is { } id)
        {
            if (PasswordInput.Password.Length != 0 || ConfirmInput.Password.Length != 0)
                throw new OperatorValidationException("保存资料不更改密码；请使用“重设所选密码”，或先清空密码输入。");
            _service.UpdateOperator(_session, _directory.Revision, id, DisplayInput.Text, GetRoles(), EnabledInput.IsChecked == true);
        }
        else
        {
            ValidateConfirmation();
            _service.AddOperator(_session, _directory.Revision, LoginInput.Text, DisplayInput.Text, PasswordInput.Password, GetRoles());
        }
        ClearPasswords(); AfterMutation("资料已保存。");
    });
    private void Reset_Click(object sender, RoutedEventArgs e) => Run(() =>
    {
        if (_editing is not { } id || _directory is null) throw new OperatorValidationException("请选择操作员。");
        ValidateConfirmation();
        _service.ResetPassword(_session, _directory.Revision, id, PasswordInput.Password);
        ClearPasswords(); AfterMutation("密码已重设；该操作员需要重新登录。");
    });
    private void AfterMutation(string message)
    {
        try { Refresh(); ErrorText.Text = message; }
        catch (OperatorAuthorizationException)
        {
            SaveButton.IsEnabled = ResetButton.IsEnabled = false;
            ErrorText.Text = message + " 当前管理员资料已变化，请关闭窗口并重新登录。";
        }
    }
    private void Refresh_Click(object sender, RoutedEventArgs e) => Run(Refresh);
    private void New_Click(object sender, RoutedEventArgs e) { ErrorText.Text = ""; NewEditor(); }
    private void ClearPasswords() { PasswordInput.Clear(); ConfirmInput.Clear(); }
    private void ValidateConfirmation()
    { if (PasswordInput.Password != ConfirmInput.Password) throw new OperatorValidationException("两次输入的密码不一致。"); }
    private void Run(Action action)
    {
        ErrorText.Text = "";
        try { action(); }
        catch (Exception ex) { DialogSupport.Error(ErrorText, ex); }
    }
    private OperatorRoles GetRoles()
    {
        var roles = OperatorRoles.None;
        foreach (var (box, role) in RoleBoxes()) if (box.IsChecked == true) roles |= role;
        return roles;
    }
    private void SetRoles(OperatorRoles roles)
    { foreach (var (box, role) in RoleBoxes()) box.IsChecked = roles.HasFlag(role); }
    private (CheckBox, OperatorRoles)[] RoleBoxes() =>
    [ (AdministratorRole, OperatorRoles.Administrator), (AccountantRole, OperatorRoles.Accountant),
      (PreparerRole, OperatorRoles.Preparer), (ReviewerRole, OperatorRoles.Reviewer),
      (PosterRole, OperatorRoles.Poster), (PeriodCloserRole, OperatorRoles.PeriodCloser), (ReaderRole, OperatorRoles.Reader) ];
}
