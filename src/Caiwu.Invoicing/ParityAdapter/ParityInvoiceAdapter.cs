using System.Collections.Immutable;
using System.Security.Cryptography;
using System.Text;
using Caiwu.Contracts;

namespace Caiwu.Invoicing.ParityAdapter;

public sealed record InvoiceModuleState(int SchemaVersion, Guid BookId, InvoiceProduct Product,
    InvoiceMonth OpeningMonth, InvoiceMonth OpenMonth, ImmutableArray<InvoiceDocument> Documents);

/// <summary>Caller must obtain account/auxiliary metadata from its authorized host before selecting this scope.
/// Current shared VoucherLine cannot encode foreign currency, quantities, cash flow or auxiliary dimensions.</summary>
public enum InvoicePostingScope { VerifiedBaseCurrencyWithoutAuxiliary }

/// <summary>Pure snapshot adapter for PR52 contract 5bb60d2. Never refreshes a caller's context,
/// never writes external JSON, and never labels an unaccepted proposal as posted.</summary>
public static class ParityInvoiceAdapter
{
    public const string ModuleId = "invoices";
    public const string DocumentId = "workspace";

    public static InvoiceWorkspace Read(ModuleLedgerSnapshot snapshot, InvoiceProduct product)
    {
        if (!Enum.IsDefined(product)) throw new InvoiceException("product", "发票产品无效。");
        var module = snapshot.Modules.SingleOrDefault(x => x.ModuleId == ModuleId);
        var document = module?.Documents.SingleOrDefault(x => x.DocumentId == DocumentId);
        var ledger = snapshot.Ledger;
        InvoiceModuleState state;
        if (document is null)
        {
            var start = new InvoiceMonth(ledger.Book.FiscalYear, ledger.Book.StartMonth);
            var openDate = new DateOnly(ledger.Book.FiscalYear, Math.Max(1, ledger.Book.ClosedThroughMonth), 1);
            if (ledger.Book.ClosedThroughMonth != 0) openDate = openDate.AddMonths(1);
            var open = InvoiceMonth.From(openDate);
            if (open.CompareTo(start) < 0) open = start;
            state = new(1, ledger.Book.Id, product, start, open, []);
        }
        else
        {
            if (document.SchemaVersion != 1) throw new InvoiceException("schema", "模块状态版本不受支持，不得降级保存。");
            state = InvoiceJson.Deserialize<InvoiceModuleState>(document.PayloadJson);
            if (state.SchemaVersion != 1 || state.BookId != ledger.Book.Id || state.Product != product)
                throw new InvoiceException("book-mismatch", "模块状态不属于当前账套/产品或版本不受支持。");
        }
        var parentCodes = ledger.Accounts.Where(x => x.ParentCode is not null).Select(x => x.ParentCode).ToHashSet(StringComparer.Ordinal);
        var accounts = ledger.Accounts.Select(x => new InvoiceAccount(x.Code, x.IsActive, !parentCodes.Contains(x.Code))).ToImmutableArray();
        var keys = state.Documents.ToDictionary(x => StableSourceKey(product, x.Key), x => x.Id, StringComparer.Ordinal);
        var journals = ledger.Vouchers.Select(voucher =>
        {
            var sourceIds = snapshot.ProposalReceipts.Where(x => x.ModuleId == ModuleId && x.VoucherId == voucher.Id)
                .SelectMany(x => x.SourceKeys).Where(keys.ContainsKey).Select(x => keys[x]).Distinct().ToImmutableArray();
            // Legacy numeric type mapping is not guessed from the core's free-text kind.
            var legacyTypes = state.Documents.Where(x => sourceIds.Contains(x.Id)).SelectMany(x => x.Rows)
                .Select(x => x.Number("p_pzlx")).Where(x => x is not null).Distinct().ToArray();
            var legacyType = legacyTypes.Length == 1 ? checked((int)legacyTypes[0]!.Value) : 0;
            return new InvoiceJournal(voucher.Id, InvoiceMonth.From(voucher.Date), legacyType, voucher.Number,
                voucher.Status is VoucherStatus.Reviewed or VoucherStatus.Posted, voucher.Status == VoucherStatus.Posted,
                sourceIds, voucher.Lines.Select(x => new PlannedLine(x.AccountCode, x.Summary, x.Debit, x.Credit)).ToImmutableArray());
        }).ToImmutableArray();
        return new(ledger.Book.Id, product, state.OpeningMonth, state.OpenMonth, ledger.Revision, state.Documents, journals, accounts);
    }

    public static ModuleDocumentBatch PrepareSave(ModuleLedgerSnapshot origin, InvoiceWorkspace edited)
    {
        var original = Read(origin, edited.Product);
        if (edited.BookId != original.BookId || edited.Revision != checked(origin.Ledger.Revision + 1))
            throw new InvoiceException("stale", "编辑状态必须来自同一快照的一次本地事务。");
        if (InvoiceJson.Serialize(original.Journals) != InvoiceJson.Serialize(edited.Journals))
            throw new InvoiceException("ledger-write", "模块存盘不能夹带合成总账变更，请使用凭证建议接口。");
        return new(ModuleId, Context(origin), [Change(edited)]);
    }

