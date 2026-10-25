using Caiwu.Summaries;

namespace Caiwu.Delivery.Modules;
public sealed record RegisteredSummaryCatalog(JsonSummaryCatalog Catalog, ManagedAttachment Attachment);
/// <summary>Small concrete host surface used by FeatureWiring; no UI or Contracts changes.</summary>
public sealed class ManagedModuleHost(ManagedDataSession data)
{
    private readonly SummaryAttachmentCodec summaries = new(data.DataRoot);
    public IManagedAttachmentCodec[] Codecs => [summaries, new ClassificationAttachmentCodec(), new CostWorksheetAttachmentCodec(), new ReportTemplateAttachmentCodec()];
    public ManagedBookBackup BookBackups => new(data, Codecs);

    /// <summary>Explicit first-time initialization only. Never called implicitly by OpenSummary.</summary>
    public RegisteredSummaryCatalog InitializeSummary(string databasePath, Guid bookId) => data.Execute(() =>
    {
        var book = data.FindBook(databasePath, bookId);
        var path = data.ModulePath(book, "Summaries", "catalog.json");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var catalog = JsonSummaryCatalog.Create(new(data.DataRoot, path, book.BookId));
        try
        {
            return new RegisteredSummaryCatalog(catalog, data.RegisterAttachment(book, "summaries", summaries.Id, path, summaries));
        }
        catch (Exception ex)
        {
            throw new IOException("Summary catalog was created and preserved at " + path + "; attachment registration failed. Reconcile registration before opening.", ex);
        }
    });
    public RegisteredSummaryCatalog OpenSummary(string databasePath, Guid bookId) => data.Execute(() =>
    {
        var book = data.FindBook(databasePath, bookId);
        var entry = data.ReadInventory().Attachments.SingleOrDefault(a => a.InstanceId == book.InstanceId && a.Key == "summaries" && a.Codec == summaries.Id) ?? throw new InvalidDataException("This physical book has no registered summary catalog. Explicit initialization or recovery is required.");
        var path = SafePaths.Child(data.DataRoot, entry.RelativePath);
        return new RegisteredSummaryCatalog(summaries.Open(path, bookId), entry);
    });
}
