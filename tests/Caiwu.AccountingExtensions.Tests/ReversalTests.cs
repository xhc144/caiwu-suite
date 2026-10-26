using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Operators;
using static Caiwu.AccountingExtensions.Tests.SyntheticFixture;

namespace Caiwu.AccountingExtensions.Tests;

public sealed class ReversalTests
{
    [Fact]
    public void ReverseRangePreservesReviewAndAmountsAndChangesOnlySelectedPostedVouchers()
    {
        using var f = new SyntheticFixture();
        var jan = Receipt(); var reviewed = Receipt(number: 2, status: VoucherStatus.Reviewed); var feb = Receipt(2);
        var before = State() with { Vouchers = [jan, reviewed, feb] };
        using var store = new SyntheticMemoryStore(before);
        var result = f.Service(store).ReversePosting(new(2026, 1, 1, false, Context(before)));
        Assert.Equal(new AccountingMutationResult(1, 1), result);
        Assert.Equal(1, store.Reads); Assert.Equal(1, store.Writes);
        var changed = store.State.Vouchers.Single(v => v.Id == jan.Id);
        Assert.Equal(jan with { Status = VoucherStatus.Reviewed, Lines = changed.Lines }, changed);
        Assert.Equal(jan.Lines, changed.Lines);
        Assert.Equal(VoucherStatus.Posted, jan.Status);
        Assert.Equal(reviewed, store.State.Vouchers[1] with { Lines = reviewed.Lines });
        Assert.Equal(VoucherStatus.Posted, store.State.Vouchers[2].Status);
        var audit = Assert.Single(store.State.AuditEvents);
        Assert.Equal(jan.Id, audit.VoucherId); Assert.Equal("ReversePosting", audit.Action);
        Assert.Equal(f.Worker.Identity.ActorKey, audit.OperatorName);
        Assert.Empty(before.AuditEvents);
        Assert.Equal(0, new LedgerService(store).GetTrialBalance(new(2026, 1, 1), new(2026, 1, 31))
            .Single(r => r.AccountCode == "1001").PeriodDebit);
    }

    [Fact]
    public void WholeYearIsAtomicAndRejectsRepeatedOldDecision()
    {
        using var f = new SyntheticFixture();
        var before = State() with { Vouchers = [Receipt(), Receipt(2)] };
        using var store = new SyntheticMemoryStore(before);
        var service = f.Service(store);
        var request = new ReversePostingRequest(2026, 0, 0, true, Context(before));
        Assert.Equal(2, service.ReversePosting(request).AffectedCount);
        Assert.All(store.State.Vouchers, v => Assert.Equal(VoucherStatus.Reviewed, v.Status));
        Assert.Equal(2, store.State.AuditEvents.Count); Assert.Equal(1, store.Writes);
        Assert.Throws<StoreConcurrencyException>(() => service.ReversePosting(request));
        Assert.Equal(1, store.Writes);
    }

    [Fact]
    public void ClosedIntersectionRejectsEntireRangeUntilReopened()
    {
        using var f = new SyntheticFixture();
        var before = State(closed: 1) with { Vouchers = [Receipt(), Receipt(2)] };
        using var store = new SyntheticMemoryStore(before);
        var service = f.Service(store);
        Assert.Throws<LedgerValidationException>(() => service.ReversePosting(new(2026, 1, 2, false, Context(before))));
        Assert.Same(before, store.State); Assert.Equal(0, store.Attempts);
        service.ReopenPeriod(new(2026, false, Context(before)));
        Assert.Equal(2, service.ReversePosting(new(2026, 1, 2, false, Context(store.State))).AffectedCount);
        Assert.Equal(2, store.Writes); Assert.Equal(2, store.State.Revision);
    }

    [Theory]
    [InlineData(2025, 1, 1)]
    [InlineData(2026, 0, 1)]
    [InlineData(2026, 1, 13)]
    [InlineData(2026, 3, 2)]
    public void InvalidYearOrRangeHasNoWrite(int year, int from, int through)
    {
        using var f = new SyntheticFixture();
        var before = State() with { Vouchers = [Receipt()] };
        using var store = new SyntheticMemoryStore(before);
        Assert.Throws<LedgerValidationException>(() => f.Service(store).ReversePosting(new(year, from, through, false, Context(before))));
        Assert.Same(before, store.State); Assert.Equal(0, store.Attempts);
    }

