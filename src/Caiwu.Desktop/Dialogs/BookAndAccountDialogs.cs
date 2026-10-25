using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using Caiwu.Contracts;

namespace Caiwu.Desktop.Dialogs;

internal static class DialogLayout
{
    public static StackPanel Form(Window window, string title, double width = 540)
    {
        window.Title = title; window.Width = width;
        window.SizeToContent = SizeToContent.Height; window.MaxHeight = 760;
        window.ResizeMode = ResizeMode.NoResize; window.WindowStartupLocation = WindowStartupLocation.CenterOwner;
        var panel = new StackPanel { Margin = new Thickness(24) };
        window.Content = panel; return panel;
    }

    public static void Field(Panel panel, string label, Control input)
    {
        panel.Children.Add(new TextBlock { Text = label, Margin = new Thickness(0, 12, 0, 5) });
        input.MinHeight = 34; panel.Children.Add(input);
    }

    public static void Buttons(Panel panel, Window window, string acceptText, Action accept)
    {
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(0, 24, 0, 0) };
        var cancel = new Button { Content = "取消", IsCancel = true, MinWidth = 86, Padding = new Thickness(14, 7, 14, 7) };
        var ok = new Button { Content = acceptText, IsDefault = true, MinWidth = 100,
            Margin = new Thickness(10, 0, 0, 0), Padding = new Thickness(14, 7, 14, 7) };
        cancel.Click += (_, _) => window.DialogResult = false;
        ok.Click += (_, _) => accept(); buttons.Children.Add(cancel); buttons.Children.Add(ok); panel.Children.Add(buttons);
    }
}

public sealed class NewBookWindow : Window
{
    private readonly TextBox _name = new() { MaxLength = 80 };
    private readonly ComboBox _template = new() { DisplayMemberPath = nameof(TemplateDefinition.DisplayName) };
    private readonly TextBox _year = new() { Text = DateTime.Now.Year.ToString() };
    private readonly ComboBox _month = new() { ItemsSource = Enumerable.Range(1, 12).ToArray(), SelectedIndex = 0 };
    private readonly TextBlock _error = new() { Foreground = System.Windows.Media.Brushes.Firebrick, TextWrapping = TextWrapping.Wrap };
    public BookInfo? Book { get; private set; }
    public TemplateDefinition? Template => _template.SelectedItem as TemplateDefinition;

    public NewBookWindow(IReadOnlyList<TemplateDefinition> templates)
    {
        var form = DialogLayout.Form(this, "新建账套");
        form.Children.Add(new TextBlock { Text = "建立独立账套", FontSize = 22, FontWeight = FontWeights.SemiBold });
        form.Children.Add(new TextBlock { Text = "本开发预览用于试用与核对，不替代生产账务验收。",
            TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 8, 0, 8) });
        _template.ItemsSource = templates; _template.SelectedIndex = 0;
        DialogLayout.Field(form, "单位 / 账套名称", _name);
        DialogLayout.Field(form, "会计制度", _template);
        DialogLayout.Field(form, "会计年度", _year);
        DialogLayout.Field(form, "启用月份", _month);
        form.Children.Add(new TextBlock { Text = "账套建立后固定制度与版本。首版仅支持单年度人民币基础账务。",
            TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 12, 0, 0) });
        form.Children.Add(_error);
        DialogLayout.Buttons(form, this, "选择保存位置…", Accept);
        Loaded += (_, _) => _name.Focus();
    }

    private void Accept()
    {
        if (string.IsNullOrWhiteSpace(_name.Text)) { _error.Text = "请填写单位或账套名称。"; return; }
        if (!int.TryParse(_year.Text, out var year) || year is < 2000 or > 2100)
        { _error.Text = "请输入2000至2100之间的会计年度。"; return; }
        if (Template is not { } template) { _error.Text = "请选择会计制度。"; return; }
        var month = (int)_month.SelectedItem;
        Book = new BookInfo(Guid.NewGuid(), _name.Text.Trim(), template.Regime, template.Version,
            year, month, month - 1, DateTimeOffset.UtcNow);
        DialogResult = true;
    }
}

public sealed class AccountWindow : Window
{
    private readonly TextBox _code = new(), _name = new(), _parent = new();
    private readonly ComboBox _direction = new() { ItemsSource = new[] { "借方", "贷方" } };
    private readonly CheckBox _active = new() { Content = "启用此科目", IsChecked = true };
    private readonly TextBlock _error = new() { Foreground = System.Windows.Media.Brushes.Firebrick };
    private readonly Account? _original;
    public Account? Result { get; private set; }

