using System.Text.Json;
using Caiwu.Delivery;
using Caiwu.Persistence.Sqlite;
using Microsoft.Data.Sqlite;

// New adversarial conditions, beyond random corrupt bytes/ordinary overwrite tests.
// Every database is a fresh synthetic fixture. No installed/reference EXE or user data is opened.
internal static class BackupAdversarialCases
{
    private const string BookName = "synthetic.caiwu";
    private const string StableBackup = ".delivery-backups/known-good.caiwu";
    private const string MaliciousBackup = ".delivery-backups/untrusted-copy.caiwu";
    private const string RestoredName = "adversarial-restored.caiwu";
    private const string TriggerSql = """
        CREATE TRIGGER malicious_after_line AFTER INSERT ON voucher_lines
        BEGIN
            UPDATE accounts SET opening_debit_cents = opening_debit_cents + 1000000 WHERE code = '1002';
        END;
        """;

    public static IEnumerable<(string Name, Action<Fixture> Action)> All
    {
        get
        {
            yield return ("Linux read-only backup directory still permits recovery through a writable data-root scratch area", f =>
            {
                if (!OperatingSystem.IsLinux())
                    throw new TestSkipped("Linux Unix-mode directory probe only; Windows ACL behavior is not exercised.");
                var original = Setup(f);
                var knownGood = BookOperations.Backup(f.Install, BookName, StableBackup);
                var backupPath = PathFor(f, StableBackup);
                var backupDirectory = Path.GetDirectoryName(backupPath)!;
                var targetPath = PathFor(f, RestoredName);
                var originalHash = Fixture.Hash(original);
                var backupHash = Fixture.Hash(backupPath);
                var attributes = File.GetAttributes(backupPath);
                var directoryMode = File.GetUnixFileMode(backupDirectory);
                var readOnlyDirectoryMode = UnixFileMode.UserRead | UnixFileMode.UserExecute |
                    UnixFileMode.GroupRead | UnixFileMode.GroupExecute | UnixFileMode.OtherRead | UnixFileMode.OtherExecute;
                var archiveProbe = Path.Combine(backupDirectory, ".permission-probe-" + Guid.NewGuid().ToString("N") + ".tmp");
                var targetProbe = Path.Combine(f.Data, ".target-permission-probe-" + Guid.NewGuid().ToString("N") + ".tmp");
                try
                {
                    File.SetAttributes(backupPath, attributes | FileAttributes.ReadOnly);
                    var readOnlyFileMode = File.GetUnixFileMode(backupPath);
                    File.SetUnixFileMode(backupDirectory, readOnlyDirectoryMode);
                    var archiveWriteDenied = false;
                    try { using var probe = new FileStream(archiveProbe, FileMode.CreateNew, FileAccess.Write, FileShare.None); }
                    catch (UnauthorizedAccessException) { archiveWriteDenied = true; }
                    if (!archiveWriteDenied)
                        throw new TestSkipped("The current user can write through Unix r-x directory permissions (for example root); the read-only directory condition was not exercised.");
                    // A separate positive probe proves that rejection cannot be blamed on an unwritable recovery root.
                    using (new FileStream(targetProbe, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { }
                    File.Delete(targetProbe);
                    Exception? actualError = null;
                    BookCopyResult? restored = null;
                    try { restored = BookOperations.Restore(f.Install, StableBackup, RestoredName); }
                    catch (Exception error) { actualError = error; }
                    var targetExists = File.Exists(targetPath);
                    var observation = $"actualError={actualError?.GetType().Name ?? "none"}: {actualError?.Message ?? "none"}; targetExists={targetExists}; archiveWriteDenied={archiveWriteDenied}";
                    Console.WriteLine("PROBE read-only archive directory: " + observation);
                    Check.Equal(originalHash, Fixture.Hash(original));
                    Check.Equal(backupHash, Fixture.Hash(backupPath));
                    Check.Equal(readOnlyDirectoryMode, File.GetUnixFileMode(backupDirectory));
                    Check.Equal(readOnlyFileMode, File.GetUnixFileMode(backupPath));
                    Check.True((File.GetAttributes(backupPath) & FileAttributes.ReadOnly) != 0,
                        "Restore removed the archived backup's read-only attribute.");
                    Check.True(actualError is null, "Recovery incorrectly required a writable backup directory: " + observation);
                    Check.True(targetExists, "Successful recovery did not produce its new copy: " + observation);
                    Check.True(restored is not null, "Successful recovery returned no inspection result.");
                    Check.Equal(knownGood.Copy.BookId, restored!.Source.BookId);
                    Check.Equal(knownGood.Copy.BookId, restored.Copy.BookId);
                    Check.Equal(knownGood.Copy.Revision, restored.Source.Revision);
                    Check.Equal(knownGood.Copy.Revision, restored.Copy.Revision);
                    Check.Equal(knownGood.Copy.SnapshotSha256, restored.Source.SnapshotSha256);
                    Check.Equal(knownGood.Copy.SnapshotSha256, restored.Copy.SnapshotSha256);
                }
                finally
                {
                    if (Directory.Exists(backupDirectory)) File.SetUnixFileMode(backupDirectory, directoryMode);
                    if (File.Exists(backupPath)) File.SetAttributes(backupPath, attributes);
                    if (File.Exists(archiveProbe)) File.Delete(archiveProbe);
                    if (File.Exists(targetProbe)) File.Delete(targetProbe);
                }
            });

            yield return ("valid read-only backup restores successfully without post-copy failure or source mutation", f =>
            {
                var original = Setup(f);
                var knownGood = BookOperations.Backup(f.Install, BookName, StableBackup);
                var backupPath = PathFor(f, StableBackup);
                var targetPath = PathFor(f, RestoredName);
                var originalHash = Fixture.Hash(original);
                var backupHash = Fixture.Hash(backupPath);
                var attributes = File.GetAttributes(backupPath);
                try
                {
                    File.SetAttributes(backupPath, attributes | FileAttributes.ReadOnly);
                    Exception? actualError = null;
                    BookCopyResult? restored = null;
                    try { restored = BookOperations.Restore(f.Install, StableBackup, RestoredName); }
                    catch (Exception error) { actualError = error; }
                    var targetExists = File.Exists(targetPath);
                    var observation = $"actualError={actualError?.GetType().Name ?? "none"}: {actualError?.Message ?? "none"}; targetExists={targetExists}";
                    Console.WriteLine("PROBE read-only valid backup: " + observation);
                    Check.Equal(originalHash, Fixture.Hash(original));
                    Check.Equal(backupHash, Fixture.Hash(backupPath));
                    Check.True((File.GetAttributes(backupPath) & FileAttributes.ReadOnly) != 0,
                        "Restore removed the read-only attribute from the existing backup.");
                    Check.True(actualError is null, "Valid read-only backup restore reported failure: " + observation);
                    Check.True(targetExists, "Successful restore did not create the new copy: " + observation);
                    Check.True(restored is not null, "Successful restore returned no copy inspection.");
                    Check.Equal(knownGood.Copy.BookId, restored!.Source.BookId);
                    Check.Equal(knownGood.Copy.BookId, restored.Copy.BookId);
                    Check.Equal(knownGood.Copy.Revision, restored.Copy.Revision);
                    Check.Equal(knownGood.Copy.SnapshotSha256, restored.Copy.SnapshotSha256);
                }
                finally { File.SetAttributes(backupPath, attributes); }
            });

            yield return ("adversarial trigger fixture passes integrity yet changes a later ordinary snapshot write", f =>
            {
                var original = Setup(f); CreateUntrustedCopy(f, TriggerSql);
                var controlledRestore = Path.Combine(f.Root, "unsafe-storage-control.caiwu");
                // Control deliberately bypasses Delivery: prove this is a meaningful malicious fixture,
                // rather than relying on a malformed SQL statement or a generic format rejection.
                SqliteLedgerStore.RestoreBackup(PathFor(f, MaliciousBackup), controlledRestore);
                using var control = SqliteLedgerStore.Open(controlledRestore);
                control.CheckIntegrity();
                var before = control.Read();
                Check.Equal(1234.56m, before.Accounts.Single(a => a.Code == "1002").OpeningDebit);
                Check.Equal(6, before.Vouchers.Sum(v => v.Lines.Count));
                control.Write(before with { Revision = before.Revision + 1 }, before.Revision);
                var after = control.Read(); control.CheckIntegrity();
                // Six normal voucher-line inserts, each maliciously adds 1,000,000 cents.
                Check.Equal(61234.56m, after.Accounts.Single(a => a.Code == "1002").OpeningDebit);
                Check.True(File.Exists(original), "The control unexpectedly removed the original fixture.");
            });

            yield return ("delivery rejects a schema-one trigger backup before creating any restored book", f =>
            {
                var original = Setup(f); CreateUntrustedCopy(f, TriggerSql);
                var originalHash = Fixture.Hash(original);
                var stableHash = Fixture.Hash(PathFor(f, StableBackup));
                var maliciousHash = Fixture.Hash(PathFor(f, MaliciousBackup));
                Check.Equal(1L, Scalar(PathFor(f, MaliciousBackup), "SELECT count(*) FROM sqlite_schema WHERE type='trigger'"));
                using (var validHeader = SqliteLedgerStore.Open(PathFor(f, MaliciousBackup))) validHeader.CheckIntegrity();
                Check.Reject(() => BookOperations.Restore(f.Install, MaliciousBackup, RestoredName));
                Check.True(!File.Exists(PathFor(f, RestoredName)), "Rejected malicious backup left a managed restored database.");
                Check.Equal(originalHash, Fixture.Hash(original));
                Check.Equal(stableHash, Fixture.Hash(PathFor(f, StableBackup)));
                Check.Equal(maliciousHash, Fixture.Hash(PathFor(f, MaliciousBackup)));
            });

            yield return ("delivery rejects an extra schema-one view rather than silently treating it as the supported layout", f =>
            {
                var original = Setup(f);
                CreateUntrustedCopy(f, "CREATE VIEW unexpected_report AS SELECT code, opening_debit_cents FROM accounts;");
                var originalHash = Fixture.Hash(original); var stableHash = Fixture.Hash(PathFor(f, StableBackup));
                Check.Equal(1L, Scalar(PathFor(f, MaliciousBackup), "SELECT count(*) FROM sqlite_schema WHERE type='view'"));
                Check.Reject(() => BookOperations.Restore(f.Install, MaliciousBackup, RestoredName));
                Check.True(!File.Exists(PathFor(f, RestoredName)), "Unsupported schema view propagated into a managed restored book.");
                Check.Equal(originalHash, Fixture.Hash(original)); Check.Equal(stableHash, Fixture.Hash(PathFor(f, StableBackup)));
            });

            yield return ("delivery backup refuses a trigger-bearing source without replacing a known good backup", f =>
            {
                var original = Setup(f);
                BookOperations.Backup(f.Install, BookName, StableBackup);
                var stableHash = Fixture.Hash(PathFor(f, StableBackup));
                Execute(original, TriggerSql);
                var poisonedSourceHash = Fixture.Hash(original);
                const string newBackup = ".delivery-backups/should-not-propagate-trigger.caiwu";
                Check.Reject(() => BookOperations.Backup(f.Install, BookName, newBackup));
                Check.True(!File.Exists(PathFor(f, newBackup)), "Untrusted source schema was propagated to a new backup.");
                Check.Equal(poisonedSourceHash, Fixture.Hash(original));
                Check.Equal(stableHash, Fixture.Hash(PathFor(f, StableBackup)));
                using var kept = SqliteLedgerStore.Open(PathFor(f, StableBackup)); kept.CheckIntegrity();
            });

            yield return ("future-schema backup is rejected while the valid older backup and original remain unchanged", f =>
            {
                var original = Setup(f); CreateUntrustedCopy(f, "PRAGMA user_version = 2;");
                Check.Equal(2L, Scalar(PathFor(f, MaliciousBackup), "PRAGMA user_version"));
                var originalHash = Fixture.Hash(original); var stableHash = Fixture.Hash(PathFor(f, StableBackup));
                var futureHash = Fixture.Hash(PathFor(f, MaliciousBackup));
                Check.Reject(() => BookOperations.Restore(f.Install, MaliciousBackup, RestoredName));
                Check.True(!File.Exists(PathFor(f, RestoredName)), "Future schema was installed as a restored book.");
                Check.Equal(originalHash, Fixture.Hash(original)); Check.Equal(stableHash, Fixture.Hash(PathFor(f, StableBackup)));
                Check.Equal(futureHash, Fixture.Hash(PathFor(f, MaliciousBackup)));
            });

            yield return ("explicit new-copy restore reports a different valid book identity and never substitutes the original", f =>
            {
                var original = Setup(f); var originalHash = Fixture.Hash(original);
                var foreignId = Guid.Parse("0b48648a-0b57-472d-9567-bd32f59ba572");
                var foreign = f.BookAt(Path.Combine(f.Data, "different-valid-book.caiwu"), foreignId);
                var foreignHash = Fixture.Hash(foreign);
                BookOperations.Backup(f.Install, "different-valid-book.caiwu", MaliciousBackup);
                var copy = BookOperations.Restore(f.Install, MaliciousBackup, RestoredName);
                Check.Equal(foreignId, copy.Source.BookId); Check.Equal(foreignId, copy.Copy.BookId);
                Check.True(copy.Copy.BookId != Fixture.OperationBookId, "Restore disguised a foreign identity as the active book.");
                Check.Equal(originalHash, Fixture.Hash(original)); Check.Equal(foreignHash, Fixture.Hash(foreign));
                // No expected-book identifier is supplied by this API. It may import a different book
                // into a NEW path; callers must not pretend this proves identity of an intended recovery.
            });

            yield return ("second-book preparation failure retains the completed first backup and all earlier valid backups", f =>
            {
                var first = f.OperationBook();
                Directory.CreateDirectory(Path.Combine(f.Data, ".delivery-backups"));
                var earlier = PathFor(f, StableBackup);
                using (var source = SqliteLedgerStore.Open(first)) source.BackupTo(earlier);
                var earlierHash = Fixture.Hash(earlier);
                var second = f.Book("second-future-schema.caiwu"); Execute(second, "PRAGMA user_version = 2;");
                var firstHash = Fixture.Hash(first); var secondHash = Fixture.Hash(second);
                var directoriesBefore = Directory.GetDirectories(Path.Combine(f.Data, ".delivery-backups")).ToHashSet();
                Check.Reject(() => UpgradeSafety.Prepare(f.Data, new[] { first, second }));
                Check.Equal(firstHash, Fixture.Hash(first)); Check.Equal(secondHash, Fixture.Hash(second)); Check.Equal(earlierHash, Fixture.Hash(earlier));
                var failedDirectory = Directory.GetDirectories(Path.Combine(f.Data, ".delivery-backups")).Single(d => !directoriesBefore.Contains(d));
                using var receipt = JsonDocument.Parse(File.ReadAllText(Path.Combine(failedDirectory, "backup-receipt.json")));
                Check.Equal("blocked", receipt.RootElement.GetProperty("status").GetString());
                Check.True(!receipt.RootElement.GetProperty("liveDatabasesModified").GetBoolean(), "Failure receipt claims live database mutation.");
                var entries = receipt.RootElement.GetProperty("entries"); Check.Equal(1, entries.GetArrayLength());
                Check.Equal(Fixture.OperationBookId, entries[0].GetProperty("id").GetGuid());
                var completed = entries[0].GetProperty("backup").GetString()!;
                Check.True(File.Exists(completed), "Completed first-book backup was discarded after a later book failed.");
                using var goodBackup = SqliteLedgerStore.Open(completed); goodBackup.CheckIntegrity();
                Check.Equal(Fixture.OperationBookId, goodBackup.Read().Book.Id);
            });

            yield return ("staged migration adding an unsupported trigger blocks preparation without mutating the live source", f =>
            {
                var original = f.OperationBook(); var originalHash = Fixture.Hash(original);
                var migrationReached = false;
                Check.Reject(() => UpgradeSafety.Prepare(f.Data, new[] { original }, stage =>
                {
                    Execute(stage, TriggerSql); migrationReached = true;
                }));
                Check.True(migrationReached, "Migration did not run, so this did not exercise the post-migration schema boundary.");
                Check.Equal(originalHash, Fixture.Hash(original));
                var directory = Directory.GetDirectories(Path.Combine(f.Data, ".delivery-backups")).Single();
                using var receipt = JsonDocument.Parse(File.ReadAllText(Path.Combine(directory, "backup-receipt.json")));
                Check.Equal("blocked", receipt.RootElement.GetProperty("status").GetString());
                Check.True(File.Exists(Path.Combine(directory, "book-0000.caiwu")), "Validated pre-migration backup was lost.");
                using var intact = SqliteLedgerStore.Open(Path.Combine(directory, "book-0000.caiwu")); intact.CheckIntegrity();
                Check.Equal(Fixture.OperationBookId, intact.Read().Book.Id);
            });
        }
    }

    private static string Setup(Fixture f)
    {
        var original = f.OperationBook();
        Installation.Install(f.Payload("0.1.0.1"), f.Install, f.Data);
        return original;
    }
    private static void CreateUntrustedCopy(Fixture f, string change)
    {
        BookOperations.Backup(f.Install, BookName, StableBackup);
        File.Copy(PathFor(f, StableBackup), PathFor(f, MaliciousBackup));
        Execute(PathFor(f, MaliciousBackup), change);
    }
    private static string PathFor(Fixture f, string relative) => Path.Combine(f.Data, relative.Replace('/', Path.DirectorySeparatorChar));
    private static void Execute(string path, string sql)
    {
        using var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Mode = SqliteOpenMode.ReadWrite, Pooling = false }.ToString());
        connection.Open(); using var command = connection.CreateCommand(); command.CommandText = sql; command.ExecuteNonQuery();
    }
    private static long Scalar(string path, string sql)
    {
        using var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Mode = SqliteOpenMode.ReadOnly, Pooling = false }.ToString());
        connection.Open(); using var command = connection.CreateCommand(); command.CommandText = sql; return (long)command.ExecuteScalar()!;
    }
}
