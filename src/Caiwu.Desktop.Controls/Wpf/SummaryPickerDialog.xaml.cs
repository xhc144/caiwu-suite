using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace Caiwu.Desktop.Controls;

public partial class SummaryPickerDialog : Window
{
    private SummaryPickerState? state;
    private bool synchronizing;
    private readonly PickerComposition composition;
    public SummaryLibraryItem? SelectedSummary { get; private set; }

    public SummaryPickerDialog(IEnumerable<SummaryLibraryItem> items, string? initialItemId = null)
    {
        InitializeComponent();
        composition = new(this);
        state = new(items, initialItemId);
        SummaryCategories.Items.Add(new ListBoxItem { Content = "全部分类", Tag = null });
        foreach (var category in state.Categories) SummaryCategories.Items.Add(new ListBoxItem { Content = category, Tag = category });
        synchronizing = true; SummaryCategories.SelectedIndex = 0; synchronizing = false;
        RefreshItems();
        Loaded += (_, _) => { SummarySearch.Focus(); SummarySearch.SelectAll(); };
    }
    private void Search_Changed(object sender, TextChangedEventArgs e)
    { if (state is null) return; state.SetQuery(SummarySearch.Text); RefreshItems(); }
    private void Category_Changed(object sender, SelectionChangedEventArgs e)
    { if (synchronizing || state is null) return; state.SetCategory((SummaryCategories.SelectedItem as ListBoxItem)?.Tag as string); RefreshItems(); }
    private void RefreshItems()
    {
        if (state is null) return;
        synchronizing = true; SummaryList.ItemsSource = state.VisibleItems; synchronizing = false;
        SyncSelection();
    }
    private void SyncSelection()
    {
        if (state is null) return;
        synchronizing = true;
        SummaryList.SelectedItem = state.SelectedItem;
        if (state.SelectedItem is not null) SummaryList.ScrollIntoView(state.SelectedItem);
        synchronizing = false;
        SummaryPreview.Text = state.SelectedItem?.Text ?? "";
        ChooseButton.IsEnabled = state.CanAccept;
        SelectionStatus.Text = state.StatusText;
        SelectionStatus.Foreground = state.LoadError is null ? System.Windows.Media.Brushes.SlateGray : System.Windows.Media.Brushes.Firebrick;
    }
    private void List_SelectionChanged(object sender, SelectionChangedEventArgs e)
    { if (synchronizing || state is null) return; state.Select((SummaryList.SelectedItem as SummaryLibraryItem)?.Id); SyncSelection(); }
    private void List_DoubleClick(object sender, MouseButtonEventArgs e)
    {
        var row = PickerVisual.Ancestor<DataGridRow>(e.OriginalSource as DependencyObject);
        if (row?.Item is not SummaryLibraryItem item || state is null) return;
        state.Select(item.Id); SyncSelection(); Choose();
    }
    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (state is null) return;
        if (e.Key == Key.Escape && !composition.IsComposing) { Cancel(); e.Handled = true; }
        else if (e.Key is Key.Up or Key.Down && !SummaryCategories.IsKeyboardFocusWithin && !composition.IsComposing)
        { state.MoveSelection(e.Key == Key.Down ? 1 : -1); SyncSelection(); e.Handled = true; }
        else if (e.Key == Key.Enter && !composition.IsComposing && !CancelButton.IsKeyboardFocusWithin) { Choose(); e.Handled = true; }
    }
    private void Choose_Click(object sender, RoutedEventArgs e) => Choose();
    private void Choose()
    {
        var result = state?.AcceptSelection();
        if (result?.Accepted != true) { SelectionStatus.Text = state?.StatusText ?? "摘要尚未载入。"; return; }
        SelectedSummary = result.Value; DialogResult = true;
    }
    private void Cancel_Click(object sender, RoutedEventArgs e) => Cancel();
    private void Cancel() { SelectedSummary = null; DialogResult = false; }
    private void Window_Closing(object? sender, CancelEventArgs e) { if (DialogResult != true) SelectedSummary = null; }
}
