using System.Globalization;
using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Delivery;
using Caiwu.Persistence.Sqlite;
using Microsoft.Data.Sqlite;

/// <summary>
/// Column order, types, PKs and FKs stay unchanged. The adversarial change is an extra
/// UNIQUE(summary) ON CONFLICT REPLACE constraint, not a claimed read-then-write column swap.
/// Select only this new probe with CAIWU_DELIVERY_TEST_SCOPE=schema-constraints.
/// </summary>
internal static class SchemaConstraintCases
{
    private const string StableBackup = ".delivery-backups/schema-known-good.caiwu";
    private const string VariantBackup = ".delivery-backups/schema-constraint-variant.caiwu";
    private const string RestoredBook = "schema-constraint-restored.caiwu";

    private const string CanonicalVoucherLinesDdl = """
        CREATE TABLE voucher_lines (
            voucher_id TEXT NOT NULL REFERENCES vouchers(id) DEFERRABLE INITIALLY DEFERRED,
            ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
            account_code TEXT NOT NULL REFERENCES accounts(code) DEFERRABLE INITIALLY DEFERRED,
            summary TEXT NOT NULL,
            debit_cents INTEGER NOT NULL,
            credit_cents INTEGER NOT NULL,
            PRIMARY KEY (voucher_id, ordinal)
        ) STRICT;
        """;

    private const string ReplacementConstraintDdl = """
        CREATE TABLE voucher_lines (
            voucher_id TEXT NOT NULL REFERENCES vouchers(id) DEFERRABLE INITIALLY DEFERRED,
            ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
            account_code TEXT NOT NULL REFERENCES accounts(code) DEFERRABLE INITIALLY DEFERRED,
            summary TEXT NOT NULL,
            debit_cents INTEGER NOT NULL,
            credit_cents INTEGER NOT NULL,
            PRIMARY KEY (voucher_id, ordinal),
            UNIQUE(summary) ON CONFLICT REPLACE
        ) STRICT;
        """;
    private const string WhitespaceOnlyDdl = """
        CREATE TABLE voucher_lines (
            /* Only whitespace and comments differ from the ordinary schema-v1 table. */
            voucher_id TEXT NOT NULL
                REFERENCES vouchers(id) DEFERRABLE INITIALLY DEFERRED,

            ordinal INTEGER NOT NULL CHECK ( ordinal >= 0 ), -- original check, unchanged
            account_code TEXT NOT NULL REFERENCES accounts(code)
                DEFERRABLE INITIALLY DEFERRED,
            summary TEXT NOT NULL,
            debit_cents INTEGER NOT NULL,
            credit_cents INTEGER NOT NULL,
            PRIMARY KEY ( voucher_id , ordinal )
        )
        STRICT;
        """;

