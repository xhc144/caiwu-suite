using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using Caiwu.Contracts;

namespace Caiwu.Desktop.Controls;

public static class SelectionDialogs
{
    public static SelectionResult<Account> PickAccount(Window owner, IEnumerable<Account> accounts,
        string? initialAccountCode = null, IInputElement? focusAfterClose = null)
    {
        ArgumentNullException.ThrowIfNull(owner);
        owner.Dispatcher.VerifyAccess();
        var focus = focusAfterClose ?? Keyboard.FocusedElement;
        try
        {
            var dialog = new AccountPickerDialog(accounts, initialAccountCode) { Owner = owner };
            return dialog.ShowDialog() == true && dialog.SelectedAccount is { } account
                ? SelectionResult<Account>.Accept(account) : SelectionResult<Account>.Cancelled;
        }
        finally { RestoreFocus(owner, focus); }
    }
    public static SelectionResult<SummaryLibraryItem> PickSummary(Window owner, IEnumerable<SummaryLibraryItem> items,
        string? initialItemId = null, IInputElement? focusAfterClose = null)
    {
        ArgumentNullException.ThrowIfNull(owner);
        owner.Dispatcher.VerifyAccess();
        var focus = focusAfterClose ?? Keyboard.FocusedElement;
        try
        {
            var dialog = new SummaryPickerDialog(items, initialItemId) { Owner = owner };
            return dialog.ShowDialog() == true && dialog.SelectedSummary is { } summary
                ? SelectionResult<SummaryLibraryItem>.Accept(summary) : SelectionResult<SummaryLibraryItem>.Cancelled;
        }
        finally { RestoreFocus(owner, focus); }
    }
    private static void RestoreFocus(Window owner, IInputElement? focus)
    {
        if (focus is null || owner.Dispatcher.HasShutdownStarted) return;
        owner.Dispatcher.BeginInvoke(DispatcherPriority.Input, new Action(() =>
        {
            if (owner.IsLoaded && focus is UIElement { IsVisible: true, IsEnabled: true, Focusable: true } element &&
                element.Dispatcher == owner.Dispatcher && Window.GetWindow(element) == owner &&
                PresentationSource.FromVisual(element) is not null) Keyboard.Focus(element);
        }));
    }
}

internal sealed class PickerComposition
{
    internal bool IsComposing { get; private set; }
    internal PickerComposition(UIElement element)
    {
        element.AddHandler(TextCompositionManager.PreviewTextInputStartEvent, new TextCompositionEventHandler((_, _) => IsComposing = true), true);
        element.AddHandler(TextCompositionManager.PreviewTextInputUpdateEvent, new TextCompositionEventHandler((_, _) => IsComposing = true), true);
        element.AddHandler(TextCompositionManager.TextInputEvent, new TextCompositionEventHandler((_, _) => IsComposing = false), true);
        element.LostKeyboardFocus += (_, _) => IsComposing = false;
    }
}

internal static class PickerVisual
{
    internal static T? Ancestor<T>(DependencyObject? source) where T : DependencyObject
    {
        while (source is not null)
        {
            if (source is T target) return target;
            source = source is Visual or System.Windows.Media.Media3D.Visual3D ? VisualTreeHelper.GetParent(source) : LogicalTreeHelper.GetParent(source);
        }
        return null;
    }
    internal static bool SelectTreeItem(ItemsControl parent, string code)
    {
        parent.UpdateLayout();
        foreach (var item in parent.Items)
        {
            if (parent.ItemContainerGenerator.ContainerFromItem(item) is not TreeViewItem container) continue;
            if (item is AccountTreeNode node && node.Choice.Code == code) { container.IsSelected = true; container.BringIntoView(); return true; }
            if (SelectTreeItem(container, code)) return true;
        }
        return false;
    }
}
