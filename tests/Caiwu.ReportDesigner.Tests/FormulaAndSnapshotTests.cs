using Caiwu.Contracts;
using Caiwu.Reporting;

namespace Caiwu.ReportDesigner.Tests;

public sealed class FormulaAndSnapshotTests
{
    private static ReportPreview Calculate(string expression) => ReportDesignerEngine.Preview(SyntheticFixture.Input(),
        SyntheticFixture.Template() with { Columns = [new("calc", "数值", expression)] });
    [Fact]
    public void IndependentHandCalculatedLeafTotalsAndRound()
    {
        // Independently: 100.10-10.00=90.10; 30.20-20.10=10.10; leaves total=100.20.
        // Per-row ROUND(/3,2): 30.03+3.37=33.40. Parent row100.20 is displayed but never added again.
        var preview = ReportDesignerEngine.Preview(SyntheticFixture.Input(), SyntheticFixture.Template());
        Assert.Equal(4, preview.Rows.Count);
        Assert.Equal(90.10m, preview.Rows[1].Cells[1].Number);
        Assert.Equal(10.10m, preview.Rows[2].Cells[1].Number);
        Assert.Equal(100.20m, preview.Rows[3].Cells[1].Number);
        Assert.Equal(33.40m, preview.Rows[3].Cells[2].Number);
        Assert.Equal("30.0300", preview.Rows[1].Cells[2].Text);
        Assert.Equal(42, preview.Input.SourceRevision);
        Assert.Contains("BookId=10000000", string.Join('\n', preview.AuditLines()));
        Assert.Contains("合成演示", string.Join('\n', preview.AuditLines()));
    }
    [Theory]
    [InlineData("0.1+0.2", "0.3")]
    [InlineData("2+3*4", "14")]
    [InlineData("(2+3)*4", "20")]
    [InlineData("-(-2)+ABS(-3)", "5")]
    [InlineData("SUM(1,2,-3,4)", "4")]
    [InlineData("ROUND(1/3,6)", "0.333333")]
    [InlineData("ROUND(-1.005,2)", "-1.01")]
    [InlineData("ROUND(1.005,2)", "1.01")]
    [InlineData("79228162514264337593543950335", "79228162514264337593543950335")]
    public void ClosedGrammarArithmetic(string expression, string expected) =>
        Assert.Equal(decimal.Parse(expected, System.Globalization.CultureInfo.InvariantCulture), Calculate(expression).Rows[0].Cells[0].Number);
    [Theory]
    [InlineData("1/0")]
    [InlineData("1/3")]
    [InlineData("79228162514264337593543950335+0.01")]
    [InlineData("79228162514264337593543950335*10")]
    [InlineData("0.0000000000000000000000000001/10")]
    public void ArithmeticNeverSilentlyRoundsOrFillsZero(string expression)
    {
        var ex = Assert.Throws<DesignValidationException>(() => Calculate(expression));
        Assert.All(ex.Issues, x => { Assert.Equal("calc", x.Column); Assert.NotNull(x.Position); });
    }
    [Theory]
    [InlineData("System.IO.File.Delete(1)")]
    [InlineData("SELECT 1")]
    [InlineData("Math.Abs(1)")]
    [InlineData("POW(2,3)")]
    [InlineData("[debit];1")]
    [InlineData("ROUND(1,[periodDebit])")]
    [InlineData("ROUND(1,7)")]
    [InlineData("SUM()")]
    [InlineData("ABS(1,2)")]
    [InlineData("1e9")]
    [InlineData("0.12345678901234567890123456789")]
    [InlineData("[periodDebit")]
    [InlineData("9.9999999999999999999999999999")]
    public void UnsafeOrUnsupportedSyntaxRejectedBeforeAnyRows(string expression) => Assert.Throws<DesignValidationException>(() => Calculate(expression));
    [Fact]
    public void MissingFieldIsLocatedEvenWhenHidden()
    {
        var t = SyntheticFixture.Template() with { Columns = [new("name", "名称", "[accountName]"), new("bad", "隐藏", "1+[missing]", Visible: false)] };
        var ex = Assert.Throws<DesignValidationException>(() => ReportDesignerEngine.Preview(SyntheticFixture.Input(), t));
        Assert.Equal("FIELD_MISSING", ex.Issues[0].Code); Assert.Equal("bad", ex.Issues[0].Column); Assert.Equal(3, ex.Issues[0].Position);
    }
    [Fact]
    public void CyclesAndIndirectCyclesAreRejected()
    {
        var t = SyntheticFixture.Template() with { Columns = [new("a", "A", "[b]"), new("b", "B", "[c]"), new("c", "C", "[a]")] };
        Assert.Equal("CYCLE", Assert.Throws<DesignValidationException>(() => ReportDesignerEngine.Preview(SyntheticFixture.Input(), t)).Issues[0].Code);
    }
    [Fact]
    public void TextCannotBecomeZeroAndSourceCannotBeShadowed()
    {
        Assert.Equal("FIELD_TYPE", Assert.Throws<DesignValidationException>(() => Calculate("[accountName]+1")).Issues[0].Code);
        var t = SyntheticFixture.Template() with { Columns = [new("periodDebit", "借方", "1")] };
        Assert.Equal("SHADOW", Assert.Throws<DesignValidationException>(() => ReportDesignerEngine.Preview(SyntheticFixture.Input(), t)).Issues[0].Code);
    }
    [Fact]
    public void ComplexityAndDeepExpressionsAreBounded()
    {
        Assert.Throws<DesignValidationException>(() => Calculate(new string('(', 40) + "1" + new string(')', 40)));
        Assert.Throws<DesignValidationException>(() => Calculate(string.Join('+', Enumerable.Repeat("1", 100))));
        Assert.Throws<DesignValidationException>(() => Calculate(new string('1', 513)));
    }
    [Fact]
    public void EmptySourcesStillValidateFormulas()
    {
        var input = SyntheticFixture.Input(0);
        var result = ReportDesignerEngine.Preview(input, SyntheticFixture.Template());
        Assert.Single(result.Rows); Assert.Equal(0m, result.Rows[0].Cells[1].Number);
        Assert.Throws<DesignValidationException>(() => ReportDesignerEngine.Preview(input,
            SyntheticFixture.Template() with { Columns = [new("x", "缺失", "[missing]")] }));
        Assert.Throws<DesignValidationException>(() => ReportDesignerEngine.Preview(input,
            SyntheticFixture.Template() with { Columns = [new("x", "除零", "1/0")] }));
    }
    [Fact]
    public void HiddenRuntimeFailureCannotMasqueradeAsComplete()
    {
        var t = SyntheticFixture.Template() with { Columns = [new("name", "名称", "[accountName]"), new("bad", "隐藏", "[periodDebit]/0", Visible: false)] };
        var ex = Assert.Throws<DesignValidationException>(() => ReportDesignerEngine.Preview(SyntheticFixture.Input(), t));
        Assert.Equal("bad", ex.Issues[0].Column); Assert.Equal(1, ex.Issues[0].Row); Assert.Equal(14, ex.Issues[0].Position);
    }
    [Fact]
    public void TotalPrecisionLossAndIntermediateComplexityAreRejected()
    {
        var t = SyntheticFixture.Template() with { Columns = [new("big", "大数", "79228162514264337593543950335", Total: true)] };
        Assert.Equal("TOTAL_OVERFLOW", Assert.Throws<DesignValidationException>(() => ReportDesignerEngine.Preview(SyntheticFixture.Input(), t)).Issues[0].Code);
        Assert.Throws<DesignValidationException>(() => Calculate(string.Join('*', Enumerable.Repeat("10000000000000000000000000000", 6))));
        Assert.Equal(.0000000000000000000000000002m, Calculate("0.0000000000000000000000000001+0.0000000000000000000000000001").Rows[0].Cells[0].Number);
    }
    [Fact]
    public void LedgerTotalsExcludeOpeningRowAndRetainSourceNote()
    {
        var metadata = SyntheticFixture.Input().Metadata;
        var source = ReportBuilder.Ledger(metadata, "bank", [
            new(null, null, "", null, "期初", 50, 0, 50),
            new(new DateOnly(2026,10,2), Guid.NewGuid(), "记", 1, "测试", 10.5m, 0, 60.5m)
        ]);
        var input = new ReportInputSnapshot(source, 10);
        var preview = ReportDesignerEngine.Preview(input, input.CreateTemplate());
        var debit = preview.Columns.Select((c,i)=>(c,i)).Single(x=>x.c.Key=="debit").i;
        Assert.Equal(10.5m, preview.Rows[^1].Cells[debit].Number);
        Assert.Contains("期初", string.Join('\n', preview.Warnings));
        Assert.Null(preview.Rows[^1].Cells[preview.Columns.Select((c,i)=>(c,i)).Single(x=>x.c.Key=="runningBalance").i].Number);
    }
    [Fact]
    public void VoucherListUsesExistingTypedAmountsAndRetainsStateWarning()
    {
        var source = ReportBuilder.VoucherList(SyntheticFixture.Input().Metadata, [
            new Voucher(Guid.NewGuid(), new DateOnly(2026,10,2), "记", 1, 0, "合成制单", null, VoucherStatus.Draft,
                [new("1002", "演示", 0.1m, 0), new("4001", "演示", 0, 0.1m)])
        ]);
        var input = new ReportInputSnapshot(source, 6); var preview = ReportDesignerEngine.Preview(input, input.CreateTemplate());
        var debit = preview.Columns.Select((c,i)=>(c,i)).Single(x=>x.c.Key=="debit").i;
        Assert.Equal(.1m, preview.Rows[^1].Cells[debit].Number); Assert.Contains("全部状态", string.Join('\n', preview.Warnings));
    }
    [Fact]
    public void TemplateAndSourceSnapshotsAreImmutableAndFingerprintChangesWithContext()
    {
        var input = SyntheticFixture.Input(); var list = SyntheticFixture.Template().Columns.ToList();
        var preview = ReportDesignerEngine.Preview(input, SyntheticFixture.Template() with { Columns = list });
        list.Clear(); Assert.Equal(3, preview.Columns.Count); Assert.Equal(3, preview.Template.Columns.Count);
        Assert.Equal(input.Fingerprint, SyntheticFixture.Input().Fingerprint);
        Assert.NotEqual(input.SnapshotId, SyntheticFixture.Input().SnapshotId);
        Assert.Throws<DesignValidationException>(() => ReportDesignerEngine.Preview(input, SyntheticFixture.Template() with { SourceKind = ReportKind.Ledger }));
    }
}
