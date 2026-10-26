using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using Caiwu.Reporting.Books;

namespace Caiwu.Reporting.Wpf;

/// <summary>Original condition-window relative positions in design PBU; Viewbox is proportional layout, not pixel calibration.</summary>
public sealed class BooksQueryWindow : Window
{
    private readonly IBooksLedgerSource source;
    private readonly BooksKind kind;
    private readonly ComboBox accountFrom = new() { Name = "sle_1", IsEditable = true };
    private readonly ComboBox accountTo = new() { Name = "sle_2", IsEditable = true };
    private readonly TextBox year = new() { Name = "em_nf" };
    private readonly TextBox fromMonth = new() { Name = "em_1" };
    private readonly TextBox toMonth = new() { Name = "em_2" };
    private readonly ComboBox currency = new() { Name = "ddlb_3" };
    private readonly CheckBox includeUnposted = new() { Name = "cbx_1", Content = "包含未过账凭证" };
    private BooksLedgerInput input;
    public BooksQuery? Query { get; private set; }
    public BooksLedgerInput SelectedInput => input;

    public BooksQueryWindow(IBooksLedgerSource source, BooksKind kind, int fiscalYear, BooksQuery? previous = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (!Enum.IsDefined(kind)) throw new ArgumentOutOfRangeException(nameof(kind));
        this.source = source; this.kind = kind; input = Read(fiscalYear);
        Name = kind switch { BooksKind.GeneralLedger => "w_zc_zc", BooksKind.CashJournal => "w_zc_xjrjz", _ => "w_zc_yhrjz" };
        Title = kind switch { BooksKind.GeneralLedger => "总分类账", BooksKind.CashJournal => "日记账", _ => "银行日记帐" };
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        ResizeMode = ResizeMode.NoResize; SizeToContent = SizeToContent.WidthAndHeight;
        year.Text = fiscalYear.ToString(CultureInfo.InvariantCulture);
        fromMonth.Text = (previous?.FromMonth ?? input.Book.StartMonth).ToString(CultureInfo.InvariantCulture);
        toMonth.Text = (previous?.ToMonth ?? 12).ToString(CultureInfo.InvariantCulture);
        includeUnposted.IsChecked = previous?.IncludeUnposted ?? true; // Original checked design property, not an inferred runtime default.
        PopulateAccounts(previous);
        var general = kind == BooksKind.GeneralLedger;
        var bank = kind == BooksKind.BankJournal;
        var canvas = new Canvas { Width = general ? 2089 : bank ? 1970 : 1911, Height = general ? 964 : bank ? 1120 : 1128 };
        Content = new Viewbox { Width = 660, Height = general ? 340 : 410, Stretch = System.Windows.Media.Stretch.Uniform, Child = canvas };
        if (general)
        {
            Add(canvas, new TextBlock { Text = "会计年度" }, 631, 68, 251, 72);
            Add(canvas, year, 933, 60, 306, 92);
            Add(canvas, new GroupBox { Header = "科目代码" }, 59, 200, 1893, 360);
            Add(canvas, new TextBlock { Text = "从" }, 133, 296, 128, 72);
            Add(canvas, new TextBlock { Text = "到" }, 133, 416, 128, 72);
            Add(canvas, accountFrom, 302, 296, 1422, 88);
            Add(canvas, accountTo, 302, 416, 1422, 88);
            Add(canvas, Button("搜索", () => Search(accountFrom), "cb_3"), 1719, 300, 142, 84);
            Add(canvas, Button("搜索", () => Search(accountTo), "cb_4"), 1719, 420, 142, 84);
            Add(canvas, new TextBlock { Text = "提示：凭证只有过账后，才会在总账里体现" }, 201, 600, 1678, 68);
            Add(canvas, Button("确定", Confirm, "cb_1"), 654, 716, 265, 108);
            Add(canvas, Button("取消", Close, "cb_2"), 1129, 720, 265, 108);
        }
        else
        {
            Add(canvas, new GroupBox { Header = "科目代码" }, bank ? 50 : 59, bank ? 32 : 36, bank ? 1769 : 1696, bank ? 352 : 348);
            Add(canvas, new TextBlock { Text = "从" }, bank ? 87 : 91, bank ? 128 : 132, bank ? 137 : 133, 72);
            Add(canvas, new TextBlock { Text = "到" }, bank ? 87 : 91, bank ? 248 : 252, bank ? 137 : 133, 72);
            Add(canvas, accountFrom, 302, 124, bank ? 1294 : 1257, 88);
            Add(canvas, accountTo, 302, 244, bank ? 1294 : 1257, 88);
            Add(canvas, Button("搜索", () => Search(accountFrom), "cb_3"), bank ? 1600 : 1563, bank ? 128 : 132, 142, 84);
            Add(canvas, Button("搜索", () => Search(accountTo), "cb_4"), bank ? 1600 : 1563, bank ? 248 : 252, 142, 84);
            Add(canvas, new TextBlock { Text = "会计年度" }, bank ? 110 : 114, 428, 251, 72);
            Add(canvas, year, 375, 420, 306, 92);
            Add(canvas, new TextBlock { Text = "月份从" }, bank ? 722 : 704, 428, 247, 72);
            Add(canvas, fromMonth, bank ? 997 : 974, 420, 224, 92);
            Add(canvas, new TextBlock { Text = "到" }, bank ? 1243 : 1216, 428, 123, 72);
            Add(canvas, toMonth, bank ? 1394 : 1344, 420, 224, 92);
            Add(canvas, new TextBlock { Text = "币种" }, bank ? 439 : 338, bank ? 588 : 592, 247, 72);
            Add(canvas, currency, bank ? 713 : 608, 576, 462, 88);
            Add(canvas, includeUnposted, bank ? 713 : 594, bank ? 708 : 720, 608, 72);
            Add(canvas, Button("确定", Confirm, "cb_1"), bank ? 576 : 544, 836, bank ? 274 : 265, 108);
            Add(canvas, Button("取消", Close, "cb_2"), bank ? 992 : 965, 836, bank ? 274 : 265, 108);
        }
    }