    public static IEnumerable<(string Name, Action<Fixture> Action)> All
    {
        get
        {
            yield return ("schema constraint control: Storage readback rolls back extra UNIQUE REPLACE without durable loss", f =>
            {
                var files = CreateVariant(f, replacementConstraint: true);
                var gateError = Capture(() => LedgerFilePolicy.Validate(files.VariantPath));
                var target = Path.Combine(f.Root, "storage-only-constraint-control.caiwu");
                // Deliberately bypass Delivery to prove the database's effect independently of the gate.
                SqliteLedgerStore.RestoreBackup(files.VariantPath, target);
                string before;
                using (var store = SqliteLedgerStore.Open(target)) before = JsonSerializer.Serialize(store.Read());
                var writeError = Capture(() => WriteBalancedAndRead(target));
                string after;
                using (var store = SqliteLedgerStore.Open(target)) { after = JsonSerializer.Serialize(store.Read()); store.CheckIntegrity(); }
                var facts = new
                {
                    files.SchemaFacts, gateAccepted = gateError == null, gateError = gateError?.GetType().Name,
                    storageRejected = writeError is InvalidDataException, durableSnapshotUnchanged = before == after,
                    sourceUnchanged = Fixture.Hash(files.SourcePath) == files.SourceHash,
                    validBackupUnchanged = Fixture.Hash(files.StablePath) == files.StableHash,
                    adversarialBackupUnchanged = Fixture.Hash(files.VariantPath) == files.VariantHash
                };
                Console.WriteLine("SCHEMA-CONSTRAINT-CONTROL " + JsonSerializer.Serialize(facts));
                Check.True(facts.storageRejected && facts.durableSnapshotUnchanged,
                    "The integrated transactional readback must reject lossy writes and preserve every durable field.");
                Check.True(facts.sourceUnchanged && facts.validBackupUnchanged && facts.adversarialBackupUnchanged,
                    "The independent control changed an original input instead of its disposable copy.");
            });
            yield return ("schema constraint safety: read-only layout gate rejects a same-column UNIQUE REPLACE backup", f =>
            {
                var files = CreateVariant(f, replacementConstraint: true);
                var error = Capture(() => LedgerFilePolicy.Validate(files.VariantPath));
                var facts = new
                {
                    files.SchemaFacts, gateAccepted = error == null, error = error?.GetType().Name,
                    sourceUnchanged = Fixture.Hash(files.SourcePath) == files.SourceHash,
                    validBackupUnchanged = Fixture.Hash(files.StablePath) == files.StableHash,
                    adversarialBackupUnchanged = Fixture.Hash(files.VariantPath) == files.VariantHash,
                    restoredTargetExists = File.Exists(Path.Combine(f.Data, RestoredBook))
                };
                var evidence = JsonSerializer.Serialize(facts); Console.WriteLine("SCHEMA-CONSTRAINT-GATE " + evidence);
                Check.True(error is InvalidDataException && facts.sourceUnchanged && facts.validBackupUnchanged &&
                    facts.adversarialBackupUnchanged && !facts.restoredTargetExists,
                    "The gate accepted changed conflict semantics despite unchanged columns/keys. Observed: " + evidence);
            });
            yield return ("schema constraint safety: Delivery restore must reject UNIQUE REPLACE before creating a live copy", f =>
            {
                var files = CreateVariant(f, replacementConstraint: true);
                var target = Path.Combine(f.Data, RestoredBook);
                BookCopyResult? copy = null;
                var error = Capture(() => copy = BookOperations.Restore(f.Install, VariantBackup, RestoredBook));
                WriteOutcome? outcome = null; Exception? writeError = null;
                if (error == null && File.Exists(target))
                    writeError = Capture(() => outcome = WriteBalancedAndRead(target));
                var facts = new
                {
                    files.SchemaFacts, restoreAccepted = error == null, restoreError = error?.GetType().Name,
                    targetExists = File.Exists(target), copyResultReturned = copy != null,
                    laterOrdinaryWrite = outcome, laterWriteError = writeError?.GetType().Name,
                    sourceUnchanged = Fixture.Hash(files.SourcePath) == files.SourceHash,
                    validBackupUnchanged = Fixture.Hash(files.StablePath) == files.StableHash,
                    adversarialBackupUnchanged = Fixture.Hash(files.VariantPath) == files.VariantHash
                };
                var evidence = JsonSerializer.Serialize(facts); Console.WriteLine("SCHEMA-CONSTRAINT-RESTORE " + evidence);
                Check.True(error is InvalidDataException && copy == null && !facts.targetExists && facts.sourceUnchanged &&
                    facts.validBackupUnchanged && facts.adversarialBackupUnchanged,
                    "Delivery exposed a changed-constraint database as a live book. Observed: " + evidence);
            });
            yield return ("schema compatibility control: canonical whitespace and comments remain accepted and preserve two lines", f =>
            {
                var files = CreateVariant(f, replacementConstraint: false);
                Check.True(files.SchemaFacts.StoredDdlDiffers, "Compatibility fixture did not change stored SQL text.");
                LedgerFilePolicy.Validate(files.VariantPath);
                var restored = BookOperations.Restore(f.Install, VariantBackup, RestoredBook);
                var outcome = WriteBalancedAndRead(restored.Copy.DatabasePath);
                var facts = new { files.SchemaFacts, outcome };
                Console.WriteLine("SCHEMA-COMPATIBILITY-CONTROL " + JsonSerializer.Serialize(facts));
                Check.Equal(2, outcome.PersistedLineCount); Check.Equal(2L, outcome.RawLineRowCount);
                Check.Equal(10.25m, outcome.PersistedDebit); Check.Equal(10.25m, outcome.PersistedCredit);
                Check.Equal("ok", outcome.IntegrityCheck);
                Check.Equal(files.SourceHash, Fixture.Hash(files.SourcePath));
                Check.Equal(files.StableHash, Fixture.Hash(files.StablePath));
                Check.Equal(files.VariantHash, Fixture.Hash(files.VariantPath));
            });
            foreach (var mutation in LayoutMutations())
                yield return ($"schema layout pin rejects metadata-only change: {mutation.Name}", f =>
                {
                    var files = CreateVariant(f, replacementConstraint: false, mutation.TableDdl, mutation.IndexSql,
                        requireIdenticalColumnMetadata: mutation.ColumnsMustRemainIdentical);
                    Check.Equal(mutation.ColumnsMustRemainIdentical, files.SchemaFacts.ColumnsTypesAndPrimaryKeyUnchanged);
                    var gateError = Capture(() => LedgerFilePolicy.Validate(files.VariantPath));
                    BookCopyResult? copy = null;
                    var restoreError = Capture(() => copy = BookOperations.Restore(f.Install, VariantBackup, RestoredBook));
                    var facts = new
                    {
                        axis = mutation.Name, metadataCompatibilityCaseOnly = true, financialLossDemonstrated = false,
                        files.SchemaFacts, gateError = gateError?.GetType().Name, restoreError = restoreError?.GetType().Name,
                        targetExists = File.Exists(Path.Combine(f.Data, RestoredBook)), copyResultReturned = copy != null,
                        declaredDebitType = ScalarText(files.VariantPath, "SELECT type FROM pragma_table_xinfo('voucher_lines') WHERE name='debit_cents'"),
                        strictFlag = ScalarLong(files.VariantPath, "SELECT strict FROM pragma_table_list WHERE schema='main' AND name='voucher_lines'"),
                        namedIndexSql = ScalarText(files.VariantPath, "SELECT sql FROM sqlite_schema WHERE type='index' AND name='ix_voucher_lines_account'"),
                        sourceUnchanged = Fixture.Hash(files.SourcePath) == files.SourceHash,
                        validBackupUnchanged = Fixture.Hash(files.StablePath) == files.StableHash,
                        variantUnchanged = Fixture.Hash(files.VariantPath) == files.VariantHash,
                        integrityCheck = ScalarText(files.VariantPath, "PRAGMA integrity_check")
                    };
                    var evidence = JsonSerializer.Serialize(facts); Console.WriteLine("SCHEMA-LAYOUT-METADATA " + evidence);
                    Check.True(gateError is InvalidDataException && restoreError is InvalidDataException && !facts.targetExists &&
                        copy == null && facts.sourceUnchanged && facts.validBackupUnchanged && facts.variantUnchanged && facts.integrityCheck == "ok",
                        "A noncanonical layout was accepted or an input/target changed. This case makes no financial-loss claim. Observed: " + evidence);
                });
            yield return ("schema comment boundary: a CR inside a SQLite line comment cannot resurrect an omitted CHECK", f =>
            {
                var ddl = CanonicalVoucherLinesDdl.Replace("ordinal INTEGER NOT NULL CHECK (ordinal >= 0)",
                    "ordinal INTEGER NOT NULL --\rCHECK (ordinal >= 0)\n", StringComparison.Ordinal);
                var files = CreateVariant(f, replacementConstraint: false, tableDefinition: ddl);
                var canonicalControl = ProbeNegativeOrdinal(files.StablePath, Path.Combine(f.Root, "canonical-check-control.caiwu"));
                var alteredControl = ProbeNegativeOrdinal(files.VariantPath, Path.Combine(f.Root, "cr-comment-check-control.caiwu"));
                Check.True(!canonicalControl.AcceptedNegativeOrdinal && canonicalControl.SqliteErrorCode == 19 && canonicalControl.SqliteExtendedErrorCode == 275,
                    "The trusted canonical control did not exercise the ordinal CHECK constraint.");
                Check.True(alteredControl.AcceptedNegativeOrdinal && alteredControl.NegativeRows == 1 && alteredControl.IntegrityCheck == "ok",
                    "The changed constraint was not independently demonstrated with the bundled SQLite runtime.");
                var gateError = Capture(() => LedgerFilePolicy.Validate(files.VariantPath));
                BookCopyResult? copy = null;
                var restoreError = Capture(() => copy = BookOperations.Restore(f.Install, VariantBackup, RestoredBook));
                var facts = new
                {
                    metadataCompatibilityCaseOnly = true, financialLossDemonstrated = false,
                    files.SchemaFacts, canonicalControl, alteredControl,
                    gateAccepted = gateError == null, gateError = gateError?.GetType().Name,
                    restoreAccepted = restoreError == null, restoreError = restoreError?.GetType().Name,
                    targetExists = File.Exists(Path.Combine(f.Data, RestoredBook)), copyResultReturned = copy != null,
                    sourceUnchanged = Fixture.Hash(files.SourcePath) == files.SourceHash,
                    validBackupUnchanged = Fixture.Hash(files.StablePath) == files.StableHash,
                    variantUnchanged = Fixture.Hash(files.VariantPath) == files.VariantHash
                };
                var evidence = JsonSerializer.Serialize(facts); Console.WriteLine("SCHEMA-COMMENT-BOUNDARY " + evidence);
                Check.True(gateError is InvalidDataException && restoreError is InvalidDataException && !facts.targetExists && copy == null &&
                    facts.sourceUnchanged && facts.validBackupUnchanged && facts.variantUnchanged,
                    "SQLite ignores the CHECK text until LF; normalization must not resurrect that text at CR. Observed: " + evidence);
            });
        }
    }

