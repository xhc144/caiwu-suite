using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Persistence.Sqlite;

namespace Caiwu.Delivery;
public sealed record ManagedBook(Guid InstanceId, Guid BookId, string RelativeDatabasePath);
public sealed record ManagedAttachment(Guid InstanceId, Guid BookId, string Key, string Codec, string RelativePath);
public sealed record ManagedModuleInventory(int ContractVersion, ManagedBook[] Books, ManagedAttachment[] Attachments);
/// <summary>Owns the existing Delivery install/data leases. Keep alive through the desktop session.</summary>
public sealed class ManagedDataSession : IDisposable
{
    private readonly IDisposable installLease, dataLease;
    private readonly object gate = new();
    private bool disposed;
    private int operations;
    private readonly bool ownsLeases;
    internal CurrentInstallation Current { get; }
    public string DataRoot => Current.DataRoot;

    internal ManagedDataSession(CurrentInstallation current, IDisposable installLease, IDisposable dataLease, bool ownsLeases = true)
    {
        Current = current;
        this.installLease = installLease;
        this.dataLease = dataLease;
        this.ownsLeases = ownsLeases;
    }

    public T Execute<T>(Func<T> operation)
    {
        var resultType = typeof(T);
        if (typeof(Task).IsAssignableFrom(resultType) || resultType == typeof(ValueTask) || (resultType.IsGenericType && resultType.GetGenericTypeDefinition() == typeof(ValueTask<>)))
            throw new ArgumentException("Managed data operations must complete synchronously while their leases are held.", nameof(operation));
        lock (gate)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            return operation();
        }
    }

    // The desktop already owns both OS leases. This operation token keeps that same real lease alive;
    // it does not try to acquire the non-shareable OS file a second time.
    public IDisposable AcquireOperationLease() => Execute(() =>
    {
        operations++;
        return (IDisposable)new Operation(this);
    });
    private sealed class Operation(ManagedDataSession session) : IDisposable
    {
        private ManagedDataSession? held = session;
        public void Dispose() => Interlocked.Exchange(ref held, null)?.ReleaseOperation();
    }

    private void ReleaseOperation()
    {
        lock (gate)
        {
            operations--;
            if (disposed && operations == 0)
                ReleaseLeases();
        }
    }

    private void ReleaseLeases()
    {
        if (ownsLeases)
        {
            dataLease.Dispose();
            installLease.Dispose();
        }
    }

    public void Dispose()
    {
        lock (gate)
        {
            if (disposed)
                return;
            disposed = true;
            if (operations == 0)
                ReleaseLeases();
        }
    }

    public string NewBookPath(Guid instanceId) => Execute(() => SafePaths.Child(DataRoot, $"Books/{NonEmpty(instanceId):N}/ledger.caiwu"));
    public string ModulePath(ManagedBook book, string module, string fileName) => Execute(() =>
    {
        RequireBook(book);
        RequireSegment(module);
        RequireSegment(fileName);
        return SafePaths.Child(DataRoot, $"Books/{book.InstanceId:N}/Modules/{module}/{fileName}");
    });
    public string OperatorsDirectory => Execute(() => SafePaths.Child(DataRoot, "Global/Operators"));

    public void ValidateNewBookDestination(string absolutePath) => Execute(() =>
    {
        var path = RequireDataPath(absolutePath);
        if (!path.EndsWith(".caiwu", StringComparison.OrdinalIgnoreCase) || Reserved(path) || Path.Exists(path) || new[]
        {
            "-wal",
            "-shm",
            "-journal"
        }.Any(s => Path.Exists(path + s)))
            throw new InvalidDataException("A new managed .caiwu destination outside reserved data directories is required.");
        return true;
    });
    public ManagedBook RegisterBook(string absolutePath, Guid expectedBookId) => Execute(() =>
    {
        var path = RequireDataPath(absolutePath);
        if (Reserved(path) || !path.EndsWith(".caiwu", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Invalid managed book location.");
        var actual = ReadSnapshot(path);
        if (actual.Book.Id != NonEmpty(expectedBookId))
            throw new InvalidDataException("BookId does not match the physical ledger.");
        var inventory = ReadInventory();
        var relative = Path.GetRelativePath(DataRoot, path).Replace('\\', '/');
        var found = inventory.Books.SingleOrDefault(b => b.RelativeDatabasePath.Equals(relative, StringComparison.OrdinalIgnoreCase));
        if (found != null)
        {
            if (found.BookId != expectedBookId)
                throw new InvalidDataException("Registered ledger identity changed.");
            SynchronizeLedgerInventory();
            return found;
        }

        var parts = relative.Split('/');
        var instance = parts.Length == 3 && parts[0] == "Books" && parts[2] == "ledger.caiwu" && Guid.TryParseExact(parts[1], "N", out var allocated) ? allocated : Guid.NewGuid();
        NonEmpty(instance);
        if (inventory.Books.Any(b => b.InstanceId == instance))
            throw new InvalidDataException("Physical instance directory is already registered.");
        var book = new ManagedBook(instance, expectedBookId, relative);
        SaveInventory(inventory with { Books = [..inventory.Books, book] });
        SynchronizeLedgerInventory();
        return book;
    });
    public ManagedBook FindBook(string absolutePath, Guid expectedBookId) => Execute(() =>
    {
        var path = RequireDataPath(absolutePath);
        var book = ReadInventory().Books.SingleOrDefault(b => SafePaths.Child(DataRoot, b.RelativeDatabasePath).Equals(path, StringComparison.OrdinalIgnoreCase));
        if (book == null || book.BookId != expectedBookId)
            throw new InvalidDataException("No registered physical ledger with this BookId.");
        RequireBook(book);
        return book;
    });
    public ManagedAttachment RegisterAttachment(ManagedBook book, string key, string codec, string absolutePath, IManagedAttachmentCodec implementation) => Execute(() =>
    {
        RequireBook(book);
        RequireSegment(key);
        RequireSegment(codec);
        var path = RequireDataPath(absolutePath);
        var modules = SafePaths.Child(DataRoot, $"Books/{book.InstanceId:N}/Modules");
        if (!SafePaths.Contains(modules, path) || implementation.Id != codec)
            throw new InvalidDataException("Attachment must belong to this physical book's module directory and codec.");
        _ = implementation.ReadVersion(path, ReadSnapshot(DatabasePath(book)));
        var inventory = ReadInventory();
        var entry = new ManagedAttachment(book.InstanceId, book.BookId, key, codec, Path.GetRelativePath(DataRoot, path).Replace('\\', '/'));
        var old = inventory.Attachments.SingleOrDefault(a => a.InstanceId == book.InstanceId && a.Key.Equals(key, StringComparison.OrdinalIgnoreCase));
        if (old != null)
        {
            if (old != entry)
                throw new InvalidDataException("Attachment key is already registered differently.");
            return old;
        }

        if (inventory.Attachments.Any(a => a.RelativePath.Equals(entry.RelativePath, StringComparison.OrdinalIgnoreCase)))
            throw new InvalidDataException("Duplicate attachment path.");
        SaveInventory(inventory with { Attachments = [..inventory.Attachments, entry] });
        return entry;
    });
    public ManagedModuleInventory ReadInventory() => Execute(() =>
    {
        var path = SafePaths.Child(DataRoot, "managed-modules.json");
        if (!File.Exists(path))
            return new ManagedModuleInventory(1, [], []);
        var inventory = ReadJson<ManagedModuleInventory>(path);
        if (inventory.ContractVersion != 1 || inventory.Books == null || inventory.Attachments == null || inventory.Books.Length > 10000 || inventory.Attachments.Length > 100000)
            throw new InvalidDataException("Invalid module inventory.");
        if (inventory.Books.Select(b => b.InstanceId).Distinct().Count() != inventory.Books.Length || inventory.Books.Select(b => b.RelativeDatabasePath).Distinct(StringComparer.OrdinalIgnoreCase).Count() != inventory.Books.Length)
            throw new InvalidDataException("Duplicate physical books.");
        foreach (var b in inventory.Books)
        {
            NonEmpty(b.InstanceId);
            NonEmpty(b.BookId);
            var p = SafePaths.Child(DataRoot, b.RelativeDatabasePath);
            if (Reserved(p) || !p.EndsWith(".caiwu", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Invalid inventory path.");
        }

        var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var a in inventory.Attachments)
        {
            RequireSegment(a.Key);
            RequireSegment(a.Codec);
            if (!inventory.Books.Any(b => b.InstanceId == a.InstanceId && b.BookId == a.BookId) || !keys.Add(a.InstanceId + "/" + a.Key) || !paths.Add(a.RelativePath) || !SafePaths.Contains(SafePaths.Child(DataRoot, $"Books/{a.InstanceId:N}/Modules"), SafePaths.Child(DataRoot, a.RelativePath)))
                throw new InvalidDataException("Invalid attachment ownership.");
        }

        return inventory;
    });
    public void SynchronizeLedgerInventory() => Execute(() =>
    {
        var path = SafePaths.Child(DataRoot, "managed-books.json");
        var old = File.Exists(path) ? ReadJson<ManagedBooks>(path) : new ManagedBooks(1, []);
        if (old.ContractVersion != 1 || old.DatabasePaths == null)
            throw new InvalidDataException("Invalid ledger inventory.");
        // Preserve every pre-existing entry; UpgradeSafety still checks for missing or unregistered ledgers.
        var all = old.DatabasePaths.Concat(ReadInventory().Books.Select(DatabasePath)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        foreach (var p in all)
        {
            RequireDataPath(p);
            if (!File.Exists(p) || Reserved(p))
                throw new InvalidDataException("Missing or reserved ledger in inventory.");
        }

        AtomicJson(path, new ManagedBooks(1, all));
        return true;
    });
    internal void RequireCompleteModuleFiles()
    {
        var inventory = ReadInventory();
        var root = SafePaths.Child(DataRoot, "Books");
        if (!Directory.Exists(root))
            return;
        var known = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var book in inventory.Books)
            foreach (var suffix in new[]
            {
                "",
                "-wal",
                "-shm",
                "-journal"
            }

            )
                known.Add(DatabasePath(book) + suffix);
        foreach (var entry in inventory.Attachments)
        {
            var path = SafePaths.Child(DataRoot, entry.RelativePath);
            known.Add(path);
            if (entry.Codec is "summary-v1" or "report-template-v1")
                known.Add(path + ".lock");
        }

        foreach (var file in SafePaths.Files(root))
            if (!known.Contains(file))
                throw new InvalidDataException("Unregistered file in managed Books prevents a complete upgrade: " + Path.GetFileName(file));
    }

    internal string DatabasePath(ManagedBook book) => SafePaths.Child(DataRoot, book.RelativeDatabasePath);
    internal void RequireBook(ManagedBook book)
    {
        if (!ReadInventory().Books.Contains(book))
            throw new InvalidDataException("Book registration is not current.");
        if (ReadSnapshot(DatabasePath(book)).Book.Id != book.BookId)
            throw new InvalidDataException("Registered BookId changed.");
    }

    internal string RequireDataPath(string path)
    {
        if (!Path.IsPathFullyQualified(path))
            throw new InvalidDataException("The host must supply an absolute data path.");
        var full = SafePaths.Full(path);
        if (!SafePaths.Contains(DataRoot, full) || full.Equals(DataRoot, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Path is outside the configured user data root.");
        return SafePaths.Child(DataRoot, Path.GetRelativePath(DataRoot, full));
    }

    private bool Reserved(string path) => new[]
    {
        ".delivery-backups",
        ".delivery-scratch",
        "Global"
    }.Any(r => SafePaths.Contains(SafePaths.Child(DataRoot, r), path));
    internal void SaveInventory(ManagedModuleInventory inventory) => AtomicJson(SafePaths.Child(DataRoot, "managed-modules.json"), inventory);
    internal LedgerSnapshot ReadSnapshot(string path) => BookOperations.WithSnapshot(path, DataRoot, (copy, _) =>
    {
        using var store = SqliteLedgerStore.Open(copy);
        return store.Read();
    });
    internal static readonly JsonSerializerOptions Json = new(PayloadManifest.Json)
    {
        AllowDuplicateProperties = false,
        UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow,
        RespectRequiredConstructorParameters = true
    };
    internal static T ReadJson<T>(string path)
    {
        if (new FileInfo(path).Length > 32 * 1024 * 1024)
            throw new InvalidDataException("Manifest is too large.");
        return JsonSerializer.Deserialize<T>(File.ReadAllText(path), Json) ?? throw new InvalidDataException("Empty manifest.");
    }

    internal static void AtomicJson(string path, object value)
    {
        SafePaths.RejectLinks(path);
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var file = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                JsonSerializer.Serialize(file, value, Json);
                file.Flush(true);
            }

            File.Move(temp, path, true);
        }
        finally
        {
            File.Delete(temp);
        }
    }

    internal static Guid NonEmpty(Guid value) => value != Guid.Empty ? value : throw new InvalidDataException("An explicit nonempty identity is required.");
    internal static void RequireSegment(string value)
    {
        if (value.Contains('/') || value.Contains('\\'))
            throw new InvalidDataException("A single path segment is required.");
        _ = SafePaths.Child(Path.GetTempPath(), value);
    }
}
