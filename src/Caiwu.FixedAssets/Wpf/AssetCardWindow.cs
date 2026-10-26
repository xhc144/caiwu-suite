using System.Collections.ObjectModel;
using System.Collections.Immutable;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Documents;

namespace Caiwu.FixedAssets.Wpf;

/// <summary>
/// Original outer dw_1/buttons/hints retain known bounds. Inner DataWindow field coordinates are absent from the evidence;
/// a functional field editor is provided for module review, with its exact inner layout explicitly pending parity acceptance.
/// </summary>
public sealed class AssetCardWindow : AssetOriginalModal
{
    public sealed class Field(string key, string caption, string value, bool readOnly = false)
    {
        public string Key { get; } = key;
        public string Caption { get; } = caption;
        public string Value { get; set; } = value;
        public bool ReadOnly { get; } = readOnly;
    }
    private readonly ObservableCollection<Field> fields = [];
    private readonly DataGrid grid;
    private ImmutableArray<AssetAccessory> accessories;
    public AssetCard? Result { get; private set; }
    public AssetCardWindow(AssetBookService service, Guid? assetId = null) : base("w_zcgl_kp", "固定资产卡片", 2738, 1632)
    {
        Width = 970; Height = 650;
        var snapshot = service.Read(); var date = snapshot.NextDepreciationPeriod.FirstDay;
        var old = assetId is { } id ? snapshot.Cards[id] : null;
        var card = old ?? new AssetCard { Code = "", Name = "", CategoryCode = "", StatusCode = "", DepartmentCode = "", PurposeCode = "",
            PurchaseDate = date, UseDate = date, OriginalCost = 0, UsefulLifeMonths = 12 };
        accessories = card.Accessories;
        void Text(string key, string caption, string value, bool financial = false) => fields.Add(new(key, caption, value, old is not null && financial));
        void Number(string key, string caption, decimal value, bool financial = true) => Text(key, caption, value.ToString(CultureInfo.CurrentCulture), financial);
        Text("bh", "设备编号*", card.Code); Text("mc", "设备名称*", card.Name);
        Text("sblb", "类别代码*", card.CategoryCode, true); Text("sbzt", "状态代码*", card.StatusCode);
        Text("sydw", "使用部门代码*", card.DepartmentCode, true);
        Text("gzrq", "购置日期 yyyy-MM-dd*", card.PurchaseDate.ToString("yyyy-MM-dd"), true);
        Number("yz", "原值*", card.OriginalCost); Number("czl", "残值率(%)", card.ResidualRate * 100);
        Number("yzcz", "预计残值", card.ResidualValue); Text("syrq", "使用日期 yyyy-MM-dd*", card.UseDate.ToString("yyyy-MM-dd"), true);
        Number("zjff", "折旧方法*（1平均年限 / 2工作量）", (int)card.Method); Number("synx", "使用年限(月)*", card.UsefulLifeMonths);
        Number("zgzl", "总工作量", card.TotalWorkload); Text("bz", "规格型号", card.Specification);
        Text("ytbh", "用途代码*", card.PurposeCode, true); Number("ygzl", "月工作量", card.MonthlyWorkload);
        Number("yzje", "月折旧额", card.MonthlyDepreciation); Number("ljzjy", "累计折旧月", card.DepreciatedMonths);
        Number("ljgzl", "累计工作量", card.AccumulatedWorkload); Number("ljzje", "累计折旧额", card.AccumulatedDepreciation);
        Text("bjbh", "本机编号", card.MachineNumber); Text("wbbz", "外币币种", card.CurrencyCode);
        Text("wbje", "外币金额（留空表示NULL）", card.ForeignAmount?.ToString(CultureInfo.CurrentCulture) ?? "");
        Text("zccm", "制造厂名", card.Manufacturer); Text("azdd", "安装地点", card.Location, true);
        Text("zcrq", "制造日期 yyyy-MM-dd", card.ManufactureDate?.ToString("yyyy-MM-dd") ?? "");
        Text("dw", "单位", card.Unit); Number("sl", "数量", card.Quantity, false); Text("ckbh", "参考编号", card.ReferenceNumber);
        grid = Put(new DataGrid { ItemsSource = fields, AutoGenerateColumns = false, CanUserAddRows = false, FontSize = 43, RowHeight = 80 },
            "dw_1", 27, 8, 2670, 1188);
        grid.Columns.Add(new DataGridTextColumn { Header = "项目", Binding = new Binding(nameof(Field.Caption)), IsReadOnly = true, Width = 1150 });
        grid.Columns.Add(new DataGridTextColumn { Header = "内容", Binding = new Binding(nameof(Field.Value)) { UpdateSourceTrigger = UpdateSourceTrigger.LostFocus }, Width = 1400 });
        grid.BeginningEdit += (_, e) => { if (e.Row.Item is Field { ReadOnly: true }) e.Cancel = true; };
        Action("cb_1", "确定", 919, 1228, 247, 100, () =>
        {
            CommitGrid();
            var next = Draft(card) with { Accessories = accessories };
            Result = old is null ? service.AddCard(snapshot.Revision, next, snapshot.NextDepreciationPeriod.LastDay) :
                service.UpdateCard(snapshot.Revision, next, snapshot.NextDepreciationPeriod.FirstDay);
            DialogResult = true;
        }).IsDefault = true;
        Action("cb_2", "取消", 1701, 1228, 247, 100, () => DialogResult = false).IsCancel = true;
        Action("cb_3", "附属设备...", 1234, 1228, 393, 100, () =>
        {
            var editor = new AssetAccessoryWindow(accessories) { Owner = this };
            if (editor.ShowDialog() == true) accessories = editor.Result;
        });
        Action("cb_4", "打印", 594, 1228, 247, 100, () =>
        {
            CommitGrid(); var dialog = new PrintDialog();
            if (dialog.ShowDialog() != true) return;
            var document = new FlowDocument { FontSize = 12, PageWidth = dialog.PrintableAreaWidth,
                PageHeight = dialog.PrintableAreaHeight, ColumnWidth = dialog.PrintableAreaWidth };
            document.Blocks.Add(new Paragraph(new Run("固定资产卡片")) { FontSize = 20 });
            foreach (var field in fields) document.Blocks.Add(new Paragraph(new Run($"{field.Caption}：{field.Value}")));
            foreach (var item in accessories) document.Blocks.Add(new Paragraph(new Run($"附属设备 {item.Code} {item.Name} 数量 {item.Quantity} 金额 {item.Amount:N2}")));
            dialog.PrintDocument(((IDocumentPaginatorSource)document).DocumentPaginator, "固定资产卡片");
        });
        Label("st_1", "温馨提示：1.使用日期 所填的时间，当月不计提折旧，次月开始自动计提；", 165, 1364, 1975, 72);
        Label("st_2", "2.凡是带*号的都必须填选，否则将影响后面的自动计提折旧。", 439, 1428, 1632, 60);
    }
    private void CommitGrid() { grid.CommitEdit(DataGridEditingUnit.Cell, true); grid.CommitEdit(DataGridEditingUnit.Row, true); }
    private AssetCard Draft(AssetCard original)
    {
        string S(string key) => fields.Single(x => x.Key == key).Value;
        decimal N(string key) => decimal.Parse(S(key), NumberStyles.Number, CultureInfo.CurrentCulture);
        int I(string key) => int.Parse(S(key), NumberStyles.Integer, CultureInfo.CurrentCulture);
        DateOnly D(string key) => DateOnly.ParseExact(S(key), "yyyy-MM-dd", CultureInfo.InvariantCulture);
        return original with { Code = S("bh"), Name = S("mc"), CategoryCode = S("sblb"), StatusCode = S("sbzt"), DepartmentCode = S("sydw"),
            PurchaseDate = D("gzrq"), OriginalCost = N("yz"), ResidualRate = N("czl") / 100, ResidualValue = N("yzcz"), UseDate = D("syrq"),
            Method = (AssetDepreciationMethod)I("zjff"), UsefulLifeMonths = I("synx"), TotalWorkload = N("zgzl"), Specification = S("bz"),
            PurposeCode = S("ytbh"), MonthlyWorkload = N("ygzl"), MonthlyDepreciation = N("yzje"), DepreciatedMonths = I("ljzjy"),
            AccumulatedWorkload = N("ljgzl"), AccumulatedDepreciation = N("ljzje"), MachineNumber = S("bjbh"), CurrencyCode = S("wbbz"),
            ForeignAmount = S("wbje") == "" ? null : N("wbje"), Manufacturer = S("zccm"), Location = S("azdd"),
            ManufactureDate = S("zcrq") == "" ? null : D("zcrq"), Unit = S("dw"), Quantity = N("sl"), ReferenceNumber = S("ckbh") };
    }
}

