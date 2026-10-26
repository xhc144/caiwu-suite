using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace Caiwu.Cashier;

/// <summary>
/// Durable module-owned synthetic workspace. It never opens SQL Anywhere or an existing .caiwu file.
/// The aggregate payload is versioned and decimal-preserving; it is not an original schema migration.
/// </summary>
public sealed class SqliteCashierStore : ICashierStore
{
    private const int ApplicationId = 0x434E5359;
    private const int SchemaVersion = 1;
    private readonly string path;
    private SqliteCashierStore(string path) => this.path = path;

    public static SqliteCashierStore CreateSynthetic(string path, BookDefinition book)
    {
        ValidateBook(book);
        path = ValidatePath(path);
        // CreateNew prevents accidental overwrite, including an existing original/production file.
        using (new FileStream(path, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None)) { }
        var store = new SqliteCashierStore(path);
        // A failed creation leaves the explicit new file for inspection, never deletes a caller file.
        using var connection = store.Connect();
        using var transaction = connection.BeginTransaction(deferred: false);
        using var create = connection.CreateCommand();
        create.Transaction = transaction;
        create.CommandText = $"""
            PRAGMA application_id={ApplicationId};
            PRAGMA user_version={SchemaVersion};
            CREATE TABLE cashier_state(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL);
            """;
        create.ExecuteNonQuery();
        using var insert = connection.CreateCommand();
        insert.Transaction = transaction;
        insert.CommandText = "INSERT INTO cashier_state(id, revision, payload) VALUES(1,0,$payload)";
        insert.Parameters.AddWithValue("$payload", JsonSerializer.Serialize(CashierSnapshot.Empty(book)));
        insert.ExecuteNonQuery();
        transaction.Commit();
        return store;
    }

    public static SqliteCashierStore OpenSynthetic(string path)
    {
        var store = new SqliteCashierStore(ValidatePath(path));
        _ = store.Read(); // Open is read/write mode without Create; unknown application/schema is rejected.
        return store;
    }

    public CashierSnapshot Read()
    {
        using var connection = Connect();
        CheckFormat(connection);
        return ReadState(connection, null);
    }

    public CashierSnapshot Transact(long expectedRevision, Func<CashierSnapshot, CashierSnapshot> transform)
    {
        ArgumentNullException.ThrowIfNull(transform);
        using var connection = Connect();
        CheckFormat(connection);
        // IMMEDIATE obtains a writer lock before reading the revision, including across processes.
        using var transaction = connection.BeginTransaction(deferred: false);
        var current = ReadState(connection, transaction);
        if (current.Revision != expectedRevision) throw new CashierConcurrencyException(expectedRevision, current.Revision);
        var updated = transform(current) with { Revision = checked(current.Revision + 1) };
        CashierService.Require(updated.Book.Id == current.Book.Id, "store.book", "事务不能切换账套身份。");
        ValidateState(updated);
        using var write = connection.CreateCommand();
        write.Transaction = transaction;
        write.CommandText = "UPDATE cashier_state SET revision=$next, payload=$payload WHERE id=1 AND revision=$expected";
        write.Parameters.AddWithValue("$next", updated.Revision);
        write.Parameters.AddWithValue("$payload", JsonSerializer.Serialize(updated));
        write.Parameters.AddWithValue("$expected", expectedRevision);
        if (write.ExecuteNonQuery() != 1) throw new CashierConcurrencyException(expectedRevision, ReadState(connection, transaction).Revision);
        transaction.Commit();
        // Detach the result from references captured by a transaction callback.
        return JsonSerializer.Deserialize<CashierSnapshot>(JsonSerializer.Serialize(updated))!;
    }

