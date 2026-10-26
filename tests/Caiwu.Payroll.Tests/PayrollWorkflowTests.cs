using System.Security.Cryptography;
using Caiwu.Payroll;
using Microsoft.Data.Sqlite;

namespace Caiwu.Payroll.Tests;

public sealed class PayrollWorkflowTests
{
    [Fact]
    public void ReopensEntireWorkflowIncluding80thColumnMetadataAndPlans()
    {
        using var fixture = new SyntheticFixture();
        var service = fixture.Service;
        Assert.Equal(["g_l03", "g_l05", "g_l80"], FormulaEngine.GetCalculationOrder(service.Snapshot.Columns, service.Snapshot.Formulas));
        var table = service.Calculate(SyntheticFixture.Month);
        Assert.True(table.IsCalculated);
        Assert.Equal(3500.30m, table.Totals["g_l03"]);
        Assert.Equal(3350.25m, table.Totals["g_l05"]);
        Assert.Equal(6700.50m, table.Totals["g_l80"]);
        var payment = service.CreateVoucherPlan(SyntheticFixture.Month, SyntheticFixture.Request(), SyntheticFixture.Accounts);
        var allocation = service.CreateVoucherPlan(SyntheticFixture.Month,
            SyntheticFixture.Request(PayrollVoucherKind.Distribution, 2), SyntheticFixture.Accounts);
        Assert.Equal(3500.30m, payment.Lines.Sum(l => l.Debit));
        Assert.Equal(3500.30m, payment.Lines.Sum(l => l.Credit));
        Assert.Contains(allocation.Lines, l => l.AccountCode == "6401" && l.DepartmentCode == "02" && l.EmployeeCode == "000002" && l.Debit == 2200);
        var reopened = fixture.Reopen();
        Assert.True(reopened.GetWageTable(SyntheticFixture.Month).IsCalculated);
        Assert.Equal(6700.50m, reopened.GetWageTable(SyntheticFixture.Month).Totals["g_l80"]);
        Assert.Equal(2, reopened.Snapshot.VoucherPlans.Count);
        Assert.Equal(payment.SourceKey, reopened.Snapshot.VoucherPlans[0].SourceKey);
        Assert.All(reopened.Snapshot.VoucherPlans, p => Assert.Equal("planned", p.Status));
        var employee = reopened.Snapshot.Periods[0].Rows[0].Employee;
        Assert.Null(employee.Attributes["g_j8"]);
        Assert.Equal("保留尾空格  ", employee.Attributes["g_f2"]);
        Assert.Equal("原样保留", employee.OriginalFields["variant_extra"]);
        Assert.Null(reopened.Snapshot.Columns.Single(c => c.FieldName == "g_l80").OriginalFields["f_gzt_set"]);
    }

    [Fact]
    public void ExactRepeatedPlanIsIdempotentButChangedDuplicateIsRejected()
    {
        using var f = new SyntheticFixture();
        f.Service.Calculate(SyntheticFixture.Month);
        var first = f.Service.CreateVoucherPlan(SyntheticFixture.Month, SyntheticFixture.Request(), SyntheticFixture.Accounts);
        var revision = f.Service.Revision;
        var again = f.Service.CreateVoucherPlan(SyntheticFixture.Month, SyntheticFixture.Request(), SyntheticFixture.Accounts);
        Assert.Equal(first.Id, again.Id);
        Assert.Equal(revision, f.Service.Revision);
        Assert.Throws<PayrollValidationException>(() => f.Service.CreateVoucherPlan(SyntheticFixture.Month,
            SyntheticFixture.Request() with { Summary = "变更" }, SyntheticFixture.Accounts));
        Assert.Single(f.Reopen().Snapshot.VoucherPlans);
    }

