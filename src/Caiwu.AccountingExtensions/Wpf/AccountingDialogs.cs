using System.Windows;

namespace Caiwu.AccountingExtensions.Wpf;

/// <summary>Composition hooks for the original System menu entries. Does not replace the host frame/menu.</summary>
public static class AccountingDialogs
{
    public static bool ShowReversePosting(Window owner, AccountingExtensionService service)
        => new ReversePostingWindow(service) { Owner = owner }.ShowDialog() == true;

    public static bool ShowReopenPeriod(Window owner, AccountingExtensionService service)
        => new ReopenPeriodWindow(service) { Owner = owner }.ShowDialog() == true;
}
