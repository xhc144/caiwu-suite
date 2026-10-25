using System.IO;
using System.Windows.Controls;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Nonprofit.Reporting;
using Caiwu.Nonprofit.Reporting.Wpf;
using Caiwu.Persistence.Sqlite;

namespace Caiwu.ModuleWindowsQA.Financial;

internal static partial class Program
{
    private static async Task Nonprofit()
    {
        var directory = Path.Combine(output, "nonprofit"); Directory.CreateDirectory(directory);
        var userData = Path.Combine(directory, "user-data");
        var book = new BookInfo(Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"), "合成民非账套", AccountingRegime.Nonprofit, "np2026-synthetic", 2026, 1, 0, Clock);
        var incomeId = Guid.NewGuid(); var closeId = Guid.NewGuid(); var path = Path.Combine(directory, "synthetic.caiwu");
        using (var seed = SqliteLedgerStore.Create(path, book, [new("1002", "合成银行", null, BalanceDirection.Debit, true, 100, 0), new("3101", "合成非限定", null, BalanceDirection.Credit, true, 0, 100), new("4101", "合成捐赠", null, BalanceDirection.Credit, true, 0, 0)]))
        {
            var initial = seed.Read();
            seed.Write(initial with { Revision = 1, Vouchers = [
                new(incomeId, new(2026, 6, 1), "合成", 1, 0, "合成制单", "合成审核", VoucherStatus.Posted, [new("1002", "合成收入", 10, 0), new("4101", "合成收入", 0, 10)]),
                new(closeId, new(2026, 6, 30), "合成", 2, 0, "合成制单", "合成审核", VoucherStatus.Posted, [new("4101", "合成结转", 10, 0), new("3101", "合成结转", 0, 10)])] }, initial.Revision);
        }
        using var store = SqliteLedgerStore.Open(path); var service = new LedgerService(store);
        var snapshotBefore = System.Text.Json.JsonSerializer.Serialize(store.Read());
        var period = new ReportingPeriod(new(2026, 6, 1), new(2026, 6, 30), ReportingPeriodKind.Monthly);
        var panel = new NonprofitClassificationPanel(store.Read, period, userData, () => Clock);
        var window = await Show(panel, "民非明确分类与两表");
        Click(panel, "校验并预览");
        Check(panel.Preview is { HasCompleteReconciledCalculations: false } && panel.Preview.ActivityStatement.Lines.Any(l => l.Values.Any(v => v.Amount is null)), "unclassified source remains incomplete with missing values");
        Tab(panel, "1 科目语义"); await Settle();
        var accounts = Visuals<DataGrid>(panel).Single(g => ReferenceEquals(g.ItemsSource, panel.Editor.Accounts));
        var bank = panel.Editor.Accounts.Single(a => a.Code == "1002"); Choice(accounts, bank, 3, LedgerAccountSemantic.OtherBalance);
        Check(bank.Semantic == LedgerAccountSemantic.OtherBalance, "actual ComboBox writes explicit account semantic");
        var evidence = BeginTextEdit(accounts, bank, 6); await TypeChinese(window, evidence, "合成依据 中文Az09（）"); Commit(accounts);
        Check(bank.EvidenceReference == "合成依据 中文Az09（）", "native Chinese input reaches nonprofit evidence row");
        var donation = panel.Editor.Accounts.Single(a => a.Code == "4101"); Choice(accounts, donation, 4, ActivityFact.DonationIncome);
        Check(donation.ActivityFact == ActivityFact.DonationIncome, "nullable activity enum persists through real ComboBox");
        foreach (var a in panel.Editor.Accounts)
        {
            a.Semantic = a.Code switch { "1002" => LedgerAccountSemantic.OtherBalance, "3101" => LedgerAccountSemantic.UnrestrictedNetAssets, _ => LedgerAccountSemantic.IncomeExpense };
            a.ActivityFact = a.Code == "4101" ? ActivityFact.DonationIncome : null; a.EvidenceReference = "合成账套人工分类依据";
        }
        foreach (var line in panel.Editor.Lines)
        {
            line.EvidenceReference = "合成分录逐项复核";
            if (line.VoucherId == incomeId && line.AccountCode == "1002") line.SetBalanceOnly();
            else { line.Role = line.VoucherId == closeId ? SourceLineRole.IncomeExpenseClosing : SourceLineRole.RecognizedActivity; line.Class = RestrictionClass.Unrestricted; }
        }
        foreach (var b in panel.Editor.Balances) b.ConfirmZero("合成账套逐项明确确认为零");
        var bankFact = panel.Editor.Balances.Single(b => b.Fact == BalanceFact.BankDeposits); bankFact.Mode = BalanceMappingMode.AccountBalances; bankFact.AccountCodes = "1002";
        var net = panel.Editor.Balances.Single(b => b.Fact == BalanceFact.UnrestrictedNetAssets); net.Mode = BalanceMappingMode.AccountBalances; net.AccountCodes = "3101";
        var review = panel.Editor.Review; review.CnyAmountsConfirmed = review.CompleteYearToDateConfirmed = review.AccountMappingReviewed = review.LineClassificationReviewed = review.BusinessBreakdownComplete = true;
        review.FundraisingDisclosure = FundraisingDisclosure.NotApplicableConfirmed; review.YearOpeningBasis = YearOpeningBasis.Reviewed2026TransitionLedger; review.EvidenceReference = "仅合成数据；已逐项复核完整期间";
        Click(panel, "校验并预览");
        Check(panel.Preview?.HasCompleteReconciledCalculations == true && panel.Preview.CanIssueAsFormal == false, "explicit classifications produce reconciled two-table calculation preview, never formal issue");
        Check(panel.Preview!.BalanceSheet.Lines.Single(l => l.Key == "assets.total").Values[1].Amount == 110m &&
            panel.Preview.ActivityStatement.Lines.Single(l => l.Key == "donation").Values[0].Amount == 10m, "independent oracle: assets110 and unrestricted donation10");
        var beforeCancel = Files(userData); var binding = panel.Editor.Binding;
        NativeDialog(() => Click(panel, "另存新分类JSON"), null); SameFiles(beforeCancel, userData, "native classification save cancellation leaves no files");
        NativeDialog(() => Click(panel, "读取新快照并重新分类"), null);
        Check(panel.Editor.Binding == binding && panel.Preview!.HasCompleteReconciledCalculations, "reset confirmation cancellation retains classification and preview");
        var classification = Path.Combine(userData, "synthetic-reviewed.json");
        NativeDialog(() => Click(panel, "另存新分类JSON"), classification); Check(File.Exists(classification), "native Save button creates actual classified JSON");
        var savedHash = Hash(classification);
        NativeDialog(() => Click(panel, "导入分类JSON"), classification);
        Click(panel, "校验并预览"); Check(panel.Preview?.HasCompleteReconciledCalculations == true, "native classification load restores explicit reviewed two-table preview");
        Tab(panel, "资产负债表预览"); await Settle();
        NativeDialog(() => Click(panel, "导出当前表HTML"), Path.Combine(userData, "synthetic-balance.html"));
        Check(File.ReadAllText(Path.Combine(userData, "synthetic-balance.html")).Contains("110.00", StringComparison.Ordinal), "native HTML export contains actual balance110");
        await Capture(window, "nonprofit-balance.png");
        var balanceGrid = Visuals<DataGrid>(panel).Single(g => g.IsVisible && g.AutoGenerateColumns);
        var amountAligned = Visuals<System.Windows.Controls.TextBlock>(balanceGrid.Columns[1].GetCellContent(balanceGrid.Items[0])).First().TextAlignment;
        Tab(panel, "业务活动表预览"); await Settle();
        NativeDialog(() => Click(panel, "导出当前表CSV"), Path.Combine(userData, "synthetic-activity.csv"));
        Check(File.ReadAllText(Path.Combine(userData, "synthetic-activity.csv")).Contains("10.00", StringComparison.Ordinal), "native CSV export contains actual donation10");
        beforeCancel = Files(userData); NativeDialog(() => Click(panel, "导出当前表HTML"), null); SameFiles(beforeCancel, userData, "native export cancellation has no side effect");
        await Capture(window, "nonprofit-activity.png");
        Tab(panel, "1 科目语义"); await Settle();
        Edit(accounts, panel.Editor.Accounts.Single(a => a.Code == "1002"), 6, "合成再次复核依据");
        Click(panel, "导出当前表HTML");
        Check(panel.Preview is null && window.IsVisible && Visuals<TextBlock>(panel).Any(t => t.Text.Contains("分类已修改", StringComparison.Ordinal)), "classification edit refuses stale export and removes old complete-looking preview");
        SameFiles(beforeCancel, userData, "changed classification creates no export file");
        panel.ImportClassification("synthetic-reviewed.json"); Click(panel, "校验并预览"); Tab(panel, "业务活动表预览"); await Settle();
        Check(System.Text.Json.JsonSerializer.Serialize(store.Read()) == snapshotBefore, "classification, preview, save, load and export never write the saved ledger");
        var bound = new LedgerSnapshotStatementDataSource(store.Read, panel.Editor.BuildManifest()).CreateBoundPreview(Clock);
        var refusedPath = Path.Combine(userData, "synthetic-stale-should-not-exist.csv");
        NativeDialog(() => Click(panel, "导出当前表CSV"), refusedPath, () => {
            var seen = service.GetSnapshot(); service.SaveDraft(new(null, new(2026, 6, 25), "变更", null, 0, [new("1002", "合成来源变更", 1, 0), new("4101", "合成来源变更", 0, 1)], seen.Revision, seen.Book.Id), "合成制单");
        });
        Check(!File.Exists(refusedPath) && panel.Preview is null, "source changes inside actual native export dialog: no file and no stale complete preview");
        using var staleExport = new MemoryStream();
        try { bound.WriteCsv(NonprofitStatementForm.ActivityStatement, staleExport); throw new InvalidOperationException("Old classification export accepted."); }
        catch (ClassificationStaleException) { Check(staleExport.Length == 0, "source change rejects bound export before writing any bytes"); }
        try { panel.ImportClassification("synthetic-reviewed.json"); throw new InvalidOperationException("Old classification import accepted."); }
        catch (ClassificationStaleException) { Check(Hash(classification) == savedHash, "old classification rejected and original JSON preserved"); }
        Click(panel, "校验并预览"); await Settle();
        Check(window.IsVisible && panel.Preview is null && Visuals<TextBlock>(panel).Any(t => t.Text.Contains("NP_CLASSIFICATION_STALE", StringComparison.Ordinal)) &&
            Visuals<Button>(panel).Where(b => b.Content as string is "导出当前表CSV" or "导出当前表HTML" or "另存新分类JSON").All(b => !b.IsEnabled), "source-change error stays visible and disables save/export");
        SameFiles(beforeCancel, userData, "stale source produced no new or modified sidecar/export files");
        await Capture(window, "nonprofit-stale.png");
        Check(amountAligned == System.Windows.TextAlignment.Right, "rendered nonprofit numeric column is right aligned");
    }
}