    private SqliteConnection Connect()
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = path, Mode = SqliteOpenMode.ReadWrite, Pooling = false, DefaultTimeout = 5
        }.ToString());
        try { connection.Open(); return connection; }
        catch { connection.Dispose(); throw; }
    }

    private static string ValidatePath(string candidate)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(candidate);
        var full = Path.GetFullPath(candidate);
        if (!full.EndsWith(".cashier-synthetic.db", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("请明确选择模块专用 .cashier-synthetic.db 合成测试文件。", nameof(candidate));
        if (new FileInfo(full).LinkTarget is not null) throw new IOException("不接受链接文件作为出纳存储。");
        return full;
    }

    private static void CheckFormat(SqliteConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA application_id";
        long app = (long)command.ExecuteScalar()!;
        command.CommandText = "PRAGMA user_version";
        long version = (long)command.ExecuteScalar()!;
        if (app != ApplicationId || version != SchemaVersion)
            throw new InvalidDataException("不是受支持的出纳合成工作区；未执行格式升级或业务写入。");
    }

    private static CashierSnapshot ReadState(SqliteConnection connection, SqliteTransaction? transaction)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT revision,payload FROM cashier_state WHERE id=1";
        using var reader = command.ExecuteReader();
        if (!reader.Read()) throw new InvalidDataException("出纳存储缺少账套状态。");
        var state = JsonSerializer.Deserialize<CashierSnapshot>(reader.GetString(1))
            ?? throw new InvalidDataException("出纳状态不可读取。");
        if (state.Revision != reader.GetInt64(0)) throw new InvalidDataException("出纳版本号不一致。");
        ValidateState(state);
        return state;
    }

    private static void ValidateBook(BookDefinition b)
    {
        ArgumentNullException.ThrowIfNull(b);
        CashierService.Require(!string.IsNullOrWhiteSpace(b.Id) && !string.IsNullOrWhiteSpace(b.BaseCurrency),
            "book.identity", "账套身份与本位币不能为空。");
        CashierService.Require(b.ActiveMonth.Day == 1 && b.ActiveMonth >= new DateOnly(b.OpeningDate.Year, b.OpeningDate.Month, 1)
            && b.ActiveMonth.Year == b.OpeningDate.Year && b.LatestDocumentDate >= b.OpeningDate,
            "book.period", "开账日期、结账月份与允许录入日期无效。");
        CashierService.Require(b.Accounts is not null && b.Accounts.Select(x => x.Code).Distinct(StringComparer.Ordinal).Count() == b.Accounts.Length,
            "book.accounts", "科目目录为空或存在重复代码。");
        foreach (var a in b.Accounts!)
            CashierService.Require(!string.IsNullOrWhiteSpace(a.Code) && a.Currencies is not null
                && a.Currencies.All(x => !string.IsNullOrWhiteSpace(x)) && a.Currencies.Distinct().Count() == a.Currencies.Length,
                "book.account", "科目代码或币种目录无效。");
    }

    private static void ValidateState(CashierSnapshot s)
    {
        ValidateBook(s.Book);
        CashierService.Require(s.Revision >= 0 && s.NextDocumentNumber > 0 && s.NextReconciliationCode > 0,
            "store.sequence", "出纳版本号或流水号无效。");
        CashierService.Require(s.Documents.Select(x => x.Id).Distinct().Count() == s.Documents.Length
            && s.Documents.Select(x => x.Number).Distinct().Count() == s.Documents.Length
            && s.Documents.All(x => x.Number > 0 && x.Number < s.NextDocumentNumber), "store.documents", "出纳单号重复或无效。");
        CashierService.Require(s.Openings.Select(x => (x.Account, x.Year)).Distinct().Count() == s.Openings.Length,
            "store.openings", "出纳期初账户重复。");
        CashierService.Require(s.LedgerEntries.Select(x => x.Id).Distinct(StringComparer.Ordinal).Count() == s.LedgerEntries.Length,
            "store.ledger", "账务分录识别号重复。");
        CashierService.Require(s.Reconciliations.Select(x => x.Code).Distinct().Count() == s.Reconciliations.Length
            && s.Reconciliations.All(x => x.Code > 0 && x.Code < s.NextReconciliationCode), "store.reconcile", "勾账码无效。");
        foreach (var group in s.Reconciliations)
        {
            var docs = s.Documents.Where(x => x.ReconciliationCode == group.Code).ToArray();
            var ledger = s.LedgerEntries.Where(x => x.ReconciliationCode == group.Code).ToArray();
            CashierService.Require(docs.Length > 0 && ledger.Length > 0
                && docs.Select(x => x.Id).ToHashSet().SetEquals(group.DocumentIds)
                && ledger.Select(x => x.Id).ToHashSet().SetEquals(group.LedgerEntryIds)
                && docs.All(x => x.Account == group.Account) && ledger.All(x => x.Account == group.Account && x.IsPosted)
                && CashierService.AmountsMatch(docs.Sum(x => x.Debit), ledger.Sum(x => x.Debit))
                && CashierService.AmountsMatch(docs.Sum(x => x.Credit), ledger.Sum(x => x.Credit)),
                "store.reconcile.integrity", "勾账关系不完整或金额不等。");
        }
        var codes = s.Reconciliations.Select(x => x.Code).ToHashSet();
        CashierService.Require(s.Documents.All(x => x.ReconciliationCode is null || codes.Contains(x.ReconciliationCode.Value))
            && s.LedgerEntries.All(x => x.ReconciliationCode is null || codes.Contains(x.ReconciliationCode.Value)),
            "store.reconcile.orphan", "存在孤立勾账标记。");
    }
}
