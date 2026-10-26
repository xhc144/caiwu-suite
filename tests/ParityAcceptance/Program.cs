using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Persistence.Sqlite;
using Caiwu.Delivery;
using Microsoft.Data.Sqlite;

// All data is created here. No original database, installer, engine or user ledger is read.
var output = Path.GetFullPath(args.Length == 1 ? args[0] : "artifacts/parity-acceptance/results.json");
Directory.CreateDirectory(Path.GetDirectoryName(output)!);
var root = Path.Combine(Path.GetTempPath(), "caiwu-parity-synthetic-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var cases = new List<object>();
var failed = false;
try
{
    Case("module-documents-and-proposal-persist-in-real-sqlite", Persist);
    Case("sqlite-abort-rolls-back-module-voucher-source-and-revision", Rollback);
    Case("independent-writers-cannot-overwrite-stale-module-decision", Stale);
    Case("backup-restore-retains-unknown-json-and-source-consumption", Backup);
    Case("two-writers-one-source-have-exactly-one-atomic-winner", Competing);
    Case("foreign-book-confirmation-cannot-write-either-book", Foreign);
    Case("managed-policy-accepts-only-canonical-module-retention-guards", ManagedPolicy);
}
finally
{
    SqliteConnection.ClearAllPools();
    try { Directory.Delete(root, true); }
    catch (Exception e) { failed = true; cases.Add(new { name = "synthetic-cleanup", status = "failed", error = e.GetType().Name }); }
    File.WriteAllText(output, JsonSerializer.Serialize(new
    {
        schemaVersion = 1, sourceCommit = Environment.GetEnvironmentVariable("CAIWU_PARITY_COMMIT"),
        sourceTree = Environment.GetEnvironmentVariable("CAIWU_PARITY_TREE"),
        sourceBinding = Environment.GetEnvironmentVariable("CAIWU_PARITY_SOURCE_CLEAN") == "true"
            ? "exact-clean-checkout" : "working-tree-diagnostic",
        generatedAtUtc = DateTimeOffset.UtcNow, platform = RuntimeInformation.OSDescription,
        runtime = RuntimeInformation.FrameworkDescription, syntheticOnly = true,
        originalProgramExecuted = false, realBookCompatibility = "not-tested", originalUiParity = "not-tested",
        scope = "Actual SQLite integration for module journal and new draft proposals only; no complete-product acceptance implied.",
        status = failed ? "failed" : "passed", cases
    }, new JsonSerializerOptions { WriteIndented = true }));
}
return failed ? 1 : 0;

void Case(string name, Action action)
{
    try { action(); cases.Add(new { name, status = "passed" }); Console.WriteLine("PASS " + name); }
    catch (Exception e) { failed = true; cases.Add(new { name, status = "failed", error = e.ToString() }); Console.Error.WriteLine("FAIL " + name + ": " + e); }
}

SqliteLedgerStore Create(string name)
{
    return SqliteLedgerStore.Create(Path.Combine(root, name + ".caiwu"),
        new(Guid.NewGuid(), "合成账套 " + name, AccountingRegime.Enterprise, "synthetic-only", 2026, 1, 0, DateTimeOffset.UtcNow),
        [new("1001", "现金", null, BalanceDirection.Debit, true, 0, 0),
         new("4001", "资本", null, BalanceDirection.Credit, true, 0, 0)]);
}

LedgerMutationContext Context(LedgerService service)
{
    var snapshot = service.GetSnapshot();
    return new(snapshot.Book.Id, snapshot.Revision);
}

VoucherProposal Proposal(LedgerMutationContext context, string source = "receipt:1") =>
    new(Guid.NewGuid(), "cashier", [source], context, new(2026, 10, 25), "记", null, 0,
        [new("1001", "合成收款", 123.45m, 0), new("4001", "合成收款", 0, 123.45m)],
        [new(source, new(source, 1, "{\"generated\":true,\"unmapped\":\"原列保留\"}"))]);

void Persist()
{
    string path; ModuleVoucherReceipt receipt;
    const string opaque = "{ \"currency\":\"USD\", \"amount\":12.34567890123456789, \"quantity\":0.000001, \"unknown\":{\"列\":123456789012345678901234567890} }";
    using (var store = Create("persist"))
    {
        path = store.DatabasePath;
        var service = new LedgerService(store);
        service.SaveModuleDocuments(new("ledger", Context(service), [new("line:1", new("line:1", 7, opaque))]), "合成甲");
        receipt = service.AcceptVoucherProposal(Proposal(Context(service)), "合成甲");
    }
    using (var reopened = SqliteLedgerStore.Open(path))
    {
        var service = new LedgerService(reopened);
        var state = service.GetModuleSnapshot();
        Check(state.Ledger.Revision == 2 && state.Ledger.Vouchers.Single().Status == VoucherStatus.Draft, "revision/draft mismatch");
        Check(state.ProposalReceipts.Single().VoucherId == receipt.VoucherId, "receipt mismatch");
        Check(state.Modules.Single(m => m.ModuleId == "ledger").Documents.Single().PayloadJson == opaque, "opaque JSON changed");
        Expect<LedgerValidationException>(() => service.AcceptVoucherProposal(Proposal(Context(service)), "合成甲"));
        service.DeleteDraft(receipt.VoucherId, "合成甲", Context(service));
        Expect<LedgerValidationException>(() => service.AcceptVoucherProposal(Proposal(Context(service)), "合成甲"));
    }
    Check(Query(path, "SELECT revision FROM ledger") == 3, "duplicate changed revision");
    Check(Query(path, "SELECT count(*) FROM vouchers") == 0, "deleted draft returned");
    Check(Query(path, "SELECT count(*) FROM audit_events WHERE action='ParityModuleCommit.v1'") == 2, "journal rows mismatch");
}

void Rollback()
{
    using var store = Create("rollback");
    var service = new LedgerService(store);
    Execute(store.DatabasePath, "CREATE TRIGGER synthetic_abort BEFORE INSERT ON audit_events WHEN NEW.action='ParityModuleCommit.v1' BEGIN SELECT RAISE(ABORT,'synthetic abort'); END;");
    Expect<SqliteException>(() => service.AcceptVoucherProposal(Proposal(Context(service)), "合成甲"));
    var state = service.GetModuleSnapshot();
    Check(state.Ledger.Revision == 0 && state.Ledger.Vouchers.Count == 0 && state.Modules.Count == 0 && state.ProposalReceipts.Count == 0, "partial state survived abort");
    Check(Query(store.DatabasePath, "SELECT count(*) FROM audit_events") == 0, "partial audit survived abort");
    Execute(store.DatabasePath, "DROP TRIGGER synthetic_abort");
    service.AcceptVoucherProposal(Proposal(Context(service)), "合成甲");
    Check(service.GetModuleSnapshot().ProposalReceipts.Count == 1, "failed transaction consumed source");
}

void Stale()
{
    using var first = Create("stale");
    using var second = SqliteLedgerStore.Open(first.DatabasePath);
    var a = new LedgerService(first); var b = new LedgerService(second);
    var proposal = Proposal(Context(b));
    a.SaveModuleDocuments(new("payroll", Context(a), [new("staff:1", new("staff:1", 1, "{\"unknown\":true}"))]), "合成乙");
    Expect<StoreConcurrencyException>(() => b.AcceptVoucherProposal(proposal, "合成甲"));
    Check(b.GetModuleSnapshot().Modules.Single().ModuleId == "payroll", "other writer lost");
    Check(b.GetSnapshot().Revision == 1 && b.GetSnapshot().Vouchers.Count == 0, "stale decision wrote");
}

void Backup()
{
    string sourcePath; ModuleVoucherReceipt receipt;
    var backupPath = Path.Combine(root, "module.backup"); var restoredPath = Path.Combine(root, "restored.caiwu");
    using (var store = Create("backup-source"))
    {
        sourcePath = store.DatabasePath;
        var service = new LedgerService(store);
        receipt = service.AcceptVoucherProposal(Proposal(Context(service)), "合成甲");
        store.BackupTo(backupPath);
    }
    var sourceHash = Hash(sourcePath); var backupHash = Hash(backupPath);
    SqliteLedgerStore.RestoreBackup(backupPath, restoredPath);
    using (var restored = SqliteLedgerStore.Open(restoredPath))
    {
        var service = new LedgerService(restored);
        var state = service.GetModuleSnapshot();
        Check(state.ProposalReceipts.Single().VoucherId == receipt.VoucherId, "restored receipt missing");
        Check(state.Modules.Single().Documents.Single().PayloadJson.Contains("原列保留", StringComparison.Ordinal), "restored fields missing");
        Expect<LedgerValidationException>(() => service.AcceptVoucherProposal(Proposal(Context(service)), "合成甲"));
        Expect<IOException>(() => restored.BackupTo(backupPath));
    }
    Check(Hash(sourcePath) == sourceHash && Hash(backupPath) == backupHash, "restore modified source or backup");
}

void Competing()
{
    using var first = Create("competing");
    using var second = SqliteLedgerStore.Open(first.DatabasePath);
    var context = Context(new LedgerService(first));
    using var barrier = new Barrier(2);
    var a = new LedgerService(new ReadBarrierStore(first, barrier));
    var b = new LedgerService(new ReadBarrierStore(second, barrier));
    var p = Proposal(context);
    Exception? Submit(LedgerService service)
    {
        try { service.AcceptVoucherProposal(p, "合成甲"); return null; }
        catch (Exception e) { return e; }
    }
    var tasks = new[] { Task.Run(() => Submit(a)), Task.Run(() => Submit(b)) };
    Check(Task.WaitAll(tasks, TimeSpan.FromSeconds(25)), "writers timed out");
    var results = tasks.Select(t => t.Result).ToArray();
    Check(results.Count(e => e is null) == 1 && results.Count(e => e is StoreConcurrencyException) == 1, "expected one winner and one CAS conflict");
    var state = new LedgerService(first).GetModuleSnapshot();
    Check(state.Ledger.Revision == 1 && state.Ledger.Vouchers.Count == 1 && state.ProposalReceipts.Count == 1 && state.Modules.Single().Documents.Count == 1, "race produced partial/duplicate state");
}

void Foreign()
{
    using var first = Create("foreign-first"); using var second = Create("foreign-second");
    var a = new LedgerService(first); var b = new LedgerService(second);
    Expect<StoreConcurrencyException>(() => b.AcceptVoucherProposal(Proposal(Context(a)), "合成甲"));
    Check(a.GetSnapshot().Revision == 0 && b.GetSnapshot().Revision == 0, "foreign write changed a book");
}

void ManagedPolicy()
{
    using var store = Create("managed-policy"); var service = new LedgerService(store);
    LedgerFilePolicy.Validate(store.DatabasePath); // Existing schema1 with no module data is still accepted.
    service.AcceptVoucherProposal(Proposal(Context(service)), "合成甲");
    LedgerFilePolicy.Validate(store.DatabasePath);
    Execute(store.DatabasePath, "CREATE TRIGGER synthetic_unknown BEFORE INSERT ON vouchers BEGIN SELECT 1; END;");
    Expect<InvalidDataException>(() => LedgerFilePolicy.Validate(store.DatabasePath));
    Execute(store.DatabasePath, "DROP TRIGGER synthetic_unknown; DROP TRIGGER preserve_parity_module_delete;");
    Expect<InvalidDataException>(() => LedgerFilePolicy.Validate(store.DatabasePath));
    Execute(store.DatabasePath, "CREATE TRIGGER preserve_parity_module_delete BEFORE DELETE ON audit_events BEGIN SELECT 1; END;");
    Expect<InvalidDataException>(() => LedgerFilePolicy.Validate(store.DatabasePath));
    Check(service.GetSnapshot().Revision == 1 && service.GetSnapshot().Vouchers.Count == 1, "read-only policy mutated the synthetic book");
}

static void Check(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
static void Expect<T>(Action action) where T : Exception
{
    try { action(); } catch (T) { return; }
    throw new InvalidOperationException("Expected " + typeof(T).Name);
}
static string Hash(string path) => Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(path)));
static SqliteConnection Raw(string path)
{
    var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Mode = SqliteOpenMode.ReadWrite, Pooling = false }.ToString());
    connection.Open(); return connection;
}
static long Query(string path, string sql)
{
    using var db = Raw(path); using var command = db.CreateCommand(); command.CommandText = sql;
    return Convert.ToInt64(command.ExecuteScalar());
}
static void Execute(string path, string sql)
{
    using var db = Raw(path); using var command = db.CreateCommand(); command.CommandText = sql; command.ExecuteNonQuery();
}

sealed class ReadBarrierStore(ILedgerStore inner, Barrier barrier) : ILedgerStore
{
    public string DatabasePath => inner.DatabasePath;
    public LedgerSnapshot Read()
    {
        var snapshot = inner.Read();
        if (!barrier.SignalAndWait(TimeSpan.FromSeconds(15))) throw new TimeoutException("synthetic read barrier");
        return snapshot;
    }
    public void Write(LedgerSnapshot next, long expectedRevision) => inner.Write(next, expectedRevision);
    public void BackupTo(string path) => inner.BackupTo(path);
    public void CheckIntegrity() => inner.CheckIntegrity();
    public void Dispose() { } // The fixture owns and disposes each real store.
}
