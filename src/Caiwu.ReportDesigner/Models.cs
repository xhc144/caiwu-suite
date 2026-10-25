using System.Collections.ObjectModel;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Caiwu.Reporting;

namespace Caiwu.ReportDesigner;

public enum NumberFormat { F2, F4, F6, N2, N4, N6 }
public enum PageOrientation { Portrait, Landscape }
public sealed record TemplateColumn(string Key, string Title, string Expression, decimal Width = 110,
    NumberFormat Format = NumberFormat.F2, bool Visible = true, bool Total = false);
public sealed record ReportTemplate
{
    [JsonRequired] public int SchemaVersion { get; init; } = 1;
    [JsonRequired] public Guid Id { get; init; } = Guid.NewGuid();
    [JsonRequired] public long Version { get; init; } = 1;
    [JsonRequired] public ReportKind SourceKind { get; init; }
    [JsonRequired] public string Title { get; init; } = "自定义账表";
    [JsonRequired] public string Header { get; init; } = "";
    [JsonRequired] public PageOrientation Orientation { get; init; } = PageOrientation.Landscape;
    [JsonRequired] public int RowsPerPage { get; init; } = 18;
    public string? SubtotalBy { get; init; }
    [JsonRequired] public IReadOnlyList<TemplateColumn> Columns { get; init; } = [];
}
public sealed record DesignIssue(string Code, string Column, int? Row, int? Position, string Message)
{
    public override string ToString() => $"{Code} 列 {Column}" + (Row is null ? "" : $"，数据行 {Row}") +
        (Position is null ? "" : $"，字符 {Position}") + $"：{Message}";
}
public sealed class DesignValidationException : Exception
{
    public IReadOnlyList<DesignIssue> Issues { get; }
    public DesignValidationException(IEnumerable<DesignIssue> issues) : base(string.Join("\n", issues)) =>
        Issues = Array.AsReadOnly(issues.ToArray());
    internal static DesignValidationException One(string code, string column, string message, int? position = null, int? row = null) =>
        new([new(code, column, row, position, message)]);
}
public sealed record SourceField(string Key, string Title, bool Numeric);
internal sealed record InputRow(IReadOnlyDictionary<string, object> Values, bool IncludeInTotals);

