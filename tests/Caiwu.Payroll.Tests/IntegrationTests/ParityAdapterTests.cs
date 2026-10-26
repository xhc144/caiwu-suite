using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Payroll.Integration;

namespace Caiwu.Payroll.Tests;

// Contract doubles verify the adapter; these are explicitly NOT real Core/SQLite tests.
public sealed class ParityAdapterTests
{
    [Fact]
    public void UsesObservedSnapshotAndDoesNotRefreshAwayAConflict()
    {
        var ledger = new ContractDouble(); var observed = ledger.GetModuleSnapshot();
        var store = new ParityPayrollStore(ledger, observed, "synthetic-operator");
        ledger.AdvanceOtherModule();
        var service = new PayrollService(store);
        Assert.Equal(observed.Ledger.Revision, service.Revision);
        Assert.Equal(1, ledger.ReadCount); // Only the caller's original read.
        Assert.Throws<PayrollConflictException>(() => service.SaveDepartments([new() { Code = "01", Name = "测试" }]));
        Assert.Equal(1, ledger.ReadCount);
        Assert.Empty(service.Snapshot.Departments);
        service.Refresh();
        service.SaveDepartments([new() { Code = "01", Name = "测试" }]);
        Assert.Equal("do-not-touch", ledger.Module("other").Documents[0].PayloadJson);
        Assert.Equal("synthetic-operator", ledger.LastActor);
    }

    [Fact]
    public void RequiredAuxiliariesBlockTransferBeforeCallingSharedLedger()
    {
        var ledger = new ContractDouble(); var store = new ParityPayrollStore(ledger, ledger.GetModuleSnapshot(), "operator");
        var service = new PayrollService(store); SyntheticFixture.Populate(service); service.Calculate(SyntheticFixture.Month);
        var plan = service.CreateVoucherPlan(SyntheticFixture.Month, SyntheticFixture.Request(), SyntheticFixture.Accounts);
        var before = service.Revision;
        var error = Assert.Throws<PayrollValidationException>(() => store.AcceptPlan(service.Snapshot, plan.Id));
        Assert.Contains("部门/人员", error.Message);
        Assert.Equal(0, ledger.ProposalCalls);
        Assert.Equal(before, service.Revision);
        Assert.Equal("planned", service.Snapshot.VoucherPlans[0].Status);
    }

    [Fact]
    public void ReopensModuleStateAndReceiptsAfterSameContextProposal()
    {
        var ledger = new ContractDouble(); var store = new ParityPayrollStore(ledger, ledger.GetModuleSnapshot(), "operator");
        var service = new PayrollService(store); SyntheticFixture.Populate(service); service.Calculate(SyntheticFixture.Month);
        var noAux = SyntheticFixture.Accounts.Select(a => a with { RequiresDepartment = false, RequiresEmployee = false }).ToArray();
        var plan = service.CreateVoucherPlan(SyntheticFixture.Month, SyntheticFixture.Request(), noAux);
        var confirmed = service.Snapshot;
        var receipt = store.AcceptPlan(confirmed, plan.Id);
        Assert.Equal(confirmed.Revision, ledger.LastProposal!.Context.ExpectedRevision);
        Assert.Equal(confirmed.BookId, ledger.LastProposal.Context.ExpectedBookId);
        Assert.Equal(plan.SourceKey, Assert.Single(ledger.LastProposal.SourceKeys));
        Assert.Single(ledger.LastProposal.Changes);
        Assert.Contains("DepartmentCode", ledger.LastProposal.Changes[0].Document!.PayloadJson);
        var reopened = new PayrollService(new ParityPayrollStore(ledger, ledger.GetModuleSnapshot(), "operator"));
        Assert.Equal("accepted-draft", reopened.Snapshot.VoucherPlans[0].Status);
        Assert.Equal(receipt.VoucherId, reopened.Snapshot.VoucherPlans[0].VoucherId);
        Assert.Equal(3350.25m, reopened.GetWageTable(SyntheticFixture.Month).Totals["g_l05"]);
        Assert.Throws<PayrollValidationException>(() => new ParityPayrollStore(ledger, ledger.GetModuleSnapshot(), "operator")
            .AcceptPlan(reopened.Snapshot, plan.Id));
        Assert.Single(ledger.GetModuleSnapshot().ProposalReceipts);
    }

    [Fact]
    public void FailedAcceptanceDoesNotMarkPlanAcceptedOrWriteExternalProjection()
    {
        var ledger = new ContractDouble(); var store = new ParityPayrollStore(ledger, ledger.GetModuleSnapshot(), "operator");
        var service = new PayrollService(store); SyntheticFixture.Populate(service); service.Calculate(SyntheticFixture.Month);
        var noAux = SyntheticFixture.Accounts.Select(a => a with { RequiresDepartment = false, RequiresEmployee = false }).ToArray();
        var plan = service.CreateVoucherPlan(SyntheticFixture.Month, SyntheticFixture.Request(), noAux);
        ledger.FailProposal = true;
        Assert.Throws<IOException>(() => store.AcceptPlan(service.Snapshot, plan.Id));
        service.Refresh();
        Assert.Equal("planned", Assert.Single(service.Snapshot.VoucherPlans).Status);
        Assert.Empty(ledger.GetModuleSnapshot().ProposalReceipts);
    }

