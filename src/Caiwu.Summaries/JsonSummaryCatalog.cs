namespace Caiwu.Summaries;

/// <summary>Synchronous per-book service. Every mutation compares the caller's loaded version under a file lock.</summary>
public sealed class JsonSummaryCatalog : ISummaryCatalog
{
    public SummaryCatalogLocation Location { get; }
    private readonly AtomicCatalogFile files;
    private JsonSummaryCatalog(SummaryCatalogLocation location, AtomicCatalogFile files)
    { Location = location; this.files = files; }

    public static JsonSummaryCatalog Create(SummaryCatalogLocation location)
    {
        ArgumentNullException.ThrowIfNull(location);
        var path = location.WithinRoot(location.CatalogPath);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        using var writeLock = AtomicCatalogFile.Lock(path);
        var files = new AtomicCatalogFile();
        files.Publish(path, CatalogCodec.Encode(new(1, location.BookId, Guid.NewGuid(), 0, [], [])), overwrite: false);
        return new(location, files);
    }

    /// <summary>Never initializes missing or damaged files. A failed Open does not change the catalog.</summary>
    public static JsonSummaryCatalog Open(SummaryCatalogLocation location)
    {
        ArgumentNullException.ThrowIfNull(location);
        var catalog = new JsonSummaryCatalog(location, new());
        _ = catalog.Read();
        return catalog;
    }

    internal static JsonSummaryCatalog WithWriter(SummaryCatalogLocation location, Action<Stream, byte[]> write) => new(location, new(write));

    public SummarySnapshot Read()
    {
        var (document, bytes) = ReadDocument(Location.CatalogPath);
        return new(document, CatalogCodec.Hash(bytes));
    }

    public SummarySnapshot AddCategory(string name, CatalogVersion expected) => Change(expected, d =>
        d.Categories.Add(new(Guid.NewGuid(), TextRules.Required(name, "分类名称", 100))));

    public SummarySnapshot RenameCategory(Guid id, string name, CatalogVersion expected) => Change(expected, d =>
    {
        var index = CategoryIndex(d, id);
        d.Categories[index] = d.Categories[index] with { Name = TextRules.Required(name, "分类名称", 100) };
    });

    /// <summary>Nonempty categories cannot be deleted. Move or delete their entries explicitly first.</summary>
    public SummarySnapshot DeleteCategory(Guid id, CatalogVersion expected) => Change(expected, d =>
    {
        var index = CategoryIndex(d, id);
        if (d.Entries.Any(e => e.CategoryId == id)) throw new SummaryValidationException("分类中仍有摘要；请先移动或删除摘要。");
        d.Categories.RemoveAt(index);
    });

    public SummarySnapshot AddSummary(Guid categoryId, string text, CatalogVersion expected) => Change(expected, d =>
    {
        _ = CategoryIndex(d, categoryId);
        d.Entries.Add(new(Guid.NewGuid(), categoryId, TextRules.Required(text, "摘要", 4000, true)));
    });

    /// <summary>Changes text and/or category while retaining the entry's stable ID.</summary>
    public SummarySnapshot UpdateSummary(Guid id, Guid categoryId, string text, CatalogVersion expected) => Change(expected, d =>
    {
        _ = CategoryIndex(d, categoryId);
        var index = EntryIndex(d, id);
        d.Entries[index] = new(id, categoryId, TextRules.Required(text, "摘要", 4000, true));
    });

    public SummarySnapshot DeleteSummary(Guid id, CatalogVersion expected) => Change(expected, d => d.Entries.RemoveAt(EntryIndex(d, id)));

    /// <summary>Creates a new validated standalone JSON backup. Existing destinations are always refused.</summary>
    public CatalogBackup ExportBackup(string destinationPath)
    {
        var target = Location.WithinRoot(destinationPath);
        var (document, bytes) = ReadDocument(Location.CatalogPath);
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        using var targetLock = AtomicCatalogFile.Lock(target);
        files.Publish(target, bytes, overwrite: false);
        return Receipt(target, document, bytes);
    }

