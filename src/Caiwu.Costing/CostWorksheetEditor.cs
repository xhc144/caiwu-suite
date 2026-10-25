using System.Collections.ObjectModel;
using System.Collections.Specialized;
using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;

namespace Caiwu.Costing;

public abstract class CostEditorRow : INotifyPropertyChanged
{
    private readonly Dictionary<string, string> values = [];
    public event PropertyChangedEventHandler? PropertyChanged;
    protected string Get([CallerMemberName] string key = "") => values.GetValueOrDefault(key, "");
    protected void Set(string value, [CallerMemberName] string key = "")
    {
        if (Get(key) == value) return;
        values[key] = value;
        PropertyChanged?.Invoke(this, new(key));
    }
}
public sealed class CostStageRow : CostEditorRow
{
    public CostStageRow() { MaterialBasis = AllocationBasis.OutputQuantity.ToString(); LaborBasis = AllocationBasis.OutputQuantity.ToString(); OverheadBasis = AllocationBasis.OutputQuantity.ToString(); }
    public string StageId { get => Get(); set => Set(value); }
    public string Name { get => Get(); set => Set(value); }
    public string SharedMaterials { get => Get(); set => Set(value); }
    public string MaterialBasis { get => Get(); set => Set(value); }
    public string DirectLabor { get => Get(); set => Set(value); }
    public string ManufacturingOverhead { get => Get(); set => Set(value); }
    public string LaborBasis { get => Get(); set => Set(value); }
    public string OverheadBasis { get => Get(); set => Set(value); }
}
public sealed class CostObjectRow : CostEditorRow
{
    public string StageId { get => Get(); set => Set(value); }
    public string CostObject { get => Get(); set => Set(value); }
    public string ProductName { get => Get(); set => Set(value); }
    public string OutputQuantity { get => Get(); set => Set(value); }
    public string DirectMaterials { get => Get(); set => Set(value); }
    public string LaborHours { get => Get(); set => Set(value); }
    public string MachineHours { get => Get(); set => Set(value); }
}
public sealed class CostCarryRow : CostEditorRow
{
    public string TargetStageId { get => Get(); set => Set(value); }
    public string SourceStageId { get => Get(); set => Set(value); }
    public string SourceCostObject { get => Get(); set => Set(value); }
    public string TargetCostObject { get => Get(); set => Set(value); }
}
public sealed record WorksheetAllocationDisplay(string StageId, PoolAllocationDetail Detail);
public sealed record WorksheetVoucherDisplay(string SuggestionKey, string Summary, CostVoucherStatus Status,
    string StageId, string CostObject, CostAccountRole AccountRole, decimal Debit, decimal Credit);

/// <summary>Framework independent editor, shared by WPF and synthetic interaction tests.</summary>
public sealed class CostWorksheetEditor : INotifyPropertyChanged
{
    private readonly Guid bookId;
    private Guid worksheetId = Guid.NewGuid();
    private string dateText, preparedBy = "", sourceReference = "", status = "输入已审核的成本来源，填写阶段与对象后计算。";
    private bool loading;
    private readonly HashSet<CostEditorRow> observed = [];
    public CostWorksheetEditor(Guid bookId, DateOnly date)
    {
        CostMath.Require(bookId != Guid.Empty, "当前账套标识不能为空。");
        this.bookId = bookId; dateText = date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        Stages.CollectionChanged += RowsChanged; Objects.CollectionChanged += RowsChanged; CarryIns.CollectionChanged += RowsChanged;
    }
    public Guid BookId => bookId;
    public string DateText { get => dateText; set { dateText = value; Invalidate(); Changed(); } }
    public string PreparedBy { get => preparedBy; set { preparedBy = value; Invalidate(); Changed(); } }
    public string SourceReference { get => sourceReference; set { sourceReference = value; Invalidate(); Changed(); } }
    public string Status { get => status; private set { status = value; Changed(); } }
    public ObservableCollection<CostStageRow> Stages { get; } = [];
    public ObservableCollection<CostObjectRow> Objects { get; } = [];
    public ObservableCollection<CostCarryRow> CarryIns { get; } = [];
    public CostWorksheetCalculation? Result { get; private set; }
    public bool CanExport => Result is not null;
    public IReadOnlyList<CostObjectCalculation> CalculationRows => Result is null ? [] : Result.Stages.SelectMany(s => s.Objects).ToArray();
    public IReadOnlyList<WorksheetVoucherDisplay> VoucherRows => Result is null ? [] : Result.VoucherSuggestions.SelectMany(s => s.Lines.Select(l =>
        new WorksheetVoucherDisplay(s.SuggestionKey, s.Summary, s.Status, l.StageId, l.CostObject, l.AccountRole, l.Debit, l.Credit))).ToArray();
    public IReadOnlyList<WorksheetAllocationDisplay> AllocationRows => Result is null ? [] : Result.Stages.SelectMany(s =>
        s.AllocationDetails.Select(d => new WorksheetAllocationDisplay(s.StageId, d))).ToArray();
    public event PropertyChangedEventHandler? PropertyChanged;

