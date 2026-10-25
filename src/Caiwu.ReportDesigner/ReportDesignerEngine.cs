using System.Globalization;
using Caiwu.Reporting;
using static Caiwu.ReportDesigner.SafeFormula;

namespace Caiwu.ReportDesigner;

public static class TemplateRules
{
    internal static bool IsKey(string? key) => key is { Length: > 0 and <= 48 } && char.IsAsciiLetter(key[0]) && key.All(c => char.IsAsciiLetterOrDigit(c) || c == '_');
    public static void Validate(ReportTemplate template)
    {
        ArgumentNullException.ThrowIfNull(template);
        void Require(bool ok, string message) { if (!ok) throw DesignValidationException.One("TEMPLATE", "模板", message); }
        Require(template.SchemaVersion == 1 && template.Id != Guid.Empty && template.Version > 0, "不支持的schema或无效模板Id/版本。");
        Require(Enum.IsDefined(template.SourceKind) && Enum.IsDefined(template.Orientation), "未知来源类型或页面方向。");
        Require(template.Title is { Length: > 0 and <= 160 } && !string.IsNullOrWhiteSpace(template.Title), "标题须为1–160字符。");
        Require(template.Header is { Length: <= 500 }, "页眉上限500字符。");
        Require(template.RowsPerPage is >= 1 and <= 50, "每逻辑页行数须为1–50。");
        Require(template.Columns is { Count: >= 1 and <= 24 }, "模板须有1–24列。");
        Require(template.Columns!.All(c => c is not null), "列不能为空。");
        Require(template.Columns.Select(c => c.Key).Distinct(StringComparer.Ordinal).Count() == template.Columns.Count, "列键重复。");
        Require(template.Columns.Count(c => c.Visible) >= 1, "至少显示一列。");
        Require(template.SubtotalBy is null || IsKey(template.SubtotalBy), "小计字段键无效。");
        foreach (var column in template.Columns) {
            Require(IsKey(column.Key), "列键只能用ASCII字母数字及下划线，且以字母开头。");
            Require(column.Title is { Length: > 0 and <= 100 }, "列标题须为1–100字符。");
            Require(column.Width is >= 48 and <= 1000 && decimal.Round(column.Width, 1) == column.Width, "列宽须为48–1000 DIP，最多1位小数。");
            Require(Enum.IsDefined(column.Format), "无效数值格式。");
            Require(column.Expression is { Length: > 0 and <= 512 }, "公式长度须为1–512字符。");
            try {
                var node = Parse(column.Expression);
                if (!node.References().Any()) _ = node.Run(_ => throw new InvalidOperationException()).ToDecimal();
            }
            catch (FormulaFault ex) { throw DesignValidationException.One("FORMULA", column.Key, ex.Message, ex.Position); }
            catch (ArithmeticException ex) { throw DesignValidationException.One("PRECISION", column.Key, ex.Message, 1); }
        }
        var nodes = template.Columns.ToDictionary(c => c.Key, c => Parse(c.Expression), StringComparer.Ordinal);
        var checking = new HashSet<string>(StringComparer.Ordinal); var done = new HashSet<string>(StringComparer.Ordinal);
        void Visit(string key) {
            if (done.Contains(key)) return;
            if (!checking.Add(key)) throw DesignValidationException.One("CYCLE", key, "模板列存在循环依赖。");
            var node = nodes[key];
            // An identity [sourceKey] is contextual: the input snapshot will verify that the source actually exists.
            if (node is not Reference same || same.Key != key)
                foreach (var (dependency, _) in node.References()) if (nodes.ContainsKey(dependency)) Visit(dependency);
            checking.Remove(key); done.Add(key);
        }
        foreach (var key in nodes.Keys) Visit(key);
    }
}
public static class ReportDesignerEngine
{
    public static ReportPreview Preview(ReportInputSnapshot input, ReportTemplate template, int maxDataRows = 200)
    {
        ArgumentNullException.ThrowIfNull(input); ArgumentNullException.ThrowIfNull(template);
        template = template with { Columns = Array.AsReadOnly((template.Columns ?? throw DesignValidationException.One("TEMPLATE", "模板", "列不能为空。")).ToArray()) };
        TemplateRules.Validate(template);
        if (maxDataRows is < 1 or > 10000) throw new ArgumentOutOfRangeException(nameof(maxDataRows));
        if (input.Kind != template.SourceKind) throw DesignValidationException.One("SOURCE_KIND", "模板", "模板来源类型与当前账表不一致。");
        // The template was frozen before validation/evaluation; published previews never observe caller edits.
        var fields = input.Fields.ToDictionary(f => f.Key, StringComparer.Ordinal);
        var columns = template.Columns.ToDictionary(c => c.Key, StringComparer.Ordinal);
        var nodes = template.Columns.ToDictionary(c => c.Key, c => Parse(c.Expression), StringComparer.Ordinal);
        var textColumns = new HashSet<string>(StringComparer.Ordinal);
        var visiting = new HashSet<string>(StringComparer.Ordinal); var done = new HashSet<string>(StringComparer.Ordinal);
        bool Check(string key)
        {
            if (done.Contains(key)) return textColumns.Contains(key);
            if (!visiting.Add(key)) throw DesignValidationException.One("CYCLE", key, "列公式存在循环依赖。");
            var node = nodes[key];
            var text = node is Reference direct && fields.TryGetValue(direct.Key, out var f) && !f.Numeric;
            if (fields.ContainsKey(key) && (node is not Reference same || same.Key != key))
                throw DesignValidationException.One("SHADOW", key, "计算列不能覆盖来源字段键，请使用新的列键。");
            foreach (var reference in node.References()) {
                bool numeric;
                if (fields.TryGetValue(reference.Key, out var field)) numeric = field.Numeric;
                else if (columns.ContainsKey(reference.Key)) numeric = !Check(reference.Key);
                else throw DesignValidationException.One("FIELD_MISSING", key, $"缺少字段 [{reference.Key}]。", reference.At + 1);
                if (!numeric && !text) throw DesignValidationException.One("FIELD_TYPE", key, $"文本字段 [{reference.Key}] 不能参与数值公式。", reference.At + 1);
            }
            if (text && columns[key].Total) throw DesignValidationException.One("TOTAL_TYPE", key, "文本列不能求合计。");
            visiting.Remove(key); done.Add(key); if (text) textColumns.Add(key); return text;
        }
        foreach (var key in columns.Keys) Check(key);
        if (template.SubtotalBy is { } groupKey && (!fields.TryGetValue(groupKey, out var groupField) || groupField.Numeric))
            throw DesignValidationException.One("GROUP_FIELD", groupKey, "小计只能选择当前来源的文本字段。");
        var visible = template.Columns.Where(c => c.Visible).ToArray();
        var selected = input.Rows.Take(maxDataRows).Select((r, i) => (Row: r, Index: i + 1)).ToArray();
        var grouped = template.SubtotalBy is { } by
            ? selected.GroupBy(r => (string)r.Row.Values[by], StringComparer.Ordinal).Select(g => (Label: g.Key, Data: g.ToArray())).ToArray()
            : [(Label: "", Data: selected)];
        var results = new List<PreviewRow>(); var totals = new Dictionary<string, Rational>();
        foreach (var c in visible.Where(c => c.Total)) totals[c.Key] = Rational.Zero;
        foreach (var group in grouped) {
            var subtotals = totals.Keys.ToDictionary(k => k, _ => Rational.Zero, StringComparer.Ordinal);
            foreach (var item in group.Data) {
                var cache = new Dictionary<string, decimal>(StringComparer.Ordinal);
                decimal Value(string key) {
                    if (cache.TryGetValue(key, out var value)) return value;
                    if (fields.ContainsKey(key)) return (decimal)item.Row.Values[key];
                    try { value = nodes[key].Run(k => Rational.FromDecimal(Value(k))).ToDecimal(); cache[key] = value; return value; }
                    catch (FormulaFault ex) { throw DesignValidationException.One("EVALUATION", key, ex.Message, ex.Position, item.Index); }
                    catch (ArithmeticException ex) { throw DesignValidationException.One("PRECISION", key, ex.Message, nodes[key].At + 1, item.Index); }
                }
                // Hidden columns remain validated/evaluated: a template cannot hide an error.
                foreach (var c in template.Columns.Where(c => !textColumns.Contains(c.Key))) _ = Value(c.Key);
                var cells = new List<PreviewCell>();
                foreach (var c in visible) {
                    if (textColumns.Contains(c.Key)) { var reference = (Reference)nodes[c.Key]; cells.Add(new((string)item.Row.Values[reference.Key], null)); continue; }
                    decimal value;
                    try {
                        // Identity source columns and computed columns share decimal checks.
                        value = Value(c.Key);
                        if (item.Row.IncludeInTotals && c.Total) { totals[c.Key] += Rational.FromDecimal(value); subtotals[c.Key] += Rational.FromDecimal(value); }
                    }
                    catch (ArithmeticException ex) { throw DesignValidationException.One("TOTAL_OVERFLOW", c.Key, ex.Message, row: item.Index); }
                    cells.Add(new(value.ToString(c.Format.ToString(), CultureInfo.InvariantCulture), value));
                }
                results.Add(new(cells.AsReadOnly()));
            }
            if (template.SubtotalBy is not null) results.Add(Summary(visible, subtotals, "subtotal", "小计：" + group.Label));
        }
        if (totals.Count > 0) results.Add(Summary(visible, totals, "total", "合计（逐行数值求和）"));
        return new(input, template, visible, results, selected.Length);
    }
    private static PreviewRow Summary(TemplateColumn[] columns, Dictionary<string, Rational> totals, string kind, string label)
    {
        var cells = new List<PreviewCell>();
        foreach (var c in columns) {
            if (!totals.TryGetValue(c.Key, out var rational)) { cells.Add(new("", null)); continue; }
            try { var n = rational.ToDecimal(); cells.Add(new(n.ToString(c.Format.ToString(), CultureInfo.InvariantCulture), n)); }
            catch (ArithmeticException ex) { throw DesignValidationException.One("TOTAL_OVERFLOW", c.Key, ex.Message); }
        }
        return new(cells.AsReadOnly(), kind, label);
    }
}