    private static ProbeFiles CreateVariant(Fixture fixture, bool replacementConstraint, string? tableDefinition = null,
        string? indexDefinition = null, bool requireIdenticalColumnMetadata = true)
    {
        var source = fixture.Book(); // Intentionally has no voucher_lines to discard while rebuilding.
        Check.Equal(0L, ScalarLong(source, "SELECT count(*) FROM voucher_lines"));
        Installation.Install(fixture.Payload("0.1.0.1"), fixture.Install, fixture.Data);
        var stable = BookOperations.Backup(fixture.Install, "synthetic.caiwu", StableBackup).Copy.DatabasePath;
        var variant = Path.Combine(fixture.Data, ".delivery-backups", "schema-constraint-variant.caiwu");
        File.Copy(stable, variant, overwrite: false);
        var originalColumns = Rows(stable, "PRAGMA table_xinfo(voucher_lines)");
        var originalForeignKeys = Rows(stable, "PRAGMA foreign_key_list(voucher_lines)");
        var originalSql = ScalarText(stable, "SELECT sql FROM sqlite_schema WHERE type='table' AND name='voucher_lines'");
        var originalAutoindexes = ScalarLong(stable, "SELECT count(*) FROM sqlite_schema WHERE type='index' AND name LIKE 'sqlite_autoindex_%'");
        using (var db = Open(variant, readOnly: false))
        using (var transaction = db.BeginTransaction())
        using (var command = db.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = "DROP TABLE voucher_lines;\n" + (tableDefinition ?? (replacementConstraint ? ReplacementConstraintDdl : WhitespaceOnlyDdl)) +
                "\n" + (indexDefinition ?? "CREATE INDEX ix_voucher_lines_account ON voucher_lines(account_code);");
            command.ExecuteNonQuery(); transaction.Commit();
        }
        var columnsUnchanged = originalColumns.SequenceEqual(Rows(variant, "PRAGMA table_xinfo(voucher_lines)"));
        var foreignKeysUnchanged = originalForeignKeys.SequenceEqual(Rows(variant, "PRAGMA foreign_key_list(voucher_lines)"));
        var tableNames = Rows(variant, "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name");
        var allAutoindexSqlNull = ScalarLong(variant, "SELECT count(*) FROM sqlite_schema WHERE type='index' AND name LIKE 'sqlite_autoindex_%' AND sql IS NOT NULL") == 0;
        var autoindexesAdded = ScalarLong(variant, "SELECT count(*) FROM sqlite_schema WHERE type='index' AND name LIKE 'sqlite_autoindex_%'") - originalAutoindexes;
        var storedDdlDiffers = originalSql != ScalarText(variant, "SELECT sql FROM sqlite_schema WHERE type='table' AND name='voucher_lines'");
        var facts = new SchemaFacts(columnsUnchanged, foreignKeysUnchanged, allAutoindexSqlNull, autoindexesAdded,
            ScalarLong(variant, "PRAGMA user_version"), ScalarLong(variant, "PRAGMA application_id"), storedDdlDiffers);
        Check.True((columnsUnchanged || !requireIdenticalColumnMetadata) && foreignKeysUnchanged && allAutoindexSqlNull,
            "The fixture changed unexpected column/key metadata or used a malformed autoindex.");
        Check.Equal("accounts|audit_events|ledger|voucher_lines|vouchers", string.Join('|', tableNames));
        Check.Equal(replacementConstraint ? 1L : 0L, autoindexesAdded);
        Check.Equal(1L, facts.UserVersion); Check.Equal(1128355669L, facts.ApplicationId);
        Check.Equal("ok", ScalarText(variant, "PRAGMA integrity_check"));
        Check.Equal(0, Rows(variant, "PRAGMA foreign_key_check").Length);
        return new(source, stable, variant, Fixture.Hash(source), Fixture.Hash(stable), Fixture.Hash(variant), facts);
    }

