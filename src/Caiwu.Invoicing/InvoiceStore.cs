using System.Text.Json;
using System.Text.Json.Serialization;

namespace Caiwu.Invoicing;

/// <summary>Save must atomically compare the revision and replace the entire workspace.
/// The supplied implementations are synthetic workspaces, not original book adapters.</summary>
public interface IInvoiceStore
{
    InvoiceWorkspace Read();
    bool TrySave(long expectedRevision, InvoiceWorkspace workspace);
}

public static class InvoiceJson
{
    public static JsonSerializerOptions Options { get; } = new()
    {
        WriteIndented = true,
        // Unknown schema members must stop read/edit/save instead of silently disappearing.
        // Legacy raw columns remain supported through LegacyInvoiceRow.Fields.
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        Converters = { new JsonStringEnumConverter() }
    };
    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);
    public static T Deserialize<T>(string json)
    {
        using var document = JsonDocument.Parse(json);
        ValidateKeys(document.RootElement);
        return JsonSerializer.Deserialize<T>(json, Options) ?? throw new InvoiceException("json", "文件内容为空。");
    }
    private static void ValidateKeys(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            var keys = new HashSet<string>(StringComparer.Ordinal);
            foreach (var field in value.EnumerateObject())
            {
                if (!keys.Add(field.Name)) throw new InvoiceException("duplicate-json-key", $"重复 JSON 字段：{field.Name}");
                ValidateKeys(field.Value);
            }
        }
        else if (value.ValueKind == JsonValueKind.Array)
            foreach (var element in value.EnumerateArray()) ValidateKeys(element);
    }
}

public sealed class MemoryInvoiceStore(InvoiceWorkspace initial) : IInvoiceStore
{
    private readonly object gate = new();
    private InvoiceWorkspace state = initial;
    public InvoiceWorkspace Read() { lock (gate) return state; }
    public bool TrySave(long expectedRevision, InvoiceWorkspace workspace)
    {
        lock (gate)
        {
            if (state.Revision != expectedRevision) return false;
            StoreRules.CheckReplacement(state, workspace);
            state = workspace;
            return true;
        }
    }
}

/// <summary>Explicit new .invoice-synthetic.json file only. Never accepts an original .db/.caiwu.
/// An exclusive sidecar gate coordinates independent instances; atomic rename publishes a complete snapshot.</summary>
public sealed class SyntheticJsonInvoiceStore : IInvoiceStore
{
    private readonly string path;
    public SyntheticJsonInvoiceStore(string path)
    {
        this.path = Path.GetFullPath(path);
        if (!this.path.EndsWith(".invoice-synthetic.json", StringComparison.OrdinalIgnoreCase))
            throw new InvoiceException("synthetic-path", "合成工作区必须使用 .invoice-synthetic.json 文件。");
    }
    private FileStream Acquire() => new(path + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
    public void Create(InvoiceWorkspace initial)
    {
        using var gate = Acquire();
        using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        JsonSerializer.Serialize(stream, initial, InvoiceJson.Options);
        stream.Flush(true);
    }
    public InvoiceWorkspace Read()
    {
        using var gate = Acquire();
        return ReadLocked();
    }
    private InvoiceWorkspace ReadLocked() => InvoiceJson.Deserialize<InvoiceWorkspace>(File.ReadAllText(path));
    public bool TrySave(long expectedRevision, InvoiceWorkspace workspace)
    {
        using var gate = Acquire();
        var current = ReadLocked();
        if (current.Revision != expectedRevision) return false;
        StoreRules.CheckReplacement(current, workspace);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                JsonSerializer.Serialize(stream, workspace, InvoiceJson.Options);
                stream.Flush(true);
            }
            File.Move(temporary, path, true);
            return true;
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}

internal static class StoreRules
{
    internal static void CheckReplacement(InvoiceWorkspace current, InvoiceWorkspace next)
    {
        if (next.BookId != current.BookId || next.Product != current.Product || next.Revision != checked(current.Revision + 1))
            throw new InvoiceException("store-identity", "账套、产品或修订不一致。");
    }
}
