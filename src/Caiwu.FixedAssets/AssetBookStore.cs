using System.Text.Json;

namespace Caiwu.FixedAssets;

/// <summary>Implement with one transaction: compare book identity+revision and save the entire module aggregate.</summary>
public interface IAssetBookStore
{
    AssetBookState Load();
    bool TrySave(AssetBookIdentity identity, long expectedRevision, AssetBookState next);
}

public sealed class InMemoryAssetBookStore(AssetBookState initial) : IAssetBookStore
{
    private readonly object gate = new();
    private AssetBookState state = initial;
    public AssetBookState Load() { lock (gate) return state; }
    public bool TrySave(AssetBookIdentity identity, long expectedRevision, AssetBookState next)
    {
        lock (gate)
        {
            if (state.Identity != identity || state.Revision != expectedRevision) return false;
            if (next.Identity != identity || next.Revision != expectedRevision + 1)
                throw new ArgumentException("Invalid snapshot identity or revision.", nameof(next));
            state = next;
            return true;
        }
    }
}

/// <summary>Explicit synthetic/new-engine snapshot codec, not a SQL Anywhere importer or production persistence adapter.</summary>
public static class AssetSnapshotCodec
{
    private sealed record Envelope(string Format, int Version, AssetBookState State);
    private const string Format = "caiwu-fixed-assets-synthetic";
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true };
    internal static bool CardsEqual(AssetCard a, AssetCard b)
    {
        using var first = JsonDocument.Parse(JsonSerializer.Serialize(a, Options));
        using var second = JsonDocument.Parse(JsonSerializer.Serialize(b, Options));
        return JsonElement.DeepEquals(first.RootElement, second.RootElement);
    }
    public static string Serialize(AssetBookState state) => JsonSerializer.Serialize(new Envelope(Format, 1, state), Options);
    public static AssetBookState Deserialize(string json)
    {
        var value = JsonSerializer.Deserialize<Envelope>(json, Options) ?? throw new FormatException("Empty snapshot.");
        if (value.Format != Format || value.Version != 1 || value.State is null)
            throw new FormatException("Not a supported synthetic asset snapshot.");
        AssetBookService.ValidateSnapshot(value.State);
        return value.State;
    }
}
