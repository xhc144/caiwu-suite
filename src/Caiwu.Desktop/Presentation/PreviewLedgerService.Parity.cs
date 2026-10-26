#if CAIWU_PARITY_MODULES
using Caiwu.Contracts;

namespace Caiwu.Desktop.Presentation;

public sealed partial class PreviewLedgerService
{
    private IParityLedgerService Parity => inner as IParityLedgerService
        ?? throw new LedgerValidationException("公共模块服务尚未接入；不能访问裸账务服务绕过现有保护。");
    public ModuleLedgerSnapshot GetModuleSnapshot() => Parity.GetModuleSnapshot();
    public void SaveModuleDocuments(ModuleDocumentBatch batch, string operatorName)
    {
        DemandWritable(inner.GetSnapshot().Book);
        Parity.SaveModuleDocuments(batch, operatorName);
    }
    public ModuleVoucherReceipt AcceptVoucherProposal(VoucherProposal proposal, string operatorName)
    {
        DemandWritable(inner.GetSnapshot().Book);
        return Parity.AcceptVoucherProposal(proposal, operatorName);
    }
}
#endif
