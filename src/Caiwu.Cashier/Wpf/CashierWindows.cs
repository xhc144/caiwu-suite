using System.Collections.ObjectModel;
using System.Globalization;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;

namespace Caiwu.Cashier.Wpf;

/// <summary>
/// Module window shells for host/MDI integration. No MainWindow, navigation or shared contracts change.
/// Known outer controls follow cn/windows/cn.md. DataWindow column visual order remains unverified.
/// No synthetic ledger input button is exposed; the integration adapter supplies its versioned snapshot.
/// </summary>
public sealed class CashierWindows(CashierService service, string actor, ICashierDataWindowFactory editorFactory,
    Action<Window, string>? reportFailure = null)
{
    public Window CreateEntryWindow()
    {
        var window = Window("w_cn_lr", "单据录入", 1200, 820);
        var panel = new OriginalLayoutPanel(5559, 3740);
        var account = AccountPicker(); var month = new TextBox { Text = MonthText() };
        var search = new TextBox(); var hideDaily = new CheckBox { Content = "本日小计不显示" };
        var grid = JournalGrid(); long revision = 0; bool amountSort = false;
        JournalRow[] rows = [];
        void Refresh()
        {
            var key = Selected(account); var first = ParseMonth(month.Text);
            var journal = service.GetJournal(key, Max(first, service.Read().Book.OpeningDate), first.AddMonths(1).AddDays(-1), hideDaily.IsChecked != true);
            rows = journal.Rows;
            grid.ItemsSource = amountSort ? rows.OrderBy(x => x.Debit - x.Credit).ToArray() : rows;
            revision = journal.SourceRevision;
        }
        void Edit(bool add)
        {
            var key = Selected(account); var book = service.Read().Book;
            var old = (grid.SelectedItem as JournalRow)?.Document;
            if (!add && old is null) throw new CashierRuleException("document.selection", "请选择需要修改的单据。");
            if (!add) old = service.GetEditableDocument(revision, old!.Id);
            DocumentInput input = old is null
                ? new(key, Max(ParseMonth(month.Text), book.OpeningDate), "", DocumentDirection.Receipt, 0, null, actor)
                : new(old.Account, old.Date, old.Summary, old.Debit != 0 ? DocumentDirection.Receipt : DocumentDirection.Payment,
                    old.Debit != 0 ? old.Debit : old.Credit, old.CounterAccount, old.EnteredBy,
                    old.Notes, old.CounterpartyName, old.CounterpartyBank, old.CounterpartyBankAccount);
            var editor = editorFactory.CreateDocumentEditor(input, book);
            var dialog = Window("w_cn_lr_add", "增加单据", 560, 420); dialog.Owner = window;
            var layout = new OriginalLayoutPanel(2144, 1516);
            layout.Put(editor.View, 14, 20, 2094, 1172);
            var ok = Button("cb_1", "确定", () =>
            {
                var value = editor.ReadInput();
                if (add) service.AddDocument(revision, value);
                else service.UpdateDocument(revision, old!.Id, value, actor);
                dialog.DialogResult = true;
            }, dialog);
            layout.Put(ok, 379, 1260, 480, 120);
            layout.Put(Button("cb_2", "取消", () => dialog.DialogResult = false, dialog), 1029, 1260, 480, 120);
            dialog.Content = layout;
            if (dialog.ShowDialog() == true) Refresh();
        }
        void Delete()
        {
            if (grid.SelectedItem is not JournalRow { Document: { } d })
                throw new CashierRuleException("document.selection", "请选择需要删除的单据。");
            _ = service.GetEditableDocument(revision, d.Id, deleting: true);
            if (MessageBox.Show(window, "删除本条数据，请确认。", "删除记录", MessageBoxButton.YesNo,
                    MessageBoxImage.Question, MessageBoxResult.No) != MessageBoxResult.Yes) return;
            service.DeleteDocument(revision, d.Id, actor); Refresh();
        }
        var menu = OperationMenu(window,
            ("增加 Ctrl+A", "Ctrl+A", () => Edit(true)), ("修改", null, () => Edit(false)),
            ("删除", null, Delete), ("排序", null, () => { amountSort = !amountSort; Refresh(); }));
        panel.Put(menu, 0, 0, 5454, 200);
        panel.Put(Text("账户"), 23, 216, 219, 80, true); panel.Put(account, 201, 216, 3022, 100, true);
        panel.Put(Text("年月"), 3246, 216, 174, 80, true); panel.Put(month, 3433, 208, 393, 96, true);
        panel.Put(Button("cb_1", "查看", Refresh, window), 3831, 204, 325, 108);
        panel.Put(search, 4229, 216, 695, 84, true);
        panel.Put(Button("cb_2", "搜索", () =>
        {
            grid.ItemsSource = rows.Where(x => x.Summary.Contains(search.Text, StringComparison.CurrentCultureIgnoreCase)).ToArray();
        }, window), 4928, 208, 251, 100);
        panel.Put(Text("说明：单号为系统自动生成的不可修改的唯一识别号，便于对账时核对！"), 114, 320, 2354, 72, true);
        panel.Put(hideDaily, 3264, 316, 731, 84, true);
        panel.Put(grid, 23, 400, 4146, 1188);
        hideDaily.Click += (_, _) => Run(window, Refresh);
        account.SelectionChanged += (_, _) => Run(window, Refresh);
        window.Content = panel; window.Loaded += (_, _) => Run(window, Refresh);
        return window;
    }

    public Window CreateOpeningWindow()
    {
        var w = Window("w_cn_lr_qc", "单据录入", 1200, 500);
        var p = new OriginalLayoutPanel(7255, 1840);
        var state = service.Read(); long revision = state.Revision;
        var rows = new ObservableCollection<OpeningRow>(service.GetAccounts().Select(key => new OpeningRow
        {
            Code = key.Code, Name = state.Book.Accounts.Single(x => x.Code == key.Code).Name, Currency = key.Currency,
            Balance = state.Openings.SingleOrDefault(x => x.Account == key && x.Year == state.Book.OpeningDate.Year)?.Balance ?? 0
        }));
        var grid = Grid(false); grid.ItemsSource = rows;
        bool dirty = false;
        grid.CellEditEnding += (_, _) => dirty = true;
        Column(grid, "科目编码", "Code"); Column(grid, "科目名称", "Name"); Column(grid, "币种", "Currency");
        Column(grid, "期初余额", "Balance", false);
        void Save()
        {
            if (!grid.CommitEdit(DataGridEditingUnit.Cell, true) || !grid.CommitEdit(DataGridEditingUnit.Row, true))
                throw new CashierRuleException("opening.input", "请修正期初余额输入。");
            // All visible rows are one transaction, so a failure cannot save half a screen.
            revision = service.SaveOpenings(revision, rows.Select(x => new OpeningBalance(new(x.Code, x.Currency),
                state.Book.OpeningDate.Year, x.Balance)).ToArray(), actor).Revision;
            dirty = false;
        }
        w.Closing += (_, e) =>
        {
            if (!dirty) return;
            var answer = MessageBox.Show(w, "有数据未存盘，退出前是否存盘？", "出纳", MessageBoxButton.YesNoCancel,
                MessageBoxImage.Question, MessageBoxResult.Cancel);
            if (answer == MessageBoxResult.Cancel) e.Cancel = true;
            else if (answer == MessageBoxResult.Yes)
            {
                Run(w, Save);
                e.Cancel = dirty;
            }
        };
        p.Put(OperationMenu(w, ("存盘 Ctrl+S", "Ctrl+S", Save)), 0, 0, 4841, 200);
        p.Put(Text("说明：出纳系统的科目是由财务系统里含有现金流量选项的科目加外币币种组成的。"), 32, 212, 4974, 80, true);
        p.Put(Text("如果以下显示有错误，请到财务系统的【科目维护】里进行修改！"), 32, 288, 4974, 80, true);
        p.Put(Text($"本套账的出纳开账日期为： {state.Book.OpeningDate:yyyy年MM月}"), 110, 404, 1915, 96, true);
        p.Put(Text("账册排序方法"), 2162, 420, 457, 72, true);
        var original = new RadioButton { Content = "录入顺序", IsChecked = true, GroupName = "sort" };
        var amounts = new RadioButton { Content = "金额排序", GroupName = "sort" };
        original.Click += (_, _) => grid.ItemsSource = rows;
        amounts.Click += (_, _) => grid.ItemsSource = rows.OrderBy(x => x.Balance).ToArray();
        p.Put(original, 2697, 412, 457, 92, true); p.Put(amounts, 3177, 412, 457, 92, true);
        p.Put(grid, 14, 524, 3771, 1232); w.Content = p; return w;
    }

    public Window CreateJournalWindow(AccountKey? initial = null)
    {
        var w = Window("w_cn_slz_1", "出纳日记账", 1200, 720); var p = new OriginalLayoutPanel(6368, 2192);
        var accounts = AccountPicker(initial); var year = new TextBox { Text = service.Read().Book.OpeningDate.Year.ToString(CultureInfo.InvariantCulture) };
        var grid = JournalGrid();
        void Refresh()
        {
            int y = int.Parse(year.Text, CultureInfo.InvariantCulture);
            var book = service.Read().Book;
            grid.ItemsSource = service.GetJournal(Selected(accounts), Max(new DateOnly(y, 1, 1), book.OpeningDate), new(y, 12, 31)).Rows;
        }
        p.Put(OperationMenu(w), 9, 0, 699, 200);
        p.Put(Text("科目："), 55, 208, 270, 84, true); p.Put(accounts, 343, 208, 3022, 100, true);
        p.Put(Text("年度"), 3365, 220, 251, 80, true); p.Put(year, 3712, 220, 201, 80, true);
        p.Put(Button("cb_nd1", "<", () => { year.Text = (int.Parse(year.Text, CultureInfo.InvariantCulture) - 1).ToString(CultureInfo.InvariantCulture); Refresh(); }, w), 3611, 220, 101, 80);
        p.Put(Button("cb_nd2", ">", () => { year.Text = (int.Parse(year.Text, CultureInfo.InvariantCulture) + 1).ToString(CultureInfo.InvariantCulture); Refresh(); }, w), 3922, 220, 101, 80);
        // dw_3 is the second known journal surface. dw_master remains reserved for host DataWindow rendering.
        p.Put(grid, 1769, 356, 2697, 808);
        accounts.SelectionChanged += (_, _) => Run(w, Refresh);
        year.LostKeyboardFocus += (_, _) => Run(w, Refresh);
        w.Content = p; w.Loaded += (_, _) => Run(w, Refresh); return w;
    }

    public Window CreateReconciliationSelectionWindow()
    {
        var w = Window("w_cn_dz_xz", "选择", 700, 260); var p = new OriginalLayoutPanel(3159, 768);
        var account = AccountPicker();
        p.Put(Text("请选择需要对账的科目："), 18, 40, 818, 80, true);
        p.Put(account, 37, 156, 3040, 100, true);
        p.Put(Button("cb_1", "确定", () => { var child = CreateReconciliationWindow(Selected(account)); child.Owner = w.Owner; child.Show(); w.Close(); }, w), 562, 412, 480, 120);
        p.Put(Button("cb_2", "退出", w.Close, w), 1477, 412, 480, 120);
        w.Content = p; return w;
    }

    public Window CreateReconciliationWindow(AccountKey account)
    {
        var w = Window("w_cn_dz", "主从式应用示例", 1250, 760); var p = new OriginalLayoutPanel(5733, 2452);
        var docs = DocumentGrid(); var ledger = LedgerGrid(); long revision = service.Read().Revision;
        var query = new ReconciliationQuery(account, service.Read().Book.ActiveMonth.Year, service.Read().Book.ActiveMonth.Month);
        void Refresh()
        {
            var data = service.ReadReconciliation(query); docs.ItemsSource = data.Documents; ledger.ItemsSource = data.LedgerEntries;
            revision = data.SourceRevision;
        }
        void Load()
        {
            var dialog = Window("w_cn_dz_ny", "请选择勾账年月", 500, 320); dialog.Owner = w;
            var layout = new OriginalLayoutPanel(1824, 972);
            var month = new TextBox { Text = $"{query.Year:0000}-{query.Month:00}" };
            var matched = new CheckBox { Content = "含已经对账数据【仅限上面年月】", IsChecked = query.IncludeMatched };
            var earlier = new CheckBox { Content = "含之前月份未对账数据", IsChecked = query.IncludeEarlierUnmatched };
            layout.Put(Text("勾账年月："), 379, 192, 480, 80, true); layout.Put(month, 942, 176, 480, 116, true);
            layout.Put(matched, 407, 380, 1253, 80, true); layout.Put(earlier, 407, 512, 974, 80, true);
            layout.Put(Button("cb_3", "确定", () =>
            { var m = ParseMonth(month.Text); query = new(account, m.Year, m.Month, matched.IsChecked == true, earlier.IsChecked == true); Refresh(); dialog.DialogResult = true; }, dialog), 471, 672, 480, 120);
            layout.Put(Button("cb_2", "退出", () => dialog.DialogResult = false, dialog), 1056, 672, 480, 120);
            dialog.Content = layout; dialog.ShowDialog();
        }
        void Match()
        {
            if (!Confirm(w, "是否确认此次勾账(Y/N)?")) return;
            service.Reconcile(revision, account, docs.SelectedItems.Cast<CashierDocument>().Select(x => x.Id).ToArray(),
                ledger.SelectedItems.Cast<LedgerEntry>().Select(x => x.Id).ToArray(), actor); Refresh();
        }
        void Cancel()
        {
            var code = (ledger.SelectedItem as LedgerEntry)?.ReconciliationCode;
            if (code is null) throw new CashierRuleException("reconcile.selection", "请选择需要取消勾账凭证！");
            if (Confirm(w, "是否需要取消勾账(Y/N)?")) { service.CancelReconciliation(revision, code.Value, actor); Refresh(); }
        }
        void Auto()
        {
            if (Confirm(w, "系统将按照日期顺序，将金额一致的单据进行勾销！是否执行？"))
            { service.AutoReconcile(revision, query, actor); Refresh(); }
        }
        p.Put(OperationMenu(w, ("读入数据", null, Load), ("勾销", null, Match), ("取消勾销", null, Cancel)), 0, 0, 3506, 200);
        p.Put(Button("cb_1", "读入对账数据", Load, w), 2149, 220, 480, 120);
        p.Put(Button("cb_4", "自动选择勾销", Auto, w), 2633, 220, 503, 120);
        p.Put(Button("cb_2", "勾销", Match, w), 3136, 220, 480, 120);
        p.Put(Button("cb_3", "取消勾销", Cancel, w), 3621, 220, 480, 120);
        p.Put(Text("出纳数据："), 50, 248, 480, 80, true); p.Put(Text("账务数据："), 50, 1264, 489, 80, true);
        var cashTotal = Text("本次勾账金额 0"); var ledgerTotal = Text("本次勾账金额 0");
        docs.SelectionChanged += (_, _) => cashTotal.Text = $"本次勾账金额 {docs.SelectedItems.Cast<CashierDocument>().Sum(x => x.Net):G29}";
        ledger.SelectionChanged += (_, _) => ledgerTotal.Text = $"本次勾账金额 {ledger.SelectedItems.Cast<LedgerEntry>().Sum(x => x.Net):G29}";
        p.Put(cashTotal, 626, 248, 480, 80, true); p.Put(ledgerTotal, 626, 1264, 480, 80, true);
        p.Put(Text("说明：只有过账的凭证，才可以和出纳进行勾账"), 2171, 1260, 1691, 72, true);
        p.Put(docs, 18, 360, 4914, 884); p.Put(ledger, 27, 1372, 4946, 800);
        w.Content = p; w.Loaded += (_, _) => Run(w, Refresh); return w;
    }

    private ComboBox AccountPicker(AccountKey? initial = null)
    {
        var combo = new ComboBox { ItemsSource = service.GetAccounts().Select(x => new AccountChoice(x,
            $"{x.Code} {service.Read().Book.Accounts.Single(a => a.Code == x.Code).Name} {x.Currency}")).ToArray(), DisplayMemberPath = "Label" };
        combo.SelectedItem = combo.Items.Cast<AccountChoice>().FirstOrDefault(x => x.Key == initial) ?? combo.Items.Cast<AccountChoice>().FirstOrDefault();
        return combo;
    }
    private static AccountKey Selected(ComboBox picker) => (picker.SelectedItem as AccountChoice)?.Key
        ?? throw new CashierRuleException("account.selection", "请先选择账册！");
    private static Window Window(string id, string title, double width, double height)
    {
        var w = new Window { Title = title, Width = width, Height = height, MinWidth = 450, MinHeight = 240,
            FontSize = 13, WindowStartupLocation = WindowStartupLocation.CenterOwner };
        AutomationProperties.SetAutomationId(w, id); return w;
    }
    private static TextBlock Text(string text) => new() { Text = text, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap };
    private Button Button(string id, string text, Action action, Window owner)
    {
        var button = new Button { Content = text }; AutomationProperties.SetAutomationId(button, id);
        button.Click += (_, _) => Run(owner, action); return button;
    }
    private Menu OperationMenu(Window owner, params (string Text, string? Key, Action Action)[] actions)
    {
        var menu = new Menu(); var operation = new MenuItem { Header = "O.操作" }; menu.Items.Add(operation);
        foreach (var a in actions.Append(("F.返回 Ctrl+F4", "Ctrl+F4", (Action)owner.Close)))
        {
            var item = new MenuItem { Header = a.Item1, InputGestureText = a.Item2 }; operation.Items.Add(item);
            item.Click += (_, _) => Run(owner, a.Item3);
            if (a.Item2 is { } key)
            {
                var gesture = (KeyGesture)new KeyGestureConverter().ConvertFromInvariantString(key)!;
                owner.InputBindings.Add(new KeyBinding(new ActionCommand(() => Run(owner, a.Item3)), gesture));
            }
        }
        return menu;
    }
    private static DataGrid Grid(bool readOnly = true) => new() { AutoGenerateColumns = false, IsReadOnly = readOnly,
        CanUserAddRows = false, CanUserDeleteRows = false, SelectionMode = DataGridSelectionMode.Extended,
        SelectionUnit = DataGridSelectionUnit.FullRow, EnableRowVirtualization = true };
    private static void Column(DataGrid grid, string title, string binding, bool readOnly = true) =>
        grid.Columns.Add(new DataGridTextColumn { Header = title, Binding = new Binding(binding) { ValidatesOnExceptions = true }, IsReadOnly = readOnly });
    private static DataGrid JournalGrid()
    {
        var g = Grid(); Column(g, "日期", "Date"); Column(g, "单号", "Number"); Column(g, "摘要", "Summary");
        Column(g, "收款", "Debit"); Column(g, "付款", "Credit"); Column(g, "余额", "Balance");
        Column(g, "对方科目", "Document.CounterAccount"); Column(g, "录入人", "Document.EnteredBy"); Column(g, "说明", "Document.Notes"); return g;
    }
    private static DataGrid DocumentGrid()
    {
        var g = Grid(); Column(g, "日期", "Date"); Column(g, "单号", "Number"); Column(g, "摘要", "Summary");
        Column(g, "收款金额", "Debit"); Column(g, "付款金额", "Credit"); Column(g, "勾账码", "ReconciliationCode"); return g;
    }
    private static DataGrid LedgerGrid()
    {
        var g = Grid(); Column(g, "日期", "Date"); Column(g, "凭证", "VoucherId"); Column(g, "分录摘要", "Summary");
        Column(g, "借方金额", "Debit"); Column(g, "贷方金额", "Credit"); Column(g, "勾账码", "ReconciliationCode"); return g;
    }
    private string MonthText() => service.Read().Book.ActiveMonth.ToString("yyyy-MM", CultureInfo.InvariantCulture);
    private static DateOnly ParseMonth(string text) => DateOnly.ParseExact(text + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture);
    private static DateOnly Max(DateOnly a, DateOnly b) => a > b ? a : b;
    private static bool Confirm(Window w, string text) => MessageBox.Show(w, text, "出纳", MessageBoxButton.YesNo,
        MessageBoxImage.Question, MessageBoxResult.No) == MessageBoxResult.Yes;
    private void Run(Window owner, Action action)
    {
        CashierOperationBoundary.Run(action, message =>
        {
            if (reportFailure is not null) reportFailure(owner, message);
            else MessageBox.Show(owner, message, "出纳", MessageBoxButton.OK, MessageBoxImage.Information);
        });
    }
    private sealed record AccountChoice(AccountKey Key, string Label);
    private sealed class ActionCommand(Action execute) : ICommand
    {
        public event EventHandler? CanExecuteChanged { add { } remove { } }
        public bool CanExecute(object? parameter) => true;
        public void Execute(object? parameter) => execute();
    }
    public sealed class OpeningRow
    {
        public required string Code { get; init; }
        public required string Name { get; init; }
        public required string Currency { get; init; }
        public decimal Balance { get; set; }
    }
}
