using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Desktop.Presentation;
using Caiwu.Operators;
using Caiwu.Persistence.Sqlite;
using Caiwu.Cashier;
using Caiwu.Cashier.Integration;
using Microsoft.Data.Sqlite;

var results = new List<object>();
var failed = false;
Case("real-wrapper-chain-preserves-session-identity-lock-and-whole-book-context", () =>
{
    using var f = new Fixture();
    var original = f.Context();
    f.Facade.SaveModuleDocuments(new("cashier", original, [new("x", new("x", 7, "{ \"unknown\":123456789012345678901234567890 }"))]), "FORGED");
    Expect<StoreConcurrencyException>(() => f.Facade.SaveModuleDocuments(new("cashier", original, [new("y", new("y", 1, "{}"))]), "FORGED"));
    var receipt = f.Facade.AcceptVoucherProposal(f.Proposal(), "FORGED");
    var state = f.Facade.GetModuleSnapshot();
    Check(state.Ledger.Revision == 2 && state.Ledger.Vouchers.Single().PreparedBy == f.Session.Identity.ActorKey, "forged actor or wrong revision");
    Check(state.Ledger.AuditEvents.All(a => a.OperatorName == f.Session.Identity.ActorKey), "audit actor was not session-issued");
    Check(receipt.VoucherId == state.Ledger.Vouchers.Single().Id && f.ReadLockChecks > 0 && f.WriteLockChecks == 2, "operation escaped identity lock");
    Expect<OperatorAuthorizationException>(() => f.Facade.SaveModuleDocuments(new("unknown", f.Context(), [new("x", new("x", 1, "{}"))]), "FORGED"));
    Expect<StoreConcurrencyException>(() => f.Facade.AcceptVoucherProposal(f.Proposal() with { Context = new(Guid.NewGuid(), 2) }, "FORGED"));
    Check(f.Store.Read().Revision == 2, "denied/stale operation wrote");
});
Case("readers-and-single-role-users-cannot-evade-both-proposal-permissions", () =>
{
    foreach (var roles in new[] { OperatorRoles.Reader, OperatorRoles.Preparer, OperatorRoles.Accountant })
    {
        using var f = new Fixture(roles: roles);
        if (roles == OperatorRoles.Accountant)
            f.Facade.SaveModuleDocuments(new("cashier", f.Context(), [new("x", new("x", 1, "{}"))]), "FORGED");
        else
            Expect<OperatorAuthorizationException>(() => f.Facade.SaveModuleDocuments(new("cashier", f.Context(), [new("x", new("x", 1, "{}"))]), "FORGED"));
        var before = f.Store.Read().Revision;
        Expect<OperatorAuthorizationException>(() => f.Facade.AcceptVoucherProposal(f.Proposal(), "FORGED"));
        Check(f.Store.Read().Revision == before && f.Store.Read().Vouchers.Count == 0, "missing permission reached storage");
    }
});
Case("unconfigured-policy-and-unverified-regime-fail-before-mutation", () =>
{
    using (var f = new Fixture(configure: false))
    {
        Expect<OperatorAuthorizationException>(() => f.Facade.SaveModuleDocuments(new("cashier", f.Context(), [new("x", new("x", 1, "{}"))]), "FORGED"));
        Expect<OperatorAuthorizationException>(() => f.Facade.AcceptVoucherProposal(f.Proposal(), "FORGED"));
        Check(f.Store.Read().Revision == 0, "default policy granted module access");
    }
    using (var f = new Fixture(regime: AccountingRegime.Nonprofit))
    {
        Expect<LedgerValidationException>(() => f.Facade.SaveModuleDocuments(new("cashier", f.Context(), [new("x", new("x", 1, "{}"))]), "FORGED"));
        Expect<LedgerValidationException>(() => f.Facade.AcceptVoucherProposal(f.Proposal(), "FORGED"));
        Check(f.Store.Read().Revision == 0, "Preview gate was bypassed");
    }
});
Case("logout-password-change-and-new-login-cannot-revive-old-facade", () =>
{
    using var f = new Fixture();
    f.Operators.Logout(f.Session);
    Expect<OperatorAuthorizationException>(() => f.Facade.GetModuleSnapshot());
    var replacement = f.Operators.Login("user", Fixture.Password);
    Expect<OperatorAuthorizationException>(() => f.Facade.AcceptVoucherProposal(f.ProposalFromStore(), "user"));
    var other = f.Bind(replacement);
    f.Operators.ResetPassword(f.Admin, f.Operators.GetDirectory(f.Admin).Revision, replacement.Identity.Id, "Synthetic-Replacement-Password-9!");
    Expect<OperatorAuthorizationException>(() => other.GetModuleSnapshot());
    Check(f.Store.Read().Revision == 0, "revoked identity wrote data");
});
Case("actual-sqlite-abort-propagates-through-authorization-and-preview-with-no-partial-state", () =>
{
    using var f = new Fixture();
    using (var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = f.Store.DatabasePath, Pooling = false }.ToString()))
    {
        db.Open(); using var command = db.CreateCommand();
        command.CommandText = "CREATE TRIGGER synthetic_abort BEFORE INSERT ON audit_events WHEN NEW.action='ParityModuleCommit.v1' BEGIN SELECT RAISE(ABORT,'synthetic abort'); END;";
        command.ExecuteNonQuery();
    }
    Expect<SqliteException>(() => f.Facade.AcceptVoucherProposal(f.Proposal(), "FORGED"));
    var state = f.Facade.GetModuleSnapshot();
    Check(state.Ledger.Revision == 0 && state.Ledger.Vouchers.Count == 0 && state.Modules.Count == 0 && state.ProposalReceipts.Count == 0, "SQL failure leaked partial state");
    _ = f.Operators.RequirePermission(f.Session, OperatorPermission.ReadLedger);
});
Case("cashier-real-adapter-saves-plans-accepts-and-reopens-through-protected-core", () =>
{
    using var f = new Fixture();
    var ledger = f.Facade.GetModuleSnapshot().Ledger;
    var definition = new BookDefinition(ledger.Book.Id.ToString("D"), new(2026, 1, 1), new(2026, 1, 1), new(2026, 12, 31), "CNY",
        [new("1001", "合成现金", true, true, ["CNY"]), new("4001", "合成资本", true, false, ["CNY"])]);
    var store = new ParityCashierStore(f.Facade, definition, f.Session.Identity.ActorKey);
    var cashier = new CashierService(store);
    cashier.SaveOpening(0, new("1001", "CNY"), 2026, 123.123456789m, f.Session.Identity.ActorKey);
    var input = new DocumentInput(new("1001", "CNY"), new(2026, 1, 10), "真实适配合成收款", DocumentDirection.Receipt, 12.34m, "4001", f.Session.Identity.ActorKey);
    var document = cashier.AddDocument(1, input);
    var plan = cashier.CreateVoucherPlan(2026, 1, VoucherGrouping.PerDocument);
    var adapter = new CashierVoucherProposalAdapter(f.Facade, definition);
    var proposal = adapter.CreateProposal(f.Facade.GetModuleSnapshot(), plan, 0, Guid.NewGuid(), "记");
    var receipt = adapter.AcceptConfirmed(proposal, "FORGED");
    var generated = cashier.Read();
    Check(generated.Revision == 3 && generated.Documents.Single().GeneratedVoucherId == receipt.VoucherId.ToString("D"), "cashier source did not recover real voucher receipt");
    var journal = cashier.GetJournal(new("1001", "CNY"), new(2026, 1, 1), new(2026, 1, 31));
    Check(journal.Closing == 135.463456789m, "module opening precision or journal changed");
    Check(f.Store.Read().Vouchers.Single().PreparedBy == f.Session.Identity.ActorKey, "cashier forged actor bypassed wrappers");
    Expect<CashierRuleException>(() => cashier.DeleteDocument(generated.Revision, document.Id, f.Session.Identity.ActorKey));
    Expect<LedgerValidationException>(() => f.Facade.AcceptVoucherProposal(proposal with { Context = f.Context() }, "FORGED"));
    using var reopened = SqliteLedgerStore.Open(f.Store.DatabasePath);
    var protectedReopen = (IParityLedgerService)new AuthorizedLedgerService(new PreviewLedgerService(new LedgerService(reopened)), f.Operators, f.Session,
        new ParityModuleWritePolicy([new("cashier", OperatorPermission.EditAccounts)]));
    var restoredView = new CashierService(new ParityCashierStore(protectedReopen, definition, f.Session.Identity.ActorKey)).Read();
    Check(restoredView.Openings.Single().Balance == 123.123456789m && restoredView.Documents.Single().GeneratedVoucherId == receipt.VoucherId.ToString("D"), "reopened module state lost precision or receipt");
    ((ILedgerService)f.Facade).SaveAccount(new("2001", "合成应付", null, BalanceDirection.Credit, true, 0, 0), "FORGED", f.Context());
    Expect<CashierConcurrencyException>(() => cashier.AddDocument(generated.Revision, input));
    Check(f.Store.Read().Revision == 4 && cashier.Read().Documents.Length == 1, "stale cashier decision overwrote concurrent GL change");
});
var output = Path.GetFullPath(args.Length == 1 ? args[0] : "artifacts/parity-authorization.json");
Directory.CreateDirectory(Path.GetDirectoryName(output)!);
File.WriteAllText(output, JsonSerializer.Serialize(new
{
    sourceCommit = Environment.GetEnvironmentVariable("CAIWU_PARITY_COMMIT"), syntheticOnly = true,
    realCoreAndSqlite = true, actualProductionWrappers = true, sourceShellSha = "cde5f6863dc3aebc52adac0f8d7dbe087ec67113",
    sourceCashierSha = "5fe65fecc03a5ecc2764303a3c6f15469e7c59bd",
    originalMenuRights = "not-implemented", originalBookCompatibility = "not-tested", status = failed ? "failed" : "passed", results
}, new JsonSerializerOptions { WriteIndented = true }));
return failed ? 1 : 0;

