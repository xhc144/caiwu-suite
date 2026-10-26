using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Caiwu.Nonprofit.Writable;

/// <summary>Durable module fixture/reference adapter. Own format only; never opens a SQL Anywhere or .caiwu file.
/// Host integration must supply INonprofitLedgerStore against its own atomic transaction.</summary>
public sealed class AtomicNonprofitLedgerStore : INonprofitLedgerStore
{
    private const string Format = "Caiwu.Nonprofit.ModuleLedger/1";
    private readonly string path;
    internal static readonly JsonSerializerOptions Json = new()
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        WriteIndented = true
    };
    private sealed record Envelope(string Format, string Sha256, NonprofitLedgerSnapshot Snapshot);

    public AtomicNonprofitLedgerStore(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        this.path = Path.GetFullPath(path);
        if (!this.path.EndsWith(".np-ledger.json", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("模块参考存储只接受新建 .np-ledger.json 文件，不能打开原账套。", nameof(path));
    }

    internal static NonprofitLedgerSnapshot Freeze(NonprofitLedgerSnapshot value) =>
        JsonSerializer.Deserialize<NonprofitLedgerSnapshot>(JsonSerializer.SerializeToUtf8Bytes(value, Json), Json)!;
    private static string Digest(NonprofitLedgerSnapshot value) =>
        Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value, Json)));

    public NonprofitLedgerSnapshot Read()
    {
        byte[] bytes;
        using (var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete))
        using (var copy = new MemoryStream()) { input.CopyTo(copy); bytes = copy.ToArray(); }
        using (var document = JsonDocument.Parse(bytes)) RejectDuplicateKeys(document.RootElement);
        var envelope = JsonSerializer.Deserialize<Envelope>(bytes, Json) ?? throw new InvalidDataException("账簿为空。");
        if (envelope.Format != Format || envelope.Snapshot is null || envelope.Sha256 != Digest(envelope.Snapshot))
            throw new InvalidDataException("模块格式或账簿校验和不符。");
        NonprofitLedgerValidation.Validate(envelope.Snapshot);
        return Freeze(envelope.Snapshot);
    }

    public void Initialize(NonprofitLedgerSnapshot snapshot)
    {
        snapshot = Freeze(snapshot);
        NonprofitLedgerValidation.Validate(snapshot);
        if (snapshot.Revision != 0) throw new InvalidDataException("新账簿版本必须为0。");
        using var lease = Acquire();
        if (File.Exists(path)) throw new IOException("目标账簿已经存在，禁止覆盖。");
        Write(snapshot, overwrite: false);
    }

    public void Commit(NonprofitMutationContext expected, NonprofitLedgerSnapshot next)
    {
        next = Freeze(next);
        NonprofitLedgerValidation.Validate(next);
        using var lease = Acquire();
        var current = Read();
        if (expected.BookId != current.BookId || expected.Revision != current.Revision)
            throw new NonprofitConcurrencyException("账套或账簿版本已变化；请重新读取后核对，不能自动重试写入。");
        if (next.BookId != current.BookId || current.Revision == long.MaxValue || next.Revision != current.Revision + 1)
            throw new InvalidDataException("提交必须保留账套身份并推进一个版本。");
        Write(next, overwrite: true);
    }

    private FileStream Acquire()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        try { return new FileStream(path + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
        catch (IOException e) { throw new NonprofitConcurrencyException("账簿正在被其他操作占用：" + e.Message); }
    }

    private void Write(NonprofitLedgerSnapshot snapshot, bool overwrite)
    {
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                4096, FileOptions.WriteThrough))
            {
                JsonSerializer.Serialize(output, new Envelope(Format, Digest(snapshot), snapshot), Json);
                output.Flush(flushToDisk: true);
            }
            File.Move(temporary, path, overwrite);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    private static void RejectDuplicateKeys(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in value.EnumerateObject())
            {
                if (!names.Add(property.Name)) throw new InvalidDataException("JSON含重复字段：" + property.Name);
                RejectDuplicateKeys(property.Value);
            }
        }
        else if (value.ValueKind == JsonValueKind.Array)
            foreach (var item in value.EnumerateArray()) RejectDuplicateKeys(item);
    }
}