/// <summary>Copies only the already-produced report result, never opens or refreshes a book.</summary>
public sealed class ReportInputSnapshot
{
    public ReportMetadata Metadata { get; }
    public ReportKind Kind { get; }
    public long SourceRevision { get; }
    public Guid SnapshotId { get; } = Guid.NewGuid();
    public string Fingerprint { get; }
    public string SourceTitle { get; }
    public string SourceNote { get; }
    public IReadOnlyList<string> Limitations { get; }
    public IReadOnlyList<SourceField> Fields { get; }
    public int RowCount => Rows.Count;
    internal IReadOnlyList<InputRow> Rows { get; }
    public ReportInputSnapshot(ReportDocument source, long sourceRevision, IEnumerable<string>? limitations = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (sourceRevision < 0) throw new ArgumentOutOfRangeException(nameof(sourceRevision));
        if (source.Metadata.Book.Id == Guid.Empty) throw new ArgumentException("来源必须有有效BookId。", nameof(source));
        if (source.Rows.Count > 10000) throw new ArgumentException("输入上限为10000行，请由宿主缩小明确期间。");
        Metadata = source.Metadata; Kind = source.Kind; SourceRevision = sourceRevision; SourceNote = source.Note; SourceTitle = source.Title;
        Limitations = Array.AsReadOnly((limitations ?? []).Select(s => s ?? throw new ArgumentException("来源限制不可为空。")).ToArray());
        Fields = Array.AsReadOnly(source.Columns.Select(c => new SourceField(c.Key, c.Title, c.Kind == ReportValueKind.Amount)).ToArray());
        Rows = Array.AsReadOnly(source.Rows.Select(row => new InputRow(
            new ReadOnlyDictionary<string, object>(source.Columns.Select((c, i) => (c.Key,
                Value: row.Cells[i].Amount is { } amount ? (object)amount : row.Cells[i].DisplayText))
                .ToDictionary(p => p.Key, p => p.Value, StringComparer.Ordinal)),
            Kind == ReportKind.TrialBalance ? row.IsLeaf == true :
            Kind != ReportKind.Ledger || row.Cells[source.Columns.Select((c, i) => (c, i)).Single(x => x.c.Key == "date").i].DisplayText.Length > 0)).ToArray());
        Fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new {
            Metadata.Book, Metadata.From, Metadata.To, Metadata.GeneratedAt, Metadata.Sources, SourceRevision, Kind,
            Fields, Rows, SourceTitle, SourceNote, Limitations
        }))));
    }
    public ReportTemplate CreateTemplate() => new() {
        SourceKind = Kind, Title = "自定义 · " + SourceTitle,
        Columns = Fields.Take(24).Select(f => new TemplateColumn(f.Key, f.Title, "[" + f.Key + "]", Total:
            f.Numeric && f.Key != "runningBalance")).ToArray()
    };
}
public sealed record PreviewCell(string Text, decimal? Number);
public sealed record PreviewRow(IReadOnlyList<PreviewCell> Cells, string Kind = "data", string Label = "");
public sealed class ReportPreview
{
    public ReportInputSnapshot Input { get; }
    public ReportTemplate Template { get; }
    public string TemplateHash { get; }
    public IReadOnlyList<TemplateColumn> Columns { get; }
    public IReadOnlyList<PreviewRow> Rows { get; }
    public IReadOnlyList<string> Warnings { get; }
    public int IncludedDataRows { get; }
    public bool IsLimited => IncludedDataRows != Input.RowCount;
    internal ReportPreview(ReportInputSnapshot input, ReportTemplate template, IEnumerable<TemplateColumn> columns,
        IEnumerable<PreviewRow> rows, int count)
    {
        Input = input; Template = template with { Columns = Array.AsReadOnly(template.Columns.ToArray()) };
        TemplateHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(Template))));
        Columns = Array.AsReadOnly(columns.ToArray()); Rows = Array.AsReadOnly(rows.ToArray()); IncludedDataRows = count;
        Warnings = Array.AsReadOnly(new[] {
            "自定义账表预览；未经法定财报项目映射和合规复核。",
            $"当前输入快照：{count}/{input.RowCount} 数据行；" + (IsLimited ? "预览已截断，合计仅含所示行，禁止导出/打印；请提高预览行数或缩小来源期间。" : "未截断。"),
            "合计/小计为所选数值列的逐行值之和；余额表仅末级，明细账排除期初；SUM是同行参数求和。显示格式舍入不改变计算值。",
            input.SourceNote
        }.Concat(input.Limitations.Select(x => "来源缺失/限制：" + x)).ToArray());
    }
    public IEnumerable<string> AuditLines()
    {
        yield return $"账套：{Input.Metadata.Book.Name}；BookId={Input.Metadata.Book.Id:D}；制度版本={Input.Metadata.Book.TemplateVersion}";
        yield return $"期间：{Input.Metadata.From:yyyy-MM-dd} 至 {Input.Metadata.To:yyyy-MM-dd}；来源revision={Input.SourceRevision}；生成时间={Input.Metadata.GeneratedAt:O}";
        yield return $"SnapshotId={Input.SnapshotId:D}；输入SHA256={Input.Fingerprint}";
        yield return $"模板Id={Template.Id:D}；版本={Template.Version}；模板SHA256={TemplateHash}；币种/单位：CNY/元";
        foreach (var warning in Warnings) yield return warning;
        foreach (var source in Input.Metadata.Sources) yield return $"来源：{source.Title} {source.Address}";
    }
}
