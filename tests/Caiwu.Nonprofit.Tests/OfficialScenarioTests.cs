using System.Globalization;
using System.Text.Json;
using Caiwu.Nonprofit;

namespace Caiwu.Nonprofit.Tests;

/// <summary>
/// Runs the 27 fixed, hand-expected examples through the actual .NET service.
/// The fixture is an independent acceptance source, not a generated service result.
/// </summary>
public sealed class OfficialScenarioTests
{
    public static IEnumerable<object[]> CaseIds() => ScenarioFixture.Cases().Select(c => new object[] { ScenarioFixture.Text(c, "id") });

    [Theory]
    [MemberData(nameof(CaseIds))]
    public void Actual_service_matches_independent_official_scenario_expectations(string caseId)
    {
        var fixture = ScenarioFixture.Find(caseId);
        var expected = fixture.GetProperty("expected");
        var errorCode = ScenarioFixture.OptionalText(expected, "errorCode");
        var service = new NonprofitPlanningService();
        var proposals = new List<NonprofitProposal>();
        var calculations = new List<AllocationCalculation>();
        PlanningState? final = null;
        try
        {
            var state = ScenarioFixture.CreateState(service, fixture);
            if (ScenarioFixture.Text(fixture, "kind") == "Allocation")
            {
                foreach (var a in fixture.GetProperty("allocations").EnumerateArray())
                {
                    var before = JsonSerializer.Serialize(state);
                    calculations.Add(service.ComputeAllocation(state, ScenarioFixture.Allocation(fixture, a)));
                    Assert.Equal(before, JsonSerializer.Serialize(state));
                }
            }
            else
            {
                var vouchers = fixture.GetProperty("vouchers").EnumerateArray().ToArray();
                var offset = vouchers.Length > 0 && ScenarioFixture.Text(vouchers[0], "kind") == "Opening" ? 1 : 0;
                foreach (var v in vouchers.Skip(offset))
                {
                    var request = ScenarioFixture.Request(fixture, v, state);
                    var before = JsonSerializer.Serialize(state);
                    var proposal = service.Propose(state, request);
                    Assert.Equal(before, JsonSerializer.Serialize(state));
                    Assert.Equal(SuggestionStatus.PendingReview, proposal.Status);
                    Assert.All(proposal.Vouchers, voucher => Assert.Equal(SuggestionStatus.PendingReview, voucher.Status));
                    Assert.Equal(state.Revision, proposal.BasedOnPlanningRevision);
                    Assert.Equal(71, proposal.BasedOnLedgerRevision);
                    Assert.Equal(state.Rules, proposal.Rules);
                    Assert.Equal(state.Revision + 1, proposal.ProjectedState.Revision);
                    Assert.Equal(71, proposal.ProjectedState.SourceLedgerRevision);
                    proposals.Add(proposal);
                    calculations.AddRange(proposal.Allocations);
                    state = proposal.ProjectedState;
                }
                final = state;
            }
        }
        catch (NonprofitValidationException error)
        {
            Assert.NotNull(errorCode);
            Assert.Equal(errorCode, error.Code);
            return;
        }

        Assert.Null(errorCode);
        var expectedResult = expected.GetProperty("result");
        AssertAllocations(expectedResult.GetProperty("allocations"), calculations);
        if (final is not null)
        {
            var actual = Metrics(final, proposals);
            var expectedMetrics = expectedResult.GetProperty("metrics");
            Assert.Equal(expectedMetrics.EnumerateObject().Count(), actual.Count);
            foreach (var metric in expectedMetrics.EnumerateObject())
                Assert.Equal(decimal.Parse(metric.Value.GetString()!, CultureInfo.InvariantCulture), actual[metric.Name]);
            Assert.True(expectedResult.GetProperty("incomeExpenseClosingZero").GetBoolean());
            var categories = ScenarioFixture.Categories();
            Assert.All(final.Balances.Where(b => categories[b.AccountCode] is "Income" or "Expense"), b => Assert.Equal(0m, b.NetDebit));
        }
    }

    private static void AssertAllocations(JsonElement expected, List<AllocationCalculation> actual)
    {
        Assert.Equal(expected.EnumerateObject().Count(), actual.Count);
        foreach (var allocation in expected.EnumerateObject())
        {
            var calculation = Assert.Single(actual, a => a.Id == allocation.Name);
            Assert.Equal("LargestRemainderThenRowId", calculation.RoundingPolicy);
            Assert.Equal(allocation.Value.EnumerateObject().Count(), calculation.Shares.Count);
            Assert.Equal(calculation.Total, calculation.Shares.Sum(s => s.Amount));
            foreach (var row in allocation.Value.EnumerateObject())
                Assert.Equal(decimal.Parse(row.Value.GetString()!, CultureInfo.InvariantCulture), Assert.Single(calculation.Shares, s => s.Id == row.Name).Amount);
        }
    }

    private static Dictionary<string, decimal> Metrics(PlanningState final, List<NonprofitProposal> proposals)
    {
        var categories = ScenarioFixture.Categories();
        var metrics = new Dictionary<string, decimal>
        {
            ["incomeUnrestricted"] = 0m, ["incomeRestricted"] = 0m,
            ["expenseUnrestricted"] = 0m, ["expenseRestricted"] = 0m,
            ["cashChange"] = 0m, ["releasedToUnrestricted"] = 0m, ["releasedFromRestricted"] = 0m,
            ["assets"] = final.Balances.Where(b => categories[b.AccountCode] == "Asset").Sum(b => b.NetDebit),
            ["liabilities"] = -final.Balances.Where(b => categories[b.AccountCode] == "Liability").Sum(b => b.NetDebit),
            ["unrestrictedNetAssets"] = -ScenarioFixture.Balance(final, "3101"),
            ["restrictedNetAssets"] = -ScenarioFixture.Balance(final, "3102")
        };
        metrics["totalNetAssets"] = metrics["unrestrictedNetAssets"] + metrics["restrictedNetAssets"];
        foreach (var voucher in proposals.SelectMany(p => p.Vouchers))
        {
            metrics["cashChange"] += voucher.Lines.Where(l => l.AccountCode is "1001" or "1002" or "1009").Sum(l => l.Debit - l.Credit);
            foreach (var line in voucher.Lines)
            {
                if (voucher.Kind == SuggestionKind.Activity && categories[line.AccountCode] is "Income" or "Expense")
                {
                    var income = categories[line.AccountCode] == "Income";
                    metrics[(income ? "income" : "expense") + line.Classification!.Class] += income ? line.Credit - line.Debit : line.Debit - line.Credit;
                }
                if (voucher.Kind == SuggestionKind.Release && line.AccountCode == "3101")
                    metrics["releasedToUnrestricted"] += line.Credit - line.Debit;
                if (voucher.Kind == SuggestionKind.Release && line.AccountCode == "3102")
                    metrics["releasedFromRestricted"] += line.Credit - line.Debit;
            }
        }
        Assert.Equal(metrics["assets"], metrics["liabilities"] + metrics["totalNetAssets"]);
        return metrics;
    }
}
