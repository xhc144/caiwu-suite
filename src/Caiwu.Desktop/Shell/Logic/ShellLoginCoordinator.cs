using Caiwu.Desktop.Presentation;
using Caiwu.Operators;

namespace Caiwu.Desktop.Shell;

public sealed record ShellLoginResult(OperatorSession Session, ShellBookChoice Book, Guid BookId, DateOnly OperationDate);

/// <summary>Transfers a real session only after the selected book and explicit date validate.</summary>
public sealed class ShellLoginCoordinator(LocalOperatorService operators, Func<OperatorSession, DesktopBackend> backend)
{
    public ShellLoginResult? Login(ShellBookChoice? selected, string userCode, string password, string dateText,
        Func<OperatorSession, ShellBookChoice?>? createBook = null, Action<ShellBookChoice>? bookOpened = null)
    {
        var date = ShellLogin.ParseDate(dateText);
        if (createBook is null && selected is null) throw new ArgumentException("请选择套账；可按搜索查找受管账套。");
        OperatorSession? issued = operators.Login(userCode, password);
        try
        {
            var choice = createBook is null ? selected : createBook(issued);
            if (choice is null) return null;
            using var store = backend(issued).Open(choice.Path);
            store.CheckIntegrity();
            var shown = store.Read();
            var named = choice with { Name = shown.Book.Name };
            bookOpened?.Invoke(named);
            ShellLogin.ValidateDate(date, shown.Book.FiscalYear, shown.Book.StartMonth);
            operators.RequirePermission(issued, OperatorPermission.ReadLedger);
            var result = new ShellLoginResult(issued, named, shown.Book.Id, date);
            issued = null;
            return result;
        }
        finally { operators.Logout(issued); }
    }
}
