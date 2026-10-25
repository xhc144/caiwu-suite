using Caiwu.Contracts;

namespace Caiwu.VoucherTools.Wpf.Tests;

internal static class SyntheticData
{
    internal static LedgerSnapshot Snapshot() => new(12,
        new(Guid.NewGuid(), "合成复制测试账套", AccountingRegime.Enterprise, "synthetic-only", 2026, 1, 0,
            new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero)),
        [new("1002", "合成银行", null, BalanceDirection.Debit, true, 0, 0),
         new("1403", "合成材料", null, BalanceDirection.Debit, true, 0, 0)],
        [new(Guid.NewGuid(), new(2026, 1, 5), "记", 7, 3, "原制单员", "原审核员", VoucherStatus.Posted,
            [new("1403", "合成重复行", 0.1000m, 0), new("1403", "合成重复行", 0.1000m, 0), new("1002", "合成贷方", 0, 0.2000m)])], []);
}
