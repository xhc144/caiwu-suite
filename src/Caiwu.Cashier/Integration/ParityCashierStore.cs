using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Caiwu.Contracts;

namespace Caiwu.Cashier.Integration;

/// <summary>
/// Bridge for PR52 parity contract v1. The authoritative module document lives in the same
/// account-book transaction as vouchers. Requires the actual Core implementation and operator session.
/// No external synthetic database participates in this path.
/// </summary>
public sealed class ParityCashierStore(IParityLedgerService ledger, BookDefinition definition, string actor) : ICashierStore
{
    public const string ModuleId = "cashier";
    public const string StateDocumentId = "state";
    public const int StateSchemaVersion = 1;
    public bool HasAuthoritativeLedgerSnapshot => true;

    public CashierSnapshot Read() => Project(ledger.GetModuleSnapshot(), definition);

    public CashierSnapshot Transact(long expectedRevision, Func<CashierSnapshot, CashierSnapshot> transform)
    {
        var sameSnapshot = ledger.GetModuleSnapshot();
        var current = Project(sameSnapshot, definition);
        if (current.Revision != expectedRevision) throw new CashierConcurrencyException(expectedRevision, current.Revision);
        var changed = transform(current) with { Revision = checked(expectedRevision + 1) };
        if (changed.Book.Id != current.Book.Id) throw new CashierRuleException("store.book", "事务不能切换账套身份。");
        try { ledger.SaveModuleDocuments(new(ModuleId, Context(sameSnapshot), [Change(changed)]), actor); }
        catch (StoreConcurrencyException e)
        {
            // CAS can lose after the read above. Preserve the original context and exception; do not
            // fetch the winning revision or retry. The module's WPF boundary handles this exception.
            throw new CashierConcurrencyException(expectedRevision, e);
        }
        // Core v1 performs one whole-book write, incrementing revision by one. Never refresh/retry a failed context.
        return Clone(changed);
    }

    public static ParityModuleRegistration Registration { get; } = new(ModuleId, 1,
        Array.AsReadOnly(new OriginalWindowReference[]
        {
            new("qingsong/cn", "w_cn_lr_qc", "menu:m_frame_cn/m_s/m_s20"),
            new("qingsong/cn", "w_cn_lr", "menu:m_frame_cn/m_o/m_o_10"),
            new("qingsong/cn", "w_cn_lr_add", "event:w_cn_lr.ue_action_new"),
            new("qingsong/cn", "w_cn_dz_xz", "menu:m_frame_cn/m_o/m_o_20"),
            new("qingsong/cn", "w_cn_dz", "event:w_cn_dz_xz.cb_1.clicked"),
            new("qingsong/cn", "w_cn_pz", "menu:m_frame_cn/m_o/m_o_60")
        }));

