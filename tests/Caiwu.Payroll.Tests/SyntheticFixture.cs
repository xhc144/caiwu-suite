using Caiwu.Payroll;

namespace Caiwu.Payroll.Tests;

// All people, departments, accounts, rates and values in this fixture are synthetic.
public sealed class SyntheticFixture : IDisposable
{
    public static readonly DateOnly Month = new(2026, 10, 1);
    public static readonly PayrollAccount[] Accounts = [new("2211", RequiresDepartment: true, RequiresEmployee: true),
        new("1002"), new("2241"), new("6602"), new("6401")];
    public string DirectoryPath { get; } = Path.Combine(Path.GetTempPath(), "caiwu-payroll-tests-" + Guid.NewGuid());
    public string FilePath => Path.Combine(DirectoryPath, "synthetic.payroll.sqlite");
    public Guid BookId { get; } = Guid.NewGuid();
    public PayrollService Service { get; }
    public SyntheticFixture()
    {
        Directory.CreateDirectory(DirectoryPath);
        Service = new(SqlitePayrollStore.CreateNew(FilePath, BookId, "合成工资账套", Month));
        Populate(Service);
    }
    public static void Populate(PayrollService service)
    {
        service.SaveDepartments([new() { Code = "01", Name = "合成管理部" }, new() { Code = "02", Name = "合成生产部" }]);
        service.SaveEmployees([
            new() { Code = "000001", Name = "合成人员甲", DepartmentCode = "01", Attributes = new()
                { ["g_j4"] = "6602", ["g_j8"] = null, ["g_f2"] = "保留尾空格  " },
                OriginalFields = new() { ["variant_extra"] = "原样保留", ["nullable"] = null } },
            new() { Code = "000002", Name = "合成人员乙", DepartmentCode = "02", Attributes = new() { ["g_j4"] = "6401" } }
        ]);
        var columns = service.Snapshot.Columns;
        foreach (var (field, caption) in new[] { ("g_j4", "分配科目"), ("g_l01", "基本工资"), ("g_l02", "补贴"),
            ("g_l03", "应付工资"), ("g_l04", "其他扣款"), ("g_l05", "实发工资"), ("g_l80", "末栏测试") })
        {
            var column = columns.Single(c => c.FieldName == field);
            column.Enabled = true; column.Caption = caption;
            column.CarryForward = field is "g_l01" or "g_l02";
        }
        columns.Single(c => c.FieldName == "g_l80").OriginalFields = new()
            { ["f_style"] = "unknown-original-code", ["f_gzt_set"] = null };
        service.SaveColumns(columns);
        service.SaveFormulas([
            new() { Order = 1, Name = "末栏", TargetField = "g_l80", Expression = "g_l05 * 2" },
            new() { Order = 2, Name = "实发", TargetField = "g_l05", Expression = "g_l03 - g_l04" },
            new() { Order = 3, Name = "应付", TargetField = "g_l03", Expression = "g_l01 + COALESCE(g_l02,0)" }
        ]);
        service.OpenPeriod(Month);
        service.SaveInputs(Month, new Dictionary<string, Dictionary<string, decimal?>>()
        {
            ["000001"] = new() { ["g_l01"] = 1200.10m, ["g_l02"] = 100.20m, ["g_l04"] = 50.05m },
            ["000002"] = new() { ["g_l01"] = 2000m, ["g_l02"] = 200m, ["g_l04"] = 100m }
        });
        service.SaveVoucherSettings(new()
        {
            PayableAccount = "2211", PayableField = "g_l03", DistributionAccountField = "g_j4",
            Credits = [new() { FieldName = "g_l05", AccountCode = "1002" }, new() { FieldName = "g_l04", AccountCode = "2241" }]
        });
    }
    public PayrollService Reopen() => new(SqlitePayrollStore.Open(FilePath, BookId));
    public static PayrollVoucherRequest Request(PayrollVoucherKind kind = PayrollVoucherKind.Payment, int number = 1)
        => new(kind, new(2026, 10, 31), "记", number, "合成十月工资");
    public void Dispose() => Directory.Delete(DirectoryPath, true);
}