    public AccountWindow(Account? account, string? parentCode)
    {
        _original = account;
        var form = DialogLayout.Form(this, account is null ? "新增会计科目" : "修改会计科目");
        _code.Text = account?.Code ?? ""; _code.IsReadOnly = account is not null;
        _name.Text = account?.Name ?? ""; _parent.Text = account?.ParentCode ?? parentCode ?? "";
        _direction.SelectedIndex = account?.Direction == BalanceDirection.Credit ? 1 : 0;
        _active.IsChecked = account?.IsActive ?? true;
        DialogLayout.Field(form, "科目代码", _code); DialogLayout.Field(form, "科目名称", _name);
        DialogLayout.Field(form, "上级科目代码（一级科目留空）", _parent);
        DialogLayout.Field(form, "余额方向", _direction);
        _active.Margin = new Thickness(0, 16, 0, 0); form.Children.Add(_active); form.Children.Add(_error);
        DialogLayout.Buttons(form, this, "确定", () =>
        {
            if (string.IsNullOrWhiteSpace(_code.Text) || string.IsNullOrWhiteSpace(_name.Text))
            { _error.Text = "科目代码和名称不能为空。"; return; }
            Result = new Account(_code.Text.Trim(), _name.Text.Trim(), string.IsNullOrWhiteSpace(_parent.Text) ? null : _parent.Text.Trim(),
                _direction.SelectedIndex == 1 ? BalanceDirection.Credit : BalanceDirection.Debit, _active.IsChecked == true,
                _original?.OpeningDebit ?? 0m, _original?.OpeningCredit ?? 0m);
            DialogResult = true;
        });
    }
}

public sealed class AccountPickerWindow : Window
{
    private readonly IReadOnlyList<Account> _accounts;
    private readonly TextBox _search = new() { Margin = new Thickness(0, 0, 0, 12), MinHeight = 34 };
    private readonly DataGrid _grid = new() { AutoGenerateColumns = false, IsReadOnly = true,
        CanUserAddRows = false, SelectionMode = DataGridSelectionMode.Single, SelectionUnit = DataGridSelectionUnit.FullRow };
    public Account? Selected => _grid.SelectedItem as Account;

    public AccountPickerWindow(IReadOnlyList<Account> accounts)
    {
        _accounts = accounts.Where(a => a.IsActive && !accounts.Any(child => child.ParentCode == a.Code)).ToArray();
        Title = "选择会计科目 · F4"; Width = 640; Height = 520; MinWidth = 480;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        var panel = new DockPanel { Margin = new Thickness(20) };
        DockPanel.SetDock(_search, Dock.Top); panel.Children.Add(_search);
        var note = new TextBlock { Text = "输入科目代码或名称；双击或按 Enter 选择。", Margin = new Thickness(0, 0, 0, 10) };
        DockPanel.SetDock(note, Dock.Top); panel.Children.Add(note);
        _grid.Columns.Add(new DataGridTextColumn { Header = "代码", Binding = new Binding("Code"), Width = 140 });
        _grid.Columns.Add(new DataGridTextColumn { Header = "科目名称", Binding = new Binding("Name"), Width = new DataGridLength(1, DataGridLengthUnitType.Star) });
        panel.Children.Add(_grid); Content = panel;
        _search.TextChanged += (_, _) => Filter();
        _grid.MouseDoubleClick += (_, _) => Accept();
        PreviewKeyDown += (_, e) =>
        {
            if (e.Key == Key.Escape) { DialogResult = false; e.Handled = true; }
            else if (e.Key == Key.Enter) { Accept(); e.Handled = true; }
            else if (e.Key == Key.Down && _search.IsKeyboardFocusWithin) { _grid.Focus(); e.Handled = true; }
        };
        Filter(); Loaded += (_, _) => _search.Focus();
    }

    private void Filter()
    {
        var text = _search.Text.Trim();
        _grid.ItemsSource = _accounts.Where(a => a.Code.Contains(text, StringComparison.OrdinalIgnoreCase)
            || a.Name.Contains(text, StringComparison.OrdinalIgnoreCase)).ToArray();
        if (_grid.Items.Count > 0) _grid.SelectedIndex = 0;
    }
    private void Accept() { if (Selected is not null) DialogResult = true; }
}
