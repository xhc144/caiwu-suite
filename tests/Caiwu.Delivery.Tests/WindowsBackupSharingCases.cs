using System.Security.Cryptography;
using System.Text.Json;
using Caiwu.Delivery;
using Caiwu.Persistence.Sqlite;
using Microsoft.Data.Sqlite;

internal static class WindowsBackupSharingCases
{
    private const string Book = "synthetic.caiwu";
    private const string Backup = ".delivery-backups/sharing.caiwu";

    public static IEnumerable<(string Name, Action<Fixture> Action)> All
    {
        get
        {
            yield return ("sharing: Windows strict hash rejects an open SQLite writer and succeeds after disposal", f =>
            {
                if (!OperatingSystem.IsWindows()) throw new TestSkipped("Requires native Windows file-sharing semantics.");
                var path = f.Book();
                IOException? sharing = null;
                using (var store = SqliteLedgerStore.Open(path))
                {
                    try { _ = PayloadManifest.Hash(path); }
                    catch (IOException error) { sharing = error; }
                    Check.True(sharing is not null, "Hash unexpectedly allowed an existing SQLite write handle.");
                    Check.Equal(32, sharing!.HResult & 0xffff);
                    _ = store.Read(); // The writer really is live; it was not disposed just for the probe.
                }
                Check.Equal(Fixture.Hash(path).ToLowerInvariant(), PayloadManifest.Hash(path));
                Console.WriteLine("SHARING-EVIDENCE " + JsonSerializer.Serialize(new
                { win32Error = sharing!.HResult & 0xffff, hashAfterDispose = true, relaxedProductionFileShare = false }));
            });

            yield return ("sharing: upgrade receipt hashes a closed self-contained backup with committed WAL content", f =>
            {
                var path = f.Book();
                using var writer = WalWriter(path);
                Commit(writer, 2, 98765);
                var before = Bytes(path);
                using var preparation = UpgradeSafety.Prepare(f.Data, [path]);
                using var receipt = JsonDocument.Parse(File.ReadAllText(Path.Combine(preparation.BackupDirectory, "backup-receipt.json")));
                Check.Equal("validated", receipt.RootElement.GetProperty("status").GetString());
                var entry = receipt.RootElement.GetProperty("entries")[0];
                var backup = entry.GetProperty("backup").GetString()!;
                Check.Equal(2L, entry.GetProperty("revision").GetInt64());
                Check.Equal(PayloadManifest.Hash(backup), entry.GetProperty("sha256").GetString());
                Standalone(backup, 2, 987.65m);
                Check.Equal(before, Bytes(path));
                // No SQLite backup or stage handle may escape Prepare; Windows enforces this.
                using var backupHandle = new FileStream(backup, FileMode.Open, FileAccess.Read, FileShare.None);
                using var stageHandle = new FileStream(preparation.StagedDatabases.Single(), FileMode.Open, FileAccess.Read, FileShare.None);
            });

            yield return ("sharing: inspection reads the committed snapshot while a WAL write transaction remains open", f =>
            {
                var path = Setup(f);
                using var writer = WalWriter(path);
                Commit(writer, 3, 123556);
                Execute(writer, "BEGIN IMMEDIATE; UPDATE ledger SET revision=4; UPDATE accounts SET opening_debit_cents=999999 WHERE code='1002';");
                try
                {
                    var before = Bytes(path);
                    var inspected = BookOperations.Inspect(f.Install, Book);
                    Check.Equal(3L, inspected.Revision);
                    Check.Equal<decimal?>(1315.71m, inspected.BankBalance);
                    Check.Equal("sqlite-consistent-copy", inspected.FileSha256Basis);
                    Check.Equal(before, Bytes(path));
                    Check.True(!Directory.EnumerateFiles(Path.Combine(f.Data, ".delivery-scratch")).Any(), "Inspection leaked a scratch snapshot.");
                    Console.WriteLine("SHARING-EVIDENCE " + JsonSerializer.Serialize(new
                    { inspected.Revision, inspected.BankBalance, inspected.FileSha256Basis, uncommittedRevision = 4, sourceMainAndWalUnchanged = true }));
                }
                finally { Execute(writer, "ROLLBACK"); }
            });

            yield return ("sharing: backup binds its source report and output to one committed snapshot during a WAL write", f =>
            {
                var path = Setup(f);
                using var writer = WalWriter(path);
                Commit(writer, 3, 123556);
                Execute(writer, "BEGIN IMMEDIATE; UPDATE ledger SET revision=4; UPDATE accounts SET opening_debit_cents=999999 WHERE code='1002';");
                BookCopyResult result;
                try
                {
                    var before = Bytes(path);
                    result = BookOperations.Backup(f.Install, Book, Backup);
                    Check.Equal(3L, result.Source.Revision); Check.Equal(3L, result.Copy.Revision);
                    Check.Equal<decimal?>(1315.71m, result.Copy.BankBalance);
                    Check.Equal(result.Source.SnapshotSha256, result.Copy.SnapshotSha256);
                    Check.Equal("sqlite-consistent-copy", result.Source.FileSha256Basis);
                    Check.Equal("database-file", result.Copy.FileSha256Basis);
                    Check.Equal(PayloadManifest.Hash(result.Copy.DatabasePath), result.Copy.FileSha256);
                    Standalone(result.Copy.DatabasePath, 3, 1235.56m);
                    Check.Equal(before, Bytes(path));
                }
                finally { Execute(writer, "ROLLBACK"); }
                var savedHash = PayloadManifest.Hash(result.Copy.DatabasePath);
                Commit(writer, 4, 88888);
                var restored = BookOperations.Restore(f.Install, Backup, "sharing-restored.caiwu");
                Check.Equal(3L, restored.Copy.Revision);
                Check.Equal(result.Copy.SnapshotSha256, restored.Copy.SnapshotSha256);
                Check.Equal(savedHash, PayloadManifest.Hash(result.Copy.DatabasePath));
            });

            yield return ("sharing: failed source access creates no backup and preserves old valid backup and unrelated scratch", f =>
            {
                if (!OperatingSystem.IsWindows()) throw new TestSkipped("The native SQLite source must honor Windows FileShare.None; POSIX native opens do not use this .NET sharing gate.");
                var path = Setup(f);
                var old = BookOperations.Backup(f.Install, Book, Backup);
                var savedHash = PayloadManifest.Hash(old.Copy.DatabasePath);
                var original = Fixture.Hash(path);
                var scratch = Path.Combine(f.Data, ".delivery-scratch"); Directory.CreateDirectory(scratch);
                var unrelated = Path.Combine(scratch, "do-not-remove.txt"); File.WriteAllText(unrelated, "unrelated scratch sentinel");
                using (var held = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
                    Check.Reject(() => BookOperations.Backup(f.Install, Book, ".delivery-backups/blocked-sharing.caiwu"));
                Check.True(!File.Exists(Path.Combine(f.Data, ".delivery-backups", "blocked-sharing.caiwu")), "Failure published a backup.");
                Check.Equal(savedHash, PayloadManifest.Hash(old.Copy.DatabasePath)); Check.Equal(original, Fixture.Hash(path));
                Check.Equal("unrelated scratch sentinel", File.ReadAllText(unrelated));
                Check.Equal(1, Directory.GetFiles(scratch).Length);
            });

            yield return ("sharing: strict payload hashing still refuses a conflicting Windows write handle", f =>
            {
                if (!OperatingSystem.IsWindows()) throw new TestSkipped("Requires native Windows file-sharing semantics.");
                var payload = f.Payload("0.1.0.1");
                var manifest = PayloadManifest.Read(Path.Combine(payload, Fixture.ManifestName));
                using (var held = new FileStream(Path.Combine(payload, "support.dll"), FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite))
                    Check.Reject(() => manifest.Verify(payload));
                manifest.Verify(payload);
            });
        }
    }

    private static string Setup(Fixture f)
    {
        var path = f.OperationBook();
        Installation.Install(f.Payload("0.1.0.1"), f.Install, f.Data);
        return path;
    }

    private static SqliteConnection WalWriter(string path)
    {
        var db = new SqliteConnection(new SqliteConnectionStringBuilder
        { DataSource = path, Pooling = false, DefaultTimeout = 2 }.ToString());
        db.Open();
        Execute(db, "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;");
        return db;
    }

    private static void Commit(SqliteConnection db, long revision, long cents) => Execute(db,
        $"BEGIN IMMEDIATE; UPDATE ledger SET revision={revision}; UPDATE accounts SET opening_debit_cents={cents} WHERE code='1002'; UPDATE accounts SET opening_credit_cents={cents} WHERE code='4001'; COMMIT;");

    private static void Execute(SqliteConnection db, string sql)
    { using var command = db.CreateCommand(); command.CommandText = sql; command.ExecuteNonQuery(); }

    private static void Standalone(string path, long revision, decimal balance)
    {
        foreach (var suffix in new[] { "-wal", "-shm", "-journal" })
            Check.True(!File.Exists(path + suffix), "Published backup depends on a SQLite sidecar.");
        using var store = SqliteLedgerStore.Open(path);
        store.CheckIntegrity(); var snapshot = store.Read();
        Check.Equal(revision, snapshot.Revision);
        Check.Equal(balance, snapshot.Accounts.Single(x => x.Code == "1002").OpeningDebit);
        Check.Equal(balance, snapshot.Accounts.Single(x => x.Code == "4001").OpeningCredit);
    }

    // Forensic before/after byte observations of a paused synthetic writer only. These raw main/WAL
    // hashes are not accepted as a consistent database fingerprint by any production operation.
    private static string Bytes(string path) => string.Join(":", new[] { "", "-wal" }.Select(suffix =>
    {
        using var file = new FileStream(path + suffix, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        return Convert.ToHexString(SHA256.HashData(file));
    }));
}
