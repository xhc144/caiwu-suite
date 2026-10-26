using Caiwu.Contracts;
using Caiwu.Core;

namespace Caiwu.Core.Tests;

public sealed class ParityModuleTests
{
    private static LedgerSnapshot Initial() => new(0,
        new(Guid.NewGuid(), "合成模块账套", AccountingRegime.Enterprise, "synthetic-only", 2026, 1, 0, DateTimeOffset.UtcNow),
        [new("1001", "现金", null, BalanceDirection.Debit, true, 0, 0),
         new("4001", "资本", null, BalanceDirection.Credit, true, 0, 0)], [], []);

    private static LedgerMutationContext Context(LedgerService service)
    {
        var s = service.GetSnapshot();
        return new(s.Book.Id, s.Revision);
    }

    private static VoucherProposal Proposal(LedgerService service, string moduleId = "cashier", string source = "receipt:1") =>
        new(Guid.NewGuid(), moduleId, [source], Context(service), new(2026, 10, 25), "记", null, 0,
            [new("1001", "合成收款", 12.34m, 0), new("4001", "合成收款", 0, 12.34m)], []);

    private static ModuleDocumentChange Change(string id, string json, int version = 1) => new(id, new(id, version, json));

    [Fact]
    public void ProposalCommitsOneDraftAndDurableReceiptAtExactlyOneRevision()
    {
        using var store = new MemoryLedgerStore(Initial());
        var service = new LedgerService(store);
        var proposal = Proposal(service);
        var receipt = service.AcceptVoucherProposal(proposal, "制单员");
        var state = service.GetModuleSnapshot();
        var voucher = Assert.Single(state.Ledger.Vouchers);
        Assert.Equal(VoucherStatus.Draft, voucher.Status);
        Assert.Null(voucher.ReviewedBy);
        Assert.Equal("制单员", voucher.PreparedBy);
        Assert.Equal(12.34m, voucher.Lines.Sum(l => l.Debit));
        Assert.Equal(12.34m, voucher.Lines.Sum(l => l.Credit));
        Assert.Equal(voucher.Id, receipt.VoucherId);
        Assert.Equal(1, state.Ledger.Revision);
        Assert.Equal(1, receipt.Revision);
        Assert.Equal(receipt, Assert.Single(state.ProposalReceipts) with { SourceKeys = receipt.SourceKeys });
        Assert.Single(state.Ledger.AuditEvents);
        Assert.Equal(1, store.SuccessfulWrites);
    }

    [Fact]
    public void UnknownAuxiliaryCurrencyQuantityAndLargeNumericFieldsSurviveBaseLedgerEditsVerbatim()
    {
        using var store = new MemoryLedgerStore(Initial());
        var service = new LedgerService(store);
        const string raw = "{ \"foreign\":{\"currency\":\"USD\",\"amount\":123.456789},\"quantity\":0.000001,\"auxiliary\":{\"project\":\"甲\"},\"future\":123456789012345678901234567890 }";
        service.SaveModuleDocuments(new("ledger", Context(service), [Change("line:1", raw, 7)]), "甲");
        service.SaveAccount(new("2001", "应付", null, BalanceDirection.Credit, true, 0, 0), "乙", Context(service));
        service.SaveModuleDocuments(new("payroll", Context(service), [Change("line:1", "{\"salary\":99}")]), "丙");
        var state = service.GetModuleSnapshot();
        Assert.Equal(raw, Assert.Single(state.Modules.Single(m => m.ModuleId == "ledger").Documents).PayloadJson);
        Assert.Equal(7, state.Modules.Single(m => m.ModuleId == "ledger").Documents[0].SchemaVersion);
        Assert.Equal(2, state.Modules.Count);
        Assert.Equal(3, state.Ledger.Revision);
    }

    [Fact]
    public void OneProposalAtomicallyStoresModuleChangesAndSourceClaims()
    {
        using var store = new MemoryLedgerStore(Initial());
        var service = new LedgerService(store);
        var proposal = Proposal(service) with { Changes = [Change("receipt:1", "{\"state\":\"generated\",\"unmapped\":\"原值\"}")] };
        service.AcceptVoucherProposal(proposal, "甲");
        var reopened = new LedgerService(store).GetModuleSnapshot();
        Assert.Single(reopened.Ledger.Vouchers);
        Assert.Single(reopened.ProposalReceipts);
        Assert.Contains("原值", Assert.Single(Assert.Single(reopened.Modules).Documents).PayloadJson);
        Assert.Equal(1, store.SuccessfulWrites);
    }

