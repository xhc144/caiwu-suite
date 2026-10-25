using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Caiwu.Nonprofit;

namespace Caiwu.Nonprofit.Tests;

internal static class ScenarioFixture
{
    internal static readonly DateOnly Start = new(2026, 6, 1);
    internal static readonly DateOnly End = new(2026, 6, 30);
    internal static readonly Guid BookId = Id("fixture-book");

    internal static JsonElement[] Cases()
    {
        using var file = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "nonprofit-v2.json")));
        return file.RootElement.GetProperty("cases").EnumerateArray().Select(c => c.Clone()).ToArray();
    }

    internal static JsonElement Find(string id) => Cases().Single(c => Text(c, "id") == id);
    internal static string Text(JsonElement value, string property) => value.GetProperty(property).GetString()!;
    internal static string? OptionalText(JsonElement value, string property) => value.GetProperty(property).ValueKind == JsonValueKind.Null ? null : Text(value, property);
    internal static decimal Amount(JsonElement value, string property) => decimal.Parse(Text(value, property), CultureInfo.InvariantCulture);
    internal static Guid Id(string value) => new(SHA256.HashData(Encoding.UTF8.GetBytes(value)).AsSpan(0, 16));

    internal static Classification Unrestricted() => new(RestrictionClass.Unrestricted, null, null, null);
    internal static Classification Restricted(string id) => new(RestrictionClass.Restricted, id, 1, "project:" + id);
    internal static Classification? Classify(JsonElement value)
    {
        var text = OptionalText(value, "restrictionClass");
        if (text is null) return null;
        return text == "Unrestricted" ? Unrestricted() : Restricted(OptionalText(value, "restrictionId") ?? "missing-id");
    }

    internal static RestrictionEvidence Evidence(string id, RestrictionSourceKind kind = RestrictionSourceKind.ExternalProvider) => new(
        id, 1, "project:" + id, kind, "synthetic-evidence:" + id,
        [new(RestrictionConditionKind.Time, "Synthetic agreement time restriction"), new(RestrictionConditionKind.Purpose, "Synthetic project purpose")]);

    internal static IReadOnlyList<RestrictionEvidence> Restrictions(JsonElement c) => c.GetProperty("restrictions").EnumerateArray().Select(r => new RestrictionEvidence(
        Text(r, "id"), 1, "project:" + Text(r, "id"), Enum.Parse<RestrictionSourceKind>(Text(r, "sourceKind")),
        OptionalText(r, "evidenceId") ?? "",
        r.GetProperty("conditions").EnumerateArray().Select(x => new RestrictionCondition(Enum.Parse<RestrictionConditionKind>(x.GetString()!), "Synthetic fixture condition")).ToArray())).ToArray();

    internal static string VoucherKey(JsonElement c, string id) => Text(c, "id") + ":voucher:" + id;
    internal static Guid VoucherId(JsonElement c, string id) => Id(VoucherKey(c, id));
    internal static Guid LineId(JsonElement c, string voucherId, string lineId) => Id(VoucherKey(c, voucherId) + ":line:" + lineId);

    internal static VoucherSuggestion Voucher(JsonElement c, JsonElement v) => new(
        VoucherId(c, Text(v, "id")), DateOnly.ParseExact(Text(v, "date"), "yyyy-MM-dd"),
        Enum.Parse<SuggestionKind>(Text(v, "kind")), Text(v, "cashNature") == "Noncash",
        v.GetProperty("lines").EnumerateArray().Select(l => new LineSuggestion(
            LineId(c, Text(v, "id"), Text(l, "id")), Text(l, "accountCode"), Amount(l, "debit"), Amount(l, "credit"), Classify(l), "Synthetic fixture")).ToArray());

    internal static ReleaseAssessment? Release(JsonElement v)
    {
        var r = v.GetProperty("releaseAssessment");
        if (r.ValueKind == JsonValueKind.Null) return null;
        return new(Text(r, "restrictionId"), 1, r.GetProperty("timeSatisfied").GetBoolean(), r.GetProperty("purposeSatisfied").GetBoolean(),
            r.GetProperty("providerRevoked").GetBoolean(), OptionalText(r, "evidenceId") ?? "");
    }

    internal static AllocationRequest Allocation(JsonElement c, JsonElement a)
    {
        var voucherId = OptionalText(a, "voucherId") ?? "standalone-allocation";
        return new(Text(a, "id"), VoucherId(c, voucherId), Amount(a, "total"), a.GetProperty("basisApproved").GetBoolean(),
            OptionalText(a, "basisEvidenceId") ?? "", a.GetProperty("rows").EnumerateArray().Select(r => new AllocationShare(
                Text(r, "id"), LineId(c, voucherId, Text(r, "id")), Text(r, "accountCode"), Classify(r)!,
                r.GetProperty("weight").GetInt64(), Amount(r, "amount"))).ToArray());
    }

    internal static ActivityAssessment? Activity(VoucherSuggestion v) => v.Kind == SuggestionKind.Activity
        ? new("synthetic-accountant-recognition", true, v.IsNoncash ? true : null) : null;

    internal static PlanningState CreateState(NonprofitPlanningService service, JsonElement c)
    {
        var vouchers = c.GetProperty("vouchers").EnumerateArray().ToArray();
        var firstOpening = vouchers.Length > 0 && Text(vouchers[0], "kind") == "Opening" ? vouchers[0] : default;
        var balances = firstOpening.ValueKind == JsonValueKind.Undefined ? [] : firstOpening.GetProperty("lines").EnumerateArray()
            .Select(l => new ClassifiedBalance(Text(l, "accountCode"), Classify(l), Amount(l, "debit") - Amount(l, "credit"))).ToArray();
        return service.CreateState(BookId, Start, End, Restrictions(c), balances, 71);
    }

    internal static ProposalRequest Request(JsonElement c, JsonElement v, PlanningState state)
    {
        var voucher = Voucher(c, v);
        var allocations = c.GetProperty("allocations").EnumerateArray().Where(a => OptionalText(a, "voucherId") == Text(v, "id"))
            .Select(a => Allocation(c, a)).ToArray();
        return new(Id(Text(c, "id") + ":request:" + Text(v, "id")), state.Revision, voucher, allocations, Release(v), Activity(voucher));
    }

    internal static IReadOnlyDictionary<string, string> Categories()
    {
        using var file = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "nonprofit.json")));
        return file.RootElement.GetProperty("accounts").EnumerateArray().ToDictionary(a => Text(a, "code"), a => Text(a, "category"));
    }

    internal static decimal Balance(PlanningState state, string code, RestrictionClass? restrictionClass = null) => state.Balances
        .Where(b => b.AccountCode == code && (restrictionClass is null || b.Classification?.Class == restrictionClass)).Sum(b => b.NetDebit);
}
