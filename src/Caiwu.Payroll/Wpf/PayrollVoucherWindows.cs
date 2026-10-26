using System.Collections.ObjectModel;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;

namespace Caiwu.Payroll.Wpf;

/// <summary>w_pz_sz: payable account/column above credits, distribution below;
/// 增加/删除 right of credit grid, 确定 before 取消.</summary>
public sealed class PayrollVoucherSettingsWindow : PayrollDialog
{
    public PayrollVoucherSettingsWindow(PayrollService service, IReadOnlyList<PayrollAccount> accounts)
        : base(service, "w_pz_sz", "制作凭证信息设置", 820, 620)
    {
        var snapshot = service.Snapshot; var initial = snapshot.VoucherSettings ?? new();
        var settings = initial with { Credits = initial.Credits.Select(c => c with { }).ToList() };
        var numeric = snapshot.Columns.Where(c => c.Enabled && c.Kind == PayrollValueKind.Number).ToArray();
        var payable = new ComboBox { Name = "ddlb_2", Margin = PayrollUi.Gap, MinHeight = 30,
            ItemsSource = accounts, DisplayMemberPath = "Code", SelectedValuePath = "Code", SelectedValue = settings.PayableAccount };
        var amount = new ComboBox { Name = "ddlb_1", Margin = PayrollUi.Gap, MinHeight = 30,
            ItemsSource = numeric, DisplayMemberPath = "Caption", SelectedValuePath = "FieldName", SelectedValue = settings.PayableField };
        var distribution = new ComboBox { Name = "ddlb_3", Margin = PayrollUi.Gap, MinHeight = 30,
            ItemsSource = snapshot.Columns.Where(c => c.Enabled && c.Kind == PayrollValueKind.Text && c.FieldName is not ("g_j1" or "g_j2" or "g_j3")).ToArray(),
            DisplayMemberPath = "Caption", SelectedValuePath = "FieldName", SelectedValue = settings.DistributionAccountField };
        var rows = new ObservableCollection<PayrollCreditMapping>(settings.Credits);
        var credits = PayrollUi.Grid(); credits.Name = "dw_1"; credits.ItemsSource = rows;
        credits.Columns.Add(new DataGridComboBoxColumn { Header = "对应工资栏目", Width = 230, ItemsSource = numeric,
            DisplayMemberPath = "Caption", SelectedValuePath = "FieldName", SelectedValueBinding = new System.Windows.Data.Binding("FieldName") });
        credits.Columns.Add(new DataGridComboBoxColumn { Header = "贷方科目代码", Width = 230, ItemsSource = accounts,
            DisplayMemberPath = "Code", SelectedValuePath = "Code", SelectedValueBinding = new System.Windows.Data.Binding("AccountCode") });
        Track(credits);
        var group = new DockPanel { Margin = PayrollUi.Gap };
        var inputs = new StackPanel(); inputs.Children.Add(PayrollUi.Label("借方：应付工资"));
        inputs.Children.Add(PayrollUi.Label("对应科目：")); inputs.Children.Add(payable);
        inputs.Children.Add(PayrollUi.Label("对应工资栏目：")); inputs.Children.Add(amount); inputs.Children.Add(PayrollUi.Label("贷方："));
        DockPanel.SetDock(inputs, Dock.Top); group.Children.Add(inputs);
        var controls = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        controls.Children.Add(PayrollUi.Button("增加", () => { rows.Add(new()); Dirty = true; }, "cb_3"));
        controls.Children.Add(PayrollUi.Button("删除", () => { if (credits.SelectedItem is PayrollCreditMapping selected) { rows.Remove(selected); Dirty = true; } }, "cb_4"));
        DockPanel.SetDock(controls, Dock.Right); group.Children.Add(controls); group.Children.Add(credits);
        var lower = new StackPanel(); lower.Children.Add(PayrollUi.Label("分配科目对应工资栏目：")); lower.Children.Add(distribution);
        var buttons = PayrollUi.Buttons(PayrollUi.Button("确定", () => { if (SaveAction!()) Close(); }, "cb_1"), PayrollUi.Button("取消", Close, "cb_2"));
        lower.Children.Add(buttons); DockPanel.SetDock(lower, Dock.Bottom); Layout.Children.Add(lower);
        Layout.Children.Add(new GroupBox { Header = "工资发放凭证设置：", Content = group, Margin = PayrollUi.Gap });
        payable.SelectionChanged += (_, _) => Dirty = true; amount.SelectionChanged += (_, _) => Dirty = true;
        distribution.SelectionChanged += (_, _) => Dirty = true;
        SaveAction = () => Save(() =>
        {
            PayrollUi.CommitGrid(credits);
            Service.SaveVoucherSettings(settings with { PayableAccount = payable.SelectedValue as string ?? "", PayableField = amount.SelectedValue as string ?? "",
                DistributionAccountField = distribution.SelectedValue as string ?? "", Credits = rows.ToList() });
        });
    }
}

