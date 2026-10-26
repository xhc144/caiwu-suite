using System.Windows;
using System.Windows.Controls;

namespace Caiwu.Invoicing.Wpf;

/// <summary>Opt-in Windows review host. Does not wire or replace the product shell.</summary>
public static class SyntheticHost
{
    [STAThread]
    public static int Main(string[] args)
    {
        if (args.Length is < 2 or > 3 || args[0] is not ("--create-synthetic" or "--open-synthetic"))
        {
            MessageBox.Show("仅供合成验收：\n--create-synthetic <新文件.invoice-synthetic.json> <Qingsong|Chengben>\n--open-synthetic <已有文件.invoice-synthetic.json>", "发票模块验收");
            return 2;
        }
        int exitCode = 0;
        bool finished = false;
        InvoiceUi.Run(() =>
        {
            var store = new SyntheticJsonInvoiceStore(args[1]);
            if (args[0] == "--create-synthetic")
            {
                if (args.Length != 3 || !Enum.TryParse<InvoiceProduct>(args[2], out var product) || !Enum.IsDefined(product))
                    throw new InvoiceException("product", "请明确选择 Qingsong 或 Chengben。");
                store.Create(InvoiceSyntheticFixture.Create(product));
            }
            var service = new InvoiceService(store);
            var parameters = new InvoiceParameters();
            var state = service.Read();
            var window = new Window { Title = $"{state.Product} 发票 · 合成验收专用", Width = 1440, Height = 850, MinWidth = 1200, MinHeight = 600 };
            var root = new DockPanel();
            var menu = new Menu();
            var daily = new MenuItem { Header = "O日常业务" }; menu.Items.Add(daily);
            var body = new ContentControl();
            InvoiceEntryView? currentEntry = null;
            void Show(InvoiceDirection direction)
            {
                if (currentEntry is not null && !currentEntry.MayLeave()) return;
                currentEntry = new(service, direction, () => { currentEntry = null; body.Content = null; }); body.Content = currentEntry;
            }
            void Add(string caption, Action action)
            {
                var item = new MenuItem { Header = caption }; item.Click += (_, _) => InvoiceUi.Run(action); daily.Items.Add(item);
            }
            Add("销项发票录入", () => Show(InvoiceDirection.Output));
            Add("进项发票录入", () => Show(InvoiceDirection.Input));
            Add("发票处理", () =>
            {
                if (currentEntry is not null && !currentEntry.MayLeave()) return;
                new InvoicePlanWindow(service, parameters) { Owner = window }.ShowDialog();
                // Reload after sandbox posting to avoid presenting old source flags.
                currentEntry = null; body.Content = null;
            });
            Add("增值税比对", () =>
            {
                if (currentEntry is not null && !currentEntry.MayLeave()) return;
                currentEntry = null; body.Content = new InvoiceVatView(service, parameters, () => service.ReadSandboxLedger());
            });
            DockPanel.SetDock(menu, Dock.Top); root.Children.Add(menu); root.Children.Add(body); window.Content = root;
            window.Closing += (_, e) =>
            {
                try { if (currentEntry is not null && !currentEntry.MayLeave()) e.Cancel = true; }
                catch (Exception ex) { e.Cancel = true; MessageBox.Show(ex.Message, "发票"); }
            };
            Show(InvoiceDirection.Output);
            exitCode = new Application().Run(window);
            finished = true;
        });
        return finished ? exitCode : 1;
    }
}
