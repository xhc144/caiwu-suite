using System.Text.Json;
using Caiwu.Nonprofit;

namespace Caiwu.Nonprofit.Tests;

public sealed class PlanningServiceTests
{
    private readonly NonprofitPlanningService service = new();
    private static readonly Classification U = ScenarioFixture.Unrestricted();
    private static readonly Classification A = ScenarioFixture.Restricted("grant-A");
    private static readonly Classification B = ScenarioFixture.Restricted("grant-B");
    private static DateOnly Date => ScenarioFixture.End;
    private static Guid Id(string value) => ScenarioFixture.Id("service-test:" + value);

    private PlanningState State(IReadOnlyList<ClassifiedBalance>? opening = null, IReadOnlyList<RestrictionEvidence>? restrictions = null) => service.CreateState(
        Id("book"), ScenarioFixture.Start, Date, restrictions ?? [ScenarioFixture.Evidence("grant-A"), ScenarioFixture.Evidence("grant-B")], opening ?? [], 29);

    private static DonationRequest Gift(string id, long revision = 0, decimal amount = 1000m, Classification? classification = null) => new(
        Id(id), revision, Date, amount, classification ?? A, DonationKind.Cash, "synthetic-donation-recognition", true);

    private static ProposalRequest Draft(PlanningState state, string id, params LineSuggestion[] lines) => new(
        Id(id), state.Revision, new(Id(id + ":voucher"), Date, SuggestionKind.Activity, false, lines), [], null,
        new("synthetic-recognition", true));

    private static LineSuggestion Line(string id, string code, decimal debit, decimal credit, Classification? classification = null) => new(
        Id(id), code, debit, credit, classification, "Synthetic test line");

    [Fact]
    public void Cash_donation_expense_and_generated_closing_use_both_classified_net_assets()
    {
        var initial = State();
        var gift = service.SuggestDonation(initial, Gift("restricted-gift"));
        var expense = service.SuggestExpense(gift.ProjectedState,
            new(Id("restricted-cost"), gift.ProjectedState.Revision, Date, "5101", 200m, A, "synthetic-spending-evidence"));
        var closing = service.SuggestClosing(expense.ProjectedState, new(Id("close-restricted"), expense.ProjectedState.Revision, Date));

        Assert.Equal(800m, ScenarioFixture.Balance(closing.ProjectedState, "1002"));
        Assert.Equal(-800m, ScenarioFixture.Balance(closing.ProjectedState, "3102", RestrictionClass.Restricted));
        Assert.Equal(0m, ScenarioFixture.Balance(closing.ProjectedState, "3101"));
        Assert.Equal(0m, ScenarioFixture.Balance(closing.ProjectedState, "4101"));
        Assert.Equal(0m, ScenarioFixture.Balance(closing.ProjectedState, "5101"));
        Assert.Equal(PlanningPhase.ClassifiedClosingComputed, closing.ProjectedState.Phase);
        Assert.All(closing.Vouchers, v => Assert.Equal(SuggestionKind.Closing, v.Kind));
        Assert.All(closing.Vouchers.SelectMany(v => v.Lines).Where(l => l.AccountCode == "3102"), l => Assert.Equal(A, l.Classification));
        Assert.Equal(0, initial.Revision);
        Assert.Empty(initial.Balances);
        Assert.Equal(29L, closing.BasedOnLedgerRevision);
    }

    [Fact]
    public void Reliable_service_donation_generates_equal_noncash_income_and_expense()
    {
        var initial = State();
        var proposal = service.SuggestDonation(initial,
            new(Id("service-donation"), 0, Date, 1000m, U, DonationKind.Service, "synthetic-service-invoice", true, true));
        var voucher = Assert.Single(proposal.Vouchers);
        Assert.True(voucher.IsNoncash);
        Assert.Equal(1000m, Assert.Single(voucher.Lines, l => l.AccountCode == "4101").Credit);
        Assert.Equal(1000m, Assert.Single(voucher.Lines, l => l.AccountCode == "5101").Debit);
        Assert.DoesNotContain(voucher.Lines, l => l.AccountCode is "1001" or "1002" or "1009");
        Assert.Equal(new ActivityAssessment("synthetic-service-invoice", true, true), proposal.Evidence.Activity);
        Assert.Null(proposal.Evidence.Release);
        Assert.Contains("synthetic-service-invoice", proposal.Evidence.EvidenceReferences);
        Assert.Contains("synthetic-service-invoice", JsonSerializer.Serialize(proposal));
        var closing = service.SuggestClosing(proposal.ProjectedState, new(Id("close-service"), proposal.ProjectedState.Revision, Date));
        Assert.Equal(0m, ScenarioFixture.Balance(closing.ProjectedState, "3101"));
        Assert.All(closing.ProjectedState.Balances, b => Assert.Equal(0m, b.NetDebit));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(null)]
    public void Unreliable_or_unassessed_service_measurement_is_rejected(bool? reliable)
    {
        Assert.Throws<NonprofitValidationException>(() => service.SuggestDonation(State(),
            new(Id("unreliable-service"), 0, Date, 1000m, U, DonationKind.Service, "synthetic-unreliable-invoice", true, reliable)));
    }