public sealed class AssetAccessoryWindow : AssetOriginalModal
{
    public sealed class Row(AssetAccessory source)
    {
        public string Code { get; set; } = source.Code;
        public string Name { get; set; } = source.Name;
        public decimal Quantity { get; set; } = source.Quantity;
        public decimal UnitPrice { get; set; } = source.UnitPrice;
        public decimal Amount { get; set; } = source.Amount;
        public string Description { get; set; } = source.Description;
        public ImmutableArray<OriginalRow> OriginalRows { get; } = source.OriginalRows;
        public AssetAccessory ToAccessory() => new(Code, Name, Quantity, UnitPrice, Amount, Description, OriginalRows);
    }
    public ImmutableArray<AssetAccessory> Result { get; private set; }
    public AssetAccessoryWindow(ImmutableArray<AssetAccessory> source) : base("w_zcgl_kp_fssb", "附属设备清单", 3232, 1180)
    {
        Width = 1050; Height = 470; Result = source;
        var rows = new ObservableCollection<Row>(source.Select(x => new Row(x)));
        var grid = Put(new DataGrid { ItemsSource = rows, AutoGenerateColumns = false, CanUserAddRows = false, FontSize = 44, RowHeight = 80 },
            "dw_1", 18, 24, 3154, 904);
        foreach (var (caption, property, width) in new[] { ("编号", "Code", 360d), ("名称", "Name", 680d), ("数量", "Quantity", 350d),
            ("单价", "UnitPrice", 400d), ("金额", "Amount", 400d), ("说明", "Description", 850d) })
            grid.Columns.Add(new DataGridTextColumn { Header = caption, Binding = new Binding(property), Width = width });
        Action("cb_1", "增加", 855, 964, 247, 96, () => rows.Add(new(new("", "", 1, 0, 0, "", []))));
        Action("cb_2", "删除", 1179, 964, 247, 96, () => { if (grid.SelectedItem is Row row) rows.Remove(row); });
        Action("cb_3", "确定", 1504, 964, 247, 96, () =>
        {
            if (!grid.CommitEdit(DataGridEditingUnit.Cell, true) || !grid.CommitEdit(DataGridEditingUnit.Row, true))
                throw new FormatException("请检查附属设备数据。");
            Result = rows.Select(x => x.ToAccessory()).ToImmutableArray();
            if (Result.Any(x => string.IsNullOrWhiteSpace(x.Code) || string.IsNullOrWhiteSpace(x.Name) || x.Quantity < 0 || x.UnitPrice < 0 || x.Amount < 0) ||
                Result.Select(x => x.Code).Distinct(StringComparer.Ordinal).Count() != Result.Length) throw new FormatException("附属设备编号、名称、数量或金额不正确。");
            DialogResult = true;
        }).IsDefault = true;
        Action("cb_4", "取消", 1829, 964, 247, 96, () => DialogResult = false).IsCancel = true;
    }
}
