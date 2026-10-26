using Caiwu.Contracts;

namespace Caiwu.Invoicing.ParityAdapter;

/// <summary>Entry/edit adapter only. Authority stays inside the ledger's module documents.
/// Whole-book CAS comes from the last displayed snapshot; TrySave never fetches a replacement token.
/// A host must supply an authorized operator session and a separate voucher proposal handler.</summary>
public sealed class ParityInvoiceStore(IParityLedgerService ledger, InvoiceProduct product, string operatorName) : IInvoiceStore
{
    private readonly object gate = new();
    private ModuleLedgerSnapshot? origin;

    public InvoiceWorkspace Read()
    {
        lock (gate)
        {
            var snapshot = ledger.GetModuleSnapshot();
            var workspace = ParityInvoiceAdapter.Read(snapshot, product);
            origin = snapshot;
            return workspace;
        }
    }

    public ModuleLedgerSnapshot OriginFor(long expectedRevision)
    {
        lock (gate)
        {
            if (origin is null || origin.Ledger.Revision != expectedRevision)
                throw new InvoiceException("stale", "已显示的快照已变化，请重新生成并确认计划。");
            return origin;
        }
    }

    public bool TrySave(long expectedRevision, InvoiceWorkspace workspace)
    {
        lock (gate)
        {
            if (origin is null || origin.Ledger.Revision != expectedRevision) return false;
            var batch = ParityInvoiceAdapter.PrepareSave(origin, workspace);
            try { ledger.SaveModuleDocuments(batch, operatorName); return true; }
            catch (StoreConcurrencyException) { return false; }
            catch (LedgerValidationException ex) { throw new InvoiceException("ledger-validation", ex.Message); }
        }
    }
}
