using System.IO;
using System.Windows.Automation;
using System.Windows.Controls;
using Caiwu.Costing;
using Caiwu.Costing.Wpf;

namespace Caiwu.ModuleWindowsQA.Financial;

internal static partial class Program
{
    private static async Task Costing()
    {
        var directory = Path.Combine(output, "costing"); Directory.CreateDirectory(directory);
        var book = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        var page = new CostWorksheetPage(book, new(2026, 10, 1));
        var window = await Show(page, "成本工作表");
        Click(page, "载入合成样例"); Click(page, "计算 / 复算"); await Settle();
        Check(page.Editor.Result?.FinishedCost == 250m, "author sample independently totals250.00");
        var preparedBy = Visuals<TextBox>(page).Single(t => AutomationProperties.GetAutomationId(t) == "PreparedBy");
        await TypeChinese(window, preparedBy, "制表甲 中文Az09（）-.");
        Check(page.Editor.PreparedBy == preparedBy.Text && page.Editor.Result is null, "native metadata edit updates binding and invalidates calculation");
        var stages = Visuals<DataGrid>(page).Single(g => AutomationProperties.GetAutomationId(g) == "Stages");
        Edit(stages, stages.Items[0], 4, "84.00"); Click(page, "计算 / 复算");
        Check(page.Editor.Result?.FinishedCost == 254m, "actual labor cell edit recalculates250->254");
        var json = Path.Combine(directory, "synthetic-audit.json"); var csv = Path.Combine(directory, "synthetic-details.csv");
        CostWorksheetExport.SaveNewJson(json, page.Editor.GetCalculatedInput());
        CostWorksheetExport.SaveNewCsv(csv, page.Editor.GetCalculatedInput());
        var reopened = CostWorksheetExport.OpenJson(json, book);
        page.Editor.Load(reopened.Input); Click(page, "计算 / 复算");
        Check(page.Editor.Result?.FinishedCost == 254m && page.Editor.PreparedBy == preparedBy.Text, "actual editor reads back JSON and recalculates254");
        var jsonHash = Hash(json);
        try { CostWorksheetExport.SaveNewJson(json, page.Editor.GetCalculatedInput()); throw new InvalidOperationException("Existing JSON was overwritten."); }
        catch (IOException) { Check(Hash(json) == jsonHash, "existing audit JSON preserved on duplicate destination"); }
        try { CostWorksheetExport.OpenJson(json, Guid.NewGuid()); throw new InvalidOperationException("Cross-book import accepted."); }
        catch (CostingValidationException) { Check(page.Editor.Result?.FinishedCost == 254m, "cross-book JSON refused without mutating current editor"); }
        var beforeCancel = Files(directory); var inputBefore = page.Editor.Result!.InputFingerprint;
        NativeDialog(() => Click(page, "导出审核 JSON"), null);
        Check(page.Editor.Result?.InputFingerprint == inputBefore, "native save cancellation retains calculation and editor");
        SameFiles(beforeCancel, directory, "native save cancellation creates no files");
        NativeDialog(() => Click(page, "打开审核 JSON"), null);
        SameFiles(beforeCancel, directory, "native open cancellation creates no files");
        await Capture(window, "costing-stages.png");
        // Independent cent oracle: one cent split equally among A/B/C must award A exactly one cent.
        page.Editor.Load(new(Guid.NewGuid(), book, new(2026, 10, 1), "合成复核人", "合成一分钱等权尾差", CostWorksheetService.PolicyVersion,
            [new("S", "尾差阶段", AllocationBasis.OutputQuantity, AllocationBasis.OutputQuantity, .01m, 0,
                [new("A", "甲", 1, 0, 0, 0), new("B", "乙", 1, 0, 0, 0), new("C", "丙", 1, 0, 0, 0)], [])]));
        Click(page, "计算 / 复算");
        var result = page.Editor.Result!; var labor = result.Stages.Single().AllocationDetails.Where(d => d.CostElement == "人工").ToArray();
        // Use actual output identity and exact cents rather than reimplementing the allocator.
        Check(result.FinishedCost == .01m && result.Stages.Single().Objects.Single(o => o.CostObject == "A").AllocatedLabor == .01m &&
            result.Stages.Single().Objects.Where(o => o.CostObject != "A").All(o => o.AllocatedLabor == 0), "equal-weight one-cent remainder goes to A; total conserved");
        Check(page.Editor.AllocationRows.Any(r => r.Detail.RemainderAdjustment == .01m), "one-cent remainder visible in audit rows");
        Tab(page, "5 分配审核明细"); await Settle(); await Capture(window, "costing-remainder.png");
        Tab(page, "1 阶段及费用池"); await Settle(); Edit(stages, stages.Items[0], 4, ""); Click(page, "计算 / 复算");
        Check(window.IsVisible && page.Editor.Result is null && !page.Editor.CanExport && page.Editor.VoucherRows.Count == 0 && !string.IsNullOrWhiteSpace(page.Editor.Status), "invalid numeric input stays in window with error and no stale calculation/suggestions");
        await Capture(window, "costing-invalid.png");
        Edit(stages, stages.Items[0], 4, "0.01"); Click(page, "计算 / 复算");
        Tab(page, "4 计算明细"); await Settle();
        var calculations = Visuals<DataGrid>(page).Single(g => AutomationProperties.GetAutomationId(g) == "CalculationRows");
        RightAligned(calculations, 11); await Capture(window, "costing-calculation.png");
    }
}
