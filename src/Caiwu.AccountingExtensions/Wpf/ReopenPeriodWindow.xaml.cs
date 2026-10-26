using System.Globalization;
using System.Windows;
using Caiwu.Contracts;

namespace Caiwu.AccountingExtensions.Wpf;

public partial class ReopenPeriodWindow : Window
{
    private readonly AccountingExtensionService service;
    private readonly LedgerMutationContext shownContext;
    private readonly int year;
    private bool committing;

    public ReopenPeriodWindow(AccountingExtensionService service)
    {
        this.service = service ?? throw new ArgumentNullException(nameof(service));
        var shown = service.GetSnapshot();
        shownContext = new(shown.Book.Id, shown.Revision);
        year = shown.Book.FiscalYear;
        InitializeComponent();
        PeriodLabel.Text = shown.Book.ClosedThroughMonth < shown.Book.StartMonth
            ? "已到开账日期" : string.Create(CultureInfo.InvariantCulture, $"{year}年{shown.Book.ClosedThroughMonth:00}月");
    }

    private void Confirm_Click(object sender, RoutedEventArgs e)
    {
        if (committing) return;
        try
        {
            committing = true; ConfirmButton.IsEnabled = false;
            service.ReopenPeriod(new(year, AllMonthsBox.IsChecked == true, shownContext));
            DialogResult = true;
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "操作未完成：" + ex.Message, Title, MessageBoxButton.OK, MessageBoxImage.Warning);
        }
        finally { committing = false; ConfirmButton.IsEnabled = true; }
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;
}
