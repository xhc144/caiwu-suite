using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Automation;
using System.Windows.Data;
using Microsoft.Win32;

namespace Caiwu.Costing.Wpf;

/// <summary>Host with an explicit current book and period; no ledger or storage dependencies.</summary>
public sealed class CostWorksheetPage : UserControl
{
    private readonly List<DataGrid> grids = [];
    public CostWorksheetEditor Editor { get; }

    public CostWorksheetPage(Guid bookId, DateOnly date)
    {
        Editor = new(bookId, date); DataContext = Editor;
        var root = new DockPanel { Margin = new(12) };
        var header = new StackPanel(); DockPanel.SetDock(header, Dock.Top);
        header.Children.Add(new TextBlock { Text = "成本分配与结转建议", FontSize = 22, FontWeight = FontWeights.SemiBold });
        header.Children.Add(new TextBlock { Text = "人民币；无在产品/损耗；阶段按表格顺序计算，只支持上一阶段对象整批承接一次。材料是已确认的新增成本，不要重复填入已承接成本。", TextWrapping = TextWrapping.Wrap });
        header.Children.Add(new TextBlock { Text = $"当前账套：{bookId:D}　仅生成待审核建议，科目及已记来源由主界面核实。", TextWrapping = TextWrapping.Wrap });
        var metadata = new WrapPanel { Margin = new(0, 8, 0, 8) };
        Field(metadata, "日期 yyyy-MM-dd", nameof(Editor.DateText), 110);
        Field(metadata, "制表人", nameof(Editor.PreparedBy), 120);
        Field(metadata, "成本来源/审核依据", nameof(Editor.SourceReference), 420);
        header.Children.Add(metadata);
        var buttons = new WrapPanel();
        Button(buttons, "计算 / 复算", () => { Commit(); Editor.Calculate(); });
        Button(buttons, "导出审核 JSON", () => Export(true));
        Button(buttons, "导出明细 CSV", () => Export(false));
        Button(buttons, "打开审核 JSON", Import);
        Button(buttons, "载入合成样例", () => { Commit(); Editor.LoadSyntheticExample(); });
        header.Children.Add(buttons);
        var status = new TextBlock { Margin = new(0, 8, 0, 8), TextWrapping = TextWrapping.Wrap, FontWeight = FontWeights.SemiBold };
        status.SetBinding(TextBlock.TextProperty, nameof(Editor.Status)); header.Children.Add(status);
        root.Children.Add(header);

        var tabs = new TabControl();
        var stages = Grid(nameof(Editor.Stages), false);
        TextColumn(stages, "阶段标识", nameof(CostStageRow.StageId)); TextColumn(stages, "阶段名称", nameof(CostStageRow.Name));
        TextColumn(stages, "共用材料池（元）", nameof(CostStageRow.SharedMaterials)); BasisColumn(stages, "材料分配基础", nameof(CostStageRow.MaterialBasis));
        TextColumn(stages, "人工费用池（元）", nameof(CostStageRow.DirectLabor)); TextColumn(stages, "制造费用池（元）", nameof(CostStageRow.ManufacturingOverhead));
        BasisColumn(stages, "人工分配基础", nameof(CostStageRow.LaborBasis)); BasisColumn(stages, "制造费用分配基础", nameof(CostStageRow.OverheadBasis));
        AddEditorTab(tabs, "1 阶段及费用池", stages,
            () => Editor.Stages.Add(new()), () => { if (stages.SelectedItem is CostStageRow row) Editor.Stages.Remove(row); },
            "产量 OutputQuantity / 人工工时 LaborHours / 机器工时 MachineHours。阶段顺序即加工顺序；产量基础须确认计量口径可比，不自动换算单位。");

        var objects = Grid(nameof(Editor.Objects), false);
        TextColumn(objects, "所属阶段", nameof(CostObjectRow.StageId)); TextColumn(objects, "成本对象", nameof(CostObjectRow.CostObject));
        TextColumn(objects, "产品名称", nameof(CostObjectRow.ProductName)); TextColumn(objects, "完工产量", nameof(CostObjectRow.OutputQuantity));
        TextColumn(objects, "本阶段新增材料（元）", nameof(CostObjectRow.DirectMaterials)); TextColumn(objects, "人工工时", nameof(CostObjectRow.LaborHours));
        TextColumn(objects, "机器工时", nameof(CostObjectRow.MachineHours));
        AddEditorTab(tabs, "2 成本对象及基础", objects,
            () => Editor.Objects.Add(new() { StageId = Editor.Stages.LastOrDefault()?.StageId ?? "" }),
            () => { if (objects.SelectedItem is CostObjectRow row) Editor.Objects.Remove(row); },
            "所有数值须明确填写，已确认无成本/工时才填0。金额最多2位；产量与工时最多4位。零费用可配零基础；非零费用配零基础会拒绝。负数和冲回暂不支持。");

        var carry = Grid(nameof(Editor.CarryIns), false);
        TextColumn(carry, "目标阶段", nameof(CostCarryRow.TargetStageId)); TextColumn(carry, "来源阶段", nameof(CostCarryRow.SourceStageId));
        TextColumn(carry, "来源对象", nameof(CostCarryRow.SourceCostObject)); TextColumn(carry, "目标对象", nameof(CostCarryRow.TargetCostObject));
        AddEditorTab(tabs, "3 整批阶段承接（可选）", carry,
            () => Editor.CarryIns.Add(new() { TargetStageId = Editor.Stages.LastOrDefault()?.StageId ?? "" }),
            () => { if (carry.SelectedItem is CostCarryRow row) Editor.CarryIns.Remove(row); },
            "来源对象全部材料、人工和制造费用一并转入目标；不能拆分或重复承接。未承接的对象视为最终整批完工。");

        var calculations = Grid(nameof(Editor.CalculationRows), true);
        foreach (var column in new[] { ("阶段", "StageId"), ("对象", "CostObject"), ("产品", "ProductName"), ("完工产量", "OutputQuantity"),
            ("直接材料", "DirectMaterials"), ("分配共用材料", "AllocatedMaterials"), ("分配人工", "AllocatedLabor"), ("分配制造费", "AllocatedOverhead"),
            ("承接材料", "CarriedMaterials"), ("承接人工", "CarriedLabor"), ("承接制造费", "CarriedOverhead"),
            ("总成本", "TotalCost"), ("单位成本（显示）", "UnitCost"), ("已转下阶段", "IsTransferredOut") })
            TextColumn(calculations, column.Item1, column.Item2, column.Item2 == "UnitCost" ? "N6" : column.Item2 is "StageId" or "CostObject" or "ProductName" or "OutputQuantity" or "IsTransferredOut" ? null : "N2");
        tabs.Items.Add(new TabItem { Header = "4 计算明细", Content = calculations });
        var allocation = Grid(nameof(Editor.AllocationRows), true);
        foreach (var column in new[] { ("阶段", "StageId"), ("对象", "Detail.CostObject"), ("成本要素", "Detail.CostElement"),
            ("分配基础", "Detail.Basis"), ("权重", "Detail.Weight"), ("费用池", "Detail.Pool"),
            ("精确分子（分×权重）", "Detail.ExactNumerator"), ("精确分母", "Detail.ExactDenominator"),
            ("截整金额", "Detail.FloorAmount"), ("尾差补分", "Detail.RemainderAdjustment"), ("最终分配", "Detail.AllocatedAmount") })
            TextColumn(allocation, column.Item1, column.Item2, column.Item2 is "Detail.Pool" or "Detail.FloorAmount" or "Detail.RemainderAdjustment" or "Detail.AllocatedAmount" ? "N2" : null);
        tabs.Items.Add(new TabItem { Header = "5 分配审核明细", Content = allocation });
        var vouchers = Grid(nameof(Editor.VoucherRows), true);
        TextColumn(vouchers, "阶段", "StageId"); TextColumn(vouchers, "对象", "CostObject"); TextColumn(vouchers, "科目语义角色（须映射）", "AccountRole");
        TextColumn(vouchers, "借方", "Debit", "N2"); TextColumn(vouchers, "贷方", "Credit", "N2");
        TextColumn(vouchers, "状态", "Status"); TextColumn(vouchers, "建议说明", "Summary"); TextColumn(vouchers, "建议唯一键", "SuggestionKey");
        tabs.Items.Add(new TabItem { Header = "6 待审核凭证建议", Content = vouchers });
        root.Children.Add(tabs); Content = root;
    }

