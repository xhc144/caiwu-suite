using System.Text.Json;
using Caiwu.Nonprofit;

namespace Caiwu.Nonprofit.Tests;

public sealed class AmountBoundaryTests
{
    private const decimal Max = 92233720368547758.07m;
    private static readonly Classification U = ScenarioFixture.Unrestricted();
    private readonly NonprofitPlanningService service = new();
    private static Guid Id(string value) => ScenarioFixture.Id("amount-boundary:" + value);
    private PlanningState State(params ClassifiedBalance[] balances) => service.CreateState(
        Id("book"), ScenarioFixture.Start, ScenarioFixture.End, [], balances, 73);

    private static ClassifiedBalance[] LargeOpening() =>
        [new("1002", null, Max), new("3101", U, -Max), new("1009", null, Max), new("2202", null, -Max)];

    private static IEnumerable<ClassifiedBalance[]> Permutations(ClassifiedBalance[] values) =>
        values.Length == 0 ? [Array.Empty<ClassifiedBalance>()] : values.SelectMany((value, index) =>
            Permutations(values.Where((_, i) => i != index).ToArray()).Select(tail => new[] { value }.Concat(tail).ToArray()));

    [Fact]
    public void Balanced_opening_with_large_unsigned_subtotals_is_accepted_in_all_24_orders()
    {
        var orders = Permutations(LargeOpening()).ToArray();
        Assert.Equal(24, orders.Length);
        foreach (var balances in orders)
        {
            var state = State(balances);
            Assert.Equal(4, state.Balances.Count);
            Assert.Equal(0m, state.Balances.Sum(b => b.NetDebit));
            Assert.All(state.Balances, b => Assert.InRange(b.NetDebit, -Max, Max));
        }
    }

    [Fact]
    public void One_cent_expense_and_next_closing_remain_usable_from_all_24_opening_orders()
    {
        foreach (var balances in Permutations(LargeOpening()))
        {
            var initial = State(balances);
            var original = JsonSerializer.Serialize(initial);
            var expense = service.SuggestExpense(initial, new(Id("expense"), 0, ScenarioFixture.End,
                "5301", 0.01m, U, "synthetic-one-cent-expense"));
            var closing = service.SuggestClosing(expense.ProjectedState,
                new(Id("close"), expense.ProjectedState.Revision, ScenarioFixture.End));

            Assert.Equal(Max - 0.01m, ScenarioFixture.Balance(closing.ProjectedState, "1002"));
            Assert.Equal(-Max + 0.01m, ScenarioFixture.Balance(closing.ProjectedState, "3101"));
            Assert.Equal(Max, ScenarioFixture.Balance(closing.ProjectedState, "1009"));
            Assert.Equal(-Max, ScenarioFixture.Balance(closing.ProjectedState, "2202"));
            Assert.Equal(0m, ScenarioFixture.Balance(closing.ProjectedState, "5301"));
            Assert.Equal(PlanningPhase.ClassifiedClosingComputed, closing.ProjectedState.Phase);
            foreach (var proposal in new[] { expense, closing })
            {
                Assert.Equal(SuggestionStatus.PendingReview, proposal.Status);
                Assert.Equal(73L, proposal.BasedOnLedgerRevision);
                Assert.Equal(0m, proposal.ProjectedState.Balances.Sum(b => b.NetDebit));
                Assert.Equal(0m, proposal.Changes.Sum(c => c.Change));
                Assert.All(proposal.ProjectedState.Balances, b => Assert.InRange(b.NetDebit, -Max, Max));
                Assert.All(proposal.Vouchers, v => Assert.Equal(v.Lines.Sum(l => l.Debit), v.Lines.Sum(l => l.Credit)));
                // A separate public entry validates the entire returned state, including its sorted balances and receipt.
                Assert.Equal(0.01m, service.ComputeAllocation(proposal.ProjectedState, new("state-recheck", Id("recheck"),
                    0.01m, true, "synthetic-approved-basis", [new("one", Id("one"), "5301", U, 1)])).Total);
            }
            Assert.Equal(original, JsonSerializer.Serialize(initial));
        }
    }

    [Fact]
    public void Unbalanced_opening_is_rejected_for_imbalance_in_all_24_orders()
    {
        var balances = LargeOpening();
        balances[3] = balances[3] with { NetDebit = -Max + 0.01m };
        foreach (var order in Permutations(balances))
            Assert.Equal("NP_UNBALANCED", Assert.Throws<NonprofitValidationException>(() => State(order)).Code);
    }

