using System.Text.Json;
using Caiwu.Cashier.Integration;
using Caiwu.Contracts;

namespace Caiwu.Cashier.Tests.Integration;

/// <summary>Adapter conformance against the frozen contract, not evidence for unfinished Core behavior.</summary>
public sealed class ParityAdapterTests
{
    private static readonly Guid BookId = Guid.Parse("00000000-0000-0000-0000-000000000123");
    private static readonly AccountKey Cash = new("1001", "CNY");
    private const string Actor = "synthetic-session-operator";
    private static BookDefinition Definition() => new(BookId.ToString("D"), new(2026, 1, 1), new(2026, 1, 1),
        new(2026, 12, 31), "CNY", [new("1001", "合成现金", true, true, ["CNY", "USD"]), new("6001", "合成收入", true, false, ["CNY"])]);
    private static DocumentInput Input(decimal amount = 100, string currency = "CNY") =>
        new(new("1001", currency), new(2026, 1, 10), "合成收款", DocumentDirection.Receipt, amount, "6001", Actor);
    private static (RecordingLedger Ledger, ParityCashierStore Store, CashierService Service) Setup()
    {
        var ledger = new RecordingLedger(); var store = new ParityCashierStore(ledger, Definition(), Actor);
        return (ledger, store, new CashierService(store));
    }

    [Fact]
    public void Module_save_uses_same_snapshot_context_one_call_and_no_external_state_file()
    {
        var (ledger, _, service) = Setup();
        service.SaveOpening(7, Cash, 2026, 123.123456789m, Actor);
        Assert.Equal(1, ledger.ReadCount); Assert.Equal(1, ledger.SaveCount);
        Assert.Equal(new LedgerMutationContext(BookId, 7), ledger.LastBatch!.Context);
        Assert.Equal("cashier", ledger.LastBatch.ModuleId); Assert.Equal(Actor, ledger.LastActor);
        var state = JsonSerializer.Deserialize<CashierSnapshot>(Assert.Single(ledger.LastBatch.Changes).Document!.PayloadJson)!;
        Assert.Equal(123.123456789m, Assert.Single(state.Openings).Balance);
        Assert.Equal(8, state.Revision);
        Assert.Equal("unrelated-verbatim-json", Assert.Single(ledger.State.Modules, x => x.ModuleId == "other").Documents[0].PayloadJson);
    }

    [Fact]
    public void Stale_context_is_not_replaced_or_retried_and_failure_does_not_commit()
    {
        var (ledger, _, service) = Setup();
        Assert.Throws<CashierConcurrencyException>(() => service.SaveOpening(6, Cash, 2026, 1, Actor));
        Assert.Equal(0, ledger.SaveCount);
        ledger.FailWrites = true;
        var conflict = Assert.Throws<CashierConcurrencyException>(() => service.SaveOpening(7, Cash, 2026, 1, Actor));
        Assert.IsType<StoreConcurrencyException>(conflict.InnerException);
        Assert.Equal(7, conflict.Expected); Assert.Null(conflict.Actual);
        Assert.Equal(1, ledger.SaveCount); Assert.Equal(7, ledger.State.Ledger.Revision);
        Assert.DoesNotContain(ledger.State.Modules, x => x.ModuleId == "cashier");
    }

    [Fact]
    public void Public_CAS_failure_reaches_the_WPF_operation_boundary_without_retry_refresh_or_input_loss()
    {
        var (ledger, _, service) = Setup(); ledger.FailWrites = true;
        var input = new[] { new Caiwu.Cashier.OpeningBalance(Cash, 2026, 123.123456789m) };
        long revision = 7; bool closeEditor = false; var messages = new List<string>();
        bool succeeded = CashierOperationBoundary.Run(() =>
        {
            revision = service.SaveOpenings(revision, input, Actor).Revision;
            closeEditor = true;
        }, messages.Add);
        Assert.False(succeeded); Assert.False(closeEditor); Assert.Equal(7, revision);
        Assert.Equal(123.123456789m, input[0].Balance);
        Assert.Contains("显式重载", Assert.Single(messages));
        Assert.Equal(1, ledger.ReadCount); Assert.Equal(1, ledger.SaveCount);
        Assert.Equal(7, ledger.LastBatch!.Context.ExpectedRevision);
        Assert.Equal(7, ledger.State.Ledger.Revision);
    }

