using System.Text.Json;
using System.Text.Json.Serialization;

namespace Caiwu.FixedAssets;

/// <summary>Versioned authority document for the shared module store, separate from the synthetic workspace file format.</summary>
public static class AssetModuleDocumentCodec
{
    public const int SchemaVersion = 1;
    private const string Format = "caiwu.fixed-assets.module";
    private sealed record Envelope(string Format, int Version, AssetBookState State);
    private static readonly JsonSerializerOptions Options = new() { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    public static string Serialize(AssetBookState state)
    {
        AssetBookService.ValidateSnapshot(state);
        return JsonSerializer.Serialize(new Envelope(Format, SchemaVersion, state), Options);
    }
    public static AssetBookState Deserialize(string json)
    {
        using var parsed = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 64 });
        RejectDuplicateKeys(parsed.RootElement);
        var envelope = JsonSerializer.Deserialize<Envelope>(json, Options) ?? throw new FormatException("Empty asset module document.");
        if (envelope.Format != Format || envelope.Version != SchemaVersion || envelope.State is null)
            throw new FormatException("Unsupported asset module document version.");
        AssetBookService.ValidateSnapshot(envelope.State); return envelope.State;
    }
    private static void RejectDuplicateKeys(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var keys = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            {
                if (!keys.Add(property.Name)) throw new FormatException("Duplicate asset document property: " + property.Name);
                RejectDuplicateKeys(property.Value);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
            foreach (var child in element.EnumerateArray()) RejectDuplicateKeys(child);
    }
}