    public static VoucherProposal PrepareVoucherProposal(ModuleLedgerSnapshot origin, InvoiceProduct product,
        InvoiceVoucherPlan plan, Guid proposalId, string voucherKind, DateOnly voucherDate, InvoicePostingScope scope)
    {
        if (!Enum.IsDefined(scope) || proposalId == Guid.Empty || string.IsNullOrWhiteSpace(voucherKind))
            throw new InvoiceException("proposal-option", "请明确凭证类型、建议标识和已验证的投影范围。");
        var state = Read(origin, product);
        if (plan.BookId != state.BookId || plan.Product != product || plan.WorkspaceRevision != origin.Ledger.Revision)
            throw new InvoiceException("stale", "计划不属于当前同 revision 快照。");
        if (plan.Vouchers.Length != 1)
            throw new InvoiceException("proposal-batch", "当前公共接口每事务只接收一张新草稿；多张逐票计划需核心批量事务接口。");
        var service = new InvoiceService(new MemoryInvoiceStore(state));
        var checkedPlan = service.CreateVoucherPlan(plan.Request);
        if (InvoiceJson.Serialize(plan) != InvoiceJson.Serialize(checkedPlan))
            throw new InvoiceException("plan-tampered", "计划已变化，请重新生成。");
        var voucher = checkedPlan.Vouchers[0];
        if (InvoiceMonth.From(voucherDate) != plan.Request.VoucherMonth)
            throw new InvoiceException("voucher-date", "明确选择的凭证日期必须属于计划凭证月份。");
        if (origin.Ledger.Vouchers.Any(x => InvoiceMonth.From(x.Date) == plan.Request.VoucherMonth
                && x.Kind == voucherKind && x.Number == voucher.Number))
            throw new InvoiceException("duplicate-voucher", "已有重复凭证，不能生成！");
        var selected = state.Documents.Where(x => voucher.SourceIds.Contains(x.Id)).ToArray();
        string[] unrepresentable = ["xmbm", "dwbm", "bmbm", "grbm", "bz", "pz_wb", "pz_hl", "pz_sl", "pz_dj", "xjbm", "jslb", "pz_ph"];
        if (selected.SelectMany(x => x.Rows).Any(row => unrepresentable.Any(field =>
                !string.IsNullOrWhiteSpace(row.Text(field)) && row.Text(field) != "0")))
            throw new InvoiceException("voucher-dimensions", "源行包含当前凭证接口不能表达的辅助、外币、数量或结算字段；未生成简化建议。");
        var period = checkedPlan.Request.VoucherMonth;
        var documents = state.Documents.Select(doc => !voucher.SourceIds.Contains(doc.Id) ? doc : doc with
        {
            Version = doc.Version + 1,
            Rows = doc.Rows.Select(row => row.Set("pz_bz", "1").Set("p_nf", period.Year).Set("p_yf", period.Month)
                .Set("p_pzlx", plan.Request.VoucherType).Set("p_pzbh", voucher.Number)).ToImmutableArray()
        }).ToImmutableArray();
        // Source keys derive from business identity: deleting/reimporting with a new Guid cannot bypass core claims.
        var keys = selected.Select(x => StableSourceKey(product, x.Key)).ToArray();
        if (origin.ProposalReceipts.Where(x => x.ModuleId == ModuleId).SelectMany(x => x.SourceKeys).Any(keys.Contains))
            throw new InvoiceException("source-consumed", "该业务来源已经被总账接收；删除草稿不能绕过来源防重。");
        return new(proposalId, ModuleId, keys, Context(origin), voucherDate, voucherKind, voucher.Number, selected.Length,
            voucher.Lines.Select(x => new VoucherLine(x.AccountCode, x.Summary, x.Debit, x.Credit)).ToArray(),
            [Change(state with { Documents = documents })]);
    }

    public static ModuleVoucherReceipt AcceptPreparedProposal(IParityLedgerService target, VoucherProposal proposal, string operatorName)
    {
        if (proposal.ModuleId != ModuleId) throw new InvoiceException("module", "凭证建议不属于发票模块。");
        try { return target.AcceptVoucherProposal(proposal, operatorName); }
        catch (StoreConcurrencyException ex) { throw new InvoiceException("stale", ex.Message); }
        catch (LedgerValidationException ex) { throw new InvoiceException("ledger-validation", ex.Message); }
    }

    public static string StableSourceKey(InvoiceProduct product, InvoiceKey key) => "invoice:v1:" + Convert.ToHexString(
        SHA256.HashData(Encoding.UTF8.GetBytes(InvoiceJson.Serialize(new { Product = product, key.Direction, key.Kind, key.Code, key.Number }))));

    public static ImmutableArray<LedgerTaxLine> LedgerTaxLines(ModuleLedgerSnapshot snapshot) => snapshot.Ledger.Vouchers
        .SelectMany(voucher => voucher.Lines.Select(line => new LedgerTaxLine(voucher.Date, line.AccountCode, line.Debit, line.Credit))).ToImmutableArray();

    public static ParityModuleRegistration Registration(InvoiceProduct product)
    {
        var p = product switch { InvoiceProduct.Qingsong => "qingsong/fp", InvoiceProduct.Chengben => "chengben/fp",
            _ => throw new InvoiceException("product", "发票产品无效。") };
        return new(ModuleId, 1, [
            new(p, "w_fp_lr_1", "menu:m_frame_fp/m_o/m_o_10"),
            new(p, "w_fp_lr_2", "menu:m_frame_fp/m_o/m_o_pzsc"),
            new(p, "w_fp_pz", "menu:m_frame_fp/m_o/m_o_o35"),
            new(p, "w_fp_zzs_hz", "menu:m_frame_fp/m_o/m_o_30")]);
    }

    private static LedgerMutationContext Context(ModuleLedgerSnapshot snapshot) => new(snapshot.Ledger.Book.Id, snapshot.Ledger.Revision);
    private static ModuleDocumentChange Change(InvoiceWorkspace workspace)
    {
        var state = new InvoiceModuleState(1, workspace.BookId, workspace.Product, workspace.OpeningMonth, workspace.OpenMonth, workspace.Documents);
        return new(DocumentId, new LedgerModuleDocument(DocumentId, 1, InvoiceJson.Serialize(state)));
    }
}