    [Fact]
    public void Proposal_CAS_failure_is_also_normalized_without_refresh_or_retry()
    {
        var (ledger, _, service) = Setup(); service.AddDocument(7, Input());
        var observed = ledger.GetModuleSnapshot(); var adapter = new CashierVoucherProposalAdapter(ledger, Definition());
        var proposal = adapter.CreateProposal(observed, service.CreateVoucherPlan(2026, 1, VoucherGrouping.PerDocument), 0, Guid.NewGuid(), "记");
        int reads = ledger.ReadCount; ledger.FailAccepts = true;
        var conflict = Assert.Throws<CashierConcurrencyException>(() => adapter.AcceptConfirmed(proposal, Actor));
        Assert.IsType<StoreConcurrencyException>(conflict.InnerException); Assert.Null(conflict.Actual);
        Assert.Equal(proposal.Context.ExpectedRevision, conflict.Expected);
        Assert.Equal(reads, ledger.ReadCount); Assert.Equal(1, ledger.AcceptCount);
    }

    [Fact]
    public void Public_gl_snapshot_is_authoritative_and_cannot_be_overwritten_by_fixture_import()
    {
        var (ledger, _, service) = Setup();
        var view = service.ReadReconciliation(new(Cash, 2026, 1));
        Assert.Equal(7, view.SourceRevision); Assert.Single(view.LedgerEntries);
        Assert.True(view.LedgerEntries[0].IsPosted);
        Assert.Equal("ledger.authoritative", Assert.Throws<CashierRuleException>(() => service.StageLedgerSnapshot(7, [], Actor)).Code);
        Assert.Equal(0, ledger.SaveCount);
    }

    [Fact]
    public void Foreign_book_or_unsupported_document_schema_is_not_silently_adopted()
    {
        var ledger = new RecordingLedger();
        Assert.Equal("store.book", Assert.Throws<CashierRuleException>(() =>
            new ParityCashierStore(ledger, Definition() with { Id = Guid.NewGuid().ToString() }, Actor).Read()).Code);
        ledger.PutCashierDocument(new("state", 2, "{}"));
        Assert.Throws<InvalidDataException>(() => new ParityCashierStore(ledger, Definition(), Actor).Read());
        Assert.Equal(0, ledger.SaveCount);
    }

    [Theory]
    [InlineData("remove-usd")] [InlineData("revoke-cashflow")] [InlineData("tighten-date")]
    public void Reopening_with_changed_definition_refuses_old_currency_flags_and_date_policies(string change)
    {
        var (ledger, _, service) = Setup();
        service.SaveOpening(7, Cash, 2026, 100, Actor);
        var originalPayload = ledger.State.Modules.Single(x => x.ModuleId == "cashier").Documents[0].PayloadJson;
        var definition = Definition();
        definition = change switch
        {
            "remove-usd" => definition with { Accounts = [definition.Accounts[0] with { Currencies = ["CNY"] }, definition.Accounts[1]] },
            "revoke-cashflow" => definition with { Accounts = [definition.Accounts[0] with { HasCashFlow = false }, definition.Accounts[1]] },
            "tighten-date" => definition with { LatestDocumentDate = new(2026, 1, 5) },
            _ => throw new InvalidOperationException()
        };
        var reopened = new CashierService(new ParityCashierStore(ledger, definition, Actor));
        Assert.Equal("store.definition.changed", Assert.Throws<CashierRuleException>(() => reopened.Read()).Code);
        Assert.Equal("store.definition.changed", Assert.Throws<CashierRuleException>(() => reopened.AddDocument(8, Input(1, "USD"))).Code);
        Assert.Equal(1, ledger.SaveCount); Assert.Equal(8, ledger.State.Ledger.Revision);
        Assert.Equal(originalPayload, ledger.State.Modules.Single(x => x.ModuleId == "cashier").Documents[0].PayloadJson);
    }

    [Fact]
    public void Closing_month_uses_current_authoritative_period_and_protects_saved_opening()
    {
        var (ledger, _, service) = Setup(); service.SaveOpening(7, Cash, 2026, 100.123456m, Actor);
        ledger.State = ledger.State with { Ledger = ledger.State.Ledger with
        { Book = ledger.State.Ledger.Book with { ClosedThroughMonth = 1 }, Revision = 9 } };
        Assert.Equal(new DateOnly(2026, 2, 1), service.Read().Book.ActiveMonth);
        Assert.Equal("opening.history.protected", Assert.Throws<CashierRuleException>(() => service.SaveOpening(9, Cash, 2026, 1, Actor)).Code);
        Assert.Equal(100.123456m, service.Read().Openings[0].Balance); Assert.Equal(1, ledger.SaveCount);
    }

