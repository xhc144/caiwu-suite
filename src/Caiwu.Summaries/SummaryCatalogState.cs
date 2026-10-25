using System.ComponentModel;

namespace Caiwu.Summaries;

public enum SummaryCatalogStatus { NotLoaded, Ready, Conflict, Busy, InvalidData, IoError }
public sealed record SummarySelection(bool Accepted, SummaryEntry? Value)
{
    public static SummarySelection Cancelled { get; } = new(false, null);
}

/// <summary>Bind on the WPF UI thread. Failed operations retain the last snapshot but disable acceptance until Refresh succeeds.</summary>
public sealed class SummaryCatalogState(ISummaryCatalog catalog) : INotifyPropertyChanged
{
    private readonly ISummaryCatalog catalog = catalog ?? throw new ArgumentNullException(nameof(catalog));
    private string query = "";
    private Guid? categoryId;
    private Guid? selectedId;
    private SummaryCatalogStatus operationStatus;
    private string? operationError, queryError;
    public event PropertyChangedEventHandler? PropertyChanged;
    public SummarySnapshot? Snapshot { get; private set; }
    public IReadOnlyList<SummaryCategory> Categories => Snapshot?.Categories ?? Array.Empty<SummaryCategory>();
    public IReadOnlyList<SummaryEntry> VisibleEntries { get; private set; } = Array.Empty<SummaryEntry>();
    public SummaryEntry? SelectedEntry => VisibleEntries.FirstOrDefault(e => e.Id == selectedId);
    public SummaryCatalogStatus Status => queryError is not null ? SummaryCatalogStatus.InvalidData : operationStatus;
    public string? ErrorMessage => queryError ?? operationError;
    public bool CanAccept => Status == SummaryCatalogStatus.Ready && SelectedEntry is not null;
    public string StatusText => ErrorMessage ?? (Snapshot is null ? "尚未载入摘要库。" : Snapshot.Entries.Count == 0
        ? "暂无摘要，可新增分类和摘要。" : VisibleEntries.Count == 0 ? "没有匹配的摘要。" : $"匹配 {VisibleEntries.Count} 条摘要。");
    public string Query { get => query; set { query = value ?? ""; Rebuild(); } }
    public Guid? CategoryId { get => categoryId; set { categoryId = value; Rebuild(); } }
    public Guid? SelectedId { get => selectedId; set { selectedId = value; Notify(); } }

    public bool Refresh() => Run(catalog.Read);
    public bool AddCategory(string name) => Edit(v => catalog.AddCategory(name, v));
    public bool RenameCategory(Guid id, string name) => Edit(v => catalog.RenameCategory(id, name, v));
    public bool DeleteCategory(Guid id) => Edit(v => catalog.DeleteCategory(id, v));
    public bool AddSummary(Guid category, string text) => Edit(v => catalog.AddSummary(category, text, v));
    public bool UpdateSummary(Guid id, Guid category, string text) => Edit(v => catalog.UpdateSummary(id, category, text, v));
    public bool DeleteSummary(Guid id) => Edit(v => catalog.DeleteSummary(id, v));
    public SummarySelection AcceptSelection() => CanAccept ? new(true, SelectedEntry) : SummarySelection.Cancelled;
    public SummarySelection CancelSelection() => SummarySelection.Cancelled;

    private bool Edit(Func<CatalogVersion, SummarySnapshot> edit)
    {
        if (Snapshot is null || Status != SummaryCatalogStatus.Ready) return false;
        return Run(() => edit(Snapshot.Version));
    }
    private bool Run(Func<SummarySnapshot> operation)
    {
        try
        {
            Snapshot = operation(); operationStatus = SummaryCatalogStatus.Ready; operationError = null;
            if (categoryId.HasValue && !Snapshot.Categories.Any(c => c.Id == categoryId)) categoryId = null;
            Rebuild(); return true;
        }
        catch (SummaryConflictException ex) { Fail(SummaryCatalogStatus.Conflict, ex.Message); }
        catch (SummaryBusyException ex) { Fail(SummaryCatalogStatus.Busy, ex.Message); }
        catch (SummaryCatalogException ex) { Fail(SummaryCatalogStatus.InvalidData, ex.Message); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        { Fail(SummaryCatalogStatus.IoError, "摘要文件读写失败：" + ex.Message); }
        return false;
    }
    private void Fail(SummaryCatalogStatus status, string error)
    { operationStatus = status; operationError = error; Notify(); }
    private void Rebuild()
    {
        try
        {
            _ = TextRules.QueryTerms(query);
            VisibleEntries = Snapshot?.Search(query, categoryId) ?? Array.Empty<SummaryEntry>();
            queryError = null;
        }
        catch (SummaryValidationException ex)
        { queryError = ex.Message; VisibleEntries = Array.Empty<SummaryEntry>(); selectedId = null; }
        if (!VisibleEntries.Any(e => e.Id == selectedId)) selectedId = null;
        Notify();
    }
    private void Notify() => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(null));
}
