using System.Text.Json;
using System.Text.Json.Serialization;
using Caiwu.Contracts;
using Caiwu.Nonprofit.Writable;

namespace Caiwu.Nonprofit.Parity;

public sealed record AcceptedNonprofitDraft(Guid ProposalId, long SourceLedgerRevision,
    DateTimeOffset SubmittedAt, string OperatorId, IReadOnlyList<string> SourceKeys,
    NonprofitVoucherDraft Draft);
public sealed record AcceptedNonprofitVoucher(ModuleVoucherReceipt Receipt,
    AcceptedNonprofitDraft Enriched, Voucher? LedgerVoucher);

/// <summary>Bridge to PR52 contract v1. The enriched draft AND the new core voucher are submitted in
/// ONE AcceptVoucherProposal transaction. This adapter never writes external JSON as authoritative state.</summary>
public sealed partial class NonprofitParityAdapter
{
    public const string ModuleId = "regimes.nonprofit.v1";
    public const string BookDocumentId = "book-definition";
    public const string ProposalDocumentPrefix = "accepted-proposal:";
    private readonly IParityLedgerService host;
    private readonly INonprofitAuthorizer authorizer;
    private readonly TimeProvider clock;
    private readonly ILedgerService? ledger;
    private static readonly JsonSerializerOptions Json = new() { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    public NonprofitParityAdapter(IParityLedgerService host, INonprofitAuthorizer authorizer, TimeProvider? clock = null, ILedgerService? ledger = null)
    { this.host = host ?? throw new ArgumentNullException(nameof(host)); this.authorizer = authorizer ?? throw new ArgumentNullException(nameof(authorizer)); this.clock = clock ?? TimeProvider.System; this.ledger = ledger ?? host as ILedgerService; }

    /// <summary>Only save metadata for an ALREADY matching core book/chart. This does not create or
    /// change core accounts/opening balances; that atomic extension belongs to the integration owner.</summary>
    public void RegisterBookDefinition(ModuleLedgerSnapshot edited, NonprofitBookDefinition definition, string operatorId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(operatorId); authorizer.Require(operatorId, NonprofitPermission.Initialize);
        RequireBook(edited); ValidateDefinition(edited, definition);
        if (Documents(edited).Any(d => d.DocumentId == BookDocumentId))
            throw new NonprofitValidationException("NP_METADATA_EXISTS", "制度/科目元数据已存在；本切片不覆盖历史字段，请由集成者使用无损变更事务。");
        host.SaveModuleDocuments(new(ModuleId, Context(edited), [new(BookDocumentId, new(BookDocumentId, 1, JsonSerializer.Serialize(definition, Json)))]), operatorId);
    }

    public NonprofitBookDefinition ReadBookDefinition(ModuleLedgerSnapshot snapshot)
    {
        RequireBook(snapshot);
        var document = Documents(snapshot).SingleOrDefault(d => d.DocumentId == BookDocumentId)
            ?? throw new NonprofitValidationException("NP_METADATA_MISSING", "尚未在同账套注册完整制度、科目维度与限制证据，不能降级写入。");
        var definition = Read<NonprofitBookDefinition>(document); ValidateDefinition(snapshot, definition); return definition;
    }

    /// <summary>Use the same edited ModuleLedgerSnapshot through confirmation. No token refresh/retry.
    /// Source keys must identify stable business sources, supplied by the caller.</summary>
    public ModuleVoucherReceipt AcceptDraft(ModuleLedgerSnapshot edited, Guid proposalId,
        IReadOnlyList<string> sourceKeys, NonprofitVoucherDraft draft, string operatorId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(operatorId); authorizer.Require(operatorId, NonprofitPermission.EditVoucher);
        var definition = ReadBookDefinition(edited);
        if (proposalId == Guid.Empty || draft.Id.HasValue || draft.SourceProposalId.HasValue && draft.SourceProposalId != proposalId ||
            sourceKeys is not {Count: > 0} || sourceKeys.Any(string.IsNullOrWhiteSpace) || sourceKeys.Distinct(StringComparer.Ordinal).Count() != sourceKeys.Count)
            throw new NonprofitValidationException("NP_PROPOSAL_ID", "只接受具有稳定业务来源键的新草稿；不得以新随机来源绕过重复检查。");
        if (edited.ProposalReceipts.Any(r => r.ProposalId == proposalId || r.ModuleId == ModuleId && r.SourceKeys.Intersect(sourceKeys, StringComparer.Ordinal).Any()))
            throw new NonprofitValidationException("NP_DUPLICATE_REQUEST", "提案或业务来源已接纳；包括已删除的草稿，不能再次生成。");
        var existingIds = ReadAcceptedVouchers(edited).SelectMany(v => v.Enriched.Draft.Lines).Select(l => l.Id).ToHashSet();
        if (draft.Lines.Any(l => existingIds.Contains(l.Id)))
            throw new NonprofitValidationException("NP_LINE_ID", "稳定分录ID已用于其他业务来源。");
        var now = clock.GetUtcNow();
        var candidate = new NonprofitLedgerVoucher(proposalId, draft.Date, draft.Kind, draft.Number ?? 1, draft.AttachmentCount,
            operatorId, null, null, now, null, null, NonprofitVoucherState.Draft, draft.Role, draft.EvidenceReference,
            proposalId, draft.Lines, draft.OriginalFields);
        var state = ValidationSnapshot(definition, edited.Ledger) with { Vouchers = [candidate] };
        NonprofitLedgerValidation.Validate(state);
        if (draft.Lines.Any(l => !definition.Accounts.Single(a => a.Code == l.AccountCode).Active))
            throw new NonprofitValidationException("NP_INACTIVE_ACCOUNT", "停用科目不能录入新分录。");
        var accepted = new AcceptedNonprofitDraft(proposalId, edited.Ledger.Revision, now, operatorId,
            sourceKeys.ToArray(), draft with { SourceProposalId = proposalId });
        var id = ProposalDocumentPrefix + proposalId.ToString("N");
        var payload = JsonSerializer.Serialize(accepted, Json);
        // Base fields are an execution projection only. The complete DTO remains in this SAME transaction.
        var proposal = new VoucherProposal(proposalId, ModuleId, sourceKeys.ToArray(), Context(edited), draft.Date,
            draft.Kind, draft.Number, draft.AttachmentCount,
            draft.Lines.Select(l => new VoucherLine(l.AccountCode, l.Summary, l.Debit, l.Credit)).ToArray(),
            [new(id, new(id, 1, payload))]);
        return host.AcceptVoucherProposal(proposal, operatorId);
    }

    /// <summary>Join receipts and enriched data from one revision. Deleted drafts remain claimed.
    /// Core edits that cannot preserve classification are an explicit conflict, never silently accepted.</summary>
    public IReadOnlyList<AcceptedNonprofitVoucher> ReadAcceptedVouchers(ModuleLedgerSnapshot snapshot)
    {
        RequireBook(snapshot); var docs = Documents(snapshot); var result = new List<AcceptedNonprofitVoucher>();
        foreach (var receipt in snapshot.ProposalReceipts.Where(r => r.ModuleId == ModuleId))
        {
            var id = ProposalDocumentPrefix + receipt.ProposalId.ToString("N");
            var doc = docs.SingleOrDefault(d => d.DocumentId == id) ?? throw new InvalidDataException("接纳收据缺少同事务完整民非文档：" + id);
            var accepted = Read<AcceptedNonprofitDraft>(doc);
            if (accepted.ProposalId != receipt.ProposalId || accepted.SourceLedgerRevision >= receipt.Revision ||
                !accepted.SourceKeys.ToHashSet(StringComparer.Ordinal).SetEquals(receipt.SourceKeys))
                throw new InvalidDataException("民非提案身份、来源键或版本不匹配。");
            var voucher = snapshot.Ledger.Vouchers.SingleOrDefault(v => v.Id == receipt.VoucherId);
            if (voucher is not null)
            {
                var d = accepted.Draft;
                if (voucher.Date != d.Date || voucher.Kind != d.Kind.Trim() || voucher.AttachmentCount != d.AttachmentCount ||
                    voucher.Lines.Count != d.Lines.Count || !voucher.Lines.SequenceEqual(d.Lines.Select(l => new VoucherLine(l.AccountCode.Trim(), l.Summary.Trim(), l.Debit, l.Credit))))
                    throw new NonprofitValidationException("NP_PARITY_VOUCHER_CHANGED", "公共草稿已改变且未同步完整民非行ID/分类/维度；请用同事务增强编辑接口重新核对，不能沿用旧分类。");
                // Number may change via the original explicit renumber flow. The receipt's permanent voucher ID is authoritative.
            }
            result.Add(new(receipt, accepted, voucher));
        }
        foreach (var doc in docs.Where(d => d.DocumentId.StartsWith(ProposalDocumentPrefix, StringComparison.Ordinal)))
            if (!result.Any(r => ProposalDocumentPrefix + r.Receipt.ProposalId.ToString("N") == doc.DocumentId))
                throw new InvalidDataException("完整民非文档缺少同事务来源收据：" + doc.DocumentId);
        return result.AsReadOnly();
    }

    public static ParityModuleRegistration Registration { get; } = new(ModuleId, 1, Array.AsReadOnly(new[]
    {
        new OriginalWindowReference("minfeiqi/main", "w_pz_pzedit", "unknown:original-runtime-caller"),
        new OriginalWindowReference("minfeiqi/main", "w_zw_jz", "menu:m_frame_zw/m_o/m_o10/m_o10_30"),
        new OriginalWindowReference("minfeiqi/main", "w_zw_ydjz", "menu:m_frame_zw/m_o/m_o20/m_o20_15")
    }));
    private static LedgerMutationContext Context(ModuleLedgerSnapshot source) => new(source.Ledger.Book.Id, source.Ledger.Revision);
    private static void RequireBook(ModuleLedgerSnapshot source)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (source.Ledger.Book.Regime != AccountingRegime.Nonprofit)
            throw new NonprofitValidationException("NP_REGIME", "此适配只接受民非账套。");
    }
    private static IReadOnlyList<LedgerModuleDocument> Documents(ModuleLedgerSnapshot source) =>
        source.Modules.SingleOrDefault(m => m.ModuleId == ModuleId)?.Documents ?? [];
    private static T Read<T>(LedgerModuleDocument document)
    {
        if (document.SchemaVersion != 1) throw new InvalidDataException("民非模块文档版本尚不支持；禁止降级或丢弃未知字段。");
        using (var json = JsonDocument.Parse(document.PayloadJson)) Duplicates(json.RootElement);
        return JsonSerializer.Deserialize<T>(document.PayloadJson, Json) ?? throw new InvalidDataException("民非模块文档为空。");
    }
    private static void Duplicates(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var item in element.EnumerateObject())
            { if (!seen.Add(item.Name)) throw new InvalidDataException("民非模块文档含重复字段：" + item.Name); Duplicates(item.Value); }
        }
        else if (element.ValueKind == JsonValueKind.Array) foreach (var item in element.EnumerateArray()) Duplicates(item);
    }
    private static NonprofitLedgerSnapshot ValidationSnapshot(NonprofitBookDefinition d, LedgerSnapshot ledger) => new(1,
        d.BookId, d.BookCode, d.Name, d.OriginalTemplateId, d.ChartEvidenceReference, d.FiscalYear, d.StartMonth,
        ledger.Book.ClosedThroughMonth, ledger.Revision, false, ledger.Vouchers.Any(v => v.Status == VoucherStatus.Posted),
        d.Accounts, [], d.Restrictions, [], [], d.OriginalFields);
    private static void ValidateDefinition(ModuleLedgerSnapshot source, NonprofitBookDefinition d)
    {
        if (d.BookId != source.Ledger.Book.Id || d.Name != source.Ledger.Book.Name || d.FiscalYear != source.Ledger.Book.FiscalYear || d.StartMonth != source.Ledger.Book.StartMonth)
            throw new NonprofitValidationException("NP_BOOK", "制度元数据必须匹配当前账套身份与年度。");
        NonprofitLedgerValidation.Validate(ValidationSnapshot(d, source.Ledger));
        if (d.Accounts.Count != source.Ledger.Accounts.Count || d.Accounts.Any(a => !source.Ledger.Accounts.Any(c => c.Code == a.Code && c.Name == a.Name && c.ParentCode == a.ParentCode && c.IsActive == a.Active && (c.Direction == BalanceDirection.Credit) == a.CreditNormal)))
            throw new NonprofitValidationException("NP_CHART_CHANGED", "公共科目与完整民非科目元数据不一致；须在同一revision保留原字段、flags与根映射，不能自动套用旧模板。");
    }
}
