using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Desktop.Presentation;
using Caiwu.Operators;

var checks = new List<string>();
void Check(bool condition, string text) { if (!condition) throw new Exception(text); checks.Add(text); Console.WriteLine("PASS " + text); }
void Reject<T>(Action action, string text) where T : Exception
{ try { action(); } catch (T) { Check(true, text); return; } throw new Exception("Expected rejection: " + text); }
var temporary = Path.Combine(Path.GetTempPath(), "caiwu-parity-facade-synthetic-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(temporary);
try
{
    var operators = new LocalOperatorService(new FileOperatorStore(temporary));
    operators.InitializeAdministrator("admin", "合成管理员", "Synthetic-Admin-9!");
    var admin = operators.Login("admin", "Synthetic-Admin-9!");
    operators.AddOperator(admin, operators.GetDirectory(admin).Revision, "preparer", "合成制单", "Synthetic-Prepare-9!", OperatorRoles.Preparer | OperatorRoles.Reader);
    operators.AddOperator(admin, operators.GetDirectory(admin).Revision, "reader", "合成只读", "Synthetic-Reader-9!", OperatorRoles.Reader);
    operators.AddOperator(admin, operators.GetDirectory(admin).Revision, "accountant", "合成会计", "Synthetic-Account-9!", OperatorRoles.Accountant | OperatorRoles.Reader);
    var preparer = operators.Login("preparer", "Synthetic-Prepare-9!"); var reader = operators.Login("reader", "Synthetic-Reader-9!"); var accountant = operators.Login("accountant", "Synthetic-Account-9!");
    var grants = new List<ParityModuleWriteGrant> { new("cashier", OperatorPermission.PrepareVoucher), new("archives", OperatorPermission.EditAccounts) };
    var policy = new ParityModuleWritePolicy(grants); grants[0] = new("cashier", OperatorPermission.ReadLedger);
    Reject<ArgumentException>(() => new ParityModuleWritePolicy([new("cashier", OperatorPermission.ReadLedger)]), "reader permission cannot be configured for module writes");
    Reject<ArgumentException>(() => new ParityModuleWritePolicy([new("cashier", OperatorPermission.PrepareVoucher), new("cashier", OperatorPermission.EditAccounts)]), "duplicate module grants rejected");
    Check(policy.RequiredPermission("cashier") == OperatorPermission.PrepareVoucher, "write policy snapshots configuration and cannot be mutated via caller list");
    Reject<OperatorAuthorizationException>(() => policy.RequiredPermission("unknown"), "unknown module has no implicit grant");
    var book = new BookInfo(Guid.NewGuid(), "仅合成 facade fixture", AccountingRegime.SmallBusiness, "synthetic", 2026, 10, 9, DateTimeOffset.UtcNow);
    var probe = new BoundaryProbe(new(11, book, [], [], []));
    var lockHeld = false;
    probe.Inside = () =>
    {
        try { using var competing = new FileStream(Path.Combine(temporary, "operators.lock"), FileMode.Open, FileAccess.ReadWrite, FileShare.None); throw new Exception("Identity lock was released before underlying operation"); }
        catch (IOException) { lockHeld = true; }
    };
    IParityLedgerService Facade(OperatorSession session, ParityModuleWritePolicy? permissions = null) =>
        (IParityLedgerService)new AuthorizedLedgerService(new PreviewLedgerService(probe), operators, session, permissions ?? policy);
    var facade = Facade(preparer); var readOnly = Facade(reader);
    var snapshot = facade.GetModuleSnapshot();
    Check(ReferenceEquals(snapshot, probe.ModuleSnapshot) && lockHeld, "module snapshot passes through intact under real fixed-session identity lock");
    var context = new LedgerMutationContext(book.Id, 11);
    var payload = "{\"原行号\":7,\"外币\":\"USD\",\"数量\":12345678901234567890.123456789,\"未解释原列\":{\"keep\":true}}";
    var batch = new ModuleDocumentBatch("cashier", context, [new("source-7", new("source-7", 2, payload))]);
    facade.SaveModuleDocuments(batch, "forged actor");
    Check(ReferenceEquals(probe.LastBatch, batch) && probe.Actor == preparer.Identity.ActorKey && lockHeld, "module save forwards exact batch/payload/context with trusted actor while holding lock");
    var unconfigured = (IParityLedgerService)new AuthorizedLedgerService(new PreviewLedgerService(probe), operators, preparer);
    Reject<OperatorAuthorizationException>(() => unconfigured.SaveModuleDocuments(batch, "forged"), "default composition has no implicit module write grant");
    var writes = probe.Writes;
    Reject<OperatorAuthorizationException>(() => readOnly.SaveModuleDocuments(batch, "preparer"), "reader cannot save module documents");
    Reject<OperatorAuthorizationException>(() => Facade(preparer, new ParityModuleWritePolicy([])).SaveModuleDocuments(batch, "preparer"), "unconfigured module cannot save");
    Check(probe.Writes == writes, "denied module writes never reach underlying service");
    var proposal = new VoucherProposal(Guid.NewGuid(), "cashier", ["stable-source-7"], context, new(2026, 10, 8), "记", null, 0,
        [new("1002", "仅边界探针", 25, 0), new("3001", "仅边界探针", 0, 25)], batch.Changes);
    var receipt = facade.AcceptVoucherProposal(proposal, "forged actor");
    Check(ReferenceEquals(probe.LastProposal, proposal) && receipt.ProposalId == proposal.ProposalId && probe.Actor == preparer.Identity.ActorKey,
        "proposal/source keys/original context pass unchanged with trusted actor");
    Reject<OperatorAuthorizationException>(() => Facade(accountant).AcceptVoucherProposal(proposal with { ModuleId = "archives" }, "preparer"), "proposal requires PrepareVoucher even when module save permission is held");
    Reject<OperatorAuthorizationException>(() => facade.AcceptVoucherProposal(proposal with { ModuleId = "archives" }, "accountant"), "proposal also requires configured module write permission");
    Reject<OperatorAuthorizationException>(() => readOnly.AcceptVoucherProposal(proposal, "preparer"), "reader cannot accept proposal");
    var before = probe.Writes;
    probe.ModuleSnapshot = probe.ModuleSnapshot with { Ledger = probe.ModuleSnapshot.Ledger with { Book = book with { Regime = AccountingRegime.Nonprofit } } };
    Reject<LedgerValidationException>(() => facade.SaveModuleDocuments(batch, "preparer"), "preview regime write protection applies to new module save API");
    Reject<LedgerValidationException>(() => facade.AcceptVoucherProposal(proposal, "preparer"), "preview regime write protection applies to proposal acceptance API");
    Check(probe.Writes == before, "protected regime denial never reaches module mutation");
    operators.Logout(preparer);
    Reject<OperatorAuthorizationException>(() => facade.GetModuleSnapshot(), "logout revokes module reads");
    Reject<OperatorAuthorizationException>(() => facade.SaveModuleDocuments(batch, "forged"), "logout revokes module save");
    Reject<OperatorAuthorizationException>(() => facade.AcceptVoucherProposal(proposal, "forged"), "logout revokes proposal acceptance");
    Reject<ArgumentException>(() => operators.ExecuteWithPermissions(reader, [], _ => true), "empty multi-permission requirement rejected");
    Reject<ArgumentException>(() => operators.ExecuteWithPermissions(reader, [OperatorPermission.ReadLedger], _ => Task.FromResult(true)), "async callback cannot escape identity lock");
    operators.Logout(admin); operators.Logout(reader); operators.Logout(accountant);
}
finally { Directory.Delete(temporary, true); }
Console.WriteLine(JsonSerializer.Serialize(new { kind = "synthetic-real-operator-lock-with-boundary-probe", passed = checks.Count,
    coreModuleTransactionsTested = false, windowsUiExecuted = false, checks }));

// A boundary probe, not a fake business implementation or a transaction test. Integration owns the real Core/SQLite implementation.
sealed class BoundaryProbe(LedgerSnapshot snapshot) : ILedgerService, IParityLedgerService
{
    public ModuleLedgerSnapshot ModuleSnapshot { get; set; } = new(snapshot, [], []);
    public Action? Inside;
    public ModuleDocumentBatch? LastBatch;
    public VoucherProposal? LastProposal;
    public string? Actor;
    public int Writes;
    public ModuleLedgerSnapshot GetModuleSnapshot() { Inside?.Invoke(); return ModuleSnapshot; }
    public void SaveModuleDocuments(ModuleDocumentBatch batch, string actor) { Inside?.Invoke(); LastBatch = batch; Actor = actor; Writes++; }
    public ModuleVoucherReceipt AcceptVoucherProposal(VoucherProposal proposal, string actor)
    { Inside?.Invoke(); LastProposal = proposal; Actor = actor; Writes++; return new(proposal.ProposalId, proposal.ModuleId, proposal.SourceKeys, Guid.NewGuid(), proposal.Context.ExpectedRevision + 1); }
    public LedgerSnapshot GetSnapshot() => ModuleSnapshot.Ledger;
    public void SaveAccount(Account a, string actor, LedgerMutationContext? context = null) => throw new NotSupportedException();
    public void DeleteAccount(string c, string actor, LedgerMutationContext? context = null) => throw new NotSupportedException();
    public void SetOpeningBalances(IReadOnlyList<OpeningBalance> b, string actor, LedgerMutationContext? context = null) => throw new NotSupportedException();
    public Voucher SaveDraft(VoucherDraft d, string actor) => throw new NotSupportedException();
    public void DeleteDraft(Guid id, string actor, LedgerMutationContext? context = null) => throw new NotSupportedException();
    public void Review(Guid id, string actor, LedgerMutationContext? context = null) => throw new NotSupportedException();
    public void CancelReview(Guid id, string actor, LedgerMutationContext? context = null) => throw new NotSupportedException();
    public void Post(Guid id, string actor, LedgerMutationContext? context = null) => throw new NotSupportedException();
    public void CloseMonth(int month, string actor, LedgerMutationContext? context = null) => throw new NotSupportedException();
    public IReadOnlyList<TrialBalanceRow> GetTrialBalance(DateOnly from, DateOnly to) => throw new NotSupportedException();
    public IReadOnlyList<LedgerEntryRow> GetLedger(string code, DateOnly from, DateOnly to) => throw new NotSupportedException();
}
