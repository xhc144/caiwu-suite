using Caiwu.AccountingExtensions.Parity;
using Caiwu.Contracts;
using Caiwu.Operators;
using static Caiwu.AccountingExtensions.Tests.SyntheticFixture;

namespace Caiwu.AccountingExtensions.Tests;

/// <summary>Contract-double checks only. These tests do not prove the shared Core transaction is implemented.</summary>
public sealed class ParityAdapterTests
{
    [Fact]
    public void ProposalContainsStableSourceAndSameContextWithDocumentAndVoucherTogether()
    {
        using var f = new SyntheticFixture();
        var ledger = State() with { Vouchers = [Receipt(), Expense()] };
        var shared = new ContractDouble(new(ledger, [], []));
        var adapter = new ParityAccountingAdapter(shared, f.Operators, f.Worker);
        var request = Transfer(ledger);
        var first = adapter.PreviewMonthlyTransfer(request);
        var second = adapter.PreviewMonthlyTransfer(request with { Definition = request.Definition with { Version = "changed-version" } });
        Assert.Equal(first.ProposalId, second.ProposalId); Assert.Equal(first.SourceKeys, second.SourceKeys);
        Assert.Equal(request.Context, first.Context); Assert.Equal(3, first.Lines.Count);
        Assert.Equal(first.SourceKeys[0], Assert.Single(first.Changes).Document!.DocumentId);
        var receipt = adapter.AcceptMonthlyTransfer(request);
        Assert.Equal(first.ProposalId, receipt.ProposalId); Assert.Equal(f.Worker.Identity.ActorKey, shared.Actor);
        Assert.Equal(1, shared.AcceptCalls); Assert.Equal(0, shared.SaveCalls);
        Assert.Equal(first.SourceKeys, shared.Accepted!.SourceKeys);
    }

    [Fact]
    public void ConsumedSourceCannotBeRegeneratedByChangingRuleVersion()
    {
        using var f = new SyntheticFixture();
        var ledger = State() with { Vouchers = [Receipt(), Expense()] };
        var shared = new ContractDouble(new(ledger, [], []));
        var adapter = new ParityAccountingAdapter(shared, f.Operators, f.Worker);
        var proposal = adapter.PreviewMonthlyTransfer(Transfer(ledger));
        shared.State = shared.State with { ProposalReceipts = [new(proposal.ProposalId, proposal.ModuleId, proposal.SourceKeys, Guid.NewGuid(), 1)] };
        var request = Transfer(ledger);
        Assert.Throws<LedgerValidationException>(() => adapter.AcceptMonthlyTransfer(request with
        {
            Definition = request.Definition with { Version = "v2" }
        }));
        Assert.Equal(0, shared.AcceptCalls);
    }

    [Fact]
    public void RawReferenceJsonRetainsUnknownColumnsAndOriginalNumericTextVerbatim()
    {
        using var f = new SyntheticFixture();
        var shared = new ContractDouble(new(State(), [], []));
        // Accountant is required for reference-data writes; a preparer session alone cannot do this.
        var worker = f.Worker.Identity;
        f.Operators.UpdateOperator(f.Administrator, f.Operators.GetDirectory(f.Administrator).Revision,
            worker.Id, worker.DisplayName, worker.Roles | OperatorRoles.Accountant, true);
        var session = f.Operators.Login("worker", Password);
        var adapter = new ParityAccountingAdapter(shared, f.Operators, session);
        const string payload = "{ \"foreign\":0.0000000000000000001,\"unknown\":{\"sqlType\":\"double\",\"text\":\"1.7976931348623157E+308\"},\"quantity\":null }";
        var document = new LedgerModuleDocument("reference/synthetic-line-1", 7, payload);
        var context = Context(shared.State.Ledger);
        adapter.SaveRawReferenceDocument(context, document);
        Assert.Equal(payload, Assert.Single(shared.Batch!.Changes).Document!.PayloadJson);
        Assert.Equal(context, shared.Batch.Context); Assert.Equal(7, shared.Batch.Changes[0].Document!.SchemaVersion);
        Assert.Equal(1, shared.SaveCalls); Assert.Equal(0, shared.AcceptCalls);
    }

    [Fact]
    public void UnknownModuleDimensionsBlockPlainAmountTransfer()
    {
        using var f = new SyntheticFixture();
        var ledger = State() with { Vouchers = [Receipt(), Expense()] };
        var shared = new ContractDouble(new(ledger,
            [new("other-module", [new("foreign-data", 1, "{\"unknown\":1}")])], []));
        var adapter = new ParityAccountingAdapter(shared, f.Operators, f.Worker);
        Assert.Throws<NotSupportedException>(() => adapter.AcceptMonthlyTransfer(Transfer(ledger)));
        Assert.Equal(0, shared.AcceptCalls);
    }

    [Fact]
    public void OldContextAndRevokedSessionCannotReachCommit()
    {
        using var f = new SyntheticFixture();
        var ledger = State() with { Vouchers = [Receipt(), Expense()] };
        var shared = new ContractDouble(new(ledger with { Revision = 1 }, [], []));
        var adapter = new ParityAccountingAdapter(shared, f.Operators, f.Worker);
        Assert.Throws<StoreConcurrencyException>(() => adapter.AcceptMonthlyTransfer(Transfer(ledger)));
        f.Operators.Logout(f.Worker);
        Assert.Throws<OperatorAuthorizationException>(() => adapter.AcceptMonthlyTransfer(Transfer(ledger)));
        Assert.Equal(0, shared.AcceptCalls); Assert.Equal(1, shared.ReadCalls);
    }

    [Fact]
    public void RegistrationListsOnlyImplementedReversalWindowHandlers()
    {
        var registration = ParityAccountingAdapter.Registration;
        Assert.Equal(6, registration.OriginalWindows.Count);
        Assert.All(registration.OriginalWindows, w => Assert.Contains(w.ObjectName, new[] { "w_zw_fgz", "w_zw_qxfz" }));
        Assert.Equal(3, registration.OriginalWindows.Select(w => w.Product).Distinct().Count());
    }

    private sealed class ContractDouble(ModuleLedgerSnapshot state) : IParityLedgerService
    {
        internal ModuleLedgerSnapshot State { get; set; } = state;
        internal int ReadCalls, AcceptCalls, SaveCalls;
        internal VoucherProposal? Accepted;
        internal ModuleDocumentBatch? Batch;
        internal string? Actor;
        public ModuleLedgerSnapshot GetModuleSnapshot() { ReadCalls++; return State; }
        public void SaveModuleDocuments(ModuleDocumentBatch batch, string actor)
        { SaveCalls++; Batch = batch; Actor = actor; }
        public ModuleVoucherReceipt AcceptVoucherProposal(VoucherProposal proposal, string actor)
        {
            AcceptCalls++; Accepted = proposal; Actor = actor;
            return new(proposal.ProposalId, proposal.ModuleId, proposal.SourceKeys, Guid.NewGuid(), State.Ledger.Revision + 1);
        }
    }
}