    private void Export(bool json)
    {
        Commit();
        if (!Editor.CanExport) { MessageBox.Show("请先计算，输入变化后须重新计算。", "成本工作表"); return; }
        var dialog = new SaveFileDialog { Filter = json ? "审核工作表|*.json" : "成本明细|*.csv", DefaultExt = json ? ".json" : ".csv",
            AddExtension = true, OverwritePrompt = false, FileName = $"成本工作表-{Editor.GetCalculatedInput().WorksheetId:N}" };
        if (dialog.ShowDialog(Window.GetWindow(this)) != true) return;
        FileAction(() =>
        {
            if (json) CostWorksheetExport.SaveNewJson(dialog.FileName, Editor.GetCalculatedInput());
            else CostWorksheetExport.SaveNewCsv(dialog.FileName, Editor.GetCalculatedInput());
            MessageBox.Show("已导出新文件。未写入账套或记账。", "成本工作表");
        });
    }
    private void Import()
    {
        var dialog = new OpenFileDialog { Filter = "审核工作表|*.json", CheckFileExists = true };
        if (dialog.ShowDialog(Window.GetWindow(this)) == true)
            FileAction(() => { Commit(); Editor.Load(CostWorksheetExport.OpenJson(dialog.FileName, Editor.BookId).Input); });
    }
    private static void FileAction(Action action)
    {
        try { action(); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or CostingValidationException or DecoderFallbackException)
        { MessageBox.Show(e.Message, "未完成操作", MessageBoxButton.OK, MessageBoxImage.Warning); }
    }
    private void Commit()
    {
        foreach (var grid in grids) { grid.CommitEdit(DataGridEditingUnit.Cell, true); grid.CommitEdit(DataGridEditingUnit.Row, true); }
    }
    private DataGrid Grid(string path, bool readOnly)
    {
        var grid = new DataGrid { AutoGenerateColumns = false, IsReadOnly = readOnly, CanUserAddRows = false,
            CanUserDeleteRows = false, CanUserSortColumns = readOnly, SelectionMode = DataGridSelectionMode.Single,
            SelectionUnit = DataGridSelectionUnit.FullRow, EnableRowVirtualization = true, MinRowHeight = 28 };
        AutomationProperties.SetAutomationId(grid, path);
        grid.SetBinding(ItemsControl.ItemsSourceProperty, path); grids.Add(grid); return grid;
    }
    private static void TextColumn(DataGrid grid, string title, string path, string? format = null)
    {
        var column = new DataGridTextColumn
        { Header = title, Binding = new Binding(path) { Mode = grid.IsReadOnly ? BindingMode.OneWay : BindingMode.TwoWay,
            UpdateSourceTrigger = UpdateSourceTrigger.PropertyChanged, StringFormat = format }, MinWidth = 100 };
        if (format is not null || path is "SharedMaterials" or "DirectLabor" or "ManufacturingOverhead" or "OutputQuantity" or "DirectMaterials" or "LaborHours" or "MachineHours" or "Detail.Weight" or "Detail.ExactNumerator" or "Detail.ExactDenominator")
        {
            var display = new Style(typeof(TextBlock), column.ElementStyle);
            display.Setters.Add(new Setter(TextBlock.TextAlignmentProperty, TextAlignment.Right)); column.ElementStyle = display;
            var editing = new Style(typeof(TextBox), column.EditingElementStyle);
            editing.Setters.Add(new Setter(TextBox.TextAlignmentProperty, TextAlignment.Right)); column.EditingElementStyle = editing;
        }
        grid.Columns.Add(column);
    }
    private static void BasisColumn(DataGrid grid, string title, string path) => grid.Columns.Add(new DataGridComboBoxColumn
    { Header = title, ItemsSource = Enum.GetNames<AllocationBasis>(), SelectedItemBinding = new Binding(path)
        { Mode = BindingMode.TwoWay, UpdateSourceTrigger = UpdateSourceTrigger.PropertyChanged }, MinWidth = 150 });
    private static void Field(Panel parent, string title, string path, double width)
    {
        parent.Children.Add(new TextBlock { Text = title, VerticalAlignment = VerticalAlignment.Center, Margin = new(8, 0, 4, 0) });
        var box = new TextBox { Width = width, Padding = new(4), MaxLength = 512 };
        AutomationProperties.SetAutomationId(box, path);
        box.SetBinding(TextBox.TextProperty, new Binding(path) { UpdateSourceTrigger = UpdateSourceTrigger.PropertyChanged }); parent.Children.Add(box);
    }
    private static void Button(Panel parent, string title, Action action)
    {
        var button = new Button { Content = title, Padding = new(12, 5, 12, 5), Margin = new(0, 0, 6, 0) };
        button.Click += (_, _) => action(); parent.Children.Add(button);
    }
    private void AddEditorTab(TabControl tabs, string title, DataGrid grid, Action add, Action remove, string hint)
    {
        var panel = new DockPanel();
        var header = new StackPanel(); DockPanel.SetDock(header, Dock.Top);
        header.Children.Add(new TextBlock { Text = hint, TextWrapping = TextWrapping.Wrap, Margin = new(6) });
        var actions = new WrapPanel { Margin = new(6) };
        Button(actions, "增加行", () => { Commit(); add(); }); Button(actions, "删除所选行", () => { Commit(); remove(); });
        header.Children.Add(actions); panel.Children.Add(header); panel.Children.Add(grid);
        tabs.Items.Add(new TabItem { Header = title, Content = panel });
    }
}