/// <summary>w_pz_build_gz: selection mode keeps payment left of distribution, fields
/// year-month/date/type/number vertically, generate/exit on the right. Preview is a
/// second mode, never superimposed over those original overlapping design controls.</summary>
public sealed class PayrollVoucherWindow : PayrollDialog
{
    private PayrollVoucherPlan? selectedPlan;
    public PayrollVoucherWindow(PayrollService service, DateOnly month, PayrollVoucherKind kind,
        IReadOnlyList<PayrollAccount> accounts, Action<PayrollDocument, Guid>? transferToLedger = null,
        IReadOnlyList<string>? voucherTypes = null)
        : base(service, "w_pz_build_gz", "凭证生成", 920, 620)
    {
        var selection = new Grid { Margin = new(40, 16, 40, 16) };
        selection.ColumnDefinitions.Add(new() { Width = GridLength.Auto }); selection.ColumnDefinitions.Add(new());
        selection.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        for (var i = 0; i < 6; i++) selection.RowDefinitions.Add(new() { Height = GridLength.Auto });
        var payment = new RadioButton { Name = "rb_1", Content = "工资发放凭证", IsChecked = kind == PayrollVoucherKind.Payment, Margin = PayrollUi.Gap };
        var allocation = new RadioButton { Name = "rb_2", Content = "工资分配凭证", IsChecked = kind == PayrollVoucherKind.Distribution, Margin = PayrollUi.Gap };
        var kinds = new StackPanel { Orientation = Orientation.Horizontal }; kinds.Children.Add(payment); kinds.Children.Add(allocation);
        PayrollUi.Add(selection, kinds, 0, 0, 2);
        var yearMonth = PayrollUi.Input(month.ToString("yyyy.MM", CultureInfo.InvariantCulture)); yearMonth.Name = "em_1";
        var date = PayrollUi.Input(month.AddMonths(1).AddDays(-1).ToString("yyyy.MM.dd", CultureInfo.InvariantCulture)); date.Name = "em_2";
        // Voucher kinds are supplied by the host. The caller must choose an actual kind;
        // this editable value is validated again by the accepting ledger service.
        var type = new ComboBox { Name = "ddlb_1", IsEditable = true, ItemsSource = voucherTypes ?? [], Margin = PayrollUi.Gap, MinHeight = 30 };
        var number = PayrollUi.Input(); number.Name = "em_3";
        var labels = new[] { "数据年月：", "凭证日期：", "凭证类型：", "凭证编号：" };
        var inputs = new FrameworkElement[] { yearMonth, date, type, number };
        for (var i = 0; i < labels.Length; i++) { PayrollUi.Add(selection, PayrollUi.Label(labels[i]), i + 1); PayrollUi.Add(selection, inputs[i], i + 1, 1); }
        var preview = PayrollUi.Grid(true); preview.Name = "dw_1";
        foreach (var (title, property) in new[] { ("科目", "AccountCode"), ("摘要", "Summary"), ("借方", "Debit"),
            ("贷方", "Credit"), ("部门", "DepartmentCode"), ("人员", "EmployeeCode") }) preview.Columns.Add(PayrollUi.Text(title, property, true, 135));
        preview.Visibility = Visibility.Collapsed;
        var bottom = PayrollUi.Buttons();
        var cancel = PayrollUi.Button("取消", () => { preview.Visibility = Visibility.Collapsed; selection.Visibility = Visibility.Visible;
            bottom.Visibility = Visibility.Collapsed; }, "cb_4");
        if (transferToLedger is not null) bottom.Children.Add(PayrollUi.Button("转到总帐", () => Run(() =>
        {
            if (selectedPlan is null) throw new PayrollValidationException("请先生成凭证计划。");
            transferToLedger(Service.Snapshot, selectedPlan.Id);
            Service.Refresh(); Status.Text = "已转为总账草稿，请到凭证序时簿核对。";
        }), "cb_3"));
        bottom.Children.Add(cancel); bottom.Visibility = Visibility.Collapsed;
        var generate = PayrollUi.Button("生成", () => Run(() =>
        {
            if (!DateOnly.TryParseExact(yearMonth.Text + ".01", "yyyy.MM.dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var dataMonth))
                throw new PayrollValidationException("数据年月格式应为 yyyy.MM。");
            if (!DateOnly.TryParseExact(date.Text, "yyyy.MM.dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var voucherDate))
                throw new PayrollValidationException("凭证日期格式应为 yyyy.MM.dd。");
            if (!int.TryParse(number.Text, NumberStyles.None, CultureInfo.InvariantCulture, out var voucherNumber))
                throw new PayrollValidationException("凭证编号未输或格式错误！");
            selectedPlan = Service.CreateVoucherPlan(dataMonth, new(payment.IsChecked == true ? PayrollVoucherKind.Payment : PayrollVoucherKind.Distribution,
                voucherDate, type.Text, voucherNumber, $"{dataMonth:yyyy年MM月}工资"), accounts);
            preview.ItemsSource = selectedPlan.Lines; selection.Visibility = Visibility.Collapsed; preview.Visibility = Visibility.Visible;
            bottom.Visibility = Visibility.Visible;
            Status.Text = selectedPlan.Status == "planned" ? "凭证计划已存盘，尚未转到总账。" : "此计划已经转为总账草稿。";
        }), "cb_1");
        PayrollUi.Add(selection, generate, 2, 2); PayrollUi.Add(selection, PayrollUi.Button("退出", Close, "cb_2"), 4, 2);
        DockPanel.SetDock(bottom, Dock.Bottom); Layout.Children.Add(bottom);
        var modes = new Grid(); modes.Children.Add(selection); modes.Children.Add(preview); Layout.Children.Add(modes);
    }
}
