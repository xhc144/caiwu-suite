namespace Caiwu.Summaries;

/// <summary>Host injection surface. No ledger, user-account, permission or installer ownership is assumed.</summary>
public interface ISummaryCatalog
{
    SummaryCatalogLocation Location { get; }
    SummarySnapshot Read();
    SummarySnapshot AddCategory(string name, CatalogVersion expected);
    SummarySnapshot RenameCategory(Guid id, string name, CatalogVersion expected);
    SummarySnapshot DeleteCategory(Guid id, CatalogVersion expected);
    SummarySnapshot AddSummary(Guid categoryId, string text, CatalogVersion expected);
    SummarySnapshot UpdateSummary(Guid id, Guid categoryId, string text, CatalogVersion expected);
    SummarySnapshot DeleteSummary(Guid id, CatalogVersion expected);
    CatalogBackup ExportBackup(string destinationPath);
    CatalogBackup ValidateBackup(string backupPath, string? expectedSha256 = null);
}
