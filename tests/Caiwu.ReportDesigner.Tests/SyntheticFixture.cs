using Caiwu.Contracts;
using Caiwu.Reporting;
using Caiwu.ReportDesigner;

namespace Caiwu.ReportDesigner.Tests;

public static class SyntheticFixture
{
    public static ReportInputSnapshot Input(int copies = 1)
    {
        var metadata = new ReportMetadata(new BookInfo(Guid.Parse("10000000-0000-0000-0000-000000000001"),
            "合成账套 <script> =1+1", AccountingRegime.Enterprise, "synthetic-v1", 2026, 1, 0,
            DateTimeOffset.Parse("2026-01-01T00:00:00Z")), new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 31),
            DateTimeOffset.Parse("2026-10-25T10:00:00Z"), [new ReportSource("合成资料", "https://example.invalid/a?q=%22")]);
        var balances = Enumerable.Range(0, copies).SelectMany(i => new[] {
            new TrialBalanceRow($"{i}0", "父科目", false, 0, 0, 130.3m, 30.1m, 100.2m, 0),
            new TrialBalanceRow($"{i}1", "甲组", true, 0, 0, 100.1m, 10.0m, 90.1m, 0),
            new TrialBalanceRow($"{i}2", "乙组", true, 0, 0, 30.2m, 20.1m, 10.1m, 0)
        });
        return new(ReportBuilder.TrialBalance(metadata, balances), 42, ["合成演示；当前输入不含附注与法定映射。"]);
    }
    public static ReportTemplate Template() => new() {
        Title = "合成自定义报表", Header = "十月试算演示", SourceKind = ReportKind.TrialBalance,
        Columns = [
            new("name", "名称", "[accountName]", 150),
            new("net", "净额", "[periodDebit]-[periodCredit]", 120, NumberFormat.F2, Total: true),
            new("third", "净额三分之一", "ROUND([net]/3,2)", 130, NumberFormat.F4, Total: true)
        ]
    };
}
