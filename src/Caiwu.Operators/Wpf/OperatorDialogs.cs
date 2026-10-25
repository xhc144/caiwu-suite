using System.Windows;

namespace Caiwu.Operators.Wpf;

public static class OperatorDialogs
{
    /// <summary>Cancellation returns null. First-use creation never creates a session by itself.</summary>
    public static OperatorSession? Login(Window? owner, LocalOperatorService service)
    {
        if (service.IsFirstUse)
        {
            var setup = new FirstUseWindow(service); if (owner is not null) setup.Owner = owner;
            if (setup.ShowDialog() != true) return null;
        }
        var login = new LoginWindow(service); if (owner is not null) login.Owner = owner;
        return login.ShowDialog() == true ? login.Session : null;
    }
    public static void Manage(Window owner, LocalOperatorService service, OperatorSession session)
        => new OperatorManagementWindow(service, session) { Owner = owner }.ShowDialog();
    public static bool ChangePassword(Window owner, LocalOperatorService service, OperatorSession session)
        => new ChangePasswordWindow(service, session) { Owner = owner }.ShowDialog() == true;
}