    [Fact]
    public void Donation_recognition_and_evidence_are_explicit_inputs()
    {
        Assert.Throws<NonprofitValidationException>(() => service.SuggestDonation(State(), Gift("unconfirmed") with { RecognitionConfirmed = false }));
        Assert.Throws<NonprofitValidationException>(() => service.SuggestDonation(State(), Gift("no-evidence") with { EvidenceReference = " " }));
    }

    [Fact]
    public void Generated_release_uses_only_fully_released_grant_A_and_never_creates_cash_or_income()
    {
        var initial = State([new("1002", null, 1000m), new("3102", A, -300m), new("3102", B, -700m)]);
        var assessment = new ReleaseAssessment("grant-A", 1, true, true, false, "synthetic-full-release-A-unique-readable-evidence");
        var proposal = service.SuggestRelease(initial, new(Id("release-A"), 0, Date, 300m,
            assessment));
        var voucher = Assert.Single(proposal.Vouchers);
        Assert.Equal(SuggestionKind.Release, voucher.Kind);
        Assert.True(voucher.IsNoncash);
        Assert.Equal(2, voucher.Lines.Count);
        Assert.Equal(300m, Assert.Single(voucher.Lines, l => l.AccountCode == "3102").Debit);
        Assert.Equal(300m, Assert.Single(voucher.Lines, l => l.AccountCode == "3101").Credit);
        Assert.Equal(1000m, ScenarioFixture.Balance(proposal.ProjectedState, "1002"));
        Assert.Equal(-300m, ScenarioFixture.Balance(proposal.ProjectedState, "3101"));
        Assert.Equal(-700m, ScenarioFixture.Balance(proposal.ProjectedState, "3102"));
        Assert.Equal(0m, proposal.ProjectedState.Balances.Where(b => b.AccountCode == "3102" && b.Classification?.RestrictionId == "grant-A").Sum(b => b.NetDebit));
        Assert.Equal(assessment, proposal.Evidence.Release);
        Assert.Null(proposal.Evidence.Activity);
        Assert.Contains(assessment.EvidenceReference, proposal.Evidence.EvidenceReferences);
        Assert.Contains(assessment.EvidenceReference, JsonSerializer.Serialize(proposal));
    }

    [Fact]
    public void Expired_time_does_not_remove_surviving_purpose_and_partial_release_needs_separate_scope()
    {
        var state = State([new("1002", null, 300m), new("3102", A, -300m)]);
        Assert.Equal("NP_RESTRICTION_NOT_FULLY_RELEASED", Assert.Throws<NonprofitValidationException>(() => service.SuggestRelease(state,
            new(Id("release-time-only"), 0, Date, 300m, new("grant-A", 1, true, false, false, "synthetic-time-expiry")))).Code);
        Assert.Equal("NP_RELEASE_AMOUNT_SCOPE", Assert.Throws<NonprofitValidationException>(() => service.SuggestRelease(state,
            new(Id("release-partial"), 0, Date, 200m, new("grant-A", 1, true, true, false, "synthetic-release")))).Code);
    }

    [Fact]
    public void Provider_revocation_can_release_without_waiting_for_original_time_and_purpose()
    {
        var state = State([new("1002", null, 300m), new("3102", A, -300m)]);
        var result = service.SuggestRelease(state, new(Id("provider-revoked"), 0, Date, 300m,
            new("grant-A", 1, false, false, true, "synthetic-provider-written-revocation")));
        Assert.Equal(-300m, ScenarioFixture.Balance(result.ProjectedState, "3101"));
        Assert.Equal(0m, ScenarioFixture.Balance(result.ProjectedState, "3102"));
    }