    [Fact]
    public void EmptySelectionHasNoWriteOrAudit()
    {
        using var f = new SyntheticFixture();
        using var store = new SyntheticMemoryStore(State());
        Assert.Throws<LedgerValidationException>(() => f.Service(store).ReversePosting(new(2026, 1, 1, false, Context(store.State))));
        Assert.Equal(0, store.Attempts); Assert.Empty(store.State.AuditEvents);
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("foreign")]
    [InlineData("stale")]
    [InlineData("negative")]
    public void InvalidContextRejectsEveryExtensionMutation(string failure)
    {
        using var f = new SyntheticFixture();
        var state = State(closed: 1) with { Vouchers = [Receipt(2)] };
        using var store = new SyntheticMemoryStore(state);
        var context = failure switch
        {
            "missing" => null!, "foreign" => new(Guid.NewGuid(), 0),
            "stale" => new(state.Book.Id, 1), _ => new LedgerMutationContext(state.Book.Id, -1)
        };
        var service = f.Service(store);
        Assert.Throws<StoreConcurrencyException>(() => service.ReversePosting(new(2026, 2, 2, false, context)));
        Assert.Throws<StoreConcurrencyException>(() => service.ReopenPeriod(new(2026, false, context)));
        Assert.Throws<StoreConcurrencyException>(() => service.GenerateMonthlyTransfer(Transfer(state, 2) with { Context = context }));
        Assert.Equal(0, store.Attempts); Assert.Same(state, store.State);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void ConcurrentWriterWinsWithoutRetryOrLeakedAudit(bool reopen)
    {
        using var f = new SyntheticFixture();
        var before = State(closed: 1) with { Vouchers = [Receipt(2)] };
        using var store = new SyntheticMemoryStore(before);
        var competitor = before with { Revision = 1, Book = before.Book with { Name = "合成并发写入" } };
        store.AfterRead = () => store.State = competitor;
        var service = f.Service(store);
        Assert.Throws<StoreConcurrencyException>(() =>
        {
            if (reopen) service.ReopenPeriod(new(2026, false, Context(before)));
            else service.ReversePosting(new(2026, 2, 2, false, Context(before)));
        });
        Assert.Equal(1, store.Attempts); Assert.Equal(0, store.Writes);
        Assert.Same(competitor, store.State); Assert.Empty(before.AuditEvents);
    }

    [Fact]
    public void FailedWriteLeavesInputAndStoredStateUntouched()
    {
        using var f = new SyntheticFixture();
        var before = State() with { Vouchers = [Receipt()] };
        using var store = new SyntheticMemoryStore(before) { Failure = new IOException("synthetic failure") };
        Assert.Throws<OperatorStorageException>(() => f.Service(store).ReversePosting(new(2026, 1, 1, false, Context(before))));
        Assert.Equal(1, store.Attempts); Assert.Equal(0, store.Writes);
        Assert.Same(before, store.State); Assert.Equal(VoucherStatus.Posted, before.Vouchers[0].Status);
        Assert.Empty(before.AuditEvents);
    }

    [Fact]
    public void ReopenLatestThenAllStopsAtStartAndPreservesManualOpeningBalances()
    {
        using var f = new SyntheticFixture();
        var state = State(closed: 4, start: 2);
        var accounts = state.Accounts.Select(a => a.Code switch
        {
            "1001" => a with { OpeningDebit = 123.45m }, "4103" => a with { OpeningCredit = 123.45m }, _ => a
        }).ToArray();
        using var store = new SyntheticMemoryStore(state with { Accounts = accounts });
        var service = f.Service(store);
        Assert.Equal(1, service.ReopenPeriod(new(2026, false, Context(store.State))).AffectedCount);
        Assert.Equal(3, store.State.Book.ClosedThroughMonth);
        Assert.Equal(2, service.ReopenPeriod(new(2026, true, Context(store.State))).AffectedCount);
        Assert.Equal(1, store.State.Book.ClosedThroughMonth);
        Assert.Equal(accounts, store.State.Accounts);
        Assert.Throws<LedgerValidationException>(() => service.ReopenPeriod(new(2026, true, Context(store.State))));
        Assert.Equal(2, store.Writes); Assert.Equal(2, store.State.AuditEvents.Count);
    }

    [Fact]
    public void CrossYearReopenCannotDeleteOpeningData()
    {
        using var f = new SyntheticFixture();
        var before = State(closed: 12);
        using var store = new SyntheticMemoryStore(before);
        Assert.Throws<LedgerValidationException>(() => f.Service(store).ReopenPeriod(new(2025, false, Context(before))));
        Assert.Equal(0, store.Attempts); Assert.Same(before, store.State);
    }

    [Fact]
    public void LogoutRevokesAllEndpointsBeforeLedgerRead()
    {
        using var f = new SyntheticFixture();
        using var store = new SyntheticMemoryStore(State());
        var service = f.Service(store);
        f.Operators.Logout(f.Worker);
        Assert.Throws<OperatorAuthorizationException>(() => service.GetSnapshot());
        Assert.Throws<OperatorAuthorizationException>(() => service.ReversePosting(new(2026, 1, 1, false, Context(store.State))));
        Assert.Throws<OperatorAuthorizationException>(() => service.ReopenPeriod(new(2026, false, Context(store.State))));
        Assert.Throws<OperatorAuthorizationException>(() => service.PreviewMonthlyTransfer(Transfer(store.State)));
        Assert.Throws<OperatorAuthorizationException>(() => service.GenerateMonthlyTransfer(Transfer(store.State)));
        Assert.Equal(0, store.Reads); Assert.Equal(0, store.Attempts);
    }

    [Fact]
    public void AdministratorAloneAndPosterAloneCannotReverse()
    {
        using var f = new SyntheticFixture();
        using var store = new SyntheticMemoryStore(State() with { Vouchers = [Receipt()] });
        Assert.Throws<OperatorAuthorizationException>(() => f.Service(store, f.Administrator)
            .ReversePosting(new(2026, 1, 1, false, Context(store.State))));
        Assert.Throws<OperatorAuthorizationException>(() => f.Service(store, f.Reviewer)
            .ReversePosting(new(2026, 1, 1, false, Context(store.State))));
        Assert.Equal(0, store.Reads);
    }

    [Fact]
    public void ChangedRoleCannotUseCapturedSessionIdentity()
    {
        using var f = new SyntheticFixture();
        using var store = new SyntheticMemoryStore(State() with { Vouchers = [Receipt()] });
        var service = f.Service(store);
        f.Operators.UpdateOperator(f.Administrator, f.Operators.GetDirectory(f.Administrator).Revision,
            f.Worker.Identity.Id, "合成降权用户", OperatorRoles.Reader, true);
        Assert.Throws<OperatorAuthorizationException>(() => service.ReversePosting(new(2026, 1, 1, false, Context(store.State))));
        Assert.Equal(0, store.Reads); Assert.Equal(0, store.Attempts);
    }

    [Fact]
    public void BrokenReviewOrUnbalancedVoucherCannotBeReversed()
    {
        using var f = new SyntheticFixture();
        var bad = Receipt() with { ReviewedBy = "synthetic-preparer" };
        using var store = new SyntheticMemoryStore(State() with { Vouchers = [bad] });
        Assert.Throws<LedgerValidationException>(() => f.Service(store).ReversePosting(new(2026, 1, 1, false, Context(store.State))));
        Assert.Equal(0, store.Attempts);
    }

    [Fact]
    public void ReviewerNormalizationUsesTheExistingCoreSeparationRule()
    {
        using var f = new SyntheticFixture();
        var bad = Receipt() with { PreparedBy = "maker", ReviewedBy = "ｍａｋｅｒ" };
        using var store = new SyntheticMemoryStore(State() with { Vouchers = [bad] });
        Assert.Throws<LedgerValidationException>(() => f.Service(store).ReversePosting(new(2026, 1, 1, false, Context(store.State))));
        Assert.Equal(0, store.Attempts);
    }

    [Fact]
    public void ExpiredSessionFailsBeforeReadingLedger()
    {
        var clock = new SyntheticClock();
        using var f = new SyntheticFixture(clock);
        using var store = new SyntheticMemoryStore(State() with { Vouchers = [Receipt()] });
        var service = f.Service(store);
        clock.Now += TimeSpan.FromHours(9);
        Assert.Throws<OperatorAuthorizationException>(() => service.ReversePosting(new(2026, 1, 1, false, Context(store.State))));
        Assert.Equal(0, store.Reads); Assert.Equal(0, store.Attempts);
    }

    [Fact]
    public void ExhaustedRevisionCannotPartiallyChangeState()
    {
        using var f = new SyntheticFixture();
        var state = State() with { Revision = long.MaxValue, Vouchers = [Receipt()] };
        using var store = new SyntheticMemoryStore(state);
        Assert.Throws<OverflowException>(() => f.Service(store).ReversePosting(new(2026, 1, 1, false, Context(state))));
        Assert.Equal(0, store.Attempts); Assert.Same(state, store.State);
    }

    [Theory]
    [InlineData("ParityModuleCommit.v1")]
    [InlineData("ParityModuleCommit.v2")]
    public void SharedModuleBooksCannotBypassTheirTransactionProtocolThroughLegacyCommands(string action)
    {
        using var f = new SyntheticFixture();
        const string originalPayload = "{ \"unknown_future_fields\": [0, null, 1.0000000000000000001] }";
        var state = State(closed: 1) with
        {
            Vouchers = [Receipt(2)],
            AuditEvents = [new(Guid.NewGuid(), DateTimeOffset.UtcNow, "synthetic", action, null, originalPayload)]
        };
        using var store = new SyntheticMemoryStore(state);
        var service = f.Service(store);
        Assert.Throws<NotSupportedException>(() => service.ReversePosting(new(2026, 2, 2, false, Context(state))));
        Assert.Throws<NotSupportedException>(() => service.ReopenPeriod(new(2026, false, Context(state))));
        Assert.Throws<NotSupportedException>(() => service.GenerateMonthlyTransfer(Transfer(state, 2)));
        Assert.Equal(0, store.Attempts); Assert.Same(state, store.State);
        Assert.Equal(originalPayload, Assert.Single(service.GetSnapshot().AuditEvents).Detail);
    }

    private sealed class SyntheticClock : TimeProvider
    {
        internal DateTimeOffset Now { get; set; } = new(2026, 10, 26, 0, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }
}
