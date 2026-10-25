using Caiwu.Contracts;
using Caiwu.Persistence.Sqlite;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Caiwu.Persistence.Sqlite.Tests;

public sealed class StoreTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "caiwu-tests-" + Guid.NewGuid().ToString("N"));
    private static readonly Guid BookId = Guid.Parse("11111111-2222-3333-4444-555555555555");
    private static readonly Guid VoucherId = Guid.Parse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    private static readonly DateTimeOffset Created = new(2026, 10, 25, 14, 3, 2, TimeSpan.FromHours(8));

    public StoreTests() => Directory.CreateDirectory(directory);
    public void Dispose() => Directory.Delete(directory, recursive: true);
    private string PathFor(string name = "book.db") => Path.Combine(directory, name);
    private static BookInfo Book() => new(BookId, "测试账套 '甲'; --\n第二行", AccountingRegime.Enterprise,
        "enterprise-2026.1", 2026, 3, 2, Created.AddTicks(1234567));
    // Child precedes parent, exercising deferred references and list-order preservation.
    private static Account[] Accounts() =>
    [
        new("100201", "银行 / 一户", "1002", BalanceDirection.Debit, true, 100000.10m, 0m),
        new("1002", "银行存款", null, BalanceDirection.Debit, false, 0m, 0m),
        new("4001", "实收资本", null, BalanceDirection.Credit, true, 0m, 100000.10m)
    ];

    private static LedgerSnapshot FullSnapshot(long revision = 1) => new(revision, Book() with { ClosedThroughMonth = 4 }, Accounts(),
    [
        new(VoucherId, new(2026, 5, 31), "转 ' ;", 83, 5, "张三\n制单", "李四", VoucherStatus.Posted,
        [new("100201", "收款 ' ;\n备注", 0.10m, 0m), new("4001", "资本", 0m, 0.10m)]),
        new(Guid.Parse("00000000-0000-0000-0000-000000000002"), new(2026, 6, 1), "收", 1, 0, "王五", null,
            VoucherStatus.Draft, []),
        new(Guid.Parse("00000000-0000-0000-0000-000000000003"), new(2026, 6, 2), "付", 2, 1, "赵六", "审核",
            VoucherStatus.Reviewed, [new("100201", "", 0m, 0.20m)])
    ],
    [
        new(Guid.Parse("00000000-0000-0000-0000-000000000004"), Created.AddTicks(7654321), "审计员", "过账", VoucherId, "原样保存\n' ;"),
        new(Guid.Parse("00000000-0000-0000-0000-000000000005"), Created.ToOffset(TimeSpan.FromHours(-5)), "操作员", "删除草稿",
            Guid.Parse("00000000-0000-0000-0000-000000000099"), "已删除凭证的引用必须保留"),
        new(Guid.Parse("00000000-0000-0000-0000-000000000006"), Created, "系统", "创建", null, "")
    ]);

    private SqliteLedgerStore Create(string name = "book.db") => SqliteLedgerStore.Create(PathFor(name), Book(), Accounts());

    private SqliteConnection Raw(string name = "book.db")
    {
        var db = new SqliteConnection(new SqliteConnectionStringBuilder
        { DataSource = PathFor(name), Mode = SqliteOpenMode.ReadWrite, Pooling = false }.ToString());
        db.Open();
        return db;
    }

    private static void Sql(SqliteConnection db, string text)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = text;
        cmd.ExecuteNonQuery();
    }

    private static object? Scalar(SqliteConnection db, string text)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = text;
        return cmd.ExecuteScalar();
    }

    private static void EqualSnapshot(LedgerSnapshot expected, LedgerSnapshot actual)
    {
        Assert.Equal(expected.Revision, actual.Revision);
        Assert.Equal(expected.Book, actual.Book);
        Assert.Equal(expected.Book.CreatedAt.ToString("O"), actual.Book.CreatedAt.ToString("O"));
        Assert.Equal(expected.Accounts.ToArray(), actual.Accounts.ToArray());
        Assert.Equal(expected.Vouchers.Count, actual.Vouchers.Count);
        for (var i = 0; i < expected.Vouchers.Count; i++)
        {
            var e = expected.Vouchers[i];
            var a = actual.Vouchers[i];
            Assert.Equal(e with { Lines = [] }, a with { Lines = [] });
            Assert.Equal(e.Lines.ToArray(), a.Lines.ToArray());
        }
        Assert.Equal(expected.AuditEvents.ToArray(), actual.AuditEvents.ToArray());
        for (var i = 0; i < expected.AuditEvents.Count; i++)
            Assert.Equal(expected.AuditEvents[i].At.ToString("O"), actual.AuditEvents[i].At.ToString("O"));
    }

    [Fact]
    public void CreateHasRevisionZeroAndEveryInitialField()
    {
        using var store = Create();
        Assert.Equal(Path.GetFullPath(PathFor()), store.DatabasePath);
        EqualSnapshot(new(0, Book(), Accounts(), [], []), store.Read());
        store.CheckIntegrity();
    }

    [Theory]
    [InlineData(AccountingRegime.SmallBusiness)]
    [InlineData(AccountingRegime.Enterprise)]
    [InlineData(AccountingRegime.Nonprofit)]
    public void AllFieldsAndOrderingSurviveCloseAndReopen(AccountingRegime regime)
    {
        var book = Book() with { Regime = regime };
        var expected = FullSnapshot() with { Book = FullSnapshot().Book with { Regime = regime } };
        using (var store = SqliteLedgerStore.Create(PathFor(), book, Accounts())) store.Write(expected, 0);
        using var reopened = SqliteLedgerStore.Open(PathFor());
        EqualSnapshot(expected, reopened.Read());
    }

    [Fact]
    public void MoneyIsActuallyStoredAsSignedIntegerCents()
    {
        using var store = Create();
        var s = FullSnapshot();
        store.Write(s, 0);
        using var db = Raw();
        Assert.Equal("integer", Scalar(db, "SELECT typeof(opening_debit_cents) FROM accounts WHERE code='100201'"));
        Assert.Equal(10000010L, Scalar(db, "SELECT opening_debit_cents FROM accounts WHERE code='100201'"));
        Assert.Equal(10L, Scalar(db, "SELECT debit_cents FROM voucher_lines WHERE summary LIKE '收款%'"));
        Assert.Equal(20L, Scalar(db, "SELECT credit_cents FROM voucher_lines WHERE summary=''"));
        Assert.Equal(1L, Scalar(db, "PRAGMA user_version"));
        Assert.Equal(1128355669L, Scalar(db, "PRAGMA application_id"));
    }

    [Fact]
    public void ReadDecodesIndependentlySeededSqlValues()
    {
        using (Create()) { }
        using (var db = Raw()) Sql(db, """
            UPDATE ledger SET revision=7, name='SQL独立样本', closed_through_month=8;
            UPDATE accounts SET opening_debit_cents=-9223372036854775808 WHERE code='100201';
            UPDATE accounts SET opening_credit_cents=9223372036854775807 WHERE code='4001';
            INSERT INTO vouchers VALUES ('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',0,'2026-09-30','独立',17,8,'制单','审核',2);
            INSERT INTO voucher_lines VALUES ('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',0,'100201','独立分录',12345,678);
            INSERT INTO audit_events VALUES ('00000000-0000-0000-0000-000000000077',0,'2026-10-25T14:03:02.0000001+08:00','独立','SQL',NULL,'细节');
            """);
        using var store = SqliteLedgerStore.Open(PathFor());
        var s = store.Read();
        Assert.Equal(7, s.Revision);
        Assert.Equal("SQL独立样本", s.Book.Name);
        Assert.Equal(8, s.Book.ClosedThroughMonth);
        Assert.Equal(-92233720368547758.08m, s.Accounts[0].OpeningDebit);
        Assert.Equal(92233720368547758.07m, s.Accounts[2].OpeningCredit);
        var v = Assert.Single(s.Vouchers);
        Assert.Equal(VoucherId, v.Id);
        Assert.Equal(new DateOnly(2026, 9, 30), v.Date);
        Assert.Equal("独立", v.Kind);
        Assert.Equal(17, v.Number);
        Assert.Equal(8, v.AttachmentCount);
        Assert.Equal("制单", v.PreparedBy);
        Assert.Equal("审核", v.ReviewedBy);
        Assert.Equal(VoucherStatus.Posted, v.Status);
        Assert.Equal(new VoucherLine("100201", "独立分录", 123.45m, 6.78m), Assert.Single(v.Lines));
        var audit = Assert.Single(s.AuditEvents);
        Assert.Equal("2026-10-25T14:03:02.0000001+08:00", audit.At.ToString("O"));
        Assert.Null(audit.VoucherId);
        Assert.Equal("细节", audit.Detail);
    }

    [Theory]
    [InlineData("0.001")]
    [InlineData("-0.001")]
    [InlineData("92233720368547758.08")]
    [InlineData("-92233720368547758.09")]
    [InlineData("79228162514264337593543950335")]
    public void BadAccountAmountsRejectCreateAndLeaveNoFiles(string text)
    {
        var amount = decimal.Parse(text, System.Globalization.CultureInfo.InvariantCulture);
        var accounts = Accounts();
        accounts[2] = accounts[2] with { OpeningCredit = amount };
        Assert.Throws<LedgerValidationException>(() => SqliteLedgerStore.Create(PathFor(), Book(), accounts));
        Assert.Empty(Directory.GetFiles(directory));
    }

    [Theory]
    [InlineData("92233720368547758.07")]
    [InlineData("-92233720368547758.08")]
    [InlineData("0.1000")]
    public void ExactBoundaryAndTrailingZeroAmountsRoundTrip(string text)
    {
        var amount = decimal.Parse(text, System.Globalization.CultureInfo.InvariantCulture);
        var accounts = Accounts();
        accounts[0] = accounts[0] with { OpeningDebit = amount };
        using var store = SqliteLedgerStore.Create(PathFor(), Book(), accounts);
        Assert.Equal(amount, store.Read().Accounts[0].OpeningDebit);
    }

    [Theory]
    [InlineData(false, "0.001")]
    [InlineData(true, "-0.001")]
    [InlineData(false, "92233720368547758.08")]
    [InlineData(true, "-92233720368547758.09")]
    public void BadLineAmountsRollBackEverything(bool credit, string text)
    {
        using var store = Create();
        var before = store.Read();
        var next = FullSnapshot();
        var amount = decimal.Parse(text, System.Globalization.CultureInfo.InvariantCulture);
        var voucher = next.Vouchers[0] with { Lines = [new("100201", "bad", credit ? 0m : amount, credit ? amount : 0m)] };
        next = next with { Vouchers = [voucher] };
        Assert.Throws<LedgerValidationException>(() => store.Write(next, 0));
        EqualSnapshot(before, store.Read());
        store.Write(FullSnapshot(), 0);
        EqualSnapshot(FullSnapshot(), store.Read());
    }

    [Fact]
    public void InvalidAccountAmountAfterDeletesRollsBackExistingVouchersAndAudit()
    {
        using var store = Create();
        store.Write(FullSnapshot(), 0);
        var before = store.Read();
        var accounts = Accounts();
        accounts[2] = accounts[2] with { OpeningDebit = 1.001m };
        Assert.Throws<LedgerValidationException>(() => store.Write(before with { Revision = 2, Accounts = accounts }, 1));
        EqualSnapshot(before, store.Read());
    }

    [Fact]
    public void DeferredForeignKeyFailureAtCommitRollsBackRevisionAndAllTables()
    {
        using var store = Create();
        store.Write(FullSnapshot(), 0);
        var before = store.Read();
        var bad = before.Vouchers[0] with { Lines = [new("missing", "bad reference", 1, 0)] };
        var error = Assert.Throws<SqliteException>(() => store.Write(before with { Revision = 2, Vouchers = [bad] }, 1));
        Assert.Equal(19, error.SqliteErrorCode);
        EqualSnapshot(before, store.Read());
        store.CheckIntegrity();
    }

    [Fact]
    public void DatabaseTriggerFailureAfterSeveralInsertsRollsBackEverything()
    {
        using var store = Create();
        store.Write(FullSnapshot(), 0);
        var before = store.Read();
        using (var db = Raw()) Sql(db, """
            CREATE TRIGGER injected_failure BEFORE INSERT ON audit_events
            WHEN NEW.action='FAIL' BEGIN SELECT RAISE(ABORT,'injected storage failure'); END;
            """);
        var bad = before with { Revision = 2, Book = before.Book with { Name = "should roll back" },
            AuditEvents = [before.AuditEvents[0] with { Action = "FAIL" }] };
        Assert.Throws<SqliteException>(() => store.Write(bad, 1));
        EqualSnapshot(before, store.Read());
        using (var db = Raw()) Sql(db, "DROP TRIGGER injected_failure");
        store.Write(before with { Revision = 2 }, 1);
        Assert.Equal(2, store.Read().Revision);
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(0, 2)]
    [InlineData(-1, 0)]
    [InlineData(long.MaxValue, long.MinValue)]
    public void InvalidRevisionTransitionsAreRejected(long expected, long next)
    {
        using var store = Create();
        Assert.Throws<StoreConcurrencyException>(() => store.Write(FullSnapshot(next), expected));
        Assert.Equal(0, store.Read().Revision);
    }

    [Fact]
    public void StaleWriterCannotReplaceCommittedData()
    {
        using var first = Create();
        using var second = SqliteLedgerStore.Open(PathFor());
        var stale = second.Read();
        first.Write(FullSnapshot(), 0);
        Assert.Throws<StoreConcurrencyException>(() => second.Write(stale with { Revision = 1 }, 0));
        EqualSnapshot(FullSnapshot(), second.Read());
    }

    [Fact]
    public async Task SimultaneousWritersHaveExactlyOneWinner()
    {
        using var first = Create();
        using var second = SqliteLedgerStore.Open(PathFor());
        using var barrier = new Barrier(2);
        Exception? Attempt(SqliteLedgerStore store, string name)
        {
            var next = FullSnapshot() with { Book = FullSnapshot().Book with { Name = name } };
            barrier.SignalAndWait(TimeSpan.FromSeconds(10));
            return Record.Exception(() => store.Write(next, 0));
        }
        var results = await Task.WhenAll(Task.Run(() => Attempt(first, "one")), Task.Run(() => Attempt(second, "two")));
        Assert.Single(results, e => e is null);
        Assert.Single(results, e => e is StoreConcurrencyException);
        Assert.Equal(1, first.Read().Revision);
        EqualSnapshot(first.Read(), second.Read());
    }

    [Fact]
    public void TwoBooksAreIsolatedAndCrossBookWritesAreRejected()
    {
        using var first = Create();
        var secondBook = Book() with { Id = Guid.Parse("22222222-2222-3333-4444-555555555555"), Name = "乙" };
        using var second = SqliteLedgerStore.Create(PathFor("second.db"), secondBook, []);
        first.Write(FullSnapshot(), 0);
        EqualSnapshot(new(0, secondBook, [], [], []), second.Read());
        Assert.Throws<LedgerValidationException>(() => second.Write(FullSnapshot(), 0));
        EqualSnapshot(new(0, secondBook, [], [], []), second.Read());
        EqualSnapshot(FullSnapshot(), first.Read());
    }

    [Fact]
    public void SuccessfulReplacementRemovesOldRowsWithoutLeavingGhosts()
    {
        using var store = Create();
        store.Write(FullSnapshot(), 0);
        var next = new LedgerSnapshot(2, Book(), [], [], []);
        store.Write(next, 1);
        EqualSnapshot(next, store.Read());
        store.CheckIntegrity();
    }

    [Fact]
    public void OpenMissingFileDoesNotCreateIt()
    {
        Assert.Throws<FileNotFoundException>(() => SqliteLedgerStore.Open(PathFor()));
        Assert.Empty(Directory.GetFiles(directory));
    }

    [Theory]
    [InlineData("")]
    [InlineData("this is not SQLite")]
    public void OpenRejectsEmptyAndGarbageWithoutChangingBytes(string content)
    {
        File.WriteAllText(PathFor(), content);
        var before = File.ReadAllBytes(PathFor());
        Assert.ThrowsAny<Exception>(() => SqliteLedgerStore.Open(PathFor()));
        Assert.Equal(before, File.ReadAllBytes(PathFor()));
    }

    [Fact]
    public void OpenRejectsUnrelatedSqliteDatabase()
    {
        File.WriteAllBytes(PathFor(), []);
        using (var db = Raw()) Sql(db, "CREATE TABLE unrelated (value TEXT)");
        Assert.Throws<InvalidDataException>(() => SqliteLedgerStore.Open(PathFor()));
    }

    [Fact]
    public void OpenRejectsPhysicallyTruncatedDatabase()
    {
        using (Create()) { }
        using (var file = File.OpenWrite(PathFor())) file.SetLength(300);
        Assert.Throws<SqliteException>(() => SqliteLedgerStore.Open(PathFor()));
    }

    [Fact]
    public void ReadOnlyFileIsRejectedEvenForPrivilegedProcess()
    {
        using (Create()) { }
        var original = File.GetAttributes(PathFor());
        try
        {
            File.SetAttributes(PathFor(), original | FileAttributes.ReadOnly);
            Assert.Throws<UnauthorizedAccessException>(() => SqliteLedgerStore.Open(PathFor()));
        }
        finally { File.SetAttributes(PathFor(), original); }
    }

    [Fact]
    public void ReadOnlyDirectoryIsRejectedOnUnix()
    {
        if (OperatingSystem.IsWindows()) return;
        using (Create()) { }
        var original = File.GetUnixFileMode(directory);
        try
        {
            File.SetUnixFileMode(directory, UnixFileMode.UserRead | UnixFileMode.UserExecute);
            Assert.Throws<UnauthorizedAccessException>(() => SqliteLedgerStore.Open(PathFor()));
        }
        finally { File.SetUnixFileMode(directory, original); }
    }

    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    [InlineData(999)]
    public void UnsupportedSchemaIsRejectedWithoutModification(int version)
    {
        using (Create()) { }
        using (var db = Raw()) Sql(db, $"PRAGMA user_version={version}");
        var before = File.ReadAllBytes(PathFor());
        Assert.Throws<InvalidDataException>(() => SqliteLedgerStore.Open(PathFor()));
        Assert.Equal(before, File.ReadAllBytes(PathFor()));
    }

    [Fact]
    public void SchemaUpgradeAfterOpenStopsReadWriteBackupAndIntegrity()
    {
        using var store = Create();
        using (var db = Raw()) Sql(db, "PRAGMA user_version=2");
        Assert.Throws<InvalidDataException>(() => store.Read());
        Assert.Throws<InvalidDataException>(() => store.Write(FullSnapshot(), 0));
        Assert.Throws<InvalidDataException>(() => store.CheckIntegrity());
        Assert.Throws<InvalidDataException>(() => store.BackupTo(PathFor("backup.db")));
        Assert.False(File.Exists(PathFor("backup.db")));
        using var raw = Raw();
        Assert.Equal(0L, Scalar(raw, "SELECT revision FROM ledger"));
    }

    [Fact]
    public void ForeignKeyCorruptionIsDetectedOnOpenAndExplicitCheck()
    {
        using var store = Create();
        using (var db = Raw()) Sql(db, "PRAGMA foreign_keys=OFF; UPDATE accounts SET parent_code='missing' WHERE code='100201'");
        Assert.Throws<InvalidDataException>(() => store.CheckIntegrity());
        Assert.Throws<InvalidDataException>(() => SqliteLedgerStore.Open(PathFor()));
    }

    [Fact]
    public void CreateCannotOverwriteExistingDataOrDirectory()
    {
        File.WriteAllText(PathFor(), "keep this");
        Assert.Throws<IOException>(() => Create());
        Assert.Equal("keep this", File.ReadAllText(PathFor()));
        Assert.Throws<IOException>(() => SqliteLedgerStore.Create(directory, Book(), Accounts()));
    }

    [Fact]
    public void CreateWithInvalidParentReferenceLeavesNoDatabase()
    {
        Assert.Throws<SqliteException>(() => SqliteLedgerStore.Create(PathFor(), Book(), [Accounts()[0]]));
        Assert.Empty(Directory.GetFiles(directory));
    }

    [Fact]
    public void BackupAndRestoreAreIndependentFullCopies()
    {
        using var source = Create();
        source.Write(FullSnapshot(), 0);
        source.BackupTo(PathFor("backup.db"));
        source.Write(FullSnapshot(2) with { Book = Book() with { Name = "源已改变" } }, 1);
        SqliteLedgerStore.RestoreBackup(PathFor("backup.db"), PathFor("restored.db"));
        using var backup = SqliteLedgerStore.Open(PathFor("backup.db"));
        using var restored = SqliteLedgerStore.Open(PathFor("restored.db"));
        EqualSnapshot(FullSnapshot(), backup.Read());
        EqualSnapshot(FullSnapshot(), restored.Read());
        restored.Write(FullSnapshot(2) with { Book = Book() with { Name = "恢复副本已改变" } }, 1);
        Assert.Equal("源已改变", source.Read().Book.Name);
        EqualSnapshot(FullSnapshot(), backup.Read());
        source.CheckIntegrity(); backup.CheckIntegrity(); restored.CheckIntegrity();
    }

    [Fact]
    public void BackupCopiesCommittedWalPagesAndExcludesUncommittedChanges()
    {
        using var source = Create();
        using var writer = Raw();
        Sql(writer, "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0");
        source.Write(FullSnapshot(), 0);
        Assert.True(File.Exists(PathFor() + "-wal"));
        using (var transaction = writer.BeginTransaction())
        {
            using var cmd = writer.CreateCommand();
            cmd.Transaction = transaction;
            cmd.CommandText = "UPDATE ledger SET revision=2, name='uncommitted'; UPDATE accounts SET opening_debit_cents=999 WHERE code='100201'";
            cmd.ExecuteNonQuery();
            source.BackupTo(PathFor("during.db"));
            transaction.Commit();
        }
        source.BackupTo(PathFor("after.db"));
        using var during = SqliteLedgerStore.Open(PathFor("during.db"));
        EqualSnapshot(FullSnapshot(), during.Read());
        using var after = SqliteLedgerStore.Open(PathFor("after.db"));
        Assert.Equal(2, after.Read().Revision);
        Assert.Equal("uncommitted", after.Read().Book.Name);
        Assert.Equal(9.99m, after.Read().Accounts[0].OpeningDebit);
        Assert.False(File.Exists(PathFor("after.db") + "-wal"));
    }

    [Fact]
    public async Task BackupsDuringConcurrentCommitsNeverMixRevisions()
    {
        using var source = Create();
        using var writer = SqliteLedgerStore.Open(PathFor());
        using (var raw = Raw()) Sql(raw, "PRAGMA journal_mode=WAL");
        using var start = new ManualResetEventSlim();
        var writing = Task.Run(() =>
        {
            start.Wait();
            for (var i = 1; i <= 30; i++)
            {
                var accounts = Accounts();
                accounts[0] = accounts[0] with { OpeningDebit = i / 100m };
                writer.Write(new(i, Book() with { Name = i.ToString() }, accounts, [], []), i - 1);
            }
        });
        start.Set();
        for (var i = 0; i < 10; i++)
        {
            var name = $"backup-{i}.db";
            source.BackupTo(PathFor(name));
            using var backup = SqliteLedgerStore.Open(PathFor(name));
            var snapshot = backup.Read();
            if (snapshot.Revision == 0) EqualSnapshot(new(0, Book(), Accounts(), [], []), snapshot);
            else
            {
                Assert.Equal(snapshot.Revision.ToString(), snapshot.Book.Name);
                Assert.Equal(snapshot.Revision / 100m, snapshot.Accounts[0].OpeningDebit);
            }
        }
        await writing;
        Assert.Equal(30, source.Read().Revision);
    }

    [Fact]
    public async Task ReadsDuringConcurrentCommitsKeepAllTablesAtOneRevision()
    {
        using var reader = Create();
        using var writer = SqliteLedgerStore.Open(PathFor());
        using (var raw = Raw()) Sql(raw, "PRAGMA journal_mode=WAL");
        using var start = new ManualResetEventSlim();
        var writing = Task.Run(() =>
        {
            start.Wait();
            for (var i = 1; i <= 40; i++)
            {
                var label = i.ToString();
                writer.Write(new(i, Book() with { Name = label },
                    [new("1002", label, null, BalanceDirection.Debit, true, i, 0m)],
                    [new(VoucherId, new(2026, 5, 1), label, i, i, label, null, VoucherStatus.Draft,
                        [new("1002", label, i, 0m)])],
                    [new(Guid.Parse("00000000-0000-0000-0000-000000000001"), Created, label, label, VoucherId, label)]), i - 1);
            }
        });
        start.Set();
        for (var i = 0; i < 150; i++)
        {
            var snapshot = reader.Read();
            if (snapshot.Revision == 0) { EqualSnapshot(new(0, Book(), Accounts(), [], []), snapshot); continue; }
            var label = snapshot.Revision.ToString();
            Assert.Equal(label, snapshot.Book.Name);
            var account = Assert.Single(snapshot.Accounts);
            Assert.Equal(label, account.Name);
            Assert.Equal((decimal)snapshot.Revision, account.OpeningDebit);
            var voucher = Assert.Single(snapshot.Vouchers);
            Assert.Equal(label, voucher.Kind);
            Assert.Equal(snapshot.Revision, voucher.Number);
            Assert.Equal((decimal)snapshot.Revision, Assert.Single(voucher.Lines).Debit);
            Assert.Equal(label, Assert.Single(snapshot.AuditEvents).Detail);
        }
        await writing;
        Assert.Equal(40, reader.Read().Revision);
    }

    [Theory]
    [InlineData("")]
    [InlineData("-wal")]
    [InlineData("-shm")]
    [InlineData("-journal")]
    public void BackupCannotTargetSourceOrItsSidecars(string suffix)
    {
        using var store = Create();
        var before = store.Read();
        Assert.Throws<IOException>(() => store.BackupTo(PathFor() + suffix));
        EqualSnapshot(before, store.Read());
        store.CheckIntegrity();
    }

    [Fact]
    public void BackupCannotOverwriteExistingDestinationOrSymlinkToSource()
    {
        using var store = Create();
        File.WriteAllText(PathFor("existing.db"), "keep");
        Assert.Throws<IOException>(() => store.BackupTo(PathFor("existing.db")));
        Assert.Equal("keep", File.ReadAllText(PathFor("existing.db")));
        if (!OperatingSystem.IsWindows())
        {
            File.CreateSymbolicLink(PathFor("alias.db"), PathFor());
            Assert.Throws<IOException>(() => store.BackupTo(PathFor("alias.db")));
        }
        store.CheckIntegrity();
    }

    [Fact]
    public void BackupCannotReachSourceSidecarThroughDirectorySymlink()
    {
        if (OperatingSystem.IsWindows()) return;
        var subdirectory = Path.Combine(directory, "real");
        Directory.CreateDirectory(subdirectory);
        Directory.CreateSymbolicLink(Path.Combine(directory, "alias"), subdirectory);
        using var source = SqliteLedgerStore.Create(Path.Combine(subdirectory, "book.db"), Book(), Accounts());
        Assert.Throws<IOException>(() => source.BackupTo(Path.Combine(directory, "alias", "book.db-wal")));
        source.CheckIntegrity();
    }

    [Fact]
    public async Task RacingCreatorsNeverOverwriteTheWinner()
    {
        using var barrier = new Barrier(2);
        Exception? Attempt(string name)
        {
            barrier.SignalAndWait(TimeSpan.FromSeconds(10));
            return Record.Exception(() =>
            {
                using var store = SqliteLedgerStore.Create(PathFor(), Book() with { Name = name }, Accounts());
            });
        }
        var results = await Task.WhenAll(Task.Run(() => Attempt("first")), Task.Run(() => Attempt("second")));
        Assert.Single(results, e => e is null);
        Assert.Single(results, e => e is IOException);
        using var winner = SqliteLedgerStore.Open(PathFor());
        Assert.Contains(winner.Read().Book.Name, new[] { "first", "second" });
        winner.CheckIntegrity();
        Assert.Single(Directory.GetFiles(directory));
    }

    [Fact]
    public void IncorrectApplicationIdIsRejected()
    {
        using (Create()) { }
        using (var raw = Raw()) Sql(raw, "PRAGMA application_id=0");
        Assert.Throws<InvalidDataException>(() => SqliteLedgerStore.Open(PathFor()));
    }

    [Fact]
    public void RestoreRejectsSourceAndExistingDestinationWithoutChangingEither()
    {
        using (Create()) { }
        File.WriteAllText(PathFor("existing.db"), "keep");
        Assert.Throws<IOException>(() => SqliteLedgerStore.RestoreBackup(PathFor(), PathFor()));
        Assert.Throws<IOException>(() => SqliteLedgerStore.RestoreBackup(PathFor(), PathFor("existing.db")));
        Assert.Equal("keep", File.ReadAllText(PathFor("existing.db")));
        using var source = SqliteLedgerStore.Open(PathFor());
        source.CheckIntegrity();
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("garbage")]
    [InlineData("future")]
    [InlineData("fk")]
    public void InvalidRestoreNeverPublishesDestination(string failure)
    {
        if (failure == "garbage") File.WriteAllText(PathFor(), "bad");
        if (failure is "future" or "fk")
        {
            using (Create()) { }
            using var db = Raw();
            Sql(db, failure == "future" ? "PRAGMA user_version=2" : "PRAGMA foreign_keys=OFF; DELETE FROM accounts WHERE code='1002'");
        }
        Assert.ThrowsAny<Exception>(() => SqliteLedgerStore.RestoreBackup(PathFor(), PathFor("restored.db")));
        Assert.False(File.Exists(PathFor("restored.db")));
        Assert.DoesNotContain(Directory.GetFiles(directory), x => x.Contains(".caiwu-"));
    }

    [Fact]
    public void RestoreCanReadAReadOnlyBackup()
    {
        using (Create()) { }
        var original = File.GetAttributes(PathFor());
        try
        {
            File.SetAttributes(PathFor(), original | FileAttributes.ReadOnly);
            SqliteLedgerStore.RestoreBackup(PathFor(), PathFor("restored.db"));
        }
        finally { File.SetAttributes(PathFor(), original); }
        using var restored = SqliteLedgerStore.Open(PathFor("restored.db"));
        EqualSnapshot(new(0, Book(), Accounts(), [], []), restored.Read());
    }

    [Fact]
    public void DestinationWithOrphanWalIsRejected()
    {
        File.WriteAllText(PathFor() + "-wal", "do not touch");
        Assert.Throws<IOException>(() => Create());
        Assert.Equal("do not touch", File.ReadAllText(PathFor() + "-wal"));
    }

    [Fact]
    public void DisposeIsIdempotentAndAllOperationsRejectFurtherUse()
    {
        var store = Create();
        store.Dispose(); store.Dispose();
        Assert.Throws<ObjectDisposedException>(() => store.Read());
        Assert.Throws<ObjectDisposedException>(() => store.Write(FullSnapshot(), 0));
        Assert.Throws<ObjectDisposedException>(() => store.BackupTo(PathFor("backup.db")));
        Assert.Throws<ObjectDisposedException>(() => store.CheckIntegrity());
        using var reopened = SqliteLedgerStore.Open(PathFor());
        reopened.CheckIntegrity();
    }
}
