using System.Globalization;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using Caiwu.Reporting.Books;
using Microsoft.Win32;

namespace Caiwu.Reporting.Wpf;

/// <summary>Result sheet for w_zc_zc_1 / w_zc_xjrjz_1 / w_zc_yhrjz_1. All available actions perform real work.</summary>
public sealed class BooksResultView : UserControl
{
    private readonly IBooksLedgerSource source;
    private readonly Action<BooksVoucherReference>? openVoucher;
    private readonly ComboBox account = new() { Name = "ddlb_1", DisplayMemberPath = "Display", SelectedValuePath = "Code" };
    private readonly TextBlock year = new() { Name = "em_nd", TextAlignment = TextAlignment.Center };
    private readonly TextBlock status = new() { Margin = new Thickness(8), TextWrapping = TextWrapping.Wrap };
    private readonly DataGrid grid = new() { Name = "dw_master", IsReadOnly = true, AutoGenerateColumns = false, CanUserAddRows = false,
        SelectionMode = DataGridSelectionMode.Single, EnableRowVirtualization = true, CanUserSortColumns = false, CanUserReorderColumns = false,
        HeadersVisibility = DataGridHeadersVisibility.Column };
    private readonly Button previousYear = new() { Name = "cb_nd1", Content = "<" }, nextYear = new() { Name = "cb_nd2", Content = ">" };
    private BooksLedgerInput input;
    private bool updating;
    public BooksResult Result { get; private set; }
    public event EventHandler? ResultChanged;

