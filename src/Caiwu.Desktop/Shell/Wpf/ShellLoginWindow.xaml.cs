using System.Windows;
using Caiwu.Desktop.Presentation;
using Caiwu.Operators;

namespace Caiwu.Desktop.Shell.Wpf;

public partial class ShellLoginWindow : Window
{
    private readonly LocalOperatorService operators;
    private readonly Func<OperatorSession, DesktopBackend> backend;
    private readonly Func<OperatorSession, Window, string?> createBook;
    private readonly string dataRoot;
    private readonly List<ShellBookChoice> books;
    public ShellLoginResult? Result { get; private set; }

    public ShellLoginWindow(LocalOperatorService operators, IEnumerable<ShellBookChoice> books, string dataRoot,
        Func<OperatorSession, DesktopBackend> backend, Func<OperatorSession, Window, string?> createBook,
        string? selectedPath = null, DateOnly? operationDate = null)
    {
        InitializeComponent();
        this.operators = operators; this.books = books.ToList(); this.dataRoot = dataRoot;
        this.backend = backend; this.createBook = createBook;
        BookInput.ItemsSource = this.books;
        BookInput.SelectedItem = this.books.FirstOrDefault(b => string.Equals(b.Path, selectedPath, StringComparison.OrdinalIgnoreCase));
        UserInput.ItemsSource = operators.GetLoginNames();
        DateInput.Text = (operationDate ?? DateOnly.FromDateTime(DateTime.Today)).ToString("yyyy-MM-dd");
        Closed += (_, _) => PasswordInput.Clear();
    }

    private void Search_Click(object sender, RoutedEventArgs e)
    {
        var search = new BookSearchWindow(books, dataRoot) { Owner = this };
        if (search.ShowDialog() != true || search.Selected is not { } choice) return;
        SelectBook(choice);
    }
    private void SelectBook(ShellBookChoice choice)
    {
        var existing = books.FirstOrDefault(b => string.Equals(b.Path, choice.Path, StringComparison.OrdinalIgnoreCase));
        if (existing is not null) books.Remove(existing);
        books.Add(choice); BookInput.Items.Refresh(); BookInput.SelectedItem = choice;
    }
    private void Confirm_Click(object sender, RoutedEventArgs e) => Authenticate(false);
    private void New_Click(object sender, RoutedEventArgs e) => Authenticate(true);
    private void Exit_Click(object sender, RoutedEventArgs e) => DialogResult = false;

    private void Authenticate(bool create)
    {
        if (!ConfirmButton.IsEnabled) return;
        ConfirmButton.IsEnabled = NewButton.IsEnabled = false; ErrorText.Text = "";
        try
        {
            var coordinator = new ShellLoginCoordinator(operators, backend);
            var result = coordinator.Login(BookInput.SelectedItem as ShellBookChoice, UserInput.Text, PasswordInput.Password, DateInput.Text,
                create ? session =>
                {
                    var path = createBook(session, this);
                    return path is null ? null : new ShellBookChoice(path, System.IO.Path.GetFileNameWithoutExtension(path));
                } : null, SelectBook);
            if (result is null) return;
            Result = result;
            PasswordInput.Clear(); DialogResult = true;
        }
        catch (Exception ex) { ErrorText.Text = "登录未完成：" + ex.Message; }
        finally
        {
            PasswordInput.Clear();
            ConfirmButton.IsEnabled = NewButton.IsEnabled = true;
        }
    }
}
