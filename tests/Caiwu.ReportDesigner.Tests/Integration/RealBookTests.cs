using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Persistence.Sqlite;
using Caiwu.Reporting;

namespace Caiwu.ReportDesigner.Integration.Tests;

public sealed class RealBookTests
{
    [Fact]
    public void RealPostedReopenedSnapshotDesignLoopDoesNotMutateBook()
    {
        var directory = Path.Combine(Path.GetTempPath(), "caiwu-design-integration-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(directory);
        try {
            var bookPath = Path.Combine(directory, "synthetic.caiwu");
            var definition = TemplateCatalog.Get(AccountingRegime.Enterprise);
            var book = new BookInfo(Guid.NewGuid(), "纯合成设计器集成账套", definition.Regime, definition.Version, 2026, 1, 0, DateTimeOffset.Parse("2026-01-01T00:00:00Z"));
            using (var store = SqliteLedgerStore.Create(bookPath, book, definition.Accounts)) {
                var service = new LedgerService(store); var snapshot = service.GetSnapshot();
                service.SetOpeningBalances([new("1002", 100000, 0), new("4001", 0, 100000)], "制单员", new(snapshot.Book.Id, snapshot.Revision));
                void Post(decimal amount, string debit, string credit, string summary) {
                    var before = service.GetSnapshot();
                    var voucher = service.SaveDraft(new(null, new DateOnly(2026, 1, 15), "记", null, 0,
                        [new(debit, summary, amount, 0), new(credit, summary, 0, amount)], before.Revision, before.Book.Id), "制单员");
                    var review = service.GetSnapshot(); service.Review(voucher.Id, "独立审核员", new(review.Book.Id, review.Revision));
                    var post = service.GetSnapshot(); service.Post(voucher.Id, "记账员", new(post.Book.Id, post.Revision));
                }
                Post(10000, "1403", "1002", "材料采购"); Post(1200, "6602", "1002", "费用"); Post(20000, "1002", "6001", "收入");
            }
            using (var store = SqliteLedgerStore.Open(bookPath)) {
                var service = new LedgerService(store); var captured = service.GetSnapshot();
                var before = JsonSerializer.Serialize(captured);
                var from = new DateOnly(2026, 1, 1); var to = new DateOnly(2026, 1, 31);
                var metadata = new ReportMetadata(captured.Book, from, to, DateTimeOffset.Parse("2026-02-01T00:00:00Z"));
                var source = ReportBuilder.TrialBalance(metadata, service.GetTrialBalance(from, to), captured.Accounts);
                Assert.Equal(new decimal?[] { 100000, 100000, 31200, 31200, 120000, 120000 }, source.Total.Cells.Skip(4).Select(c => c.Amount));
                var input = new ReportInputSnapshot(source, captured.Revision, ["演示科目非完整企业科目；无财报映射。"]);
                var template = new ReportTemplate { SourceKind = ReportKind.TrialBalance, Title = "独立账簿设计样例", Columns = [
                    new("accountCode", "编码", "[accountCode]", 90), new("accountName", "名称", "[accountName]", 140),
                    new("net", "期末借正贷负", "[closingDebit]-[closingCredit]", 180, NumberFormat.F2, Total: true)
                ] };
                var first = ReportDesignerEngine.Preview(input, template);
                Assert.Equal(108800m, first.Rows.Single(r => r.Cells[0].Text == "1002").Cells[2].Number);
                Assert.Equal(0m, first.Rows[^1].Cells[2].Number); //120000 debit -120000 credit.
                var changed = template with { Columns = [template.Columns[1], template.Columns[0], template.Columns[2] with { Expression = "ROUND(([closingDebit]-[closingCredit])/1000,4)", Title = "千元净额", Width = 220 }] };
                var preview = ReportDesignerEngine.Preview(input, changed);
                Assert.Equal(108.8m, preview.Rows.Single(r => r.Cells[1].Text == "1002").Cells[2].Number);
                var file = Path.Combine(directory, "design.json"); TemplateStore.Save(file, changed);
                var loaded = TemplateStore.Load(file); var roundtrip = ReportDesignerEngine.Preview(input, loaded.Template);
                ReportDesignerExport.ExportNewFile(roundtrip, Path.Combine(directory, "synthetic.html"), true);
                ReportDesignerExport.ExportNewFile(roundtrip, Path.Combine(directory, "synthetic.csv"), false);
                Assert.Contains("108.80", File.ReadAllText(Path.Combine(directory, "synthetic.html")));
                Assert.Contains(input.Fingerprint, File.ReadAllText(Path.Combine(directory, "synthetic.csv")));
                Assert.Equal(before, JsonSerializer.Serialize(service.GetSnapshot())); //Accounts, vouchers, audit, revision untouched.
            }
        } finally { Directory.Delete(directory, recursive: true); }
    }
}