    public BooksResultView(IBooksLedgerSource source, BooksLedgerInput input, BooksQuery query, Action closeSheet,
        Action<BooksVoucherReference>? openVoucher = null)
    {
        ArgumentNullException.ThrowIfNull(closeSheet);
        this.source = source; this.input = input; this.openVoucher = openVoucher;
        Name = query.Kind switch { BooksKind.GeneralLedger => "w_zc_zc_1", BooksKind.CashJournal => "w_zc_xjrjz_1", _ => "w_zc_yhrjz_1" };
        Result = BooksReportBuilder.Build(input, query);
        var layout = new DockPanel(); Content = layout;
        var menu = new Menu(); DockPanel.SetDock(menu, Dock.Top); layout.Children.Add(menu);
        var operations = new MenuItem { Header = "O.操作" }; menu.Items.Add(operations);
        var toolbar = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(4) };
        DockPanel.SetDock(toolbar, Dock.Top); layout.Children.Add(toolbar);
        void ActionItem(string name, string toolbarName, Action action, string? gesture = null)
        {
            var item = new MenuItem { Header = name, InputGestureText = gesture ?? "" };
            item.Click += (_, _) => Try(action); operations.Items.Add(item);
            var button = new Button { Content = toolbarName, Padding = new Thickness(9, 5, 9, 5), Margin = new Thickness(2) };
            button.Click += (_, _) => Try(action); toolbar.Children.Add(button);
        }
        ActionItem("另存...", "另存", Export);
        ActionItem("重新选择", "重选", () => Reselect(input.Book.FiscalYear));
        if (query.Kind != BooksKind.GeneralLedger && openVoucher is not null) ActionItem("查看凭证", "查看", ViewVoucher);
        operations.Items.Add(new Separator());
        ActionItem("打印预览", "预览", Preview);
        ActionItem("打印", "打印", Print, "Ctrl+P");
        operations.Items.Add(new Separator());
        ActionItem("首", "首项", () => Move(0), "Ctrl+Home");
        ActionItem("上移", "上项", () => Move(grid.SelectedIndex - 1), "UpArrow");
        ActionItem("下移", "下项", () => Move(grid.SelectedIndex + 1), "DownArrow");
        ActionItem("尾", "末项", () => Move(grid.Items.Count - 1), "Ctrl+End");
        ActionItem("F.返回", "返回", closeSheet, "Ctrl+F4");
        var header = new Canvas { Width = 6331, Height = 336 };
        var headerView = new Viewbox { Height = 66, Stretch = Stretch.Uniform, StretchDirection = StretchDirection.Both,
            HorizontalAlignment = HorizontalAlignment.Left, Child = header };
        DockPanel.SetDock(headerView, Dock.Top); layout.Children.Add(headerView);
        var bank = query.Kind == BooksKind.BankJournal;
        BooksQueryWindow.Add(header, new TextBlock { Text = "科目：" }, 55, 208, 270, 84);
        BooksQueryWindow.Add(header, account, bank ? 347 : 343, 208, 2103, 88);
        BooksQueryWindow.Add(header, BooksQueryWindow.Button("搜索", SearchAccount, "cb_1"), query.Kind == BooksKind.CashJournal ? 2441 : 2455, bank ? 208 : 204, 155, 88);
        BooksQueryWindow.Add(header, new TextBlock { Text = "会计年度" }, 2825, 220, 261, 80);
        BooksQueryWindow.Add(header, previousYear, 3095, 220, 101, 80);
        BooksQueryWindow.Add(header, year, 3195, 220, 201, 80);
        BooksQueryWindow.Add(header, nextYear, 3406, 220, 101, 80);
        previousYear.Click += (_, _) => Try(() => ChangeYear(-1));
        nextYear.Click += (_, _) => Try(() => ChangeYear(1));
        account.SelectionChanged += (_, _) => { if (!updating) DisplayAccount(); };
        DockPanel.SetDock(status, Dock.Bottom); layout.Children.Add(status);
        layout.Children.Add(grid);
        AddColumn("日期", nameof(BooksRow.Date), "yyyy-MM-dd", 100);
        AddColumn("凭证字号", nameof(BooksRow.VoucherLabel), null, 95);
        AddColumn("摘要", nameof(BooksRow.Summary), null, 200);
        AddColumn("科目编码", nameof(BooksRow.AccountCode), null, 90);
        AddColumn("对方科目", nameof(BooksRow.CounterAccounts), null, 180);
        AddColumn("结算类别", nameof(BooksRow.SettlementType), null, 90);
        AddColumn("支票号", nameof(BooksRow.CheckNumber), null, 100);
        AddColumn("银行票据", nameof(BooksRow.BillNumber), null, 100);
        AddColumn("借方发生额", nameof(BooksRow.Debit), "N2", 120);
        AddColumn("贷方发生额", nameof(BooksRow.Credit), "N2", 120);
        AddColumn("方向", nameof(BooksRow.Direction), null, 55);
        AddColumn("余额", nameof(BooksRow.BalanceAmount), "N2", 120);
        grid.Columns.Add(new DataGridTextColumn { Header = "状态", Binding = new Binding(nameof(BooksRow.Status)) { Converter = new VoucherStatusConverter() }, Width = 95 });
        grid.MouseDoubleClick += (_, _) => { if (openVoucher is not null && grid.SelectedItem is BooksRow { VoucherId: not null }) Try(ViewVoucher); };
        PreviewKeyDown += (_, e) =>
        {
            if (Keyboard.Modifiers == ModifierKeys.Control)
            {
                Action? action = e.Key switch { Key.P => Print, Key.F4 => closeSheet,
                    Key.Home => () => Move(0), Key.End => () => Move(grid.Items.Count - 1), _ => null };
                if (action is not null) { e.Handled = true; Try(action); }
            }
        };
        Refresh();
    }

    private Window OwnerWindow => Window.GetWindow(this) ?? throw new InvalidOperationException("账簿视图尚未放入窗口。");
    private BooksAccountReport Current => Result.Accounts.Single(a => a.Account.Code == (string)account.SelectedValue);
    private void AddColumn(string title, string property, string? format, double width) => grid.Columns.Add(new DataGridTextColumn {
        Header = title, Binding = new Binding(property) { StringFormat = format }, Width = width });
    private void Refresh()
    {
        updating = true;
        account.ItemsSource = Result.Accounts.Select(a => new BooksQueryWindow.AccountOption(a.Account.Code, a.Account.Name)).ToArray();
        account.SelectedIndex = 0; updating = false;
        year.Text = Result.Book.FiscalYear.ToString(CultureInfo.InvariantCulture);
        previousYear.IsEnabled = source.AvailableYears.Any(y => y < Result.Book.FiscalYear);
        nextYear.IsEnabled = source.AvailableYears.Any(y => y > Result.Book.FiscalYear);
        DisplayAccount(); ResultChanged?.Invoke(this, EventArgs.Empty);
    }
    private void DisplayAccount()
    {
        if (account.SelectedValue is null) return;
        grid.ItemsSource = Current.Rows;
        Move(0);
        status.Text = $"{Result.Book.Name}  {Result.Title}  {Result.Book.FiscalYear}年{Result.Query.FromMonth}—{Result.Query.ToMonth}月  " +
            $"{Result.BaseCurrencyName}  {(Result.Query.IncludeUnposted ? "包含未过账凭证" : "仅已过账凭证")}  " +
            $"期初 {Current.OpeningBalance:N2} + 借 {Current.PeriodDebit:N2} − 贷 {Current.PeriodCredit:N2} = 期末 {Current.ClosingBalance:N2}";
    }
    private void Reselect(int fiscalYear)
    {
        var dialog = new BooksQueryWindow(source, Result.Query.Kind, fiscalYear, Result.Query) { Owner = OwnerWindow };
        if (dialog.ShowDialog() != true) return;
        var selectedInput = dialog.SelectedInput;
        if (selectedInput.Book.Id != Result.Book.Id) throw new InvalidOperationException("年度数据源改变了账套身份。");
        var updated = BooksReportBuilder.Build(selectedInput, dialog.Query!);
        input = selectedInput; Result = updated; Refresh();
    }
    private void ChangeYear(int direction)
    {
        var years = source.AvailableYears.Where(y => direction < 0 ? y < Result.Book.FiscalYear : y > Result.Book.FiscalYear);
        if (!years.Any()) return;
        Reselect(direction < 0 ? years.Max() : years.Min());
    }
    private void SearchAccount()
    {
        var dialog = new BooksAccountSearchWindow(Result.Accounts.Select(a => new BooksQueryWindow.AccountOption(a.Account.Code, a.Account.Name))) { Owner = OwnerWindow };
        if (dialog.ShowDialog() == true) account.SelectedValue = dialog.SelectedCode;
    }
    private void Move(int index)
    {
        if (grid.Items.Count == 0) return;
        grid.SelectedIndex = Math.Clamp(index, 0, grid.Items.Count - 1);
        grid.ScrollIntoView(grid.SelectedItem);
    }
    private void ViewVoucher()
    {
        if (grid.SelectedItem is not BooksRow { VoucherId: { } id })
        { MessageBox.Show(OwnerWindow, "请选择一条凭证明细；期初、月计及累计行没有单张凭证。", Result.Title); return; }
        openVoucher?.Invoke(new(Result.Book.Id, Result.Revision, Result.Book.FiscalYear, id));
    }
    private void Export()
    {
        var dialog = new SaveFileDialog { Filter = "CSV 文件|*.csv|HTML 文件|*.html", AddExtension = true,
            FileName = $"{Result.Title}-{Current.Account.Code}", OverwritePrompt = true };
        if (dialog.ShowDialog(OwnerWindow) != true) return;
        var document = BooksDocumentBuilder.Create(Result, Current.Account.Code, DateTimeOffset.Now);
        using var stream = File.Create(dialog.FileName);
        if (dialog.FilterIndex == 1) ReportExporter.WriteCsv(document, stream);
        else { using var writer = new StreamWriter(stream, new System.Text.UTF8Encoding(false)); ReportExporter.WriteHtml(document, writer); }
    }
    private FlowDocument PrintDocument(double width = 1123, double height = 794)
    {
        var document = new FlowDocument { FontFamily = new FontFamily("Microsoft YaHei"), FontSize = 10,
            PageWidth = width, PageHeight = height, ColumnWidth = width - 48, PagePadding = new Thickness(24) };
        document.Blocks.Add(new Paragraph(new Run($"{Result.Title}：{Current.Account.Code} {Current.Account.Name}")) { FontSize = 18 });
        document.Blocks.Add(new Paragraph(new Run($"{Result.Book.Name}  {Result.Book.FiscalYear}年{Result.Query.FromMonth}—{Result.Query.ToMonth}月 " +
            $"{Result.BaseCurrencyName}  {(Result.Query.IncludeUnposted ? "包含未过账凭证" : "仅已过账凭证")}")));
        var table = new Table { CellSpacing = 0, BorderBrush = Brushes.Gray, BorderThickness = new Thickness(1) };
        var columnWidths = new double[] { 82, 80, 145, 130, 75, 75, 75, 80, 80, 30, 90 };
        var scale = (width - 48) / columnWidths.Sum();
        foreach (var columnWidth in columnWidths) table.Columns.Add(new TableColumn { Width = new GridLength(columnWidth * scale) });
        var group = new TableRowGroup(); table.RowGroups.Add(group);
        void Row(params string[] values)
        {
            var row = new TableRow();
            foreach (var value in values) row.Cells.Add(new TableCell(new Paragraph(new Run(value))) {
                BorderBrush = Brushes.Gray, BorderThickness = new Thickness(.5), Padding = new Thickness(3) });
            group.Rows.Add(row);
        }
        Row("日期", "凭证字号", "摘要", "对方科目", "结算类别", "支票号", "银行票据", "借方", "贷方", "方向", "余额");
        foreach (var r in Current.Rows) Row(r.Date?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "", r.VoucherLabel,
            r.Summary, r.CounterAccounts, r.SettlementType, r.CheckNumber, r.BillNumber, r.Debit.ToString("F2", CultureInfo.InvariantCulture),
            r.Credit.ToString("F2", CultureInfo.InvariantCulture), r.Direction, r.BalanceAmount.ToString("F2", CultureInfo.InvariantCulture));
        document.Blocks.Add(table); return document;
    }
    private void Preview()
    {
        var viewer = new DocumentViewer { Document = PrintDocument() };
        new Window { Owner = OwnerWindow, Title = "帐册打印", Content = viewer, Width = 1100, Height = 760,
            WindowStartupLocation = WindowStartupLocation.CenterOwner }.Show();
    }
    private void Print()
    {
        var dialog = new PrintDialog();
        if (dialog.ShowDialog() != true) return;
        var document = PrintDocument(dialog.PrintableAreaWidth, dialog.PrintableAreaHeight);
        dialog.PrintDocument(((IDocumentPaginatorSource)document).DocumentPaginator, Result.Title);
    }
    private void Try(Action action)
    {
        try { action(); }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or OverflowException or IOException or UnauthorizedAccessException or System.Printing.PrintSystemException)
        { MessageBox.Show(Window.GetWindow(this), ex.Message, Result.Title); }
    }

    private sealed class VoucherStatusConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture) => value switch {
            Contracts.VoucherStatus.Posted => "已过账", Contracts.VoucherStatus.Reviewed => "未过账（已审核）", Contracts.VoucherStatus.Draft => "未过账（草稿）", _ => "" };
        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) => Binding.DoNothing;
    }
}
