using System.Globalization;
using System.Text.Json;
using Caiwu.Payroll;
using Caiwu.Payroll.Tests;

if (args.Length != 3 || args[0] is not ("create" or "read") || !Guid.TryParse(args[2], out var bookId))
    throw new ArgumentException("Use create|read <NEW synthetic.payroll.sqlite> <synthetic-book-id>.");
var path = args[1];
if (args[0] == "create")
{
    var service = new PayrollService(SqlitePayrollStore.CreateNew(path, bookId, "合成跨进程重开", SyntheticFixture.Month));
    SyntheticFixture.Populate(service);
    service.Calculate(SyntheticFixture.Month);
    service.CreateVoucherPlan(SyntheticFixture.Month, SyntheticFixture.Request(), SyntheticFixture.Accounts);
    Console.WriteLine(JsonSerializer.Serialize(new { phase = "created", bookId, revision = service.Revision,
        originalLedger = false, syntheticOnly = true }));
}
else
{
    var service = new PayrollService(SqlitePayrollStore.Open(path, bookId));
    var table = service.GetWageTable(SyntheticFixture.Month);
    var snapshot = service.Snapshot;
    if (!table.IsCalculated || table.Totals["g_l05"] != 3350.25m || table.Totals["g_l80"] != 6700.50m
        || snapshot.VoucherPlans.Count != 1 || snapshot.VoucherPlans[0].Status != "planned"
        || snapshot.Periods[0].Rows[0].Employee.Attributes["g_f2"] != "保留尾空格  ")
        throw new InvalidOperationException("Cross-process persisted state did not match synthetic expected values.");
    Console.WriteLine(JsonSerializer.Serialize(new { phase = "reopened", bookId, revision = service.Revision,
        netWages = table.Totals["g_l05"].ToString(CultureInfo.InvariantCulture), plans = snapshot.VoucherPlans.Count,
        originalLedger = false, syntheticOnly = true }));
}