    internal static CashierSnapshot Project(ModuleLedgerSnapshot snapshot, BookDefinition definition)
    {
        if (!Guid.TryParse(definition.Id, out var bookId) || bookId != snapshot.Ledger.Book.Id)
            throw new CashierRuleException("store.book", "出纳定义与当前公共账套身份不一致。");
        if (definition.OpeningDate.Year != snapshot.Ledger.Book.FiscalYear || definition.OpeningDate.Month != snapshot.Ledger.Book.StartMonth)
            throw new CashierRuleException("store.period", "出纳开账日期与公共账套期间不一致。");
        if (definition.BaseCurrency != "CNY")
            throw new CashierRuleException("store.currency.gap", "公共总账 v1 只提供人民币分录，不能猜测其他本位币映射。");
        var collections = snapshot.Modules.Where(x => x.ModuleId == ModuleId).ToArray();
        if (collections.Length > 1) throw new InvalidDataException("出纳模块集合重复。");
        var documents = collections.SingleOrDefault()?.Documents.Where(x => x.DocumentId == StateDocumentId).ToArray() ?? [];
        if (documents.Length > 1) throw new InvalidDataException("出纳状态文档重复。");
        var stored = documents.SingleOrDefault();
        if (stored is not null && stored.SchemaVersion != StateSchemaVersion)
            throw new InvalidDataException("出纳状态文档版本未支持；不能降级保存。");
        var state = stored is null ? CashierSnapshot.Empty(definition)
            : JsonSerializer.Deserialize<CashierSnapshot>(stored.PayloadJson) ?? throw new InvalidDataException("出纳状态无法读取。");
        if (state.Book.Id != definition.Id) throw new InvalidDataException("出纳状态属于其他账套。");
        if (!SameDefinition(state.Book, definition))
            throw new CashierRuleException("store.definition.changed",
                "当前出纳科目、币种或日期定义与已保存状态不同；请先显式核对并迁移定义，未沿用旧定义或写入数据。");
        var active = new DateOnly(snapshot.Ledger.Book.FiscalYear, 1, 1).AddMonths(snapshot.Ledger.Book.ClosedThroughMonth);
        var book = state.Book with { ActiveMonth = active };
        // Cash-flow flags and currency definitions are explicitly supplied, never inferred from code prefixes.
        foreach (var a in book.Accounts.Where(x => x.IsDetail && x.HasCashFlow))
            if (!snapshot.Ledger.Accounts.Any(x => x.Code == a.Code && x.IsActive)
                || snapshot.Ledger.Accounts.Any(x => x.ParentCode == a.Code))
                throw new CashierRuleException("store.catalog", "出纳账户的公共科目缺失、停用或不是明细科目。");
        var projected = snapshot.Ledger.Vouchers.SelectMany(v => v.Lines.Select((line, index) => (v, line, index)))
            .Where(x => book.Accounts.Any(a => a.Code == x.line.AccountCode && a.IsDetail && a.HasCashFlow
                && a.Currencies.Contains(book.BaseCurrency)))
            .Select(x => new LedgerEntry($"voucher:{x.v.Id:D}:line:{x.index.ToString(CultureInfo.InvariantCulture)}",
                Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
                { x.v.Id, x.v.Date, x.v.Kind, x.v.Number, x.v.Status, x.index, x.line })))),
                new(x.line.AccountCode, book.BaseCurrency), x.v.Date, x.v.Id.ToString("D"), x.line.Summary,
                x.line.Debit, x.line.Credit, x.v.Status == VoucherStatus.Posted)).ToArray();
        var indexById = projected.ToDictionary(x => x.Id, StringComparer.Ordinal);
        foreach (var old in state.LedgerEntries.Where(x => x.ReconciliationCode.HasValue))
        {
            if (!indexById.TryGetValue(old.Id, out var live) || live.Revision != old.Revision)
                throw new CashierRuleException("ledger.matched.changed", "已勾账的公共分录已变化；需集成者处理对账冲突，未写入任何数据。");
            indexById[old.Id] = live with { ReconciliationCode = old.ReconciliationCode, OriginalFields = old.OriginalFields };
        }
        var receipts = snapshot.ProposalReceipts.Where(x => x.ModuleId == ModuleId)
            .SelectMany(r => r.SourceKeys.Select(k => (Key: k, Receipt: r))).ToDictionary(x => x.Key, x => x.Receipt, StringComparer.Ordinal);
        var cashierDocs = state.Documents.Select(d => receipts.TryGetValue(SourceKey(d.Id), out var receipt)
            ? d with { GeneratedVoucherId = receipt.VoucherId.ToString("D") } : d).ToArray();
        return Clone(state with { Revision = snapshot.Ledger.Revision, Book = book, Documents = cashierDocs,
            LedgerEntries = indexById.Values.ToArray() });
    }

    internal static LedgerMutationContext Context(ModuleLedgerSnapshot s) => new(s.Ledger.Book.Id, s.Ledger.Revision);
    internal static ModuleDocumentChange Change(CashierSnapshot state) => new(StateDocumentId,
        new LedgerModuleDocument(StateDocumentId, StateSchemaVersion, JsonSerializer.Serialize(state)));
    internal static string SourceKey(Guid id) => $"document:{id:D}";
    internal static CashierSnapshot Clone(CashierSnapshot state) => JsonSerializer.Deserialize<CashierSnapshot>(JsonSerializer.Serialize(state))!;

    private static bool SameDefinition(BookDefinition saved, BookDefinition current) =>
        saved.Id == current.Id && saved.OpeningDate == current.OpeningDate
        && saved.LatestDocumentDate == current.LatestDocumentDate && saved.BaseCurrency == current.BaseCurrency
        && saved.Accounts.Length == current.Accounts.Length
        && saved.Accounts.Zip(current.Accounts).All(pair => pair.First.Code == pair.Second.Code
            && pair.First.Name == pair.Second.Name && pair.First.IsDetail == pair.Second.IsDetail
            && pair.First.HasCashFlow == pair.Second.HasCashFlow
            && pair.First.Currencies.SequenceEqual(pair.Second.Currencies, StringComparer.Ordinal));
    // ActiveMonth deliberately comes from the same authoritative LedgerSnapshot on every read.
    // It is the sole derived field, not a host-defined catalog or permission policy to silently retain.
}
