using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Persistence.Sqlite;
using Caiwu.Desktop.Presentation;
using Caiwu.Desktop.Verification;
using Caiwu.Reporting;

var backend = new DesktopBackend(SqliteLedgerStore.Open, SqliteLedgerStore.Create,
    SqliteLedgerStore.RestoreBackup, store => new LedgerService(store), TemplateCatalog.All);
var folder = Path.Combine(Path.GetTempPath(), "caiwu-integration-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(folder);
var passed = 0;
void Check(bool condition, string name)
{ if (!condition) throw new InvalidOperationException(name); passed++; Console.WriteLine("PASS " + name); }
try
{
    var path = Path.Combine(folder, "sample.caiwu"); SampleLedger.Create(backend, path);
    using (var session = new LedgerSession(backend))
    {
        session.Open(path);
        Check(session.Snapshot!.Vouchers.Count == 3 && session.Snapshot.Vouchers.All(v => v.Status == VoucherStatus.Posted), "真实SQLite保存并重开三张已记账凭证");
        var rows = session.Service!.GetTrialBalance(new(2026, 10, 1), new(2026, 10, 31));
        Check(rows.Single(r => r.AccountCode == "1002").ClosingDebit == 108800m, "银行期末108800");
        Check(rows.Where(r => r.IsLeaf).Sum(r => r.PeriodDebit) == 31200m && rows.Where(r => r.IsLeaf).Sum(r => r.PeriodCredit) == 31200m, "本期借贷各31200");
        Check(rows.Where(r => r.IsLeaf).Sum(r => r.ClosingDebit) == 120000m && rows.Where(r => r.IsLeaf).Sum(r => r.ClosingCredit) == 120000m, "期末借贷各120000");
        var ledger = session.Service.GetLedger("1002", new(2026, 10, 1), new(2026, 10, 31));
        Check(ledger.Count == 4 && ledger[^1].RunningBalance == 108800m && ledger.Skip(1).All(l => l.VoucherId is not null), "银行明细含期初与三条可追溯发生额");
        var posted = session.Snapshot.Vouchers[0]; var rejected = false;
        try { session.Service.DeleteDraft(posted.Id, "管理员"); } catch (LedgerValidationException) { rejected = true; }
        Check(rejected, "真实存储下拒绝删除已记账凭证");
        var backup = Path.Combine(folder, "sample.caiwubak"); session.BackupTo(backup);
        var restored = Path.Combine(folder, "restored.caiwu"); session.RestoreTo(backup, restored);
        using var copy = SqliteLedgerStore.Open(restored);
        Check(copy.Read().Vouchers.Count == 3 && copy.Read().Revision == session.Snapshot.Revision, "备份恢复副本保留凭证与revision");
        session.Service.CloseMonth(10, "结账员"); session.Refresh();
        Check(session.Snapshot!.Book.ClosedThroughMonth == 10, "真实存储下月结期间锁已持久化");
        using var immutableBackup = SqliteLedgerStore.Open(restored);
        Check(immutableBackup.Read().Book.ClosedThroughMonth == 9, "后续源账变化不影响恢复副本");
        var trialReport = ReportingQueries.Build(session.Service, ReportKind.TrialBalance, null, new(2026, 10, 1), new(2026, 10, 31));
        Check(trialReport.Metadata.Book.Id == session.Snapshot.Book.Id && trialReport.Rows.Count == rows.Count,
            "Desktop报表适配器用真实账套和查询结果生成元数据");
        var emptyReport = ReportingQueries.Build(session.Service, ReportKind.VoucherList, null, new(2026, 10, 1), new(2026, 10, 31), status: VoucherStatus.Draft);
        Check(emptyReport.Rows.Count == 0, "当前状态筛选导出不混入已记账凭证");
        var latest = session.Service.GetSnapshot();
        var secondSummary = latest.Vouchers.First().Lines.Last().Summary;
        var filtered = ReportingQueries.Build(session.Service, ReportKind.VoucherList, null, new(2026, 10, 1), new(2026, 10, 31), secondSummary, VoucherStatus.Posted);
        Check(filtered.Rows.Count > 0 && filtered.Rows.All(r => r.VoucherId is { } id && latest.Vouchers.Single(v => v.Id == id).Lines.Any(l => l.Summary.Contains(secondSummary))),
            "凭证导出搜索覆盖全部分录而不是首行摘要");
    }
    Console.WriteLine($"Real SQLite/Core/session integration checks passed: {passed}");
}
finally { Directory.Delete(folder, true); }
