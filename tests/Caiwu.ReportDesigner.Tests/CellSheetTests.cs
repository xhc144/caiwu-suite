using System.Globalization;
using System.Text.Json;
using Caiwu.ReportDesigner.Cells;

namespace Caiwu.ReportDesigner.Tests;

public sealed class CellSheetTests
{
    private static readonly Guid Book = Guid.Parse("22222222-3333-4444-5555-666666666666");
    private static readonly ReportQueryContext Context = new(Book, new(2026, 2, 1), new(2026, 2, 28), 7);
    private static LedgerReportSource Source() => new(Book, 7, new(2026, 1, 1), new(2026, 3, 31),
        [new("1001", null, 0, 0), new("100101", "1001", 1000, 0), new("100102", "1001", 500, 0), new("3001", null, 0, 1500)],
        [new("jan", new(2026, 1, 12), true, [new("100101", 200, 0), new("3001", 0, 200)]),
         new("feb", new(2026, 2, 3), true, [new("3001", 150, 0), new("100101", 0, 150)]),
         new("feb2", new(2026, 2, 4), true, [new("100102", 50, 0), new("3001", 0, 50)]),
         new("draft", new(2026, 2, 5), false, [new("100101", 900, 0), new("3001", 0, 900)]),
         new("future", new(2026, 3, 1), true, [new("100101", 600, 0), new("3001", 0, 600)])], true);
    private static CellReport Sheet(params CellDefinition[] cells) => new() { RowCount = 8, ColumnCount = 6, Cells = cells };
    private static CellReportResult Generate(CellReport report) => new CellReportEngine().Generate(report, Context, Source());
    [Fact] public void LedgerFunctionsAndCellGridMatchIndependentHandCalculation()
    {
        var result = Generate(Sheet(new CellDefinition("A1", "期初"), new("B1", "=OPENING(\"1001\",\"TREE\")"),
            new("B2", "=CLOSING(\"1001\",\"TREE\")"), new("B3", "=DEBIT(\"1001\",\"TREE\")"),
            new("B4", "=CREDIT(\"1001\",\"TREE\")"), new("B5", "=YTDDEBIT(\"1001\",\"TREE\")"),
            new("B6", "=YTDCREDIT(\"1001\",\"TREE\")"), new("C1", "=B1+B3-B4"), new("C2", "=SUM(B3:B4,ABS(-5),ROUND(1/3,2))")));
        Assert.Equal(1700m, result["B1"].Number); Assert.Equal(1600m, result["B2"].Number);
        Assert.Equal(50m, result["B3"].Number); Assert.Equal(150m, result["B4"].Number);
        Assert.Equal(250m, result["B5"].Number); Assert.Equal(150m, result["B6"].Number);
        Assert.Equal(1600m, result["C1"].Number); Assert.Equal(205.33m, result["C2"].Number);
        Assert.Equal(1, result.Source.UnpostedVoucherCount); Assert.True(result.Source.IsSynthetic);
    }
    [Fact] public void FormattingSaveReopenRecalculateAndExportAreOneWorkingChain()
    {
        var folder = Path.Combine(Path.GetTempPath(), "cell-report-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(folder);
        try {
            var report = Sheet(new CellDefinition("A1", "<script>1</script>"), new("B2", "=CLOSING(\"1001\",\"TREE\")", new(CellHorizontalAlignment.Right, CellVerticalAlignment.Bottom, true, 4, true))) with {
                Rows = [new(2, .4m)], Columns = [new(2, 22.5m)] };
            var path = Path.Combine(folder, "sheet.json"); var saved = CellReportStore.Save(path, report);
            var reopened = CellReportStore.Load(path); Assert.Equal(saved.Sha256, reopened.Sha256);
            Assert.Equal(.4m, reopened.Report.Rows[0].HeightInches); Assert.Equal(22.5m, reopened.Report.Columns[0].WidthCharacters);
            var result = Generate(reopened.Report); Assert.Equal("1,600.0000", result["B2"].Text);
            var htmlPath = Path.Combine(folder, "sheet.html"); var csvPath = Path.Combine(folder, "sheet.csv");
            CellReportExport.WriteHtml(htmlPath, result); CellReportExport.WriteCsv(csvPath, result);
            var html = File.ReadAllText(htmlPath); Assert.Contains("height:0.4in", html); Assert.Contains("width:22.5ch", html);
            Assert.Contains("&lt;script&gt;", html); Assert.DoesNotContain("<script>", html); Assert.Contains("SYNTHETIC", html);
            Assert.Contains("\"1,600.0000\"", File.ReadAllText(csvPath));
            Assert.Throws<IOException>(() => CellReportExport.WriteHtml(htmlPath, result));
            Assert.Equal(html, File.ReadAllText(htmlPath));
            var updated = reopened.Report with { Version = 2, Title = "已更新" }; CellReportStore.Save(path, updated, reopened.Sha256);
            Assert.Throws<TemplateConflictException>(() => CellReportStore.Save(path, updated, reopened.Sha256));
            Assert.Equal("已更新", CellReportStore.Load(path).Report.Title);
        } finally { Directory.Delete(folder, true); }
    }
    [Theory]
    [InlineData("=B1", "TYPE")]
    [InlineData("=1/0", "DIV0")]
    [InlineData("=1/3", "PRECISION")]
    [InlineData("=CLOSING(\"missing\")", "DATA")]
    [InlineData("=CLOSING(\"1001\")", "DATA")]
    [InlineData("=UNKNOWN(1)", "FUNCTION")]
    [InlineData("=SUM(A1:ZZ999)", "FORMULA")]
    [InlineData("=G1", "REFERENCE")]
    [InlineData("=ROUND(1/3,B1)", "FORMULA")]
    [InlineData("=System.IO.File.ReadAllText(\"secret\")", "FORMULA")]
    [InlineData("=CLOSING(\"100101\");DROP TABLE pz", "FORMULA")]
    public void FailuresHaveCellIdentityAndNeverReturnAnExportableResult(string formula, string code)
    {
        var ex = Assert.Throws<CellReportException>(() => Generate(Sheet(new CellDefinition("A1", formula), new("B1", "文本"))));
        Assert.Contains(ex.Issues, issue => issue.Address == "A1" && issue.Code == code);
    }
    [Fact] public void CyclesAndDependencyFailuresAreExplicit()
    {
        Assert.Contains(Assert.Throws<CellReportException>(() => Generate(Sheet(new CellDefinition("A1", "=B1"), new("B1", "=A1")))).Issues, i => i.Code == "CYCLE");
        var ex = Assert.Throws<CellReportException>(() => Generate(Sheet(new CellDefinition("A1", "=B1+1"), new("B1", "=1/0"))));
        Assert.Contains(ex.Issues, i => i.Address == "B1" && i.Code == "DIV0"); Assert.Contains(ex.Issues, i => i.Address == "A1" && i.Code == "DEPENDENCY");
    }
    [Fact] public void EmptyCellsAreZeroButTextIsNotZeroAndDisplayRoundingDoesNotAffectArithmetic()
    {
        var result = Generate(Sheet(new CellDefinition("A1", "0.004", new(DecimalPlaces: 2)), new("A2", "=A1*1000+B2")));
        Assert.Equal("0.00", result["A1"].Text); Assert.Equal(4m, result["A2"].Number);
        Assert.Throws<CellReportException>(() => Generate(Sheet(new CellDefinition("A1", "0.12345678901234567890123456789"))));
    }
    [Fact] public void OriginalRowColumnMaximumsAndNormalizedDuplicateAddressesAreEnforced()
    {
        var sheet = new CellReport { RowCount = 999, ColumnCount = 250, Cells = [new("IP999", "1")] };
        Assert.Equal(1m, Generate(sheet)["IP999"].Number);
        Assert.Throws<CellReportException>(() => Generate(Sheet(new CellDefinition("a1", "1"), new("A1", "2"))));
        Assert.Throws<CellReportException>(() => Generate(sheet with { ColumnCount = 251 }));
        Assert.Throws<CellReportException>(() => Generate(sheet with { Rows = [new(1, 0)] }));
    }
    [Fact] public void SourceIdentityAndGenerationAreChecked()
    {
        Assert.Throws<ReportDataException>(() => new CellReportEngine().Generate(Sheet(new CellDefinition("A1", "1")), Context with { ExpectedRevision = 8 }, Source()));
        Assert.Throws<ReportDataException>(() => new CellReportEngine().Generate(Sheet(new CellDefinition("A1", "1")), Context with { BookId = Guid.NewGuid() }, Source()));
    }
    [Fact] public void MidYearOpeningCannotInventYearToDateAndHierarchyCannotDoubleCount()
    {
        var source = new LedgerReportSource(Book, 7, new(2026, 2, 1), new(2026, 3, 31), [new("a", null, 20, 0), new("b", null, 0, 20)], [], true);
        Assert.Throws<CellReportException>(() => new CellReportEngine().Generate(Sheet(new CellDefinition("A1", "=YTDDEBIT(\"a\")")), Context, source));
        Assert.Throws<ReportDataException>(() => new LedgerReportSource(Book, 7, new(2026, 1, 1), new(2026, 3, 31), [new("a", null, 5, 0), new("b", "a", 0, 5)], [], true));
        Assert.Throws<ReportDataException>(() => new LedgerReportSource(Book, 7, new(2026, 1, 1), new(2026, 3, 31), [new("a", "b", 0, 0), new("b", "a", 0, 0)], [], true));
    }
    [Fact] public void CatalogAliasesAreExplicitAndMissingOriginalFunctionsAreRejected()
    {
        var catalog = new ReportFunctionCatalog(new Dictionary<string, ReportMeasure> { ["VerifiedClosing"] = ReportMeasure.Closing });
        var result = new CellReportEngine(catalog).Generate(Sheet(new CellDefinition("A1", "=VerifiedClosing(\"100101\")")), Context, Source());
        Assert.Equal(1050m, result["A1"].Number);
        Assert.Throws<CellReportException>(() => new CellReportEngine(catalog).Generate(Sheet(new CellDefinition("A1", "=CLOSING(\"100101\")")), Context, Source()));
    }
    [Fact] public void CsvQuotesTextAndNeutralizesSpreadsheetInjection()
    {
        var result = Generate(Sheet(new CellDefinition("A1", "@SUM(A1)"), new("B1", "-cmd"), new("C1", "  +cmd"), new("D1", "x,\"y\"\nz")));
        var csv = CellReportExport.Csv(result);
        Assert.Contains("\"'@SUM(A1)\"", csv); Assert.Contains("\"'-cmd\"", csv); Assert.Contains("\"'  +cmd\"", csv); Assert.Contains("\"x,\"\"y\"\"\nz\"", csv);
    }
    [Fact] public void StrictJsonRejectsDuplicateKeysUnknownFieldsAndMalformedFormats()
    {
        var path = Path.Combine(Path.GetTempPath(), "cell-invalid-" + Guid.NewGuid().ToString("N") + ".json");
        try {
            var json = JsonSerializer.Serialize(Sheet(new CellDefinition("A1", "1")));
            File.WriteAllText(path, json.Replace("\"SchemaVersion\":1", "\"SchemaVersion\":1,\"SchemaVersion\":1", StringComparison.Ordinal));
            Assert.Throws<InvalidDataException>(() => CellReportStore.Load(path));
            File.WriteAllText(path, json.Replace("\"Title\":", "\"Unknown\":false,\"Title\":", StringComparison.Ordinal));
            Assert.Throws<InvalidDataException>(() => CellReportStore.Load(path));
        } finally { File.Delete(path); }
    }
    [Fact] public void NumericOutputIsCultureIndependentAndExactIntermediatesAreReused()
    {
        var old = CultureInfo.CurrentCulture; try {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("de-DE");
            var result = Generate(Sheet(new CellDefinition("A1", "=ROUND(1/6,2)"), new("A2", "=(0.1+0.2)*10")));
            Assert.Equal("0.17", result["A1"].Text); Assert.Equal(3m, result["A2"].Number);
        } finally { CultureInfo.CurrentCulture = old; }
    }
    [Fact] public void SnapshotCompletenessBoundsAndCopiedInputsAreEnforced()
    {
        var accounts = new List<ReportAccount> { new("a", null, 10, 0), new("b", null, 0, 10) };
        var lines = new List<ReportEntry> { new("a", 5, 0), new("b", 0, 5) };
        var vouchers = new List<ReportVoucher> { new("v", new(2026, 2, 2), true, lines) };
        var source = new LedgerReportSource(Book, 7, new(2026, 1, 1), new(2026, 2, 28), accounts, vouchers, true);
        accounts[0] = new("a", null, 1000, 0); lines[0] = new("a", 1000, 0); vouchers.Clear();
        var result = new CellReportEngine().Generate(Sheet(new CellDefinition("A1", "=CLOSING(\"a\")")), Context, source);
        Assert.Equal(15m, result["A1"].Number);
        Assert.Throws<ReportDataException>(() => source.Capture(Context with { To = new(2026, 3, 1) }));
        Assert.Throws<ReportDataException>(() => new LedgerReportSource(Book, 7, new(2026, 1, 1), new(2026, 2, 28), [new("a", null, 10, 0), new("b", null, 0, 9)], [], true));
    }
    private sealed class CountingSource(IReportDataSource inner) : IReportDataSource
    {
        public int Captures, Reads;
        public IReportDataSnapshot Capture(ReportQueryContext context) { Captures++; return new CountingSnapshot(this, inner.Capture(context)); }
        private sealed class CountingSnapshot(CountingSource owner, IReportDataSnapshot inner) : IReportDataSnapshot
        { public ReportSourceStamp Stamp => inner.Stamp; public decimal Read(ReportDataRequest request) { owner.Reads++; return inner.Read(request); } }
    }
    [Fact] public void OneGenerationCapturesOneRevisionAndCachesIdenticalQueries()
    {
        var source = new CountingSource(Source());
        var sheet = Sheet(new CellDefinition("A1", "=CLOSING(\"100101\")"), new("A2", "=CLOSING(\"100101\")+1"));
        var result = new CellReportEngine().Generate(sheet, Context, source);
        Assert.Equal(1, source.Captures); Assert.Equal(1, source.Reads); Assert.Equal(1051m, result["A2"].Number);
    }
    [Fact] public void FormulaBudgetsAndLongDependencyChainsAreBoundedWithoutRecursiveGraphTraversal()
    {
        Assert.Throws<CellReportException>(() => Generate(Sheet(new CellDefinition("A1", "=" + new string('(', 40) + "1" + new string(')', 40)))));
        Assert.Throws<CellReportException>(() => Generate(Sheet(new CellDefinition("A1", "=" + string.Join("+", Enumerable.Repeat("1", 100))))));
        var cells = Enumerable.Range(1, 999).Select(i => new CellDefinition("A" + i, i == 999 ? "1" : "=A" + (i + 1) + "+1")).ToArray();
        Assert.Equal(999m, Generate(new CellReport { RowCount = 999, ColumnCount = 1, Cells = cells })["A1"].Number);
        var repeatedRange = "=SUM(" + string.Join(",", Enumerable.Repeat("B1:K500", 32)) + ")";
        var limited = new CellReport { RowCount = 500, ColumnCount = 11, Cells = [new("A1", repeatedRange), new("A2", repeatedRange)] };
        Assert.Contains(Assert.Throws<CellReportException>(() => Generate(limited)).Issues, i => i.Code == "LIMIT");
    }

}
