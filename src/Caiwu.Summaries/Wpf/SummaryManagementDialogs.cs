using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;

namespace Caiwu.Summaries.Wpf;

public static class SummaryManagementDialogs
{
    public static SummarySelection ShowManager(Window owner, ISummaryCatalog catalog, string bookDisplayName,
        Guid? initialSummaryId = null, IInputElement? focusAfterClose = null)
    {
        ArgumentNullException.ThrowIfNull(owner);
        owner.Dispatcher.VerifyAccess();
        var focus = focusAfterClose ?? Keyboard.FocusedElement;
        try
        {
            var window = new SummaryManagerWindow(catalog, bookDisplayName, initialSummaryId) { Owner = owner };
            return window.ShowDialog() == true && window.Result.Accepted ? window.Result : SummarySelection.Cancelled;
        }
        finally
        {
            if (!owner.Dispatcher.HasShutdownStarted)
                owner.Dispatcher.BeginInvoke(DispatcherPriority.Input, new Action(() =>
                {
                    if (owner.IsLoaded && focus is UIElement { IsVisible: true, IsEnabled: true, Focusable: true } element &&
                        element.Dispatcher == owner.Dispatcher && Window.GetWindow(element) == owner && PresentationSource.FromVisual(element) is not null)
                        Keyboard.Focus(element);
                }));
        }
    }
}
