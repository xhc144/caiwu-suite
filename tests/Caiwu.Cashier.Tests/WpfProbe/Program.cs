using System.Globalization;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using Caiwu.Cashier;
using Caiwu.Cashier.Wpf;

namespace Caiwu.Cashier.WpfProbe;

/// <summary>Manual synthetic Windows probe. This is not the product shell or original software.</summary>
internal static class Program
{
    [STAThread]
    public static void Main()
    {
        var folder = Path.Combine(Path.GetTempPath(), "cashier-wpf-probe-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        var store = SqliteCashierStore.CreateSynthetic(Path.Combine(folder, "demo.cashier-synthetic.db"),
            new("synthetic-wpf", new(2026, 1, 1), new(2026, 1, 1), new(2026, 12, 31), "CNY",
                [new("1001", "合成现金", true, true, ["CNY"]), new("1002", "合成银行", true, true, ["CNY", "USD"]),
                 new("6001", "合成收入", true, false, ["CNY"]), new("6601", "合成费用", true, false, ["CNY"])]));
        var service = new CashierService(store);
        service.SaveOpening(0, new("1001", "CNY"), 2026, 1000, "synthetic");
        service.AddDocument(service.Read().Revision, new(new("1001", "CNY"), new(2026, 1, 10), "合成收款",
            DocumentDirection.Receipt, 200, "6001", "synthetic"));
        service.StageLedgerSnapshot(service.Read().Revision,
            [new("synthetic-line-1", "v1", new("1001", "CNY"), new(2026, 1, 10), "合成凭证001", "合成收款", 200, 0, true)], "synthetic");
        var windows = new CashierWindows(service, "synthetic", new SyntheticEditorFactory());
        var app = new Application();
        var shell = new Window { Title = "出纳 Windows 合成验收工具（非产品主框架）", Width = 850, Height = 420 };
        var panel = new DockPanel(); var menu = new Menu(); DockPanel.SetDock(menu, Dock.Top); panel.Children.Add(menu);
        var daily = new MenuItem { Header = "O日常业务" }; var system = new MenuItem { Header = "S系统管理" };
        menu.Items.Add(daily); menu.Items.Add(system);
        Add(daily, "单据录入", windows.CreateEntryWindow); Add(daily, "和账务对账", windows.CreateReconciliationSelectionWindow);
        Add(system, "期初数录入", windows.CreateOpeningWindow);
        var diagnostics = new MenuItem { Header = "合成测试入口" }; menu.Items.Add(diagnostics);
        Add(diagnostics, "直接打开 w_cn_slz_1（原运行时入口待验）", () => windows.CreateJournalWindow());
        panel.Children.Add(new TextBox { IsReadOnly = true, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(20),
            Text = "此工具只创建新的临时合成出纳文件。\n\n可操作：期初存盘、单据增加/修改/删除、对账读入/勾销/取消勾销；日记账通过标明的合成测试入口打开。\n\n单据编辑器是测试专用自动表格，不能作为原 DataWindow 内部布局证据。\n\n账务对账使用预置合成已过账分录，未连接公共总账。\n\n临时文件：" + folder });
        shell.Content = panel; app.Run(shell);
        void Add(MenuItem parent, string text, Func<Window> create)
        {
            var item = new MenuItem { Header = text }; parent.Items.Add(item);
            item.Click += (_, _) => { var child = create(); child.Owner = shell; child.Show(); };
        }
    }
}

/// <summary>Test-only renderer. The grid is deliberately not claimed to reproduce original coordinates.</summary>
internal sealed class SyntheticEditorFactory : ICashierDataWindowFactory
{
    public ICashierDocumentEditor CreateDocumentEditor(DocumentInput initial, BookDefinition book) => new SyntheticEditor(initial);
    private sealed class SyntheticEditor : ICashierDocumentEditor
    {
        private readonly DocumentInput original;
        private readonly Row row;
        private readonly DataGrid grid;
        public FrameworkElement View => grid;
        public SyntheticEditor(DocumentInput input)
        {
            original = input; row = new Row
            {
                Date = input.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), Summary = input.Summary,
                Direction = input.Direction == DocumentDirection.Receipt ? "收款" : "付款", Amount = input.Amount,
                CounterAccount = input.CounterAccount, Notes = input.Notes, CounterpartyName = input.CounterpartyName,
                CounterpartyBank = input.CounterpartyBank, CounterpartyBankAccount = input.CounterpartyBankAccount
            };
            grid = new DataGrid { AutoGenerateColumns = false, CanUserAddRows = false, CanUserDeleteRows = false,
                ItemsSource = new[] { row } };
            foreach (var (title, property) in new[] { ("日期", "Date"), ("摘要", "Summary"), ("收款/付款", "Direction"),
                ("金额", "Amount"), ("对方科目", "CounterAccount"), ("说明", "Notes"), ("对方户名", "CounterpartyName"),
                ("对方开户机构", "CounterpartyBank"), ("对方账号", "CounterpartyBankAccount") })
                grid.Columns.Add(new DataGridTextColumn { Header = title, Binding = new Binding(property) { ValidatesOnExceptions = true } });
        }
        public DocumentInput ReadInput()
        {
            if (!grid.CommitEdit(DataGridEditingUnit.Cell, true) || !grid.CommitEdit(DataGridEditingUnit.Row, true))
                throw new CashierRuleException("synthetic.input", "请修正输入。");
            var direction = row.Direction switch { "收款" => DocumentDirection.Receipt, "付款" => DocumentDirection.Payment,
                _ => throw new CashierRuleException("synthetic.direction", "请输入收款或付款。") };
            return original with { Date = DateOnly.ParseExact(row.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture),
                Summary = row.Summary, Direction = direction, Amount = row.Amount, CounterAccount = row.CounterAccount,
                Notes = row.Notes, CounterpartyName = row.CounterpartyName, CounterpartyBank = row.CounterpartyBank,
                CounterpartyBankAccount = row.CounterpartyBankAccount };
        }
    }
    public sealed class Row
    {
        public string Date { get; set; } = "";
        public string Summary { get; set; } = "";
        public string Direction { get; set; } = "收款";
        public decimal Amount { get; set; }
        public string? CounterAccount { get; set; }
        public string? Notes { get; set; }
        public string? CounterpartyName { get; set; }
        public string? CounterpartyBank { get; set; }
        public string? CounterpartyBankAccount { get; set; }
    }
}