    [Fact]
    public void Allocated_expense_generates_the_approved_function_and_class_bridge()
    {
        var state = State([new("1002", null, 2000m), new("3102", A, -1200m), new("3101", U, -800m)]);
        var allocation = new AllocationRequest("common-cost", Id("common-cost-voucher"), 1000m, true, "synthetic-approved-hours-3-to-2",
            [new("r", Id("allocation-r"), "5101", A, 3, 600m), new("u", Id("allocation-u"), "5301", U, 2, 400m)]);
        var proposal = service.SuggestAllocatedExpense(state, Id("allocated-expense"), 0, Date, allocation, "synthetic-common-cost-invoice");
        var voucher = Assert.Single(proposal.Vouchers);
        Assert.Equal(600m, Assert.Single(voucher.Lines, l => l.AccountCode == "5101").Debit);
        Assert.Equal(A, Assert.Single(voucher.Lines, l => l.AccountCode == "5101").Classification);
        Assert.Equal(400m, Assert.Single(voucher.Lines, l => l.AccountCode == "5301").Debit);
        Assert.Equal(U, Assert.Single(voucher.Lines, l => l.AccountCode == "5301").Classification);
        Assert.Equal(1000m, Assert.Single(voucher.Lines, l => l.AccountCode == "1002").Credit);
        Assert.Single(proposal.Allocations);
        var closing = service.SuggestClosing(proposal.ProjectedState, new(Id("allocated-close"), proposal.ProjectedState.Revision, Date));
        Assert.Equal(-600m, ScenarioFixture.Balance(closing.ProjectedState, "3102"));
        Assert.Equal(-400m, ScenarioFixture.Balance(closing.ProjectedState, "3101"));
        Assert.Equal(1000m, ScenarioFixture.Balance(closing.ProjectedState, "1002"));
    }

    [Fact]
    public void Largest_remainder_ties_use_stable_share_ID_and_preserve_cents_after_reordering()
    {
        var state = State();
        AllocationShare[] shares = [new("c", Id("cent-c"), "5301", U, 1), new("b", Id("cent-b"), "5301", U, 1), new("a", Id("cent-a"), "5301", U, 1)];
        var request = new AllocationRequest("cents", Id("cent-voucher"), 1.01m, true, "synthetic-equal-benefit", shares);
        var result = service.ComputeAllocation(state, request);
        var reordered = service.ComputeAllocation(state, request with { Shares = shares.Reverse().ToArray() });
        Assert.Equal(0.34m, Assert.Single(result.Shares, s => s.Id == "a").Amount);
        Assert.Equal(0.34m, Assert.Single(result.Shares, s => s.Id == "b").Amount);
        Assert.Equal(0.33m, Assert.Single(result.Shares, s => s.Id == "c").Amount);
        Assert.Equal(1.01m, result.Shares.Sum(s => s.Amount));
        foreach (var row in result.Shares)
        {
            Assert.Equal(row.Amount, Assert.Single(reordered.Shares, s => s.Id == row.Id).Amount);
            Assert.Equal(shares.Single(s => s.Id == row.Id).VoucherLineId, row.VoucherLineId);
        }
    }

    [Fact]
    public void Allocation_large_weights_do_not_overflow_intermediate_products()
    {
        var result = service.ComputeAllocation(State(), new("large-weights", Id("large-weights"), 1000m, true, "synthetic-equal-benefit",
            [new("a", Id("large-a"), "5301", U, long.MaxValue), new("b", Id("large-b"), "5301", U, long.MaxValue)]));
        Assert.All(result.Shares, s => Assert.Equal(500m, s.Amount));
    }

    [Fact]
    public void Decimal_point_one_plus_point_two_is_exact_and_no_income_or_expense_bucket_is_lost()
    {
        var first = service.SuggestDonation(State(), Gift("point-one", amount: 0.1m, classification: U));
        var second = service.SuggestDonation(first.ProjectedState, Gift("point-two", first.ProjectedState.Revision, 0.2m, U));
        Assert.Equal(0.30m, ScenarioFixture.Balance(second.ProjectedState, "1002"));
        var closing = service.SuggestClosing(second.ProjectedState, new(Id("decimal-close"), second.ProjectedState.Revision, Date));
        Assert.Equal(-0.30m, ScenarioFixture.Balance(closing.ProjectedState, "3101"));
    }

