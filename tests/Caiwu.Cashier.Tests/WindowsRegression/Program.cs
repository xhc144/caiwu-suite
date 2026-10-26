using System.Windows;
using System.Windows.Controls;
using Caiwu.Cashier;
using Caiwu.Cashier.Integration;
using Caiwu.Cashier.Wpf;
using Caiwu.Contracts;

namespace Caiwu.Cashier.WindowsRegression;

/// <summary>
/// Windows-only regression through the actual opening window and its actual routed Save handler.
/// The ledger double simulates the CAS loser after a successful same-revision snapshot read.
/// No original application, real account set, production file or public posting is used.
/// </summary>
internal static class Program
{
    [STAThread]
    public static int Main()
    {
        try
        {
            var application = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            var ledger = new RacingLedger();
            var definition = new BookDefinition(ledger.BookId.ToString("D"), new(2026, 1, 1), new(2026, 1, 1),
                new(2026, 12, 31), "CNY", [new("1001", "合成现金", true, true, ["CNY"])]);
            var messages = new List<(Window Owner, string Message)>();
            CashierWindows Windows() => new(new CashierService(new ParityCashierStore(ledger, definition, "synthetic")),
                "synthetic", new UnusedEditorFactory(), (owner, message) => messages.Add((owner, message)));
            var first = Windows().CreateOpeningWindow();
            var second = Windows().CreateOpeningWindow();
            var panel = (Panel)second.Content;
            var grid = panel.Children.OfType<DataGrid>().Single();
            var edited = (CashierWindows.OpeningRow)grid.Items[0];
            edited.Balance = 987.123456789m;
            second.Show(); second.UpdateLayout();
            var operationMenu = panel.Children.OfType<Menu>().Single();
            var operation = (MenuItem)operationMenu.Items[0];
            var save = operation.Items.OfType<MenuItem>().Single(x => x.Header.ToString()!.StartsWith("存盘", StringComparison.Ordinal));
            int readsBeforeSave = ledger.ReadCount;

            // Dispatch the real menu event. Its Run boundary must handle the public CAS exception.
            save.RaiseEvent(new RoutedEventArgs(MenuItem.ClickEvent, save));
            Require(ledger.SaveCount == 1, "CAS failure must not retry a write.");
            Require(ledger.ReadCount == readsBeforeSave + 1, "CAS failure must not refresh a token.");
            Require(ledger.LastExpectedRevision == 7, "Submission must keep the original revision.");
            Require(messages.Count == 1 && messages[0].Owner == second && messages[0].Message.Contains("显式重载"),
                "The actual window must present a conflict message.");
            Require(second.IsVisible && edited.Balance == 987.123456789m, "Conflict must leave the window and input intact.");
            Require(ledger.ModuleCommitCount == 0, "Failed source edits must not commit.");

            // Without an explicit reload the window retains revision 7. Another save fails before
            // calling the public writer at revision 8; silently accepting a refreshed token would fail this check.
            save.RaiseEvent(new RoutedEventArgs(MenuItem.ClickEvent, save));
            Require(ledger.SaveCount == 1 && messages.Count == 2, "The window must retain its original context after conflict.");
            Require(second.IsVisible && edited.Balance == 987.123456789m, "Repeated conflict must preserve input.");
            second.Close(); first.Close(); application.Shutdown();
            Console.WriteLine("PASS: public CAS exception -> actual WPF Save menu -> conflict feedback, input retained, no refresh/retry/commit.");
            return 0;
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"FAIL: {e.GetType().Name}: {e.Message}");
            return 1;
        }
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private sealed class UnusedEditorFactory : ICashierDataWindowFactory
    {
        public ICashierDocumentEditor CreateDocumentEditor(DocumentInput initial, BookDefinition book) =>
            throw new InvalidOperationException("Opening-window regression must not open a document editor.");
    }

    private sealed class RacingLedger : IParityLedgerService
    {
        public Guid BookId { get; } = Guid.Parse("00000000-0000-0000-0000-000000000789");
        private long revision = 7;
        public int ReadCount { get; private set; }
        public int SaveCount { get; private set; }
        public int ModuleCommitCount => 0;
        public long LastExpectedRevision { get; private set; }
        public ModuleLedgerSnapshot GetModuleSnapshot()
        {
            ReadCount++;
            return new(new LedgerSnapshot(revision,
                new(BookId, "合成账套", AccountingRegime.Enterprise, "synthetic", 2026, 1, 0, DateTimeOffset.UnixEpoch),
                [new("1001", "合成现金", null, BalanceDirection.Debit, true, 0, 0)], [], []), [], []);
        }
        public void SaveModuleDocuments(ModuleDocumentBatch batch, string operatorName)
        {
            SaveCount++; LastExpectedRevision = batch.Context.ExpectedRevision;
            // The winning transaction belongs to another window after this loser's read.
            revision = 8;
            throw new StoreConcurrencyException("synthetic losing public CAS");
        }
        public ModuleVoucherReceipt AcceptVoucherProposal(VoucherProposal proposal, string operatorName) =>
            throw new InvalidOperationException("Opening-window regression must not generate a voucher.");
    }
}
