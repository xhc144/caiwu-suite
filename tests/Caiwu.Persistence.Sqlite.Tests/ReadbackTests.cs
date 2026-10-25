using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Persistence.Sqlite;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Caiwu.Persistence.Sqlite.Tests;

public sealed class ReadbackTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "caiwu-readback-" + Guid.NewGuid().ToString("N"));
    private readonly BookInfo book = new(Guid.NewGuid(), "合成读回账套", AccountingRegime.Enterprise,
        "readback-test", 2026, 1, 0, new DateTimeOffset(2026, 1, 1, 8, 0, 0, TimeSpan.FromHours(8)).AddTicks(123));
    private static readonly Guid OldId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid NewId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private string Database => Path.Combine(directory, "synthetic.caiwu");

    public ReadbackTests() => Directory.CreateDirectory(directory);
    public void Dispose() => Directory.Delete(directory, recursive: true);

    private static Account[] Accounts() =>
    [
        new("1001", "现金", null, BalanceDirection.Debit, true, 0, 0),
        new("1002", "银行", null, BalanceDirection.Debit, true, 100, 0),
        new("4001", "资本", null, BalanceDirection.Credit, true, 0, 100)
    ];

    private LedgerSnapshot Initial() => new(1, book, Accounts(),
        [new(OldId, new(2026, 1, 1), "记", 1, 1, "maker", "reviewer", VoucherStatus.Posted,
            [new("1002", "原借方", 20, 0), new("4001", "原贷方", 0, 20)])],
        [new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), book.CreatedAt, "poster", "Post", OldId, "原审计")]);

    private LedgerSnapshot Next() => Initial() with
    {
        Revision = 2,
        Book = book with { Name = "新名称", ClosedThroughMonth = 1 },
        Accounts = Accounts().Select(a => a.Code == "1001" ? a with { Name = "现金新名称" } : a).ToArray(),
        Vouchers = [Initial().Vouchers[0], new(NewId, new(2026, 1, 2), "记", 2, 2, "maker", "reviewer", VoucherStatus.Posted,
            [new("1002", "同一正常业务", 30, 0), new("4001", "同一正常业务", 0, 30)])],
        AuditEvents = [Initial().AuditEvents[0], new(Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
            book.CreatedAt.AddDays(1), "poster", "Post", NewId, "新增30元")]
    };

    private SqliteLedgerStore Seed()
    {
        var store = SqliteLedgerStore.Create(Database, book, Accounts());
        store.Write(Initial(), 0);
        return store;
    }

    private SqliteConnection Raw()
    {
        var db = new SqliteConnection(new SqliteConnectionStringBuilder
        { DataSource = Database, Mode = SqliteOpenMode.ReadWrite, Pooling = false, ForeignKeys = true }.ToString());
        db.Open();
        return db;
    }
    private static void Sql(SqliteConnection db, string sql)
    {
        using var command = db.CreateCommand(); command.CommandText = sql; command.ExecuteNonQuery();
    }
    private static object? Scalar(SqliteConnection db, string sql)
    {
        using var command = db.CreateCommand(); command.CommandText = sql; return command.ExecuteScalar();
    }
    private static string State(LedgerSnapshot snapshot) => JsonSerializer.Serialize(snapshot);

    private void RefusedAndUnchanged(SqliteLedgerStore store, LedgerSnapshot next)
    {
        var before = State(store.Read());
        var input = State(next);
        // These fixtures have no concurrent writer. A byte comparison is meaningful
        // only for their complete DELETE-mode file, with all SQLite handles closed.
        // File.ReadAllBytes intentionally keeps its restrictive sharing mode.
        using (var db = Raw()) Assert.Equal("delete", Scalar(db, "PRAGMA journal_mode"));
        store.Dispose();
        var bytes = File.ReadAllBytes(Database);
        using (var attempt = SqliteLedgerStore.Open(Database))
        {
            Assert.Throws<InvalidDataException>(() => attempt.Write(next, 1));
            Assert.Equal(before, State(attempt.Read()));
            Assert.Equal(input, State(next));
        }
        Assert.Equal(bytes, File.ReadAllBytes(Database));
        using var reopened = SqliteLedgerStore.Open(Database);
        Assert.Equal(before, State(reopened.Read()));
        reopened.CheckIntegrity();
    }

    public static IEnumerable<object[]> SilentChanges()
    {
        foreach (var (column, value) in new[]
        {
            ("revision", "99"), ("book_id", "'33333333-3333-3333-3333-333333333333'"), ("name", "'unexpected'"),
            ("regime", "0"), ("template_version", "'unexpected'"), ("fiscal_year", "2025"),
            ("start_month", "2"), ("closed_through_month", "0"),
            // Same instant and ticks, different offset: ordinary record equality alone misses this.
            ("created_at", "'2026-01-01T00:00:00.0000123+00:00'")
        })
            yield return ["ledger-" + column, $"CREATE TRIGGER silent AFTER UPDATE OF name ON ledger BEGIN UPDATE ledger SET {column}={value} WHERE singleton=1; END;"];

        foreach (var (column, value) in new[]
        {
            ("code", "'9999'"), ("name", "'unexpected'"), ("parent_code", "'1002'"), ("direction", "1"),
            ("is_active", "0"), ("opening_debit_cents", "100"), ("opening_credit_cents", "100")
        })
            yield return ["account-" + column, $"CREATE TRIGGER silent AFTER INSERT ON accounts WHEN NEW.code='1001' BEGIN UPDATE accounts SET {column}={value} WHERE code='1001'; END;"];

        foreach (var (column, value) in new[]
        {
            ("date", "'2026-01-03'"), ("kind", "'付'"), ("number", "3"), ("attachment_count", "3"),
            ("prepared_by", "'other-maker'"), ("reviewed_by", "'other-reviewer'"), ("status", "1")
        })
            yield return ["voucher-" + column, $"CREATE TRIGGER silent AFTER INSERT ON vouchers WHEN NEW.id='22222222-2222-2222-2222-222222222222' BEGIN UPDATE vouchers SET {column}={value} WHERE id=NEW.id; END;"];

        foreach (var (column, value) in new[] { ("account_code", "'1001'"), ("summary", "'unexpected'") })
            yield return ["line-" + column, $"CREATE TRIGGER silent AFTER INSERT ON voucher_lines WHEN NEW.voucher_id='22222222-2222-2222-2222-222222222222' AND NEW.ordinal=0 BEGIN UPDATE voucher_lines SET {column}={value} WHERE voucher_id=NEW.voucher_id AND ordinal=0; END;"];

        foreach (var (column, value) in new[]
        {
            ("id", "'cccccccc-cccc-cccc-cccc-cccccccccccc'"),
            ("at", "'2026-01-02T00:00:00.0000123+00:00'"),
            ("operator_name", "'other-poster'"), ("action", "'other-action'"), ("voucher_id", "NULL"), ("detail", "'unexpected'")
        })
            yield return ["audit-" + column, $"CREATE TRIGGER silent AFTER INSERT ON audit_events WHEN NEW.id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' BEGIN UPDATE audit_events SET {column}={value} WHERE id=NEW.id; END;"];

        yield return ["drop-unused-account", "CREATE TRIGGER silent BEFORE INSERT ON accounts WHEN NEW.code='1001' BEGIN SELECT RAISE(IGNORE); END;"];
        yield return ["drop-audit", "CREATE TRIGGER silent BEFORE INSERT ON audit_events WHEN NEW.id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' BEGIN SELECT RAISE(IGNORE); END;"];
        yield return ["account-order", """
            CREATE TRIGGER silent AFTER INSERT ON accounts WHEN NEW.code='4001' BEGIN
                UPDATE accounts SET ordinal=ordinal+100;
                UPDATE accounts SET ordinal=199-ordinal;
            END;
            """];
        yield return ["line-order", """
            CREATE TRIGGER silent AFTER INSERT ON voucher_lines
            WHEN NEW.voucher_id='22222222-2222-2222-2222-222222222222' AND NEW.ordinal=1 BEGIN
                UPDATE voucher_lines SET ordinal=ordinal+100 WHERE voucher_id=NEW.voucher_id;
                UPDATE voucher_lines SET ordinal=101-ordinal WHERE voucher_id=NEW.voucher_id;
            END;
            """];
        yield return ["voucher-identity", """
            CREATE TRIGGER silent AFTER INSERT ON audit_events WHEN NEW.id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' BEGIN
                UPDATE vouchers SET id='33333333-3333-3333-3333-333333333333' WHERE id=NEW.voucher_id;
                UPDATE voucher_lines SET voucher_id='33333333-3333-3333-3333-333333333333' WHERE voucher_id=NEW.voucher_id;
                UPDATE audit_events SET voucher_id='33333333-3333-3333-3333-333333333333' WHERE id=NEW.id;
            END;
            """];
        yield return ["voucher-order", """
            CREATE TRIGGER silent AFTER INSERT ON audit_events WHEN NEW.id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' BEGIN
                UPDATE vouchers SET ordinal=ordinal+100;
                UPDATE vouchers SET ordinal=101-ordinal;
            END;
            """];
        yield return ["audit-order", """
            CREATE TRIGGER silent AFTER INSERT ON audit_events WHEN NEW.id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' BEGIN
                UPDATE audit_events SET ordinal=ordinal+100;
                UPDATE audit_events SET ordinal=101-ordinal;
            END;
            """];
    }

    [Theory]
    [MemberData(nameof(SilentChanges))]
    public void Every_persistent_field_and_list_order_is_verified_before_commit(string category, string trigger)
    {
        Assert.NotEmpty(category);
        using var store = Seed();
        using (var db = Raw()) Sql(db, trigger);
        RefusedAndUnchanged(store, Next());
        using (var db = Raw()) Sql(db, "DROP TRIGGER silent");
        using var accepted = SqliteLedgerStore.Open(Database);
        accepted.Write(Next(), 1);
        Assert.Equal(State(Next()), State(accepted.Read()));
    }

    [Fact]
    public void Equal_counts_and_balanced_equal_totals_do_not_hide_redistributed_line_amounts()
    {
        using var store = Seed();
        using (var db = Raw()) Sql(db, """
            CREATE TRIGGER silent AFTER INSERT ON voucher_lines
            WHEN NEW.voucher_id='22222222-2222-2222-2222-222222222222' AND NEW.ordinal=1 BEGIN
                UPDATE voucher_lines SET debit_cents=debit_cents+CASE ordinal WHEN 0 THEN -100 WHEN 1 THEN 100 ELSE 0 END
                WHERE voucher_id=NEW.voucher_id;
            END;
            """);
        var next = Next();
        next = next with { Vouchers = [next.Vouchers[0], next.Vouchers[1] with { Lines =
            [new("1001", "材料现金", 10, 0), new("1002", "材料银行", 20, 0), new("4001", "投入资本", 0, 30)] }] };
        // The trigger changes 10+20 into 9+21, preserving line count and both 30 totals.
        RefusedAndUnchanged(store, next);
    }

    [Fact]
    public void Explicit_columns_preserve_meaning_after_physical_column_reordering()
    {
        using var store = Seed();
        using (var db = Raw()) Sql(db, """
            BEGIN IMMEDIATE;
            ALTER TABLE voucher_lines RENAME TO old_lines;
            CREATE TABLE voucher_lines (
                credit_cents INTEGER NOT NULL,
                summary TEXT NOT NULL,
                ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
                account_code TEXT NOT NULL REFERENCES accounts(code) DEFERRABLE INITIALLY DEFERRED,
                debit_cents INTEGER NOT NULL,
                voucher_id TEXT NOT NULL REFERENCES vouchers(id) DEFERRABLE INITIALLY DEFERRED,
                PRIMARY KEY (voucher_id, ordinal)
            ) STRICT;
            INSERT INTO voucher_lines (voucher_id,ordinal,account_code,summary,debit_cents,credit_cents)
                SELECT voucher_id,ordinal,account_code,summary,debit_cents,credit_cents FROM old_lines;
            DROP TABLE old_lines;
            CREATE INDEX ix_voucher_lines_account ON voucher_lines(account_code);
            COMMIT;
            """);
        Assert.Equal(State(Initial()), State(store.Read()));
        store.Write(Next(), 1);
        Assert.Equal(State(Next()), State(store.Read()));
        using var raw = Raw();
        Assert.Equal("credit_cents", Scalar(raw, "SELECT name FROM pragma_table_info('voucher_lines') WHERE cid=0"));
        Assert.Equal(2L, Scalar(raw, "SELECT count(*) FROM voucher_lines WHERE voucher_id='22222222-2222-2222-2222-222222222222'"));
        // The store did not rebuild or silently repair this intentionally changed schema.
    }

    [Theory]
    [InlineData("3000.5")]
    [InlineData("'3000.5'")]
    public void Fractional_cents_cannot_be_hidden_by_integer_getter_coercion(string fractionalCents)
    {
        using var store = Seed();
        using (var db = Raw()) Sql(db, $$"""
            BEGIN IMMEDIATE;
            ALTER TABLE voucher_lines RENAME TO old_lines;
            CREATE TABLE voucher_lines (
                voucher_id TEXT NOT NULL REFERENCES vouchers(id) DEFERRABLE INITIALLY DEFERRED,
                ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
                account_code TEXT NOT NULL REFERENCES accounts(code) DEFERRABLE INITIALLY DEFERRED,
                summary TEXT NOT NULL,
                debit_cents ANY NOT NULL,
                credit_cents INTEGER NOT NULL,
                PRIMARY KEY (voucher_id, ordinal)
            ) STRICT;
            INSERT INTO voucher_lines (voucher_id,ordinal,account_code,summary,debit_cents,credit_cents)
                SELECT voucher_id,ordinal,account_code,summary,debit_cents,credit_cents FROM old_lines;
            DROP TABLE old_lines;
            CREATE INDEX ix_voucher_lines_account ON voucher_lines(account_code);
            CREATE TRIGGER silent AFTER INSERT ON voucher_lines
            WHEN NEW.voucher_id='22222222-2222-2222-2222-222222222222' AND NEW.ordinal=0 BEGIN
                UPDATE voucher_lines SET debit_cents={{fractionalCents}} WHERE voucher_id=NEW.voucher_id AND ordinal=0;
            END;
            COMMIT;
            """);
        RefusedAndUnchanged(store, Next());
    }

    [Fact]
    public void Extra_unowned_lines_cannot_disappear_during_snapshot_materialization()
    {
        using var store = Seed();
        using (var db = Raw()) Sql(db, """
            BEGIN IMMEDIATE;
            ALTER TABLE voucher_lines RENAME TO old_lines;
            CREATE TABLE voucher_lines (
                voucher_id TEXT NOT NULL,
                ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
                account_code TEXT NOT NULL REFERENCES accounts(code) DEFERRABLE INITIALLY DEFERRED,
                summary TEXT NOT NULL,
                debit_cents INTEGER NOT NULL,
                credit_cents INTEGER NOT NULL,
                PRIMARY KEY (voucher_id, ordinal)
            ) STRICT;
            INSERT INTO voucher_lines (voucher_id,ordinal,account_code,summary,debit_cents,credit_cents)
                SELECT voucher_id,ordinal,account_code,summary,debit_cents,credit_cents FROM old_lines;
            DROP TABLE old_lines;
            CREATE INDEX ix_voucher_lines_account ON voucher_lines(account_code);
            CREATE TRIGGER silent AFTER INSERT ON audit_events WHEN NEW.id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' BEGIN
                INSERT INTO voucher_lines (voucher_id,ordinal,account_code,summary,debit_cents,credit_cents)
                VALUES ('33333333-3333-3333-3333-333333333333',0,'1002','ghost',999,0);
            END;
            COMMIT;
            """);
        RefusedAndUnchanged(store, Next());
    }

    [Fact]
    public void An_extra_ledger_row_cannot_be_hidden_by_a_singleton_filter()
    {
        using var store = Seed();
        using (var db = Raw()) Sql(db, """
            BEGIN IMMEDIATE;
            ALTER TABLE ledger RENAME TO old_ledger;
            CREATE TABLE ledger (
                singleton INTEGER PRIMARY KEY,
                revision INTEGER NOT NULL CHECK (revision >= 0), book_id TEXT NOT NULL, name TEXT NOT NULL,
                regime INTEGER NOT NULL CHECK (regime BETWEEN 0 AND 2), template_version TEXT NOT NULL,
                fiscal_year INTEGER NOT NULL, start_month INTEGER NOT NULL,
                closed_through_month INTEGER NOT NULL, created_at TEXT NOT NULL
            ) STRICT;
            INSERT INTO ledger (singleton,revision,book_id,name,regime,template_version,fiscal_year,start_month,closed_through_month,created_at)
                SELECT singleton,revision,book_id,name,regime,template_version,fiscal_year,start_month,closed_through_month,created_at FROM old_ledger;
            DROP TABLE old_ledger;
            CREATE TRIGGER silent AFTER UPDATE OF name ON ledger WHEN NEW.singleton=1 BEGIN
                INSERT INTO ledger (singleton,revision,book_id,name,regime,template_version,fiscal_year,start_month,closed_through_month,created_at)
                SELECT 2,revision,book_id,name,regime,template_version,fiscal_year,start_month,closed_through_month,created_at
                FROM ledger WHERE singleton=1;
            END;
            COMMIT;
            """);
        RefusedAndUnchanged(store, Next());
    }

    [Theory]
    [InlineData("IGNORE")]
    [InlineData("REPLACE")]
    public void Silent_line_conflict_must_reject_and_roll_back_the_complete_original_book(string conflict)
    {
        using var store = Seed();
        using (var db = Raw()) Sql(db, $$"""
            BEGIN IMMEDIATE;
            ALTER TABLE voucher_lines RENAME TO old_lines;
            CREATE TABLE voucher_lines (
                voucher_id TEXT NOT NULL REFERENCES vouchers(id) DEFERRABLE INITIALLY DEFERRED,
                ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
                account_code TEXT NOT NULL REFERENCES accounts(code) DEFERRABLE INITIALLY DEFERRED,
                summary TEXT NOT NULL,
                debit_cents INTEGER NOT NULL,
                credit_cents INTEGER NOT NULL,
                PRIMARY KEY (voucher_id, ordinal),
                UNIQUE (voucher_id, summary) ON CONFLICT {{conflict}}
            ) STRICT;
            INSERT INTO voucher_lines (voucher_id,ordinal,account_code,summary,debit_cents,credit_cents)
                SELECT voucher_id,ordinal,account_code,summary,debit_cents,credit_cents FROM old_lines;
            DROP TABLE old_lines;
            CREATE INDEX ix_voucher_lines_account ON voucher_lines(account_code);
            COMMIT;
            """);
        var before = State(store.Read());
        using (var db = Raw()) Assert.Equal("delete", Scalar(db, "PRAGMA journal_mode"));
        store.Dispose();
        var bytesBefore = File.ReadAllBytes(Database);
        using (var attempt = SqliteLedgerStore.Open(Database))
        {
            var error = Record.Exception(() => attempt.Write(Next(), 1));
            using (var db = Raw())
            {
                var actualLines = Scalar(db, "SELECT count(*) FROM voucher_lines WHERE voucher_id='22222222-2222-2222-2222-222222222222'");
                var revision = Scalar(db, "SELECT revision FROM ledger");
                var integrity = Scalar(db, "PRAGMA integrity_check");
                Assert.True(error is InvalidDataException,
                    $"{conflict}: expected semantic rejection; actualError={error?.GetType().Name ?? "none"}, newVoucherLines={actualLines} (requested2), revision={revision}, integrity={integrity}");
                Assert.Equal("ok", integrity);
            }
            Assert.Equal(before, State(attempt.Read()));
        }
        Assert.Equal(bytesBefore, File.ReadAllBytes(Database));
        using var independentlyReopened = SqliteLedgerStore.Open(Database);
        Assert.Equal(before, State(independentlyReopened.Read()));
    }

    [Fact]
    public void Closed_file_byte_comparison_detects_a_committed_same_length_change()
    {
        using (Seed()) { }
        var before = File.ReadAllBytes(Database);
        using (var db = Raw())
        {
            Assert.Equal("delete", Scalar(db, "PRAGMA journal_mode"));
            // Same UTF-8 length: a file-size-only check would miss this committed change.
            Sql(db, "UPDATE ledger SET name='已改读回账套' WHERE singleton=1");
        }
        var after = File.ReadAllBytes(Database);
        Assert.Equal(before.Length, after.Length);
        Assert.NotEqual(Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(before)),
            Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(after)));
        using var reopened = SqliteLedgerStore.Open(Database);
        Assert.Equal("已改读回账套", reopened.Read().Book.Name);
        reopened.CheckIntegrity();
    }
}
