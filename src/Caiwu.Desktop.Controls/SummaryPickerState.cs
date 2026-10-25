namespace Caiwu.Desktop.Controls;

public sealed class SummaryPickerState
{
    private readonly SummaryLibraryItem[] all;
    public IReadOnlyList<string> Categories { get; }
    public IReadOnlyList<SummaryLibraryItem> VisibleItems { get; private set; } = Array.Empty<SummaryLibraryItem>();
    public string? SelectedCategory { get; private set; }
    public SummaryLibraryItem? SelectedItem { get; private set; }
    public string Query { get; private set; } = "";
    public string? LoadError { get; }
    public bool CanAccept => SelectedItem is not null && VisibleItems.Any(i => i.Id == SelectedItem.Id);
    public string StatusText => LoadError ?? (all.Length == 0 ? "暂无可选摘要。" : VisibleItems.Count == 0 ? "没有匹配的摘要，请调整分类或搜索。" : $"匹配 {VisibleItems.Count} 条摘要。");

    public SummaryPickerState(IEnumerable<SummaryLibraryItem> items, string? initialItemId = null)
    {
        ArgumentNullException.ThrowIfNull(items);
        all = items.ToArray();
        if (all.Any(i => i is null || string.IsNullOrWhiteSpace(i.Id) || string.IsNullOrWhiteSpace(i.Category) || string.IsNullOrWhiteSpace(i.Text)) ||
            all.Select(i => i.Id).Distinct(StringComparer.Ordinal).Count() != all.Length)
        { LoadError = "摘要条目缺少内容、分类或标识重复，暂不能选择。"; all = []; }
        Categories = Array.AsReadOnly(all.Select(i => i.Category).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray());
        Rebuild(); Select(initialItemId);
    }
    public void SetQuery(string? query) { Query = query ?? ""; Rebuild(); }
    public void SetCategory(string? category) { SelectedCategory = category; Rebuild(); }
    public void Select(string? id) => SelectedItem = VisibleItems.FirstOrDefault(i => i.Id == id);
    public void MoveSelection(int delta)
    {
        if (delta == 0) return;
        if (VisibleItems.Count == 0) { SelectedItem = null; return; }
        var index = -1;
        for (var i = 0; i < VisibleItems.Count; i++) if (VisibleItems[i].Id == SelectedItem?.Id) index = i;
        var next = index < 0 ? (delta > 0 ? 0 : VisibleItems.Count - 1) : Math.Clamp(index + Math.Sign(delta), 0, VisibleItems.Count - 1);
        SelectedItem = VisibleItems[next];
    }
    public SelectionResult<SummaryLibraryItem> AcceptSelection() => CanAccept ? SelectionResult<SummaryLibraryItem>.Accept(SelectedItem!) : SelectionResult<SummaryLibraryItem>.Cancelled;
    public SelectionResult<SummaryLibraryItem> CancelSelection() => SelectionResult<SummaryLibraryItem>.Cancelled;
    private void Rebuild()
    {
        var terms = PickerSearch.Terms(Query);
        VisibleItems = Array.AsReadOnly(all.Where(i => (SelectedCategory is null || i.Category == SelectedCategory) && PickerSearch.Matches(terms, i.Category, i.Text))
            .OrderBy(i => i.Category, StringComparer.Ordinal).ThenBy(i => i.Text, StringComparer.Ordinal).ThenBy(i => i.Id, StringComparer.Ordinal).ToArray());
        if (SelectedItem is not null && !VisibleItems.Any(i => i.Id == SelectedItem.Id)) SelectedItem = null;
    }
}