    /// <summary>Validates a backup against this book and an optional independently recorded SHA256.</summary>
    public CatalogBackup ValidateBackup(string backupPath, string? expectedSha256 = null)
    {
        var source = Location.WithinRoot(backupPath);
        var (document, bytes) = ReadDocument(source);
        VerifyHash(bytes, expectedSha256);
        return Receipt(source, document, bytes);
    }

    /// <summary>Restores only to a new explicit path. Never replaces an existing target, even with the same book ID.</summary>
    public static JsonSummaryCatalog RestoreBackup(string backupPath, string expectedSha256, SummaryCatalogLocation destination)
    {
        ArgumentNullException.ThrowIfNull(destination);
        if (string.IsNullOrWhiteSpace(expectedSha256)) throw new SummaryValidationException("恢复需要备份登记的 SHA256。");
        var source = destination.WithinRoot(backupPath);
        var bytes = AtomicCatalogFile.Read(source);
        var document = CatalogCodec.Decode(bytes);
        EnsureBook(document, destination.BookId);
        VerifyHash(bytes, expectedSha256);
        var path = destination.WithinRoot(destination.CatalogPath);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        using var targetLock = AtomicCatalogFile.Lock(path);
        var files = new AtomicCatalogFile();
        files.Publish(path, bytes, overwrite: false);
        return new(destination, files);
    }

    private SummarySnapshot Change(CatalogVersion expected, Action<CatalogDocument> change)
    {
        ArgumentNullException.ThrowIfNull(expected);
        var path = Location.WithinRoot(Location.CatalogPath);
        using var writeLock = AtomicCatalogFile.Lock(path);
        var (document, original) = ReadDocument(path);
        var current = new CatalogVersion(document.CatalogId, document.Revision, CatalogCodec.Hash(original));
        if (current != expected) throw new SummaryConflictException("摘要库已被其他窗口修改；请重新载入后核对再保存。");
        if (document.Revision == long.MaxValue) throw new SummaryValidationException("摘要修订号已达到上限。");
        change(document);
        document = document with { Revision = document.Revision + 1 };
        var bytes = CatalogCodec.Encode(document);
        files.Publish(path, bytes, overwrite: true);
        return new(document, CatalogCodec.Hash(bytes));
    }

    private (CatalogDocument Document, byte[] Bytes) ReadDocument(string path)
    {
        var bytes = AtomicCatalogFile.Read(Location.WithinRoot(path));
        var document = CatalogCodec.Decode(bytes);
        EnsureBook(document, Location.BookId);
        return (document, bytes);
    }

    private static void EnsureBook(CatalogDocument document, Guid bookId)
    {
        if (document.BookId != bookId) throw new SummaryValidationException("摘要库所属账套与当前账套不符，操作已拒绝。");
    }
    private static void VerifyHash(byte[] bytes, string? expected)
    {
        if (expected is not null && (expected.Length != 64 || !expected.All(Uri.IsHexDigit) ||
            !string.Equals(CatalogCodec.Hash(bytes), expected, StringComparison.OrdinalIgnoreCase)))
            throw new SummaryValidationException("备份 SHA256 校验失败。");
    }
    private static CatalogBackup Receipt(string path, CatalogDocument document, byte[] bytes) =>
        new(path, document.BookId, document.CatalogId, document.Revision, CatalogCodec.Hash(bytes));
    private static int CategoryIndex(CatalogDocument d, Guid id)
    {
        var index = d.Categories.FindIndex(c => c.Id == id);
        return index >= 0 ? index : throw new SummaryValidationException("找不到指定分类。");
    }
    private static int EntryIndex(CatalogDocument d, Guid id)
    {
        var index = d.Entries.FindIndex(e => e.Id == id);
        return index >= 0 ? index : throw new SummaryValidationException("找不到指定摘要。");
    }
}
