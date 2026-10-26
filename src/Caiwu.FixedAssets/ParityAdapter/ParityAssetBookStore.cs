using System.Collections.Immutable;
using Caiwu.Contracts;

namespace Caiwu.FixedAssets.ParityAdapter;

/// <summary>
/// PR52 v1 adapter. Requires the integrator's IParityLedgerService implementation and a live authorized host session.
/// The module document is authoritative in that same ledger; synthetic external files are never enlisted.
/// </summary>
public sealed class ParityAssetBookStore : IAssetBookStore
{
    public const string ModuleId = "assets";
    public const string DocumentId = "assets-book-v1";
    private readonly IParityLedgerService ledger;
    private readonly AssetBookState initial;
    private readonly Guid hostBookId;
    private readonly string actor;
    private readonly object gate = new();
    private ModuleLedgerSnapshot? readSnapshot;
    private AssetPeriod? moduleClosedThrough;

    public ParityAssetBookStore(IParityLedgerService ledger, Guid hostBookId, AssetBookState initial, string actor)
    {
        if (hostBookId == Guid.Empty || string.IsNullOrWhiteSpace(actor)) throw new ArgumentException("A bound book and authorized actor are required.");
        AssetBookService.ValidateSnapshot(initial);
        this.ledger = ledger; this.hostBookId = hostBookId; this.initial = initial; this.actor = actor;
    }
    public AssetBookState Load()
    {
        lock (gate)
        {
            var snapshot = ledger.GetModuleSnapshot();
            if (snapshot.Ledger.Book.Id != hostBookId) throw new AssetRuleException("book-mismatch", "宿主账套已切换，请重新打开固定资产。");
            var collection = snapshot.Modules.SingleOrDefault(x => x.ModuleId == ModuleId);
            var document = collection?.Documents.SingleOrDefault(x => x.DocumentId == DocumentId);
            AssetBookState state;
            try
            {
                state = document is null ? initial : document.SchemaVersion == AssetModuleDocumentCodec.SchemaVersion ?
                    AssetModuleDocumentCodec.Deserialize(document.PayloadJson) : throw new AssetRuleException("module-schema", "不支持的固定资产文档版本，不能降级保存。");
            }
            catch (Exception ex) when (ex is System.Text.Json.JsonException or FormatException)
            { throw new AssetRuleException("module-data", "固定资产模块文档格式不正确，未进行修改。"); }
            moduleClosedThrough = state.ClosedThrough;
            if (state.Identity != initial.Identity || state.Revision > snapshot.Ledger.Revision)
                throw new AssetRuleException("book-mismatch", "固定资产模块身份或版本不一致。");
            // A module document can be older than the ledger after unrelated changes. UI tokens always use this whole-book read.
            var closed = snapshot.Ledger.Book.ClosedThroughMonth > 0 ? new AssetPeriod(snapshot.Ledger.Book.FiscalYear, snapshot.Ledger.Book.ClosedThroughMonth) : state.ClosedThrough;
            if (state.ClosedThrough is { } moduleClosed && (closed is null || moduleClosed > closed.Value)) closed = moduleClosed;
            var receipts = snapshot.ProposalReceipts.Where(x => x.ModuleId == ModuleId).Select(x =>
                new AssetVoucherReceipt(x.ProposalId, x.VoucherId, x.Revision, x.SourceKeys.ToImmutableArray())).ToImmutableArray();
            var accounts = snapshot.Ledger.Accounts.Select(a => new AssetAccount(a.Code, a.IsActive,
                !snapshot.Ledger.Accounts.Any(child => child.ParentCode == a.Code))).ToImmutableArray();
            state = state with { Revision = snapshot.Ledger.Revision, ClosedThrough = closed, VoucherReceipts = receipts,
                Settings = state.Settings with { Catalog = state.Settings.Catalog with { Accounts = accounts } } };
            readSnapshot = snapshot; return state;
        }
    }
    public bool TrySave(AssetBookIdentity identity, long expectedRevision, AssetBookState next)
    {
        lock (gate)
        {
            var snapshot = readSnapshot;
            if (snapshot is null || identity != initial.Identity || snapshot.Ledger.Book.Id != hostBookId ||
                snapshot.Ledger.Revision != expectedRevision) return false;
            if (next.Identity != identity || next.Revision != expectedRevision + 1)
                throw new ArgumentException("Invalid asset document identity or revision.", nameof(next));
            // Ledger close/reopen is an overlay, not an asset-owned permanent lock.
            var payload = AssetModuleDocumentCodec.Serialize(next with { ClosedThrough = moduleClosedThrough });
            // No token-refresh/read/retry here. Core rejects concurrent changes using this exact editing snapshot.
            try
            {
                ledger.SaveModuleDocuments(new(ModuleId, new(hostBookId, expectedRevision),
                    [new(DocumentId, new(DocumentId, AssetModuleDocumentCodec.SchemaVersion, payload))]), actor);
            }
            catch (StoreConcurrencyException ex) { throw new AssetRuleException("stale-revision", ex.Message); }
            catch (LedgerValidationException ex) { throw new AssetRuleException("ledger-validation", ex.Message); }
            readSnapshot = null;
            return true;
        }
    }

    /// <summary>
    /// The current shared VoucherLine lacks asset department/other dimensions. Fail before any source claim or voucher mutation.
    /// The reviewed rich line extension/metadata contract is required before this bridge can call AcceptVoucherProposal.
    /// </summary>
    public VoucherProposal PrepareVoucherProposal(AssetVoucherPlan plan)
    {
        lock (gate)
        {
            var snapshot = readSnapshot ?? throw new AssetRuleException("snapshot-required", "请从同一个账套快照准备凭证。");
            var collection = snapshot.Modules.SingleOrDefault(x => x.ModuleId == ModuleId);
            var document = collection?.Documents.SingleOrDefault(x => x.DocumentId == DocumentId);
            var state = document is null ? initial : AssetModuleDocumentCodec.Deserialize(document.PayloadJson);
            var stored = state.VoucherPlans.SingleOrDefault(x => x.Id == plan.Id && x.SourceKey == plan.SourceKey);
            if (stored is null || stored.Voided) throw new AssetRuleException("plan-missing", "凭证计划不存在或已撤销。");
            throw new AssetRuleException("rich-voucher-contract-required", "公共凭证接口缺少部门等辅助字段，不能无损提交固定资产凭证计划。");
        }
    }
    public static ParityModuleRegistration Registration { get; } = new(ModuleId, 1,
        new[] { "minfeiqi/main", "chengben/main" }.SelectMany(product => new[]
        {
            new OriginalWindowReference(product, "w_zc_zcgl", "menu:m_frame_zc/m_o/m_o_10"),
            new OriginalWindowReference(product, "w_zcgl_kp", "event:w_zc_zcgl.ue_action_new"),
            new OriginalWindowReference(product, "w_zcgl_delete", "event:w_zc_zcgl.ue_clear"),
            new OriginalWindowReference(product, "w_zcgl_yztz", "event:w_zc_zcgl.ue_action_yztz"),
            new OriginalWindowReference(product, "w_zjjs", "menu:m_frame_zc/m_o/m_o_20"),
            new OriginalWindowReference(product, "w_zc_qxfz", "menu:m_frame_zc/m_s/m_s_20"),
            new OriginalWindowReference(product, "w_zjgl", "menu:m_frame_zc/m_o/m_o_30"),
            new OriginalWindowReference(product, "w_pz_build", "event:w_zjgl.u_pz")
        }).ToArray());
}
