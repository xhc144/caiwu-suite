using Caiwu.Payroll;

namespace Caiwu.Payroll.Tests;

public sealed class FormulaValidationTests
{
    [Theory]
    [InlineData("1;DROP TABLE payroll_document")]
    [InlineData("System.IO.File.Delete(1)")]
    [InlineData("unknown + 1")]
    [InlineData("today()")]
    [InlineData("ROUND(1)")]
    [InlineData("IF(1,2)")]
    [InlineData("1..2")]
    [InlineData("1 +")]
    [InlineData("(1+2")]
    [InlineData("1e999")]
    public void UnsupportedOrMalformedFormulaFailsBeforePersistence(string expression)
    {
        using var f = new SyntheticFixture();
        var formulas = f.Service.Snapshot.Formulas;
        formulas[2].Expression = expression;
        var revision = f.Service.Revision;
        Assert.Throws<PayrollValidationException>(() => f.Service.SaveFormulas(formulas));
        Assert.Equal(revision, f.Reopen().Revision);
    }

    [Fact]
    public void ExcessiveDepthAndLengthAreBounded()
    {
        using var f = new SyntheticFixture();
        var formulas = f.Service.Snapshot.Formulas;
        foreach (var expression in new[] { new string('(', 80) + "1" + new string(')', 80), new string('1', 3000) })
        {
            formulas[2].Expression = expression;
            Assert.Throws<PayrollValidationException>(() => f.Service.SaveFormulas(formulas));
        }
    }

    [Fact]
    public void UnsupportedDisabledOriginalFormulaAndMetadataRemainAvailableForAdapter()
    {
        using var f = new SyntheticFixture();
        var formulas = f.Service.Snapshot.Formulas;
        formulas.Add(new() { Order = 99, Name = "保留原公式", Enabled = false, Expression = "monthbefore(today(),1)",
            TargetField = "g_l79", OriginalFields = new() { ["tjx"] = null, ["xzbz"] = "unknown" } });
        f.Service.SaveFormulas(formulas);
        var original = f.Reopen().Snapshot.Formulas.Single(x => x.Order == 99);
        Assert.Equal("monthbefore(today(),1)", original.Expression);
        Assert.Null(original.OriginalFields["tjx"]);
        Assert.True(f.Service.Calculate(SyntheticFixture.Month).IsCalculated);
    }
}
