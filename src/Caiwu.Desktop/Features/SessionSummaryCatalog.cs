using Caiwu.Summaries;
using Caiwu.Operators;

namespace Caiwu.Desktop.Features;

/// <summary>Keep the catalog location/version independent from the mutable current-book selection.</summary>
public sealed class SessionSummaryCatalog(FeatureSessionBinding binding, ISummaryCatalog inner,
    OperatorPermission managementPermission = OperatorPermission.PrepareVoucher) : ISummaryCatalog
{
    public SummaryCatalogLocation Location => inner.Location;
    private void Demand(bool mutation = false)
    {
        try
        {
            var service = binding.DemandCurrent();
            binding.Authentication.Demand(mutation ? managementPermission : OperatorPermission.ReadLedger);
            // Compare only; never replace the original mutation context with this read.
            var now = service.GetSnapshot();
            if (now.Book.Id != binding.Shown.Book.Id || now.Revision != binding.Shown.Revision || Location.BookId != now.Book.Id)
                throw new SummaryConflictException("账套来源快照已变化，请关闭旧摘要窗口后重新核对。");
        }
        catch (Caiwu.Contracts.StoreConcurrencyException ex) { throw new SummaryConflictException(ex.Message); }
        catch (OperatorException ex) { throw new SummaryConflictException(ex.Message); }
    }
    public SummarySnapshot Read() { Demand(); return inner.Read(); }
    public SummarySnapshot AddCategory(string name, CatalogVersion expected) { Demand(true); return inner.AddCategory(name, expected); }
    public SummarySnapshot RenameCategory(Guid id, string name, CatalogVersion expected) { Demand(true); return inner.RenameCategory(id, name, expected); }
    public SummarySnapshot DeleteCategory(Guid id, CatalogVersion expected) { Demand(true); return inner.DeleteCategory(id, expected); }
    public SummarySnapshot AddSummary(Guid categoryId, string text, CatalogVersion expected) { Demand(true); return inner.AddSummary(categoryId, text, expected); }
    public SummarySnapshot UpdateSummary(Guid id, Guid categoryId, string text, CatalogVersion expected) { Demand(true); return inner.UpdateSummary(id, categoryId, text, expected); }
    public SummarySnapshot DeleteSummary(Guid id, CatalogVersion expected) { Demand(true); return inner.DeleteSummary(id, expected); }
    public CatalogBackup ExportBackup(string destinationPath) { Demand(true); return inner.ExportBackup(destinationPath); }
    public CatalogBackup ValidateBackup(string backupPath, string? expectedSha256 = null) { Demand(); return inner.ValidateBackup(backupPath, expectedSha256); }
}
