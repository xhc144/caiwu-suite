using System.Numerics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using static Caiwu.Nonprofit.NonprofitRules;

namespace Caiwu.Nonprofit;

/// <summary>Pure, immutable planning. Returned balances are hypothetical pending-review effects, never posted books.</summary>
public sealed class NonprofitPlanningService(NonprofitRules? rules = null)
{
    private readonly NonprofitRules rules = rules ?? NonprofitRules.Official2026;
    private const decimal MaxMoney = 92233720368547758.07m;
    private readonly record struct Key(string AccountCode, Classification? Classification);
    private static IReadOnlyList<T> Freeze<T>(IEnumerable<T> values) => Array.AsReadOnly(values.ToArray());
    private static bool Text(string? value) => !string.IsNullOrWhiteSpace(value);
    private static string Digest<T>(T value) => Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value)));
    private static string Order(Key key) => JsonSerializer.Serialize(key);
    private static decimal Money(decimal value)
    {
        Check((decimal.GetBits(value)[3] >> 16 & 0xff) <= 2, "NP_MONEY_PRECISION", "Amounts must have at most two decimal places; no silent rounding");
        Check(value >= -MaxMoney && value <= MaxMoney, "NP_TOTAL_OVERFLOW", "Amount exceeds the symmetric signed Int64-cent range");
        return value;
    }
    private static decimal Add(decimal left, decimal right)
    {
        try { return Money(checked(left + right)); }
        catch (OverflowException) { throw new NonprofitValidationException("NP_TOTAL_OVERFLOW", "Decimal amount overflow"); }
    }
    private static long Cents(decimal amount) => checked((long)(Money(amount) * 100m));
    private static Guid Id(Guid book, Guid request, string scope)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{book:D}|{request:D}|{scope}"));
        return new Guid(bytes.AsSpan(0, 16));
    }

    public PlanningState CreateState(Guid bookId, DateOnly periodStart, DateOnly periodEnd,
        IReadOnlyList<RestrictionEvidence> restrictions, IReadOnlyList<ClassifiedBalance> openingBalances,
        long sourceLedgerRevision = 0)
    {
        Check(bookId != Guid.Empty && sourceLedgerRevision >= 0, "NP_STATE", "Book and source revision required");
        var state = new PlanningState(bookId, sourceLedgerRevision, 0, periodStart, periodEnd, false,
            PlanningPhase.Active, rules.Binding, CopyRestrictions(restrictions), Freeze(openingBalances), []);
        ValidateState(state);
        foreach (var balance in state.Balances.Where(b => b.NetDebit != 0))
        {
            Check(!IsProfitLoss(balance.AccountCode), "NP_OPENING_PL", "Cannot carry old income/expense into opening balances");
            Check(balance.AccountCode != "3201", "NP_UNSUPPORTED_PRIOR_ADJUSTMENT", "Prior-year adjustments require separate review");
        }
        return CopyState(state);
    }

    private static IReadOnlyList<RestrictionEvidence> CopyRestrictions(IEnumerable<RestrictionEvidence> definitions) =>
        Freeze(definitions.Select(d => d with { Conditions = Freeze(d.Conditions) }));
    private static PlanningState CopyState(PlanningState state) => state with
    {
        Restrictions = CopyRestrictions(state.Restrictions), Balances = Freeze(state.Balances),
        Receipts = Freeze(state.Receipts.Select(r => r with { VoucherIds = Freeze(r.VoucherIds) }))
    };
    private bool IsProfitLoss(string account) => rules.Account(account).Category is "Income" or "Expense";

    private void ValidateState(PlanningState state)
    {
        Check(state.Rules == rules.Binding, "NP_RULE_BINDING", "Rule package ID, version and SHA256 must match");
        Check(state.BookId != Guid.Empty && state.Revision >= 0 && state.SourceLedgerRevision >= 0, "NP_STATE", "Invalid planning state");
        Check(Enum.IsDefined(state.Phase), "NP_STATE", "Unknown planning phase");
        Check(state.PeriodStart >= rules.EffectiveFrom, "NP_PERIOD_UNSUPPORTED", "Official2026 rules cannot be applied to earlier periods");
        Check(state.PeriodStart.Day == 1 && state.PeriodEnd == new DateOnly(state.PeriodStart.Year, state.PeriodStart.Month, DateTime.DaysInMonth(state.PeriodStart.Year, state.PeriodStart.Month)), "NP_PERIOD_MISMATCH", "Only a single complete calendar month is supported");
        Check(state.LastPlannedDate is null || (state.LastPlannedDate.Value >= state.PeriodStart && state.LastPlannedDate.Value <= state.PeriodEnd), "NP_STATE", "Last planned date must belong to the active period");
        Check(state.Restrictions.Select(r => r.Id).Distinct(StringComparer.Ordinal).Count() == state.Restrictions.Count,
            "NP_RESTRICTION_DUPLICATE", "Restriction IDs must be unique; each record has an explicit version");
        foreach (var definition in state.Restrictions)
        {
            Check(Text(definition.Id) && definition.Version > 0 && Text(definition.ProjectId), "NP_RESTRICTION_EVIDENCE", "Restriction ID/version/project required");
            Check(definition.SourceKind != RestrictionSourceKind.InternalBudget, "NP_INTERNAL_BUDGET", "Internal budget alone is not a statutory restriction");
            Check(definition.SourceKind is RestrictionSourceKind.ExternalProvider or RestrictionSourceKind.LawOrAdministrativeRegulation,
                "NP_RESTRICTION_EVIDENCE", "External or legal source required");
            Check(Text(definition.EvidenceReference) && definition.Conditions.Count > 0 && definition.Conditions.All(c => Enum.IsDefined(c.Kind) && Text(c.Terms)),
                "NP_RESTRICTION_EVIDENCE", "Nonempty evidence and specific conditions required");
        }
        Check(state.Balances.Select(b => new Key(b.AccountCode, b.Classification)).Distinct().Count() == state.Balances.Count, "NP_BALANCE_DUPLICATE", "Duplicate classified balance key");
        decimal total = 0;
        foreach (var balance in state.Balances)
        {
            Money(balance.NetDebit);
            Check(balance.AccountCode != "3201" || balance.NetDebit == 0, "NP_UNSUPPORTED_PRIOR_ADJUSTMENT", "Prior-year adjustments require a separately reviewed workflow");
            if (balance.NetDebit != 0) ValidateClassification(state, balance.AccountCode, balance.Classification);
            else rules.Account(balance.AccountCode);
            total = Add(total, balance.NetDebit);
        }
        Check(total == 0, "NP_UNBALANCED", "Source/planned balance snapshot must balance");
        Check(state.Receipts.Select(r => r.RequestId).Distinct().Count() == state.Receipts.Count, "NP_DUPLICATE_REQUEST", "Duplicate saved request receipt");
        Check(state.Receipts.All(r => r.RequestId != Guid.Empty && r.PayloadSha256.Length == 64 && r.PayloadSha256.All(char.IsAsciiHexDigit)), "NP_STATE", "Invalid request receipt");
        var ids = state.Receipts.SelectMany(r => r.VoucherIds).ToArray();
        Check(ids.Distinct().Count() == ids.Length, "NP_DUPLICATE_VOUCHER", "Duplicate suggested voucher identity");
    }

    private void ValidateClassification(PlanningState state, string code, Classification? classification)
    {
        var account = rules.Account(code);
        Check(account.RestrictionPolicy != "ReviewRequired", "NP_MANUAL_TAX_REVIEW", "5601 needs specialist review; automatic treatment is unavailable");
        if (IsProfitLoss(code))
            Check(classification is not null, "NP_CLASS_REQUIRED", "Income AND expense require explicit classification");
        else if (code is "3101" or "3102")
            Check(classification?.Class == (code == "3101" ? RestrictionClass.Unrestricted : RestrictionClass.Restricted), "NP_NET_ASSET_CLASS", "Net-asset class must match its account");
        else
        {
            Check(classification is null, "NP_CLASS_NOT_APPLICABLE", "Asset/liability lines use separate funding traces, not P/L classification");
            return;
        }
        Check(classification is not null && Enum.IsDefined(classification.Class), "NP_CLASS_REQUIRED", "Unknown classification");
        var tag = classification!;
        Check(tag.ProjectId is null || Text(tag.ProjectId), "NP_PROJECT", "Project tag cannot be blank");
        if (tag.Class == RestrictionClass.Unrestricted)
            Check(tag.RestrictionId is null && tag.RestrictionVersion is null, "NP_CLASS_RESTRICTION_MISMATCH", "Unrestricted lines cannot carry external restriction IDs");
        else
        {
            var evidence = state.Restrictions.SingleOrDefault(r => r.Id == tag.RestrictionId && r.Version == tag.RestrictionVersion);
            Check(evidence is not null, "NP_RESTRICTION_EVIDENCE", "Known restriction evidence/version required");
            Check(tag.ProjectId == evidence!.ProjectId, "NP_PROJECT", "Project must match the evidence scope");
        }
    }

    private void Context(PlanningState state, Guid requestId, long expectedRevision, DateOnly date, string payload)
    {
        ValidateState(state);
        Check(requestId != Guid.Empty, "NP_REQUEST_ID", "Stable request ID required");
        var prior = state.Receipts.SingleOrDefault(r => r.RequestId == requestId);
        if (prior is not null)
            throw new NonprofitValidationException(prior.PayloadSha256 == payload ? "NP_DUPLICATE_REQUEST" : "NP_REQUEST_ID_CONFLICT", "Request was already planned; do not produce another effect");
        Check(expectedRevision == state.Revision, "NP_REVISION_CONFLICT", "Stale planning revision; rebuild from current state");
        Check(state.Revision < long.MaxValue, "NP_REVISION_OVERFLOW", "Planning revision cannot advance further");
        Check(!state.IsPeriodLocked, "NP_PERIOD_LOCKED", "Locked source period cannot receive proposals");
        Check(date >= rules.EffectiveFrom, "NP_PERIOD_UNSUPPORTED", "Official2026 rules cannot be backdated into2025");
        Check(date >= state.PeriodStart && date <= state.PeriodEnd, "NP_PERIOD_MISMATCH", "Cross-period planning is not supported");
        Check(state.LastPlannedDate is null || date >= state.LastPlannedDate.Value, "NP_CHRONOLOGY", "Cannot use later projected balances to create an earlier-dated suggestion");
    }

    public AllocationCalculation ComputeAllocation(PlanningState state, AllocationRequest request)
    {
        ValidateState(state);
        Check(!state.IsPeriodLocked, "NP_PERIOD_LOCKED", "Cannot plan allocation for a locked period");
        Check(Text(request.Id) && request.BasisApproved && Text(request.BasisEvidenceReference), "NP_ALLOCATION_BASIS", "Documented human approval of a reasonable basis required");
        Check(request.Total > 0, "NP_ALLOCATION_TOTAL", "Positive common expense required");
        var total = Cents(request.Total);
        Check(request.Shares.Count > 0 && request.Shares.All(s => Text(s.Id) && s.VoucherLineId != Guid.Empty), "NP_ALLOCATION_ACCOUNT", "Stable allocation/line IDs required");
        Check(request.Shares.Select(s => s.Id).Distinct(StringComparer.Ordinal).Count() == request.Shares.Count && request.Shares.Select(s => s.VoucherLineId).Distinct().Count() == request.Shares.Count,
            "NP_ALLOCATION_DUPLICATE", "Duplicate allocation row or line identity");
        Check(request.Shares.All(s => s.Weight > 0), "NP_ALLOCATION_WEIGHT", "Positive rational weights required");
        BigInteger denominator = request.Shares.Aggregate(BigInteger.Zero, (sum, s) => sum + s.Weight);
        var floors = request.Shares.ToDictionary(s => s.Id, s => (long)((BigInteger)total * s.Weight / denominator), StringComparer.Ordinal);
        var remaining = total - floors.Values.Sum();
        var extras = request.Shares.OrderByDescending(s => (BigInteger)total * s.Weight % denominator).ThenBy(s => s.Id, StringComparer.Ordinal)
            .Take(checked((int)remaining)).Select(s => s.Id).ToHashSet(StringComparer.Ordinal);
        var results = new List<CalculatedShare>();
        foreach (var share in request.Shares)
        {
            Check(rules.Account(share.AccountCode).Category == "Expense", "NP_ALLOCATION_ACCOUNT", "Expense function and restriction class are separate dimensions");
            ValidateClassification(state, share.AccountCode, share.Classification);
            var amount = (floors[share.Id] + (extras.Contains(share.Id) ? 1 : 0)) / 100m;
            if (share.RequestedAmount is decimal expected)
                Check(Money(expected) == amount, "NP_ALLOCATION_AMOUNT", "Requested allocation disagrees with approved weights and cent policy");
            results.Add(new(share.Id, share.VoucherLineId, share.AccountCode, share.Classification, share.Weight, amount, floors[share.Id], extras.Contains(share.Id)));
        }
        Check(results.Sum(r => r.Amount) == request.Total, "NP_ALLOCATION_TOTAL", "Allocated cost must be conserved");
        return new(request.Id, request.VoucherId, request.Total, request.BasisEvidenceReference, "LargestRemainderThenRowId", Freeze(results));
    }

    public NonprofitProposal Propose(PlanningState state, ProposalRequest request) => Plan(state, request.RequestId,
        request.ExpectedRevision, Digest(new { Kind = "ExplicitDraft", Request = request, rules.Binding }),
        [request.Draft], request.Allocations, request.Release, request.Activity);

    private NonprofitProposal Plan(PlanningState state, Guid requestId, long expectedRevision, string payload,
        IReadOnlyList<VoucherSuggestion> drafts, IReadOnlyList<AllocationRequest> allocations,
        ReleaseAssessment? release, ActivityAssessment? activity)
    {
        Check(drafts.Count > 0, "NP_EMPTY_PROPOSAL", "No voucher to suggest");
        Context(state, requestId, expectedRevision, drafts[0].Date, payload);
        Check(drafts.All(v => v.Date == drafts[0].Date), "NP_PERIOD_MISMATCH", "A proposal has one accounting date");
        var usedIds = state.Receipts.SelectMany(r => r.VoucherIds).ToHashSet();
        Check(drafts.All(v => v.Id != Guid.Empty && !usedIds.Contains(v.Id)) && drafts.Select(v => v.Id).Distinct().Count() == drafts.Count,
            "NP_DUPLICATE_VOUCHER", "Suggested voucher identity already used");
        var calculations = allocations.Select(a => ComputeAllocation(state, a)).ToArray();
        Check(allocations.Select(a => a.Id).Distinct(StringComparer.Ordinal).Count() == allocations.Count, "NP_ALLOCATION_DUPLICATE", "Duplicate allocation ID");
        var links = allocations.SelectMany(a => a.Shares.Select(s => (a.VoucherId, s.VoucherLineId))).ToArray();
        Check(links.Distinct().Count() == links.Length, "NP_ALLOCATION_REPEATED_LINE", "Same expense line cannot be allocated twice");
        foreach (var calculation in calculations)
        {
            var voucher = drafts.SingleOrDefault(v => v.Id == calculation.VoucherId);
            Check(voucher is not null && voucher.Kind == SuggestionKind.Activity, "NP_ALLOCATION_VOUCHER", "Allocation must link to its proposed expense voucher");
            foreach (var share in calculation.Shares)
            {
                var line = voucher!.Lines.SingleOrDefault(l => l.Id == share.VoucherLineId);
                if (share.Amount == 0)
                {
                    Check(line is null, "NP_ALLOCATION_POSTING", "Zero allocation stays in the audit workpaper and must not create a zero journal line");
                    continue;
                }
                Check(line is not null && line.AccountCode == share.AccountCode && line.Classification == share.Classification && line.Debit == share.Amount && line.Credit == 0,
                    "NP_ALLOCATION_POSTING", "Allocation-to-voucher bridge must preserve amount, function and restriction scope");
            }
        }
        var working = CopyState(state);
        foreach (var draft in drafts) working = ValidateAndProject(working, draft, release, activity);
        var next = working with { Revision = checked(state.Revision + 1), Receipts = Freeze(state.Receipts.Append(new(requestId, payload, Freeze(drafts.Select(v => v.Id))))) };
        var before = state.Balances.ToDictionary(b => new Key(b.AccountCode, b.Classification), b => b.NetDebit);
        var after = next.Balances.ToDictionary(b => new Key(b.AccountCode, b.Classification), b => b.NetDebit);
        var changes = before.Keys.Union(after.Keys).OrderBy(Order, StringComparer.Ordinal)
            .Where(k => before.GetValueOrDefault(k) != after.GetValueOrDefault(k))
            .Select(k => new BalanceDelta(k.AccountCode, k.Classification, before.GetValueOrDefault(k), Add(after.GetValueOrDefault(k), -before.GetValueOrDefault(k)), after.GetValueOrDefault(k)));
        var evidenceReferences = new[] { activity?.EvidenceReference, release?.EvidenceReference }
            .Concat(calculations.Select(c => c.BasisEvidenceReference)).Where(Text).Select(s => s!).Distinct(StringComparer.Ordinal);
        return new(requestId, state.Revision, state.SourceLedgerRevision, rules.Binding, SuggestionStatus.PendingReview,
            Freeze(drafts.Select(v => v with { Lines = Freeze(v.Lines) })), Freeze(calculations), Freeze(changes), CopyState(next),
            new(activity, release, Freeze(evidenceReferences)));
    }

    private PlanningState ValidateAndProject(PlanningState state, VoucherSuggestion draft, ReleaseAssessment? release, ActivityAssessment? activity)
    {
        Check(Enum.IsDefined(draft.Kind) && draft.Kind != SuggestionKind.Opening, "NP_OPENING_ORDER", "Opening is a frozen initial snapshot, never a later action");
        Check(draft.Status == SuggestionStatus.PendingReview, "NP_REVIEW_REQUIRED", "Only pending-review suggestions are supported");
        Check(draft.Kind == SuggestionKind.Release || release is null, "NP_RELEASE_SHAPE", "Only an explicit release may carry release evidence");
        Check(draft.Lines.Count >= 2 && draft.Lines.All(l => l.Id != Guid.Empty) && draft.Lines.Select(l => l.Id).Distinct().Count() == draft.Lines.Count,
            "NP_LINE_DUPLICATE", "At least two uniquely identified lines required");
        decimal debit = 0, credit = 0;
        foreach (var line in draft.Lines)
        {
            ValidateClassification(state, line.AccountCode, line.Classification);
            Money(line.Debit);Money(line.Credit);
            Check(line.Debit >= 0 && line.Credit >= 0 && (line.Debit > 0) != (line.Credit > 0), "NP_LINE_AMOUNT", "Exactly one positive amount side required");
            debit = Add(debit, line.Debit);credit = Add(credit, line.Credit);
        }
        Check(debit == credit, "NP_UNBALANCED", "Suggested voucher must balance");
        Check(!draft.IsNoncash || !draft.Lines.Any(l => l.AccountCode is "1001" or "1002" or "1009"), "NP_NONCASH_HAS_CASH", "Noncash activity cannot manufacture cash");
        if (draft.Kind == SuggestionKind.Activity)
        {
            Check(state.Phase == PlanningPhase.Active, "NP_CLOSING_IN_PROGRESS", "No new activity after classified closing begins");
            Check(!draft.Lines.Any(l => l.AccountCode is "3101" or "3102" or "3201"), "NP_NET_ASSET_OPERATION", "Net-asset changes need separately reviewed operations; no Activity disguise");
            Check(activity is not null && activity.RecognitionConfirmed && Text(activity.EvidenceReference), "NP_ACTIVITY_EVIDENCE", "Explicit recognition/fact review evidence required");
            var noncashDonation = draft.Lines.Any(l => l.AccountCode == "4101") && !draft.Lines.Any(l => l.AccountCode is "1001" or "1002" or "1009");
            Check(!noncashDonation || draft.IsNoncash, "NP_NONCASH_CLASSIFICATION", "A noncash donation cannot bypass review by clearing a display flag");
            var donationWithExpense = draft.Lines.Any(l => l.AccountCode == "4101") && draft.Lines.Any(l => rules.Account(l.AccountCode).Category == "Expense");
            if (donationWithExpense)
            {
                Check(draft.IsNoncash, "NP_MIXED_DONATION_ACTIVITY_REVIEW", "Mixed cash donation/expense drafts require separate reviewed suggestions; this combined path only supports service donation");
                Check(activity!.ServiceMeasurementReliable == true, "NP_SERVICE_MEASUREMENT_REVIEW", "Service donation needs reliable voucher/fair-value assessment");
            }
        }
        var balances = state.Balances.ToDictionary(b => new Key(b.AccountCode, b.Classification), b => b.NetDebit);
        if (draft.Kind == SuggestionKind.Closing)
        {
            Check(draft.Date == state.PeriodEnd, "NP_CLOSING_DATE", "Closing suggestions only on the active period end");
            Check(state.Phase != PlanningPhase.ClassifiedClosingComputed, "NP_ALREADY_CLOSED", "Classified closing already computed");
            var pl = draft.Lines.Where(l => IsProfitLoss(l.AccountCode)).ToArray();
            var net = draft.Lines.Where(l => l.AccountCode is "3101" or "3102").ToArray();
            Check(pl.Length == 1 && net.Length == 1 && draft.Lines.Count == 2, "NP_CLOSE_SHAPE", "One classified P/L scope and one matching net asset per suggested close");
            Check(net[0].AccountCode == (pl[0].Classification!.Class == RestrictionClass.Restricted ? "3102" : "3101"), "NP_CLOSE_TARGET", "Close to matching net-asset class");
            Check(net[0].Classification == pl[0].Classification, "NP_CLOSE_RESTRICTION_ID", "Closing must preserve restriction version and project scope");
            var before = balances.GetValueOrDefault(new(pl[0].AccountCode, pl[0].Classification));
            var change = pl[0].Debit - pl[0].Credit;
            Check(before != 0 && change != 0 && Math.Sign(before) != Math.Sign(change) && Math.Abs(change) <= Math.Abs(before), "NP_CLOSE_CLASS_BALANCE", "Cannot close another class/grant or exceed its recorded balance");
            Check(rules.Account(pl[0].AccountCode).Category == "Income" ? pl[0].Debit > 0 : pl[0].Credit > 0, "NP_CLOSE_DIRECTION", "Negative/refund P/L requires specialist review");
        }
        if (draft.Kind == SuggestionKind.Release)
        {
            Check(release is not null && Text(release.EvidenceReference), "NP_RELEASE_EVIDENCE", "Spending alone does not authorize release");
            var evidence = state.Restrictions.SingleOrDefault(r => r.Id == release!.RestrictionId && r.Version == release.RestrictionVersion);
            Check(evidence is not null, "NP_RELEASE_EVIDENCE", "Release scope evidence/version required");
            Check(!release!.ProviderRevoked || evidence!.SourceKind == RestrictionSourceKind.ExternalProvider,
                "NP_RELEASE_AUTHORITY", "A provider cannot revoke a restriction imposed by law or administrative regulation");
            Check(release!.ProviderRevoked || evidence!.Conditions.All(c => c.Kind == RestrictionConditionKind.Time ? release.TimeSatisfied : release.PurposeSatisfied),
                "NP_RESTRICTION_NOT_FULLY_RELEASED", "Every surviving condition must be resolved");
            Check(draft.Lines.Count == 2 && draft.Lines.Count(l => l.AccountCode == "3102") == 1 && draft.Lines.Count(l => l.AccountCode == "3101") == 1,
                "NP_RELEASE_SHAPE", "Release is between two net-asset classes only");
            var from = draft.Lines.Single(l => l.AccountCode == "3102");var to = draft.Lines.Single(l => l.AccountCode == "3101");
            Check(from.Classification!.RestrictionId == release.RestrictionId && from.Classification.RestrictionVersion == release.RestrictionVersion,
                "NP_RELEASE_RESTRICTION_ID", "Assessment must identify the same restriction as source net assets");
            Check(from.Debit > 0 && from.Credit == 0 && to.Credit == from.Debit && to.Debit == 0, "NP_RELEASE_DIRECTION", "Only restricted-to-unrestricted release implemented");
            Check(!state.Balances.Any(b => IsProfitLoss(b.AccountCode) && b.Classification?.RestrictionId == release.RestrictionId && b.NetDebit != 0),
                "NP_RELEASE_REQUIRES_CLASSIFIED_CLOSE", "Close this restriction's P/L before computing its net-asset release");
            var available = -balances.Where(p => p.Key.AccountCode == "3102" && p.Key.Classification?.RestrictionId == release.RestrictionId && p.Key.Classification.RestrictionVersion == release.RestrictionVersion).Sum(p => p.Value);
            Check(from.Debit <= available, "NP_RELEASE_EXCEEDS_AVAILABLE", "Cannot release another grant or repeatedly release consumed net assets");
            Check(from.Debit == available, "NP_RELEASE_AMOUNT_SCOPE", "Full release covers this whole evidence record; partial scope needs separate evidence");
        }
        foreach (var line in draft.Lines)
        {
            var key = new Key(line.AccountCode, line.Classification);
            balances[key] = Add(balances.GetValueOrDefault(key), line.Debit - line.Credit);
        }
        var phase = state.Phase;
        if (draft.Kind == SuggestionKind.Closing)
            phase = balances.Any(p => IsProfitLoss(p.Key.AccountCode) && p.Value != 0) ? PlanningPhase.ClosingInProgress : PlanningPhase.ClassifiedClosingComputed;
        return state with { Phase = phase, LastPlannedDate = draft.Date, Balances = Freeze(balances.OrderBy(p => Order(p.Key), StringComparer.Ordinal).Select(p => new ClassifiedBalance(p.Key.AccountCode, p.Key.Classification, p.Value))) };
    }

    private VoucherSuggestion Voucher(PlanningState state, Guid request, DateOnly date, SuggestionKind kind, bool noncash,
        params (string Account, decimal Debit, decimal Credit, Classification? Tag)[] entries) =>
        new(Id(state.BookId, request, "voucher"), date, kind, noncash, Freeze(entries.Select((e, index) =>
            new LineSuggestion(Id(state.BookId, request, $"line:{index}"), e.Account, e.Debit, e.Credit, e.Tag, "待审核民非建议"))));

    public NonprofitProposal SuggestDonation(PlanningState state, DonationRequest request)
    {
        Check(Enum.IsDefined(request.Kind), "NP_DONATION_KIND", "Unsupported donation kind");
        Check(Money(request.Amount) > 0, "NP_LINE_AMOUNT", "Positive recognized donation required");
        var debit = request.Kind == DonationKind.Cash ? "1002" : request.ServiceExpenseAccount;
        if (request.Kind == DonationKind.Service) Check(rules.Account(debit).Category == "Expense", "NP_ALLOCATION_ACCOUNT", "Service counterpart must be expense");
        var draft = Voucher(state, request.RequestId, request.Date, SuggestionKind.Activity, request.Kind == DonationKind.Service,
            (debit, request.Amount, 0, request.Kind == DonationKind.Service ? request.Classification : null), ("4101", 0, request.Amount, request.Classification));
        return Propose(state, new(request.RequestId, request.ExpectedRevision, draft, [], null, new(request.EvidenceReference, request.RecognitionConfirmed, request.ServiceMeasurementReliable)));
    }

    public NonprofitProposal SuggestExpense(PlanningState state, ExpenseRequest request)
    {
        Check(rules.Account(request.AccountCode).Category == "Expense", "NP_ALLOCATION_ACCOUNT", "Expense account required");
        Check(Money(request.Amount) > 0, "NP_LINE_AMOUNT", "Positive expense required");
        var draft = Voucher(state, request.RequestId, request.Date, SuggestionKind.Activity, false,
            (request.AccountCode, request.Amount, 0, request.Classification), ("1002", 0, request.Amount, null));
        return Propose(state, new(request.RequestId, request.ExpectedRevision, draft, [], null, new(request.EvidenceReference, true)));
    }

    public NonprofitProposal SuggestAllocatedExpense(PlanningState state, Guid requestId, long expectedRevision, DateOnly date,
        AllocationRequest allocation, string evidenceReference)
    {
        Check(allocation.VoucherId != Guid.Empty, "NP_ALLOCATION_VOUCHER", "A voucher-bound allocation proposal needs a stable nonempty voucher ID");
        var calculation = ComputeAllocation(state, allocation);
        var lines = calculation.Shares.Where(s => s.Amount > 0).Select(s => new LineSuggestion(s.VoucherLineId, s.AccountCode, s.Amount, 0, s.Classification, "共同费用分配建议")).ToList();
        lines.Add(new(Id(state.BookId, requestId, "bank"), "1002", 0, allocation.Total, null, "共同费用支付建议"));
        var draft = new VoucherSuggestion(allocation.VoucherId, date, SuggestionKind.Activity, false, Freeze(lines));
        return Propose(state, new(requestId, expectedRevision, draft, [allocation], null, new(evidenceReference, true)));
    }

    public NonprofitProposal SuggestClosing(PlanningState state, ClosingRequest request)
    {
        var payload = Digest(new { Kind = "CalculateClosing", Request = request, rules.Binding });
        Context(state, request.RequestId, request.ExpectedRevision, request.Date, payload);
        var drafts = new List<VoucherSuggestion>();
        foreach (var balance in state.Balances.Where(b => IsProfitLoss(b.AccountCode) && b.NetDebit != 0).OrderBy(b => Order(new(b.AccountCode, b.Classification)), StringComparer.Ordinal))
        {
            var income = rules.Account(balance.AccountCode).Category == "Income";
            Check(income ? balance.NetDebit < 0 : balance.NetDebit > 0, "NP_REVIEW_NEGATIVE_PL", "Negative/refund P/L needs specialist closing rules");
            var amount = Math.Abs(balance.NetDebit);
            var net = balance.Classification!.Class == RestrictionClass.Restricted ? "3102" : "3101";
            var scope = Id(state.BookId, request.RequestId, Order(new(balance.AccountCode, balance.Classification)));
            drafts.Add(Voucher(state, scope, request.Date, SuggestionKind.Closing, true,
                (balance.AccountCode, income ? amount : 0, income ? 0 : amount, balance.Classification),
                (net, income ? 0 : amount, income ? amount : 0, balance.Classification)));
        }
        Check(drafts.Count > 0, "NP_NO_INCOME_EXPENSE_TO_CLOSE", "No classified P/L remains to close");
        return Plan(state, request.RequestId, request.ExpectedRevision, payload, drafts, [], null, null);
    }

    public NonprofitProposal SuggestRelease(PlanningState state, ReleaseRequest request)
    {
        var evidence = state.Restrictions.SingleOrDefault(r => r.Id == request.Assessment.RestrictionId && r.Version == request.Assessment.RestrictionVersion);
        Check(evidence is not null, "NP_RELEASE_EVIDENCE", "Known restriction evidence required");
        Check(Money(request.Amount) > 0, "NP_LINE_AMOUNT", "Positive net-asset release required");
        var restricted = new Classification(RestrictionClass.Restricted, evidence!.Id, evidence.Version, evidence.ProjectId);
        var unrestricted = new Classification(RestrictionClass.Unrestricted, null, null, null);
        var draft = Voucher(state, request.RequestId, request.Date, SuggestionKind.Release, true,
            ("3102", request.Amount, 0, restricted), ("3101", 0, request.Amount, unrestricted));
        return Propose(state, new(request.RequestId, request.ExpectedRevision, draft, [], request.Assessment, null));
    }
}
