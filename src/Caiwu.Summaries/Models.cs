namespace Caiwu.Summaries;

public sealed record SummaryCategory(Guid Id, string Name);
public sealed record SummaryEntry(Guid Id, Guid CategoryId, string Text);

/// <summary>The exact loaded state. Pass it back unchanged when editing; refresh after a conflict.</summary>
public sealed record CatalogVersion(Guid CatalogId, long Revision, string Sha256);

public sealed class SummarySnapshot
{
    public Guid BookId { get; }
    public CatalogVersion Version { get; }
    public IReadOnlyList<SummaryCategory> Categories { get; }
    public IReadOnlyList<SummaryEntry> Entries { get; }
    internal SummarySnapshot(CatalogDocument document, string sha256)
    {
        BookId = document.BookId;
        Version = new(document.CatalogId, document.Revision, sha256);
        Categories = Array.AsReadOnly(document.Categories.ToArray());
        Entries = Array.AsReadOnly(document.Entries.ToArray());
    }

    public IReadOnlyList<SummaryEntry> Search(string? query = null, Guid? categoryId = null)
    {
        var terms = TextRules.Normalize(query ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var categories = Categories.ToDictionary(c => c.Id, c => c.Name);
        return Array.AsReadOnly(Entries.Where(e => (!categoryId.HasValue || e.CategoryId == categoryId) &&
                terms.All(t => TextRules.Normalize(e.Text).Contains(t, StringComparison.OrdinalIgnoreCase) ||
                    TextRules.Normalize(categories[e.CategoryId]).Contains(t, StringComparison.OrdinalIgnoreCase)))
            .OrderBy(e => categories[e.CategoryId], StringComparer.Ordinal)
            .ThenBy(e => e.Text, StringComparer.Ordinal).ThenBy(e => e.Id).ToArray());
    }

    /// <summary>Explicit adapter for Controls' SummaryLibraryItem without a Controls/Contracts dependency.</summary>
    public IReadOnlyList<T> ToPickerItems<T>(Func<string, string, string, T> factory)
    {
        ArgumentNullException.ThrowIfNull(factory);
        var names = Categories.ToDictionary(c => c.Id, c => c.Name);
        return Array.AsReadOnly(Entries.Select(e => factory(e.Id.ToString("D"), names[e.CategoryId], e.Text)).ToArray());
    }
}

public sealed record CatalogBackup(string Path, Guid BookId, Guid CatalogId, long Revision, string Sha256);

public class SummaryCatalogException(string message, Exception? inner = null) : Exception(message, inner);
public sealed class SummaryValidationException(string message) : SummaryCatalogException(message);
public sealed class SummaryCorruptException(string message, Exception? inner = null) : SummaryCatalogException(message, inner);
public sealed class SummaryConflictException(string message) : SummaryCatalogException(message);
public sealed class SummaryBusyException(string message, Exception? inner = null) : SummaryCatalogException(message, inner);

internal sealed record CatalogDocument(int SchemaVersion, Guid BookId, Guid CatalogId, long Revision,
    List<SummaryCategory> Categories, List<SummaryEntry> Entries);