    [Theory]
    [InlineData("0.001")]
    [InlineData("-1.00")]
    [InlineData("0.00")]
    [InlineData("92233720368547758.08")]
    public void Invalid_amounts_are_rejected_without_rounding_or_overflow(string amount)
    {
        var value = decimal.Parse(amount, System.Globalization.CultureInfo.InvariantCulture);
        var initial = State();
        var before = JsonSerializer.Serialize(initial);
        Assert.Throws<NonprofitValidationException>(() => service.SuggestDonation(initial, Gift("invalid-amount", amount: value)));
        Assert.Equal(before, JsonSerializer.Serialize(initial));
    }

    [Fact]
    public void Same_original_input_is_deterministic_but_replayed_request_on_projection_is_explicitly_refused()
    {
        var state = State();
        var request = Gift("stable-request");
        var one = service.SuggestDonation(state, request);
        var two = service.SuggestDonation(state, request);
        Assert.Equal(one.Vouchers.Select(v => v.Id), two.Vouchers.Select(v => v.Id));
        Assert.Equal(one.Vouchers.SelectMany(v => v.Lines).Select(l => l.Id), two.Vouchers.SelectMany(v => v.Lines).Select(l => l.Id));
        Assert.Equal(JsonSerializer.Serialize(one), JsonSerializer.Serialize(two));
        Assert.Equal("NP_DUPLICATE_REQUEST", Assert.Throws<NonprofitValidationException>(() => service.SuggestDonation(one.ProjectedState, request)).Code);
        Assert.Equal("NP_REQUEST_ID_CONFLICT", Assert.Throws<NonprofitValidationException>(() => service.SuggestDonation(one.ProjectedState, request with { Amount = 999m })).Code);
        Assert.Single(one.ProjectedState.Receipts);
    }

    [Fact]
    public void Stale_revision_locked_period_other_month_and_wrong_rule_binding_are_blocked()
    {
        var state = State();
        var first = service.SuggestDonation(state, Gift("first-revision"));
        Assert.Equal("NP_REVISION_CONFLICT", Assert.Throws<NonprofitValidationException>(() => service.SuggestDonation(first.ProjectedState, Gift("stale-revision"))).Code);
        Assert.Equal("NP_PERIOD_LOCKED", Assert.Throws<NonprofitValidationException>(() => service.SuggestDonation(state with { IsPeriodLocked = true }, Gift("locked"))).Code);
        Assert.Equal("NP_PERIOD_MISMATCH", Assert.Throws<NonprofitValidationException>(() => service.SuggestDonation(state, Gift("july") with { Date = new DateOnly(2026, 7, 1) })).Code);
        Assert.Equal("NP_PERIOD_UNSUPPORTED", Assert.Throws<NonprofitValidationException>(() => service.SuggestDonation(state, Gift("old-year") with { Date = new DateOnly(2025, 12, 31) })).Code);
        var invalid = state with { Rules = state.Rules with { Sha256 = new string('0', 64) } };
        Assert.Equal("NP_RULE_BINDING", Assert.Throws<NonprofitValidationException>(() => service.SuggestDonation(invalid, Gift("wrong-rules"))).Code);
    }

    [Fact]
    public void Planning_never_mutates_inputs_and_every_suggestion_remains_pending_human_review()
    {
        var restrictions = new List<RestrictionEvidence> { ScenarioFixture.Evidence("grant-A") };
        var opening = new List<ClassifiedBalance>();
        var state = State(opening, restrictions);
        var request = Gift("immutability");
        var beforeState = JsonSerializer.Serialize(state);
        var beforeRequest = JsonSerializer.Serialize(request);
        var result = service.SuggestDonation(state, request);
        Assert.Equal(beforeState, JsonSerializer.Serialize(state));
        Assert.Equal(beforeRequest, JsonSerializer.Serialize(request));
        Assert.Empty(opening);
        Assert.Single(restrictions);
        Assert.Equal(SuggestionStatus.PendingReview, result.Status);
        Assert.All(result.Vouchers, v => Assert.Equal(SuggestionStatus.PendingReview, v.Status));
        Assert.False(NonprofitRules.Official2026.IsVerifiedForProduction);
        Assert.Equal(state.BookId, result.ProjectedState.BookId);
        Assert.Equal(state.SourceLedgerRevision, result.ProjectedState.SourceLedgerRevision);
        Assert.NotSame(state, result.ProjectedState);
    }