    [Theory]
    [InlineData("92233720368547758.08")]
    [InlineData("-92233720368547758.08")]
    public void Individually_out_of_range_balances_remain_rejected_even_when_the_final_sum_is_zero(string text)
    {
        var value = decimal.Parse(text, System.Globalization.CultureInfo.InvariantCulture);
        ClassifiedBalance[] balances = [new("1002", null, value), new("2202", null, -value)];
        foreach (var order in Permutations(balances))
            Assert.Equal("NP_TOTAL_OVERFLOW", Assert.Throws<NonprofitValidationException>(() => State(order)).Code);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void A_vouchers_balanced_same_bucket_lines_are_order_independent_at_either_signed_boundary(bool negative)
    {
        var value = negative ? -Max : Max;
        var initial = State(new("1002", null, value), new("2202", null, -value));
        LineSuggestion[] lines = [new(Id("debit"), "1002", 0.01m, 0, null, "synthetic same-bucket debit"),
            new(Id("credit"), "1002", 0, 0.01m, null, "synthetic same-bucket credit")];
        foreach (var order in new[] { lines, lines.Reverse().ToArray() })
        {
            var proposal = Propose(initial, order);
            Assert.Empty(proposal.Changes);
            Assert.Equal(value, ScenarioFixture.Balance(proposal.ProjectedState, "1002"));
            Assert.Equal(0m, proposal.ProjectedState.Balances.Sum(b => b.NetDebit));
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void A_real_one_cent_balance_overflow_remains_rejected_and_does_not_mutate_input(bool donation)
    {
        var initial = donation
            ? State(new("1002", null, Max), new("3101", U, -Max))
            : State(new("1002", null, -Max), new("2202", null, Max));
        var original = JsonSerializer.Serialize(initial);
        var error = Assert.Throws<NonprofitValidationException>(() => donation
            ? service.SuggestDonation(initial, new(Id("overflow-gift"), 0, ScenarioFixture.End, 0.01m, U,
                DonationKind.Cash, "synthetic-donation", true))
            : service.SuggestExpense(initial, new(Id("overflow-expense"), 0, ScenarioFixture.End,
                "5301", 0.01m, U, "synthetic-expense")));
        Assert.Equal("NP_TOTAL_OVERFLOW", error.Code);
        Assert.Equal(original, JsonSerializer.Serialize(initial));
    }

    [Fact]
    public void Closing_that_would_exceed_a_net_asset_balance_limit_remains_rejected()
    {
        var initial = State(new("1002", null, 0.01m), new("2202", null, -0.01m),
            new("1009", null, -Max), new("3101", U, Max));
        var expense = service.SuggestExpense(initial, new(Id("overflow-close-expense"), 0, ScenarioFixture.End,
            "5301", 0.01m, U, "synthetic-expense"));
        var original = JsonSerializer.Serialize(expense.ProjectedState);
        Assert.Equal("NP_TOTAL_OVERFLOW", Assert.Throws<NonprofitValidationException>(() => service.SuggestClosing(
            expense.ProjectedState, new(Id("overflow-close"), expense.ProjectedState.Revision, ScenarioFixture.End))).Code);
        Assert.Equal(original, JsonSerializer.Serialize(expense.ProjectedState));
    }

    [Fact]
    public void Voucher_side_totals_still_have_a_limit_even_when_each_line_and_the_final_balances_fit()
    {
        var lines = new[] {
            new LineSuggestion(Id("large-debit"), "1002", Max, 0, null, "synthetic"),
            new LineSuggestion(Id("small-debit"), "1009", 0.01m, 0, null, "synthetic"),
            new LineSuggestion(Id("large-credit"), "2202", 0, Max, null, "synthetic"),
            new LineSuggestion(Id("small-credit"), "2201", 0, 0.01m, null, "synthetic") };
        foreach (var order in new[] { lines, lines.Reverse().ToArray() })
            Assert.Equal("NP_TOTAL_OVERFLOW", Assert.Throws<NonprofitValidationException>(() => Propose(State(), order)).Code);
    }

    [Fact]
    public void Exact_maximum_allocation_payment_and_classified_closing_conserve_every_cent()
    {
        var initial = State(new("1002", null, Max), new("3101", U, -Max));
        var allocation = new AllocationRequest("maximum-cost", Id("allocated"), Max, true, "synthetic-equal-benefit",
            [new("a", Id("allocation-a"), "5101", U, long.MaxValue), new("b", Id("allocation-b"), "5301", U, long.MaxValue)]);
        var expense = service.SuggestAllocatedExpense(initial, Id("maximum-expense"), 0, ScenarioFixture.End,
            allocation, "synthetic-maximum-invoice");
        var calculation = Assert.Single(expense.Allocations);
        Assert.Equal(46116860184273879.04m, Assert.Single(calculation.Shares, s => s.Id == "a").Amount);
        Assert.Equal(46116860184273879.03m, Assert.Single(calculation.Shares, s => s.Id == "b").Amount);
        Assert.Equal(Max, Assert.Single(expense.Vouchers).Lines.Sum(l => l.Debit));
        var closing = service.SuggestClosing(expense.ProjectedState,
            new(Id("maximum-close"), expense.ProjectedState.Revision, ScenarioFixture.End));
        Assert.All(closing.ProjectedState.Balances, b => Assert.Equal(0m, b.NetDebit));
    }

    private NonprofitProposal Propose(PlanningState state, IReadOnlyList<LineSuggestion> lines) => service.Propose(state,
        new(Id("draft-request"), state.Revision, new(Id("draft-voucher"), ScenarioFixture.End, SuggestionKind.Activity,
            false, lines), [], null, new("synthetic-reviewed-activity", true)));
}
