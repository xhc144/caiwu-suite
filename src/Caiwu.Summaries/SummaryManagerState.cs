using System.ComponentModel;

namespace Caiwu.Summaries;

public enum SummaryEditKind { None, AddCategory, RenameCategory, DeleteCategory, AddSummary, EditSummary, DeleteSummary }
public sealed record SummaryManagerRow(Guid Id, Guid CategoryId, string CategoryName, string Text);

/// <summary>One book and one edit session. Starting an edit captures the exact loaded version; Save never refreshes it.</summary>
public sealed class SummaryManagerState : INotifyPropertyChanged
{
    private readonly ISummaryCatalog catalog;
    private bool requiresReload;
    private string query = "", draftText = "";
    private Guid? selectedCategoryId, selectedEntryId, draftCategoryId, editId;
    private CatalogVersion? editVersion;
    private SummaryCatalogStatus operationStatus;
    private string? operationError, queryError;
    public event PropertyChangedEventHandler? PropertyChanged;
    public Guid BookId => catalog.Location.BookId;
    public string BookDisplayName { get; }
    public SummarySnapshot? Snapshot { get; private set; }
    public IReadOnlyList<SummaryCategory> Categories => Snapshot?.Categories ?? Array.Empty<SummaryCategory>();
    public IReadOnlyList<SummaryManagerRow> Rows { get; private set; } = Array.Empty<SummaryManagerRow>();
    public SummaryManagerRow? SelectedEntry => Rows.FirstOrDefault(e => e.Id == selectedEntryId);
    public SummaryEditKind EditKind { get; private set; }
    public CatalogVersion? EditVersion => editVersion;
    public SummaryCatalogStatus Status => queryError is not null ? SummaryCatalogStatus.InvalidData : operationStatus;
    public string? ErrorMessage => queryError ?? operationError;
    public string Message { get; private set; } = "尚未载入摘要库。";
    public bool IsBusy { get; private set; }
    public bool HasPendingEdit => EditKind != SummaryEditKind.None;
    public bool CanBrowse => !HasPendingEdit && !IsBusy;
    public bool CanStartEdit => Snapshot is not null && !requiresReload && queryError is null && CanBrowse;
    public bool CanEditCategory => CanStartEdit && selectedCategoryId.HasValue;
    public bool CanAddSummary => CanStartEdit && Categories.Count > 0;
    public bool CanEditSummary => CanStartEdit && SelectedEntry is not null;
    public bool CanSave => HasPendingEdit && !requiresReload && queryError is null && !IsBusy;
    public bool CanAccept => CanEditSummary;
    public bool CanRefresh => !HasPendingEdit && !IsBusy;
    public bool IsCategoryEditor => EditKind is SummaryEditKind.AddCategory or SummaryEditKind.RenameCategory;
    public bool IsSummaryEditor => EditKind is SummaryEditKind.AddSummary or SummaryEditKind.EditSummary;
    public bool IsDeleteEditor => EditKind is SummaryEditKind.DeleteCategory or SummaryEditKind.DeleteSummary;
    public string EditHeading => EditKind switch
    {
        SummaryEditKind.AddCategory => "新增分类", SummaryEditKind.RenameCategory => "修改分类名称",
        SummaryEditKind.DeleteCategory => "确认删除分类", SummaryEditKind.AddSummary => "新增摘要",
        SummaryEditKind.EditSummary => "编辑摘要", SummaryEditKind.DeleteSummary => "确认删除摘要",
        _ => "编辑与预览"
    };
    public string SaveButtonText => IsDeleteEditor ? "确认删除并保存" : "保存更改";
    public string StatusText => ErrorMessage ?? (Snapshot is null ? Message : Rows.Count == 0
        ? Snapshot.Entries.Count == 0 ? "暂无摘要，请先新增分类和摘要。" : "没有匹配的摘要。" : Message + $" 匹配 {Rows.Count} 条摘要。");

    public string Query { get => query; set { if (query == value) return; query = value ?? ""; Rebuild(); } }
    public Guid? SelectedCategoryId { get => selectedCategoryId; set { if (selectedCategoryId == value) return; selectedCategoryId = value; Rebuild(); } }
    public Guid? SelectedEntryId { get => selectedEntryId; set { if (selectedEntryId == value) return; selectedEntryId = value; Notify(); } }
    public string DraftText { get => draftText; set { if (draftText == value) return; draftText = value ?? ""; Notify(); } }
    public Guid? DraftCategoryId { get => draftCategoryId; set { if (draftCategoryId == value) return; draftCategoryId = value; Notify(); } }

    public SummaryManagerState(ISummaryCatalog catalog, string bookDisplayName)
    {
        this.catalog = catalog ?? throw new ArgumentNullException(nameof(catalog));
        BookDisplayName = string.IsNullOrWhiteSpace(bookDisplayName) ? "当前账套" : bookDisplayName;
    }

    public bool Refresh()
    {
        if (!CanRefresh) return false;
        return Run(() =>
        {
            Snapshot = catalog.Read(); requiresReload = false;
            if (!Categories.Any(c => c.Id == selectedCategoryId)) selectedCategoryId = null;
            Message = "已载入当前账套摘要库。"; Rebuild();
        }, reading: true);
    }