    [Fact]
    public void Restriction_version_project_and_external_evidence_are_validated_before_suggesting()
    {
        Assert.Equal("NP_INTERNAL_BUDGET", Assert.Throws<NonprofitValidationException>(() => State(restrictions: [ScenarioFixture.Evidence("grant-A", RestrictionSourceKind.InternalBudget)])).Code);
        Assert.Throws<NonprofitValidationException>(() => service.SuggestDonation(State(), Gift("unknown-grant", classification: ScenarioFixture.Restricted("missing"))));
        Assert.Throws<NonprofitValidationException>(() => service.SuggestDonation(State(), Gift("wrong-version", classification: A with { RestrictionVersion = 2 })));
        Assert.Throws<NonprofitValidationException>(() => service.SuggestDonation(State(), Gift("wrong-project", classification: A with { ProjectId = "project:grant-B" })));
        Assert.Throws<NonprofitValidationException>(() => State(restrictions: [ScenarioFixture.Evidence("grant-A") with { EvidenceReference = " " }]));
        Assert.Throws<NonprofitValidationException>(() => State(restrictions: [ScenarioFixture.Evidence("grant-A") with { Conditions = [] }]));
    }

    [Fact]
    public void Raw_balanced_draft_still_requires_classification_and_cannot_hide_reclassification()
    {
        var state = State([new("1002", null, 1000m), new("3102", A, -1000m)]);
        Assert.Equal("NP_CLASS_REQUIRED", Assert.Throws<NonprofitValidationException>(() => service.Propose(state,
            Draft(state, "missing-class", Line("bank", "1002", 100m, 0m), Line("income", "4101", 0m, 100m)))).Code);
        Assert.Equal("NP_NET_ASSET_OPERATION", Assert.Throws<NonprofitValidationException>(() => service.Propose(state,
            Draft(state, "hidden-release", Line("r", "3102", 100m, 0m, A), Line("u", "3101", 0m, 100m, U)))).Code);
        Assert.Throws<NonprofitValidationException>(() => service.Propose(state,
            Draft(state, "unbalanced", Line("bank2", "1002", 100m, 0m), Line("income2", "4101", 0m, 99.99m, U))));
    }

    [Fact]
    public void Income_tax_automation_stays_blocked_pending_specialist_review()
    {
        Assert.Equal("NP_MANUAL_TAX_REVIEW", Assert.Throws<NonprofitValidationException>(() => service.SuggestExpense(State(),
            new(Id("restricted-tax"), 0, Date, "5601", 100m, A, "synthetic-tax-review-needed"))).Code);
    }

    [Fact]
    public void New_activity_is_rejected_after_classified_closing_was_computed()
    {
        var gift = service.SuggestDonation(State(), Gift("closing-phase"));
        var closing = service.SuggestClosing(gift.ProjectedState, new(Id("phase-close"), gift.ProjectedState.Revision, Date));
        Assert.Equal(PlanningPhase.ClassifiedClosingComputed, closing.ProjectedState.Phase);
        Assert.Throws<NonprofitValidationException>(() => service.SuggestDonation(closing.ProjectedState, Gift("late-activity", closing.ProjectedState.Revision)));
        var release = service.SuggestRelease(closing.ProjectedState, new(Id("post-close-release"), closing.ProjectedState.Revision, Date, 1000m,
            new("grant-A", 1, true, true, false, "synthetic-post-close-full-release")));
        Assert.Equal(-1000m, ScenarioFixture.Balance(release.ProjectedState, "3101"));
    }

