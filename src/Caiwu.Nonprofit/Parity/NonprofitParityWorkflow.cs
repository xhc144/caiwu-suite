using System.Security.Cryptography;
using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Nonprofit.Writable;

namespace Caiwu.Nonprofit.Parity;

public sealed record NonprofitOpeningClassification(Guid BookId, string CoreOpeningSha256,
    string EvidenceReference, IReadOnlyList<NonprofitOpening> Opening);

public sealed partial class NonprofitParityAdapter
{
    public const string OpeningDocumentId = "opening-classification";
    /// <summary>Classifies already-saved core openings, without changing their amounts. Initializing or
    /// editing amounts plus classifications requires the host's future enriched-opening transaction.</summary>
    public void ConfirmOpeningClassification(ModuleLedgerSnapshot edited, IReadOnlyList<NonprofitOpening> opening,
        string evidenceReference, string operatorId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(operatorId); ArgumentException.ThrowIfNullOrWhiteSpace(evidenceReference);
        authorizer.Require(operatorId, NonprofitPermission.MaintainOpening); var d = ReadBookDefinition(edited);
        if (Documents(edited).Any(doc => doc.DocumentId == OpeningDocumentId))
            throw new NonprofitValidationException("NP_OPENING_METADATA_EXISTS", "期初分类已保存；本切片不覆盖历史分类，请使用集成者的无损变更事务。");
        ValidateCombinedLineIds(edited, opening, []);
        var state = ValidationSnapshot(d, edited.Ledger) with { Opening = opening, OpeningConfirmed = true };
        NonprofitLedgerValidation.Validate(state);
        foreach (var account in edited.Ledger.Accounts)
        {
            var net = opening.Where(o => o.AccountCode == account.Code).Sum(o => o.Debit - o.Credit);
            if (net != account.OpeningDebit - account.OpeningCredit)
                throw new NonprofitValidationException("NP_OPENING_AMOUNT_MISMATCH", "期初分类金额必须与已保存公共期初逐科目一致，不能作为第二套余额。");
        }
        var payload = new NonprofitOpeningClassification(d.BookId, OpeningHash(edited.Ledger), evidenceReference, opening);
        host.SaveModuleDocuments(new(ModuleId, Context(edited), [new(OpeningDocumentId,
            new(OpeningDocumentId, 1, JsonSerializer.Serialize(payload, Json)))]), operatorId);
    }
    private NonprofitOpeningClassification ReadOpening(ModuleLedgerSnapshot source)
    {
        var doc = Documents(source).SingleOrDefault(d => d.DocumentId == OpeningDocumentId)
            ?? throw new NonprofitValidationException("NP_OPENING_REQUIRED", "请先在同账套保存与公共期初一致的民非分类；零期初也须明确确认。");
        var opening = Read<NonprofitOpeningClassification>(doc);
        if (opening.BookId != source.Ledger.Book.Id || opening.CoreOpeningSha256 != OpeningHash(source.Ledger))
            throw new NonprofitValidationException("NP_OPENING_CHANGED", "公共期初已经变化，原分类不能继续使用。");
        return opening;
    }
    private static string OpeningHash(LedgerSnapshot snapshot) => Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(
        new { snapshot.Book.Id, Accounts = snapshot.Accounts.OrderBy(a => a.Code, StringComparer.Ordinal).Select(a => new { a.Code, a.OpeningDebit, a.OpeningCredit }).ToArray() })));
    private AcceptedNonprofitVoucher Selected(ModuleLedgerSnapshot edited, Guid proposalId)
    {
        _ = ReadBookDefinition(edited);
        var result = ReadAcceptedVouchers(edited).SingleOrDefault(v => v.Receipt.ProposalId == proposalId)
            ?? throw new NonprofitValidationException("NP_PROPOSAL_MISSING", "所选民非提案不存在。");
        if (result.LedgerVoucher is null) throw new NonprofitValidationException("NP_VOUCHER_MISSING", "来源已被接纳，但凭证已删除，不能重复生成。");
        return result;
    }
    private ILedgerService Ledger => ledger ?? throw new InvalidOperationException("宿主必须提供同账套 ILedgerService 与 IParityLedgerService；不能把独立文件伪装成已接通总账。");
    public void ReviewAccepted(ModuleLedgerSnapshot edited, Guid proposalId, string operatorId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(operatorId); authorizer.Require(operatorId, NonprofitPermission.Review);
        var selected = Selected(edited, proposalId);
        Ledger.Review(selected.Receipt.VoucherId, operatorId, Context(edited));
    }
    public void CancelReviewAccepted(ModuleLedgerSnapshot edited, Guid proposalId, string operatorId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(operatorId); authorizer.Require(operatorId, NonprofitPermission.Review);
        var selected = Selected(edited, proposalId);
        Ledger.CancelReview(selected.Receipt.VoucherId, operatorId, Context(edited));
    }
    public void PostAccepted(ModuleLedgerSnapshot edited, Guid proposalId, string operatorId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(operatorId); authorizer.Require(operatorId, NonprofitPermission.Post);
        var selected = Selected(edited, proposalId); _ = ReadOpening(edited);
        Ledger.Post(selected.Receipt.VoucherId, operatorId, Context(edited));
    }
    public void DeleteAcceptedDraft(ModuleLedgerSnapshot edited, Guid proposalId, string operatorId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(operatorId); authorizer.Require(operatorId, NonprofitPermission.EditVoucher);
        var selected = Selected(edited, proposalId);
        Ledger.DeleteDraft(selected.Receipt.VoucherId, operatorId, Context(edited));
    }

    /// <summary>Reporting projection from one actual core/module revision. All original payloads remain
    /// authoritative in module documents. Missing enrichments or audit times are explicit gaps.</summary>
    public NonprofitLedgerSnapshot ReadWritableSnapshot(ModuleLedgerSnapshot source)
    {
        var d = ReadBookDefinition(source); var opening = ReadOpening(source);
        var accepted = ReadAcceptedVouchers(source).Where(v => v.LedgerVoucher is not null).ToDictionary(v => v.Receipt.VoucherId);
        var vouchers = new List<NonprofitLedgerVoucher>();
        foreach (var v in source.Ledger.Vouchers)
        {
            if (!accepted.TryGetValue(v.Id, out var match))
                throw new NonprofitValidationException("NP_UNCLASSIFIED_CORE_VOUCHER", "总账凭证尚无同事务完整民非分录文档：" + v.Id.ToString("D"));
            AuditEvent? Audit(string action)
            {
                var a = source.Ledger.AuditEvents.LastOrDefault(a => a.VoucherId == v.Id && a.Action == action);
                if (a is null) throw new NonprofitValidationException("NP_AUDIT_PROVENANCE", "缺少凭证实际" + action + "操作时间及人员；不能伪造来源。");
                return a;
            }
            var reviewed = v.Status == VoucherStatus.Draft ? null : Audit("Review");
            var posted = v.Status == VoucherStatus.Posted ? Audit("Post") : null;
            var enriched = match.Enriched.Draft;
            vouchers.Add(new(v.Id, v.Date, v.Kind, v.Number, v.AttachmentCount, v.PreparedBy, v.ReviewedBy,
                posted?.OperatorName, match.Enriched.SubmittedAt, reviewed?.At, posted?.At,
                (NonprofitVoucherState)(int)v.Status, enriched.Role, enriched.EvidenceReference,
                match.Receipt.ProposalId, enriched.Lines, enriched.OriginalFields));
        }
        var s = new NonprofitLedgerSnapshot(1, d.BookId, d.BookCode, d.Name, d.OriginalTemplateId, d.ChartEvidenceReference,
            d.FiscalYear, d.StartMonth, source.Ledger.Book.ClosedThroughMonth, source.Ledger.Revision, true,
            source.Ledger.AuditEvents.Any(a => a.Action == "Post") || vouchers.Any(v => v.State == NonprofitVoucherState.Posted),
            d.Accounts, opening.Opening, d.Restrictions, vouchers,
            source.Ledger.AuditEvents.Select(a => new NonprofitAudit(a.Id, a.At, a.OperatorName, a.Action, a.VoucherId, a.Detail)).ToArray(), d.OriginalFields);
        NonprofitLedgerValidation.Validate(s); return s;
    }
}
