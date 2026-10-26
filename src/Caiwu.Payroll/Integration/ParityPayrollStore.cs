using System.Text.Json;
using System.Globalization;
using Caiwu.Contracts;

namespace Caiwu.Payroll.Integration;

/// <summary>Adapter for PR52's frozen v1 contract. The module document is authoritative
/// inside the ledger transaction. Does not write an external SQLite projection.</summary>
public sealed class ParityPayrollStore : IPayrollStore
{
    public const string ModuleId = "payroll";
    public const string DocumentId = "payroll-state";
    private readonly IParityLedgerService ledger;
    private readonly string actor;
    private ModuleLedgerSnapshot? initialSnapshot;
    private long expectedRevision;
    public Guid BookId { get; }
    private static readonly JsonSerializerOptions Options = new() { MaxDepth = 64 };

    public ParityPayrollStore(IParityLedgerService ledger, ModuleLedgerSnapshot observedSnapshot, string actor)
    {
        this.ledger = ledger;
        this.actor = actor;
        BookId = observedSnapshot.Ledger.Book.Id;
        expectedRevision = observedSnapshot.Ledger.Revision;
        initialSnapshot = observedSnapshot;
    }

    public PayrollDocument Read()
    {
        // First load uses the user's observed snapshot verbatim, never a new token.
        // Later calls correspond to the host's explicit Refresh action.
        var snapshot = initialSnapshot ?? ledger.GetModuleSnapshot();
        initialSnapshot = null;
        Require(snapshot.Ledger.Book.Id == BookId, "切换账套后必须重新建立工资模块会话。");
        var modules = snapshot.Modules.Where(m => m.ModuleId == ModuleId).ToArray();
        Require(modules.Length <= 1, "工资模块状态存在重复集合。");
        var records = modules.SelectMany(m => m.Documents).Where(d => d.DocumentId == DocumentId).ToArray();
        Require(records.Length <= 1, "工资模块状态存在重复文档。");
        PayrollDocument result;
        if (records.Length == 0)
            result = new() { BookId = BookId, BookName = snapshot.Ledger.Book.Name,
                OpeningMonth = new(snapshot.Ledger.Book.FiscalYear, snapshot.Ledger.Book.StartMonth, 1) };
        else
        {
            Require(records[0].SchemaVersion == 1, "不支持此工资模块文档版本；不能降级保存。");
            try { result = JsonSerializer.Deserialize<PayrollDocument>(records[0].PayloadJson, Options)
                ?? throw new PayrollValidationException("工资模块文档为空。"); }
            catch (JsonException) { throw new PayrollValidationException("工资模块文档格式不正确。"); }
            Require(result.BookId == BookId && result.FormatVersion == 1, "工资模块文档账套身份或格式不一致。");
        }
        foreach (var receipt in snapshot.ProposalReceipts.Where(r => r.ModuleId == ModuleId))
        {
            var plan = result.VoucherPlans.SingleOrDefault(p => p.Id == receipt.ProposalId);
            if (plan is null) continue;
            Require(receipt.SourceKeys.Contains(plan.SourceKey, StringComparer.Ordinal), "工资凭证收据与来源不一致。");
            plan.Status = "accepted-draft";
            plan.VoucherId = receipt.VoucherId;
        }
        // Whole-book revision may advance due to another module without changing JSON.
        result.Revision = expectedRevision = snapshot.Ledger.Revision;
        return Clone(result);
    }

    public PayrollDocument Commit(PayrollDocument document, long expectedRevision)
    {
        CheckContext(document, expectedRevision);
        var next = Clone(document);
        next.Revision = checked(expectedRevision + 1);
        ledger.SaveModuleDocuments(new(ModuleId, new(BookId, expectedRevision), [Change(next)]), actor);
        this.expectedRevision = next.Revision;
        return next;
    }

