using Caiwu.Contracts;
using Caiwu.Persistence.Sqlite;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Caiwu.Persistence.Sqlite.Tests;

public sealed class ModuleJournalRetentionTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "caiwu-journal-" + Guid.NewGuid().ToString("N"));
    public ModuleJournalRetentionTests() => Directory.CreateDirectory(directory);
    public void Dispose() => Directory.Delete(directory, true);

    private SqliteLedgerStore Create(string name = "synthetic") => SqliteLedgerStore.Create(Path.Combine(directory, name + ".caiwu"),
        new(Guid.NewGuid(), "合成模块事件账套", AccountingRegime.Enterprise, "synthetic", 2026, 1, 0, DateTimeOffset.UtcNow),
        [new("1001", "现金", null, BalanceDirection.Debit, true, 0, 0)]);

    private static LedgerSnapshot Seed(SqliteLedgerStore store)
    {
        var before = store.Read();
        store.Write(before with { Revision = 1, AuditEvents =
            [new(Guid.NewGuid(), DateTimeOffset.UtcNow, "synthetic", "ordinary", null, "显示审计"),
             new(Guid.NewGuid(), DateTimeOffset.UtcNow, "synthetic", "ParityModuleCommit.v1", null, "{\"opaque\":\"保留原列\"}")] }, 0);
        return store.Read();
    }

    [Fact]
    public void SnapshotWriterCannotPruneRewriteOrReorderAuthoritativeJournal()
    {
        using var store = Create(); var before = Seed(store);
        foreach (var events in new IReadOnlyList<AuditEvent>[]
        {
            [], [before.AuditEvents[0]], [before.AuditEvents[1]],
            [before.AuditEvents[0], before.AuditEvents[1] with { Detail = "{}" }],
            [before.AuditEvents[0], before.AuditEvents[1] with { At = before.AuditEvents[1].At.ToOffset(TimeSpan.FromHours(1)) }]
        })
            Assert.Throws<LedgerValidationException>(() => store.Write(before with { Revision = 2, AuditEvents = events }, 1));
        Assert.Equal(before.AuditEvents, store.Read().AuditEvents);
        Assert.Equal(1, store.Read().Revision);
    }

    [Fact]
    public void OrdinaryLedgerWritePreservesReservedEventsAtTheirOriginalOrdinals()
    {
        using var store = Create(); var before = Seed(store);
        store.Write(before with { Revision = 2, AuditEvents = before.AuditEvents.Append(
            new(Guid.NewGuid(), DateTimeOffset.UtcNow, "synthetic", "SaveDraft", null, "普通账务操作")).ToArray() }, 1);
        Assert.Equal(before.AuditEvents[1], store.Read().AuditEvents[1]);
        Assert.Equal(2L, Scalar(store.DatabasePath, "SELECT ordinal FROM audit_events WHERE action='SaveDraft'"));
        Assert.Throws<SqliteException>(() => Execute(store.DatabasePath, "DELETE FROM audit_events"));
        Assert.Equal(3L, Scalar(store.DatabasePath, "SELECT count(*) FROM audit_events"));
    }

    [Fact]
    public void LegacyDeleteReinsertWriterIsRejectedAndItsWholeTransactionRollsBack()
    {
        using var store = Create(); var before = Seed(store);
        using (var db = Raw(store.DatabasePath))
        using (var transaction = db.BeginTransaction())
        {
            using var command = db.CreateCommand(); command.Transaction = transaction;
            command.CommandText = "UPDATE ledger SET revision=99; DELETE FROM accounts; DELETE FROM audit_events;";
            Assert.Throws<SqliteException>(() => command.ExecuteNonQuery());
            transaction.Rollback();
        }
        var after = store.Read();
        Assert.Equal(before.Revision, after.Revision);
        Assert.Equal(before.Accounts, after.Accounts);
        Assert.Equal(before.AuditEvents, after.AuditEvents);
        Assert.Throws<SqliteException>(() => Execute(store.DatabasePath, "UPDATE audit_events SET detail='{}' WHERE action='ParityModuleCommit.v1'"));
    }

    [Fact]
    public void BackupAndRestorePreserveBothJournalBytesAndLegacyWriterProtection()
    {
        var backup = Path.Combine(directory, "backup.snapshot"); var restored = Path.Combine(directory, "restored.caiwu");
        LedgerSnapshot original;
        using (var store = Create()) { original = Seed(store); store.BackupTo(backup); }
        SqliteLedgerStore.RestoreBackup(backup, restored);
        using var copy = SqliteLedgerStore.Open(restored);
        Assert.Equal(original.AuditEvents, copy.Read().AuditEvents);
        Assert.Throws<SqliteException>(() => Execute(restored, "DELETE FROM audit_events"));
        Assert.Equal(original.AuditEvents, copy.Read().AuditEvents);
    }

    [Fact]
    public void FirstModuleWriteAddsProtectionToSyntheticLegacySchemaWithoutChangingItsVersion()
    {
        using var store = Create();
        // Emulate an original schema1 file, before it contains any authoritative module event.
        Assert.Equal(0L, Scalar(store.DatabasePath, "SELECT count(*) FROM sqlite_schema WHERE type='trigger'"));
        _ = Seed(store);
        Assert.Equal(1L, Scalar(store.DatabasePath, "PRAGMA user_version"));
        Assert.Throws<SqliteException>(() => Execute(store.DatabasePath, "DELETE FROM audit_events"));
    }

    private static SqliteConnection Raw(string path)
    {
        var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Mode = SqliteOpenMode.ReadWrite, Pooling = false }.ToString());
        db.Open(); return db;
    }
    private static object? Scalar(string path, string sql)
    {
        using var db = Raw(path); using var command = db.CreateCommand(); command.CommandText = sql; return command.ExecuteScalar();
    }
    private static void Execute(string path, string sql)
    {
        using var db = Raw(path); using var command = db.CreateCommand(); command.CommandText = sql; command.ExecuteNonQuery();
    }
}
