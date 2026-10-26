using Caiwu.Payroll;
using System.Globalization;

namespace Caiwu.Payroll.Tests;

public sealed class AdditionalBehaviorTests
{
    [Fact]
    public void BusinessSourceKeyUsesGregorianInvariantMonthAcrossLocales()
    {
        using var f = new SyntheticFixture(); f.Service.Calculate(SyntheticFixture.Month);
        var before = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("th-TH");
            var plan = f.Service.CreateVoucherPlan(SyntheticFixture.Month, SyntheticFixture.Request(), SyntheticFixture.Accounts);
            Assert.Equal($"payroll:{f.BookId:D}:2026-10:Payment", plan.SourceKey);
        }
        finally { CultureInfo.CurrentCulture = before; }
    }
    [Fact]
    public void AddEmployeeInCurrentMonthIsOneCommitWithInitialValuesAndDuplicateRollback()
    {
        using var f = new SyntheticFixture(); var revision = f.Service.Revision;
        f.Service.AddEmployee(new() { Code = "000003", Name = "合成人员丙", DepartmentCode = "01",
            Attributes = new() { ["g_j4"] = "6602" } }, SyntheticFixture.Month,
            new Dictionary<string, decimal?> { ["g_l01"] = 777.123456789m, ["g_l02"] = null, ["g_l04"] = 0 });
        Assert.Equal(revision + 1, f.Service.Revision);
        var saved = f.Reopen().Snapshot;
        Assert.Equal(3, saved.Employees.Count); Assert.Equal(3, saved.Periods[0].Rows.Count);
        Assert.Equal(777.123456789m, saved.Periods[0].Rows[2].Inputs["g_l01"]);
        Assert.Null(saved.Periods[0].Rows[2].Inputs["g_l02"]);
        Assert.Throws<PayrollValidationException>(() => f.Service.AddEmployee(new() { Code = "000003", Name = "重复", DepartmentCode = "01" }, SyntheticFixture.Month));
        Assert.Equal(revision + 1, f.Reopen().Revision);
    }

    [Fact]
    public void ExistingCalculatedFieldCannotChangeTypeAndPrintSettingsRoundTrip()
    {
        using var f = new SyntheticFixture(); f.Service.Calculate(SyntheticFixture.Month);
        f.Service.SaveFormulas([]);
        var columns = f.Service.Snapshot.Columns; var last = columns.Single(c => c.FieldName == "g_l80");
        last.Kind = PayrollValueKind.Text;
        Assert.Throws<PayrollValidationException>(() => f.Service.SaveColumns(columns));
        last.Kind = PayrollValueKind.Number;
        last.Payslip = new() { Enabled = true, IntegerDigits = 12, DecimalDigits = 6 };
        last.Summary = new() { Enabled = true, IntegerDigits = 15, DecimalDigits = 4 };
        f.Service.SaveColumns(columns);
        var reopened = f.Reopen().Snapshot.Columns.Single(c => c.FieldName == "g_l80");
        Assert.Equal(6, reopened.Payslip.DecimalDigits);
        Assert.Equal(15, reopened.Summary.IntegerDigits);
        Assert.Equal(90, f.Reopen().Snapshot.Columns.Count);
    }

    [Fact]
    public void NotBindsToComparisonAndNullLogicIsThreeValued()
    {
        using var f = new SyntheticFixture(); var formulas = f.Service.Snapshot.Formulas;
        formulas[0].Expression = "IF(NOT g_l01 < 0 AND (NULL OR TRUE), 12, 99)";
        f.Service.SaveFormulas(formulas);
        Assert.Equal(12m, PayrollService.Value(f.Service.Calculate(SyntheticFixture.Month).Rows[0], "g_l80"));
        formulas[0].Expression = "IF(NULL AND FALSE, 1/0, 8)";
        f.Service.SaveFormulas(formulas);
        Assert.Equal(8m, PayrollService.Value(f.Service.Calculate(SyntheticFixture.Month).Rows[0], "g_l80"));
    }

    [Fact]
    public void WageCsvUsesFullValuesAndNeutralizesEmployeeFormulaText()
    {
        using var f = new SyntheticFixture();
        Assert.Throws<PayrollValidationException>(() => WageTableExporter.ToCsv(f.Service.GetWageTable(SyntheticFixture.Month)));
        var table = f.Service.Calculate(SyntheticFixture.Month);
        table.Rows[0].Employee.Name = " =HYPERLINK(\"合成\")";
        var csv = WageTableExporter.ToCsv(table);
        Assert.Contains("\"' =HYPERLINK(\"\"合成\"\")\"", csv);
        Assert.Contains("3350.25", csv); Assert.Contains("6700.50", csv);
        Assert.Contains("合计（空值未计入）", csv);
    }

    [Fact]
    public void ZeroOnlyUniformSetPreservesNonNullInputs()
    {
        using var f = new SyntheticFixture();
        f.Service.SetInputs(SyntheticFixture.Month, "000001", new Dictionary<string, decimal?> { ["g_l02"] = null });
        f.Service.SetUniformValue(SyntheticFixture.Month, "g_l02", 0, nullValuesOnly: true);
        var rows = f.Reopen().Snapshot.Periods[0].Rows;
        Assert.Equal(0m, rows[0].Inputs["g_l02"]); Assert.Equal(200m, rows[1].Inputs["g_l02"]);
    }
}
