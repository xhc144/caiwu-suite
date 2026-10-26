using System.Data;
using System.Globalization;
using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Microsoft.Win32;

namespace Caiwu.Payroll.Wpf;

/// <summary>A sheet view for the original MDI host, not a new independent main window.</summary>
public abstract class PayrollSheet : UserControl
{
    protected readonly PayrollService Service;
    protected readonly DockPanel Layout = new();
    protected readonly DataGrid Grid = PayrollUi.Grid();
    protected readonly TextBlock Status = new() { Margin = PayrollUi.Gap, TextWrapping = TextWrapping.Wrap };
    private readonly Action closeSheet;
    protected bool Dirty;
    protected PayrollSheet(PayrollService service, string objectName, Action closeSheet)
    {
        Service = service; this.closeSheet = closeSheet; Name = objectName; Content = Layout;
        FontFamily = new("Microsoft YaHei UI"); FontSize = 14; MinWidth = 650; MinHeight = 380;
        DockPanel.SetDock(Status, Dock.Bottom); Layout.Children.Add(Status);
        Grid.CellEditEnding += (_, _) => Dirty = true;
        PayrollUi.Shortcut(this, Key.S, ModifierKeys.Control, () => Save());
        PayrollUi.Shortcut(this, Key.F4, ModifierKeys.Control, CloseSheet);
    }
    public abstract bool Save();
    public bool CanClose()
    {
        if (!Run(() => PayrollUi.CommitGrid(Grid))) return false;
        if (!Dirty) return true;
        var owner = Window.GetWindow(this);
        var choice = owner is null ? MessageBox.Show("有数据未存盘, 退出前是否存盘 ?", "工资管理", MessageBoxButton.YesNoCancel)
            : MessageBox.Show(owner, "有数据未存盘, 退出前是否存盘 ?", "工资管理", MessageBoxButton.YesNoCancel);
        if (choice == MessageBoxResult.Cancel) return false;
        return choice == MessageBoxResult.No || Save();
    }
    protected bool Run(Action action) => PayrollUi.Try(this, action, text => Status.Text = text);
    protected void CloseSheet() { if (CanClose()) closeSheet(); }
    protected void Show(Window dialog) { dialog.Owner = Window.GetWindow(this); dialog.ShowDialog(); }
    protected void OperationMenu(params (string Title, Action Action, string? Key)[] actions)
    {
        var menu = new Menu(); var operation = new MenuItem { Header = "O.操作" }; menu.Items.Add(operation);
        foreach (var (title, action, key) in actions)
        {
            var item = new MenuItem { Header = title, InputGestureText = key ?? "" };
            item.Click += (_, _) => action(); operation.Items.Add(item);
        }
        // Only menu order is statically known. Do not fabricate original toolbar coordinates.
        DockPanel.SetDock(menu, Dock.Top); Layout.Children.Add(menu);
    }
}