    [Fact]
    public void UnknownJsonValuesAreRetainedWhileHigherSchemaCannotDowngrade()
    {
        var ledger = new ContractDouble();
        var document = new PayrollDocument { BookId = ledger.BookId, OpeningMonth = SyntheticFixture.Month };
        using var unknown = JsonDocument.Parse("{\"precise\":1234567890.123456789012345678,\"nullable\":null,\"nested\":[1,2]}");
        document.ExtensionData["future"] = unknown.RootElement.Clone();
        document.Employees.Add(new() { Code = "1", Name = "合成", DepartmentCode = "01",
            ExtensionData = new() { ["unknown_person_field"] = unknown.RootElement.Clone() } });
        ledger.SetDocument(new("payroll-state", 1, JsonSerializer.Serialize(document)));
        var service = new PayrollService(new ParityPayrollStore(ledger, ledger.GetModuleSnapshot(), "operator"));
        service.SaveDepartments([new() { Code = "01", Name = "合成部门" }]);
        using var saved = JsonDocument.Parse(ledger.Module("payroll").Documents[0].PayloadJson);
        Assert.Equal("1234567890.123456789012345678", saved.RootElement.GetProperty("future").GetProperty("precise").GetRawText());
        Assert.Equal(JsonValueKind.Null, saved.RootElement.GetProperty("Employees")[0].GetProperty("unknown_person_field").GetProperty("nullable").ValueKind);
        ledger.SetDocument(new("payroll-state", 2, JsonSerializer.Serialize(document)));
        Assert.Throws<PayrollValidationException>(() => new PayrollService(new ParityPayrollStore(ledger, ledger.GetModuleSnapshot(), "operator")));
    }

    [Fact]
    public void PlanSourceRemainsStableAcrossAmountDateAndNumberChanges()
    {
        using var f = new SyntheticFixture(); f.Service.Calculate(SyntheticFixture.Month);
        var plan = f.Service.CreateVoucherPlan(SyntheticFixture.Month, SyntheticFixture.Request(), SyntheticFixture.Accounts);
        f.Service.SetUniformValue(SyntheticFixture.Month, "g_l01", 2222); f.Service.Calculate(SyntheticFixture.Month);
        Assert.Throws<PayrollValidationException>(() => f.Service.CreateVoucherPlan(SyntheticFixture.Month,
            SyntheticFixture.Request(number: 999), SyntheticFixture.Accounts));
        Assert.Equal($"payroll:{f.BookId:D}:2026-10:Payment", plan.SourceKey);
    }

    private sealed class ContractDouble : IParityLedgerService
    {
        public Guid BookId { get; } = Guid.NewGuid();
        private long revision;
        private readonly List<ModuleDocumentCollection> modules = [];
        private readonly List<ModuleVoucherReceipt> receipts = [];
        public int ReadCount, ProposalCalls;
        public bool FailProposal;
        public string? LastActor;
        public VoucherProposal? LastProposal;
        public ModuleLedgerSnapshot GetModuleSnapshot()
        {
            ReadCount++;
            return new(new(revision, new(BookId, "合成总账", AccountingRegime.Enterprise, "synthetic", 2026, 10, 9, DateTimeOffset.UnixEpoch),
                [], [], []), modules.ToArray(), receipts.ToArray());
        }
        public ModuleDocumentCollection Module(string id) => modules.Single(m => m.ModuleId == id);
        public void AdvanceOtherModule()
        { modules.Add(new("other", [new("other-document", 1, "do-not-touch")])); revision++; }
        public void SetDocument(LedgerModuleDocument document)
        { modules.RemoveAll(m => m.ModuleId == "payroll"); modules.Add(new("payroll", [document])); }
        public void SaveModuleDocuments(ModuleDocumentBatch batch, string operatorName)
        {
            Check(batch.Context); Apply(batch.ModuleId, batch.Changes); LastActor = operatorName; revision++;
        }
        public ModuleVoucherReceipt AcceptVoucherProposal(VoucherProposal proposal, string operatorName)
        {
            ProposalCalls++; LastProposal = proposal; Check(proposal.Context);
            if (FailProposal) throw new IOException("Injected synthetic failure before commit");
            if (receipts.Any(r => r.ProposalId == proposal.ProposalId || r.ModuleId == proposal.ModuleId && r.SourceKeys.Intersect(proposal.SourceKeys).Any()))
                throw new PayrollValidationException("来源已消费。");
            Apply(proposal.ModuleId, proposal.Changes); revision++; LastActor = operatorName;
            var receipt = new ModuleVoucherReceipt(proposal.ProposalId, proposal.ModuleId, proposal.SourceKeys, Guid.NewGuid(), revision);
            receipts.Add(receipt); return receipt;
        }
        private void Check(LedgerMutationContext context)
        { if (context.ExpectedBookId != BookId || context.ExpectedRevision != revision) throw new PayrollConflictException(); }
        private void Apply(string module, IReadOnlyList<ModuleDocumentChange> changes)
        {
            var docs = modules.SingleOrDefault(m => m.ModuleId == module)?.Documents.ToList() ?? [];
            foreach (var change in changes) { docs.RemoveAll(d => d.DocumentId == change.DocumentId); if (change.Document is { } doc) docs.Add(doc); }
            modules.RemoveAll(m => m.ModuleId == module); modules.Add(new(module, docs));
        }
    }
}