    /// <summary>Only call after the user has reviewed this exact revision and plan.
    /// The host owns session authorization and rendering the resulting draft.</summary>
    public ModuleVoucherReceipt AcceptPlan(PayrollDocument confirmedDocument, Guid planId)
    {
        CheckContext(confirmedDocument, confirmedDocument.Revision);
        var next = Clone(confirmedDocument);
        var plan = next.VoucherPlans.SingleOrDefault(p => p.Id == planId)
            ?? throw new PayrollValidationException("工资凭证计划不存在。");
        Require(plan.Status == "planned", "工资凭证计划已转为草稿，不能重复转入。");
        Require(plan.BookId == BookId && plan.SourceKey == $"payroll:{BookId:D}:{plan.Month.ToString("yyyy-MM", CultureInfo.InvariantCulture)}:{plan.Request.Kind}",
            "工资凭证计划来源不一致。");
        var period = next.Periods.SingleOrDefault(p => p.Month == plan.Month)
            ?? throw new PayrollValidationException("工资月份不存在。");
        Require(plan.DataVersion == period.DataVersion && plan.ConfigurationVersion == next.ConfigurationVersion
            && period.CalculatedDataVersion == period.DataVersion
            && period.CalculatedConfigurationVersion == next.ConfigurationVersion, "工资计划已过期，请重新核算；不能自动更新确认内容。");
        // PR52's VoucherLine cannot represent these required dimensions. Provenance
        // always remains in module JSON; actual auxiliary requirements cannot be dropped.
        Require(plan.Lines.All(l => !l.DepartmentIsRequired && !l.EmployeeIsRequired),
            "总账分录接口尚不支持工资所需部门/人员辅助核算，不能转入；计划和全部维度已保留。");
        plan.Status = "accepted-draft";
        next.Revision = checked(confirmedDocument.Revision + 1);
        var proposal = new VoucherProposal(plan.Id, ModuleId, [plan.SourceKey], new(BookId, confirmedDocument.Revision),
            plan.Request.Date, plan.Request.VoucherType, plan.Request.Number, 0,
            plan.Lines.Select(l => new VoucherLine(l.AccountCode, l.Summary, l.Debit, l.Credit)).ToArray(), [Change(next)]);
        // The same transaction accepts the source, saves module state and creates the
        // draft. On failure neither this adapter nor its caller marks it generated.
        var receipt = ledger.AcceptVoucherProposal(proposal, actor);
        Require(receipt.ModuleId == ModuleId && receipt.ProposalId == plan.Id
            && receipt.SourceKeys.Contains(plan.SourceKey, StringComparer.Ordinal), "总账返回的工资凭证收据不一致，请核查保存结果。");
        expectedRevision = receipt.Revision;
        return receipt;
    }

    private void CheckContext(PayrollDocument document, long revision)
    {
        Require(document.BookId == BookId && document.Revision == revision && revision == expectedRevision,
            "工资提交必须使用同一账套、同一已观察修订；请显式刷新。");
    }
    private static ModuleDocumentChange Change(PayrollDocument document)
        => new(DocumentId, new(DocumentId, 1, JsonSerializer.Serialize(document, Options)));
    private static PayrollDocument Clone(PayrollDocument document)
        => JsonSerializer.Deserialize<PayrollDocument>(JsonSerializer.Serialize(document, Options), Options)!;
    private static void Require(bool condition, string message)
    { if (!condition) throw new PayrollValidationException(message); }

    public static ParityModuleRegistration Registration { get; } = new(ModuleId, 1,
        new[] { "minfeiqi/main", "chengben/main" }.SelectMany(product => new[]
        {
            new OriginalWindowReference(product, "w_gz_bmwh", "I基础档案 › 部门维护"),
            new OriginalWindowReference(product, "w_gz_rsgl", "I基础档案 › 人事管理"),
            new OriginalWindowReference(product, "w_xt_gzsz", "I基础档案 › 工资结构"),
            new OriginalWindowReference(product, "w_xt_gssz", "I基础档案 › 公式设置"),
            new OriginalWindowReference(product, "w_gz_gzgl", "O日常业务 › 工资管理"),
            new OriginalWindowReference(product, "w_pz_sz", "I基础档案 › 凭证设置"),
            new OriginalWindowReference(product, "w_pz_build_gz", "O.操作 › 工资发放凭证"),
            new OriginalWindowReference(product, "w_pz_build_gz", "O.操作 › 工资分配凭证")
        }).ToArray());
}
