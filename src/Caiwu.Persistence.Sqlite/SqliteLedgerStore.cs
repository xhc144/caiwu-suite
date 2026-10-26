using System.ComponentModel;
using System.Globalization;
using System.Runtime.InteropServices;
using Caiwu.Contracts;
using Microsoft.Data.Sqlite;

namespace Caiwu.Persistence.Sqlite;

/// <summary>A synchronous, revision-checked store owning exactly one SQLite connection.</summary>
public sealed class SqliteLedgerStore : ILedgerStore
{
    private readonly object gate = new();
    private readonly SqliteConnection connection;
    private bool disposed;

    private SqliteLedgerStore(string path, SqliteConnection connection)
    {
        DatabasePath = path;
        this.connection = connection;
    }

    public string DatabasePath { get; }

    public static SqliteLedgerStore Create(string path, BookInfo book, IReadOnlyList<Account> accounts)
    {
        ArgumentNullException.ThrowIfNull(book);
        ArgumentNullException.ThrowIfNull(accounts);
        return CreateFromSnapshot(path, new(0, book, accounts, [], []));
    }

    /// <summary>
    /// Publishes a complete snapshot into a new file only. Used by explicit identity-changing
    /// copies whose historical module receipts must remain below the new book revision.
    /// It never changes an existing file or skips revision CAS on an existing ledger.
    /// </summary>
    public static SqliteLedgerStore CreateFromSnapshot(string path, LedgerSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        if (snapshot.Revision < 0) throw new LedgerValidationException("初始账套版本不能为负数。");
        var initial = CopySnapshot(snapshot);
        var destination = NewDestination(path);
        PublishNew(destination, stage =>
        {
            using var db = Connect(stage, SqliteOpenMode.ReadWrite);
            using (var transaction = db.BeginTransaction())
            {
                Execute(db, transaction, Schema.Create);
                Execute(db, transaction, """
                    INSERT INTO ledger (singleton,revision,book_id,name,regime,template_version,
                        fiscal_year,start_month,closed_through_month,created_at)
                    VALUES (1, $revision, $id, $name, $regime, $template,
                        $year, $start, $closed, $created)
                    """, BookParameters(initial.Book).Append(("$revision", (object?)initial.Revision)).ToArray());
                InsertContents(db, transaction, initial);
                AssertReadback(initial, ReadContents(db, transaction));
                transaction.Commit();
            }
            using var store = new SqliteLedgerStore(stage, db);
            store.CheckIntegrity();
            _ = store.Read();
        });
        return Open(destination);
    }

    public static SqliteLedgerStore Open(string path)
    {
        path = ExistingPath(path);
        RequireWritable(path);
        var db = Connect(path, SqliteOpenMode.ReadWrite);
        var store = new SqliteLedgerStore(path, db);
        try
        {
            store.CheckIntegrity();
            _ = store.Read();
            // Exercise a real write transaction: ReadWrite mode alone does not prove writability.
            using var transaction = db.BeginTransaction();
            Execute(db, transaction, "UPDATE ledger SET revision = revision WHERE singleton = 1");
            transaction.Rollback();
            return store;
        }
        catch
        {
            store.Dispose();
            throw;
        }
    }

    public static void RestoreBackup(string backupPath, string newDatabasePath)
    {
        var sourcePath = ExistingPath(backupPath);
        var destination = NewDestination(newDatabasePath);
        RejectSourceDestination(sourcePath, destination);
        using var db = Connect(sourcePath, SqliteOpenMode.ReadOnly);
        using var source = new SqliteLedgerStore(sourcePath, db);
        source.CheckIntegrity();
        _ = source.Read();
        source.BackupTo(destination);
    }

    public LedgerSnapshot Read()
    {
        lock (gate)
        {
            ThrowIfDisposed();
            using var transaction = connection.BeginTransaction(deferred: true);
            AssertSchema(connection, transaction);
            var snapshot = ReadContents(connection, transaction);
            transaction.Commit();
            return snapshot;
        }
    }