    private BooksLedgerInput Read(int value)
    {
        if (!source.AvailableYears.Contains(value)) throw new ArgumentException("数据源未提供所选年度。");
        var loaded = source.ReadYear(value);
        if (loaded.Book.FiscalYear != value) throw new ArgumentException("数据源返回了其他年度，不能重贴年度使用。");
        return loaded;
    }
    private bool ReloadYear()
    {
        try
        {
            if (!int.TryParse(year.Text, out var value)) throw new ArgumentException("会计年度无效。");
            if (value != input.Book.FiscalYear)
            {
                var loaded = Read(value);
                if (loaded.Book.Id != input.Book.Id) throw new ArgumentException("数据源切换到了其他账套。");
                input = loaded; PopulateAccounts(null);
            }
            return true;
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
        { MessageBox.Show(this, ex.Message, Title); return false; }
    }
    private void PopulateAccounts(BooksQuery? previous)
    {
        // Filter by explicit classifications, never by an account-code-prefix convention.
        currency.ItemsSource = new[] { input.BaseCurrencyName }; currency.SelectedIndex = 0;
        var candidates = EligibleAccounts(input, kind).ToArray();
        foreach (var combo in new[] { accountFrom, accountTo })
        { combo.ItemsSource = candidates; combo.DisplayMemberPath = nameof(AccountOption.Display); combo.SelectedValuePath = nameof(AccountOption.Code); }
        accountFrom.SelectedValue = previous?.AccountFrom ?? candidates.FirstOrDefault()?.Code;
        accountTo.SelectedValue = previous?.AccountTo ?? candidates.LastOrDefault()?.Code;
    }
    internal static IEnumerable<AccountOption> EligibleAccounts(BooksLedgerInput ledger, BooksKind kind)
    {
        var catalog = ledger.Accounts.ToDictionary(a => a.Code, StringComparer.Ordinal);
        foreach (var a in ledger.Accounts.OrderBy(a => a.Code, StringComparer.Ordinal))
        {
            var current = a; var seen = new HashSet<string>(StringComparer.Ordinal);
            var classification = current.JournalKind;
            while (current.ParentCode is { } p && seen.Add(current.Code) && catalog.TryGetValue(p, out current!))
                if (classification == JournalAccountKind.None) classification = current.JournalKind;
            if (kind == BooksKind.GeneralLedger || classification == (kind == BooksKind.CashJournal ? JournalAccountKind.Cash : JournalAccountKind.Bank))
                yield return new(a.Code, a.Name);
        }
    }
    private void Search(ComboBox target)
    {
        if (!ReloadYear()) return;
        var dialog = new BooksAccountSearchWindow(EligibleAccounts(input, kind)) { Owner = this };
        if (dialog.ShowDialog() == true) target.SelectedValue = dialog.SelectedCode;
    }
    private void Confirm()
    {
        if (!ReloadYear()) return;
        try
        {
            var fromCode = (accountFrom.SelectedItem as AccountOption)?.Code ?? accountFrom.Text.Trim();
            var toCode = (accountTo.SelectedItem as AccountOption)?.Code ?? accountTo.Text.Trim();
            var general = kind == BooksKind.GeneralLedger;
            if (!int.TryParse(fromMonth.Text, out var m1) || !int.TryParse(toMonth.Text, out var m2))
                throw new ArgumentException("查询月份无效。");
            var query = new BooksQuery(kind, fromCode, toCode, general ? input.Book.StartMonth : m1, general ? 12 : m2,
                !general && includeUnposted.IsChecked == true);
            _ = BooksReportBuilder.Build(input, query);
            Query = query; DialogResult = true;
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or OverflowException)
        { MessageBox.Show(this, ex.Message, Title); }
    }
    internal static Button Button(string text, Action action, string name = "")
    { var b = new Button { Content = text, Name = name }; b.Click += (_, _) => action(); return b; }
    internal static void Add(Canvas canvas, FrameworkElement element, double x, double y, double width, double height)
    {
        Canvas.SetLeft(element, x); Canvas.SetTop(element, y); element.Width = width; element.Height = height;
        if (element is Control c) c.FontSize = 53;
        if (element is TextBlock t) t.FontSize = 53;
        canvas.Children.Add(element);
    }
    internal sealed record AccountOption(string Code, string Name) { public string Display => $"{Code} {Name}"; }
}
