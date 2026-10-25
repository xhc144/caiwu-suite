using System.Text.Json;
using Caiwu.Persistence.Sqlite;

namespace Caiwu.Delivery;

public sealed record ManagedBooks(int ContractVersion, string[] DatabasePaths);
public sealed class UpgradePreparation(string backupDirectory, string[] stagedDatabases) : IDisposable
{
    public string BackupDirectory { get; } = backupDirectory;
    public IReadOnlyList<string> StagedDatabases { get; } = stagedDatabases;
    // Backups and staged results survive success/failure for recovery and forensic inspection.
    public void Dispose() { }
}

public static class UpgradeSafety
{
    public static string[] ReadInventory(string dataRoot)
    {
        dataRoot = SafePaths.Full(dataRoot);
        var inventory = JsonSerializer.Deserialize<ManagedBooks>(File.ReadAllText(SafePaths.Child(dataRoot, "managed-books.json")), PayloadManifest.Json)
            ?? throw new InvalidDataException("Missing managed-books inventory.");
        if (inventory.ContractVersion != 1) throw new InvalidDataException("Desktop managed-data contract v1 is required.");
        var paths = ValidateSources(dataRoot, inventory.DatabasePaths);
        var actual = SafePaths.Files(dataRoot).Where(p => p.EndsWith(".caiwu", StringComparison.OrdinalIgnoreCase) &&
            !SafePaths.Contains(Path.Combine(dataRoot, ".delivery-backups"), p)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (!actual.SetEquals(paths)) throw new InvalidDataException("Ledger inventory is incomplete. Upgrade is blocked.");
        return paths;
    }

    private static string[] ValidateSources(string dataRoot, IReadOnlyList<string> databasePaths)
    {
        var result = databasePaths.Select(SafePaths.Full).ToArray();
        if (result.Distinct(StringComparer.OrdinalIgnoreCase).Count() != result.Length) throw new InvalidDataException("Duplicate ledger paths.");
        foreach (var path in result)
        {
            if (!SafePaths.Contains(dataRoot, path) || SafePaths.Contains(Path.Combine(dataRoot, ".delivery-backups"), path) ||
                !path.EndsWith(".caiwu", StringComparison.OrdinalIgnoreCase) || !File.Exists(path))
                throw new InvalidDataException("Registered ledgers must exist inside the managed data root and outside backups.");
        }
        return result;
    }

    // Caller must hold Installation.AcquireLease throughout preparation and activation.
    // Migrations run on restored copies only. No live-ledger replacement is implemented.
    public static UpgradePreparation Prepare(string dataRoot, IReadOnlyList<string> databasePaths, Action<string>? migrateStaged = null)
    {
        dataRoot = SafePaths.Full(dataRoot);
        var sources = ValidateSources(dataRoot, databasePaths);
        var backupRoot = SafePaths.Child(dataRoot, ".delivery-backups");
        Directory.CreateDirectory(backupRoot);
        var directory = SafePaths.Child(backupRoot, Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var copies = new List<string>();
        var entries = new List<object>();
        var identities = new List<(Guid Id, long Revision)>();
        try
        {
            // Complete all consistent SQLite backups before invoking any migration.
            foreach (var source in sources)
            {
                var backup = SafePaths.Child(directory, $"book-{copies.Count:D4}.caiwu");
                LedgerFilePolicy.Validate(source);
                // The read-only source API captures committed WAL data without a live write probe.
                // BackupDatabase publishes a self-contained DELETE-journal copy and closes its handles.
                SqliteLedgerStore.RestoreBackup(source, backup);
                LedgerFilePolicy.Validate(backup);
                (Guid Id, long Revision) identity;
                using (var completedBackup = SqliteLedgerStore.Open(backup))
                {
                    completedBackup.CheckIntegrity();
                    var snapshot = completedBackup.Read();
                    identity = (snapshot.Book.Id, snapshot.Revision);
                }
                // File.OpenRead deliberately excludes writers on Windows. Hash only after SQLite closes.
                identities.Add(identity);
                entries.Add(new { source, backup, identity.Id, identity.Revision, sha256 = PayloadManifest.Hash(backup) });
                var staged = SafePaths.Child(directory, $"staged-{copies.Count:D4}.caiwu");
                SqliteLedgerStore.RestoreBackup(backup, staged);
                copies.Add(staged);
            }
            for (var index = 0; index < copies.Count; index++)
            {
                var staged = copies[index];
                migrateStaged?.Invoke(staged);
                LedgerFilePolicy.Validate(staged);
                using var validated = SqliteLedgerStore.Open(staged);
                validated.CheckIntegrity(); var snapshot = validated.Read();
                if (snapshot.Book.Id != identities[index].Id || snapshot.Revision < identities[index].Revision)
                    throw new InvalidDataException("Migrated copy changed the ledger identity or moved its revision backward.");
            }
            File.WriteAllText(Path.Combine(directory, "backup-receipt.json"), JsonSerializer.Serialize(new
            { status = "validated", schema = 1, liveDatabasesModified = false, entries }, PayloadManifest.Json));
            return new(directory, copies.ToArray());
        }
        catch
        {
            File.WriteAllText(Path.Combine(directory, "backup-receipt.json"), JsonSerializer.Serialize(new
            { status = "blocked", liveDatabasesModified = false, entries }, PayloadManifest.Json));
            throw;
        }
    }
}
