using System.Runtime.ExceptionServices;
using Caiwu.Summaries;

namespace Caiwu.Desktop.Features;

/// <summary>Run only catalog I/O on a worker; all owner state transitions remain on the calling UI context.</summary>
public sealed class AsyncSummaryStateAdapter
{
    private readonly ISummaryCatalog catalog;
    private readonly ResultCatalog results;
    private bool busy;
    private Guid? categoryEditId, entryEditId;
    private CatalogVersion? begunVersion;
    public SummaryManagerState State { get; }
    public AsyncSummaryStateAdapter(ISummaryCatalog catalog, string bookDisplayName)
    {
        this.catalog = catalog; results = new(catalog.Location); State = new(results, bookDisplayName);
    }

    public Task<bool> RefreshAsync() => ExecuteAsync(catalog.Read, State.Refresh, State.CanRefresh);
    public bool BeginEdit(Func<bool> begin)
    {
        if (busy) return false;
        var category = State.SelectedCategoryId; var entry = State.SelectedEntryId;
        if (!begin()) return false;
        categoryEditId = category; entryEditId = entry; begunVersion = State.EditVersion;
        return true;
    }
    public Task<bool> SaveAsync()
    {
        if (!State.CanSave || State.EditVersion is not { } version || begunVersion != version) return Task.FromResult(false);
        // Freeze the edit request on the UI thread before dispatching. Never call State on a worker.
        var kind = State.EditKind; var text = State.DraftText; var category = State.DraftCategoryId;
        var categoryId = categoryEditId; var entryId = entryEditId;
        SummarySnapshot Save() => kind switch
        {
            SummaryEditKind.AddCategory => catalog.AddCategory(text, version),
            SummaryEditKind.RenameCategory => catalog.RenameCategory(categoryId!.Value, text, version),
            SummaryEditKind.DeleteCategory => catalog.DeleteCategory(categoryId!.Value, version),
            SummaryEditKind.AddSummary => catalog.AddSummary(RequireCategory(), text, version),
            SummaryEditKind.EditSummary => catalog.UpdateSummary(entryId!.Value, RequireCategory(), text, version),
            SummaryEditKind.DeleteSummary => catalog.DeleteSummary(entryId!.Value, version),
            _ => throw new SummaryValidationException("没有待保存的摘要编辑。")
        };
        Guid RequireCategory() => category ?? throw new SummaryValidationException("请选择摘要分类。");
        return ExecuteAsync(Save, State.Save, true);
    }

    private async Task<bool> ExecuteAsync(Func<SummarySnapshot> io, Func<bool> apply, bool allowed)
    {
        if (busy || !allowed) return false;
        busy = true;
        try
        {
            var outcome = await Task.Run(() =>
            {
                try { return (Snapshot: io(), Error: (ExceptionDispatchInfo?)null); }
                catch (Exception ex) { return (Snapshot: (SummarySnapshot?)null, Error: ExceptionDispatchInfo.Capture(ex)); }
            });
            results.Set(outcome.Snapshot, outcome.Error);
            return apply(); // The original state machine consumes the result/error on the UI context.
        }
        finally { busy = false; results.Clear(); }
    }

    private sealed class ResultCatalog(SummaryCatalogLocation location) : ISummaryCatalog
    {
        private SummarySnapshot? snapshot; private ExceptionDispatchInfo? error; private bool ready;
        public SummaryCatalogLocation Location => location;
        public void Set(SummarySnapshot? value, ExceptionDispatchInfo? failure) { snapshot = value; error = failure; ready = true; }
        public void Clear() { snapshot = null; error = null; ready = false; }
        private SummarySnapshot Take()
        {
            if (!ready) throw new InvalidOperationException("摘要 I/O 结果尚未准备，不能同步调用存储。");
            ready = false; error?.Throw(); return snapshot ?? throw new InvalidOperationException("摘要结果缺失。");
        }
        public SummarySnapshot Read() => Take();
        public SummarySnapshot AddCategory(string name, CatalogVersion expected) => Take();
        public SummarySnapshot RenameCategory(Guid id, string name, CatalogVersion expected) => Take();
        public SummarySnapshot DeleteCategory(Guid id, CatalogVersion expected) => Take();
        public SummarySnapshot AddSummary(Guid categoryId, string text, CatalogVersion expected) => Take();
        public SummarySnapshot UpdateSummary(Guid id, Guid categoryId, string text, CatalogVersion expected) => Take();
        public SummarySnapshot DeleteSummary(Guid id, CatalogVersion expected) => Take();
        public CatalogBackup ExportBackup(string destinationPath) => throw new NotSupportedException("备份由宿主附件登记流程执行。");
        public CatalogBackup ValidateBackup(string backupPath, string? expectedSha256 = null) => throw new NotSupportedException("备份由宿主附件登记流程执行。");
    }
}
