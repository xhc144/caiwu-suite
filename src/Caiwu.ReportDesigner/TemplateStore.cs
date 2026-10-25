using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Caiwu.ReportDesigner;

public sealed record TemplateFile(ReportTemplate Template, string Sha256);
public sealed class TemplateConflictException(string message) : IOException(message);
/// <summary>Host supplies the full path. New saves never overwrite; updates require the exact previously-loaded hash.</summary>
public static class TemplateStore
{
    private static readonly JsonSerializerOptions Options = new() {
        WriteIndented = true, MaxDepth = 32, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        PropertyNameCaseInsensitive = false, AllowDuplicateProperties = false,
        RespectRequiredConstructorParameters = true,
        Converters = { new JsonStringEnumConverter(allowIntegerValues: false) }
    };
    public static TemplateFile Load(string path)
    {
        path = HostPath(path);
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length > 128 * 1024) throw new InvalidDataException("模板超过128 KiB限制。");
        var bytes = new byte[checked((int)stream.Length)]; stream.ReadExactly(bytes);
        ReportTemplate template;
        try { template = JsonSerializer.Deserialize<ReportTemplate>(bytes, Options) ?? throw new JsonException("空模板。"); }
        catch (JsonException ex) { throw new InvalidDataException($"模板JSON无效：{ex.Path}，行{ex.LineNumber}，字节{ex.BytePositionInLine}。", ex); }
        TemplateRules.Validate(template);
        template = template with { Columns = Array.AsReadOnly(template.Columns.ToArray()) };
        return new(template, Hash(bytes));
    }
    public static TemplateFile Save(string path, ReportTemplate template, string? expectedSha256 = null)
    {
        path = HostPath(path); ArgumentNullException.ThrowIfNull(template);
        template = template with { Columns = Array.AsReadOnly((template.Columns ?? throw DesignValidationException.One("TEMPLATE", "模板", "列不能为空。")).ToArray()) };
        TemplateRules.Validate(template);
        var directory = Path.GetDirectoryName(path)!;
        if (!Directory.Exists(directory)) throw new DirectoryNotFoundException("宿主须提供已存在的受管模板目录。");
        var lockPath = path + ".lock";
        // Persistent lock file: deleting it would permit two processes to lock different inodes.
        using var lease = new FileStream(lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        if (expectedSha256 is null) {
            if (File.Exists(path)) throw new TemplateConflictException("目标已存在；请明确载入后再保存，或由宿主提供新路径。");
        } else {
            if (!File.Exists(path)) throw new TemplateConflictException("模板已被删除；不自动重建。");
            var old = Load(path);
            if (!string.Equals(old.Sha256, expectedSha256, StringComparison.Ordinal)) throw new TemplateConflictException("模板已被其他窗口修改；保留编辑内容，请重新载入核对。");
            if (old.Template.Id != template.Id || template.Version != checked(old.Template.Version + 1))
                throw new TemplateConflictException("更新必须保留模板Id，且版本恰好加1。");
        }
        var bytes = JsonSerializer.SerializeToUtf8Bytes(template, Options);
        if (bytes.Length > 128 * 1024) throw new InvalidDataException("模板超过128 KiB限制。");
        var temporary = Path.Combine(directory, "." + Path.GetFileName(path) + "." + Guid.NewGuid().ToString("N") + ".tmp");
        try {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough)) {
                stream.Write(bytes); stream.Flush(flushToDisk: true);
            }
            if (expectedSha256 is null) {
                // Use hard-link publication on Unix to avoid .NET Move(false)'s check/rename race.
                AtomicPublication.New(temporary, path);
            } else File.Move(temporary, path, overwrite: true);
            return new(template with { Columns = Array.AsReadOnly(template.Columns.ToArray()) }, Hash(bytes));
        } finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes));
    private static string HostPath(string path) {
        if (!Path.IsPathFullyQualified(path)) throw new ArgumentException("宿主须提供绝对路径。", nameof(path));
        var full = Path.GetFullPath(path);
        if (!string.Equals(Path.GetExtension(full), ".json", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("模板路径必须为.json。");
        if (File.Exists(full) && (File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0) throw new IOException("拒绝符号链接模板目标。");
        return full;
    }
}
internal static partial class AtomicPublication
{
    [System.Runtime.InteropServices.LibraryImport("libc", EntryPoint = "link", SetLastError = true, StringMarshalling = System.Runtime.InteropServices.StringMarshalling.Utf8)]
    private static partial int Link(string oldPath, string newPath);
    internal static void New(string stage, string target) {
        if (OperatingSystem.IsWindows()) { File.Move(stage, target, overwrite: false); return; }
        if (Link(stage, target) != 0) throw new IOException("目标已存在或文件系统不支持原子不覆盖发布。", new System.ComponentModel.Win32Exception(System.Runtime.InteropServices.Marshal.GetLastPInvokeError()));
    }
}
