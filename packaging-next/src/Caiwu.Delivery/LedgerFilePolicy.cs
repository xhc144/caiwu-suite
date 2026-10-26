using Microsoft.Data.Sqlite;

namespace Caiwu.Delivery;

/// <summary>Read-only schema-v1 gate, before the store's transactional write-capability probe.</summary>
public static class LedgerFilePolicy
{
    internal static readonly string[] RequiredTables = ["ledger", "accounts", "vouchers", "voucher_lines", "audit_events"];
    private static readonly HashSet<string> Tables = new(RequiredTables, StringComparer.Ordinal);

    public static void Validate(string path)
    {
        path = SafePaths.Full(path);
        if (!File.Exists(path)) throw new FileNotFoundException("Ledger/backup does not exist.", path);
        foreach (var suffix in new[] { "-wal", "-shm", "-journal" }) SafePaths.RejectLinks(path + suffix);
        using var db = new SqliteConnection(new SqliteConnectionStringBuilder
        { DataSource = path, Mode = SqliteOpenMode.ReadOnly, Pooling = false, DefaultTimeout = 10 }.ToString());
        db.Open();
        using (var settings = db.CreateCommand()) { settings.CommandText = "PRAGMA trusted_schema=OFF"; settings.ExecuteNonQuery(); }
        using var transaction = db.BeginTransaction(deferred: true);
        using (var version = db.CreateCommand())
        {
            version.Transaction = transaction;
            version.CommandText = "PRAGMA user_version";
            if ((long)version.ExecuteScalar()! != 1) throw new InvalidDataException("Only the audited schema-v1 ledger layout is supported.");
            version.CommandText = "PRAGMA application_id";
            if ((long)version.ExecuteScalar()! != 1128355669) throw new InvalidDataException("File is not a Caiwu ledger.");
        }
        var actualTables = new HashSet<string>(StringComparer.Ordinal);
        var moduleTriggers = new HashSet<string>(StringComparer.Ordinal);
        using var command = db.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT type,name,tbl_name,sql FROM sqlite_schema";
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            var type = reader.GetString(0); var name = reader.GetString(1); var table = reader.GetString(2);
            if (type == "table" && Tables.Contains(name))
            {
                actualTables.Add(name); // Full SQL tokens and engine flags are checked below, not a text prefix.
            }
            else if (type == "index" && Tables.Contains(table) &&
                (name == "ix_voucher_lines_account" && table == "voucher_lines" ||
                 name.StartsWith("sqlite_autoindex_", StringComparison.Ordinal) && reader.IsDBNull(3))) { }
            else if (type == "table" && name is "sqlite_stat1" or "sqlite_stat4") { }
            else if (type == "trigger" && SchemaV1Layout.IsCanonicalModuleTrigger(name, table,
                reader.IsDBNull(3) ? null : reader.GetString(3))) moduleTriggers.Add(name);
            else throw new InvalidDataException("Unsupported schema object in ledger/backup; only exact installed module guards are allowed, and views/extra application tables remain rejected.");
        }
        if (!actualTables.SetEquals(Tables)) throw new InvalidDataException("Required ledger schema tables are missing.");
        reader.Dispose();
        SchemaV1Layout.Validate(db, transaction);
        using (var hasModuleEvents = db.CreateCommand())
        {
            hasModuleEvents.Transaction = transaction;
            hasModuleEvents.CommandText = "SELECT EXISTS(SELECT 1 FROM audit_events WHERE action GLOB 'ParityModuleCommit.*')";
            if ((long)hasModuleEvents.ExecuteScalar()! != 0 || moduleTriggers.Count != 0)
                if (!moduleTriggers.SetEquals(SchemaV1Layout.ModuleTriggerNames))
                    throw new InvalidDataException("Authoritative module events require both exact installed retention guards; this input is not silently repaired.");
        }
        transaction.Commit();
    }
}
