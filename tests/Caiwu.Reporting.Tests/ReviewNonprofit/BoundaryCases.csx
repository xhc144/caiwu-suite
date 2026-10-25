using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Nonprofit;
using Np = Caiwu.Nonprofit;

namespace Caiwu.Reporting.ReviewNonprofit;

// Read-only evidence against commit 38533de. Counterexample_* assert observed defects, not desired behavior.
public sealed class BoundaryCases
{
    private const decimal Max = 92233720368547758.07m;
    private static readonly DateOnly From = new(2026, 6, 1), To = new(2026, 6, 30);
    private static readonly Classification U = new(RestrictionClass.Unrestricted, null, null, null);
    private static readonly Classification R = new(RestrictionClass.Restricted, "grant-A", 1, "project-A");
    private static readonly RestrictionEvidence Evidence = new("grant-A", 1, "project-A", RestrictionSourceKind.ExternalProvider,
        "synthetic-reviewed-agreement", [new(RestrictionConditionKind.Purpose, "synthetic-only-project-A")]);
    private readonly NonprofitPlanningService service = new();
    private PlanningState State(params ClassifiedBalance[] balances) => service.CreateState(Guid.NewGuid(), From, To, [Evidence], balances, 73);
    private static decimal Balance(PlanningState state, string account) => state.Balances.Where(b => b.AccountCode == account).Sum(b => b.NetDebit);

    [Fact]
    public void Counterexample_SameBalancedOpeningIsAcceptedOrRejectedSolelyByInputOrder()
    {
        ClassifiedBalance cash = new("1002", null, Max), otherCash = new("1009", null, Max),
            capital = new("3101", U, -Max), payable = new("2202", null, -Max);
        var interleaved = State(cash, capital, otherCash, payable);
        Assert.Equal(0m, interleaved.Balances.Sum(b => b.NetDebit));
        Assert.Equal(4, interleaved.Balances.Count);
        var rejected = Assert.Throws<NonprofitValidationException>(() => State(cash, otherCash, capital, payable));
        Assert.Equal("NP_TOTAL_OVERFLOW", rejected.Code);
        // Every individual balance and the final sum fit; only the transient partial sum differs.
        Assert.All(interleaved.Balances, b => Assert.InRange(b.NetDebit, -Max, Max));
    }

    [Fact]
    public void Counterexample_AcceptedExpenseCanReturnBalancedProjectionThatItsNextCallRejects()
    {
        var state = State(new("1002", null, Max), new("3101", U, -Max), new("1009", null, Max), new("2202", null, -Max));
        var expense = service.SuggestExpense(state, new(Guid.NewGuid(), 0, To, "5301", 0.01m, U, "synthetic-one-cent-expense"));
        Assert.Equal(SuggestionStatus.PendingReview, expense.Status);
        Assert.Equal(0m, expense.ProjectedState.Balances.Sum(b => b.NetDebit));
        Assert.Equal(0m, expense.Changes.Sum(c => c.Change));
        Assert.Equal(Max - 0.01m, Balance(expense.ProjectedState, "1002"));
        Assert.Equal(0.01m, Balance(expense.ProjectedState, "5301"));
        var rejected = Assert.Throws<NonprofitValidationException>(() => service.SuggestClosing(expense.ProjectedState,
            new(Guid.NewGuid(), expense.ProjectedState.Revision, To)));
        Assert.Equal("NP_TOTAL_OVERFLOW", rejected.Code);
    }