    public void Write(LedgerSnapshot next, long expectedRevision)
    {
        ArgumentNullException.ThrowIfNull(next);
        lock (gate)
        {
            ThrowIfDisposed();
            next = CopySnapshot(next);
            if (expectedRevision < 0 || expectedRevision == long.MaxValue || next.Revision != expectedRevision + 1)
                throw new StoreConcurrencyException("保存版本必须等于预期版本加一，请刷新账套后重试。");

            // BEGIN IMMEDIATE serializes competing writers before reading the revision.
            using var transaction = connection.BeginTransaction(deferred: false);
            AssertSchema(connection, transaction);
            var id = (string?)Scalar(connection, transaction, "SELECT book_id FROM ledger WHERE singleton = 1");
            if (id != next.Book.Id.ToString("D"))
                throw new LedgerValidationException("不能将其他账套的快照写入当前账套。");
            var changed = Execute(connection, transaction, """
                UPDATE ledger SET revision = $next WHERE singleton = 1 AND revision = $expected
                """, ("$next", next.Revision), ("$expected", expectedRevision));
            if (changed != 1)
                throw new StoreConcurrencyException("账套已被其他操作修改，请刷新后重试。");
            // Check CAS first: a concurrent winner's newly appended module journal must
            // produce a concurrency conflict, not be mistaken for an attempted truncation.
            var retainedAuditIds = AssertModuleJournalRetained(ReadContents(connection, transaction), next);
            if (next.AuditEvents.Any(IsModuleJournal))
                Execute(connection, transaction, Schema.ModuleJournalProtection);
            Execute(connection, transaction, """
                UPDATE ledger SET book_id=$id, name=$name, regime=$regime, template_version=$template,
                    fiscal_year=$year, start_month=$start, closed_through_month=$closed, created_at=$created
                WHERE singleton=1;
                DELETE FROM voucher_lines;
                DELETE FROM vouchers;
                DELETE FROM audit_events WHERE action NOT GLOB 'ParityModuleCommit.*';
                DELETE FROM accounts;
                """, BookParameters(next.Book));
            InsertContents(connection, transaction, next, retainedAuditIds);
            // Constraints/triggers can silently ignore, replace or alter rows. Verify every
            // DTO field using this transaction's uncommitted view, before committing anything.
            AssertReadback(next, ReadContents(connection, transaction));
            transaction.Commit();
        }
    }

    /// <summary>Creates a new backup file; never replaces an existing destination.</summary>
    public void BackupTo(string destinationPath)
    {
        lock (gate)
        {
            ThrowIfDisposed();
            var destination = NewDestination(destinationPath);
            RejectSourceDestination(DatabasePath, destination);
            AssertSchema(connection, null);
            PublishNew(destination, stage =>
            {
                using var target = Connect(stage, SqliteOpenMode.ReadWrite);
                connection.BackupDatabase(target);
                // A WAL source may copy its journal mode. Publish a self-contained file.
                Execute(target, null, "PRAGMA journal_mode = DELETE");
                using var backup = new SqliteLedgerStore(stage, target);
                backup.CheckIntegrity();
                _ = backup.Read();
            });
        }
    }

    public void CheckIntegrity()
    {
        lock (gate)
        {
            ThrowIfDisposed();
            using var transaction = connection.BeginTransaction(deferred: true);
            AssertSchema(connection, transaction);
            using (var command = Command(connection, transaction, "PRAGMA integrity_check"))
            using (var reader = command.ExecuteReader())
            {
                if (!reader.Read() || reader.GetString(0) != "ok" || reader.Read())
                    throw new InvalidDataException("SQLite完整性检查失败。");
            }
            using (var command = Command(connection, transaction, "PRAGMA foreign_key_check"))
            using (var reader = command.ExecuteReader())
            {
                if (reader.Read()) throw new InvalidDataException("账套存在无效的外键引用。");
            }
            if ((long?)Scalar(connection, transaction, "SELECT count(*) FROM ledger WHERE singleton = 1") != 1)
                throw new InvalidDataException("账套信息缺失。");
            transaction.Commit();
        }
    }