    [Fact]
    public void StorageFailureLeavesNoVoucherDocumentReceiptOrRevision()
    {
        using var store = new MemoryLedgerStore(Initial()) { WriteFailure = new IOException("synthetic failure") };
        var service = new LedgerService(store);
        var proposal = Proposal(service) with { Changes = [Change("receipt:1", "{\"state\":\"generated\"}")] };
        Assert.Throws<IOException>(() => service.AcceptVoucherProposal(proposal, "甲"));
        var state = service.GetModuleSnapshot();
        Assert.Equal(0, state.Ledger.Revision);
        Assert.Empty(state.Ledger.Vouchers);
        Assert.Empty(state.Ledger.AuditEvents);
        Assert.Empty(state.Modules);
        Assert.Empty(state.ProposalReceipts);
        Assert.Equal(1, store.WriteAttempts);
    }

    [Fact]
    public void StaleForeignMissingOrNegativeContextNeverWrites()
    {
        using var store = new MemoryLedgerStore(Initial());
        var service = new LedgerService(store);
        var proposal = Proposal(service);
        service.SaveModuleDocuments(new("assets", Context(service), [Change("card:1", "{}")]), "甲");
        foreach (var context in new LedgerMutationContext?[] { proposal.Context, new(Guid.NewGuid(), 1), new(proposal.Context.ExpectedBookId, -1), null })
        {
            Assert.Throws<StoreConcurrencyException>(() => service.AcceptVoucherProposal(proposal with { Context = context! }, "乙"));
            Assert.Throws<StoreConcurrencyException>(() => service.SaveModuleDocuments(new("cashier", context!, [Change("x", "{}")]), "乙"));
        }
        Assert.Equal(1, store.WriteAttempts);
    }

    [Fact]
    public void ProposalOrSourceCannotBeReusedEvenAfterDraftDeletionButModulesHaveSeparateSources()
    {
        using var store = new MemoryLedgerStore(Initial());
        var service = new LedgerService(store);
        var original = Proposal(service);
        var receipt = service.AcceptVoucherProposal(original, "甲");
        service.DeleteDraft(receipt.VoucherId, "甲", Context(service));
        Assert.Throws<LedgerValidationException>(() => service.AcceptVoucherProposal(original with { Context = Context(service) }, "甲"));
        Assert.Throws<LedgerValidationException>(() => service.AcceptVoucherProposal(Proposal(service), "甲"));
        var another = service.AcceptVoucherProposal(Proposal(service, "assets"), "甲");
        Assert.NotEqual(receipt.VoucherId, another.VoucherId);
        Assert.Equal(2, service.GetModuleSnapshot().ProposalReceipts.Count);
        Assert.Single(service.GetSnapshot().Vouchers);
    }

    [Fact]
    public void ExistingVoucherRulesRejectClosedPeriodBadAccountUnbalancedAndFractionalCents()
    {
        using var store = new MemoryLedgerStore(Initial());
        var service = new LedgerService(store);
        var valid = Proposal(service);
        var invalid = new[]
        {
            valid with { Date = new(2027, 1, 1) },
            valid with { Lines = [new("9999", "不存在", 12.34m, 0), valid.Lines[1]] },
            valid with { Lines = [valid.Lines[0], valid.Lines[1] with { Credit = 12.35m }] },
            valid with { Lines = [valid.Lines[0] with { Debit = 12.341m }, valid.Lines[1] with { Credit = 12.341m }] }
        };
        foreach (var p in invalid) Assert.Throws<LedgerValidationException>(() => service.AcceptVoucherProposal(p, "甲"));
        Assert.Equal(0, store.WriteAttempts);
        service.CloseMonth(1, "甲", Context(service));
        Assert.Throws<LedgerValidationException>(() => service.AcceptVoucherProposal(valid with { Date = new(2026, 1, 25), Context = Context(service) }, "甲"));
        Assert.Equal(1, store.WriteAttempts);
    }

    [Theory]
    [InlineData("{\"x\":1,\"x\":2}")]
    [InlineData("{\"x\":1,\"\\u0078\":2}")]
    [InlineData("{\"nested\":{\"x\":1,\"x\":2}}")]
    [InlineData("[]")]
    [InlineData("{bad}")]
    public void InvalidPayloadIsRejectedWithoutAnyWrite(string json)
    {
        using var store = new MemoryLedgerStore(Initial());
        var service = new LedgerService(store);
        Assert.Throws<LedgerValidationException>(() => service.SaveModuleDocuments(new("cashier", Context(service), [Change("x", json)]), "甲"));
        Assert.Equal(0, store.WriteAttempts);
    }

    [Fact]
    public void DocumentVersionDowngradeAndMixedInvalidChangesDoNotPartiallyApply()
    {
        using var store = new MemoryLedgerStore(Initial());
        var service = new LedgerService(store);
        service.SaveModuleDocuments(new("cashier", Context(service), [Change("x", "{\"keep\":1}", 3)]), "甲");
        Assert.Throws<LedgerValidationException>(() => service.SaveModuleDocuments(new("cashier", Context(service),
            [Change("new", "{}"), Change("x", "{}", 2)]), "甲"));
        var doc = Assert.Single(Assert.Single(service.GetModuleSnapshot().Modules).Documents);
        Assert.Equal("{\"keep\":1}", doc.PayloadJson);
        Assert.Equal(1, store.WriteAttempts);
    }

