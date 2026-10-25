using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using Caiwu.Contracts;
using Caiwu.Desktop.Presentation;
using Caiwu.Reporting;
using Microsoft.Win32;

namespace Caiwu.Desktop.Dialogs;

public partial class ReportCenterWindow : Window
{
    private readonly Func<ReportKind, string?, DateOnly, DateOnly, ReportDocument> _build;
    private readonly Action<Guid, Window> _openVoucher;
    private ReportDocument? _document;
    private sealed record ViewState(int Kind, string? Account, DateTime? From, DateTime? To,
        string? RowKey, int Occurrence, double Vertical, double Horizontal);
    private ViewState? _parentView;
    private long _renderVersion;

    public ReportCenterWindow(IReadOnlyList<Account> accounts, DateOnly from, DateOnly to,
        Func<ReportKind, string?, DateOnly, DateOnly, ReportDocument> build, Action<Guid, Window> openVoucher)
    {
        InitializeComponent(); _build = build; _openVoucher = openVoucher;
        AccountInput.ItemsSource = accounts.Select(a => new AccountDisplay(a, !accounts.Any(child => child.ParentCode == a.Code))).ToArray();
        AccountInput.SelectedIndex = 0;
        FromInput.SelectedDate = from.ToDateTime(TimeOnly.MinValue); ToInput.SelectedDate = to.ToDateTime(TimeOnly.MinValue);
        Loaded += (_, _) => Generate();
    }

