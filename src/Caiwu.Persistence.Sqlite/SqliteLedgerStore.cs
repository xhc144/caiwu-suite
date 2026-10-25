using System.Globalization;
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
        var destination = NewDestination(path);
        PublishNew(destination, stage =>
        {
            using var db = Connect(stage, SqliteOpenMode.ReadWrite);
            using (var transaction = db.BeginTransaction())
            {
                Execute(db, transaction, Schema.Create);
                Execute(db, transaction, """
                    INSERT INTO ledger VALUES (1, 0, $id, $name, $regime, $template,
                        $year, $start, $closed, $created)
                    """, BookParameters(book));
                InsertContents(db, transaction, new(0, book, accounts, [], []));
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
            Execute(connection, transaction, """
                UPDATE ledger SET book_id=$id, name=$name, regime=$regime, template_version=$template,
                    fiscal_year=$year, start_month=$start, closed_through_month=$closed, created_at=$created
                WHERE singleton=1;
                DELETE FROM voucher_lines;
                DELETE FROM vouchers;
                DELETE FROM audit_events;
                DELETE FROM accounts;
                """, BookParameters(next.Book));
            InsertContents(connection, transaction, next);
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
        // File.Move without overwrite also enforces this after the staging work.
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
            File.Move(stage, destination, overwrite: false);
        }
        finally
        {
            File.Delete(stage);
            foreach (var suffix in new[] { "-journal", "-wal", "-shm" }) File.Delete(stage + suffix);
        }
    }

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

    private static void InsertContents(SqliteConnection db, SqliteTransaction transaction, LedgerSnapshot snapshot)
    {
        for (var i = 0; i < snapshot.Accounts.Count; i++)
        {
            var a = snapshot.Accounts[i];
            Execute(db, transaction, "INSERT INTO accounts VALUES ($code,$ordinal,$name,$parent,$direction,$active,$debit,$credit)",
                ("$code", a.Code), ("$ordinal", i), ("$name", a.Name), ("$parent", a.ParentCode),
                ("$direction", (int)a.Direction), ("$active", a.IsActive ? 1 : 0),
                ("$debit", Cents(a.OpeningDebit)), ("$credit", Cents(a.OpeningCredit)));
        }
        for (var i = 0; i < snapshot.Vouchers.Count; i++)
        {
            var v = snapshot.Vouchers[i];
            var id = v.Id.ToString("D");
            Execute(db, transaction, "INSERT INTO vouchers VALUES ($id,$ordinal,$date,$kind,$number,$attachments,$prepared,$reviewed,$status)",
                ("$id", id), ("$ordinal", i), ("$date", v.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
                ("$kind", v.Kind), ("$number", v.Number), ("$attachments", v.AttachmentCount),
                ("$prepared", v.PreparedBy), ("$reviewed", v.ReviewedBy), ("$status", (int)v.Status));
            for (var j = 0; j < v.Lines.Count; j++)
            {
                var line = v.Lines[j];
                Execute(db, transaction, "INSERT INTO voucher_lines VALUES ($id,$ordinal,$account,$summary,$debit,$credit)",
                    ("$id", id), ("$ordinal", j), ("$account", line.AccountCode), ("$summary", line.Summary),
                    ("$debit", Cents(line.Debit)), ("$credit", Cents(line.Credit)));
            }
        }
        for (var i = 0; i < snapshot.AuditEvents.Count; i++)
        {
            var a = snapshot.AuditEvents[i];
            Execute(db, transaction, "INSERT INTO audit_events VALUES ($id,$ordinal,$at,$operator,$action,$voucher,$detail)",
                ("$id", a.Id.ToString("D")), ("$ordinal", i), ("$at", a.At.ToString("O", CultureInfo.InvariantCulture)),
                ("$operator", a.OperatorName), ("$action", a.Action), ("$voucher", a.VoucherId?.ToString("D")), ("$detail", a.Detail));
        }
    }

    private static LedgerSnapshot ReadContents(SqliteConnection db, SqliteTransaction transaction)
    {
        long revision;
        BookInfo book;
        using (var command = Command(db, transaction, "SELECT * FROM ledger WHERE singleton=1"))
        using (var r = command.ExecuteReader())
        {
            if (!r.Read()) throw new InvalidDataException("账套信息缺失。");
            revision = r.GetInt64(1);
            book = new(Guid.ParseExact(r.GetString(2), "D"), r.GetString(3), (AccountingRegime)r.GetInt32(4),
                r.GetString(5), r.GetInt32(6), r.GetInt32(7), r.GetInt32(8), ParseTimestamp(r.GetString(9)));
        }
        var accounts = new List<Account>();
        using (var command = Command(db, transaction, "SELECT * FROM accounts ORDER BY ordinal"))
        using (var r = command.ExecuteReader())
            while (r.Read()) accounts.Add(new(r.GetString(0), r.GetString(2), NullableString(r, 3),
                (BalanceDirection)r.GetInt32(4), r.GetInt64(5) == 1, r.GetInt64(6) / 100m, r.GetInt64(7) / 100m));
        var lines = new Dictionary<string, List<VoucherLine>>();
        using (var command = Command(db, transaction, "SELECT * FROM voucher_lines ORDER BY voucher_id, ordinal"))
        using (var r = command.ExecuteReader())
            while (r.Read())
            {
                var id = r.GetString(0);
                if (!lines.TryGetValue(id, out var list)) lines.Add(id, list = []);
                list.Add(new(r.GetString(2), r.GetString(3), r.GetInt64(4) / 100m, r.GetInt64(5) / 100m));
            }
        var vouchers = new List<Voucher>();
        using (var command = Command(db, transaction, "SELECT * FROM vouchers ORDER BY ordinal"))
        using (var r = command.ExecuteReader())
            while (r.Read()) vouchers.Add(new(Guid.ParseExact(r.GetString(0), "D"),
                DateOnly.ParseExact(r.GetString(2), "yyyy-MM-dd", CultureInfo.InvariantCulture), r.GetString(3),
                r.GetInt32(4), r.GetInt32(5), r.GetString(6), NullableString(r, 7), (VoucherStatus)r.GetInt32(8),
                lines.TryGetValue(r.GetString(0), out var list) ? list.ToArray() : []));
        var audit = new List<AuditEvent>();
        using (var command = Command(db, transaction, "SELECT * FROM audit_events ORDER BY ordinal"))
        using (var r = command.ExecuteReader())
            while (r.Read()) audit.Add(new(Guid.ParseExact(r.GetString(0), "D"), ParseTimestamp(r.GetString(2)),
                r.GetString(3), r.GetString(4), r.IsDBNull(5) ? null : Guid.ParseExact(r.GetString(5), "D"), r.GetString(6)));
        return new(revision, book, accounts.ToArray(), vouchers.ToArray(), audit.ToArray());
    }

    private static string? NullableString(SqliteDataReader reader, int ordinal) => reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
    private static DateTimeOffset ParseTimestamp(string value) => DateTimeOffset.ParseExact(value, "O", CultureInfo.InvariantCulture);
}