void Case(string name, Action test)
{
    try { test(); results.Add(new { name, status = "passed" }); Console.WriteLine("PASS " + name); }
    catch (Exception e) { failed = true; results.Add(new { name, status = "failed", error = e.ToString() }); Console.Error.WriteLine(e); }
}
static void Check(bool condition, string text) { if (!condition) throw new InvalidOperationException(text); }
static void Expect<T>(Action test) where T : Exception
{ try { test(); } catch (T) { return; } throw new InvalidOperationException("Expected " + typeof(T).Name); }

sealed class Fixture : IDisposable
{
    public const string Password = "Synthetic-Operator-Password-9!";
    private readonly string directory = Path.Combine(Path.GetTempPath(), "caiwu-authenticated-parity-" + Guid.NewGuid().ToString("N"));
    private readonly string identityDirectory;
    private readonly ParityModuleWritePolicy? policy;
    private readonly LedgerService raw;
    public LocalOperatorService Operators { get; }
    public OperatorSession Admin { get; }
    public OperatorSession Session { get; }
    public SqliteLedgerStore Store { get; }
    public IParityLedgerService Facade { get; }
    public int ReadLockChecks { get; private set; }
    public int WriteLockChecks { get; private set; }
    public Fixture(OperatorRoles roles = OperatorRoles.Preparer | OperatorRoles.Accountant, AccountingRegime regime = AccountingRegime.Enterprise, bool configure = true)
    {
        Directory.CreateDirectory(directory); identityDirectory = Path.Combine(directory, "operators");
        Operators = new(new FileOperatorStore(identityDirectory));
        Operators.InitializeAdministrator("admin", "合成管理员", Password); Admin = Operators.Login("admin", Password);
        Operators.AddOperator(Admin, Operators.GetDirectory(Admin).Revision, "user", "合成操作员", Password, roles);
        Session = Operators.Login("user", Password);
        Store = SqliteLedgerStore.Create(Path.Combine(directory, "synthetic.caiwu"),
            new(Guid.NewGuid(), "合成授权账套", regime, "synthetic-only", 2026, 1, 0, DateTimeOffset.UtcNow),
            [new("1001", "现金", null, BalanceDirection.Debit, true, 0, 0), new("4001", "资本", null, BalanceDirection.Credit, true, 0, 0)]);
        raw = new(new LockObservedStore(Store, writing =>
        {
            try
            {
                using var access = new FileStream(Path.Combine(identityDirectory, "operators.lock"), FileMode.Open, FileAccess.ReadWrite, FileShare.None);
                throw new InvalidOperationException("Identity lock was released before the real Core/SQLite operation.");
            }
            catch (IOException) { if (writing) WriteLockChecks++; else ReadLockChecks++; }
        }));
        policy = configure ? new([new("cashier", OperatorPermission.EditAccounts)]) : null;
        Facade = Bind(Session);
    }
    public IParityLedgerService Bind(OperatorSession session) => (IParityLedgerService)new AuthorizedLedgerService(new PreviewLedgerService(raw), Operators, session, policy);
    public LedgerMutationContext Context() { var s = Facade.GetModuleSnapshot().Ledger; return new(s.Book.Id, s.Revision); }
    public VoucherProposal Proposal() => Make(Context());
    public VoucherProposal ProposalFromStore() { var s = Store.Read(); return Make(new(s.Book.Id, s.Revision)); }
    private static VoucherProposal Make(LedgerMutationContext context) => new(Guid.NewGuid(), "cashier", ["receipt:1"], context,
        new(2026, 10, 25), "记", null, 0, [new("1001", "合成", 4.56m, 0), new("4001", "合成", 0, 4.56m)], []);
    public void Dispose() { Store.Dispose(); Directory.Delete(directory, true); }
}
sealed class LockObservedStore(ILedgerStore inner, Action<bool> observe) : ILedgerStore
{
    public string DatabasePath => inner.DatabasePath;
    public LedgerSnapshot Read() { observe(false); return inner.Read(); }
    public void Write(LedgerSnapshot next, long revision) { observe(true); inner.Write(next, revision); }
    public void BackupTo(string path) => inner.BackupTo(path);
    public void CheckIntegrity() => inner.CheckIntegrity();
    public void Dispose() { }
}
