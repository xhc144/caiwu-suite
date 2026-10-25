using System.Printing;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;

namespace Caiwu.ReportDesigner.Wpf;

/// <summary>Native Windows PrintDialog. No PDF engine or automatic default-printer submission.</summary>
public static class ReportDesignerPrinter
{
    public static bool Print(ReportPreview preview, Func<bool>? isCurrent = null)
    {
        ReportDesignerExport.EnsureExportable(preview);
        var dialog = new PrintDialog();
        if (dialog.PrintTicket is not null) {
            dialog.PrintTicket.PageOrientation = preview.Template.Orientation == PageOrientation.Landscape
                ? System.Printing.PageOrientation.Landscape : System.Printing.PageOrientation.Portrait;
            dialog.PrintTicket.PageMediaSize = new PageMediaSize(PageMediaSizeName.ISOA4);
        }
        if (dialog.ShowDialog() != true) return false;
        if (isCurrent is not null && !isCurrent()) throw new InvalidOperationException("打印对话框期间来源会话已失效，未提交打印作业。");
        var document = CreateDocument(preview, dialog.PrintableAreaWidth, dialog.PrintableAreaHeight);
        if (isCurrent is not null && !isCurrent()) throw new InvalidOperationException("来源会话已失效，未提交打印作业。");
        dialog.PrintDocument(((IDocumentPaginatorSource)document).DocumentPaginator, preview.Template.Title);
        return true;
    }
    /// <summary>Builds the actual print document; caller may use DocumentViewer for a Windows print preview.</summary>
    public static FlowDocument CreateDocument(ReportPreview preview, double pageWidth, double pageHeight)
    {
        ReportDesignerExport.EnsureExportable(preview);
        if (!double.IsFinite(pageWidth) || !double.IsFinite(pageHeight) || pageWidth < 200 || pageHeight < 200) throw new ArgumentOutOfRangeException(nameof(pageWidth));
        var document = new FlowDocument { PageWidth = pageWidth, PageHeight = pageHeight, PagePadding = new Thickness(45),
            ColumnWidth = pageWidth, FontFamily = new FontFamily("Segoe UI, Microsoft YaHei"), FontSize = 11, Foreground = Brushes.Black, Background = Brushes.White };
        var layout = ReportDesignerExport.Layout(preview);
        for (var page = 0; page < layout.LogicalPages; page++) {
            var section = new Section { BreakPageBefore = page > 0 };
            section.Blocks.Add(new Paragraph(new Run(preview.Template.Title)) { FontSize = 19, FontWeight = FontWeights.SemiBold });
            section.Blocks.Add(new Paragraph(new Run(preview.Template.Header)));
            // Required provenance and restrictions are outside user-editable template content on every logical page.
            foreach (var line in preview.AuditLines()) section.Blocks.Add(new Paragraph(new Run(line)) { FontSize = 9, Margin = new Thickness(0, 1, 0, 1) });
            section.Blocks.Add(new Paragraph(new Run($"逻辑页{page + 1}/{layout.LogicalPages}；长文本可能增加物理页数。")) { FontSize = 9 });
            var table = new Table { CellSpacing = 0 };
            var requested = (double)layout.RequestedWidth; var usable = Math.Max(100, pageWidth - 90);
            foreach (var c in preview.Columns) table.Columns.Add(new TableColumn { Width = new GridLength(usable * (double)c.Width / requested) });
            var group = new TableRowGroup(); table.RowGroups.Add(group); var header = new TableRow();
            foreach (var column in preview.Columns) header.Cells.Add(Cell(column.Title, false, true));
            group.Rows.Add(header);
            foreach (var row in preview.Rows.Skip(page * preview.Template.RowsPerPage).Take(preview.Template.RowsPerPage)) {
                if (row.Label.Length > 0) { var label = new TableRow(); var labelCell = Cell(row.Label, false, true); labelCell.ColumnSpan = preview.Columns.Count; label.Cells.Add(labelCell); group.Rows.Add(label); }
                var tableRow = new TableRow();
                foreach (var cell in row.Cells) tableRow.Cells.Add(Cell(cell.Text, cell.Number.HasValue, row.Kind != "data"));
                group.Rows.Add(tableRow);
            }
            section.Blocks.Add(table); document.Blocks.Add(section);
        }
        return document;
    }
    private static TableCell Cell(string text, bool number, bool bold) => new(new Paragraph(new Run(text)) {
        TextAlignment = number ? TextAlignment.Right : TextAlignment.Left, Margin = new Thickness(0),
        FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal
    }) { Padding = new Thickness(4), BorderThickness = new Thickness(.5), BorderBrush = Brushes.Gray };
}