    private ReportKind Kind => KindInput.SelectedIndex switch { 1 => ReportKind.Ledger, 2 => ReportKind.VoucherList, _ => ReportKind.TrialBalance };
    private bool Generate()
    {
        try
        {
            if (FromInput.SelectedDate is not { } from || ToInput.SelectedDate is not { } to) throw new LedgerValidationException("请选择完整期间。");
            _document = _build(Kind, AccountInput.SelectedValue as string, DateOnly.FromDateTime(from), DateOnly.FromDateTime(to));
            _renderVersion++;
            ReportGrid.Columns.Clear();
            for (var i = 0; i < _document.Columns.Count; i++)
            {
                var column = _document.Columns[i]; if (column.Key == "voucherId") continue;
                ReportGrid.Columns.Add(new DataGridTextColumn { Header = column.Title,
                    Binding = new Binding($"Cells[{i}].DisplayText"), Width = column.Kind == ReportValueKind.Amount ? 125 : 145 });
            }
            ReportGrid.ItemsSource = _document.Rows;
            TotalText.Text = string.Join("    ", _document.Columns.Select((c, i) => (c, i)).Where(x => x.c.Kind == ReportValueKind.Amount)
                .Select(x => x.c.Title + " " + _document.Total.Cells[x.i].DisplayText));
            NoteText.Text = $"{_document.Metadata.Book.Name} · {_document.Metadata.From:yyyy-MM-dd} 至 {_document.Metadata.To:yyyy-MM-dd}\n{_document.Note}";
            ErrorText.Text = ""; return true;
        }
        catch (Exception ex) { ErrorText.Text = ex.Message; return false; }
    }
    private void Generate_Click(object sender, RoutedEventArgs e)
    { _parentView = null; BackButton.Visibility = Visibility.Collapsed; Generate(); }
    private static IEnumerable<T> Visuals<T>(DependencyObject root) where T : DependencyObject
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++)
        {
            var child = VisualTreeHelper.GetChild(root, i);
            if (child is T found) yield return found;
            foreach (var descendant in Visuals<T>(child)) yield return descendant;
        }
    }
    private string RowKey(ReportRow row) => row.VoucherId is { } id
        ? Kind == ReportKind.VoucherList ? "voucher:" + id : "ledger:" + id + ":" + row.AccountCode + ":" + string.Join("\u001f", row.Cells.Select(c => c.DisplayText))
        : "account:" + row.AccountCode;
    private ViewState CaptureView()
    {
        var scroll = Visuals<ScrollViewer>(ReportGrid).FirstOrDefault();
        var selected = ReportGrid.SelectedItem as ReportRow; var key = selected is null ? null : RowKey(selected);
        var occurrence = selected is null ? 0 : ReportGrid.Items.Cast<ReportRow>().TakeWhile(r => !ReferenceEquals(r, selected)).Count(r => RowKey(r) == key);
        return new(KindInput.SelectedIndex, AccountInput.SelectedValue as string, FromInput.SelectedDate, ToInput.SelectedDate,
            key, occurrence, scroll?.VerticalOffset ?? 0, scroll?.HorizontalOffset ?? 0);
    }
    private void RestoreView(ViewState view)
    {
        var version = _renderVersion;
        Dispatcher.BeginInvoke(DispatcherPriority.Loaded, new Action(() =>
        {
            if (version != _renderVersion) return;
            ReportGrid.UpdateLayout();
            var selected = view.RowKey is null ? null : ReportGrid.Items.Cast<ReportRow>().Where(r => RowKey(r) == view.RowKey).Skip(view.Occurrence).FirstOrDefault();
            ReportGrid.SelectedItem = selected;
            if (selected is not null) ReportGrid.ScrollIntoView(selected);
            Dispatcher.BeginInvoke(DispatcherPriority.ContextIdle, new Action(() =>
            {
                if (version != _renderVersion) return;
                ReportGrid.UpdateLayout();
                var scroll = Visuals<ScrollViewer>(ReportGrid).FirstOrDefault();
                scroll?.ScrollToVerticalOffset(view.Vertical); scroll?.ScrollToHorizontalOffset(view.Horizontal);
            }));
        }));
    }
    private void Back_Click(object sender, RoutedEventArgs e)
    {
        if (_parentView is not { } view) return;
        KindInput.SelectedIndex = view.Kind; AccountInput.SelectedValue = view.Account;
        FromInput.SelectedDate = view.From; ToInput.SelectedDate = view.To;
        if (!Generate()) return;
        _parentView = null; BackButton.Visibility = Visibility.Collapsed; RestoreView(view);
    }
    private void ExportCsv_Click(object sender, RoutedEventArgs e) => Export(false);
    private void ExportHtml_Click(object sender, RoutedEventArgs e) => Export(true);
    private void Export(bool html)
    {
        if (!Generate() || _document is null) return;
        try
        {
            var extension = html ? ".html" : ".csv";
            var dialog = new SaveFileDialog { Title = "导出 " + _document.Title, DefaultExt = extension,
                Filter = html ? "分页 HTML (*.html)|*.html" : "CSV 文件 (*.csv)|*.csv", FileName = _document.Title + extension };
            if (dialog.ShowDialog(this) != true) return;
            using var output = File.Create(dialog.FileName);
            if (html) ReportExporter.WriteHtml(_document, output, new HtmlExportOptions(12)); else ReportExporter.WriteCsv(_document, output);
            ErrorText.Text = "已保存：" + dialog.FileName;
        }
        catch (Exception ex) { ErrorText.Text = "导出未完成：" + ex.Message; }
    }
    private void Print_Click(object sender, RoutedEventArgs e)
    {
        if (!Generate() || _document is null) return;
        try { ReportPrinter.PrintReport(_document); } catch (Exception ex) { ErrorText.Text = "打印未完成：" + ex.Message; }
    }
    private void ReportGrid_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (ReportGrid.SelectedItem is not ReportRow row) return;
        try
        {
            if (row.VoucherId is { } id)
            {
                var detailView = CaptureView(); _openVoucher(id, this);
                if (Generate()) RestoreView(detailView);
            }
            else if (row.AccountCode is { } account && Kind == ReportKind.TrialBalance)
            {
                var parent = CaptureView(); KindInput.SelectedIndex = 1; AccountInput.SelectedValue = account;
                if (Generate()) { _parentView = parent; BackButton.Visibility = Visibility.Visible; }
            }
        }
        catch (Exception ex) { ErrorText.Text = ex.Message; }
    }
}