    [Fact]
    public void InputChangesInvalidateResultsAndPreventStaleVoucherPlans()
    {
        using var f = new SyntheticFixture();
        f.Service.Calculate(SyntheticFixture.Month);
        f.Service.SetUniformValue(SyntheticFixture.Month, "g_l01", 3000, "01");
        Assert.False(f.Service.GetWageTable(SyntheticFixture.Month).IsCalculated);
        Assert.Empty(f.Service.Snapshot.Periods[0].Rows[0].Results);
        Assert.Throws<PayrollValidationException>(() => f.Service.CreateVoucherPlan(SyntheticFixture.Month,
            SyntheticFixture.Request(), SyntheticFixture.Accounts));
        var table = f.Service.Calculate(SyntheticFixture.Month);
        Assert.Equal(3050.15m, PayrollService.Value(table.Rows[0], "g_l05"));
        Assert.Equal(2100m, PayrollService.Value(table.Rows[1], "g_l05"));
    }

    [Fact]
    public void FormulaChangesInvalidateCalculatedPeriodAndCycleDoesNotSave()
    {
        using var f = new SyntheticFixture();
        f.Service.Calculate(SyntheticFixture.Month);
        var formulas = f.Service.Snapshot.Formulas;
        formulas[2].Expression = "g_l80 + 1";
        var revision = f.Service.Revision;
        Assert.Throws<PayrollValidationException>(() => f.Service.SaveFormulas(formulas));
        Assert.Equal(revision, f.Reopen().Revision);
        Assert.True(f.Service.GetWageTable(SyntheticFixture.Month).IsCalculated);
        formulas[2].Expression = "g_l01 * 2";
        f.Service.SaveFormulas(formulas);
        Assert.False(f.Service.GetWageTable(SyntheticFixture.Month).IsCalculated);
    }

    [Fact]
    public void LaterEmployeeFailureRollsBackAllCalculatedRows()
    {
        using var f = new SyntheticFixture();
        var formulas = f.Service.Snapshot.Formulas;
        formulas[2].Expression = "100 / (g_l01 - 2000)";
        f.Service.SaveFormulas(formulas);
        var revision = f.Service.Revision;
        var error = Assert.Throws<PayrollValidationException>(() => f.Service.Calculate(SyntheticFixture.Month));
        Assert.Contains("000002", error.Message);
        var reopened = f.Reopen();
        Assert.Equal(revision, reopened.Revision);
        Assert.All(reopened.Snapshot.Periods[0].Rows, r => Assert.Empty(r.Results));
    }

    [Fact]
    public void NullIsPreservedAndExplicitCoalesceOrLazyIfControlsIt()
    {
        using var f = new SyntheticFixture();
        f.Service.SetInputs(SyntheticFixture.Month, "000001", new Dictionary<string, decimal?> { ["g_l02"] = null });
        var table = f.Service.Calculate(SyntheticFixture.Month);
        Assert.Null(table.Rows[0].Inputs["g_l02"]);
        Assert.Equal(1200.10m, PayrollService.Value(table.Rows[0], "g_l03"));
        var formulas = f.Service.Snapshot.Formulas;
        formulas[2].Expression = "IF(g_l01 > 0, ROUND(g_l01 / 3,2), 1/0)";
        f.Service.SaveFormulas(formulas);
        Assert.Equal(400.03m, PayrollService.Value(f.Service.Calculate(SyntheticFixture.Month).Rows[0], "g_l03"));
        formulas[2].Expression = "g_l01 + g_l02";
        f.Service.SaveFormulas(formulas);
        Assert.Null(PayrollService.Value(f.Service.Calculate(SyntheticFixture.Month).Rows[0], "g_l03"));
        Assert.Throws<PayrollValidationException>(() => f.Service.CreateVoucherPlan(SyntheticFixture.Month,
            SyntheticFixture.Request(), SyntheticFixture.Accounts));
    }

    [Fact]
    public void FalseConditionClearsPreviousResult()
    {
        using var f = new SyntheticFixture();
        var formulas = f.Service.Snapshot.Formulas;
        formulas[0].Condition = "g_l01 > 1500 AND g_l04 >= 0";
        f.Service.SaveFormulas(formulas);
        var table = f.Service.Calculate(SyntheticFixture.Month);
        Assert.Null(PayrollService.Value(table.Rows[0], "g_l80"));
        Assert.Equal(4200m, PayrollService.Value(table.Rows[1], "g_l80"));
    }

