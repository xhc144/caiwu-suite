using System.Security.Cryptography;
using System.Text.Json;
using System.Diagnostics.CodeAnalysis;

namespace Caiwu.Nonprofit;

public sealed class NonprofitRules
{
    internal sealed record AccountRule(string Category, string RestrictionPolicy);
    internal IReadOnlyDictionary<string, AccountRule> Accounts { get; }
    public RuleBinding Binding { get; }
    public DateOnly EffectiveFrom { get; }
    public bool IsVerifiedForProduction => false;

    private NonprofitRules(byte[] bytes)
    {
        using var document = JsonDocument.Parse(bytes);
        var root = document.RootElement;
        var id = root.GetProperty("id").GetString()!;
        Check(id == "nonprofit-2026-official" && !root.GetProperty("isVerifiedForProduction").GetBoolean(),
            "NP_RULE_BINDING", "Expected unverified official2026 reference package");
        Binding = new(id, root.GetProperty("version").GetString()!, Convert.ToHexStringLower(SHA256.HashData(bytes)));
        EffectiveFrom = DateOnly.ParseExact(root.GetProperty("legalEffectiveFrom").GetString()!, "yyyy-MM-dd");
        var accounts = new Dictionary<string, AccountRule>(StringComparer.Ordinal);
        foreach (var entry in root.GetProperty("accounts").EnumerateArray())
        {
            var code = entry.GetProperty("code").GetString()!;
            Check(code.Length == 4 && code.All(char.IsAsciiDigit) && !accounts.ContainsKey(code), "NP_RULE_BINDING", "Invalid or duplicate official code");
            accounts.Add(code, new(entry.GetProperty("category").GetString()!, entry.GetProperty("restrictionPolicy").GetString()!));
        }
        Check(accounts.Count == 56, "NP_RULE_BINDING", "Expected the reviewed56 first-level snapshot");
        Accounts = accounts.AsReadOnly();
    }

    public static NonprofitRules Official2026 { get; } = LoadOfficial();
    private static NonprofitRules LoadOfficial()
    {
        using var stream = typeof(NonprofitRules).Assembly.GetManifestResourceStream("Caiwu.Nonprofit.Official2026.json")
            ?? throw new InvalidOperationException("Missing embedded official reference package");
        using var memory = new MemoryStream();stream.CopyTo(memory);
        return new(memory.ToArray());
    }

    internal static void Check([DoesNotReturnIf(false)] bool valid, string code, string message)
    {
        if (!valid) throw new NonprofitValidationException(code, message);
    }
    internal AccountRule Account(string code)
    {
        Check(code is not null && Accounts.ContainsKey(code), "NP_UNKNOWN_ACCOUNT", "Unknown official account");
        return Accounts[code!];
    }
}
