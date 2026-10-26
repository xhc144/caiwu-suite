using System.Globalization;
using System.Windows;
using Caiwu.Contracts;

namespace Caiwu.AccountingExtensions.Wpf;

public partial class ReversePostingWindow : Window
{
    private readonly AccountingExtensionService service;
    private readonly LedgerMutationContext shownContext;
    private bool committing;

    public ReversePostingWindow(AccountingExtensionService service)
    {
        this.service = service ?? throw new ArgumentNullException(nameof(service));
        var shown = service.GetSnapshot();
        shownContext = new(shown.Book.Id, shown.Revision);
        InitializeComponent();
        YearBox.Text = shown.Book.FiscalYear.ToString(CultureInfo.InvariantCulture);
        FromMonthBox.Text = ThroughMonthBox.Text = Math.Min(12, shown.Book.ClosedThroughMonth + 1).ToString(CultureInfo.InvariantCulture);
    }

    private void Confirm_Click(object sender, RoutedEventArgs e)
    {
        if (committing) return;
        try
        {
            var year = Parse(YearBox.Text, "会计年度");
            var all = AllMonthsBox.IsChecked == true;
            var from = all ? 0 : Parse(FromMonthBox.Text, "起始月份");
            var through = all ? 0 : Parse(ThroughMonthBox.Text, "结束月份");
            committing = true; ConfirmButton.IsEnabled = false;
            service.ReversePosting(new(year, from, through, all, shownContext));
            DialogResult = true;
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "操作未完成：" + ex.Message, Title, MessageBoxButton.OK, MessageBoxImage.Warning);
        }
        finally { committing = false; ConfirmButton.IsEnabled = true; }
    }

    private static int Parse(string text, string field)
    {
        if (!int.TryParse(text.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var value))
            throw new LedgerValidationException($"请输入有效的{field}。");
        return value;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;
}