    public bool Calculate()
    {
        Invalidate();
        try
        {
            Result = new CostWorksheetService().Calculate(BuildInput());
            Status = $"计算通过：外部投入 {Result.ExternalCost:F2} 元；最终完工 {Result.FinishedCost:F2} 元。{Result.VoucherSuggestions.Count} 份待审核建议；未记账。";
            ResultChanged(); return true;
        }
        catch (CostingValidationException e) { Status = e.Message; return false; }
    }

    public CostWorksheet GetCalculatedInput()
    {
        CostMath.Require(Result is not null, "输入已变化或尚未计算，请先重新计算。");
        return Result.Input;
    }

    public void Load(CostWorksheet input)
    {
        CostMath.Require(input.BookId == bookId, "工作表不属于当前账套。");
        new CostWorksheetService().Calculate(input);
        loading = true;
        try
        {
            worksheetId = input.WorksheetId; DateText = input.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            PreparedBy = input.PreparedBy; SourceReference = input.SourceReference;
            Stages.Clear(); Objects.Clear(); CarryIns.Clear();
            foreach (var s in input.Stages)
            {
                Stages.Add(new() { StageId = s.StageId, Name = s.Name, SharedMaterials = Number(s.SharedMaterials), MaterialBasis = s.MaterialBasis.ToString(), DirectLabor = Number(s.DirectLabor), ManufacturingOverhead = Number(s.ManufacturingOverhead), LaborBasis = s.LaborBasis.ToString(), OverheadBasis = s.OverheadBasis.ToString() });
                foreach (var o in s.Objects) Objects.Add(new() { StageId = s.StageId, CostObject = o.CostObject, ProductName = o.ProductName,
                    OutputQuantity = Number(o.OutputQuantity), DirectMaterials = Number(o.DirectMaterials), LaborHours = Number(o.LaborHours), MachineHours = Number(o.MachineHours) });
                foreach (var c in s.CarryIns) CarryIns.Add(new() { TargetStageId = s.StageId, SourceStageId = c.SourceStageId, SourceCostObject = c.SourceCostObject, TargetCostObject = c.TargetCostObject });
            }
        }
        finally { loading = false; }
        Invalidate(); Status = "已载入输入，请复算后查看或导出建议。";
    }

    public void LoadSyntheticExample() => Load(new(Guid.NewGuid(), bookId,
        DateOnly.TryParseExact(DateText, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day) ? day : new(2026, 10, 1),
        "合成制表人", "合成样例：材料A60/B40、人工80、制造费40；第二阶段增加30", CostWorksheetService.PolicyVersion,
        [new("S1", "完工半成品", AllocationBasis.LaborHours, AllocationBasis.MachineHours, 80, 40,
            [new("A", "合成产品甲", 2, 60, 1, 3), new("B", "合成产品乙", 4, 40, 3, 1)], []),
         new("S2", "整批合并加工", AllocationBasis.OutputQuantity, AllocationBasis.OutputQuantity, 20, 0,
            [new("C", "合成成品", 5, 10, 0, 0)], [new("S1", "A", "C"), new("S1", "B", "C")])]));