    [Fact]
    public void Proposal_keeps_stable_business_keys_context_and_claims_in_the_same_batch()
    {
        var (ledger, _, service) = Setup();
        var source = service.AddDocument(7, Input());
        var observed = ledger.GetModuleSnapshot();
        var plan = service.CreateVoucherPlan(2026, 1, VoucherGrouping.PerDocument);
        var adapter = new CashierVoucherProposalAdapter(ledger, Definition());
        var proposal = adapter.CreateProposal(observed, plan, 0, Guid.NewGuid(), "记");
        var second = adapter.CreateProposal(observed, plan, 0, Guid.NewGuid(), "记");
        Assert.Equal(proposal.SourceKeys, second.SourceKeys);
        Assert.Equal($"document:{source.Id:D}", Assert.Single(proposal.SourceKeys));
        Assert.Equal(new LedgerMutationContext(BookId, observed.Ledger.Revision), proposal.Context);
        Assert.Equal(2, proposal.Lines.Count); Assert.Equal(100, proposal.Lines.Sum(x => x.Debit));
        var changed = JsonSerializer.Deserialize<CashierSnapshot>(Assert.Single(proposal.Changes).Document!.PayloadJson)!;
        Assert.StartsWith("proposal:", Assert.Single(changed.Documents).GeneratedVoucherId);
        Assert.Null(Assert.Single(service.Read().Documents).GeneratedVoucherId);
        Assert.Equal(0, ledger.AcceptCount); // construction never submits
        adapter.AcceptConfirmed(proposal, Actor);
        Assert.Equal(1, ledger.AcceptCount); Assert.Same(proposal, ledger.LastProposal); Assert.Equal(Actor, ledger.LastActor);
    }

    [Theory]
    [InlineData("CNY", "1.001")] [InlineData("CNY", "-1")] [InlineData("USD", "1")]
    public void Unsupported_precision_negative_or_foreign_values_are_rejected_without_loss(string currency, string amount)
    {
        var (ledger, _, service) = Setup();
        service.AddDocument(7, Input(decimal.Parse(amount, System.Globalization.CultureInfo.InvariantCulture), currency));
        var snapshot = ledger.GetModuleSnapshot();
        var plan = service.CreateVoucherPlan(2026, 1, VoucherGrouping.PerDocument, new Dictionary<string, decimal> { ["USD"] = 7 });
        var adapter = new CashierVoucherProposalAdapter(ledger, Definition());
        Assert.Equal("voucher.contract.gap", Assert.Throws<CashierRuleException>(() =>
            adapter.CreateProposal(snapshot, plan, 0, Guid.NewGuid(), "记")).Code);
        Assert.Equal(0, ledger.AcceptCount);
        Assert.Equal(decimal.Parse(amount, System.Globalization.CultureInfo.InvariantCulture), service.Read().Documents[0].Debit);
    }

    [Fact]
    public void Unknown_original_columns_block_legacy_voucher_projection_but_remain_stored()
    {
        var (ledger, store, service) = Setup(); var doc = service.AddDocument(7, Input());
        store.Transact(8, s => s with { Documents = [doc with { OriginalFields = new() { ["xmbm"] = new("char(20)", "synthetic-project") } }] });
        var adapter = new CashierVoucherProposalAdapter(ledger, Definition()); var snapshot = ledger.GetModuleSnapshot();
        Assert.Equal("voucher.contract.gap", Assert.Throws<CashierRuleException>(() => adapter.CreateProposal(snapshot,
            service.CreateVoucherPlan(2026, 1, VoucherGrouping.PerDocument), 0, Guid.NewGuid(), "记")).Code);
        Assert.Equal("synthetic-project", service.Read().Documents[0].OriginalFields!["xmbm"].RawValue);
    }

    [Fact]
    public void Tampered_plan_or_stale_plan_is_rejected_before_submission()
    {
        var (ledger, _, service) = Setup(); service.AddDocument(7, Input()); var observed = ledger.GetModuleSnapshot();
        var plan = service.CreateVoucherPlan(2026, 1, VoucherGrouping.PerDocument);
        var tampered = plan with { Vouchers = [plan.Vouchers[0] with { Lines = [plan.Vouchers[0].Lines[0] with { Debit = 99 }, plan.Vouchers[0].Lines[1]] }] };
        var adapter = new CashierVoucherProposalAdapter(ledger, Definition());
        Assert.Equal("voucher.plan.changed", Assert.Throws<CashierRuleException>(() => adapter.CreateProposal(observed, tampered, 0, Guid.NewGuid(), "记")).Code);
        var movedDate = plan with { Vouchers = [plan.Vouchers[0] with { Date = new(2026, 2, 10) }] };
        Assert.Equal("voucher.plan.changed", Assert.Throws<CashierRuleException>(() => adapter.CreateProposal(observed, movedDate, 0, Guid.NewGuid(), "记")).Code);
        Assert.Throws<CashierConcurrencyException>(() => adapter.CreateProposal(observed, plan with { SourceRevision = 7 }, 0, Guid.NewGuid(), "记"));
        Assert.Equal(0, ledger.AcceptCount);
    }