    private static IEnumerable<LayoutMutation> LayoutMutations()
    {
        const string canonicalIndex = "CREATE INDEX ix_voucher_lines_account ON voucher_lines(account_code);";
        // INT is a valid SQLite STRICT declared type. This is a deliberate layout difference,
        // not an assertion that changing INTEGER to INT demonstrates financial data loss.
        yield return new("declared type INTEGER to INT", CanonicalVoucherLinesDdl.Replace("debit_cents INTEGER NOT NULL", "debit_cents INT NOT NULL", StringComparison.Ordinal), canonicalIndex, false);
        yield return new("ordinal CHECK omitted", CanonicalVoucherLinesDdl.Replace(" CHECK (ordinal >= 0)", "", StringComparison.Ordinal), canonicalIndex, true);
        yield return new("STRICT table flag omitted", CanonicalVoucherLinesDdl.Replace(") STRICT;", ");", StringComparison.Ordinal), canonicalIndex, true);
        yield return new("same named index targets summary instead of account_code", CanonicalVoucherLinesDdl,
            "CREATE INDEX ix_voucher_lines_account ON voucher_lines(summary);", true);
    }

    private static WriteOutcome WriteBalancedAndRead(string path)
    {
        using var store = SqliteLedgerStore.Open(path); store.CheckIntegrity();
        var before = store.Read(); Check.Equal(0, before.Vouchers.Count);
        const string summary = "合成平衡凭证的相同摘要";
        var voucher = new Voucher(Guid.Parse("542c196b-5db0-4943-9b9a-9ad6c8004903"), new DateOnly(2026, 1, 15), "转", 1, 0,
            "测试制单", null, VoucherStatus.Draft,
            [new VoucherLine("1002", summary, 10.25m, 0m), new VoucherLine("4001", summary, 0m, 10.25m)]);
        Check.Equal(2, voucher.Lines.Count); Check.Equal(10.25m, voucher.Lines.Sum(x => x.Debit)); Check.Equal(10.25m, voucher.Lines.Sum(x => x.Credit));
        store.Write(before with { Revision = before.Revision + 1, Vouchers = [voucher] }, before.Revision);
        var after = store.Read(); store.CheckIntegrity(); var actual = after.Vouchers.Single();
        return new(2, 10.25m, 10.25m, after.Revision, actual.Lines.Count, ScalarLong(path, "SELECT count(*) FROM voucher_lines"),
            actual.Lines.Sum(x => x.Debit), actual.Lines.Sum(x => x.Credit), ScalarText(path, "PRAGMA integrity_check"));
    }

