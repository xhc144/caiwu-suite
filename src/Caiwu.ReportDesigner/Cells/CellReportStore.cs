using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Caiwu.ReportDesigner.Cells;

public sealed record CellReportFile(CellReport Report, string Sha256);
public static class CellReportStore
{
    private const int MaxBytes = 8 * 1024 * 1024;
    private static readonly JsonSerializerOptions Options = new() {
        WriteIndented = true, MaxDepth = 32, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        PropertyNameCaseInsensitive = false, AllowDuplicateProperties = false, RespectRequiredConstructorParameters = true,
        Converters = { new JsonStringEnumConverter(allowIntegerValues: false) }
    };
    public static CellReportFile Load(string path)
    {
        path = CheckedPath(path);
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length > MaxBytes) throw new InvalidDataException("单元格报表超过8 MiB。");
        var bytes = new byte[checked((int)stream.Length)]; stream.ReadExactly(bytes);
        try {
            var report = JsonSerializer.Deserialize<CellReport>(bytes, Options) ?? throw new JsonException("空报表。");
            return new(CellReportRules.Freeze(report), Hash(bytes));
        } catch (JsonException ex) { throw new InvalidDataException("报表 JSON 无效、重复字段或版本不兼容。", ex); }
    }
    public static CellReportFile Save(string path, CellReport report, string? expectedSha256 = null)
    {
        path = CheckedPath(path); report = CellReportRules.Freeze(report);
        var directory = Path.GetDirectoryName(path)!;
        if (!Directory.Exists(directory)) throw new DirectoryNotFoundException("宿主须提供已存在的受管目录。");
        var lockPath = path + ".lock";
        if (File.Exists(lockPath) && (File.GetAttributes(lockPath) & FileAttributes.ReparsePoint) != 0) throw new IOException("拒绝链接锁文件。");
        using var lease = new FileStream(lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        if (expectedSha256 is null) { if (File.Exists(path)) throw new TemplateConflictException("目标已存在，请先载入或另存为。"); }
        else {
            var old = Load(path);
            if (old.Sha256 != expectedSha256 || old.Report.Id != report.Id || report.Version != checked(old.Report.Version + 1))
                throw new TemplateConflictException("模板已变化或版本不连续；保留当前编辑，请重新载入核对。");
        }
        var bytes = JsonSerializer.SerializeToUtf8Bytes(report, Options);
        if (bytes.Length > MaxBytes) throw new InvalidDataException("单元格报表超过8 MiB。");
        var stage = Path.Combine(directory, "." + Path.GetFileName(path) + "." + Guid.NewGuid().ToString("N") + ".tmp");
        try {
            using (var stream = new FileStream(stage, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough)) { stream.Write(bytes); stream.Flush(true); }
            if (expectedSha256 is null) AtomicPublication.New(stage, path); else File.Move(stage, path, true);
            return new(report, Hash(bytes));
        } finally { if (File.Exists(stage)) File.Delete(stage); }
    }
    private static string CheckedPath(string path)
    {
        if (!Path.IsPathFullyQualified(path) || !string.Equals(Path.GetExtension(path), ".json", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("报表路径须为绝对 .json 路径。");
        var full = Path.GetFullPath(path);
        if (File.Exists(full) && (File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0) throw new IOException("拒绝链接报表文件。");
        return full;
    }
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes));
}