    [Fact]
    public void Partial_classified_closing_blocks_activity_until_remaining_buckets_are_closed()
    {
        var gift = service.SuggestDonation(State(), Gift("partial-close-gift", classification: U));
        var partialDraft = new VoucherSuggestion(Id("partial-close-voucher"), Date, SuggestionKind.Closing, true,
            [Line("partial-pl", "4101", 400m, 0m, U), Line("partial-net", "3101", 0m, 400m, U)]);
        var partial = service.Propose(gift.ProjectedState, new(Id("partial-close-request"), gift.ProjectedState.Revision,
            partialDraft, [], null, null));
        Assert.Equal(PlanningPhase.ClosingInProgress, partial.ProjectedState.Phase);
        Assert.Equal(-600m, ScenarioFixture.Balance(partial.ProjectedState, "4101"));
        Assert.Equal("NP_CLOSING_IN_PROGRESS", Assert.Throws<NonprofitValidationException>(() =>
            service.SuggestDonation(partial.ProjectedState, Gift("activity-after-partial-close", partial.ProjectedState.Revision))).Code);
        var completed = service.SuggestClosing(partial.ProjectedState, new(Id("complete-partial-close"), partial.ProjectedState.Revision, Date));
        Assert.Equal(PlanningPhase.ClassifiedClosingComputed, completed.ProjectedState.Phase);
        Assert.Equal(-1000m, ScenarioFixture.Balance(completed.ProjectedState, "3101"));
        Assert.Equal(0m, ScenarioFixture.Balance(completed.ProjectedState, "4101"));
    }

    [Fact]
    public void Provider_revocation_cannot_override_a_law_or_administrative_restriction()
    {
        var state = State([new("1002", null, 300m), new("3102", A, -300m)],
            [ScenarioFixture.Evidence("grant-A", RestrictionSourceKind.LawOrAdministrativeRegulation)]);
        var error = Assert.Throws<NonprofitValidationException>(() => service.SuggestRelease(state,
            new(Id("cannot-revoke-law"), 0, Date, 300m, new("grant-A", 1, false, false, true, "synthetic-provider-letter"))));
        Assert.Equal("NP_RELEASE_AUTHORITY", error.Code);
    }

    [Fact]
    public void Unsupported_prior_year_adjustment_cannot_be_hidden_in_the_opening_snapshot()
    {
        var error = Assert.Throws<NonprofitValidationException>(() => State([new("1002", null, 100m), new("3201", null, -100m)]));
        Assert.Equal("NP_UNSUPPORTED_PRIOR_ADJUSTMENT", error.Code);
    }

    [Fact]
    public void Exhausted_planning_revision_is_rejected_with_domain_error_before_incrementing()
    {
        var state = State() with { Revision = long.MaxValue };
        var error = Assert.Throws<NonprofitValidationException>(() => service.SuggestDonation(state,
            Gift("exhausted-planning-revision", long.MaxValue)));
        Assert.Equal("NP_REVISION_OVERFLOW", error.Code);
        Assert.Equal(long.MaxValue, state.Revision);
        Assert.Empty(state.Receipts);
    }

    [Fact]
    public void December_9999_month_end_and_suggestion_do_not_overflow_date_arithmetic()
    {
        var start = new DateOnly(9999, 12, 1);
        var end = new DateOnly(9999, 12, 31);
        var state = service.CreateState(Id("last-calendar-month"), start, end, [], []);
        var proposal = service.SuggestDonation(state, Gift("last-calendar-date", classification: U) with { Date = end });
        Assert.Equal(start, proposal.ProjectedState.PeriodStart);
        Assert.Equal(end, proposal.ProjectedState.PeriodEnd);
        Assert.Equal(end, Assert.Single(proposal.Vouchers).Date);
        Assert.Equal(1000m, ScenarioFixture.Balance(proposal.ProjectedState, "1002"));
        Assert.Equal(1L, proposal.ProjectedState.Revision);
    }

