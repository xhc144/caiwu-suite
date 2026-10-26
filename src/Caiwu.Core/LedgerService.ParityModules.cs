using Caiwu.Contracts;

namespace Caiwu.Core;

public sealed partial class LedgerService
{
    public ModuleLedgerSnapshot GetModuleSnapshot() => ParityModuleJournal.Replay(Read());

    public void SaveModuleDocuments(ModuleDocumentBatch batch, string operatorName)
    {
        Require(batch is not null, "模块文档提交不能为空。");
        var actor = Actor(operatorName);
        var before = Read();
        RequireMutationContext(before, batch!.Context);
        Require(batch.Changes is not null && batch.Changes.Count > 0, "没有模块文档变更需要保存。");
        var detail = ParityModuleJournal.Encode(ParityModuleJournal.Replay(before), batch.ModuleId, batch.Changes!, null);
        Commit(before, before, actor, ParityModuleJournal.Action, null, detail);
    }

    public ModuleVoucherReceipt AcceptVoucherProposal(VoucherProposal proposal, string operatorName)
    {
        Require(proposal is not null, "凭证建议不能为空。");
        var actor = Actor(operatorName);
        var before = Read();
        RequireMutationContext(before, proposal!.Context);
        var moduleId = ParityModuleJournal.ModuleId(proposal.ModuleId);
        var sources = ParityModuleJournal.Sources(proposal.SourceKeys);
        var state = ParityModuleJournal.Replay(before);
        ParityModuleJournal.RequireUnused(state.ProposalReceipts, moduleId, proposal.ProposalId, sources);
        var draft = new VoucherDraft(null, proposal.Date, proposal.Kind, proposal.Number, proposal.AttachmentCount,
            proposal.Lines, before.Revision, before.Book.Id);
        var voucher = BuildDraft(before, draft, actor);
        var receipt = new ModuleVoucherReceipt(proposal.ProposalId, moduleId, sources, voucher.Id, checked(before.Revision + 1));
        var detail = ParityModuleJournal.Encode(state, moduleId, proposal.Changes, receipt);
        Commit(before, before with { Vouchers = before.Vouchers.Append(voucher).ToArray() },
            actor, ParityModuleJournal.Action, voucher.Id, detail);
        return receipt;
    }
}
