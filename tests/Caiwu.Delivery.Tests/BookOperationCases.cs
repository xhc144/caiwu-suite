using System.Text.Json.Nodes;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Diagnostics;
using Caiwu.Contracts;
using Caiwu.Delivery;
using Caiwu.Persistence.Sqlite;
using Microsoft.Data.Sqlite;

internal static class BookOperationCases
{
    private const string BookName = "synthetic.caiwu";
    private const string BackupName = ".delivery-backups/cli-sample.caiwu";
    private const string RestoredName = "restored-copy.caiwu";

    public static IEnumerable<(string Name, Action<Fixture> Action)> All
    {
        get
        {
            yield return ("book inspection reports independent posted-only bank balance and identity", f =>
            {
                var book = Setup(f); var original = Fixture.Hash(book);
                var inspection = BookOperations.Inspect(f.Install, BookName);
                ExpectedSample(inspection);
                Check.Equal(Path.GetFullPath(book), inspection.DatabasePath);
                Check.Equal(original, inspection.FileSha256.ToUpperInvariant());
                Check.Equal(original, Fixture.Hash(book));
            });
            yield return ("book backup preserves semantic content and leaves the original byte-identical", f =>
            {
                var book = Setup(f); var original = Fixture.Hash(book);
                var result = BookOperations.Backup(f.Install, BookName, BackupName);
                ExpectedSample(result.Source); ExpectedSample(result.Copy); SameSnapshot(result.Source, result.Copy);
                Check.Equal(Path.Combine(f.Data, ".delivery-backups", "cli-sample.caiwu"), result.Copy.DatabasePath);
                Check.Equal(Fixture.Hash(result.Copy.DatabasePath), result.Copy.FileSha256.ToUpperInvariant());
                Check.Equal(original, Fixture.Hash(book));
                using var backup = SqliteLedgerStore.Open(result.Copy.DatabasePath); backup.CheckIntegrity();
            });
            yield return ("book restore creates a complete new copy and leaves source plus backup unchanged", f =>
            {
                var book = Setup(f); var original = Fixture.Hash(book);
                var backup = BookOperations.Backup(f.Install, BookName, BackupName);
                var backupHash = Fixture.Hash(backup.Copy.DatabasePath);
                var restored = BookOperations.Restore(f.Install, BackupName, RestoredName);
                ExpectedSample(restored.Copy); SameSnapshot(backup.Copy, restored.Source); SameSnapshot(backup.Copy, restored.Copy);
                Check.Equal(Path.Combine(f.Data, RestoredName), restored.Copy.DatabasePath);
                Check.Equal(Fixture.Hash(restored.Copy.DatabasePath), restored.Copy.FileSha256.ToUpperInvariant());
                Check.Equal(original, Fixture.Hash(book)); Check.Equal(backupHash, Fixture.Hash(backup.Copy.DatabasePath));
                using var copy = SqliteLedgerStore.Open(restored.Copy.DatabasePath);
                Check.Equal(3, copy.Read().Vouchers.Count); copy.CheckIntegrity();
            });
            yield return ("book semantic fingerprint changes when audit content changes", f =>
            {
                var book = Setup(f);
                var before = BookOperations.Inspect(f.Install, BookName);
                using (var store = SqliteLedgerStore.Open(book))
                {
                    var snapshot = store.Read();
                    store.Write(snapshot with
                    {
                        Revision = 3,
                        AuditEvents = snapshot.AuditEvents.Append(new AuditEvent(Guid.NewGuid(), snapshot.Book.CreatedAt,
                            "交付测试", "追加合成审计", null, "fingerprint must cover audit content")).ToArray()
                    }, 2);
                }
                var after = BookOperations.Inspect(f.Install, BookName);
                Check.Equal(3L, after.Revision);
                Check.True(before.SnapshotSha256 != after.SnapshotSha256, "Semantic fingerprint did not change after the snapshot changed.");
                Check.Equal(before.BankBalance, after.BankBalance);
            });
            yield return ("book backup cannot overwrite an existing backup target", f =>
            {
                var book = Setup(f); var original = Fixture.Hash(book);
                var occupied = BackupPath(f); Directory.CreateDirectory(Path.GetDirectoryName(occupied)!);
                File.WriteAllText(occupied, "existing backup sentinel");
                Check.Reject(() => BookOperations.Backup(f.Install, BookName, BackupName));
                Check.Equal("existing backup sentinel", File.ReadAllText(occupied)); Check.Equal(original, Fixture.Hash(book));
            });
            yield return ("book restore cannot overwrite the original live book", f =>
            {
                var book = Setup(f); var original = Fixture.Hash(book);
                var backup = BookOperations.Backup(f.Install, BookName, BackupName); var backupHash = Fixture.Hash(backup.Copy.DatabasePath);
                Check.Reject(() => BookOperations.Restore(f.Install, BackupName, BookName));
                Check.Equal(original, Fixture.Hash(book)); Check.Equal(backupHash, Fixture.Hash(backup.Copy.DatabasePath));
            });
            yield return ("book restore cannot overwrite another existing destination", f =>
            {
                Setup(f); BookOperations.Backup(f.Install, BookName, BackupName);
                var occupied = Path.Combine(f.Data, RestoredName); File.WriteAllText(occupied, "user-owned destination sentinel");
                Check.Reject(() => BookOperations.Restore(f.Install, BackupName, RestoredName));
                Check.Equal("user-owned destination sentinel", File.ReadAllText(occupied));
            });
            yield return ("book backup destination must be inside the protected backup directory", f =>
            {
                Setup(f);
                Check.Reject(() => BookOperations.Backup(f.Install, BookName, "outside-backup.caiwu"));
                Check.True(!File.Exists(Path.Combine(f.Data, "outside-backup.caiwu")), "Backup was written outside its protected directory.");
            });
            yield return ("book restore source must come from the protected backup directory", f =>
            {
                Setup(f);
                Check.Reject(() => BookOperations.Restore(f.Install, BookName, RestoredName));
                Check.True(!File.Exists(Path.Combine(f.Data, RestoredName)), "An ordinary live book was accepted as the restore source.");
            });
            yield return ("book restore destination cannot be inside protected backups", f =>
            {
                Setup(f); BookOperations.Backup(f.Install, BookName, BackupName);
                Check.Reject(() => BookOperations.Restore(f.Install, BackupName, ".delivery-backups/not-a-live-book.caiwu"));
                Check.True(!File.Exists(Path.Combine(f.Data, ".delivery-backups", "not-a-live-book.caiwu")), "Restore wrote its live copy into backups.");
            });
            yield return ("book operations reject traversal to an existing external database", f =>
            {
                Setup(f); var outside = f.BookAt(Path.Combine(f.Root, "outside.caiwu")); var hash = Fixture.Hash(outside);
                Check.Reject(() => BookOperations.Inspect(f.Install, "../outside.caiwu"));
                Check.Reject(() => BookOperations.Backup(f.Install, "../outside.caiwu", BackupName));
                Check.Equal(hash, Fixture.Hash(outside));
            });
            yield return ("book operations accept only relative managed paths", f =>
            {
                var book = Setup(f); var hash = Fixture.Hash(book);
                Check.Reject(() => BookOperations.Inspect(f.Install, book));
                Check.Reject(() => BookOperations.Backup(f.Install, book, BackupName));
                Check.Equal(hash, Fixture.Hash(book));
            });
            yield return ("book inspection and backup reject a linked source database", f =>
            {
                Setup(f); var outside = f.BookAt(Path.Combine(f.Root, "outside.caiwu")); var hash = Fixture.Hash(outside);
                f.FileLink(Path.Combine(f.Data, "linked.caiwu"), outside);
                Check.Reject(() => BookOperations.Inspect(f.Install, "linked.caiwu"));
                Check.Reject(() => BookOperations.Backup(f.Install, "linked.caiwu", BackupName));
                Check.Equal(hash, Fixture.Hash(outside));
            });
            yield return ("book backup rejects a linked destination ancestor", f =>
            {
                Setup(f);
                var outside = Directory.CreateDirectory(Path.Combine(f.Root, "outside-backups")).FullName;
                Directory.CreateDirectory(Path.Combine(f.Data, ".delivery-backups"));
                f.DirectoryLink(Path.Combine(f.Data, ".delivery-backups", "redirect"), outside);
                Check.Reject(() => BookOperations.Backup(f.Install, BookName, ".delivery-backups/redirect/escape.caiwu"));
                Check.True(!File.Exists(Path.Combine(outside, "escape.caiwu")), "Backup escaped through a linked ancestor.");
            });
            yield return ("book restore rejects a linked backup source", f =>
            {
                Setup(f); var outside = f.BookAt(Path.Combine(f.Root, "outside.caiwu")); var hash = Fixture.Hash(outside);
                Directory.CreateDirectory(Path.Combine(f.Data, ".delivery-backups"));
                f.FileLink(Path.Combine(f.Data, ".delivery-backups", "linked.caiwu"), outside);
                Check.Reject(() => BookOperations.Restore(f.Install, ".delivery-backups/linked.caiwu", RestoredName));
                Check.Equal(hash, Fixture.Hash(outside));
                Check.True(!File.Exists(Path.Combine(f.Data, RestoredName)), "Linked backup source was restored.");
            });
            yield return ("book restore rejects a destination link without touching its external target", f =>
            {
                Setup(f); BookOperations.Backup(f.Install, BookName, BackupName);
                var outside = Path.Combine(f.Root, "outside-owned-file.caiwu"); File.WriteAllText(outside, "external destination sentinel");
                f.FileLink(Path.Combine(f.Data, RestoredName), outside);
                Check.Reject(() => BookOperations.Restore(f.Install, BackupName, RestoredName));
                Check.Equal("external destination sentinel", File.ReadAllText(outside));
            });
            yield return ("an active installation lease blocks every book operation", f =>
            {
                var book = Setup(f); var original = Fixture.Hash(book); BookOperations.Backup(f.Install, BookName, BackupName);
                using (Installation.AcquireLease(f.Install)) RejectAll(f);
                Check.Equal(original, Fixture.Hash(book)); Check.True(!File.Exists(Path.Combine(f.Data, RestoredName)), "Busy restore created a destination.");
            });
            yield return ("an active data-root lease blocks every book operation", f =>
            {
                var book = Setup(f); var original = Fixture.Hash(book); BookOperations.Backup(f.Install, BookName, BackupName);
                using (var lease = new FileStream(Path.Combine(f.Data, ".delivery-data.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None)) RejectAll(f);
                Check.Equal(original, Fixture.Hash(book)); Check.True(!File.Exists(Path.Combine(f.Data, RestoredName)), "Busy restore created a destination.");
            });
            yield return ("uninstalled applications cannot use retained data through book operations", f =>
            {
                var book = Setup(f); var original = Fixture.Hash(book); BookOperations.Backup(f.Install, BookName, BackupName);
                Installation.Uninstall(f.Install); RejectAll(f);
                Check.Equal(original, Fixture.Hash(book));
            });
            yield return ("book operations require the retained data ownership receipt", f =>
            {
                var book = Setup(f); var original = Fixture.Hash(book); BookOperations.Backup(f.Install, BookName, BackupName);
                File.Delete(Path.Combine(f.Data, Installation.DataOwnerFile)); RejectAll(f);
                Check.Equal(original, Fixture.Hash(book));
            });
            yield return ("book operations refuse disagreeing active and data receipt versions", f =>
            {
                var book = Setup(f); var original = Fixture.Hash(book); BookOperations.Backup(f.Install, BookName, BackupName);
                var receiptPath = Path.Combine(f.Data, Installation.DataOwnerFile);
                var receipt = JsonNode.Parse(File.ReadAllText(receiptPath))!; receipt["version"] = "0.1.0.99";
                File.WriteAllText(receiptPath, receipt.ToJsonString()); RejectAll(f);
                Check.Equal(original, Fixture.Hash(book));
            });
            yield return ("missing book operations do not initialize an empty source database", f =>
            {
                Setup(f);
                Check.Reject(() => BookOperations.Inspect(f.Install, "missing.caiwu"));
                Check.Reject(() => BookOperations.Backup(f.Install, "missing.caiwu", BackupName));
                Check.True(!File.Exists(Path.Combine(f.Data, "missing.caiwu")), "A missing book was initialized.");
                Check.True(!File.Exists(BackupPath(f)), "A missing source produced a backup.");
            });
            yield return ("corrupt backup cannot create a restored book", f =>
            {
                var book = Setup(f); var original = Fixture.Hash(book);
                Directory.CreateDirectory(Path.Combine(f.Data, ".delivery-backups")); File.WriteAllText(BackupPath(f), "corrupt synthetic backup");
                Check.Reject(() => BookOperations.Restore(f.Install, BackupName, RestoredName));
                Check.True(!File.Exists(Path.Combine(f.Data, RestoredName)), "Corrupt backup created a restored destination.");
                Check.Equal("corrupt synthetic backup", File.ReadAllText(BackupPath(f))); Check.Equal(original, Fixture.Hash(book));
            });
            yield return ("corrupt live book is rejected without creating a backup", f =>
            {
                var book = Setup(f); File.WriteAllText(book, "corrupt synthetic source");
                Check.Reject(() => BookOperations.Inspect(f.Install, BookName));
                Check.Reject(() => BookOperations.Backup(f.Install, BookName, BackupName));
                Check.Equal("corrupt synthetic source", File.ReadAllText(book));
                Check.True(!File.Exists(BackupPath(f)), "Corrupt source produced a backup.");
            });
            yield return ("book backup and restore include committed WAL data", f =>
            {
                var book = Setup(f);
                using var writer = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = book, Pooling = false }.ToString());
                writer.Open();
                using (var command = writer.CreateCommand())
                {
                    command.CommandText = "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;"; command.ExecuteNonQuery();
                    command.CommandText = "BEGIN IMMEDIATE; UPDATE ledger SET revision=3; UPDATE accounts SET opening_debit_cents=123556 WHERE code='1002'; UPDATE accounts SET opening_credit_cents=123556 WHERE code='4001'; COMMIT;";
                    command.ExecuteNonQuery();
                }
                Check.True(File.Exists(book + "-wal"), "The fixture did not establish a WAL-backed book.");
                var backup = BookOperations.Backup(f.Install, BookName, BackupName);
                Check.Equal(3L, backup.Copy.Revision); Check.Equal<decimal?>(1315.71m, backup.Copy.BankBalance); SameSnapshot(backup.Source, backup.Copy);
                var restored = BookOperations.Restore(f.Install, BackupName, RestoredName);
                Check.Equal(3L, restored.Copy.Revision); Check.Equal<decimal?>(1315.71m, restored.Copy.BankBalance); SameSnapshot(backup.Copy, restored.Copy);
            });
            yield return ("ambiguous bank names do not prevent inspection backup or restore", f =>
            {
                var book = Setup(f);
                using (var store = SqliteLedgerStore.Open(book))
                {
                    var before = store.Read();
                    store.Write(before with
                    {
                        Revision = 3,
                        Accounts = before.Accounts.Append(new Account("1003", "银行存款", null, BalanceDirection.Debit, true, 10m, 0m)).ToArray()
                    }, 2);
                }
                var original = Fixture.Hash(book);
                var inspected = BookOperations.Inspect(f.Install, BookName);
                Check.Equal<decimal?>(null, inspected.BankBalance); Check.Equal(3L, inspected.Revision);
                var backup = BookOperations.Backup(f.Install, BookName, BackupName);
                Check.Equal<decimal?>(null, backup.Copy.BankBalance); SameSnapshot(inspected, backup.Copy);
                var restored = BookOperations.Restore(f.Install, BackupName, RestoredName);
                Check.Equal<decimal?>(null, restored.Copy.BankBalance); SameSnapshot(inspected, restored.Copy);
                Check.Equal(original, Fixture.Hash(book));
            });
            yield return ("host-built managed CLI inspects backs up and restores JSON using paths containing spaces", f =>
            {
                var book = Setup(f);
                const string sourceName = "books with spaces/合成账套.caiwu";
                const string backupName = ".delivery-backups/backup with spaces.caiwu";
                const string restoredName = "restored copies/恢复账套.caiwu";
                var source = Path.Combine(f.Data, "books with spaces", "合成账套.caiwu");
                Directory.CreateDirectory(Path.GetDirectoryName(source)!); File.Move(book, source);
                var original = Fixture.Hash(source);
                var inspect = SuccessfulCli<BookInspection>("inspect-book", f.Install, sourceName); ExpectedSample(inspect);
                var backup = SuccessfulCli<BookCopyResult>("backup-book", f.Install, sourceName, backupName);
                ExpectedSample(backup.Copy); SameSnapshot(inspect, backup.Copy);
                var restored = SuccessfulCli<BookCopyResult>("restore-book", f.Install, backupName, restoredName);
                ExpectedSample(restored.Copy); SameSnapshot(inspect, restored.Copy);
                Check.Equal(Path.Combine(f.Data, "restored copies", "恢复账套.caiwu"), restored.Copy.DatabasePath);
                Check.Equal(original, Fixture.Hash(source));
            });
            yield return ("host-built managed CLI rejects invalid argument count with nonzero exit", f =>
            {
                Setup(f);
                var result = RunCli("inspect-book", f.Install);
                Check.True(result.ExitCode != 0, "CLI accepted an incomplete inspect command.");
                Check.True(string.IsNullOrWhiteSpace(result.Output), "Rejected CLI command emitted success JSON.");
                Check.True(!string.IsNullOrWhiteSpace(result.Error), "Rejected CLI command did not report an error.");
            });
            yield return ("host-built managed CLI applies backup destination safety without writing a result", f =>
            {
                var book = Setup(f); var original = Fixture.Hash(book);
                var result = RunCli("backup-book", f.Install, BookName, "not-protected.caiwu");
                Check.True(result.ExitCode != 0, "CLI bypassed the backup directory rule.");
                Check.True(string.IsNullOrWhiteSpace(result.Output), "Rejected backup emitted success JSON.");
                Check.True(!File.Exists(Path.Combine(f.Data, "not-protected.caiwu")), "Unsafe CLI backup created a file.");
                Check.Equal(original, Fixture.Hash(book));
            });
            yield return ("host-built managed CLI respects the parent process installation lease", f =>
            {
                var book = Setup(f); var original = Fixture.Hash(book);
                using (Installation.AcquireLease(f.Install))
                {
                    var result = RunCli("inspect-book", f.Install, BookName);
                    Check.True(result.ExitCode != 0, "Child CLI ignored an installation lease held by its parent.");
                    Check.True(string.IsNullOrWhiteSpace(result.Output), "Busy CLI emitted an inspection result.");
                }
                Check.Equal(original, Fixture.Hash(book));
            });
        }
    }

    private static string Setup(Fixture fixture)
    {
        var book = fixture.OperationBook();
        Installation.Install(fixture.Payload("0.1.0.1"), fixture.Install, fixture.Data);
        return book;
    }
    private static string BackupPath(Fixture fixture) => Path.Combine(fixture.Data, ".delivery-backups", "cli-sample.caiwu");
    private static void RejectAll(Fixture fixture)
    {
        Check.Reject(() => BookOperations.Inspect(fixture.Install, BookName));
        Check.Reject(() => BookOperations.Backup(fixture.Install, BookName, ".delivery-backups/blocked.caiwu"));
        Check.Reject(() => BookOperations.Restore(fixture.Install, BackupName, RestoredName));
        Check.True(!File.Exists(Path.Combine(fixture.Data, ".delivery-backups", "blocked.caiwu")), "Rejected operation created a backup.");
    }
    private static void ExpectedSample(BookInspection inspection)
    {
        Check.Equal(Fixture.OperationBookId, inspection.BookId); Check.Equal(2L, inspection.Revision);
        Check.Equal(3, inspection.VoucherCount); Check.Equal(2, inspection.PostedVoucherCount);
        // Independent arithmetic: 1234.56 + 100.25 - 20.10 = 1314.71; Draft 999.99 is excluded.
        Check.Equal<decimal?>(1314.71m, inspection.BankBalance);
        Check.True(Regex.IsMatch(inspection.SnapshotSha256, "^[0-9a-fA-F]{64}$"), "Snapshot fingerprint is not SHA256.");
        Check.True(Regex.IsMatch(inspection.FileSha256, "^[0-9a-fA-F]{64}$"), "File fingerprint is not SHA256.");
    }
    private static void SameSnapshot(BookInspection source, BookInspection copy)
    {
        Check.Equal(source.BookId, copy.BookId); Check.Equal(source.Revision, copy.Revision);
        Check.Equal(source.VoucherCount, copy.VoucherCount); Check.Equal(source.PostedVoucherCount, copy.PostedVoucherCount);
        Check.Equal(source.BankBalance, copy.BankBalance); Check.Equal(source.SnapshotSha256, copy.SnapshotSha256);
    }

    // Execute only the managed DLL built for this test host. This never launches a published win-x64 artifact.
    private static CliResult RunCli(params string[] arguments)
    {
        var assembly = typeof(BookOperations).Assembly.Location;
        Check.True(File.Exists(Path.ChangeExtension(assembly, ".runtimeconfig.json")), "Host-built CLI runtime configuration is missing.");
        var host = Environment.GetEnvironmentVariable("DOTNET_HOST_PATH");
        var start = new ProcessStartInfo(string.IsNullOrWhiteSpace(host) ? "dotnet" : host)
        { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
        start.ArgumentList.Add(assembly);
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Managed CLI process did not start.");
        var output = process.StandardOutput.ReadToEndAsync(); var error = process.StandardError.ReadToEndAsync();
        if (!process.WaitForExit(30000))
        {
            process.Kill(entireProcessTree: true); process.WaitForExit();
            throw new InvalidOperationException("Synthetic managed CLI process timed out.");
        }
        return new(process.ExitCode, output.GetAwaiter().GetResult(), error.GetAwaiter().GetResult());
    }
    private static T SuccessfulCli<T>(params string[] arguments)
    {
        var result = RunCli(arguments);
        Check.True(result.ExitCode == 0, $"Managed CLI failed ({result.ExitCode}): {result.Error}");
        return JsonSerializer.Deserialize<T>(result.Output, PayloadManifest.Json) ?? throw new InvalidOperationException("CLI emitted no result JSON.");
    }
    private sealed record CliResult(int ExitCode, string Output, string Error);
}
