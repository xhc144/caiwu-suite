#if CAIWU_PARITY_MODULES
using Caiwu.Contracts;

namespace Caiwu.Operators;

public sealed partial class AuthorizedLedgerService
{
    private IParityLedgerService Parity => _inner as IParityLedgerService
        ?? throw new OperatorAuthorizationException("受保护的模块服务尚未接入；不能绕过包装器访问底层账套。");

    public ModuleLedgerSnapshot GetModuleSnapshot() => _operators.Execute(_session, OperatorPermission.ReadLedger, _ => Parity.GetModuleSnapshot());

    public void SaveModuleDocuments(ModuleDocumentBatch batch, string operatorName)
    {
        ArgumentNullException.ThrowIfNull(batch);
        var permission = (_moduleWritePermissions ?? throw new OperatorAuthorizationException("模块写权限尚未配置。"))
            .RequiredPermission(batch.ModuleId);
        _operators.Execute(_session, permission, actor =>
        { Parity.SaveModuleDocuments(batch, actor.ActorKey); return true; });
    }

    public ModuleVoucherReceipt AcceptVoucherProposal(VoucherProposal proposal, string operatorName)
    {
        ArgumentNullException.ThrowIfNull(proposal);
        var modulePermission = (_moduleWritePermissions ?? throw new OperatorAuthorizationException("模块写权限尚未配置。"))
            .RequiredPermission(proposal.ModuleId);
        // One store access/identity lock for both grants and the entire real operation; never nested Execute.
        return _operators.ExecuteWithPermissions(_session, [OperatorPermission.PrepareVoucher, modulePermission],
            actor => Parity.AcceptVoucherProposal(proposal, actor.ActorKey));
    }
}
#endif
