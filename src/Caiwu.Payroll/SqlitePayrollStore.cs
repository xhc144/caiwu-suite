using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace Caiwu.Payroll;

/// <summary>Dedicated module workspace, never the shared ledger or an original SQL Anywhere book.</summary>
public sealed class SqlitePayrollStore : IPayrollStore
{
    private const int ApplicationId = 0x43505731;
    private readonly string path;
    public Guid BookId { get; }

    private SqlitePayrollStore(string path, Guid bookId) { this.path = path; BookId = bookId; }

    public static SqlitePayrollStore CreateNew(string path, Guid bookId, string name, DateOnly openingMonth)
    {
        CheckPath(path);
        Guard.Require(bookId != Guid.Empty && !string.IsNullOrWhiteSpace(name), "账套身份和名称不能为空。");
        Guard.Require(openingMonth.Day == 1, "开始月份必须为当月一日。");
        // Exclusive create prevents accidental overwrite, including a concurrent creator.
        using (new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { }
        var store = new SqlitePayrollStore(Path.GetFullPath(path), bookId);
        using var connection = store.Connect(false);
        using var transaction = connection.BeginTransaction();
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = $"""
            PRAGMA application_id={ApplicationId};
            PRAGMA user_version=1;
            CREATE TABLE payroll_document (
                singleton INTEGER PRIMARY KEY CHECK(singleton=1),
                book_id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL);
            INSERT INTO payroll_document VALUES(1,$book,0,$payload);
            """;
        command.Parameters.AddWithValue("$book", bookId.ToString("D"));
        command.Parameters.AddWithValue("$payload", PayrollJson.Serialize(new PayrollDocument
            { BookId = bookId, BookName = name, OpeningMonth = openingMonth }));
        command.ExecuteNonQuery();
        transaction.Commit();
        return store;
    }

    public static SqlitePayrollStore Open(string path, Guid expectedBookId)
    {
        CheckPath(path);
        Guard.Require(expectedBookId != Guid.Empty, "必须指定账套身份。");
        var store = new SqlitePayrollStore(Path.GetFullPath(path), expectedBookId);
        _ = store.Read(); // Read-only probe; does not create or stamp an unrecognized file.
        return store;
    }

    public PayrollDocument Read()
    {
        using var connection = Connect(true);
        CheckIdentity(connection);
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT book_id,revision,payload FROM payroll_document WHERE singleton=1";
        using var reader = command.ExecuteReader();
        Guard.Require(reader.Read(), "工资工作文件缺少账套记录。");
        Guard.Require(reader.GetString(0) == BookId.ToString("D"), "工资工作文件不属于当前账套。");
        PayrollDocument document;
        try { document = JsonSerializer.Deserialize<PayrollDocument>(reader.GetString(2), PayrollJson.Options)
                ?? throw new PayrollValidationException("工资工作文件内容为空。"); }
        catch (JsonException) { throw new PayrollValidationException("工资工作文件内容格式错误。"); }
        Guard.Require(document.BookId == BookId && document.FormatVersion == 1
            && document.Revision == reader.GetInt64(1), "工资工作文件身份、版本或修订不一致。");
        return document;
    }

    public PayrollDocument Commit(PayrollDocument document, long expectedRevision)
    {
        Guard.Require(document.BookId == BookId && document.Revision == expectedRevision,
            "不能跨账套或跨修订保存工资数据。");
        var next = PayrollJson.Clone(document);
        next.Revision = checked(expectedRevision + 1);
        using var connection = Connect(false);
        CheckIdentity(connection);
        using var transaction = connection.BeginTransaction();
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            UPDATE payroll_document SET revision=$next,payload=$payload
            WHERE singleton=1 AND book_id=$book AND revision=$expected
            """;
        command.Parameters.AddWithValue("$next", next.Revision);
        command.Parameters.AddWithValue("$payload", PayrollJson.Serialize(next));
        command.Parameters.AddWithValue("$book", BookId.ToString("D"));
        command.Parameters.AddWithValue("$expected", expectedRevision);
        if (command.ExecuteNonQuery() != 1) throw new PayrollConflictException();
        transaction.Commit();
        return next;
    }

    private SqliteConnection Connect(bool readOnly)
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = path, Mode = readOnly ? SqliteOpenMode.ReadOnly : SqliteOpenMode.ReadWrite,
            Pooling = false, DefaultTimeout = 3
        }.ToString());
        try { connection.Open(); return connection; }
        catch { connection.Dispose(); throw; }
    }

    private void CheckIdentity(SqliteConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA application_id";
        Guard.Require(Convert.ToInt32(command.ExecuteScalar()) == ApplicationId, "不是受支持的工资工作文件。");
        command.CommandText = "PRAGMA user_version";
        Guard.Require(Convert.ToInt32(command.ExecuteScalar()) == 1, "工资工作文件版本不受支持。");
        command.CommandText = "SELECT book_id FROM payroll_document WHERE singleton=1";
        Guard.Require((string?)command.ExecuteScalar() == BookId.ToString("D"), "工资工作文件不属于当前账套。");
    }

    private static void CheckPath(string path) => Guard.Require(path.EndsWith(".payroll.sqlite", StringComparison.OrdinalIgnoreCase),
        "请选择独立 .payroll.sqlite 工资工作文件；不能打开原账套或 .caiwu 文件。");
}
