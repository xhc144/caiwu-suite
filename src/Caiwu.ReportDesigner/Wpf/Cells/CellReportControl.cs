using System.Data;
using System.IO;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using Caiwu.ReportDesigner.Cells;
using Microsoft.Win32;

namespace Caiwu.ReportDesigner.Wpf.Cells;

/// <summary>Module-owned w_bb_def slice. Host must supply stable, complete data and managed storage; does not open a real book.</summary>
public sealed class CellReportControl : UserControl
{
    private readonly IReportDataSource source;
    private readonly Func<ReportQueryContext> context;
    private readonly string directory;
    private readonly CellReportEngine engine;
    private readonly DataGrid grid = new() { AutoGenerateColumns = false, CanUserAddRows = false, CanUserDeleteRows = false,
        SelectionUnit = DataGridSelectionUnit.Cell, SelectionMode = DataGridSelectionMode.Single,
        EnableRowVirtualization = true, EnableColumnVirtualization = true, HeadersVisibility = DataGridHeadersVisibility.All };
    private readonly TextBlock status = new() { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(8) };
    private readonly ComboBox selector = new();
    private readonly TextBlock state = new() { Text = "提示：当前报表处于【设置】状态，可以对报表进行编辑", VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap };
    private CellReport report;
    private CellReportResult? result;
    private CellReportFile? loaded;
    private string? path;
    private bool display, formulas, dirty, selecting;
    private Dictionary<string, CellDefinition> definitions = new(StringComparer.Ordinal);
    private sealed record ReportChoice(string? Path, string Title) { public override string ToString() => Title; }
    public CellReport CurrentReport => report;
    public bool HasUnsavedChanges => dirty;
    public CellReportResult? CurrentResult => result;
    public CellReportControl(IReportDataSource source, Func<ReportQueryContext> context, string managedDirectory, CellReport initial, ReportFunctionCatalog? functions = null)
    {
        this.source = source; this.context = context;
        if (!Path.IsPathFullyQualified(managedDirectory) || !Directory.Exists(managedDirectory)) throw new ArgumentException("需要已存在的受管报表目录。");
        directory = Path.GetFullPath(managedDirectory); report = CellReportRules.Freeze(initial); engine = new(functions);
        var root = new DockPanel(); Content = root;
        var menu = new Menu(); DockPanel.SetDock(menu, Dock.Top); root.Children.Add(menu);
        var file = Top(menu, "文件(_F)");
        Item(file, "打开", Open, "Ctrl+O"); Item(file, "存盘", Save, "Ctrl+S"); Item(file, "另存为...", SaveAs);
        Item(file, "报表生成", Generate); Item(file, "现场取数", FetchCurrentCell);
        Item(file, "导出 HTML...", () => Export(true)); Item(file, "导出 CSV...", () => Export(false));
        var view = Top(menu, "显示(_S)");
        Item(view, "网格显示/取消", () => grid.GridLinesVisibility = grid.GridLinesVisibility == DataGridGridLinesVisibility.All ? DataGridGridLinesVisibility.None : DataGridGridLinesVisibility.All);
        Item(view, "定义/显示", () => { if (!display) GenerateCore(); display = !display; Rebuild(); });
        Item(view, "公式显示/取消", () => { formulas = !formulas; Rebuild(); });
        var format = Top(menu, "格式(_S)"); Item(format, "行高...", () => Dimension(true)); Item(format, "列宽...", () => Dimension(false)); Item(format, "排列格式...", Alignment); Item(format, "数字格式...", NumberFormat);
        var bar = new ToolBar(); DockPanel.SetDock(bar, Dock.Top); root.Children.Add(bar);
        foreach (var entry in new (string, Action)[] { ("打开", Open), ("存盘", Save), ("另存", SaveAs), ("生成", Generate), ("取数", FetchCurrentCell) })
        { var button = new Button { Content = entry.Item1, Margin = new Thickness(3) }; button.Click += (_, _) => Guard(entry.Item2); bar.Items.Add(button); }
        // Existing evidence: selector label left, dropdown next, state text right; grid below. ole_1.x is absent, so no absolute x is asserted.
        var heading = new Grid { Margin = new Thickness(0, 8, 0, 8) };
        foreach (var width in new[] { 101, 402, 27, 1733, 132, 1842, 444 }) heading.ColumnDefinitions.Add(new() { Width = new GridLength(width, GridUnitType.Star) });
        var label = new TextBlock { Text = "报表选择：", VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(label, 1); heading.Children.Add(label); Grid.SetColumn(selector, 3); heading.Children.Add(selector); Grid.SetColumn(state, 5); heading.Children.Add(state);
        DockPanel.SetDock(heading, Dock.Top); root.Children.Add(heading);
        DockPanel.SetDock(status, Dock.Bottom); root.Children.Add(status); root.Children.Add(grid);
        grid.LoadingRow += (_, e) => { e.Row.Header = (e.Row.GetIndex() + 1).ToString(CultureInfo.InvariantCulture); e.Row.Height = (double)(report.Rows.FirstOrDefault(r => r.Index == e.Row.GetIndex() + 1)?.HeightInches ?? report.DefaultRowHeightInches) * 96; };
        InputBindings.Add(new KeyBinding(new ActionCommand(() => Guard(Save)), Key.S, ModifierKeys.Control));
        InputBindings.Add(new KeyBinding(new ActionCommand(() => Guard(Open)), Key.O, ModifierKeys.Control));
        selector.SelectionChanged += (_, _) => {
            if (selecting || selector.SelectedItem is not ReportChoice choice || choice.Path is null || choice.Path == path) return;
            Guard(() => { if (DiscardOrSave()) OpenFrom(choice.Path); else RefreshSelector(); });
        };
        Rebuild();
    }
    private void RefreshSelector()
    {
        selecting = true;
        try {
            var choices = Directory.EnumerateFiles(directory, "*.cells.json", SearchOption.TopDirectoryOnly).Take(1000).Order(StringComparer.Ordinal).Select(p => new ReportChoice(p, Path.GetFileName(p))).ToList();
            if (path is null || choices.All(c => c.Path != path)) choices.Insert(0, new(path, report.Title));
            selector.ItemsSource = choices; selector.SelectedItem = choices.First(c => c.Path == path);
        } finally { selecting = false; }
    }
    private static MenuItem Top(Menu menu, string title) { var item = new MenuItem { Header = title }; menu.Items.Add(item); return item; }
    private void Item(MenuItem parent, string title, Action action, string shortcut = "") { var item = new MenuItem { Header = title, InputGestureText = shortcut }; item.Click += (_, _) => Guard(action); parent.Items.Add(item); }
    private void Guard(Action action) { try { action(); } catch (Exception ex) when (ex is CellReportException or ReportDataException or IOException or ArgumentException or ArithmeticException or UnauthorizedAccessException) { status.Text = ex.Message; } }
    private void CommitEdit() { grid.CommitEdit(DataGridEditingUnit.Cell, true); grid.CommitEdit(DataGridEditingUnit.Row, true); }
    private CellAddress Selected() => new(Math.Max(1, grid.Items.IndexOf(grid.CurrentItem) + 1), Math.Max(1, grid.CurrentColumn?.DisplayIndex + 1 ?? 1));
    public void SetCell(string address, string content, CellFormat? format = null)
    {
        var normalized = CellAddress.Parse(address).ToString(); var previous = report.Cells.FirstOrDefault(c => c.Address == normalized);
        report = CellReportRules.Freeze(report with { Cells = report.Cells.Where(c => c.Address != normalized).Append(new(normalized, content, format ?? previous?.Format)).ToArray() });
        dirty = true; result = null; display = false;
    }
    private void Rebuild()
    {
        var selected = Selected();
        grid.Columns.Clear(); grid.IsReadOnly = display; RefreshSelector();
        state.Text = display ? "当前报表处于【显示】状态" : "提示：当前报表处于【设置】状态，可以对报表进行编辑";
        var table = new DataTable(); definitions = report.Cells.ToDictionary(c => c.Address, StringComparer.Ordinal);
        for (var col = 1; col <= report.ColumnCount; col++)
        {
            var name = new CellAddress(1, col).ToString()[..^1]; table.Columns.Add(name, typeof(string));
            var style = new Style(typeof(TextBlock));
            foreach (var target in new[] { TextBlock.TextAlignmentProperty, FrameworkElement.VerticalAlignmentProperty, TextBlock.TextWrappingProperty })
                style.Setters.Add(new Setter(target, new Binding(".") { Converter = new CellPresentation(this, col, target) }));
            var width = report.Columns.FirstOrDefault(c => c.Index == col)?.WidthCharacters ?? report.DefaultColumnWidthCharacters;
            var glyph = new FormattedText("0", CultureInfo.InvariantCulture, FlowDirection.LeftToRight, new Typeface(grid.FontFamily, grid.FontStyle, grid.FontWeight, grid.FontStretch), grid.FontSize, Brushes.Black, VisualTreeHelper.GetDpi(this).PixelsPerDip).WidthIncludingTrailingWhitespace;
            grid.Columns.Add(new DataGridTextColumn { Header = name, Binding = new Binding("[" + name + "]") { Mode = BindingMode.TwoWay, UpdateSourceTrigger = UpdateSourceTrigger.LostFocus }, Width = Math.Max(12, glyph * (double)width + 12), ElementStyle = style });
        }
        for (var row = 1; row <= report.RowCount; row++)
        {
            var values = new object[report.ColumnCount];
            for (var col = 1; col <= report.ColumnCount; col++)
            {
                var key = new CellAddress(row, col).ToString();
                values[col - 1] = display && !formulas && result is not null ? result.Cells.GetValueOrDefault(key)?.Text ?? "" : definitions.GetValueOrDefault(key)?.Content ?? "";
            }
            table.Rows.Add(values);
        }
        table.ColumnChanged += (_, e) => { if (display || e.Column is null) return; var address = new CellAddress(table.Rows.IndexOf(e.Row) + 1, e.Column.Ordinal + 1); SetCell(address.ToString(), e.ProposedValue?.ToString() ?? ""); };
        grid.ItemsSource = table.DefaultView;
        grid.CurrentCell = new DataGridCellInfo(grid.Items[Math.Min(selected.Row, report.RowCount) - 1], grid.Columns[Math.Min(selected.Column, report.ColumnCount) - 1]);
    }
    private void GenerateCore() { CommitEdit(); result = engine.Generate(report, context(), source); status.Text = CellReportExport.Audit(result); }
    public void Generate() { GenerateCore(); display = true; Rebuild(); }
    private void FetchCurrentCell()
    {
        CommitEdit(); var address = Selected();
        var selected = report.Cells.FirstOrDefault(c => c.Address == address.ToString());
        if (selected is null) throw new ArgumentException("请选择有公式或内容的单元格。");
        GenerateCore(); status.Text = $"{address} = {result!.Cells[address.ToString()].Text}\n" + CellReportExport.Audit(result);
    }
    private void Dimension(bool row)
    {
        CommitEdit(); var address = Selected(); var index = row ? address.Row : address.Column;
        var value = row ? report.Rows.FirstOrDefault(r => r.Index == index)?.HeightInches : report.Columns.FirstOrDefault(c => c.Index == index)?.WidthCharacters;
        var defaultValue = row ? report.DefaultRowHeightInches : report.DefaultColumnWidthCharacters;
        var answer = CellFormatDialogs.Dimension(row, value ?? defaultValue, defaultValue, value is null, Window.GetWindow(this));
        if (answer is null) return;
        report = row ? report with { DefaultRowHeightInches = answer.Value.Default, Rows = report.Rows.Where(r => r.Index != index).Concat(answer.Value.UseDefault ? [] : new[] { new ReportRow(index, answer.Value.Value) }).ToArray() }
            : report with { DefaultColumnWidthCharacters = answer.Value.Default, Columns = report.Columns.Where(c => c.Index != index).Concat(answer.Value.UseDefault ? [] : new[] { new ReportColumn(index, answer.Value.Value) }).ToArray() };
        report = CellReportRules.Freeze(report); dirty = true; result = null; display = false; Rebuild();
    }
    private void Alignment()
    {
        CommitEdit(); var address = Selected().ToString(); var cell = report.Cells.FirstOrDefault(c => c.Address == address);
        var answer = CellFormatDialogs.Alignment(cell?.Format ?? new(), Window.GetWindow(this));
        if (answer is not null) { SetCell(address, cell?.Content ?? "", answer); Rebuild(); }
    }
    private void NumberFormat()
    {
        CommitEdit(); var address = Selected().ToString(); var cell = report.Cells.FirstOrDefault(c => c.Address == address);
        var answer = CellFormatDialogs.Number(cell?.Format ?? new(), Window.GetWindow(this));
        if (answer is not null) { SetCell(address, cell?.Content ?? "", answer); Rebuild(); }
    }
    private bool DiscardOrSave()
    {
        CommitEdit(); if (!dirty) return true;
        var answer = MessageBox.Show(Window.GetWindow(this), "是否保存所作的修改？", "报表定义", MessageBoxButton.YesNoCancel);
        if (answer == MessageBoxResult.Cancel) return false;
        if (answer == MessageBoxResult.No) return true;
        Save(); return !dirty;
    }
    public bool CanClose() => DiscardOrSave();
    private void Open()
    {
        if (!DiscardOrSave()) return;
        var dialog = new OpenFileDialog { InitialDirectory = directory, Filter = "单元格报表 (*.json)|*.json" };
        if (dialog.ShowDialog(Window.GetWindow(this)) == true) OpenFrom(dialog.FileName);
    }
    public void OpenFrom(string target)
    {
        var file = CellReportStore.Load(Managed(target)); report = file.Report; loaded = file; path = target;
        result = null; dirty = false; display = false; Rebuild(); status.Text = "已打开：" + report.Title;
    }
    private void Save() { CommitEdit(); if (path is null || loaded is null) { SaveAs(); return; } SaveTo(path); }
    private void SaveAs()
    {
        var dialog = new SaveFileDialog { InitialDirectory = directory, Filter = "单元格报表 (*.json)|*.json", FileName = "report.cells.json", OverwritePrompt = false };
        if (dialog.ShowDialog(Window.GetWindow(this)) == true) SaveTo(dialog.FileName);
    }
    public void SaveTo(string target)
    {
        CommitEdit(); target = Managed(target); var update = loaded is not null && path is not null && string.Equals(Path.GetFullPath(path), target, StringComparison.OrdinalIgnoreCase);
        var candidate = report with { Id = update ? report.Id : Guid.NewGuid(), Version = update ? checked(loaded!.Report.Version + 1) : 1 };
        var file = CellReportStore.Save(target, candidate, update ? loaded!.Sha256 : null);
        var reopened = CellReportStore.Load(target); if (reopened.Sha256 != file.Sha256) throw new IOException("存盘后读回不一致，请保留编辑内容。");
        report = reopened.Report; loaded = reopened; path = target; dirty = false; result = null; display = false; Rebuild(); status.Text = "已存盘并读回：" + target;
    }
    private void Export(bool html)
    {
        GenerateCore(); var dialog = new SaveFileDialog { InitialDirectory = directory, Filter = html ? "HTML (*.html)|*.html" : "CSV (*.csv)|*.csv", FileName = html ? "report.html" : "report.csv", OverwritePrompt = false };
        if (dialog.ShowDialog(Window.GetWindow(this)) != true) return;
        var target = Managed(dialog.FileName); if (html) CellReportExport.WriteHtml(target, result!); else CellReportExport.WriteCsv(target, result!);
        status.Text = "已导出：" + target;
    }
    private string Managed(string target)
    {
        var full = Path.GetFullPath(target); var relative = Path.GetRelativePath(directory, full);
        if (relative.StartsWith("..", StringComparison.Ordinal) || Path.IsPathRooted(relative) || relative.Contains(Path.DirectorySeparatorChar) || relative.Contains(Path.AltDirectorySeparatorChar))
            throw new ArgumentException("请选择受管报表目录中的文件。");
        return full;
    }
    private sealed class ActionCommand(Action action) : ICommand
    { public bool CanExecute(object? parameter) => true; public void Execute(object? parameter) => action(); public event EventHandler? CanExecuteChanged { add { } remove { } } }
    private sealed class CellPresentation(CellReportControl owner, int column, DependencyProperty property) : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            var row = value is DataRowView view ? view.Row.Table.Rows.IndexOf(view.Row) + 1 : 1; var address = new CellAddress(row, column).ToString();
            var format = owner.definitions.GetValueOrDefault(address)?.Format ?? new();
            if (property == TextBlock.TextWrappingProperty) return format.Wrap ? TextWrapping.Wrap : TextWrapping.NoWrap;
            if (property == FrameworkElement.VerticalAlignmentProperty) return format.Vertical switch { CellVerticalAlignment.Top => VerticalAlignment.Top, CellVerticalAlignment.Bottom => VerticalAlignment.Bottom, _ => VerticalAlignment.Center };
            return format.Horizontal switch { CellHorizontalAlignment.Center => TextAlignment.Center, CellHorizontalAlignment.Right => TextAlignment.Right, CellHorizontalAlignment.Left => TextAlignment.Left, _ => owner.result?.Cells.GetValueOrDefault(address)?.Number is not null ? TextAlignment.Right : TextAlignment.Left };
        }
        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) => throw new NotSupportedException();
    }
}