    [Fact]
    public void One_cent_allocation_keeps_zero_share_in_audit_and_omits_it_from_journal()
    {
        var state = State([new("1002", null, 0.01m), new("3101", U, -0.01m)]);
        var allocation = new AllocationRequest("tiny-cent", Id("tiny-cent-voucher"), 0.01m, true, "synthetic-tiny-cent-approved-basis",
            [new("b", Id("tiny-b"), "5301", U, 1), new("a", Id("tiny-a"), "5101", U, 1)]);
        var proposal = service.SuggestAllocatedExpense(state, Id("tiny-cent-request"), 0, Date, allocation, "synthetic-tiny-cent-cost-invoice");
        var audit = Assert.Single(proposal.Allocations);
        Assert.Equal(2, audit.Shares.Count);
        Assert.Equal(0.01m, Assert.Single(audit.Shares, s => s.Id == "a").Amount);
        Assert.Equal(0m, Assert.Single(audit.Shares, s => s.Id == "b").Amount);
        Assert.Equal(0L, Assert.Single(audit.Shares, s => s.Id == "b").FloorCents);
        Assert.False(Assert.Single(audit.Shares, s => s.Id == "b").ReceivedExtraCent);
        var voucher = Assert.Single(proposal.Vouchers);
        Assert.Equal(2, voucher.Lines.Count);
        Assert.Contains(voucher.Lines, l => l.Id == Id("tiny-a") && l.Debit == 0.01m);
        Assert.DoesNotContain(voucher.Lines, l => l.Id == Id("tiny-b"));
        Assert.All(voucher.Lines, l => Assert.True(l.Debit > 0m || l.Credit > 0m));
        Assert.Equal(0.01m, voucher.Lines.Sum(l => l.Debit));
        Assert.Equal(0.01m, voucher.Lines.Sum(l => l.Credit));
        Assert.Contains("synthetic-tiny-cent-approved-basis", proposal.Evidence.EvidenceReferences);
        Assert.Contains("synthetic-tiny-cent-cost-invoice", proposal.Evidence.EvidenceReferences);
        var zeroJournalLine = Line("tiny-b", "5301", 0m, 0m, U);
        var invalidDraft = voucher with { Lines = voucher.Lines.Append(zeroJournalLine).ToArray() };
        var invalid = new ProposalRequest(Id("tiny-zero-journal-request"), 0, invalidDraft, [allocation], null,
            new("synthetic-tiny-cent-cost-invoice", true));
        Assert.Equal("NP_ALLOCATION_POSTING", Assert.Throws<NonprofitValidationException>(() => service.Propose(state, invalid)).Code);
    }

    [Fact]
    public void Pure_allocation_allows_unbound_voucher_but_generated_expense_requires_a_bound_identity()
    {
        var state = State();
        var allocation = new AllocationRequest("unbound-calculation", Guid.Empty, 1m, true, "synthetic-unbound-approved-basis",
            [new("a", Id("unbound-a"), "5301", U, 1)]);
        var calculation = service.ComputeAllocation(state, allocation);
        Assert.Equal(Guid.Empty, calculation.VoucherId);
        Assert.Equal(1m, Assert.Single(calculation.Shares).Amount);
        var error = Assert.Throws<NonprofitValidationException>(() => service.SuggestAllocatedExpense(state,
            Id("unbound-expense"), 0, Date, allocation, "synthetic-unbound-cost-invoice"));
        Assert.Equal("NP_ALLOCATION_VOUCHER", error.Code);
    }

    [Theory]
    [InlineData(false, true, "NP_NONCASH_CLASSIFICATION")]
    [InlineData(true, false, "NP_SERVICE_MEASUREMENT_REVIEW")]
    [InlineData(true, null, "NP_SERVICE_MEASUREMENT_REVIEW")]
    [InlineData(true, true, null)]
    public void Raw_service_donation_requires_actual_noncash_classification_and_reliable_measurement(bool noncash, bool? reliable, string? expectedError)
    {
        var state = State();
        var draft = Draft(state, "raw-service-donation", Line("raw-service-cost", "5101", 1000m, 0m, U), Line("raw-service-income", "4101", 0m, 1000m, U));
        var request = draft with { Draft = draft.Draft with { IsNoncash = noncash }, Activity = new("synthetic-raw-service-assessment", true, reliable) };
        if (expectedError is not null)
        {
            Assert.Equal(expectedError, Assert.Throws<NonprofitValidationException>(() => service.Propose(state, request)).Code);
            return;
        }
        var proposal = service.Propose(state, request);
        Assert.True(Assert.Single(proposal.Vouchers).IsNoncash);
        Assert.Equal(0m, ScenarioFixture.Balance(proposal.ProjectedState, "1002"));
        Assert.Equal(request.Activity, proposal.Evidence.Activity);
        Assert.Contains(request.Activity!.EvidenceReference, JsonSerializer.Serialize(proposal));
    }