public sealed class PersonnelManagementView : PayrollSheet
{
    private DataTable table = new();
    private List<Employee> originals = [];
    private PayrollColumn[] columns = [];
    public PersonnelManagementView(PayrollService service, Action closeSheet)
        : base(service, "w_gz_rsgl", closeSheet)
    {
        Grid.Name = "dw_master";
        OperationMenu(("刷新", Refresh, null), ("存盘", () => Save(), "Ctrl+S"), ("增加", Add, "Ctrl+A"),
            ("删除", Delete, "Ctrl+D"), ("F.返回", CloseSheet, "Ctrl+F4"));
        PayrollUi.Shortcut(this, Key.A, ModifierKeys.Control, Add);
        PayrollUi.Shortcut(this, Key.D, ModifierKeys.Control, Delete);
        Layout.Children.Add(Grid); LoadRows();
    }
    private void LoadRows()
    {
        var snapshot = Service.Snapshot;
        originals = snapshot.Employees;
        columns = snapshot.Columns.Where(c => c.Enabled && (c.FieldName.StartsWith("g_j", StringComparison.Ordinal)
            || c.FieldName is "g_f1" or "g_f2")).OrderBy(c => c.Order).ToArray();
        table = PayrollUi.Table("Personnel", columns);
        foreach (var employee in originals)
            table.Rows.Add(columns.Select(c => (object?)PayrollUi.Attribute(employee, c.FieldName) ?? DBNull.Value).ToArray());
        Grid.Columns.Clear();
        foreach (var column in columns) Grid.Columns.Add(PayrollUi.Text(column.Caption, "[" + column.FieldName + "]",
            column.FieldName == "g_j1", Math.Clamp(column.Width * 12, 100, 260)));
        Grid.ItemsSource = table.DefaultView; Dirty = false; Status.Text = $"人事管理　共 {originals.Count} 人";
    }
    public override bool Save()
    {
        var result = Run(() =>
        {
            PayrollUi.CommitGrid(Grid);
            var next = new List<Employee>();
            foreach (DataRow row in table.Rows)
            {
                var employee = originals.Single(e => e.Code == (string)row["g_j1"]);
                foreach (var column in columns) PayrollUi.SetAttribute(employee, column.FieldName,
                    row.IsNull(column.FieldName) ? null : (string)row[column.FieldName]);
                next.Add(employee);
            }
            Service.SaveEmployees(next);
        });
        if (result) { Dirty = false; Status.Text = "已存盘"; }
        return result;
    }
    private void Refresh()
    {
        if (!CanClose()) return;
        Run(() => { Service.Refresh(); LoadRows(); });
    }
    private void Add()
    {
        if (Dirty && !Save()) return;
        Show(new AddEmployeeWindow(Service)); LoadRows();
    }
    private void Delete() => Run(() =>
    {
        PayrollUi.CommitGrid(Grid);
        if (Grid.SelectedItem is not DataRowView selected) throw new PayrollValidationException("请先选择人员。");
        var code = (string)selected.Row["g_j1"];
        if (Service.Snapshot.Periods.SelectMany(p => p.Rows).Any(r => r.Employee.Code == code))
            throw new PayrollValidationException("人员已有工资记录，不能删除。");
        if (MessageBox.Show(Window.GetWindow(this), "是否删除？", "人事管理", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        table.Rows.Remove(selected.Row); Dirty = true;
    });
}

/// <summary>w_gz_rsgl_ins: basic items above; wage items below left; save above exit on right.</summary>
public sealed class AddEmployeeWindow : PayrollDialog
{
    private sealed record AmountInput(string Field, string Caption) { public string Value { get; set; } = ""; }
    public AddEmployeeWindow(PayrollService service, DateOnly? month = null)
        : base(service, "w_gz_rsgl_ins", "增加员工", 800, 680)
    {
        var snapshot = service.Snapshot;
        var form = new Grid { Margin = PayrollUi.Gap };
        form.RowDefinitions.Add(new() { Height = GridLength.Auto }); form.RowDefinitions.Add(new());
        form.ColumnDefinitions.Add(new() { Width = new(3, GridUnitType.Star) });
        form.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        var basic = new Grid { Margin = PayrollUi.Gap };
        for (var i = 0; i < 6; i++) basic.ColumnDefinitions.Add(new() { Width = i % 2 == 0 ? GridLength.Auto : new(1, GridUnitType.Star) });
        for (var i = 0; i < 4; i++) basic.RowDefinitions.Add(new() { Height = GridLength.Auto });
        var code = PayrollUi.Input(); code.Name = "sle_bh";
        var name = PayrollUi.Input(); name.Name = "sle_name";
        var department = new ComboBox { Name = "ddlb_bm", Margin = PayrollUi.Gap, MinHeight = 30,
            ItemsSource = snapshot.Departments, DisplayMemberPath = "Name", SelectedValuePath = "Code" };
        PayrollUi.Add(basic, PayrollUi.Label("编号"), 0, 0); PayrollUi.Add(basic, code, 0, 1);
        PayrollUi.Add(basic, PayrollUi.Label("姓名"), 0, 2); PayrollUi.Add(basic, name, 0, 3);
        PayrollUi.Add(basic, PayrollUi.Label("部门"), 0, 4); PayrollUi.Add(basic, department, 0, 5);
        var attributes = new Dictionary<string, TextBox>();
        for (var i = 4; i <= 8; i++)
        {
            var column = snapshot.Columns.Single(c => c.FieldName == $"g_j{i}");
            if (!column.Enabled) continue;
            var input = PayrollUi.Input(); input.Name = $"sle_j{i}"; attributes.Add(column.FieldName, input);
            var row = (i - 4) / 2 + 1; var col = (i - 4) % 2 * 3;
            PayrollUi.Add(basic, PayrollUi.Label(column.Caption), row, col); PayrollUi.Add(basic, input, row, col + 1, 2);
        }
        PayrollUi.Add(form, new GroupBox { Header = "基本项", Content = basic, Margin = PayrollUi.Gap }, 0, 0, 2);
        var targets = snapshot.Formulas.Where(f => f.Enabled).Select(f => f.TargetField).ToHashSet();
        var initial = snapshot.Columns.Where(c => c.Enabled && c.Kind == PayrollValueKind.Number && !targets.Contains(c.FieldName))
            .OrderBy(c => c.Order).Select(c => new AmountInput(c.FieldName, c.Caption)).ToList();
        var wages = PayrollUi.Grid(); wages.Name = "dw_1";
        wages.Columns.Add(PayrollUi.Text("工资项目", "Caption", true, 180)); wages.Columns.Add(PayrollUi.Text("内容", "Value", width: 200));
        wages.ItemsSource = initial;
        PayrollUi.Add(form, new GroupBox { Header = "工资项", Content = wages, Margin = PayrollUi.Gap }, 1);
        var buttons = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        buttons.Children.Add(PayrollUi.Button("存盘", () => SaveAction!(), "cb_2"));
        buttons.Children.Add(PayrollUi.Button("退出", Close, "cb_1"));
        PayrollUi.Add(form, buttons, 1, 1); Layout.Children.Add(form);
        SaveAction = () => Save(() =>
        {
            PayrollUi.CommitGrid(wages);
            Service.AddEmployee(new() { Code = code.Text, Name = name.Text, DepartmentCode = department.SelectedValue as string ?? "",
                Attributes = attributes.ToDictionary(a => a.Key, a => (string?)a.Value.Text) }, month,
                initial.ToDictionary(a => a.Field, a => PayrollUi.Number(a.Value)));
            Status.Text = "员工已存盘";
            // Stay in the original add dialog; another save requires a different code.
        });
    }
}

public sealed class WageManagementView : PayrollSheet
{
    private readonly DateOnly month;
    private readonly IReadOnlyList<PayrollAccount> accounts;
    private readonly Action<PayrollDocument, Guid>? transfer;
    private readonly IReadOnlyList<string>? voucherTypes;
    private DataTable table = new();
    private HashSet<string> computed = [];
    public WageManagementView(PayrollService service, DateOnly month, IReadOnlyList<PayrollAccount> accounts,
        Action closeSheet, Action<PayrollDocument, Guid>? transferToLedger = null, IReadOnlyList<string>? voucherTypes = null)
        : base(service, "w_gz_gzgl", closeSheet)
    {
        this.month = month; this.accounts = accounts; transfer = transferToLedger; this.voucherTypes = voucherTypes; Grid.Name = "dw_master";
        OperationMenu(("另存", Export, null), ("刷新", Refresh, null), ("存盘", () => Save(), "Ctrl+S"),
            ("统一置数", Uniform, null), ("工资计算", Calculate, null),
            ("工资发放凭证", () => Plan(PayrollVoucherKind.Payment), null),
            ("工资分配凭证", () => Plan(PayrollVoucherKind.Distribution), null),
            ("F.返回", CloseSheet, "Ctrl+F4"));
        Layout.Children.Add(Grid); LoadRows();
    }
    private void LoadRows()
    {
        var wages = Service.GetWageTable(month);
        computed = Service.Snapshot.Formulas.Where(f => f.Enabled).Select(f => f.TargetField).ToHashSet();
        table = PayrollUi.Table("Wages", wages.Columns);
        foreach (var row in wages.Rows)
            table.Rows.Add(wages.Columns.Select(c => (object?)(c.Kind == PayrollValueKind.Number
                ? PayrollService.Value(row, c.FieldName)?.ToString(CultureInfo.InvariantCulture)
                : PayrollUi.Attribute(row.Employee, c.FieldName)) ?? DBNull.Value).ToArray());
        Grid.Columns.Clear();
        foreach (var column in wages.Columns) Grid.Columns.Add(PayrollUi.Text(column.Caption, "[" + column.FieldName + "]",
            column.Kind == PayrollValueKind.Text || computed.Contains(column.FieldName), Math.Clamp(column.Width * 12, 100, 260)));
        Grid.ItemsSource = table.DefaultView; Dirty = false;
        var totals = string.Join("　", wages.Columns.Where(c => c.Kind == PayrollValueKind.Number)
            .Select(c => $"{c.Caption} {wages.Totals[c.FieldName].ToString(CultureInfo.InvariantCulture)}"));
        Status.Text = $"{month:yyyy.MM}　{(wages.IsCalculated ? "已计算" : "待工资计算")}　共 {wages.Rows.Count} 人\n合计（空值未计入）：{totals}";
    }
    public override bool Save()
    {
        if (!Run(() => PayrollUi.CommitGrid(Grid))) return false;
        if (!Dirty) return true;
        var result = Run(() =>
        {
            PayrollUi.CommitGrid(Grid);
            var fields = Service.Snapshot.Columns.Where(c => c.Enabled && c.Kind == PayrollValueKind.Number && !computed.Contains(c.FieldName)).ToArray();
            var values = new Dictionary<string, Dictionary<string, decimal?>>();
            foreach (DataRow row in table.Rows)
                values.Add((string)row["g_j1"], fields.ToDictionary(c => c.FieldName,
                    c => PayrollUi.Number(row.IsNull(c.FieldName) ? null : (string)row[c.FieldName])));
            Service.SaveInputs(month, values);
        });
        if (result) LoadRows();
        return result;
    }
    private void Refresh() { if (CanClose()) Run(() => { Service.Refresh(); LoadRows(); }); }
    private void Calculate() { if (Save()) Run(() => { Service.Calculate(month); LoadRows(); }); }
    private void Uniform()
    {
        if (!Save()) return;
        Show(new UniformPayrollValuesWindow(Service, month)); LoadRows();
    }
    private void Plan(PayrollVoucherKind kind)
    {
        if (!Save()) return;
        Show(new PayrollVoucherWindow(Service, month, kind, accounts, transfer, voucherTypes));
    }
    private void Export()
    {
        if (!Save()) return;
        Run(() =>
        {
            var csv = WageTableExporter.ToCsv(Service.GetWageTable(month));
            var dialog = new SaveFileDialog { Filter = "CSV 工资表 (*.csv)|*.csv", FileName = $"工资表-{month:yyyy-MM}.csv", AddExtension = true };
            if (dialog.ShowDialog(Window.GetWindow(this)) == true) File.WriteAllText(dialog.FileName, csv, new UTF8Encoding(true));
        });
    }
}

/// <summary>w_gz_edit_set: column above value; 空值设零/确定/取消 below left to right.</summary>
public sealed class UniformPayrollValuesWindow : PayrollDialog
{
    public UniformPayrollValuesWindow(PayrollService service, DateOnly month)
        : base(service, "w_gz_edit_set", "统一置数", 560, 320)
    {
        var targets = service.Snapshot.Formulas.Where(f => f.Enabled).Select(f => f.TargetField).ToHashSet();
        var column = new ComboBox { Margin = PayrollUi.Gap, ItemsSource = service.Snapshot.Columns.Where(c => c.Enabled
            && c.Kind == PayrollValueKind.Number && !targets.Contains(c.FieldName)).ToArray(), DisplayMemberPath = "Caption",
            SelectedValuePath = "FieldName", MinHeight = 30 };
        var value = PayrollUi.Input();
        var form = new StackPanel { Margin = PayrollUi.Gap };
        form.Children.Add(PayrollUi.Label("修改栏目：")); form.Children.Add(column);
        form.Children.Add(PayrollUi.Label("修改值：")); form.Children.Add(value);
        void Apply(bool nullOnly) => Run(() =>
        {
            Service.SetUniformValue(month, column.SelectedValue as string ?? "", nullOnly ? 0 : PayrollUi.Number(value.Text), nullValuesOnly: nullOnly);
            Status.Text = "设置完毕！";
        });
        var buttons = PayrollUi.Buttons(PayrollUi.Button("空值设零", () => Apply(true), "cb_3"),
            PayrollUi.Button("确定", () => Apply(false), "cb_1"), PayrollUi.Button("取消", Close, "cb_2"));
        DockPanel.SetDock(buttons, Dock.Bottom); Layout.Children.Add(buttons); Layout.Children.Add(form);
    }
}