    [Fact]
    public void ReportingBoundary_AllocationClosingAndReleasePreserveSignsButAreNotAllOperatingActivity()
    {
        var initial = State();
        var original = JsonSerializer.Serialize(initial);
        var restricted = service.SuggestDonation(initial, new(Guid.NewGuid(), 0, To, 0.07m, R, DonationKind.Cash, "synthetic-gift-R", true));
        var unrestricted = service.SuggestDonation(restricted.ProjectedState,
            new(Guid.NewGuid(), restricted.ProjectedState.Revision, To, 0.04m, U, DonationKind.Cash, "synthetic-gift-U", true));
        var allocation = new AllocationRequest("synthetic-2-to-3", Guid.NewGuid(), 0.05m, true, "synthetic-reviewed-common-cost-basis",
            [new("restricted", Guid.NewGuid(), "5101", R, 2), new("unrestricted", Guid.NewGuid(), "5301", U, 3)]);
        var expense = service.SuggestAllocatedExpense(unrestricted.ProjectedState, Guid.NewGuid(), unrestricted.ProjectedState.Revision,
            To, allocation, "synthetic-first-payment");
        var closing = service.SuggestClosing(expense.ProjectedState, new(Guid.NewGuid(), expense.ProjectedState.Revision, To));
        var release = service.SuggestRelease(closing.ProjectedState, new(Guid.NewGuid(), closing.ProjectedState.Revision, To, 0.05m,
            new("grant-A", 1, false, true, false, "synthetic-purpose-complete")));
        Np.NonprofitProposal[] proposals = [restricted, unrestricted, expense, closing, release];
        Assert.Equal(original, JsonSerializer.Serialize(initial));
        Assert.All(proposals, proposal =>
        {
            Assert.Equal(SuggestionStatus.PendingReview, proposal.Status);
            Assert.Equal(73L, proposal.BasedOnLedgerRevision);
            Assert.Equal(0m, proposal.ProjectedState.Balances.Sum(b => b.NetDebit));
            Assert.All(proposal.Vouchers, v => Assert.Equal(v.Lines.Sum(l => l.Debit), v.Lines.Sum(l => l.Credit)));
            Assert.All(proposal.Vouchers, v => Assert.Equal(SuggestionStatus.PendingReview, v.Status));
        });
        Assert.Equal(-0.05m, Balance(closing.ProjectedState, "3102"));
        Assert.Equal(-0.01m, Balance(closing.ProjectedState, "3101"));
        Assert.Equal(0.06m, Balance(release.ProjectedState, "1002"));
        Assert.Equal(0m, Balance(release.ProjectedState, "3102"));
        Assert.Equal(-0.06m, Balance(release.ProjectedState, "3101"));
        Assert.Equal(0.05m, Assert.Single(release.Changes, c => c.AccountCode == "3102").Change);
        Assert.Equal(-0.05m, Assert.Single(release.Changes, c => c.AccountCode == "3101").Change);

        var vouchers = proposals.SelectMany(p => p.Vouchers).ToArray();
        var activities = vouchers.Where(v => v.Kind == SuggestionKind.Activity).SelectMany(v => v.Lines).ToArray();
        Assert.Equal(0.11m, activities.Where(l => l.AccountCode == "4101").Sum(l => l.Credit - l.Debit));
        Assert.Equal(0.05m, activities.Where(l => l.AccountCode is "5101" or "5301").Sum(l => l.Debit - l.Credit));
        Assert.Equal(0m, vouchers.SelectMany(v => v.Lines).Where(l => l.AccountCode == "4101").Sum(l => l.Credit - l.Debit));
        Assert.Equal(0m, vouchers.SelectMany(v => v.Lines).Where(l => l.AccountCode is "5101" or "5301").Sum(l => l.Debit - l.Credit));
        Assert.DoesNotContain(Assert.Single(release.Vouchers).Lines, l => l.AccountCode is "1002" or "4101" or "5101" or "5301");

        // Lossy GL-only test adapter: PendingReview must remain Draft; it is not a production classification bridge.
        var drafts = vouchers.Select((v, i) => new Caiwu.Contracts.Voucher(v.Id, v.Date, "建议", i + 1, 0, "synthetic", null,
            VoucherStatus.Draft, v.Lines.Select(l => new VoucherLine(l.AccountCode, l.Summary, l.Debit, l.Credit)).ToArray())).ToArray();
        var metadata = Metadata();
        var list = ReportBuilder.VoucherList(metadata, drafts);
        Assert.Equal(0.37m, list.Total.Cells[7].Amount); // Journal debit volume includes close/release, not expense or revenue.
        Assert.Empty(ReportBuilder.VoucherList(metadata, drafts, status: VoucherStatus.Posted).Rows);
        Assert.Contains("草稿", list.Note);
    }