    [Fact]
    public void AtomicGridSaveRejectsMissingEmployeeWithoutPartialWrite()
    {
        using var f = new SyntheticFixture();
        var revision = f.Service.Revision;
        Assert.Throws<PayrollValidationException>(() => f.Service.SaveInputs(SyntheticFixture.Month, new Dictionary<string, Dictionary<string, decimal?>>()
        {
            ["000001"] = new() { ["g_l01"] = 9 }, ["missing"] = new() { ["g_l01"] = 8 }
        }));
        Assert.Equal(revision, f.Reopen().Revision);
        Assert.Equal(1200.10m, f.Reopen().Snapshot.Periods[0].Rows[0].Inputs["g_l01"]);
    }

    [Fact]
    public void ConcurrentSessionsCannotOverwriteAndSnapshotIsDetached()
    {
        using var f = new SyntheticFixture();
        var other = f.Reopen();
        f.Service.SetUniformValue(SyntheticFixture.Month, "g_l02", 123);
        Assert.Throws<PayrollConflictException>(() => other.SetUniformValue(SyntheticFixture.Month, "g_l02", 456));
        var snapshot = f.Service.Snapshot;
        snapshot.Employees[0].Name = "外部篡改";
        Assert.Equal("合成人员甲", f.Service.Snapshot.Employees[0].Name);
        other.Refresh();
        other.SetUniformValue(SyntheticFixture.Month, "g_l02", 789);
        Assert.All(f.Reopen().Snapshot.Periods[0].Rows, r => Assert.Equal(789m, r.Inputs["g_l02"]));
    }

    [Fact]
    public void ReferencedDepartmentAndEmployeesCannotBeDeleted()
    {
        using var f = new SyntheticFixture();
        Assert.Throws<PayrollValidationException>(() => f.Service.SaveDepartments([f.Service.Snapshot.Departments[0]]));
        Assert.Throws<PayrollValidationException>(() => f.Service.SaveEmployees([f.Service.Snapshot.Employees[0]]));
        var people = f.Service.Snapshot.Employees;
        people[0].IsActive = false;
        people[1].DepartmentCode = "unknown";
        Assert.Throws<PayrollValidationException>(() => f.Service.SaveEmployees(people));
        people[1].DepartmentCode = "02";
        f.Service.SaveEmployees(people);
        f.Service.OpenPeriod(new(2026, 11, 1), SyntheticFixture.Month);
        var row = Assert.Single(f.Reopen().Snapshot.Periods[1].Rows);
        Assert.Equal("000002", row.Employee.Code);
        Assert.Equal(2000m, row.Inputs["g_l01"]);
        Assert.Null(row.Inputs["g_l04"]);
    }

    [Fact]
    public void HistoricalPersonnelSnapshotSurvivesMasterEdits()
    {
        using var f = new SyntheticFixture();
        var people = f.Service.Snapshot.Employees;
        people[0].Name = "合成新姓名"; people[0].DepartmentCode = "02";
        f.Service.SaveEmployees(people);
        f.Service.OpenPeriod(new(2026, 11, 1), SyntheticFixture.Month);
        var periods = f.Reopen().Snapshot.Periods;
        Assert.Equal("合成人员甲", periods[0].Rows[0].Employee.Name);
        Assert.Equal("01", periods[0].Rows[0].Employee.DepartmentCode);
        Assert.Equal("合成新姓名", periods[1].Rows[0].Employee.Name);
        Assert.Equal("02", periods[1].Rows[0].Employee.DepartmentCode);
    }

