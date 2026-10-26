using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Operators;

namespace Caiwu.AccountingExtensions.Parity;

/// <summary>
/// PR52 contract adapter. Shared Core/SQLite implementation must be separately verified.
/// Holds live authorization through each synchronous parity call; no separate sidecar write.
/// </summary>
public sealed class ParityAccountingAdapter
{
    public const string ModuleId = "accounting-extensions";
    private readonly IParityLedgerService parity;
    private readonly LocalOperatorService operators;
    private readonly OperatorSession session;

    public ParityAccountingAdapter(IParityLedgerService parity, LocalOperatorService operators, OperatorSession session)
        => (this.parity, this.operators, this.session) =
            (parity ?? throw new ArgumentNullException(nameof(parity)),
             operators ?? throw new ArgumentNullException(nameof(operators)),
             session ?? throw new ArgumentNullException(nameof(session)));

    // Only windows with actual WPF handlers are registered. Monthly generation has an API but its
    // original settings/selection window is still pending, so it is not offered as a runnable menu.
    public static ParityModuleRegistration Registration { get; } = new(ModuleId, 1,
        Array.AsReadOnly(new[] { "qingsong/main", "minfeiqi/main", "chengben/main" }
            .SelectMany(product => new[]
            {
                new OriginalWindowReference(product, "w_zw_fgz", "menu:m_frame_zw/m_s/m_s80"),
                new OriginalWindowReference(product, "w_zw_qxfz", "menu:m_frame_zw/m_s/m_s90")
            }).ToArray()));

    public ModuleLedgerSnapshot GetSnapshot() => operators.Execute(session, OperatorPermission.ReadLedger,
        _ => parity.GetModuleSnapshot());

    /// <summary>Preserves module-owned reference/import data verbatim, without claiming it is posted ledger data.</summary>
    public void SaveRawReferenceDocument(LedgerMutationContext originalContext, LedgerModuleDocument document)
        => operators.Execute(session, OperatorPermission.EditAccounts, actor =>
        {
            ArgumentNullException.ThrowIfNull(document);
            if (!document.DocumentId.StartsWith("reference/", StringComparison.Ordinal))
                throw new LedgerValidationException("参考数据文档必须使用 reference/ 前缀；不能改写结转凭证或来源收据。");
            parity.SaveModuleDocuments(new(ModuleId, originalContext,
                Array.AsReadOnly(new[] { new ModuleDocumentChange(document.DocumentId, document) })), actor.ActorKey);
            return true;
        });

    public VoucherProposal PreviewMonthlyTransfer(MonthlyTransferRequest request)
        => operators.Execute(session, OperatorPermission.PrepareVoucher,
            _ => BuildProposal(parity.GetModuleSnapshot(), request));

    public ModuleVoucherReceipt AcceptMonthlyTransfer(MonthlyTransferRequest request)
        => operators.Execute(session, OperatorPermission.PrepareVoucher, actor =>
        {
            // Recompute from authoritative data with the original token. Never accept user-mutated
            // preview lines, refresh a context, or mark a separate JSON file as generated.
            var proposal = BuildProposal(parity.GetModuleSnapshot(), request);
            return parity.AcceptVoucherProposal(proposal, actor.ActorKey);
        });

    private static VoucherProposal BuildProposal(ModuleLedgerSnapshot snapshot, MonthlyTransferRequest request)
    {
        var plan = MonthlyTransferPlanner.CreatePlan(snapshot.Ledger, request);
        // The frozen public snapshot exposes base amounts but no authoritative dimensional balance
        // capability. Unknown/rich module documents cannot be silently treated as plain RMB data.
        if (snapshot.Modules.Any(m => m.Documents.Count != 0 &&
            (m.ModuleId != ModuleId || m.Documents.Any(d => !d.DocumentId.StartsWith("monthly-transfer/", StringComparison.Ordinal)))))
            throw new NotSupportedException("当前共享快照未提供辅助/外币/数量余额能力；账套已有扩展文档，不能按基础金额静默结转。请接入维度结转事务。");

        var ruleHash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(plan.Definition.Code)));
        var source = $"monthly-transfer/{request.FiscalYear:0000}/{request.Month:00}/{ruleHash}";
        var proposalBytes = SHA256.HashData(Encoding.UTF8.GetBytes(snapshot.Ledger.Book.Id.ToString("N") + "\n" + source));
        var proposalId = new Guid(proposalBytes.AsSpan(0, 16));
        if (snapshot.ProposalReceipts.Any(r => r.ModuleId == ModuleId &&
            (r.ProposalId == proposalId || r.SourceKeys.Contains(source, StringComparer.Ordinal))))
            throw new LedgerValidationException("本期该结转规则已生成凭证；更改版本或删除草稿不能绕过来源认领，需使用专用撤销/重生成流程。");

        var payload = JsonSerializer.Serialize(new TransferDocument("full-balance-base-currency-v1",
            plan.Date, plan.Context.ExpectedRevision, plan.Definition, plan.Lines));
        var document = new LedgerModuleDocument(source, 1, payload);
        return new(proposalId, ModuleId, Array.AsReadOnly(new[] { source }), plan.Context, plan.Date,
            plan.Definition.VoucherKind, null, 0, plan.Lines,
            Array.AsReadOnly(new[] { new ModuleDocumentChange(source, document) }));
    }

    private sealed record TransferDocument(string Kind, DateOnly Date, long SourceRevision,
        MonthlyTransferDefinition Definition, IReadOnlyList<VoucherLine> Lines);
}
