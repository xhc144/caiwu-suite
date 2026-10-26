using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;

namespace Caiwu.Payroll.Wpf;

/// <summary>w_gz_bmwh: data on the left; 增加/删除/存盘/退出 vertically on the right.</summary>
public sealed class DepartmentWindow : PayrollDialog
{
    private readonly DataGrid grid = PayrollUi.Grid();
    private readonly ObservableCollection<Department> rows;
    public DepartmentWindow(PayrollService service) : base(service, "w_gz_bmwh", "部门维护", 640, 500)
    {
        rows = new(service.Snapshot.Departments);
        grid.Name = "dw_1";
        grid.Columns.Add(PayrollUi.Text("部门编码", nameof(Department.Code), width: 130));
        grid.Columns.Add(PayrollUi.Text("部门名称", nameof(Department.Name), width: 260));
        grid.ItemsSource = rows; Track(grid);
        var buttons = new StackPanel { VerticalAlignment = VerticalAlignment.Bottom, Margin = PayrollUi.Gap };
        buttons.Children.Add(PayrollUi.Button("增加", () => { var row = new Department(); rows.Add(row); grid.SelectedItem = row; Dirty = true; }, "cb_1"));
        buttons.Children.Add(PayrollUi.Button("删除", Delete, "cb_2"));
        buttons.Children.Add(PayrollUi.Button("存盘", () => SaveAction!(), "cb_3"));
        buttons.Children.Add(PayrollUi.Button("退出", Close, "cb_4"));
        DockPanel.SetDock(buttons, Dock.Right); Layout.Children.Add(buttons); Layout.Children.Add(grid);
        SaveAction = () => Save(() => { PayrollUi.CommitGrid(grid); Service.SaveDepartments(rows); });
    }
    private void Delete() => Run(() =>
    {
        PayrollUi.CommitGrid(grid);
        if (grid.SelectedItem is not Department row) throw new PayrollValidationException("请先选择部门。");
        var snapshot = Service.Snapshot;
        if (snapshot.Employees.Any(e => e.DepartmentCode == row.Code)
            || snapshot.Periods.SelectMany(p => p.Rows).Any(r => r.Employee.DepartmentCode == row.Code))
            throw new PayrollValidationException("该部门已使用，不能被删除！");
        if (MessageBox.Show(this, "删除该部门吗？", Title, MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        rows.Remove(row); Dirty = true;
    });
}

/// <summary>w_xt_gzsz: definition grid over 存盘/关闭, with stable original field IDs.</summary>
public sealed class PayrollColumnsWindow : PayrollDialog
{
    public PayrollColumnsWindow(PayrollService service) : base(service, "w_xt_gzsz", "工资栏目定义", 760, 720)
    {
        var rows = new ObservableCollection<PayrollColumn>(service.Snapshot.Columns);
        var grid = PayrollUi.Grid(); grid.Name = "dw_1"; grid.ItemsSource = rows;
        grid.Columns.Add(PayrollUi.Text("字段名", "FieldName", true, 100));
        grid.Columns.Add(PayrollUi.Text("栏目说明", "Description", width: 160));
        grid.Columns.Add(PayrollUi.Text("栏目名称", "Caption", width: 140));
        grid.Columns.Add(PayrollUi.Check("选中", "Enabled"));
        grid.Columns.Add(new DataGridComboBoxColumn { Header = "类型", Width = 110, ItemsSource = Enum.GetValues<PayrollValueKind>(),
            SelectedItemBinding = new System.Windows.Data.Binding("Kind") });
        grid.Columns.Add(PayrollUi.Text("顺序", "Order", width: 70));
        grid.Columns.Add(PayrollUi.Text("宽度", "Width", width: 70));
        grid.Columns.Add(PayrollUi.Text("小数位", "DecimalDigits", width: 70));
        grid.Columns.Add(PayrollUi.Check("传递", "CarryForward"));
        foreach (var (caption, field) in new[] { ("工资表", "WageTable"), ("汇总表", "Summary"), ("工资条", "Payslip") })
        {
            grid.Columns.Add(PayrollUi.Check($"打印{caption}", field + ".Enabled"));
            grid.Columns.Add(PayrollUi.Text($"{caption}整数宽", field + ".IntegerDigits", width: 110));
            grid.Columns.Add(PayrollUi.Text($"{caption}小数宽", field + ".DecimalDigits", width: 110));
        }
        Track(grid);
        var buttons = PayrollUi.Buttons(PayrollUi.Button("存盘", () => SaveAction!(), "cb_1"), PayrollUi.Button("关闭", Close, "cb_2"));
        buttons.HorizontalAlignment = HorizontalAlignment.Center;
        DockPanel.SetDock(buttons, Dock.Bottom); Layout.Children.Add(buttons); Layout.Children.Add(grid);
        SaveAction = () => Save(() => { PayrollUi.CommitGrid(grid); Service.SaveColumns(rows); });
    }
}

/// <summary>w_xt_gssz: grid over 增加/删除/修改/存盘/退出 in that original spatial order.</summary>
public sealed class PayrollFormulasWindow : PayrollDialog
{
    private readonly ObservableCollection<PayrollFormula> rows;
    private readonly DataGrid grid = PayrollUi.Grid();
    public PayrollFormulasWindow(PayrollService service) : base(service, "w_xt_gssz", "计算公式定义", 1080, 620)
    {
        rows = new(service.Snapshot.Formulas); grid.Name = "dw_1"; grid.ItemsSource = rows;
        grid.Columns.Add(PayrollUi.Check("执行", "Enabled"));
        grid.Columns.Add(PayrollUi.Text("顺序", "Order", width: 70));
        grid.Columns.Add(PayrollUi.Text("公式名", "Name", true, 130));
        grid.Columns.Add(PayrollUi.Text("计算结果", "TargetField", true, 100));
        grid.Columns.Add(PayrollUi.Text("计算公式", "Expression", true, 300));
        grid.Columns.Add(PayrollUi.Text("执行条件", "Condition", true, 230));
        grid.Columns.Add(PayrollUi.Check("计税", "IsTaxFormula"));
        Track(grid);
        var buttons = PayrollUi.Buttons(PayrollUi.Button("增加", () => Edit(null), "cb_3"),
            PayrollUi.Button("删除", Delete, "cb_4"), PayrollUi.Button("修改", () => Run(() =>
            { if (grid.SelectedItem is not PayrollFormula selected) throw new PayrollValidationException("没有公式可修改！"); Edit(selected); }), "cb_5"),
            PayrollUi.Button("存盘", () => SaveAction!(), "cb_1"), PayrollUi.Button("退出", Close, "cb_2"));
        DockPanel.SetDock(buttons, Dock.Bottom); Layout.Children.Add(buttons); Layout.Children.Add(grid);
        SaveAction = () => Save(() => { PayrollUi.CommitGrid(grid); Service.SaveFormulas(rows); });
    }
    private void Edit(PayrollFormula? selected)
    {
        if (!Run(() => PayrollUi.CommitGrid(grid))) return;
        var editor = new PayrollFormulaEditorWindow(Service, selected ?? new()
            { Order = rows.Count == 0 ? 1 : rows.Max(r => r.Order) + 1 }, candidate =>
        {
            var next = rows.Where(r => !ReferenceEquals(r, selected)).Append(candidate).ToList();
            Service.SaveFormulas(next);
            rows.Clear(); foreach (var formula in Service.Snapshot.Formulas) rows.Add(formula);
            Dirty = false;
        }) { Owner = this };
        editor.ShowDialog();
    }
    private void Delete() => Run(() =>
    {
        if (grid.SelectedItem is not PayrollFormula selected) throw new PayrollValidationException("没有公式可删除！");
        if (MessageBox.Show(this, "删除该计算公式吗？", Title, MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        rows.Remove(selected); Dirty = true;
    });
}

/// <summary>w_xt_gs_edit: definition on left; field/operator helpers on right; save before cancel.</summary>
public sealed class PayrollFormulaEditorWindow : PayrollDialog
{
    public PayrollFormulaEditorWindow(PayrollService service, PayrollFormula initial, Action<PayrollFormula> save)
        : base(service, "w_xt_gs_edit", "计算公式定义", 1060, 650)
    {
        var form = new Grid { Margin = PayrollUi.Gap };
        form.ColumnDefinitions.Add(new() { Width = new(2, GridUnitType.Star) });
        form.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        var left = new StackPanel();
        var name = PayrollUi.Input(initial.Name); var order = PayrollUi.Input(initial.Order.ToString());
        var target = new ComboBox { Margin = PayrollUi.Gap, ItemsSource = service.Snapshot.Columns.Where(c => c.Enabled
            && c.Kind == PayrollValueKind.Number).ToArray(), DisplayMemberPath = "Caption", SelectedValuePath = "FieldName",
            SelectedValue = initial.TargetField, MinHeight = 30 };
        var expression = PayrollUi.Input(initial.Expression); expression.AcceptsReturn = true; expression.MinHeight = 120;
        var condition = PayrollUi.Input(initial.Condition); condition.AcceptsReturn = true; condition.MinHeight = 60;
        var enabled = new CheckBox { Content = "执行", IsChecked = initial.Enabled, Margin = PayrollUi.Gap };
        var tax = new CheckBox { Content = "计税（单期税参数）", IsChecked = initial.IsTaxFormula, Margin = PayrollUi.Gap };
        foreach (var element in new UIElement[] { PayrollUi.Label("顺序"), order, PayrollUi.Label("公式名"), name,
            PayrollUi.Label("计算结果"), target, PayrollUi.Label("计算公式"), expression, PayrollUi.Label("执行条件"), condition, enabled, tax })
            left.Children.Add(element);
        var scroll = new ScrollViewer { Content = left, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        var right = new StackPanel { Margin = PayrollUi.Gap };
        right.Children.Add(PayrollUi.Label("快速选择：工资字段（双击插入）"));
        var fields = new ListBox { ItemsSource = service.Snapshot.Columns.Where(c => c.Enabled && c.Kind == PayrollValueKind.Number)
            .Select(c => c.FieldName + "  " + c.Caption), MinHeight = 140, MaxHeight = 260, Margin = PayrollUi.Gap };
        TextBox active = expression;
        expression.GotKeyboardFocus += (_, _) => active = expression;
        condition.GotKeyboardFocus += (_, _) => active = condition;
        fields.MouseDoubleClick += (_, _) => { if (fields.SelectedItem is string field) active.SelectedText = field.Split(' ')[0]; };
        right.Children.Add(fields);
        right.Children.Add(PayrollUi.Label("运算符  +  -  *  /  %  ( )"));
        right.Children.Add(PayrollUi.Label("条件符  =  <>  >  >=  <  <="));
        right.Children.Add(PayrollUi.Label("逻辑符  AND  OR  NOT"));
        right.Children.Add(new TextBlock { Text = "函数：ROUND、MIN、MAX、ABS、IF、COALESCE。空值保持为空；需要空值设零时显式使用 COALESCE。", Margin = PayrollUi.Gap, TextWrapping = TextWrapping.Wrap });
        PayrollUi.Add(form, scroll, 0); PayrollUi.Add(form, right, 0, 1);
        var buttons = PayrollUi.Buttons(PayrollUi.Button("存盘", () => SaveAction!(), "cb_1"), PayrollUi.Button("取消", Close, "cb_2"));
        buttons.HorizontalAlignment = HorizontalAlignment.Center;
        DockPanel.SetDock(buttons, Dock.Bottom); Layout.Children.Add(buttons); Layout.Children.Add(form);
        SaveAction = () =>
        {
            var saved = Save(() =>
            {
                if (!int.TryParse(order.Text, out var position)) throw new PayrollValidationException("公式顺序应为整数。");
                save(initial with { Order = position, Name = name.Text, TargetField = target.SelectedValue as string ?? "",
                    Expression = expression.Text, Condition = condition.Text, Enabled = enabled.IsChecked == true, IsTaxFormula = tax.IsChecked == true });
            });
            if (saved) Close();
            return saved;
        };
    }
}
