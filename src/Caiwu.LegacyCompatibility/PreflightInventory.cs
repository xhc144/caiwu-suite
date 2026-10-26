using System.Text.Json;
using System.Text.RegularExpressions;

namespace Caiwu.LegacyCompatibility;

public sealed record InputFingerprint(string InputId, long Bytes, string Sha256);

/// <summary>
/// Consumes PR39's original-compat-preflight-1 report, without reopening/hashing inputs or treating
/// self-declared inventory as a consistent backup, a driver connection, or migration permission.
/// Names, paths and configuration content are deliberately not retained in this receipt.
/// </summary>
public sealed partial class PreflightReceipt
{
    public bool InventoryComplete { get; }
    public string DatabaseInputId { get; }
    public IReadOnlyList<InputFingerprint> Inputs { get; }
    public int UnresolvedGapCount { get; }

    private PreflightReceipt(bool complete, string databaseInputId, InputFingerprint[] inputs, int gaps)
    {
        InventoryComplete = complete;
        DatabaseInputId = databaseInputId;
        Inputs = Array.AsReadOnly(inputs);
        UnresolvedGapCount = gaps;
    }

    public static PreflightReceipt Parse(ReadOnlyMemory<byte> json, string databaseInputId)
    {
        if (json.Length > 4 * 1024 * 1024) throw new FormatException("preflight_report_budget_exceeded");
        try
        {
            using var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 32 });
            var root = document.RootElement;
            RejectDuplicateKeys(root);
            Require(root.GetProperty("schema_version").GetString() == "original-compat-preflight-1");
            Require(root.GetProperty("tool_version").GetString() == "0.1.1");
            Require(root.GetProperty("compatibility_status").GetString() == "not_assessed");
            Require(root.GetProperty("original_ledger_usability").GetString() == "not_assessed");
            var scope = root.GetProperty("scope");
            Require(scope.GetProperty("selection").GetString() == "explicit_files_only_no_directory_scan");
            Require(scope.GetProperty("sources_opened_readonly").GetBoolean());
            foreach (var flag in new[] { "engines_started", "database_connections_created", "uploads", "configuration_values_collected" })
                Require(!scope.GetProperty(flag).GetBoolean());
            var inventory = root.GetProperty("inventory_status").GetString();
            Require(inventory is "complete" or "incomplete");
            var files = root.GetProperty("files").EnumerateArray().ToArray();
            Require(files.Length is > 0 and <= 256);
            var ids = new HashSet<string>(StringComparer.Ordinal);
            var inputs = new List<InputFingerprint>();
            var allRecorded = true;
            foreach (var file in files)
            {
                var id = file.GetProperty("input_id").GetString()!;
                Require(id is not null && InputIdPattern().IsMatch(id) && ids.Add(id));
                if (file.GetProperty("status").GetString() != "recorded") { allRecorded = false; continue; }
                var bytes = file.GetProperty("bytes").GetInt64();
                var hash = file.GetProperty("sha256").GetString()!;
                Require(bytes >= 0 && hash is not null && HashPattern().IsMatch(hash));
                inputs.Add(new InputFingerprint(id!, bytes, hash!));
            }
            // Inconsistent producer claims are rejected; incomplete receipts remain reportable.
            Require((inventory == "complete") == allRecorded);
            Require(ids.Contains(databaseInputId));
            var coverage = root.GetProperty("database_coverage").EnumerateArray()
                .Where(x => x.GetProperty("database_input_id").GetString() == databaseInputId).ToArray();
            Require(coverage.Length == 1);
            var gaps = coverage[0].GetProperty("gaps").GetArrayLength();
            return new PreflightReceipt(allRecorded, databaseInputId, inputs.ToArray(), gaps);
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or KeyNotFoundException or OverflowException)
        {
            throw new FormatException("invalid_pr39_preflight_report");
        }
    }

    private static void Require(bool condition)
    {
        if (!condition) throw new FormatException("invalid_pr39_preflight_report");
    }
    private static void RejectDuplicateKeys(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var keys = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            {
                Require(keys.Add(property.Name));
                RejectDuplicateKeys(property.Value);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
            foreach (var child in element.EnumerateArray()) RejectDuplicateKeys(child);
    }

    [GeneratedRegex("\\AF[0-9]{3}\\z", RegexOptions.CultureInvariant)]
    private static partial Regex InputIdPattern();
    [GeneratedRegex("\\A[0-9a-f]{64}\\z", RegexOptions.CultureInvariant)]
    private static partial Regex HashPattern();
}
