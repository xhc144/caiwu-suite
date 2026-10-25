using Caiwu.Contracts;
using Caiwu.Reporting;

namespace Caiwu.Desktop.Presentation;

/// <summary>Build each export from current data, and reject a concurrent change during querying.</summary>
public static class ReportingQueries
{
    public static ReportDocument Build(ILedgerService service, ReportKind kind, string? account,
        DateOnly from, DateOnly to, string search = "", VoucherStatus? status = null)
    {
        var before = service.GetSnapshot();
        var metadata = new ReportMetadata(before.Book, from, to, DateTimeOffset.Now);
        var report = kind switch
        {
            ReportKind.TrialBalance => ReportBuilder.TrialBalance(metadata, service.GetTrialBalance(from, to), before.Accounts),
            ReportKind.Ledger => ReportBuilder.Ledger(metadata,
                account ?? throw new LedgerValidationException("请选择明细账科目。"), service.GetLedger(account, from, to), before.Accounts),
            ReportKind.VoucherList => ReportBuilder.VoucherList(metadata,
                before.Vouchers.Where(v => Matches(v, search.Trim())), before.Accounts, status),
            _ => throw new LedgerValidationException("不支持该账簿类型。")
        };
        var after = service.GetSnapshot();
        if (after.Book.Id != before.Book.Id || after.Revision != before.Revision)
            throw new StoreConcurrencyException("报表生成期间账套发生变化，请重新查询后导出。");
        return report;
    }

    public static bool Matches(Voucher voucher, string search) => search.Length == 0 ||
        voucher.Lines.Any(line => line.Summary.Contains(search, StringComparison.OrdinalIgnoreCase)) ||
        $"{voucher.Kind}-{voucher.Number:0000}".Contains(search, StringComparison.OrdinalIgnoreCase) ||
        voucher.PreparedBy.Contains(search, StringComparison.OrdinalIgnoreCase);
}
