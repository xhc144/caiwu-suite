using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;

namespace Caiwu.Summaries.Wpf;

/// <summary>Host-owned modal window; its book/service binding cannot be switched while open.</summary>
public partial class SummaryManagerWindow : Window
{
    private bool completed;
    private bool synchronizingLists;
    public SummaryManagerState State { get; }
    public SummarySelection Result { get; private set; } = SummarySelection.Cancelled;

    public SummaryManagerWindow(ISummaryCatalog catalog, string bookDisplayName, Guid? initialSummaryId = null)
    {
        State = new(catalog, bookDisplayName);
        InitializeComponent();
        DataContext = State;
        State.PropertyChanged += (_, _) => RenderLists();
        State.Refresh();
        State.SelectedEntryId = initialSummaryId;
    }

    private void RenderLists()
    {
        if (synchronizingLists) return;
        synchronizingLists = true;
        try
        {
            // Keep ID selection stable while replacing snapshot lists. Transient SelectionChanged(null)
            // raised by ItemsSource replacement must not be written back over the saved selection.
            CategoryList.ItemsSource = State.Categories;
            CategoryList.SelectedValue = State.SelectedCategoryId;
            SummaryList.ItemsSource = State.Rows;
            SummaryList.SelectedValue = State.SelectedEntryId;
        }
        finally { synchronizingLists = false; }
    }
    private void CategoryList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    { if (!synchronizingLists) State.SelectedCategoryId = CategoryList.SelectedValue as Guid?; }
    private void SummaryList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    { if (!synchronizingLists) State.SelectedEntryId = SummaryList.SelectedValue as Guid?; }

    private void AllCategories_Click(object sender, RoutedEventArgs e) => State.SelectedCategoryId = null;
    private void AddCategory_Click(object sender, RoutedEventArgs e) { if (State.BeginAddCategory()) FocusEditor(CategoryNameBox); }
    private void RenameCategory_Click(object sender, RoutedEventArgs e) { if (State.BeginRenameCategory()) FocusEditor(CategoryNameBox, selectAll: true); }
    private void DeleteCategory_Click(object sender, RoutedEventArgs e) => State.BeginDeleteCategory();
    private void AddSummary_Click(object sender, RoutedEventArgs e) { if (State.BeginAddSummary()) FocusEditor(SummaryTextBox); }
    private void EditSummary_Click(object sender, RoutedEventArgs e) { if (State.BeginEditSummary()) FocusEditor(SummaryTextBox); }
    private void DeleteSummary_Click(object sender, RoutedEventArgs e) => State.BeginDeleteSummary();
    private void Save_Click(object sender, RoutedEventArgs e) => State.Save();
    private void CancelEdit_Click(object sender, RoutedEventArgs e) => State.CancelEdit();
    private void Reload_Click(object sender, RoutedEventArgs e) => State.Refresh();
    private void Choose_Click(object sender, RoutedEventArgs e) { if (State.CanAccept) Complete(State.AcceptSelection()); }
    private void CancelWindow_Click(object sender, RoutedEventArgs e) => Complete(SummarySelection.Cancelled);
    private void FocusEditor(TextBox editor, bool selectAll = false) => Dispatcher.BeginInvoke(DispatcherPriority.Input, new Action(() =>
    {
        if (!IsVisible || !State.HasPendingEdit || !editor.IsVisible || !editor.IsEnabled) return;
        editor.Focus();
        if (selectAll) editor.SelectAll(); else editor.CaretIndex = editor.Text.Length;
    }));
    private void Complete(SummarySelection result)
    {
        if (completed || (result.Accepted && !State.CanAccept)) return;
        completed = true; Result = result;
        DialogResult = result.Accepted;
    }
    protected override void OnClosing(CancelEventArgs e)
    {
        base.OnClosing(e);
        if (e.Cancel) return;
        if (!completed) { completed = true; Result = SummarySelection.Cancelled; }
        State.CancelEdit();
    }
}