    [Fact]
    public void ExplicitSyntheticTaxParametersPersistAndExpiredOrMissingProfileFails()
    {
        using var f = new SyntheticFixture();
        var formulas = f.Service.Snapshot.Formulas;
        formulas[0].IsTaxFormula = true; formulas[0].Expression = "g_l03";
        f.Service.SaveFormulas(formulas);
        Assert.Throws<PayrollValidationException>(() => f.Service.Calculate(SyntheticFixture.Month));
        var profile = new PayrollTaxProfile
        {
            Name = "合成测试税表，非法律税表", SourceTitle = "本仓库 SyntheticFixture，非税务政策",
            SourceUri = "https://example.invalid/synthetic-payroll-tax", SourceLocator = "PayrollWorkflowTests explicit synthetic fixture",
            EffectiveFrom = new(2026, 1, 1), EffectiveTo = new(2026, 12, 31), Allowance = 1000,
            Bands = [new() { UpperLimit = 500, Rate = .1m }, new() { Rate = .2m }]
        };
        f.Service.SaveTaxProfile(profile);
        Assert.Equal(30.03m, PayrollService.Value(f.Service.Calculate(SyntheticFixture.Month).Rows[0], "g_l80"));
        Assert.Equal(190m, PayrollService.Value(f.Reopen().GetWageTable(SyntheticFixture.Month).Rows[1], "g_l80"));
        profile.EffectiveTo = new(2026, 9, 30);
        f.Service.SaveTaxProfile(profile);
        Assert.Throws<PayrollValidationException>(() => f.Service.Calculate(SyntheticFixture.Month));
        profile.SourceTitle = "";
        Assert.Throws<PayrollValidationException>(() => f.Service.SaveTaxProfile(profile));
    }

    [Theory]
    [InlineData("2211", false, true, null)]
    [InlineData("2211", true, false, null)]
    [InlineData("2211", true, true, "项目")]
    public void InvalidAccountCannotProducePlan(string code, bool enabled, bool leaf, string? unsupported)
    {
        using var f = new SyntheticFixture();
        f.Service.Calculate(SyntheticFixture.Month);
        var accounts = SyntheticFixture.Accounts.Select(a => a.Code == code
            ? a with { Enabled = enabled, IsLeaf = leaf, UnsupportedAuxiliaryDimensions = unsupported } : a).ToArray();
        Assert.Throws<PayrollValidationException>(() => f.Service.CreateVoucherPlan(SyntheticFixture.Month, SyntheticFixture.Request(), accounts));
        Assert.Empty(f.Reopen().Snapshot.VoucherPlans);
    }

    [Fact]
    public void UnbalancedPlanAndComputedFieldInputAreRejected()
    {
        using var f = new SyntheticFixture();
        Assert.Throws<PayrollValidationException>(() => f.Service.SetInputs(SyntheticFixture.Month, "000001",
            new Dictionary<string, decimal?> { ["g_l03"] = 1 }));
        var settings = f.Service.Snapshot.VoucherSettings!;
        settings.Credits.RemoveAt(1);
        f.Service.SaveVoucherSettings(settings);
        f.Service.Calculate(SyntheticFixture.Month);
        Assert.Throws<PayrollValidationException>(() => f.Service.CreateVoucherPlan(SyntheticFixture.Month,
            SyntheticFixture.Request(), SyntheticFixture.Accounts));
        Assert.Empty(f.Reopen().Snapshot.VoucherPlans);
    }

    [Fact]
    public void WrongBookAndUnknownDatabaseAreReadOnlyRejectedAndCreateNeverOverwrites()
    {
        using var f = new SyntheticFixture();
        var bytes = File.ReadAllBytes(f.FilePath);
        Assert.Throws<PayrollValidationException>(() => SqlitePayrollStore.Open(f.FilePath, Guid.NewGuid()));
        Assert.Throws<IOException>(() => SqlitePayrollStore.CreateNew(f.FilePath, Guid.NewGuid(), "其他", SyntheticFixture.Month));
        Assert.Equal(SHA256.HashData(bytes), SHA256.HashData(File.ReadAllBytes(f.FilePath)));
        var unknown = Path.Combine(f.DirectoryPath, "unknown.payroll.sqlite");
        using (var connection = new SqliteConnection($"Data Source={unknown};Pooling=False"))
        { connection.Open(); using var command = connection.CreateCommand(); command.CommandText = "CREATE TABLE original(value TEXT)"; command.ExecuteNonQuery(); }
        var before = SHA256.HashData(File.ReadAllBytes(unknown));
        Assert.Throws<PayrollValidationException>(() => SqlitePayrollStore.Open(unknown, f.BookId));
        Assert.Equal(before, SHA256.HashData(File.ReadAllBytes(unknown)));
        Assert.Throws<PayrollValidationException>(() => SqlitePayrollStore.Open(Path.Combine(f.DirectoryPath, "original.db"), f.BookId));
        Assert.False(File.Exists(Path.Combine(f.DirectoryPath, "original.db")));
    }
}
