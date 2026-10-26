using System.Globalization;
using System.Windows;
using System.Windows.Controls;

namespace Caiwu.FixedAssets.Wpf;

/// <summary>Creates a persisted module plan only. Transfer to the shared ledger requires an integrator-owned transactional port.</summary>
public sealed class AssetVoucherPlanWindow : AssetOriginalModal
{
    public AssetVoucherPlan? Result { get; private set; }
    public AssetVoucherPlanWindow(AssetBookService service, AssetVoucherKind kind, Guid sourceId, string? additionCreditAccount = null)
        : base("w_pz_build", "生成凭证", 2501, 1212)
    {
        if (kind == AssetVoucherKind.Addition && string.IsNullOrWhiteSpace(additionCreditAccount))
            throw new AssetRuleException("addition-credit-account-required", "增加资产凭证计划须由宿主明确提供贷方科目。");
        var snapshot = service.Read();
        var sourceDate = kind == AssetVoucherKind.Depreciation ? snapshot.Batches.Single(x => x.Id == sourceId).Period.LastDay :
            snapshot.Movements.Single(x => x.Id == sourceId).Date;
        Label("st_2", "已计提折旧年月：", 471, 100, 448, 72);
        Label("st_1", "凭证日期：", 539, 316, 379, 72);
        Label("st_3", "凭证类型：", 539, 492, 379, 72);
        Label("st_4", "凭证编号：", 539, 704, 379, 72);
        Put(new TextBox { FontSize = 46, IsReadOnly = true, Text = AssetPeriod.From(sourceDate).ToString() }, "em_1", 955, 92, 343, 88);
        var date = Put(new TextBox { FontSize = 46, Text = sourceDate.ToString("yyyy-MM-dd") }, "em_2", 955, 308, 416, 88);
        // Voucher type validity is a shared-ledger integration requirement; this module only retains the explicit identity.
        var type = Put(new TextBox { FontSize = 46, Text = "记" }, "ddlb_1", 955, 488, 430, 88);
        var number = Put(new TextBox { FontSize = 46, Text = "1" }, "em_3", 955, 696, 283, 88);
        Action("cb_1", "生成", 1801, 332, 247, 128, () =>
        {
            Result = service.CreateVoucherPlan(snapshot.Revision, kind, sourceId,
                DateOnly.ParseExact(date.Text, "yyyy-MM-dd", CultureInfo.InvariantCulture), type.Text,
                int.Parse(number.Text, NumberStyles.Integer, CultureInfo.CurrentCulture), additionCreditAccount);
            ShowPlan(this, service, Result); DialogResult = true;
        }).IsDefault = true;
        Action("cb_2", "退出", 1801, 624, 247, 128, () => DialogResult = false).IsCancel = true;
    }
    internal static void ShowPlan(Window owner, AssetBookService service, AssetVoucherPlan plan)
    {
        var root = new DockPanel(); var buttons = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(8) };
        DockPanel.SetDock(buttons, Dock.Bottom); root.Children.Add(buttons);
        var summary = new TextBlock { Text = $"凭证计划  {plan.Date:yyyy-MM-dd}  {plan.VoucherType} {plan.VoucherNumber}  借方 {plan.DebitTotal:N2}  贷方 {plan.CreditTotal:N2}", Margin = new Thickness(8) };
        DockPanel.SetDock(summary, Dock.Top); root.Children.Add(summary);
        root.Children.Add(new DataGrid { AutoGenerateColumns = true, IsReadOnly = true, CanUserAddRows = false, ItemsSource = plan.Lines });
        var window = new Window { Title = "凭证计划", Width = 1000, Height = 500, Owner = owner, Content = root };
        var cancel = new Button { Content = "撤销计划", Margin = new Thickness(8), Padding = new Thickness(12, 6, 12, 6), IsEnabled = !plan.Voided };
        cancel.Click += (_, _) =>
        {
            try
            {
                var snapshot = service.Read();
                service.VoidVoucherPlan(snapshot.Revision, plan.Id); window.Close();
            }
            catch (Exception ex) when (ex is AssetRuleException or System.IO.IOException)
            { MessageBox.Show(window, ex.Message, window.Title); }
        };
        buttons.Children.Add(cancel); window.ShowDialog();
    }
}
