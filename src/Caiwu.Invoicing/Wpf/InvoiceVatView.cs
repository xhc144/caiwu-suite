using System.Globalization;
using System.Windows;
using System.Windows.Controls;

namespace Caiwu.Invoicing.Wpf;

/// <summary>w_fp_zzs_hz. Ledger input is explicit; null remains not assessed.</summary>
public sealed class InvoiceVatView : UserControl
{
    public InvoiceVatView(InvoiceService service, InvoiceParameters parameters, Func<IEnumerable<LedgerTaxLine>?> ledger)
    {
        var root = new DockPanel();
        var strip = new StackPanel { Orientation = Orientation.Horizontal, Margin = new(8) };
        var year = InvoiceUi.Text(service.Read().OpenMonth.Year.ToString(CultureInfo.InvariantCulture));
        var month = new RadioButton { Content = "按月统计", GroupName = "period", IsChecked = true, Margin = new(10), VerticalAlignment = VerticalAlignment.Center };
        var quarter = new RadioButton { Content = "按季统计", GroupName = "period", Margin = new(10), VerticalAlignment = VerticalAlignment.Center };
        var grid = InvoiceUi.Grid(); grid.IsReadOnly = true;
        strip.Children.Add(InvoiceUi.Label("年度：")); strip.Children.Add(year); strip.Children.Add(month); strip.Children.Add(quarter);
        strip.Children.Add(InvoiceUi.Button("统   计", () => grid.ItemsSource = service.CompareVat(
            int.Parse(year.Text, CultureInfo.InvariantCulture), quarter.IsChecked == true, parameters.Accounts.OutputTax,
            parameters.Accounts.InputTax, ledger())));
        DockPanel.SetDock(strip, Dock.Top); root.Children.Add(strip);
        foreach (var col in new[] { ("年月", "Period"), ("销项税-账面", "OutputInLedger"), ("销项税-票面", "OutputOnInvoice"),
                     ("进项税-账面", "InputInLedger"), ("进项税-票面", "InputOnInvoice"), ("销项差额", "OutputDifference"), ("进项差额", "InputDifference") })
            InvoiceUi.Column(grid, col.Item1, col.Item2, true);
        root.Children.Add(grid); Content = root;
    }
}
