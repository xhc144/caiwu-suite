using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Persistence.Sqlite;

namespace Caiwu.Delivery;

public sealed record BookInspection(string DatabasePath, Guid BookId, long Revision, int VoucherCount,
    int PostedVoucherCount, decimal? BankBalance, string SnapshotSha256, string FileSha256)
{
    // A live main file alone is not a WAL-inclusive database fingerprint.
    // "sqlite-consistent-copy" hashes the closed inspection snapshot, not DatabasePath's live bytes.
    public string FileSha256Basis { get; init; } = "database-file";
}
public sealed record BookCopyResult(BookInspection Source, BookInspection Copy);

/// <summary>Explicit single-book operations. They do not certify a complete Desktop inventory or enable upgrades.</summary>
public static class BookOperations
{
    public static BookInspection Inspect(string installRoot, string relativeBook) =>
        Installation.WithExclusiveData(installRoot, current => InspectPath(BookPath(current.DataRoot, relativeBook), current.DataRoot));

    public static BookCopyResult Backup(string installRoot, string relativeSource, string relativeBackup) =>
        Installation.WithExclusiveData(installRoot, current =>
        {
            var source = BookPath(current.DataRoot, relativeSource);
            var backup = BookPath(current.DataRoot, relativeBackup);
            if (IsBackup(current.DataRoot, source) || !IsBackup(current.DataRoot, backup))
                throw new InvalidDataException("Backup must read a managed book and create a new file in .delivery-backups.");
            var registration = SafePaths.Child(current.DataRoot, "managed-modules.json");
            if (File.Exists(registration))
            {
                var inventory = ManagedDataSession.ReadJson<ManagedModuleInventory>(registration);
                var book = inventory.Books.SingleOrDefault(b => SafePaths.Child(current.DataRoot, b.RelativeDatabasePath).Equals(source, StringComparison.OrdinalIgnoreCase));
                if (book != null)
                    throw new InvalidOperationException("This book has registered module attachments. Use ManagedBookBackup for a complete backup.");
            }
            return WithSnapshot(source, current.DataRoot, (snapshot, inspected) =>
            {
                Directory.CreateDirectory(Path.GetDirectoryName(backup)!);
                SqliteLedgerStore.RestoreBackup(snapshot, backup);
                return new BookCopyResult(inspected, InspectWritableCopy(backup));
            });
        });

    public static BookCopyResult Restore(string installRoot, string relativeBackup, string relativeNewBook) =>
        Installation.WithExclusiveData(installRoot, current =>
        {
            var backup = BookPath(current.DataRoot, relativeBackup);
            var destination = BookPath(current.DataRoot, relativeNewBook);
            if (!IsBackup(current.DataRoot, backup) || IsBackup(current.DataRoot, destination))
                throw new InvalidDataException("Restore must read .delivery-backups and create a new book outside that directory.");
            return WithSnapshot(backup, current.DataRoot, (snapshot, inspected) =>
            {
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                SqliteLedgerStore.RestoreBackup(snapshot, destination);
                return new BookCopyResult(inspected, InspectWritableCopy(destination));
            });
        });

    private static bool IsBackup(string dataRoot, string path) =>
        SafePaths.Contains(SafePaths.Child(dataRoot, ".delivery-backups"), path);

    private static string BookPath(string dataRoot, string relative)
    {
        var path = SafePaths.Child(dataRoot, relative);
        if (!path.EndsWith(".caiwu", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("A .caiwu book path is required.");
        return path;
    }

    private static BookInspection InspectPath(string path, string dataRoot) =>
        WithSnapshot(path, dataRoot, (_, inspected) => inspected);

    internal static T WithSnapshot<T>(string path, string dataRoot, Func<string, BookInspection, T> consume)
    {
        LedgerFilePolicy.Validate(path);
        // All input inspection is read-only, including ordinary writable/live books. Capture once,
        // then read, hash and copy that same committed snapshot; never hash a live main file.
        var cache = SafePaths.Child(dataRoot, ".delivery-scratch");
        Directory.CreateDirectory(cache);
        var clone = SafePaths.Child(cache, ".inspection-" + Guid.NewGuid().ToString("N") + ".tmp");
        var published = false;
        try
        {
            SqliteLedgerStore.RestoreBackup(path, clone); published = true;
            var inspected = InspectWritableCopy(clone) with
            { DatabasePath = path, FileSha256Basis = "sqlite-consistent-copy" };
            return consume(clone, inspected);
        }
        finally
        {
            // Only this newly published inspection copy is ours; never remove an existing destination.
            if (published)
            {
                SafePaths.RejectLinks(cache);
                foreach (var suffix in new[] { "", "-wal", "-shm", "-journal" }) File.Delete(clone + suffix);
            }
        }
    }

    private static BookInspection InspectWritableCopy(string path)
    {
        LedgerFilePolicy.Validate(path);
        LedgerSnapshot snapshot;
        using (var store = SqliteLedgerStore.Open(path))
        {
            store.CheckIntegrity(); snapshot = store.Read();
        }
        var matches = snapshot.Accounts.Where(a => a.Name == "银行存款").Take(2).ToArray();
        var bank = matches.Length == 1 ? matches[0] : null;
        decimal? bankBalance = bank == null ? null : bank.OpeningDebit - bank.OpeningCredit +
            snapshot.Vouchers.Where(v => v.Status == VoucherStatus.Posted).SelectMany(v => v.Lines)
                .Where(l => l.AccountCode == bank.Code).Sum(l => l.Debit - l.Credit);
        var fingerprint = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(snapshot, PayloadManifest.Json))));
        return new(path, snapshot.Book.Id, snapshot.Revision, snapshot.Vouchers.Count,
            snapshot.Vouchers.Count(v => v.Status == VoucherStatus.Posted), bankBalance, fingerprint, PayloadManifest.Hash(path));
    }
}