    private static NegativeOrdinalOutcome ProbeNegativeOrdinal(string source, string disposableCopy)
    {
        File.Copy(source, disposableCopy, overwrite: false);
        var normal = WriteBalancedAndRead(disposableCopy); Check.Equal(2, normal.PersistedLineCount);
        var accepted = false; int? errorCode = null; int? extended = null;
        using (var db = Open(disposableCopy, readOnly: false))
        using (var command = db.CreateCommand())
        {
            command.CommandText = "UPDATE voucher_lines SET ordinal=-1 WHERE ordinal=0";
            try { Check.Equal(1, command.ExecuteNonQuery()); accepted = true; }
            catch (SqliteException error) { errorCode = error.SqliteErrorCode; extended = error.SqliteExtendedErrorCode; }
        }
        return new(accepted, errorCode, extended, ScalarLong(disposableCopy, "SELECT count(*) FROM voucher_lines WHERE ordinal=-1"),
            ScalarText(disposableCopy, "PRAGMA integrity_check"));
    }

    private static SqliteConnection Open(string path, bool readOnly)
    {
        var db = new SqliteConnection(new SqliteConnectionStringBuilder
        { DataSource = path, Mode = readOnly ? SqliteOpenMode.ReadOnly : SqliteOpenMode.ReadWrite, Pooling = false, ForeignKeys = true }.ToString());
        db.Open(); return db;
    }
    private static string[] Rows(string path, string sql)
    {
        using var db = Open(path, readOnly: true); using var command = db.CreateCommand(); command.CommandText = sql;
        using var reader = command.ExecuteReader(); var rows = new List<string>();
        while (reader.Read()) rows.Add(string.Join('|', Enumerable.Range(0, reader.FieldCount)
            .Select(i => reader.IsDBNull(i) ? "<NULL>" : Convert.ToString(reader.GetValue(i), CultureInfo.InvariantCulture))));
        return rows.ToArray();
    }
    private static long ScalarLong(string path, string sql)
    {
        using var db = Open(path, readOnly: true); using var command = db.CreateCommand(); command.CommandText = sql; return (long)command.ExecuteScalar()!;
    }
    private static string ScalarText(string path, string sql)
    {
        using var db = Open(path, readOnly: true); using var command = db.CreateCommand(); command.CommandText = sql; return (string)command.ExecuteScalar()!;
    }
    private static Exception? Capture(Action action)
    { try { action(); return null; } catch (Exception error) { return error; } }
    private sealed record SchemaFacts(bool ColumnsTypesAndPrimaryKeyUnchanged, bool ForeignKeysUnchanged,
        bool AllAutoindexSqlNull, long AutoindexesAdded, long UserVersion, long ApplicationId, bool StoredDdlDiffers);
    private sealed record ProbeFiles(string SourcePath, string StablePath, string VariantPath, string SourceHash,
        string StableHash, string VariantHash, SchemaFacts SchemaFacts);
    private sealed record WriteOutcome(int IntendedLineCount, decimal IntendedDebit, decimal IntendedCredit, long StoredRevision,
        int PersistedLineCount, long RawLineRowCount, decimal PersistedDebit, decimal PersistedCredit, string IntegrityCheck);
    private sealed record LayoutMutation(string Name, string TableDdl, string IndexSql, bool ColumnsMustRemainIdentical);
    private sealed record NegativeOrdinalOutcome(bool AcceptedNegativeOrdinal, int? SqliteErrorCode,
        int? SqliteExtendedErrorCode, long NegativeRows, string IntegrityCheck);
}
