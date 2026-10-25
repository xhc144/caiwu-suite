using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Caiwu.Costing;

/// <summary>Audit exports only; no database connection, automatic posting or overwrite.</summary>
public static class CostWorksheetExport
{
    public const int MaximumJsonBytes = 4 * 1024 * 1024;
    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 32,
        RespectRequiredConstructorParameters = true,
        AllowDuplicateProperties = false,
        Converters = { new ExactDecimalConverter(), new JsonStringEnumConverter(allowIntegerValues: false) }
    };

    public static string ToJson(CostWorksheet input)
    {
        var json = JsonSerializer.Serialize(new CostWorksheetReport(1, new CostWorksheetService().Calculate(input)), Options);
        CostMath.Require(Encoding.UTF8.GetByteCount(json) + 3 <= MaximumJsonBytes, "审核JSON超过4MiB，请拆分工作表。");
        return json;
    }

    /// <summary>Recalculates all imported input, rejects mismatching calculation data. Hash is not a signature.</summary>
    public static CostWorksheetCalculation FromJson(string json, Guid expectedBookId)
    {
        CostMath.Require(json is not null && Encoding.UTF8.GetByteCount(json) <= MaximumJsonBytes, "工作表文件为空或超过4MiB。");
        CostMath.Require(expectedBookId != Guid.Empty, "必须指定当前账套。");
        try
        {
            var report = JsonSerializer.Deserialize<CostWorksheetReport>(json, Options);
            CostMath.Require(report is not null && report.SchemaVersion == 1 && report.Calculation?.Input is not null, "工作表格式/版本无效。");
            CostMath.Require(report.Calculation.Input.BookId == expectedBookId, "导入工作表不属于当前账套。");
            var recalculated = new CostWorksheetService().Calculate(report.Calculation.Input);
            using var provided = JsonDocument.Parse(json, new JsonDocumentOptions { AllowDuplicateProperties = false, MaxDepth = 32 });
            var expected = JsonSerializer.SerializeToElement(new CostWorksheetReport(1, recalculated), Options);
            CostMath.Require(JsonElement.DeepEquals(expected, provided.RootElement), "工作表计算明细与重新计算结果不一致。");
            return recalculated;
        }
        catch (JsonException) { throw new CostingValidationException("工作表JSON格式无效，不能导入。"); }
    }

    public static string ToCsv(CostWorksheet input)
    {
        var result = new CostWorksheetService().Calculate(input);
        var csv = new StringBuilder();
        Row("类型", "工作表", "账套", "日期", "制表人", "来源依据", "计算方式", "输入SHA256");
        Row("元数据", input.WorksheetId, input.BookId, input.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            input.PreparedBy, input.SourceReference, input.PolicyVersion, result.InputFingerprint);
        Row("类型", "阶段", "对象", "产品", "产量", "本阶段直接材料", "本阶段共用材料", "本阶段人工", "本阶段制造费用", "承接材料", "承接人工", "承接制造费用", "成本合计", "显示单位成本", "已转下阶段", "人工基础", "制造费用基础", "人工工时", "机器工时", "材料基础");
        foreach (var stage in result.Stages)
        {
            var source = result.Input.Stages.Single(s => s.StageId == stage.StageId);
            foreach (var obj in stage.Objects)
            {
                var item = source.Objects.Single(o => o.CostObject == obj.CostObject);
                Row("成本明细", stage.StageId, obj.CostObject, obj.ProductName, obj.OutputQuantity,
                    Money(obj.DirectMaterials), Money(obj.AllocatedMaterials), Money(obj.AllocatedLabor), Money(obj.AllocatedOverhead), Money(obj.CarriedMaterials),
                    Money(obj.CarriedLabor), Money(obj.CarriedOverhead), Money(obj.TotalCost), obj.UnitCost, obj.IsTransferredOut,
                    source.LaborBasis, source.OverheadBasis, item.LaborHours, item.MachineHours, source.MaterialBasis);
            }
            Row("类型", "阶段", "对象", "成本要素", "基础", "权重", "费用池", "精确分子（分×整数权重）", "精确分母（整数权重）", "截整金额", "尾差补分", "分配金额");
            foreach (var trace in stage.AllocationDetails)
                Row("分配审计", stage.StageId, trace.CostObject, trace.CostElement, trace.Basis, trace.Weight, Money(trace.Pool),
                    trace.ExactNumerator, trace.ExactDenominator, Money(trace.FloorAmount), Money(trace.RemainderAdjustment), Money(trace.AllocatedAmount));
            foreach (var carry in source.CarryIns)
                Row("整批承接", carry.SourceStageId, carry.SourceCostObject, stage.StageId, carry.TargetCostObject);
        }
        Row("总额校验", "外部投入", Money(result.ExternalCost), "最终完工", Money(result.FinishedCost));
        Row("类型", "建议唯一键", "状态", "说明", "阶段", "对象", "科目语义角色（须人工映射）", "借方", "贷方");
        foreach (var suggestion in result.VoucherSuggestions)
            foreach (var line in suggestion.Lines)
                Row("凭证建议", suggestion.SuggestionKey, suggestion.Status, suggestion.Summary, line.StageId, line.CostObject,
                    line.AccountRole, Money(line.Debit), Money(line.Credit));
        return csv.ToString();

        void Row(params object[] cells) => csv.AppendLine(string.Join(',', cells.Select(c => Escape(
            c is IFormattable f ? f.ToString(null, CultureInfo.InvariantCulture) : c.ToString() ?? ""))));
    }

    public static void SaveNewJson(string path, CostWorksheet input) => SaveNew(path, ".json", ToJson(input));
    public static void SaveNewCsv(string path, CostWorksheet input) => SaveNew(path, ".csv", ToCsv(input));

    public static CostWorksheetCalculation OpenJson(string path, Guid expectedBookId)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        CostMath.Require(stream.Length <= MaximumJsonBytes, "工作表文件超过4MiB。");
        var bytes = new byte[checked((int)stream.Length)];
        stream.ReadExactly(bytes);
        var offset = bytes.AsSpan().StartsWith(new byte[] { 0xEF, 0xBB, 0xBF }) ? 3 : 0;
        return FromJson(new UTF8Encoding(false, true).GetString(bytes, offset, bytes.Length - offset), expectedBookId);
    }

    private sealed class ExactDecimalConverter : JsonConverter<decimal>
    {
        public override decimal Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options)
        {
            using var document = JsonDocument.ParseValue(ref reader);
            var token = document.RootElement.GetRawText();
            var point = token.IndexOf('.');
            if (token.Contains('e', StringComparison.OrdinalIgnoreCase) ||
                (point >= 0 && token[(point + 1)..].TrimEnd('0').Length > 6) ||
                !decimal.TryParse(token, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint,
                    CultureInfo.InvariantCulture, out var value))
                throw new JsonException("不支持的金额或精度。");
            return value;
        }
        public override void Write(Utf8JsonWriter writer, decimal value, JsonSerializerOptions options) =>
            writer.WriteRawValue(value.ToString("G29", CultureInfo.InvariantCulture));
    }

    private static string Money(decimal value) => value.ToString("F2", CultureInfo.InvariantCulture);
    private static string Escape(string value)
    {
        // Quoting alone does not prevent spreadsheet formula evaluation.
        if (value.TrimStart().StartsWith('=') || value.TrimStart().StartsWith('+') ||
            value.TrimStart().StartsWith('-') || value.TrimStart().StartsWith('@')) value = "'" + value;
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }

    private static void SaveNew(string path, string extension, string content)
    {
        CostMath.Require(string.Equals(Path.GetExtension(path), extension, StringComparison.OrdinalIgnoreCase), "导出文件扩展名不匹配。");
        var target = Path.GetFullPath(path);
        var temporary = target + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            using (var writer = new StreamWriter(file, new UTF8Encoding(true))) writer.Write(content);
            File.Move(temporary, target, overwrite: false);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