    [Fact]
    public void Earlier_dated_release_cannot_use_balances_projected_at_month_end()
    {
        var gift = service.SuggestDonation(State(), Gift("chronology-gift"));
        var closing = service.SuggestClosing(gift.ProjectedState, new(Id("chronology-close"), gift.ProjectedState.Revision, Date));
        Assert.Equal(Date, closing.ProjectedState.LastPlannedDate);
        var error = Assert.Throws<NonprofitValidationException>(() => service.SuggestRelease(closing.ProjectedState,
            new(Id("backdated-release"), closing.ProjectedState.Revision, ScenarioFixture.Start, 1000m,
                new("grant-A", 1, true, true, false, "synthetic-backdated-release-evidence"))));
        Assert.Equal("NP_CHRONOLOGY", error.Code);
        Assert.Equal(-1000m, ScenarioFixture.Balance(closing.ProjectedState, "3102"));
    }

    [Fact]
    public void Delimiter_containing_restriction_scopes_generate_distinct_closing_voucher_and_line_IDs()
    {
        var firstTag = new Classification(RestrictionClass.Restricted, "a|1", 2, "p");
        var secondTag = new Classification(RestrictionClass.Restricted, "a", 1, "2|p");
        var firstEvidence = ScenarioFixture.Evidence("a|1") with { Version = 2, ProjectId = "p" };
        var secondEvidence = ScenarioFixture.Evidence("a") with { ProjectId = "2|p" };
        var state = State(restrictions: [firstEvidence, secondEvidence]);
        var first = service.SuggestDonation(state, Gift("delimiter-first", amount: 100m, classification: firstTag));
        var second = service.SuggestDonation(first.ProjectedState, Gift("delimiter-second", first.ProjectedState.Revision, 100m, secondTag));
        var request = new ClosingRequest(Id("delimiter-close"), second.ProjectedState.Revision, Date);
        var closing = service.SuggestClosing(second.ProjectedState, request);
        Assert.Equal(2, closing.Vouchers.Count);
        Assert.Equal(2, closing.Vouchers.Select(v => v.Id).Distinct().Count());
        Assert.Equal(4, closing.Vouchers.SelectMany(v => v.Lines).Select(l => l.Id).Distinct().Count());
        Assert.Equal(-200m, ScenarioFixture.Balance(closing.ProjectedState, "3102"));
        Assert.Equal(0m, ScenarioFixture.Balance(closing.ProjectedState, "4101"));
        Assert.Equal(closing.Vouchers.Select(v => v.Id), service.SuggestClosing(second.ProjectedState, request).Vouchers.Select(v => v.Id));
    }

    [Fact]
    public void Offset_cash_legs_cannot_hide_an_unassessed_donation_and_expense_activity()
    {
        var state = State();
        var request = Draft(state, "mixed-gift-expense-with-offset-cash",
            Line("mixed-cash-cost", "5101", 100m, 0m, U),
            Line("mixed-cash-gift", "4101", 0m, 100m, U),
            Line("mixed-cash-in", "1002", 0.01m, 0m),
            Line("mixed-cash-out", "1002", 0m, 0.01m));
        Assert.False(request.Draft.IsNoncash);
        Assert.Null(request.Activity!.ServiceMeasurementReliable);
        var error = Assert.Throws<NonprofitValidationException>(() => service.Propose(state, request));
        Assert.Equal("NP_MIXED_DONATION_ACTIVITY_REVIEW", error.Code);
        Assert.Empty(state.Balances);
        Assert.Empty(state.Receipts);
    }

    [Fact]
    public void Offset_fixed_asset_legs_cannot_bypass_service_measurement_review()
    {
        var state = State();
        var draft = Draft(state, "unassessed-service-with-offset-asset",
            Line("mixed-asset-cost", "5101", 100m, 0m, U),
            Line("mixed-asset-gift", "4101", 0m, 100m, U),
            Line("mixed-asset-in", "1501", 0.01m, 0m),
            Line("mixed-asset-out", "1501", 0m, 0.01m));
        var request = draft with { Draft = draft.Draft with { IsNoncash = true } };
        Assert.Null(request.Activity!.ServiceMeasurementReliable);
        var error = Assert.Throws<NonprofitValidationException>(() => service.Propose(state, request));
        Assert.Equal("NP_SERVICE_MEASUREMENT_REVIEW", error.Code);
        Assert.Empty(state.Balances);
        Assert.Empty(state.Receipts);
    }
}
