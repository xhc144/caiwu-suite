using System.Collections.ObjectModel;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;

namespace Caiwu.FixedAssets.Wpf;

public sealed class AssetDisposalWindow : AssetOriginalModal
{
    public AssetCard? Result { get; private set; }
    public AssetDisposalWindow(AssetBookService service, Guid assetId) : base("w_zcgl_delete", "注销设备", 1257, 1076)
    {
        var snapshot = service.Read(); var card = snapshot.Cards[assetId];
        Label("st_1", "设备编号", 105, 60, 306, 72); Label("st_bh", card.Code, 503, 56, 448, 84);
        Label("st_5", "参考编号", 110, 184, 306, 72); Label("st_6", card.ReferenceNumber, 503, 180, 247, 80);
        Label("st_2", "设备名称", 105, 300, 306, 72); Label("st_mc", card.Name, 503, 296, 603, 84);
        Label("st_3", "注销原因", 105, 420, 306, 72); Label("st_4", "注销日期", 105, 540, 306, 72);
        // PB height includes the popup list. Keep collapsed input at a text row height; the popup remains independent.
        var reason = Put(new ComboBox { FontSize = 46, ItemsSource = snapshot.Settings.Catalog.DisposalReasons,
            DisplayMemberPath = "Name", SelectedValuePath = "Code" }, "ddlb_1", 503, 420, 517, 80);
        var date = Put(new TextBox { FontSize = 46, Text = snapshot.NextDepreciationPeriod.FirstDay.ToString("yyyy-MM-dd") }, "em_1", 503, 536, 512, 80);
        Action("cb_1", "确定", 256, 776, 238, 100, () =>
        {
            Result = service.Dispose(snapshot.Revision, card.Id, DateOnly.ParseExact(date.Text, "yyyy-MM-dd", CultureInfo.InvariantCulture),
                reason.SelectedValue as string ?? ""); DialogResult = true;
        }).IsDefault = true;
        Action("cb_2", "取消", 727, 772, 238, 100, () => DialogResult = false).IsCancel = true;
    }
}

public sealed class AssetOriginalCostWindow : AssetOriginalModal
{
    public sealed class EditRow
    {
        public string Date { get; set; } = "";
        public decimal Before { get; set; }
        public decimal After { get; set; }
        public string Description { get; set; } = "";
    }
    public AssetOriginalCostWindow(AssetBookService service, Guid assetId) : base("w_zcgl_yztz", "原值调整", 3314, 1472)
    {
        Width = 1050; Height = 560; var snapshot = service.Read(); var card = snapshot.Cards[assetId];
        var row = new EditRow { Date = snapshot.NextDepreciationPeriod.FirstDay.ToString("yyyy-MM-dd"), Before = card.OriginalCost, After = card.OriginalCost };
        var grid = Put(new DataGrid { ItemsSource = new[] { row }, AutoGenerateColumns = false, CanUserAddRows = false, FontSize = 44, RowHeight = 90 },
            "dw_1", 0, 4, 3278, 1156);
        foreach (var (caption, property, readOnly, width) in new[] { ("调整日期", "Date", false, 700d), ("之前原值", "Before", true, 650d),
            ("调整后的原值", "After", false, 700d), ("调整说明", "Description", false, 1150d) })
            grid.Columns.Add(new DataGridTextColumn { Header = caption, Binding = new Binding(property), IsReadOnly = readOnly, Width = width });
        Action("cb_1", "确定", 1413, 1232, 283, 108, () =>
        {
            if (!grid.CommitEdit(DataGridEditingUnit.Cell, true) || !grid.CommitEdit(DataGridEditingUnit.Row, true)) throw new FormatException("请检查调整金额。");
            service.AdjustOriginalCost(snapshot.Revision, card.Id, DateOnly.ParseExact(row.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture), row.After,
                card.ResidualValue, row.Description); DialogResult = true;
        }).IsDefault = true;
        Action("cb_2", "取消", 1893, 1232, 283, 108, () => DialogResult = false).IsCancel = true;
        Action("cb_3", "删除", 933, 1232, 283, 108, () =>
        {
            var movement = snapshot.Movements.LastOrDefault(x => x.AssetId == card.Id && x.Kind == AssetMovementKind.OriginalCostAdjustment);
            if (movement is null) throw new AssetRuleException("adjustment-missing", "没有可删除的原值调整。");
            if (MessageBox.Show(this, "是否删除此原值调整？", Title, MessageBoxButton.YesNo) != MessageBoxResult.Yes) return;
            service.CancelOriginalCostAdjustment(snapshot.Revision, movement.Id); DialogResult = true;
        });
        Action("cb_4", "查询", 453, 1232, 283, 108, () =>
        {
            var history = new Window { Title = "原值调整", Owner = this, Width = 900, Height = 480,
                Content = new DataGrid { IsReadOnly = true, AutoGenerateColumns = true, CanUserAddRows = false,
                    ItemsSource = snapshot.Movements.Where(x => x.AssetId == card.Id && x.Kind is AssetMovementKind.OriginalCostAdjustment or AssetMovementKind.OriginalCostAdjustmentReversal)
                        .Select(x => new { 日期 = x.Date, 之前原值 = x.Before?.OriginalCost, 调整后原值 = x.After.OriginalCost, 说明 = x.Description }).ToArray() } };
            System.Windows.Automation.AutomationProperties.SetAutomationId(history, "w_zcgl_yztz_cx"); history.ShowDialog();
        });
    }
}
