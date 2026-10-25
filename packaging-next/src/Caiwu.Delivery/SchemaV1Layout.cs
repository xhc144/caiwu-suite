using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Persistence.Sqlite;
using Microsoft.Data.Sqlite;

namespace Caiwu.Delivery;

/// <summary>Compare against a fresh schema created by the trusted, installed store implementation.</summary>
internal static class SchemaV1Layout
{
    private sealed record TableShape(string Sql, string Columns, string ForeignKeys, string Flags, string Indexes);
    private static readonly Lazy<IReadOnlyDictionary<string, TableShape>> Expected = new(CreateReference);

    internal static void Validate(SqliteConnection db, SqliteTransaction transaction)
    {
        foreach (var (table, expected) in Expected.Value)
        {
            var actual = CaptureTable(db, transaction, table);
            if (actual != expected)
                throw new InvalidDataException($"Unsupported schema-v1 definition/layout for {table}. Columns, constraints and indexes must match the audited store schema; the input is not migrated or rewritten.");
        }
    }

    private static IReadOnlyDictionary<string, TableShape> CreateReference()
    {
        var directory = Directory.CreateTempSubdirectory("caiwu-schema-v1-reference-");
        var path = Path.Combine(directory.FullName, "reference.caiwu");
        try
        {
            // No user ledger is used as a reference. The schema authority is the trusted store's public creator.
            var book = new BookInfo(Guid.Parse("ee6d9b45-cdb7-421d-a9ed-43ed8198dad5"), "Synthetic schema reference",
                AccountingRegime.SmallBusiness, "delivery-schema-reference", 2000, 1, 0, DateTimeOffset.UnixEpoch);
            using (var created = SqliteLedgerStore.Create(path, book, [])) { }
            using var db = new SqliteConnection(new SqliteConnectionStringBuilder
            { DataSource = path, Mode = SqliteOpenMode.ReadOnly, Pooling = false }.ToString());
            db.Open();
            using var transaction = db.BeginTransaction(deferred: true);
            using (var version = Command(db, transaction, "PRAGMA user_version"))
                if ((long)version.ExecuteScalar()! != 1) throw new InvalidDataException("Installed store schema changed; the audited delivery schema-v1 policy must be reviewed.");
            var reference = LedgerFilePolicy.RequiredTables.ToDictionary(table => table,
                table => CaptureTable(db, transaction, table), StringComparer.Ordinal);
            transaction.Commit();
            return reference;
        }
        finally
        {
            // Delete only the fresh reference we created, never sweep a caller's or user's directory.
            foreach (var suffix in new[] { "", "-wal", "-shm", "-journal" }) File.Delete(path + suffix);
            if (!Directory.EnumerateFileSystemEntries(directory.FullName).Any()) directory.Delete();
        }
    }

    private static TableShape CaptureTable(SqliteConnection db, SqliteTransaction transaction, string table)
    {
        string sql;
        using (var command = Command(db, transaction, "SELECT sql FROM sqlite_schema WHERE type='table' AND name=$name", table))
            sql = command.ExecuteScalar() as string ?? throw new InvalidDataException("Required ledger table is absent.");
        var columns = Rows(db, transaction,
            "SELECT cid,name,type,\"notnull\",dflt_value,pk,hidden FROM pragma_table_xinfo($name) ORDER BY cid", table,
            r => [r.GetInt64(0), Identifier(r, 1), Identifier(r, 2), r.GetInt64(3),
                r.IsDBNull(4) ? null : NormalizeSql(r.GetString(4)), r.GetInt64(5), r.GetInt64(6)]);
        var foreignKeys = Rows(db, transaction,
            "SELECT id,seq,\"table\",\"from\",\"to\",on_update,on_delete,\"match\" FROM pragma_foreign_key_list($name) ORDER BY id,seq", table,
            r => [r.GetInt64(0), r.GetInt64(1), Identifier(r, 2), Identifier(r, 3), Identifier(r, 4), Identifier(r, 5), Identifier(r, 6), Identifier(r, 7)]);
        var flags = Rows(db, transaction,
            "SELECT type,ncol,wr,strict FROM pragma_table_list WHERE schema='main' AND name=$name", table,
            r => [Identifier(r, 0), r.GetInt64(1), r.GetInt64(2), r.GetInt64(3)]);
        var indexes = new List<(string Name, long Unique, string Origin, long Partial)>();
        using (var command = Command(db, transaction,
            "SELECT name,\"unique\",origin,partial FROM pragma_index_list($name) ORDER BY name", table))
        using (var reader = command.ExecuteReader())
            while (reader.Read()) indexes.Add((reader.GetString(0), reader.GetInt64(1), reader.GetString(2), reader.GetInt64(3)));
        var indexShapes = new List<object>();
        foreach (var index in indexes)
        {
            using var definition = Command(db, transaction, "SELECT sql FROM sqlite_schema WHERE type='index' AND name=$name", index.Name);
            var indexSql = definition.ExecuteScalar() as string;
            var indexColumns = Rows(db, transaction,
                "SELECT seqno,cid,name,\"desc\",coll,\"key\" FROM pragma_index_xinfo($name) ORDER BY seqno", index.Name,
                r => [r.GetInt64(0), r.GetInt64(1), Identifier(r, 2), r.GetInt64(3), Identifier(r, 4), r.GetInt64(5)]);
            indexShapes.Add(new { name = index.Name.ToUpperInvariant(), index.Unique,
                origin = index.Origin.ToUpperInvariant(), index.Partial,
                sql = indexSql == null ? null : NormalizeSql(indexSql), columns = indexColumns });
        }
        return new(NormalizeSql(sql), columns, foreignKeys, flags, JsonSerializer.Serialize(indexShapes));
    }