    public void Dispose()
    {
        lock (gate)
        {
            if (disposed) return;
            connection.Dispose();
            disposed = true;
        }
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(disposed, this);

    private static SqliteConnection Connect(string path, SqliteOpenMode mode)
    {
        var db = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = path, Mode = mode, Pooling = false, ForeignKeys = true,
            Cache = SqliteCacheMode.Private, DefaultTimeout = 10
        }.ToString());
        try
        {
            db.Open();
            Execute(db, null, "PRAGMA synchronous = FULL; PRAGMA trusted_schema = OFF;");
            if ((long?)Scalar(db, null, "PRAGMA foreign_keys") != 1)
                throw new InvalidOperationException("SQLite未启用外键约束。");
            return db;
        }
        catch { db.Dispose(); throw; }
    }

    private static void AssertSchema(SqliteConnection db, SqliteTransaction? transaction)
    {
        var version = (long)Scalar(db, transaction, "PRAGMA user_version")!;
        if (version > Schema.Version) throw new InvalidDataException($"账套版本{version}高于当前支持版本{Schema.Version}。");
        if (version != Schema.Version || (long)Scalar(db, transaction, "PRAGMA application_id")! != Schema.ApplicationId)
            throw new InvalidDataException("文件不是受支持的财务账套。");
    }

    private static string ExistingPath(string path)
    {
        var full = FullPath(path);
        if (!File.Exists(full)) throw new FileNotFoundException("账套文件不存在。", full);
        return ResolveLinks(full);
    }

    private static string NewDestination(string path)
    {
        var full = FullPath(path);
        // PublishNew atomically rejects existing destinations after staging too.
        if (Path.Exists(full)) throw new IOException("目标已存在，不能覆盖已有文件。");
        if (!Directory.Exists(Path.GetDirectoryName(full))) throw new DirectoryNotFoundException("目标目录不存在。");
        full = ResolveLinks(full);
        foreach (var suffix in new[] { "-wal", "-shm", "-journal" })
            if (Path.Exists(full + suffix)) throw new IOException("目标存在SQLite日志文件，请选择新路径。");
        return full;
    }

    private static string FullPath(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        return Path.GetFullPath(path);
    }

    private static string ResolveLinks(string full)
    {
        // Normalize existing directory aliases as well as a source-file symlink, so a
        // nonexistent source sidecar cannot be reached through an alternate directory.
        var root = Path.GetPathRoot(full)!;
        var current = root;
        foreach (var part in full[root.Length..].Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, part);
            FileSystemInfo entry = Directory.Exists(current) ? new DirectoryInfo(current) : new FileInfo(current);
            if (entry.LinkTarget is not null)
                current = entry.ResolveLinkTarget(returnFinalTarget: true)?.FullName
                    ?? throw new IOException("无法解析目标路径的符号链接。");
        }
        return current;
    }

    private static void RejectSourceDestination(string source, string destination)
    {
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        foreach (var suffix in new[] { "", "-wal", "-shm", "-journal" })
            if (string.Equals(source + suffix, destination, comparison))
                throw new IOException("备份目标不能是源账套或其日志文件。");
    }

    private static void RequireWritable(string path)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReadOnly) != 0)
            throw new UnauthorizedAccessException("账套文件为只读。");
        if (!OperatingSystem.IsWindows())
        {
            const UnixFileMode write = UnixFileMode.UserWrite | UnixFileMode.GroupWrite | UnixFileMode.OtherWrite;
            if ((File.GetUnixFileMode(path) & write) == 0 ||
                (File.GetUnixFileMode(Path.GetDirectoryName(path)!) & write) == 0)
                throw new UnauthorizedAccessException("账套文件或目录为只读。");
        }
    }

    private static void PublishNew(string destination, Action<string> populate)
    {
        var stage = Path.Combine(Path.GetDirectoryName(destination)!, $".caiwu-{Guid.NewGuid():N}.tmp");
        using (new FileStream(stage, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { }
        try
        {
            populate(stage);
            if (OperatingSystem.IsWindows())
            {
                // Windows MoveFileEx without REPLACE_EXISTING rejects a competing file.
                File.Move(stage, destination, overwrite: false);
            }
            else if (LinkNew(stage, destination) != 0)
            {
                // Unix File.Move(false) can check absence then call replacing rename.
                // link publishes the complete staged inode and atomically fails if the
                // name already exists. Never fall back to a replacing move or partial copy.
                var error = new Win32Exception(Marshal.GetLastPInvokeError());
                throw new IOException("无法安全发布账套：目标已存在或文件系统不支持原子硬链接发布。", error);
            }
        }
        finally
        {
            File.Delete(stage);
            foreach (var suffix in new[] { "-journal", "-wal", "-shm" }) File.Delete(stage + suffix);
        }
    }

    [DllImport("libc", EntryPoint = "link", SetLastError = true)]
    private static extern int LinkNew(
        [MarshalAs(UnmanagedType.LPUTF8Str)] string existingPath,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string newPath);

    private static (string, object?)[] BookParameters(BookInfo book) =>
    [
        ("$id", book.Id.ToString("D")), ("$name", book.Name), ("$regime", (int)book.Regime),
        ("$template", book.TemplateVersion), ("$year", book.FiscalYear), ("$start", book.StartMonth),
        ("$closed", book.ClosedThroughMonth), ("$created", book.CreatedAt.ToString("O", CultureInfo.InvariantCulture))
    ];

    private static SqliteCommand Command(SqliteConnection db, SqliteTransaction? transaction, string sql,
        params (string Name, object? Value)[] parameters)
    {
        var command = db.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value ?? DBNull.Value);
        return command;
    }

    private static int Execute(SqliteConnection db, SqliteTransaction? transaction, string sql,
        params (string Name, object? Value)[] parameters)
    {
        using var command = Command(db, transaction, sql, parameters);
        return command.ExecuteNonQuery();
    }

    private static object? Scalar(SqliteConnection db, SqliteTransaction? transaction, string sql)
    {
        using var command = Command(db, transaction, sql);
        return command.ExecuteScalar();
    }

    private static long Cents(decimal amount)
    {
        // Compare before multiplying: even decimal.MaxValue must fail without truncation.
        if (amount < long.MinValue / 100m || amount > long.MaxValue / 100m)
            throw new LedgerValidationException("金额超过Int64分的存储范围。");
        var cents = amount * 100m;
        if (decimal.Truncate(cents) != cents) throw new LedgerValidationException("金额最多支持两位小数。");
        return decimal.ToInt64(cents);
    }

    private static LedgerSnapshot CopySnapshot(LedgerSnapshot snapshot) => snapshot with
    {
        Accounts = snapshot.Accounts.ToArray(),
        Vouchers = snapshot.Vouchers.Select(v => v with { Lines = v.Lines.ToArray() }).ToArray(),
        AuditEvents = snapshot.AuditEvents.ToArray()
    };

    private static void AssertReadback(LedgerSnapshot expected, LedgerSnapshot actual)
    {
        static void Equal(bool condition, string part)
        {
            if (!condition) throw new InvalidDataException($"SQLite写入读回校验失败（{part}），拒绝提交。");
        }
        Equal(expected.Revision == actual.Revision && expected.Book == actual.Book &&
            expected.Book.CreatedAt.EqualsExact(actual.Book.CreatedAt), "账套身份、属性或版本");
        Equal(expected.Accounts.SequenceEqual(actual.Accounts), "科目及期初余额");
        Equal(expected.Vouchers.Count == actual.Vouchers.Count, "凭证集合");
        for (var i = 0; i < expected.Vouchers.Count; i++)
        {
            var e = expected.Vouchers[i]; var a = actual.Vouchers[i];
            // Record equality checks every header field; line collections need value comparison.
            Equal((e with { Lines = a.Lines }) == a && e.Lines.SequenceEqual(a.Lines), $"凭证及完整分录，第{i + 1}张");
        }
        Equal(expected.AuditEvents.SequenceEqual(actual.AuditEvents), "审计记录");
        for (var i = 0; i < expected.AuditEvents.Count; i++)
            Equal(expected.AuditEvents[i].At.EqualsExact(actual.AuditEvents[i].At), "审计时间及偏移");
    }

    private static bool IsModuleJournal(AuditEvent audit) => audit.Action.StartsWith("ParityModuleCommit.", StringComparison.Ordinal);

    private static HashSet<Guid> AssertModuleJournalRetained(LedgerSnapshot before, LedgerSnapshot next)
    {
        var retained = new HashSet<Guid>();
        for (var i = 0; i < before.AuditEvents.Count; i++)
        {
            var old = before.AuditEvents[i];
            if (!IsModuleJournal(old)) continue;
            if (i >= next.AuditEvents.Count || next.AuditEvents[i] != old ||
                !next.AuditEvents[i].At.EqualsExact(old.At))
                throw new LedgerValidationException("模块事件包含权威业务数据，不能裁剪、重排或改写；请使用保留完整模块日志的客户端。");
            retained.Add(old.Id);
        }
        return retained;
    }

    private static void InsertContents(SqliteConnection db, SqliteTransaction transaction, LedgerSnapshot snapshot,
        IReadOnlySet<Guid>? retainedAuditIds = null)
    {
        for (var i = 0; i < snapshot.Accounts.Count; i++)
        {
            var a = snapshot.Accounts[i];
            Execute(db, transaction, """
                INSERT INTO accounts (code,ordinal,name,parent_code,direction,is_active,opening_debit_cents,opening_credit_cents)
                VALUES ($code,$ordinal,$name,$parent,$direction,$active,$debit,$credit)
                """,
                ("$code", a.Code), ("$ordinal", i), ("$name", a.Name), ("$parent", a.ParentCode),
                ("$direction", (int)a.Direction), ("$active", a.IsActive ? 1 : 0),
                ("$debit", Cents(a.OpeningDebit)), ("$credit", Cents(a.OpeningCredit)));
        }
        for (var i = 0; i < snapshot.Vouchers.Count; i++)
        {
            var v = snapshot.Vouchers[i];
            var id = v.Id.ToString("D");
            Execute(db, transaction, """
                INSERT INTO vouchers (id,ordinal,date,kind,number,attachment_count,prepared_by,reviewed_by,status)
                VALUES ($id,$ordinal,$date,$kind,$number,$attachments,$prepared,$reviewed,$status)
                """,
                ("$id", id), ("$ordinal", i), ("$date", v.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
                ("$kind", v.Kind), ("$number", v.Number), ("$attachments", v.AttachmentCount),
                ("$prepared", v.PreparedBy), ("$reviewed", v.ReviewedBy), ("$status", (int)v.Status));
            for (var j = 0; j < v.Lines.Count; j++)
            {
                var line = v.Lines[j];
                Execute(db, transaction, """
                    INSERT INTO voucher_lines (voucher_id,ordinal,account_code,summary,debit_cents,credit_cents)
                    VALUES ($id,$ordinal,$account,$summary,$debit,$credit)
                    """,
                    ("$id", id), ("$ordinal", j), ("$account", line.AccountCode), ("$summary", line.Summary),
                    ("$debit", Cents(line.Debit)), ("$credit", Cents(line.Credit)));
            }
        }
        for (var i = 0; i < snapshot.AuditEvents.Count; i++)
        {
            var a = snapshot.AuditEvents[i];
            if (retainedAuditIds?.Contains(a.Id) == true) continue;
            Execute(db, transaction, """
                INSERT INTO audit_events (id,ordinal,at,operator_name,action,voucher_id,detail)
                VALUES ($id,$ordinal,$at,$operator,$action,$voucher,$detail)
                """,
                ("$id", a.Id.ToString("D")), ("$ordinal", i), ("$at", a.At.ToString("O", CultureInfo.InvariantCulture)),
                ("$operator", a.OperatorName), ("$action", a.Action), ("$voucher", a.VoucherId?.ToString("D")), ("$detail", a.Detail));
        }
    }

    private static LedgerSnapshot ReadContents(SqliteConnection db, SqliteTransaction transaction)
    {
        long revision;
        BookInfo book;
        using (var command = Command(db, transaction, """
            SELECT singleton,revision,book_id,name,regime,template_version,fiscal_year,start_month,closed_through_month,created_at
            FROM ledger ORDER BY singleton
            """))
        using (var r = command.ExecuteReader())
        {
            if (!r.Read() || Integer(r, 0) != 1) throw new InvalidDataException("账套信息缺失或主记录无效。");
            revision = Integer(r, 1);
            book = new(Guid.ParseExact(r.GetString(2), "D"), r.GetString(3), EnumValue<AccountingRegime>(r, 4),
                r.GetString(5), Int32(r, 6), Int32(r, 7), Int32(r, 8), ParseTimestamp(r.GetString(9)));
            if (r.Read()) throw new InvalidDataException("账套存在多条主记录。");
        }
        var accounts = new List<Account>();
        using (var command = Command(db, transaction, """
            SELECT code,name,parent_code,direction,is_active,opening_debit_cents,opening_credit_cents FROM accounts ORDER BY ordinal
            """))
        using (var r = command.ExecuteReader())
            while (r.Read()) accounts.Add(new(r.GetString(0), r.GetString(1), NullableString(r, 2),
                EnumValue<BalanceDirection>(r, 3), Boolean(r, 4), Integer(r, 5) / 100m, Integer(r, 6) / 100m));
        var lines = new Dictionary<string, List<VoucherLine>>();
        using (var command = Command(db, transaction, """
            SELECT voucher_id,account_code,summary,debit_cents,credit_cents FROM voucher_lines ORDER BY voucher_id, ordinal
            """))
        using (var r = command.ExecuteReader())
            while (r.Read())
            {
                var id = r.GetString(0);
                if (!lines.TryGetValue(id, out var list)) lines.Add(id, list = []);
                list.Add(new(r.GetString(1), r.GetString(2), Integer(r, 3) / 100m, Integer(r, 4) / 100m));
            }
        var vouchers = new List<Voucher>();
        using (var command = Command(db, transaction, """
            SELECT id,date,kind,number,attachment_count,prepared_by,reviewed_by,status FROM vouchers ORDER BY ordinal
            """))
        using (var r = command.ExecuteReader())
            while (r.Read()) vouchers.Add(new(Guid.ParseExact(r.GetString(0), "D"),
                DateOnly.ParseExact(r.GetString(1), "yyyy-MM-dd", CultureInfo.InvariantCulture), r.GetString(2),
                Int32(r, 3), Int32(r, 4), r.GetString(5), NullableString(r, 6), EnumValue<VoucherStatus>(r, 7),
                lines.Remove(r.GetString(0), out var list) ? list.ToArray() : []));
        if (lines.Count != 0) throw new InvalidDataException("存在未归属有效凭证的分录。");
        var audit = new List<AuditEvent>();
        using (var command = Command(db, transaction, """
            SELECT id,at,operator_name,action,voucher_id,detail FROM audit_events ORDER BY ordinal
            """))
        using (var r = command.ExecuteReader())
            while (r.Read()) audit.Add(new(Guid.ParseExact(r.GetString(0), "D"), ParseTimestamp(r.GetString(1)),
                r.GetString(2), r.GetString(3), r.IsDBNull(4) ? null : Guid.ParseExact(r.GetString(4), "D"), r.GetString(5)));
        return new(revision, book, accounts.ToArray(), vouchers.ToArray(), audit.ToArray());
    }

    private static string? NullableString(SqliteDataReader reader, int ordinal) => reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
    private static DateTimeOffset ParseTimestamp(string value) => DateTimeOffset.ParseExact(value, "O", CultureInfo.InvariantCulture);

    // GetInt64 alone coerces REAL/TEXT values, which could hide altered fractional cents.
    private static long Integer(SqliteDataReader reader, int ordinal) => reader.GetValue(ordinal) is long value
        ? value : throw new InvalidDataException("账套整数或金额字段的实际存储类型无效。");
    private static int Int32(SqliteDataReader reader, int ordinal) => checked((int)Integer(reader, ordinal));
    private static bool Boolean(SqliteDataReader reader, int ordinal) => Integer(reader, ordinal) switch
    {
        0 => false, 1 => true, _ => throw new InvalidDataException("账套布尔字段无效。")
    };
    private static T EnumValue<T>(SqliteDataReader reader, int ordinal) where T : struct, Enum
    {
        var value = (T)Enum.ToObject(typeof(T), Int32(reader, ordinal));
        return Enum.IsDefined(value) ? value : throw new InvalidDataException("账套枚举字段无效。");
    }
}
