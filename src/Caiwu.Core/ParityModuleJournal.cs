using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Caiwu.Contracts;

namespace Caiwu.Core;

/// <summary>
/// Versioned append-only module journal inside the existing atomic ledger snapshot. Opaque
/// payload strings survive base ledger edits, readback, backup and restore without schema loss.
/// </summary>
internal static class ParityModuleJournal
{
    internal const string Action = "ParityModuleCommit.v1";
    private const int MaximumPayloadBytes = 1024 * 1024;
    private const int MaximumCommitBytes = 4 * 1024 * 1024;
    private static readonly JsonSerializerOptions Options = new()
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 64
    };

    private sealed record CommitEnvelope(int Version, string ModuleId,
        IReadOnlyList<ModuleDocumentChange> Changes, ModuleVoucherReceipt? Receipt);

    internal static ModuleLedgerSnapshot Replay(LedgerSnapshot ledger)
    {
        var modules = new Dictionary<string, Dictionary<string, LedgerModuleDocument>>(StringComparer.Ordinal);
        var receipts = new List<ModuleVoucherReceipt>();
        foreach (var audit in ledger.AuditEvents)
        {
            if (!audit.Action.StartsWith("ParityModuleCommit.", StringComparison.Ordinal)) continue;
            Require(audit.Action == Action, "模块日志版本高于当前支持版本，拒绝忽略模块状态。");
            CommitEnvelope? envelope;
            try
            {
                ValidateJson(audit.Detail, MaximumCommitBytes);
                envelope = JsonSerializer.Deserialize<CommitEnvelope>(audit.Detail, Options);
            }
            catch (JsonException) { throw new LedgerValidationException("模块提交日志损坏，不能安全恢复模块状态。"); }
            Require(envelope is not null && envelope.Version == 1, "模块提交日志版本或内容无效。");
            var moduleId = ModuleId(envelope!.ModuleId);
            if (!modules.TryGetValue(moduleId, out var documents))
                modules[moduleId] = documents = new(StringComparer.Ordinal);
            ApplyChanges(documents, envelope.Changes);
            if (envelope.Receipt is { } receipt)
            {
                Require(receipt.ModuleId == moduleId && receipt.VoucherId != Guid.Empty &&
                    receipt.VoucherId == audit.VoucherId && receipt.Revision > 0 && receipt.Revision <= ledger.Revision,
                    "模块凭证收据与账套日志不一致。");
                var sources = Sources(receipt.SourceKeys);
                RequireUnused(receipts, moduleId, receipt.ProposalId, sources);
                receipts.Add(receipt with { SourceKeys = sources });
            }
            else Require(audit.VoucherId is null, "模块文档日志不能含无收据的凭证引用。");
        }
        return new(ledger, Array.AsReadOnly(modules.OrderBy(m => m.Key, StringComparer.Ordinal)
            .Select(m => new ModuleDocumentCollection(m.Key, Array.AsReadOnly(m.Value.Values
                .OrderBy(d => d.DocumentId, StringComparer.Ordinal).ToArray()))).ToArray()),
            Array.AsReadOnly(receipts.ToArray()));
    }

    internal static string Encode(ModuleLedgerSnapshot before, string moduleId,
        IReadOnlyList<ModuleDocumentChange> changes, ModuleVoucherReceipt? receipt)
    {
        moduleId = ModuleId(moduleId);
        var documents = before.Modules.SingleOrDefault(m => m.ModuleId == moduleId)?.Documents
            .ToDictionary(d => d.DocumentId, StringComparer.Ordinal) ?? new(StringComparer.Ordinal);
        var frozen = ApplyChanges(documents, changes);
        var json = JsonSerializer.Serialize(new CommitEnvelope(1, moduleId, frozen, receipt), Options);
        Require(Encoding.UTF8.GetByteCount(json) <= MaximumCommitBytes, "单次模块提交超过 4 MiB 限制，请拆分后重新核对。");
        return json;
    }

    internal static string ModuleId(string value)
    {
        Require(value is not null && value.Length is >= 1 and <= 64 && value[0] is >= 'a' and <= 'z' &&
            value.All(c => c is >= 'a' and <= 'z' or >= '0' and <= '9' or '.' or '-'), "模块 ID 须为 1 至 64 位小写英文、数字、点或连字符，且以字母开头。");
        return value!;
    }

    internal static IReadOnlyList<string> Sources(IReadOnlyList<string> values)
    {
        Require(values is not null && values.Count is >= 1 and <= 1000, "凭证建议须提供 1 至 1000 个稳定业务来源键。");
        var sources = values!.Select(v => Identifier(v, "业务来源键")).ToArray();
        Require(sources.Distinct(StringComparer.Ordinal).Count() == sources.Length, "凭证建议的业务来源键重复。");
        return Array.AsReadOnly(sources);
    }

    internal static void RequireUnused(IReadOnlyList<ModuleVoucherReceipt> receipts, string moduleId,
        Guid proposalId, IReadOnlyList<string> sources)
    {
        Require(proposalId != Guid.Empty, "凭证建议 ID 不能为空。");
        Require(!receipts.Any(r => r.ProposalId == proposalId), "该凭证建议已被接收，不能重复生成凭证。");
        var claimed = receipts.Where(r => r.ModuleId == moduleId).SelectMany(r => r.SourceKeys).ToHashSet(StringComparer.Ordinal);
        Require(!sources.Any(claimed.Contains), "业务来源已生成凭证，不能重复生成；删除草稿不会解除来源认领。");
    }

    private static IReadOnlyList<ModuleDocumentChange> ApplyChanges(Dictionary<string, LedgerModuleDocument> documents,
        IReadOnlyList<ModuleDocumentChange> changes)
    {
        Require(changes is not null && changes.Count <= 1000, "模块文档变更不能为空，且每次最多 1000 项。");
        var result = new List<ModuleDocumentChange>();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var change in changes!)
        {
            Require(change is not null, "模块文档变更项不能为空。");
            var id = Identifier(change!.DocumentId, "模块文档 ID");
            Require(ids.Add(id), "单次提交不能重复修改同一模块文档。");
            if (change.Document is { } document)
            {
                Require(document.DocumentId == id && document.SchemaVersion > 0, "模块文档 ID 不一致或版本无效。");
                if (documents.TryGetValue(id, out var old))
                    Require(document.SchemaVersion >= old.SchemaVersion, "不能把模块文档降级为较低版本。");
                ValidateJson(document.PayloadJson, MaximumPayloadBytes);
                documents[id] = document;
            }
            else
                Require(documents.Remove(id), "待删除模块文档不存在。");
            result.Add(change);
        }
        return result.AsReadOnly();
    }

    private static string Identifier(string value, string field)
    {
        Require(value is not null && value.Length is >= 1 and <= 256 && value == value.Trim() &&
            !value.Any(char.IsControl) && WellFormed(value), $"{field}须为 1 至 256 位有效文字，不能含控制字符或首尾空白。");
        return value!;
    }

    private static void ValidateJson(string json, int maximumBytes)
    {
        Require(json is not null && WellFormed(json) && Encoding.UTF8.GetByteCount(json) <= maximumBytes,
            "模块 JSON 编码无效或超过大小限制。");
        try
        {
            using var document = JsonDocument.Parse(json!, new JsonDocumentOptions { MaxDepth = 64 });
            Require(document.RootElement.ValueKind == JsonValueKind.Object, "模块 JSON 必须为对象。");
            CheckKeys(document.RootElement);
        }
        catch (JsonException) { throw new LedgerValidationException("模块 JSON 无效或嵌套超过 64 层。"); }
    }

    private static void CheckKeys(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in value.EnumerateObject())
            {
                Require(names.Add(property.Name), "模块 JSON 包含重复字段，拒绝静默覆盖。");
                CheckKeys(property.Value);
            }
        }
        else if (value.ValueKind == JsonValueKind.Array)
            foreach (var item in value.EnumerateArray()) CheckKeys(item);
    }

    private static bool WellFormed(string value)
    {
        for (var i = 0; i < value.Length; i++)
        {
            if (char.IsHighSurrogate(value[i]))
            {
                if (++i >= value.Length || !char.IsLowSurrogate(value[i])) return false;
            }
            else if (char.IsLowSurrogate(value[i])) return false;
        }
        return true;
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new LedgerValidationException(message);
    }
}