    public bool BeginAddCategory() => Begin(SummaryEditKind.AddCategory, null, "", null);
    public bool BeginRenameCategory() => SelectedCategory() is { } c && Begin(SummaryEditKind.RenameCategory, c.Id, c.Name, null);
    public bool BeginDeleteCategory() => SelectedCategory() is { } c && Begin(SummaryEditKind.DeleteCategory, c.Id, c.Name, null);
    public bool BeginAddSummary() => Categories.Count > 0 && Begin(SummaryEditKind.AddSummary, null, "", selectedCategoryId ?? Categories[0].Id);
    public bool BeginEditSummary() => SelectedEntry is { } e && Begin(SummaryEditKind.EditSummary, e.Id, e.Text, e.CategoryId);
    public bool BeginDeleteSummary() => SelectedEntry is { } e && Begin(SummaryEditKind.DeleteSummary, e.Id, e.Text, e.CategoryId);

    public bool Save()
    {
        if (!CanSave || editVersion is null) return false;
        return Run(() =>
        {
            // Do not Read/Refresh here. A late writer must fail against the version captured by Begin.
            var before = Snapshot!;
            var next = EditKind switch
            {
                SummaryEditKind.AddCategory => catalog.AddCategory(draftText, editVersion),
                SummaryEditKind.RenameCategory => catalog.RenameCategory(editId!.Value, draftText, editVersion),
                SummaryEditKind.DeleteCategory => catalog.DeleteCategory(editId!.Value, editVersion),
                SummaryEditKind.AddSummary => catalog.AddSummary(RequiredDraftCategory(), draftText, editVersion),
                SummaryEditKind.EditSummary => catalog.UpdateSummary(editId!.Value, RequiredDraftCategory(), draftText, editVersion),
                SummaryEditKind.DeleteSummary => catalog.DeleteSummary(editId!.Value, editVersion),
                _ => throw new InvalidOperationException("No edit session.")
            };
            if (EditKind is SummaryEditKind.AddCategory)
                selectedCategoryId = next.Categories.Single(c => !before.Categories.Any(old => old.Id == c.Id)).Id;
            else if (EditKind is SummaryEditKind.DeleteCategory) selectedCategoryId = null;
            else if (EditKind is SummaryEditKind.AddSummary or SummaryEditKind.EditSummary)
            {
                selectedCategoryId = draftCategoryId;
                selectedEntryId = EditKind == SummaryEditKind.EditSummary ? editId :
                    next.Entries.Single(e => !before.Entries.Any(old => old.Id == e.Id)).Id;
                query = "";
            }
            else if (EditKind is SummaryEditKind.DeleteSummary) selectedEntryId = null;
            Snapshot = next; ClearDraft(); Message = "更改已保存。"; Rebuild();
        });
    }

    public void CancelEdit()
    {
        if (IsBusy) return;
        ClearDraft();
        if (!requiresReload)
        {
            operationError = null; operationStatus = Snapshot is null ? SummaryCatalogStatus.NotLoaded : SummaryCatalogStatus.Ready;
            Message = "未保存的编辑已取消；已保存的更改保留。";
        }
        Notify();
    }

    public SummarySelection AcceptSelection() => CanAccept
        ? new(true, Snapshot!.Entries.Single(e => e.Id == selectedEntryId)) : SummarySelection.Cancelled;
    public SummarySelection CancelSelection() => SummarySelection.Cancelled;

    private SummaryCategory? SelectedCategory() => Categories.FirstOrDefault(c => c.Id == selectedCategoryId);
    private bool Begin(SummaryEditKind kind, Guid? id, string text, Guid? category)
    {
        if (!CanStartEdit) return false;
        EditKind = kind; editId = id; editVersion = Snapshot!.Version;
        draftText = text; draftCategoryId = category; operationError = null;
        Message = "编辑尚未保存。"; Notify(); return true;
    }
    private Guid RequiredDraftCategory() => draftCategoryId ?? throw new SummaryValidationException("请选择摘要分类。");
    private void ClearDraft()
    { EditKind = SummaryEditKind.None; editId = null; editVersion = null; draftText = ""; draftCategoryId = null; }
    private bool Run(Action operation, bool reading = false)
    {
        IsBusy = true; Notify();
        try
        {
            operation(); operationError = null; operationStatus = SummaryCatalogStatus.Ready; return true;
        }
        catch (SummaryConflictException ex)
        { Error(SummaryCatalogStatus.Conflict, ex.Message + " 输入已保留；请先复制需要的内容，再取消编辑、重新载入并核对。", reading: true); }
        catch (SummaryBusyException ex) { Error(SummaryCatalogStatus.Busy, ex.Message, reading); }
        catch (SummaryCorruptException ex) { Error(SummaryCatalogStatus.InvalidData, ex.Message, reading: true); }
        catch (SummaryCatalogException ex) { Error(SummaryCatalogStatus.InvalidData, ex.Message, reading); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        { Error(SummaryCatalogStatus.IoError, "摘要文件读写失败，输入已保留：" + ex.Message, reading); }
        finally { IsBusy = false; Notify(); }
        return false;
    }
    private void Error(SummaryCatalogStatus status, string message, bool reading)
    { operationStatus = status; operationError = message; if (reading) requiresReload = true; }
    private void Rebuild()
    {
        try
        {
            _ = TextRules.QueryTerms(query);
            if (Snapshot is null) Rows = Array.Empty<SummaryManagerRow>();
            else
            {
                var names = Categories.ToDictionary(c => c.Id, c => c.Name);
                Rows = Array.AsReadOnly(Snapshot.Search(query, selectedCategoryId)
                    .Select(e => new SummaryManagerRow(e.Id, e.CategoryId, names[e.CategoryId], e.Text)).ToArray());
            }
            queryError = null;
        }
        catch (SummaryValidationException ex)
        { queryError = ex.Message; Rows = Array.Empty<SummaryManagerRow>(); selectedEntryId = null; }
        if (!Rows.Any(e => e.Id == selectedEntryId)) selectedEntryId = null;
        Notify();
    }
    private void Notify() => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(null));
}
