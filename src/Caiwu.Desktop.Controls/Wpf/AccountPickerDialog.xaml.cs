using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Caiwu.Contracts;

namespace Caiwu.Desktop.Controls;

public partial class AccountPickerDialog : Window
{
    private AccountPickerState? state;
    private bool synchronizing;
    private readonly PickerComposition composition;
    public Account? SelectedAccount { get; private set; }

    public AccountPickerDialog(IEnumerable<Account> accounts, string? initialAccountCode = null)
    {
        InitializeComponent();
        composition = new(this);
        state = new(accounts, initialAccountCode);
        RefreshItems();
        Loaded += (_, _) => { AccountSearch.Focus(); AccountSearch.SelectAll(); SyncSelection(); };
    }

    private void Search_Changed(object sender, TextChangedEventArgs e)
    { if (state is null) return; state.SetQuery(AccountSearch.Text); RefreshItems(); }
    private void OnlySelectable_Changed(object sender, RoutedEventArgs e)
    { if (state is null) return; state.SetOnlySelectable(OnlySelectable.IsChecked == true); RefreshItems(); }
    private void RefreshItems()
    {
        if (state is null) return;
        synchronizing = true;
        AccountList.ItemsSource = state.VisibleItems; AccountTree.ItemsSource = state.TreeItems;
        synchronizing = false;
        SyncSelection();
    }
    private void SyncSelection()
    {
        if (state is null) return;
        synchronizing = true;
        AccountList.SelectedItem = state.SelectedItem;
        if (state.SelectedItem is not null) AccountList.ScrollIntoView(state.SelectedItem);
        if (AccountsView.SelectedIndex == 1 && state.SelectedItem is not null)
            PickerVisual.SelectTreeItem(AccountTree, state.SelectedItem.Code);
        synchronizing = false;
        ChooseButton.IsEnabled = state.CanAccept;
        SelectionStatus.Text = state.StatusText;
        SelectionStatus.Foreground = state.LoadError is null ? System.Windows.Media.Brushes.SlateGray : System.Windows.Media.Brushes.Firebrick;
    }
    private void List_SelectionChanged(object sender, SelectionChangedEventArgs e)
    { if (synchronizing || state is null) return; state.Select((AccountList.SelectedItem as AccountChoice)?.Code); SyncSelection(); }
    private void Tree_SelectionChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
    { if (synchronizing || state is null) return; state.Select((e.NewValue as AccountTreeNode)?.Choice.Code); SyncSelection(); }
    private void View_Changed(object sender, SelectionChangedEventArgs e)
    { if (ReferenceEquals(e.Source, AccountsView)) SyncSelection(); }
    private void List_DoubleClick(object sender, MouseButtonEventArgs e)
    {
        var row = PickerVisual.Ancestor<DataGridRow>(e.OriginalSource as DependencyObject);
        if (row?.Item is not AccountChoice choice || state is null) return;
        state.Select(choice.Code); SyncSelection(); if (state.CanAccept) Choose();
    }
    private void Tree_DoubleClick(object sender, MouseButtonEventArgs e)
    {
        var row = PickerVisual.Ancestor<TreeViewItem>(e.OriginalSource as DependencyObject);
        if (row?.DataContext is not AccountTreeNode node || state is null) return;
        state.Select(node.Choice.Code); SyncSelection(); if (state.CanAccept) Choose();
    }
    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (state is null) return;
        if (e.Key == Key.Escape && !composition.IsComposing) { Cancel(); e.Handled = true; }
        else if (e.Key is Key.Up or Key.Down && !composition.IsComposing) { state.MoveSelection(e.Key == Key.Down ? 1 : -1); SyncSelection(); e.Handled = true; }
        else if (e.Key == Key.Enter && !composition.IsComposing && !CancelButton.IsKeyboardFocusWithin) { Choose(); e.Handled = true; }
    }
    private void Choose_Click(object sender, RoutedEventArgs e) => Choose();
    private void Choose()
    {
        var result = state?.AcceptSelection();
        if (result?.Accepted != true) { SelectionStatus.Text = state?.StatusText ?? "科目目录尚未载入。"; return; }
        SelectedAccount = result.Value; DialogResult = true;
    }
    private void Cancel_Click(object sender, RoutedEventArgs e) => Cancel();
    private void Cancel() { SelectedAccount = null; DialogResult = false; }
    private void Window_Closing(object? sender, CancelEventArgs e) { if (DialogResult != true) SelectedAccount = null; }
}
