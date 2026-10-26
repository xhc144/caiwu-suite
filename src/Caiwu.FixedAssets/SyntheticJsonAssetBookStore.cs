namespace Caiwu.FixedAssets;

/// <summary>
/// Durable fixture/new-engine workspace only. The required suffix and envelope prevent accidental opening of an original book.
/// Cooperating processes use a sidecar exclusive lock, revision CAS and same-directory atomic replacement.
/// This is not the shared product's persistence adapter and never opens .db/.caiwu files.
/// </summary>
public sealed class SyntheticJsonAssetBookStore : IAssetBookStore
{
    private readonly string path;
    private readonly AssetBookIdentity identity;
    private SyntheticJsonAssetBookStore(string path, AssetBookIdentity identity)
    {
        if (!path.EndsWith(".assets.synthetic.json", StringComparison.Ordinal))
            throw new ArgumentException("Synthetic snapshot requires .assets.synthetic.json suffix.", nameof(path));
        this.path = Path.GetFullPath(path); this.identity = identity;
    }
    public static SyntheticJsonAssetBookStore Create(string path, AssetBookState initial)
    {
        AssetBookService.ValidateSnapshot(initial);
        var store = new SyntheticJsonAssetBookStore(path, initial.Identity);
        using var lease = store.Acquire();
        using var stream = new FileStream(store.path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        using var writer = new StreamWriter(stream);
        writer.Write(AssetSnapshotCodec.Serialize(initial)); writer.Flush(); stream.Flush(true);
        return store;
    }
    public static SyntheticJsonAssetBookStore Open(string path, AssetBookIdentity identity)
    {
        var store = new SyntheticJsonAssetBookStore(path, identity);
        _ = store.Load(); return store;
    }
    private FileStream Acquire() => new(path + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
    private AssetBookState ReadState()
    {
        var state = AssetSnapshotCodec.Deserialize(File.ReadAllText(path));
        if (state.Identity != identity) throw new AssetRuleException("book-mismatch", "账套身份不一致。");
        return state;
    }
    public AssetBookState Load() { using var lease = Acquire(); return ReadState(); }
    public bool TrySave(AssetBookIdentity expectedIdentity, long expectedRevision, AssetBookState next)
    {
        using var lease = Acquire();
        var current = ReadState();
        if (expectedIdentity != identity || current.Revision != expectedRevision) return false;
        if (next.Identity != identity || next.Revision != expectedRevision + 1)
            throw new ArgumentException("Invalid snapshot identity or revision.", nameof(next));
        AssetBookService.ValidateSnapshot(next);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                using var writer = new StreamWriter(stream, leaveOpen: true);
                writer.Write(AssetSnapshotCodec.Serialize(next)); writer.Flush(); stream.Flush(true);
            }
            File.Move(temporary, path, true);
            return true;
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
