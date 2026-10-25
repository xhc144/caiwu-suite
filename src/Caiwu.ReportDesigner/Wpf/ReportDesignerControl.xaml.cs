using System.IO;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;

namespace Caiwu.ReportDesigner.Wpf;

public enum TemplatePathPurpose { Load, SaveNew }
public sealed record ReportDesignerHost(
    Func<ReportInputSnapshot, bool> IsCurrent,
    Func<TemplatePathPurpose, string?> ChooseTemplatePath,
    Func<bool, string?> ChooseExportPath);

public partial class ReportDesignerControl : UserControl
{
    private readonly ReportInputSnapshot input;
    private readonly ReportDesignerHost host;
    private ReportTemplate template;
    private string? loadedPath, loadedHash;
    private bool populating;
    public ObservableCollection<ColumnEdit> Columns { get; } = [];
    public ReportPreview? CurrentPreview { get; private set; }
    public ReportDesignerControl(ReportInputSnapshot input, ReportDesignerHost host, ReportTemplate? initialTemplate = null)
    {
        this.input = input ?? throw new ArgumentNullException(nameof(input)); this.host = host ?? throw new ArgumentNullException(nameof(host));
        template = initialTemplate ?? input.CreateTemplate();
        InitializeComponent(); OrientationEditor.ItemsSource = new[] {
            new KeyValuePair<PageOrientation, string>(PageOrientation.Landscape, "横向"),
            new KeyValuePair<PageOrientation, string>(PageOrientation.Portrait, "纵向")
        };
        CommandManager.AddPreviewExecutedHandler(this, (_, e) => {
            if (e.Command == ApplicationCommands.Print) { e.Handled = true; Print_Click(this, new RoutedEventArgs()); }
        });
        GroupEditor.ItemsSource = new[] { new SourceField("", "不分组", false) }.Concat(input.Fields.Where(f => !f.Numeric)).ToArray();
        FieldPicker.ItemsSource = input.Fields; FieldPicker.SelectedIndex = 0; ColumnEditor.ItemsSource = Columns;
        Populate(template); TryAction(() => RefreshPreview());
    }
    private void Current() { if (!host.IsCurrent(input)) throw new InvalidOperationException("来源账套/会话/期间快照已失效，请关闭设计器，从宿主当前账表重新打开。"); }
    private void Populate(ReportTemplate value)
    {
        populating = true;
        try {
            template = value; TitleEditor.Text = value.Title; HeaderEditor.Text = value.Header;
            OrientationEditor.SelectedValue = value.Orientation; PageRowsEditor.Text = value.RowsPerPage.ToString(CultureInfo.InvariantCulture);
            GroupEditor.SelectedValue = value.SubtotalBy ?? ""; Columns.Clear();
            foreach (var c in value.Columns) { var edit = new ColumnEdit(c); edit.PropertyChanged += (_, _) => Invalidate(); Columns.Add(edit); }
        } finally { populating = false; }
        Invalidate();
    }
    private ReportTemplate ReadTemplate()
    {
        ColumnEditor.CommitEdit(DataGridEditingUnit.Cell, true); ColumnEditor.CommitEdit(DataGridEditingUnit.Row, true);
        if (!int.TryParse(PageRowsEditor.Text, NumberStyles.None, CultureInfo.InvariantCulture, out var rows)) throw new ArgumentException("每页行数须为1–50整数。");
        return template with { Title = TitleEditor.Text, Header = HeaderEditor.Text,
            Orientation = OrientationEditor.SelectedValue is PageOrientation direction ? direction : throw new ArgumentException("请选择页面方向。"),
            RowsPerPage = rows, SubtotalBy = GroupEditor.SelectedValue is string key && key.Length > 0 ? key : null,
            Columns = Columns.Select(c => c.Read()).ToArray() };
    }
    public ReportPreview RefreshPreview()
    {
        Current(); Invalidate(); var value = ReadTemplate();
        if (!int.TryParse(LimitEditor.Text, NumberStyles.None, CultureInfo.InvariantCulture, out var limit)) throw new ArgumentException("预览行上限须为1–10000整数。");
        var preview = ReportDesignerEngine.Preview(input, value, limit); Current(); template = value; CurrentPreview = preview;
        PreviewGrid.Columns.Clear();
        PreviewGrid.Columns.Add(new DataGridTextColumn { Header = "行/汇总", Binding = new Binding(nameof(PreviewRow.Label)), Width = 170 });
        for (var i = 0; i < preview.Columns.Count; i++) {
            var style = new Style(typeof(TextBlock)); style.Setters.Add(new Setter(TextBlock.TextWrappingProperty, TextWrapping.Wrap));
            if (preview.Rows.Any(r => r.Cells[i].Number.HasValue)) style.Setters.Add(new Setter(TextBlock.TextAlignmentProperty, TextAlignment.Right));
            PreviewGrid.Columns.Add(new DataGridTextColumn { Header = preview.Columns[i].Title, Binding = new Binding($"Cells[{i}].Text"), Width = (double)preview.Columns[i].Width, ElementStyle = style });
        }
        PreviewGrid.ItemsSource = preview.Rows;
        var layout = ReportDesignerExport.Layout(preview);
        AuditText.Text = string.Join("\n", preview.AuditLines()) + $"\n纸宽适配比例={layout.Scale:0.###}；逻辑页={layout.LogicalPages}；长文本可能增加物理页。";
        StatusText.Text = preview.IsLimited ? "预览已截断；导出与打印已禁用。" : "预览已更新；可保存模板和导出当前快照。";
        HtmlButton.IsEnabled = CsvButton.IsEnabled = PrintButton.IsEnabled = !preview.IsLimited;
        if (!preview.IsLimited) {
            var landscape = preview.Template.Orientation == PageOrientation.Landscape;
            PagePreview.Document = ReportDesignerPrinter.CreateDocument(preview, landscape ? 1122 : 794, landscape ? 794 : 1122);
        }
        return preview;
    }
    private void Invalidate()
    {
        if (populating || StatusText is null) return;
        CurrentPreview = null; PreviewGrid.ItemsSource = null; PreviewGrid.Columns.Clear();
        PagePreview.Document = null;
        HtmlButton.IsEnabled = CsvButton.IsEnabled = PrintButton.IsEnabled = false;
        StatusText.Text = "模板已修改；请重新预览。旧结果已清除。";
        AuditText.Text = $"固定输入 BookId={input.Metadata.Book.Id:D}，期间={input.Metadata.From:yyyy-MM-dd}–{input.Metadata.To:yyyy-MM-dd}，revision={input.SourceRevision}；" + string.Join("；", input.Limitations);
    }
    private void TryAction(Action action)
    {
        try { action(); }
        catch (Exception ex) when (ex is DesignValidationException or IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException or OverflowException or System.Printing.PrintSystemException) {
            Invalidate(); StatusText.Text = ex.Message;
        }
    }
    private void Edited(object sender, TextChangedEventArgs e) => Invalidate();
    private void SelectionEdited(object sender, SelectionChangedEventArgs e) => Invalidate();
    private void ColumnCellEditEnding(object? sender, DataGridCellEditEndingEventArgs e) => Invalidate();
    private void Preview_Click(object sender, RoutedEventArgs e) => TryAction(() => RefreshPreview());
    private void Load_Click(object sender, RoutedEventArgs e) => TryAction(() => {
        Current(); var path = host.ChooseTemplatePath(TemplatePathPurpose.Load); if (path is null) return;
        Current();
        var loaded = TemplateStore.Load(path); _ = ReportDesignerEngine.Preview(input, loaded.Template);
        Current();
        Populate(loaded.Template); loadedPath = path; loadedHash = loaded.Sha256; RefreshPreview();
        StatusText.Text = "模板已读回并校验当前来源。";
    });
    private void Save_Click(object sender, RoutedEventArgs e) => TryAction(() => {
        Current(); var value = ReadTemplate(); var path = loadedPath ?? host.ChooseTemplatePath(TemplatePathPurpose.SaveNew); if (path is null) return;
        Current();
        if (loadedHash is not null) value = value with { Version = checked(template.Version + 1) };
        _ = ReportDesignerEngine.Preview(input, value); // Revalidate formulas and fields before persistence.
        Current();
        var saved = TemplateStore.Save(path, value, loadedHash); loadedPath = path; loadedHash = saved.Sha256;
        Populate(saved.Template); RefreshPreview(); StatusText.Text = $"模板已原子保存，版本{saved.Template.Version}。";
    });
    private ReportPreview ExportPreview() { Current(); var p = CurrentPreview ?? throw new InvalidOperationException("先重新预览。"); ReportDesignerExport.EnsureExportable(p); return p; }
    private void Export(bool html) => TryAction(() => { var p = ExportPreview(); var path = host.ChooseExportPath(html); if (path is null) return; Current(); ReportDesignerExport.ExportNewFile(p, path, html); StatusText.Text = "导出成功（未覆盖已有文件）。"; });
    private void Html_Click(object sender, RoutedEventArgs e) => Export(true);
    private void Csv_Click(object sender, RoutedEventArgs e) => Export(false);
    private void Print_Click(object sender, RoutedEventArgs e) => TryAction(() => { var submitted = ReportDesignerPrinter.Print(ExportPreview(), () => host.IsCurrent(input)); StatusText.Text = submitted ? "打印作业已提交；实际纸张/PDF结果仍须Windows验收。" : "打印已取消。"; });
    private void Add(TemplateColumn column) {
        if (Columns.Count >= 24) { StatusText.Text = "最多24列。"; return; }
        var edit = new ColumnEdit(column); edit.PropertyChanged += (_, _) => Invalidate(); Columns.Add(edit); ColumnEditor.SelectedItem = edit; Invalidate();
    }
    private void AddField_Click(object sender, RoutedEventArgs e) { if (FieldPicker.SelectedItem is SourceField field) Add(new(NewKey("col"), field.Title, "[" + field.Key + "]")); }
    private string NewKey(string prefix) { var i = 1; while (Columns.Any(c => c.Key == prefix + i)) i++; return prefix + i; }
    private void AddFormula_Click(object sender, RoutedEventArgs e) => Add(new(NewKey("calc"), "计算列", "0"));
    private void Remove_Click(object sender, RoutedEventArgs e) { if (ColumnEditor.SelectedItem is ColumnEdit c) { Columns.Remove(c); Invalidate(); } }
    private void Move(int delta) { if (ColumnEditor.SelectedItem is ColumnEdit c) { var i = Columns.IndexOf(c); var next = i + delta; if (next >= 0 && next < Columns.Count) { Columns.Move(i, next); Invalidate(); } } }
    private void Up_Click(object sender, RoutedEventArgs e) => Move(-1);
    private void Down_Click(object sender, RoutedEventArgs e) => Move(1);
}
public sealed class ColumnEdit : INotifyPropertyChanged
{
    private string key, title, expression, width;
    private NumberFormat format; private bool visible, total;
    public ColumnEdit(TemplateColumn c) { key = c.Key; title = c.Title; expression = c.Expression; width = c.Width.ToString(CultureInfo.InvariantCulture); format = c.Format; visible = c.Visible; total = c.Total; }
    public string Key { get => key; set => Set(ref key, value); }
    public string Title { get => title; set => Set(ref title, value); }
    public string Expression { get => expression; set => Set(ref expression, value); }
    public string Width { get => width; set => Set(ref width, value); }
    public NumberFormat Format { get => format; set => Set(ref format, value); }
    public bool Visible { get => visible; set => Set(ref visible, value); }
    public bool Total { get => total; set => Set(ref total, value); }
    public IEnumerable<NumberFormat> Formats => Enum.GetValues<NumberFormat>();
    public TemplateColumn Read() => new(key, title, expression,
        decimal.TryParse(width, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var n) ? n : throw new ArgumentException($"列{key}宽度须为48–1000数值。"), format, visible, total);
    public event PropertyChangedEventHandler? PropertyChanged;
    private void Set<T>(ref T field, T value, [CallerMemberName] string? property = null) { if (EqualityComparer<T>.Default.Equals(field, value)) return; field = value; PropertyChanged?.Invoke(this, new(property)); }
}
