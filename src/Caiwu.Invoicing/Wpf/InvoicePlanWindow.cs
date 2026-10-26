using System.Collections.Immutable;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;

namespace Caiwu.Invoicing.Wpf;

/// <summary>Subset of w_fp_pz: selection → real preview plan → separate atomic sandbox commit.</summary>
public sealed class InvoicePlanWindow : Window
{
    private readonly InvoiceService service;
    private readonly InvoiceParameters parameters;
    private readonly Func<InvoiceVoucherPlan, string>? commitProposal;
    private readonly TextBox sourceMonth;
    private readonly TextBox voucherMonth;
    private readonly TextBox voucherType = InvoiceUi.Text("1");
    private readonly TextBox firstNumber = InvoiceUi.Text("1");
    private readonly RadioButton input = new() { Content = "进项发票", GroupName = "direction", Margin = new(10) };
    private readonly RadioButton output = new() { Content = "销项发票", GroupName = "direction", IsChecked = true, Margin = new(10) };
    private readonly RadioButton perInvoice = new() { Content = "每张发票单独生成一张凭证", GroupName = "grouping", IsChecked = true, Margin = new(10) };
    private readonly RadioButton monthly = new() { Content = "本月发票汇总生成一张凭证", GroupName = "grouping", Margin = new(10) };
    private readonly RadioButton goods = new() { Content = "销货", GroupName = "sales", IsChecked = true, Margin = new(10) };
    private readonly RadioButton services = new() { Content = "服务", GroupName = "sales", Margin = new(10) };
    private readonly StackPanel options = new();
    private readonly DataGrid preview = InvoiceUi.Grid();
    private readonly TextBlock status = InvoiceUi.Label("");
    private readonly Button transfer;
    private InvoiceVoucherPlan? plan;

    public InvoicePlanWindow(InvoiceService service, InvoiceParameters parameters, Func<InvoiceVoucherPlan, string>? commitProposal = null)
    {
        this.service = service; this.parameters = parameters;
        this.commitProposal = commitProposal;
        Title = commitProposal is null ? "凭证生成 · 合成工作区" : "凭证生成"; Width = 900; Height = 620; MinWidth = 780; MinHeight = 460;
        var state = service.Read();
        sourceMonth = InvoiceUi.Text(state.OpenMonth.ToString());
        voucherMonth = InvoiceUi.Text(state.OpenMonth.ToString());
        var root = new DockPanel { Margin = new(12) };
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Center };
        transfer = InvoiceUi.Button("转到总帐", Commit); transfer.IsEnabled = false;
        buttons.Children.Add(InvoiceUi.Button("参数设置", () =>
        {
            var dialog = new InvoiceAccountParametersWindow(service, parameters, input.IsChecked == true) { Owner = this };
            if (dialog.ShowDialog() == true) { plan = null; transfer.IsEnabled = false; ShowOptions(); }
        }));
        buttons.Children.Add(InvoiceUi.Button("凭证生成", Generate));
        buttons.Children.Add(transfer);
        buttons.Children.Add(InvoiceUi.Button("取消", Close));
        DockPanel.SetDock(buttons, Dock.Bottom); root.Children.Add(buttons);
        DockPanel.SetDock(status, Dock.Bottom); root.Children.Add(status);
        Row("需要生成凭证的发票年月：", sourceMonth);
        var dates = new StackPanel { Orientation = Orientation.Horizontal, Margin = new(8) };
        dates.Children.Add(InvoiceUi.Label("凭证年月：")); dates.Children.Add(voucherMonth);
        dates.Children.Add(InvoiceUi.Label("凭证类型：")); dates.Children.Add(voucherType); options.Children.Add(dates);
        Row("凭证编号 从", firstNumber);
        var direction = new StackPanel { Orientation = Orientation.Horizontal, Margin = new(8) };
        direction.Children.Add(input); direction.Children.Add(output); direction.Children.Add(goods); direction.Children.Add(services);
        options.Children.Add(direction);
        var grouping = new StackPanel { Orientation = Orientation.Horizontal, Margin = new(8) };
        grouping.Children.Add(perInvoice); grouping.Children.Add(monthly); options.Children.Add(grouping);
        options.Children.Add(InvoiceUi.Label("起始编号按当前合成工作区检查重复；全部重新生成和仓库出库单保留待集成。"));
        preview.IsReadOnly = true;
        InvoiceUi.Column(preview, "凭证编号", "Number", true);
        InvoiceUi.Column(preview, "分录摘要", "Summary", true);
        InvoiceUi.Column(preview, "科目编码", "AccountCode", true);
        InvoiceUi.Column(preview, "借方金额", "Debit", true);
        InvoiceUi.Column(preview, "贷方金额", "Credit", true);
        var body = new Grid(); body.Children.Add(options); body.Children.Add(preview); root.Children.Add(body);
        Content = root; ShowOptions();
        void Row(string label, UIElement control)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new(8) };
            row.Children.Add(InvoiceUi.Label(label)); row.Children.Add(control); options.Children.Add(row);
        }
    }
    private void ShowOptions() { options.Visibility = Visibility.Visible; preview.Visibility = Visibility.Collapsed; }
    private void Generate()
    {
        // Every click first discards any previous plan, including when new validation fails.
        plan = null; transfer.IsEnabled = false;
        var state = service.Read();
        var direction = input.IsChecked == true ? InvoiceDirection.Input : InvoiceDirection.Output;
        var month = InvoiceUi.Month(sourceMonth.Text);
        var ids = state.Documents.Where(x => x.Key.Direction == direction && InvoiceMonth.From(x.AccountingDate) == month && x.IsUnprocessed)
            .Select(x => x.Id).ToImmutableArray();
        var request = new PlanRequest(direction, month, InvoiceUi.Month(voucherMonth.Text),
            int.Parse(voucherType.Text, CultureInfo.InvariantCulture), int.Parse(firstNumber.Text, CultureInfo.InvariantCulture),
            monthly.IsChecked == true ? VoucherGrouping.Monthly : VoucherGrouping.PerInvoice,
            goods.IsChecked == true ? SalesCategory.Goods : SalesCategory.Services, parameters.Accounts, ids,
            parameters.EligibleStatuses, parameters.SeparateInputTax);
        plan = service.CreateVoucherPlan(request);
        preview.ItemsSource = plan.Vouchers.SelectMany(v => v.Lines.Select(x => new { v.Number, x.Summary, x.AccountCode, x.Debit, x.Credit })).ToArray();
        options.Visibility = Visibility.Collapsed; preview.Visibility = Visibility.Visible; transfer.IsEnabled = true;
        status.Text = $"生成 {plan.Vouchers.Length} 张凭证计划；尚未转账。";
    }
    private void Commit()
    {
        var current = plan ?? throw new InvoiceException("plan-missing", "请先生成凭证计划。");
        var message = commitProposal is null ? CommitToSandbox(current) : commitProposal(current);
        plan = null; transfer.IsEnabled = false;
        status.Text = message;
    }
    private string CommitToSandbox(InvoiceVoucherPlan current)
    {
        service.CommitVoucherPlanToSandbox(current);
        return "凭证已保存到合成总账，发票回链已同步保存。";
    }
}

