using System.Text.Json;
using System.Text.Json.Serialization;
using Caiwu.Contracts;
using Caiwu.Costing.Parity;

namespace Caiwu.Costing.Adapters;

/// <summary>Adapter for Contracts checkpoint 5bb60d2. Supply one user-observed module snapshot.
/// Each instance permits one submission; only explicit reload creates a new decision context.</summary>
public sealed class ParityInventoryAdapter : IInventoryBookStore
{
    public const string ModuleId = "inventory";
    public const int SchemaVersion = 1;
    private readonly IParityLedgerService service;
    private readonly ModuleLedgerSnapshot snapshot;
    private readonly string actor;
    private bool submitted;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 64,
        RespectRequiredConstructorParameters = true,
        RespectNullableAnnotations = true
    };
    public ParityInventoryAdapter(IParityLedgerService service, ModuleLedgerSnapshot userObservedSnapshot, string actor)
    {
        this.service = service ?? throw new ArgumentNullException(nameof(service));
        ArgumentNullException.ThrowIfNull(userObservedSnapshot);
        snapshot = userObservedSnapshot with
        {
            Ledger = userObservedSnapshot.Ledger with { Accounts = Array.AsReadOnly(userObservedSnapshot.Ledger.Accounts.ToArray()) },
            Modules = Array.AsReadOnly(userObservedSnapshot.Modules.Select(m => m with { Documents = Array.AsReadOnly(m.Documents.ToArray()) }).ToArray()),
            ProposalReceipts = Array.AsReadOnly(userObservedSnapshot.ProposalReceipts.Select(r => r with { SourceKeys = Array.AsReadOnly(r.SourceKeys.ToArray()) }).ToArray())
        };
        CostMath.Text(actor, "操作人"); this.actor = actor;
    }
    public static ParityModuleRegistration Registration { get; } = new(ModuleId, 1, Array.AsReadOnly<OriginalWindowReference>([
        new("chengben/main", "w_cb_hz", "menu:m_frame_cb/m_o/m_o_60"),
        new("chengben/main", "w_cb_fgz", "menu:m_frame_cb/m_s/m_s_30"),
        new("chengben/main", "w_cb_ckxz", "event:w_cb_qc.open")
    ]));
    public InventoryBook Load(Guid bookId)
    {
        Ready(bookId);
        var collection = snapshot.Modules.SingleOrDefault(m => m.ModuleId == ModuleId);
        var doc = collection?.Documents.SingleOrDefault(d => d.DocumentId == DocumentId(bookId))
            ?? throw new CostingValidationException("此账套尚无库存模块状态；请显式建立模块期间，不自动初始化原账套。");
        CostMath.Require(doc.SchemaVersion == SchemaVersion, "库存模块版本未知，不能降级读取后覆盖。");
        try
        {
            using var parsed = JsonDocument.Parse(doc.PayloadJson, new JsonDocumentOptions { MaxDepth = 64 });
            UniqueKeys(parsed.RootElement);
            var book = JsonSerializer.Deserialize<InventoryBook>(doc.PayloadJson, JsonOptions)
                ?? throw new CostingValidationException("库存模块状态为空。");
            CostMath.Require(book.Id == bookId, "库存状态属于其他账套。");
            InventoryRules.Validate(book);
            return InventoryRules.Freeze(book);
        }
        catch (JsonException ex) { throw new CostingValidationException($"库存状态结构未知或无效，保留原始文档并停止覆盖：{ex.Message}"); }
    }
    public void Initialize(InventoryBook book)
    {
        Ready(book.Id); InventoryRules.Validate(book);
        CostMath.Require(!snapshot.Modules.Where(m => m.ModuleId == ModuleId).SelectMany(m => m.Documents).Any(d => d.DocumentId == DocumentId(book.Id)),
            "库存模块已有状态，不能重新初始化。");
        submitted = true;
        try { service.SaveModuleDocuments(new(ModuleId, Context(), Array.AsReadOnly([Change(book)])), actor); }
        catch (StoreConcurrencyException ex) { throw new CostingConcurrencyException(ex.Message); }
        catch (LedgerValidationException ex) { throw new CostingValidationException(ex.Message); }
    }
    public bool TryCommit(long expectedRevision, InventoryBook next)
    {
        var current = Load(next.Id);
        if (current.Revision != expectedRevision || next.Revision != checked(expectedRevision + 1)) return false;
        InventoryRules.Validate(next);
        submitted = true;
        try
        {
            service.SaveModuleDocuments(new(ModuleId, Context(), Array.AsReadOnly([Change(next)])), actor);
            return true;
        }
        catch (StoreConcurrencyException) { return false; }
        catch (LedgerValidationException ex) { throw new CostingValidationException(ex.Message); }
    }
    /// <summary>One confirmed planned voucher. Module claim + stable source key + new GL draft are one host operation.
    /// This method never retries and never marks local state successful after an exception.</summary>
    public ModuleVoucherReceipt AcceptPlan(InventoryVoucherPlan plan, string sourceKey, Guid proposalId,
        string voucherKind, int? number, int attachmentCount)
    {
        var book = Load(plan.BookId); InventoryVoucherPlanner.ValidateSource(book, plan);
        var voucher = plan.Vouchers.SingleOrDefault(v => v.SourceKey == sourceKey)
            ?? throw new CostingValidationException("凭证来源不在计划中。");
        // v1 VoucherLine has no auxiliary/currency/quantity schema. Preserve those rows but do not flatten them into GL.
        CostMath.Require(!HasOriginalRows(book), "原始行的辅助、外币、数量及未知字段尚未完成总账映射；已保留模块数据，禁止删字段生成简化凭证。");
        CostMath.Require(!snapshot.ProposalReceipts.Any(r => r.ModuleId == ModuleId &&
            (r.ProposalId == proposalId || r.SourceKeys.Contains(sourceKey))), "此凭证建议或来源已经提交，不得更换随机来源键绕过防重。");
        var next = InventoryWorkflow.ClaimPlan(book, plan, sourceKey, proposalId, actor, book.Revision);
        var proposal = new VoucherProposal(proposalId, ModuleId, Array.AsReadOnly([sourceKey]), Context(), voucher.Date,
            voucherKind, number, attachmentCount, Array.AsReadOnly(voucher.Lines.Select(l => new VoucherLine(l.AccountCode, l.Summary, l.Debit, l.Credit)).ToArray()),
            Array.AsReadOnly([Change(next)]));
        submitted = true;
        try { return service.AcceptVoucherProposal(proposal, actor); }
        catch (StoreConcurrencyException ex) { throw new CostingConcurrencyException(ex.Message); }
        catch (LedgerValidationException ex) { throw new CostingValidationException(ex.Message); }
    }
    public static IReadOnlyList<InventoryAccount> AccountCatalog(ModuleLedgerSnapshot snapshot) =>
        Array.AsReadOnly(snapshot.Ledger.Accounts.Select(a => new InventoryAccount(a.Code, a.IsActive,
            !snapshot.Ledger.Accounts.Any(c => c.ParentCode == a.Code))).ToArray());
    private static bool HasOriginalRows(InventoryBook b) => b.Products.Any(p => p.OriginalRows.Count != 0) || b.Openings.Any(p => p.OriginalRows.Count != 0) ||
        b.Documents.Any(d => d.OriginalRows.Count != 0 || d.Lines.Any(l => l.OriginalRows.Count != 0)) || b.Stocktakes.Any(t => t.OriginalRows.Count != 0);
    private LedgerMutationContext Context() => new(snapshot.Ledger.Book.Id, snapshot.Ledger.Revision);
    private void Ready(Guid id)
    {
        if (submitted) throw new CostingConcurrencyException("此编辑上下文已提交或结果需核实，请显式重新读取同一账套快照后再操作。");
        CostMath.Require(snapshot.Ledger.Book.Id == id, "库存操作与当前账套不一致，禁止跨账套保存。");
    }
    private static ModuleDocumentChange Change(InventoryBook b) => new(DocumentId(b.Id), new(DocumentId(b.Id), SchemaVersion, JsonSerializer.Serialize(b, JsonOptions)));
    private static string DocumentId(Guid id) => $"inventory-book-{id:N}";
    private static void UniqueKeys(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var p in element.EnumerateObject())
            { CostMath.Require(names.Add(p.Name), "库存状态含重复 JSON 字段；保留原文并停止覆盖。"); UniqueKeys(p.Value); }
        }
        else if (element.ValueKind == JsonValueKind.Array) foreach (var e in element.EnumerateArray()) UniqueKeys(e);
    }
}