    [Fact]
    public void Receipt_restores_generated_link_after_reopen_and_prevents_direct_deletion()
    {
        var (ledger, _, service) = Setup(); var d = service.AddDocument(7, Input()); var voucher = Guid.NewGuid();
        ledger.State = ledger.State with { ProposalReceipts = [new(Guid.NewGuid(), "cashier", [$"document:{d.Id:D}"], voucher, 8)] };
        Assert.Equal(voucher.ToString("D"), service.Read().Documents[0].GeneratedVoucherId);
        Assert.Equal("document.voucher", Assert.Throws<CashierRuleException>(() => service.DeleteDocument(8, d.Id, Actor)).Code);
    }

    [Fact]
    public void Match_flags_are_module_authority_and_changed_public_line_fails_closed()
    {
        var (ledger, _, service) = Setup(); var d = service.AddDocument(7, Input());
        var view = service.ReadReconciliation(new(Cash, 2026, 1));
        service.Reconcile(view.SourceRevision, Cash, [d.Id], [view.LedgerEntries[0].Id], Actor);
        Assert.Empty(service.ReadReconciliation(new(Cash, 2026, 1)).Documents);
        var first = ledger.State.Ledger.Vouchers[0];
        ledger.State = ledger.State with { Ledger = ledger.State.Ledger with { Vouchers = [first with { Status = VoucherStatus.Draft }] } };
        Assert.Equal("ledger.matched.changed", Assert.Throws<CashierRuleException>(() => service.Read()).Code);
    }

    private sealed class RecordingLedger : IParityLedgerService
    {
        public ModuleLedgerSnapshot State = new(new LedgerSnapshot(7,
            new(BookId, "合成账套", AccountingRegime.Enterprise, "synthetic", 2026, 1, 0, DateTimeOffset.UnixEpoch),
            [new("1001", "合成现金", null, BalanceDirection.Debit, true, 0, 0), new("6001", "合成收入", null, BalanceDirection.Credit, true, 0, 0)],
            [new(Guid.Parse("00000000-0000-0000-0000-000000000456"), new(2026, 1, 10), "记", 1, 0, Actor, "synthetic-reviewer", VoucherStatus.Posted,
                [new("1001", "合成收款", 100, 0), new("6001", "合成收款", 0, 100)])], []),
            [new("other", [new("unrelated", 9, "unrelated-verbatim-json")])], []);
        public int ReadCount, SaveCount, AcceptCount;
        public bool FailWrites, FailAccepts;
        public ModuleDocumentBatch? LastBatch;
        public VoucherProposal? LastProposal;
        public string? LastActor;
        public ModuleLedgerSnapshot GetModuleSnapshot() { ReadCount++; return State; }
        public void SaveModuleDocuments(ModuleDocumentBatch batch, string actor)
        {
            SaveCount++; LastBatch = batch; LastActor = actor;
            if (FailWrites) throw new StoreConcurrencyException("synthetic conflict");
            Assert.Equal(new LedgerMutationContext(BookId, State.Ledger.Revision), batch.Context);
            State = State with { Ledger = State.Ledger with { Revision = State.Ledger.Revision + 1 } };
            PutCashierDocument(Assert.Single(batch.Changes).Document!);
        }
        public ModuleVoucherReceipt AcceptVoucherProposal(VoucherProposal proposal, string actor)
        {
            AcceptCount++; LastProposal = proposal; LastActor = actor;
            if (FailAccepts) throw new StoreConcurrencyException("synthetic proposal conflict");
            return new(proposal.ProposalId, proposal.ModuleId, proposal.SourceKeys, Guid.NewGuid(), State.Ledger.Revision + 1);
        }
        public void PutCashierDocument(LedgerModuleDocument document) => State = State with
        { Modules = State.Modules.Where(x => x.ModuleId != "cashier").Append(new("cashier", [document])).ToArray() };
    }
}
