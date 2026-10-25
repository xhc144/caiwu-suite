using System.Text.Json;
using System.Text.Json.Serialization;

namespace Caiwu.Nonprofit.Reporting;

/// <summary>Host-selected user data directory, basename-only files, create-new atomic publication. Never silently overwrites.
/// These sidecars are NOT included in the application's existing ledger backup workflow.</summary>
public sealed class ClassificationJsonStore
{
    private sealed record Envelope(int FormatVersion, string PayloadSha256, LedgerClassificationManifest Manifest);
    internal static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented=true, MaxDepth=48, UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow,
        Converters={new JsonStringEnumConverter(allowIntegerValues:false)}
    };
    public string UserDataDirectory { get; }
    public ClassificationJsonStore(string userDataDirectory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(userDataDirectory);
        if(!Path.IsPathFullyQualified(userDataDirectory))throw new ArgumentException("宿主须指定绝对用户数据目录。");
        var path=Path.GetFullPath(userDataDirectory);var install=Path.GetFullPath(AppContext.BaseDirectory);
        if(IsWithin(path,install))throw new ArgumentException("分类清单禁止写入安装/应用程序目录；请由宿主传入用户数据目录。");
        RejectLinks(path);Directory.CreateDirectory(path);UserDataDirectory=path;
    }
    public string SaveNew(string fileName, LedgerClassificationManifest manifest)
    {
        LedgerSnapshotStatementDataSource.ValidateManifestShape(manifest);
        var destination=PathFor(fileName);if(File.Exists(destination))throw new IOException("目标分类JSON已存在，请使用新文件名；原文件未修改。");var temp=Path.Combine(UserDataDirectory,"."+Guid.NewGuid().ToString("N")+".tmp");
        var bytes=JsonSerializer.SerializeToUtf8Bytes(new Envelope(1,ManifestHash(manifest),manifest),Options);
        if(bytes.Length>32*1024*1024)throw new InvalidDataException("分类清单超过32MiB。");
        try
        {
            using(var output=new FileStream(temp,FileMode.CreateNew,FileAccess.Write,FileShare.None)) {output.Write(bytes);output.Flush(true);}
            File.Move(temp,destination,overwrite:false);return destination;
        }
        finally {if(File.Exists(temp))File.Delete(temp);}
    }
    public LedgerClassificationManifest Load(string fileName, Caiwu.Contracts.LedgerSnapshot currentSnapshot)
    {
        var file=PathFor(fileName);var info=new FileInfo(file);
        if(!info.Exists||info.Length>32*1024*1024)throw new InvalidDataException("分类清单不存在或超过32MiB。");
        RejectLinks(file);
        var bytes=File.ReadAllBytes(file);
        using(var parsed=JsonDocument.Parse(bytes,new JsonDocumentOptions{MaxDepth=48}))ValidateJson(parsed.RootElement);
        var envelope=JsonSerializer.Deserialize<Envelope>(bytes,Options)??throw new InvalidDataException("分类清单为空。");
        if(envelope.FormatVersion!=1||envelope.Manifest is null||envelope.PayloadSha256!=ManifestHash(envelope.Manifest))throw new InvalidDataException("分类清单版本或内容校验失败。");
        LedgerSnapshotStatementDataSource.ValidateManifestShape(envelope.Manifest);
        LedgerSnapshotStatementDataSource.RequireBinding(currentSnapshot,envelope.Manifest.Binding);
        LedgerSnapshotStatementDataSource.VerifyReferences(currentSnapshot,envelope.Manifest);
        return envelope.Manifest;
    }
    private static void ValidateJson(JsonElement element)
    {
        if(element.ValueKind==JsonValueKind.Object)
        {
            var names=new HashSet<string>(StringComparer.Ordinal);
            foreach(var property in element.EnumerateObject())
            {
                if(!names.Add(property.Name))throw new InvalidDataException("分类JSON不允许重复属性。");
                if(property.Name is "YearOpeningAnalysis" or "ClosingAnalysis"&&property.Value.ValueKind==JsonValueKind.Number)
                {
                    var raw=property.Value.GetRawText();var dot=raw.IndexOf('.');
                    if(raw.IndexOfAny(['e','E'])>=0||dot>=0&&raw[(dot+1)..].Skip(2).Any(c=>c!='0'))
                        throw new InvalidDataException("分析金额须使用精确到分的普通十进制数字，不能以指数或过精度文本在解析时失真。");
                }
                ValidateJson(property.Value);
            }
        }
        else if(element.ValueKind==JsonValueKind.Array)foreach(var child in element.EnumerateArray())ValidateJson(child);
    }
    internal static string ManifestHash(LedgerClassificationManifest manifest)=>SnapshotIdentity.Hash(manifest);
    internal static LedgerClassificationManifest Freeze(LedgerClassificationManifest manifest)=>JsonSerializer.Deserialize<LedgerClassificationManifest>(JsonSerializer.SerializeToUtf8Bytes(manifest,Options),Options)!;
    private string PathFor(string fileName)
    {
        if(string.IsNullOrWhiteSpace(fileName)||fileName!=Path.GetFileName(fileName)||fileName.IndexOfAny("<>:\"/\\|?*".ToCharArray())>=0||fileName.Any(char.IsControl)||
            !fileName.EndsWith(".json",StringComparison.OrdinalIgnoreCase)||fileName.EndsWith(' ')||fileName.EndsWith('.')||fileName.StartsWith('.'))
            throw new ArgumentException("只接受用户数据目录中的新JSON文件名。");
        RejectLinks(UserDataDirectory);var path=Path.Combine(UserDataDirectory,fileName);RejectLinks(path);return path;
    }
    private static bool IsWithin(string path,string root)=>string.Equals(path.TrimEnd(Path.DirectorySeparatorChar),root.TrimEnd(Path.DirectorySeparatorChar),StringComparison.OrdinalIgnoreCase)||
        path.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase);
    private static void RejectLinks(string path)
    {
        for(var item=Path.GetFullPath(path);!string.IsNullOrEmpty(item);item=Path.GetDirectoryName(item))
            if((File.Exists(item)||Directory.Exists(item))&&(File.GetAttributes(item)&FileAttributes.ReparsePoint)!=0)
                throw new IOException("分类文件路径不能经过符号链接/重解析点。");
    }
}