    [Fact]
    public void ExplicitDeletePreservesOtherDocumentsAndSourceReceipts()
    {
        using var store = new MemoryLedgerStore(Initial());
        var service = new LedgerService(store);
        service.AcceptVoucherProposal(Proposal(service) with { Changes = [Change("x", "{}"), Change("y", "{}")] }, "甲");
        service.SaveModuleDocuments(new("cashier", Context(service), [new("x", null)]), "甲");
        var state = service.GetModuleSnapshot();
        Assert.Equal("y", Assert.Single(Assert.Single(state.Modules).Documents).DocumentId);
        Assert.Single(state.ProposalReceipts);
    }

    [Fact]
    public void ReturnedStateCannotBeEditedThroughCollectionCasts()
    {
        using var store = new MemoryLedgerStore(Initial());
        var service = new LedgerService(store);
        service.AcceptVoucherProposal(Proposal(service) with { Changes = [Change("x", "{}")] }, "甲");
        var state = service.GetModuleSnapshot();
        Assert.Throws<NotSupportedException>(() => ((IList<ModuleDocumentCollection>)state.Modules).Clear());
        Assert.Throws<NotSupportedException>(() => ((IList<LedgerModuleDocument>)state.Modules[0].Documents).Clear());
        Assert.Throws<NotSupportedException>(() => ((IList<string>)state.ProposalReceipts[0].SourceKeys).Clear());
        Assert.Single(service.GetModuleSnapshot().ProposalReceipts);
    }

    [Fact]
    public void FutureOrDamagedJournalIsNeverSilentlyIgnored()
    {
        foreach (var action in new[] { "ParityModuleCommit.v2", "ParityModuleCommit.v1" })
        {
            var initial = Initial() with { Revision = 1, AuditEvents = [new(Guid.NewGuid(), DateTimeOffset.UtcNow, "甲", action, null, "{}") ] };
            using var store = new MemoryLedgerStore(initial);
            var service = new LedgerService(store);
            Assert.Throws<LedgerValidationException>(() => service.GetModuleSnapshot());
            Assert.Throws<LedgerValidationException>(() => service.SaveModuleDocuments(new("cashier", Context(service), [Change("x", "{}")]), "甲"));
            Assert.Equal(0, store.WriteAttempts);
        }
    }

    [Fact]
    public void DeepOversizedOrInvalidUtf16PayloadsFailBeforeStorage()
    {
        using var store = new MemoryLedgerStore(Initial());
        var service = new LedgerService(store);
        foreach (var raw in new[] { "{\"x\":" + new string('[', 65) + "0" + new string(']', 65) + "}",
            "{\"x\":\"" + new string('x', 1024 * 1024) + "\"}", "{\"x\":\"\ud800\"}" })
            Assert.Throws<LedgerValidationException>(() => service.SaveModuleDocuments(new("cashier", Context(service), [Change("x", raw)]), "甲"));
        Assert.Equal(0, store.WriteAttempts);
    }

    [Fact]
    public void InvalidProposalIdentityOrDuplicateSourcesCannotClaimAnything()
    {
        using var store = new MemoryLedgerStore(Initial());
        var service = new LedgerService(store);
        var valid = Proposal(service);
        foreach (var invalid in new[] { valid with { ProposalId = Guid.Empty }, valid with { SourceKeys = [] },
            valid with { SourceKeys = ["x", "x"] }, valid with { SourceKeys = [" x"] },
            valid with { ModuleId = "Cashier" }, valid with { ModuleId = "cashier/other" } })
            Assert.Throws<LedgerValidationException>(() => service.AcceptVoucherProposal(invalid, "甲"));
        Assert.Equal(0, store.WriteAttempts);
    }

    [Fact]
    public void CallerMutationAfterSubmissionCannotChangePersistedPayloadSourcesOrLines()
    {
        using var store = new MemoryLedgerStore(Initial());
        var service = new LedgerService(store);
        var valid = Proposal(service);
        var sources = new List<string> { "receipt:1" };
        var lines = valid.Lines.ToList();
        var changes = new List<ModuleDocumentChange> { Change("x", "{\"keep\":true}") };
        service.AcceptVoucherProposal(valid with { SourceKeys = sources, Lines = lines, Changes = changes }, "甲");
        sources.Clear(); lines.Clear(); changes.Clear();
        var state = service.GetModuleSnapshot();
        Assert.Single(state.ProposalReceipts[0].SourceKeys);
        Assert.Equal(2, state.Ledger.Vouchers[0].Lines.Count);
        Assert.Equal("{\"keep\":true}", state.Modules[0].Documents[0].PayloadJson);
    }
}
