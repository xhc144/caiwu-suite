using System.Windows;
using Caiwu.Reporting.Books;

namespace Caiwu.Reporting.Wpf;

/// <summary>Standalone host for module validation. Production MDI hosts embed BooksResultView and supply closeSheet.</summary>
public sealed class BooksWindow : Window
{
    private BooksWindow(IBooksLedgerSource source, BooksLedgerInput input, BooksQuery query,
        Action<BooksVoucherReference>? openVoucher)
    {
        Width = 1200; Height = 720; MinWidth = 850; MinHeight = 420;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        var view = new BooksResultView(source, input, query, Close, openVoucher);
        Content = view; Title = view.Result.Title;
        view.ResultChanged += (_, _) => Title = view.Result.Title;
    }

    public static BooksWindow? Open(Window owner, IBooksLedgerSource source, BooksKind kind, int fiscalYear,
        Action<BooksVoucherReference>? openVoucher = null)
    {
        ArgumentNullException.ThrowIfNull(owner); ArgumentNullException.ThrowIfNull(source);
        var selection = new BooksQueryWindow(source, kind, fiscalYear) { Owner = owner };
        if (selection.ShowDialog() != true) return null;
        var result = new BooksWindow(source, selection.SelectedInput, selection.Query!, openVoucher) { Owner = owner };
        result.Show(); return result;
    }
}