    [Fact]
    public void ReportingBoundary_DualClassBalancesCannotBePassedAsDuplicateAccountRows()
    {
        var first = service.SuggestDonation(State(), new(Guid.NewGuid(), 0, To, 100m, R, DonationKind.Cash, "synthetic-R", true));
        var second = service.SuggestDonation(first.ProjectedState,
            new(Guid.NewGuid(), first.ProjectedState.Revision, To, 200m, U, DonationKind.Cash, "synthetic-U", true));
        var source = second.ProjectedState.Balances.Where(b => b.AccountCode == "4101").ToArray();
        Assert.Equal(2, source.Length);
        Assert.Equal(100m, -source.Single(b => b.Classification!.Class == RestrictionClass.Restricted).NetDebit);
        Assert.Equal(200m, -source.Single(b => b.Classification!.Class == RestrictionClass.Unrestricted).NetDebit);
        var perClassRows = source.Select(b => new TrialBalanceRow(b.AccountCode, "捐赠收入", true, 0, 0,
            Math.Max(b.NetDebit, 0), Math.Max(-b.NetDebit, 0), Math.Max(b.NetDebit, 0), Math.Max(-b.NetDebit, 0))).ToArray();
        Assert.Throws<ArgumentException>(() => ReportBuilder.TrialBalance(Metadata(), perClassRows));
        // Aggregating first is a legitimate GL total, but loses the 100/200 split; no nonprofit statement API exists here.
        var glRows = second.ProjectedState.Balances.GroupBy(b => b.AccountCode).Select(group =>
        {
            var net = group.Sum(b => b.NetDebit);
            return new TrialBalanceRow(group.Key, group.Key + "（总账）", true, 0, 0,
                Math.Max(net, 0), Math.Max(-net, 0), Math.Max(net, 0), Math.Max(-net, 0));
        }).ToArray();
        var gl = ReportBuilder.TrialBalance(Metadata(), glRows);
        Assert.Equal(300m, gl.Rows.Single(r => r.AccountCode == "4101").Cells[9].Amount);
        Assert.Equal(300m, gl.Total.Cells[8].Amount); Assert.Equal(300m, gl.Total.Cells[9].Amount);
        Assert.Equal("科目余额表", gl.Title);
        Assert.Contains("未经法定财报项目映射", gl.Note);
    }

    [Fact]
    public void AllocationBoundary_NewPaymentAndReclassifyingAnExistingCostAreDifferentOperations()
    {
        var initial = State(new("1002", null, 1000m), new("3102", R, -600m), new("3101", U, -400m));
        var paid = service.SuggestExpense(initial, new(Guid.NewGuid(), 0, To, "5301", 100m, U, "synthetic-invoice-already-paid"));
        var source = paid.ProjectedState;
        var allocation = new AllocationRequest("synthetic-existing-invoice-allocation", Guid.NewGuid(), 100m, true, "synthetic-reviewed-50-50-basis",
            [new("r", Guid.NewGuid(), "5101", R, 1), new("u", Guid.NewGuid(), "5301", U, 1)]);
        var payment = service.SuggestAllocatedExpense(source, Guid.NewGuid(), source.Revision, To, allocation, "synthetic-invoice-already-paid");
        Assert.Equal(800m, Balance(payment.ProjectedState, "1002"));
        Assert.Equal(200m, Balance(payment.ProjectedState, "5101") + Balance(payment.ProjectedState, "5301"));
        // This API deliberately suggests another payment. Reusing an evidence reference is not idempotency.
        var calculation = service.ComputeAllocation(source, allocation);
        var lines = calculation.Shares.Select(s => new LineSuggestion(s.VoucherLineId, s.AccountCode, s.Amount, 0, s.Classification, "synthetic-approved-reclassification"))
            .Append(new(Guid.NewGuid(), "5301", 0, 100m, U, "reverse the already recognized common cost")).ToArray();
        var request = new ProposalRequest(Guid.NewGuid(), source.Revision,
            new(allocation.VoucherId, To, SuggestionKind.Activity, true, lines), [allocation], null, new("synthetic-explicit-reclass-review", true));
        var reclassification = service.Propose(source, request);
        Assert.Equal(900m, Balance(reclassification.ProjectedState, "1002"));
        Assert.Equal(100m, Balance(reclassification.ProjectedState, "5101") + Balance(reclassification.ProjectedState, "5301"));
        Assert.Equal(50m, Balance(reclassification.ProjectedState, "5101"));
        Assert.Equal(50m, Balance(reclassification.ProjectedState, "5301"));
        Assert.DoesNotContain(Assert.Single(reclassification.Vouchers).Lines, l => l.AccountCode == "1002");
        Assert.Equal(900m, Balance(source, "1002"));
        Assert.Equal(SuggestionStatus.PendingReview, reclassification.Status);
    }

    private static ReportMetadata Metadata() => new(new(Guid.NewGuid(), "合成民非复核", AccountingRegime.Nonprofit,
        "nonprofit-2026-independent-review", 2026, 1, 0, DateTimeOffset.UnixEpoch), From, To, new DateTimeOffset(2026, 10, 25, 8, 0, 0, TimeSpan.Zero));
}