/// <summary>Functional subset of w_fp_sz / w_fp_sz_2. Original counterpart auto-creation and tax parameters remain in the handoff.</summary>
internal sealed class InvoiceAccountParametersWindow : Window
{
    internal InvoiceAccountParametersWindow(InvoiceService service, InvoiceParameters parameters, bool incoming)
    {
        Title = incoming ? "进项发票参数设置" : "销项发票参数设置";
        Width = 620; Height = 430; WindowStartupLocation = WindowStartupLocation.CenterOwner;
        var current = parameters.Accounts;
        var fields = incoming
            ? new[] { ("原材料科目", current.Material), ("进项税科目", current.InputTax), ("应付账款科目", current.Payable) }
            : new[] { ("销货收入科目", current.GoodsRevenue), ("劳务收入科目", current.ServiceRevenue), ("销项税科目", current.OutputTax), ("应收账款科目", current.Receivable) };
        var inputs = fields.Select(x => InvoiceUi.Text(x.Item2, 240)).ToArray();
        var root = new StackPanel { Margin = new(16) };
        for (int i = 0; i < fields.Length; i++)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal };
            var label = InvoiceUi.Label(fields[i].Item1 + "："); label.Width = 140;
            row.Children.Add(label); row.Children.Add(inputs[i]); root.Children.Add(row);
        }
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Center };
        buttons.Children.Add(InvoiceUi.Button("确定", () =>
        {
            var accounts = service.Read().Accounts;
            foreach (var input in inputs)
                if (!accounts.Any(x => x.Code == input.Text.Trim() && x.Active && x.IsLeaf))
                    throw new InvoiceException("account", "所选科目不存在、停用或非明细科目。");
            parameters.Accounts = incoming ? current with { Material = inputs[0].Text.Trim(), InputTax = inputs[1].Text.Trim(), Payable = inputs[2].Text.Trim() }
                : current with { GoodsRevenue = inputs[0].Text.Trim(), ServiceRevenue = inputs[1].Text.Trim(), OutputTax = inputs[2].Text.Trim(), Receivable = inputs[3].Text.Trim() };
            DialogResult = true;
        }));
        buttons.Children.Add(InvoiceUi.Button("退出", Close)); root.Children.Add(buttons); Content = root;
    }
}
