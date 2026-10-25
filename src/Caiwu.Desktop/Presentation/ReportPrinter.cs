using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using Caiwu.Contracts;

namespace Caiwu.Desktop.Presentation;

public static class ReportPrinter
{
    public static void PrintVoucher(BookInfo book, Voucher voucher)
    {
        var status = voucher.Status == VoucherStatus.Posted ? "已记账" : "未记账";
        var subtitle = $"{voucher.Date:yyyy-MM-dd}    {voucher.Kind}-{voucher.Number:0000}    附单 {voucher.AttachmentCount} 张    {status}";
        PrintTable(book.Name + " · 记账凭证", subtitle,
            ["摘要", "科目", "借方金额", "贷方金额"],
            voucher.Lines.Select(l => (IReadOnlyList<object?>)new object?[] { l.Summary, l.AccountCode, l.Debit, l.Credit }),
            $"借方合计：{AmountInput.Display(voucher.Lines.Sum(l => l.Debit))}    贷方合计：{AmountInput.Display(voucher.Lines.Sum(l => l.Credit))}\n制单：{voucher.PreparedBy}    审核：{voucher.ReviewedBy ?? "—"}");
    }

    public static void PrintTable(string title, string subtitle, IReadOnlyList<string> headers,
        IEnumerable<IReadOnlyList<object?>> rows, string footer = "")
    {
        var dialog = new PrintDialog();
        if (dialog.ShowDialog() != true) return;
        var document = new FlowDocument
        {
            FontFamily = new FontFamily("Microsoft YaHei UI"), FontSize = 10,
            PagePadding = new Thickness(24), ColumnWidth = double.PositiveInfinity,
            PageWidth = dialog.PrintableAreaWidth, PageHeight = dialog.PrintableAreaHeight
        };
        document.Blocks.Add(new Paragraph(new Run(title)) { FontSize = 20, FontWeight = FontWeights.Bold });
        document.Blocks.Add(new Paragraph(new Run(subtitle)) { Margin = new Thickness(0, 0, 0, 14) });
        var table = new Table { CellSpacing = 0 };
        foreach (var _ in headers) table.Columns.Add(new TableColumn { Width = new GridLength(1, GridUnitType.Star) });
        var group = new TableRowGroup(); table.RowGroups.Add(group);
        var header = new TableRow { FontWeight = FontWeights.Bold, Background = Brushes.LightGray };
        foreach (var text in headers) header.Cells.Add(Cell(text));
        group.Rows.Add(header);
        foreach (var data in rows)
        {
            var row = new TableRow();
            foreach (var value in data)
            {
                var cell = Cell(value is decimal amount ? AmountInput.Display(amount) : Convert.ToString(value, CultureInfo.CurrentCulture) ?? "");
                if (value is decimal) cell.TextAlignment = TextAlignment.Right;
                row.Cells.Add(cell);
            }
            group.Rows.Add(row);
        }
        document.Blocks.Add(table);
        if (!string.IsNullOrWhiteSpace(footer)) document.Blocks.Add(new Paragraph(new Run(footer)) { Margin = new Thickness(0, 14, 0, 0) });
        dialog.PrintDocument(((IDocumentPaginatorSource)document).DocumentPaginator, title);
    }

    private static TableCell Cell(string text) => new(new Paragraph(new Run(text)) { Margin = new Thickness(4) })
    { BorderBrush = Brushes.LightGray, BorderThickness = new Thickness(0, 0, 0, 0.5) };
}