    private static string? Identifier(SqliteDataReader reader, int index) =>
        reader.IsDBNull(index) ? null : reader.GetString(index).ToUpperInvariant();

    private static SqliteCommand Command(SqliteConnection db, SqliteTransaction transaction, string sql, string? name = null)
    {
        var command = db.CreateCommand(); command.Transaction = transaction; command.CommandText = sql;
        if (name != null) command.Parameters.AddWithValue("$name", name);
        return command;
    }

    private static string Rows(SqliteConnection db, SqliteTransaction transaction, string sql, string name,
        Func<SqliteDataReader, object?[]> project)
    {
        using var command = Command(db, transaction, sql, name);
        using var reader = command.ExecuteReader();
        var rows = new List<object?[]>();
        while (reader.Read()) rows.Add(project(reader));
        return JsonSerializer.Serialize(rows);
    }

    // Only cosmetic whitespace/comments and unquoted SQL case are normalized. No SQL is executed or changed.
    // Quoted identifiers/literals retain their exact tokens; other semantic rewrites require explicit review.
    // SQLite -- comments end at LF (0x0a), not CR: https://www.sqlite.org/lang_comment.html
    private static bool AsciiWord(char c) => c is >= 'a' and <= 'z' or >= 'A' and <= 'Z' or >= '0' and <= '9' or '_';

    private static string NormalizeSql(string sql)
    {
        var tokens = new List<string>();
        for (var i = 0; i < sql.Length;)
        {
            var c = sql[i];
            if (c is ' ' or '\t' or '\n' or '\r' or '\f') { i++; continue; }
            if (c == '-' && i + 1 < sql.Length && sql[i + 1] == '-')
            { i += 2; while (i < sql.Length && sql[i] != '\n') i++; continue; }
            if (c == '/' && i + 1 < sql.Length && sql[i + 1] == '*')
            {
                var end = sql.IndexOf("*/", i + 2, StringComparison.Ordinal);
                if (end < 0) throw new InvalidDataException("Unterminated schema comment.");
                i = end + 2; continue;
            }
            var start = i;
            if (c is '\'' or '"' or '`' or '[')
            {
                var close = c == '[' ? ']' : c; i++; var closed = false;
                while (i < sql.Length)
                {
                    if (sql[i++] != close) continue;
                    if (c != '[' && i < sql.Length && sql[i] == close) { i++; continue; }
                    closed = true; break;
                }
                if (!closed) throw new InvalidDataException("Unterminated schema quote.");
                tokens.Add(sql[start..i]);
            }
            else if (AsciiWord(c))
            {
                while (++i < sql.Length && AsciiWord(sql[i])) { }
                tokens.Add(sql[start..i].ToUpperInvariant());
            }
            else
            {
                if (c > 127) throw new InvalidDataException("Unaudited non-ASCII SQL token in schema definition.");
                i++;
                if (i < sql.Length && (c is '<' or '>' or '!' or '=' || c == '|') && (sql[i] == '=' || sql[i] == c)) i++;
                tokens.Add(sql[start..i]);
            }
        }
        while (tokens.Count != 0 && tokens[^1] == ";") tokens.RemoveAt(tokens.Count - 1);
        return string.Join("\u001f", tokens);
    }
}
