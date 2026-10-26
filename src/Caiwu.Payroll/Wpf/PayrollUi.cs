using System.Data;
using System.Globalization;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using Microsoft.Data.Sqlite;

namespace Caiwu.Payroll.Wpf;

internal static class PayrollUi
{
    public static readonly Thickness Gap = new(8);
    public static DataGrid Grid(bool readOnly = false) => new()
    {
        AutoGenerateColumns = false, CanUserAddRows = false, CanUserDeleteRows = false,
        IsReadOnly = readOnly, SelectionMode = DataGridSelectionMode.Single, MinRowHeight = 30,
        HeadersVisibility = DataGridHeadersVisibility.Column, GridLinesVisibility = DataGridGridLinesVisibility.Horizontal,
        Margin = Gap
    };
    public static DataGridTextColumn Text(string title, string property, bool readOnly = false, double width = 130)
        => new() { Header = title, IsReadOnly = readOnly, Width = width, Binding = new Binding(property)
        { UpdateSourceTrigger = UpdateSourceTrigger.PropertyChanged, ValidatesOnExceptions = true, NotifyOnValidationError = true } };
    public static DataGridCheckBoxColumn Check(string title, string property) => new()
        { Header = title, Width = 70, Binding = new Binding(property) { UpdateSourceTrigger = UpdateSourceTrigger.PropertyChanged } };
    public static Button Button(string title, Action action, string? name = null)
    {
        var button = new Button { Content = title, Margin = new(5), Padding = new(12, 7, 12, 7), MinWidth = 80 };
        if (name is not null) button.Name = name;
        button.Click += (_, _) => action();
        return button;
    }
    public static TextBlock Label(string text) => new() { Text = text, VerticalAlignment = VerticalAlignment.Center, Margin = Gap };
    public static TextBox Input(string text = "") => new() { Text = text, Margin = Gap, MinWidth = 100, Padding = new(5) };
    public static StackPanel Buttons(params Button[] buttons)
    {
        var panel = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = Gap };
        foreach (var button in buttons) panel.Children.Add(button);
        return panel;
    }
    public static void Add(Grid grid, UIElement element, int row, int column = 0, int span = 1)
    { System.Windows.Controls.Grid.SetRow(element, row); System.Windows.Controls.Grid.SetColumn(element, column);
        System.Windows.Controls.Grid.SetColumnSpan(element, span); grid.Children.Add(element); }
    public static void CommitGrid(DataGrid grid)
    {
        if (!grid.CommitEdit(DataGridEditingUnit.Cell, true) || !grid.CommitEdit(DataGridEditingUnit.Row, true) || HasError(grid))
            throw new PayrollValidationException("表格中仍有无效输入，请先修正标红的单元格。");
    }
    private static bool HasError(DependencyObject element)
    {
        if (Validation.GetHasError(element)) return true;
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(element); i++)
            if (HasError(VisualTreeHelper.GetChild(element, i))) return true;
        return false;
    }
    public static decimal? Number(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        if (decimal.TryParse(text, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint,
            CultureInfo.InvariantCulture, out var value)) return value;
        throw new PayrollValidationException("请输入不带千分位的十进制数字，小数点使用 . 。");
    }
    public static string? Attribute(Employee employee, string field) => field switch
    { "g_j1" => employee.Code, "g_j2" => employee.Name, "g_j3" => employee.DepartmentCode, _ => employee.Attributes.GetValueOrDefault(field) };
    public static void SetAttribute(Employee employee, string field, string? value)
    {
        switch (field)
        {
            case "g_j1": employee.Code = value ?? ""; break;
            case "g_j2": employee.Name = value ?? ""; break;
            case "g_j3": employee.DepartmentCode = value ?? ""; break;
            default: employee.Attributes[field] = value; break;
        }
    }
    public static DataTable Table(string name, IEnumerable<PayrollColumn> columns)
    {
        var table = new DataTable(name) { Locale = CultureInfo.InvariantCulture };
        foreach (var column in columns) table.Columns.Add(column.FieldName, typeof(string));
        return table;
    }
    public static bool Try(FrameworkElement source, Action action, Action<string>? status = null)
    {
        try { action(); return true; }
        catch (Exception error) when (error is PayrollValidationException or PayrollConflictException or SqliteException or IOException)
        {
            var text = error is SqliteException ? "工资数据保存或读取失败，请检查工作文件是否被占用。输入已保留。" : error.Message;
            status?.Invoke(text);
            var owner = Window.GetWindow(source);
            if (owner is null) MessageBox.Show(text, "工资管理", MessageBoxButton.OK, MessageBoxImage.Warning);
            else MessageBox.Show(owner, text, "工资管理", MessageBoxButton.OK, MessageBoxImage.Warning);
            return false;
        }
    }
    public static void Shortcut(UIElement element, Key key, ModifierKeys modifiers, Action action)
    {
        var command = new RoutedCommand();
        element.CommandBindings.Add(new(command, (_, e) => { action(); e.Handled = true; }));
        element.InputBindings.Add(new KeyBinding(command, key, modifiers));
    }
}

public abstract class PayrollDialog : Window
{
    protected readonly PayrollService Service;
    protected readonly DockPanel Layout = new();
    protected readonly TextBlock Status = new() { Margin = PayrollUi.Gap, TextWrapping = TextWrapping.Wrap };
    protected Func<bool>? SaveAction;
    protected bool Dirty;
    private readonly List<DataGrid> trackedGrids = [];
    protected PayrollDialog(PayrollService service, string objectName, string title, double width, double height)
    {
        Service = service; Name = objectName; Title = title; Width = width; Height = height;
        MinWidth = 420; MinHeight = 300; FontFamily = new("Microsoft YaHei UI"); FontSize = 14;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        Content = Layout; DockPanel.SetDock(Status, Dock.Bottom); Layout.Children.Add(Status);
        Closing += (_, args) => { if (!ConfirmLeave()) args.Cancel = true; };
        PayrollUi.Shortcut(this, Key.S, ModifierKeys.Control, () => SaveAction?.Invoke());
        PayrollUi.Shortcut(this, Key.F4, ModifierKeys.Control, Close);
    }
    protected bool Run(Action action) => PayrollUi.Try(this, action, text => Status.Text = text);
    protected void Track(DataGrid grid)
    { trackedGrids.Add(grid); grid.CellEditEnding += (_, _) => Dirty = true; }
    protected bool ConfirmLeave()
    {
        if (!Run(() => { foreach (var grid in trackedGrids) PayrollUi.CommitGrid(grid); })) return false;
        if (!Dirty) return true;
        var choice = MessageBox.Show(this, "有数据未存盘, 退出前是否存盘 ?", Title, MessageBoxButton.YesNoCancel, MessageBoxImage.Question);
        if (choice == MessageBoxResult.Cancel) return false;
        return choice == MessageBoxResult.No || SaveAction?.Invoke() == true;
    }
    protected bool Save(Action action)
    {
        var saved = Run(action);
        if (saved) { Dirty = false; Status.Text = "已存盘"; }
        return saved;
    }
}