    private CostWorksheet BuildInput()
    {
        CostMath.Require(DateOnly.TryParseExact(DateText, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date), "日期须为yyyy-MM-dd。");
        CostMath.Require(Stages.Count <= CostWorksheetService.MaximumStages && Objects.Count <= CostWorksheetService.MaximumObjects &&
            CarryIns.Count <= CostWorksheetService.MaximumObjects, "编辑行数超限。");
        var ids = Stages.Select(s => s.StageId).ToHashSet(StringComparer.Ordinal);
        CostMath.Require(Objects.All(o => ids.Contains(o.StageId)) && CarryIns.All(c => ids.Contains(c.TargetStageId)), "对象或承接的目标阶段不存在。");
        return new(worksheetId, bookId, date, PreparedBy, SourceReference, CostWorksheetService.PolicyVersion,
            Stages.Select(s => new CostStageInput(s.StageId, s.Name, Basis(s.LaborBasis), Basis(s.OverheadBasis),
                Parse(s.DirectLabor, "阶段人工"), Parse(s.ManufacturingOverhead, "阶段制造费用"),
                Objects.Where(o => o.StageId == s.StageId).Select(o => new CostObjectInput(o.CostObject, o.ProductName,
                    Parse(o.OutputQuantity, "产量", 4), Parse(o.DirectMaterials, "材料成本"), Parse(o.LaborHours, "人工工时", 4), Parse(o.MachineHours, "机器工时", 4))).ToArray(),
                CarryIns.Where(c => c.TargetStageId == s.StageId).Select(c => new StageCarryInput(c.SourceStageId, c.SourceCostObject, c.TargetCostObject)).ToArray(), Parse(s.SharedMaterials, "共用材料"), Basis(s.MaterialBasis))).ToArray());
    }
    private static decimal Parse(string text, string label, int precision = 2)
    {
        CostMath.Require(text is not null, $"{label}不能为空。");
        var point = text.IndexOf('.');
        CostMath.Require(point < 0 || text[(point + 1)..].TrimEnd('0').Length <= precision, $"{label}最多{precision}位有效小数。不要依赖输入舍入。");
        CostMath.Require(decimal.TryParse(text, NumberStyles.AllowDecimalPoint | NumberStyles.AllowLeadingSign,
            CultureInfo.InvariantCulture, out var number), $"{label}须为十进制数，使用小数点；不能留空、使用千分位或科学计数法。");
        return number;
    }
    private static AllocationBasis Basis(string text)
    {
        CostMath.Require(Enum.TryParse<AllocationBasis>(text, out var basis) && Enum.IsDefined(basis) && basis.ToString() == text, "请选择有效的分配基础。");
        return basis;
    }
    private static string Number(decimal value) => value.ToString("G29", CultureInfo.InvariantCulture);
    private void RowsChanged(object? sender, NotifyCollectionChangedEventArgs e)
    {
        var current = Stages.Cast<CostEditorRow>().Concat(Objects).Concat(CarryIns).ToHashSet();
        foreach (var row in observed.Except(current).ToArray()) { row.PropertyChanged -= RowChanged; observed.Remove(row); }
        foreach (var row in current.Except(observed)) { row.PropertyChanged += RowChanged; observed.Add(row); }
        Invalidate();
    }
    private void RowChanged(object? sender, PropertyChangedEventArgs e) => Invalidate();
    private void Invalidate()
    {
        if (loading) return;
        Result = null; Status = "输入已变化，请重新计算。"; ResultChanged();
    }
    private void ResultChanged() { Changed(nameof(Result)); Changed(nameof(CanExport)); Changed(nameof(CalculationRows)); Changed(nameof(VoucherRows)); Changed(nameof(AllocationRows)); }
    private void Changed([CallerMemberName] string name = "") => PropertyChanged?.Invoke(this, new(name));
}
