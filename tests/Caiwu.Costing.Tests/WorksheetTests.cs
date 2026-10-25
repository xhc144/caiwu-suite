using System.Globalization;
using System.Text.Json.Nodes;
using Caiwu.Costing;

namespace Caiwu.Costing.Tests;

public sealed class WorksheetTests
{
    private static readonly Guid Book = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid Id = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static CostStageInput Stage(string id = "S1") => new(id, "合成阶段", AllocationBasis.LaborHours,
        AllocationBasis.MachineHours, 80, 40,
        [new("A", "合成甲", 2, 60, 1, 3), new("B", "合成乙", 4, 40, 3, 1)], []);
    private static CostWorksheet Input(params CostStageInput[] stages) => new(Id, Book, new(2026, 10, 1),
        "合成制表人", "合成来源-001", CostWorksheetService.PolicyVersion, stages.Length == 0 ? [Stage()] : stages);
    private static CostWorksheetCalculation Run(CostWorksheet input) => new CostWorksheetService().Calculate(input);
    private static CostStageInput Second() => new("S2", "合成整批加工", AllocationBasis.OutputQuantity,
        AllocationBasis.OutputQuantity, 20, 0, [new("C", "合成成品", 5, 10, 0, 0)],
        [new("S1", "A", "C"), new("S1", "B", "C")]);

    [Fact]
    public void Hand_calculation_material_labor_overhead_and_finished_transfer_are_reconciled()
    {
        var r = Run(Input());
        var a = r.Stages[0].Objects[0]; var b = r.Stages[0].Objects[1];
        // Independently: A=60+80*1/4+40*3/4=110; B=40+60+10=110.
        Assert.Equal((60m, 20m, 30m, 110m, 55m), (a.Materials, a.Labor, a.Overhead, a.TotalCost, a.UnitCost));
        Assert.Equal((40m, 60m, 10m, 110m, 27.5m), (b.Materials, b.Labor, b.Overhead, b.TotalCost, b.UnitCost));
        Assert.Equal(220m, r.ExternalCost); Assert.Equal(220m, r.FinishedCost);
        Assert.All(r.VoucherSuggestions, v =>
        {
            Assert.Equal(CostVoucherStatus.PendingAccountingReview, v.Status);
            Assert.Equal(v.Lines.Sum(l => l.Debit), v.Lines.Sum(l => l.Credit));
            Assert.All(v.Lines, l => Assert.True(l.Debit == 0 || l.Credit == 0));
        });
        Assert.Equal(220m, r.VoucherSuggestions.SelectMany(v => v.Lines).Where(l => l.AccountRole == CostAccountRole.FinishedProducts).Sum(l => l.Debit));
        Assert.Equal(0m, r.VoucherSuggestions.SelectMany(v => v.Lines).Where(l => l.AccountRole == CostAccountRole.WorkInProgress).Sum(l => l.Debit - l.Credit));
    }

    [Fact]
    public void Common_material_pool_uses_same_exact_allocator_and_exposes_cent_adjustments()
    {
        var r = Run(Input(Stage() with { SharedMaterials = 40, MaterialBasis = AllocationBasis.OutputQuantity }));
        // 40*2/6=13.333... and 40*4/6=26.666... ->13.33 and26.67.
        var rows = r.Stages[0].Objects;
        Assert.Equal(13.33m, rows[0].AllocatedMaterials); Assert.Equal(26.67m, rows[1].AllocatedMaterials);
        Assert.Equal(123.33m, rows[0].TotalCost); Assert.Equal(136.67m, rows[1].TotalCost);
        Assert.Equal(260m, r.FinishedCost);
        var trace = r.Stages[0].AllocationDetails.Where(t => t.CostElement == "材料").ToArray();
        Assert.Equal("80000000", trace[0].ExactNumerator); Assert.Equal("60000", trace[0].ExactDenominator);
        Assert.Equal(13.33m, trace[0].FloorAmount); Assert.Equal(0m, trace[0].RemainderAdjustment);
        Assert.Equal(26.66m, trace[1].FloorAmount); Assert.Equal(.01m, trace[1].RemainderAdjustment);
    }

    [Fact]
    public void Three_stage_cost_is_carried_once_preserves_elements_and_only_terminal_objects_finish()
    {
        var last = new CostStageInput("S3", "合成包装", AllocationBasis.OutputQuantity, AllocationBasis.OutputQuantity,
            0, 5, [new("D", "合成终端", 5, 2, 0, 0)], [new("S2", "C", "D")]);
        var r = Run(Input(Stage(), Second(), last));
        // Stage1=220; stage2 adds10 material+20labor=250; stage3 adds2+5=257.
        Assert.Equal(257m, r.ExternalCost); Assert.Equal(257m, r.FinishedCost);
        Assert.Equal(220m, r.Stages[1].CarriedCost); Assert.Equal(250m, r.Stages[2].CarriedCost);
        var final = r.Stages[2].Objects.Single();
        Assert.Equal((112m, 100m, 45m, 257m, 51.4m), (final.Materials, final.Labor, final.Overhead, final.TotalCost, final.UnitCost));
        Assert.All(r.Stages.Take(2).SelectMany(s => s.Objects), o => Assert.True(o.IsTransferredOut));
        var finished = r.VoucherSuggestions.SelectMany(v => v.Lines).Where(l => l.AccountRole == CostAccountRole.FinishedProducts).ToArray();
        Assert.Single(finished); Assert.Equal("D", finished[0].CostObject); Assert.Equal(257m, finished[0].Debit);
        Assert.All(r.VoucherSuggestions.SelectMany(v => v.Lines).Where(l => l.AccountRole == CostAccountRole.WorkInProgress)
            .GroupBy(l => (l.StageId, l.CostObject)), group => Assert.Equal(0m, group.Sum(l => l.Debit - l.Credit)));
    }

    [Fact]
    public void Unconsumed_prior_object_is_finished_without_double_counting_carried_cost()
    {
        var stage = Second() with { CarryIns = [new("S1", "A", "C")] };
        var r = Run(Input(Stage(), stage));
        Assert.Equal(250m, r.FinishedCost);
        Assert.Equal(140m, r.Stages[1].Objects.Single().TotalCost);
        Assert.False(r.Stages[0].Objects.Single(o => o.CostObject == "B").IsTransferredOut);
        Assert.Equal(250m, r.VoucherSuggestions.SelectMany(v => v.Lines).Where(l => l.AccountRole == CostAccountRole.FinishedProducts).Sum(l => l.Debit));
    }

    [Fact]
    public void Fractions_and_ordinal_tail_ties_are_independent_of_input_order_and_culture()
    {
        var stage = Stage() with { LaborBasis = AllocationBasis.OutputQuantity, OverheadBasis = AllocationBasis.OutputQuantity,
            DirectLabor = .01m, ManufacturingOverhead = .02m, SharedMaterials = .01m,
            Objects = [new("C", "丙", .0001m, 0, 0, 0), new("A", "甲", .0001m, 0, 0, 0), new("B", "乙", .0001m, 0, 0, 0)] };
        var original = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("fr-FR");
            var first = Run(Input(stage));
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("zh-CN");
            var second = Run(Input(stage with { Objects = stage.Objects.Reverse().ToArray() }));
            Assert.Equal(first.Stages[0].Objects, second.Stages[0].Objects);
            Assert.Equal(first.InputFingerprint, second.InputFingerprint);
            Assert.Equal(CostWorksheetExport.ToJson(first.Input), CostWorksheetExport.ToJson(second.Input));
            Assert.Equal((.01m, .01m, .01m), (first.Stages[0].Objects[0].AllocatedMaterials, first.Stages[0].Objects[0].AllocatedLabor, first.Stages[0].Objects[0].AllocatedOverhead));
            Assert.Equal(.01m, first.Stages[0].Objects[1].AllocatedOverhead);
            Assert.Equal(.04m, first.FinishedCost);
            Assert.All(first.Stages[0].AllocationDetails, t => Assert.Contains(t.RemainderAdjustment, new[] { 0m, .01m }));
        }
        finally { CultureInfo.CurrentCulture = original; }
    }

    [Fact]
    public void Int64_cent_limit_allocates_exactly_without_decimal_ratio_overflow()
    {
        var stage = Stage() with { LaborBasis = AllocationBasis.OutputQuantity, DirectLabor = 92233720368547758.07m, ManufacturingOverhead = 0,
            Objects = [new("A", "甲", 3, 0, 0, 0), new("B", "乙", 3, 0, 0, 0), new("C", "丙", 4, 0, 0, 0)] };
        var r = Run(Input(stage));
        Assert.Equal(new[] { 27670116110564327.42m, 27670116110564327.42m, 36893488147419103.23m }, r.Stages[0].Objects.Select(o => o.TotalCost));
        Assert.Equal(92233720368547758.07m, r.FinishedCost);
        var third = r.Stages[0].AllocationDetails.Single(t => t.CostElement == "人工" && t.CostObject == "C");
        Assert.Equal(.01m, third.RemainderAdjustment);
    }

    [Theory]
    [InlineData("labor")]
    [InlineData("overhead")]
    [InlineData("material")]
    public void Each_nonzero_pool_rejects_zero_basis(string element)
    {
        var stage = Stage() with { DirectLabor = element == "labor" ? 1 : 0, ManufacturingOverhead = element == "overhead" ? 1 : 0,
            SharedMaterials = element == "material" ? 1 : 0, MaterialBasis = AllocationBasis.LaborHours,
            Objects = [new("A", "甲", 1, 0, 0, 0)] };
        Assert.Throws<CostingValidationException>(() => Run(Input(stage)));
    }

    [Fact]
    public void Zero_pools_allow_zero_hours_and_emit_no_empty_vouchers()
    {
        var stage = Stage() with { DirectLabor = 0, ManufacturingOverhead = 0, MaterialBasis = AllocationBasis.LaborHours,
            Objects = [new("A", "甲", 1, 0, 0, 0)] };
        var r = Run(Input(stage));
        Assert.Equal(0m, r.FinishedCost); Assert.Empty(r.VoucherSuggestions);
        Assert.All(r.Stages[0].AllocationDetails, t => Assert.Equal(0, t.AllocatedAmount));
    }

    [Theory]
    [InlineData("-0.01")]
    [InlineData("0.001")]
    [InlineData("92233720368547758.08")]
    public void Negative_reversal_excess_precision_and_over_limit_amounts_are_rejected_in_every_cost_input(string text)
    {
        var value = decimal.Parse(text, CultureInfo.InvariantCulture); var s = Stage();
        foreach (var bad in new[] { s with { DirectLabor = value }, s with { ManufacturingOverhead = value },
            s with { SharedMaterials = value }, s with { Objects = [s.Objects[0] with { DirectMaterials = value }] } })
            Assert.Throws<CostingValidationException>(() => Run(Input(bad)));
    }

    [Fact]
    public void Effective_precision_is_validated_and_display_unit_cost_does_not_change_totals()
    {
        var s = Stage() with { DirectLabor = .0100m, ManufacturingOverhead = 0, LaborBasis = AllocationBasis.OutputQuantity,
            Objects = [new("A", "甲", 3.0000m, 0, 0, 0)] };
        var r = Run(Input(s)); Assert.Equal(.01m, r.FinishedCost); Assert.Equal(.003333m, r.Stages[0].Objects[0].UnitCost);
        Assert.Throws<CostingValidationException>(() => Run(Input(s with { Objects = [s.Objects[0] with { LaborHours = .00001m }] })));
        foreach (var q in new[] { 0m, -1m, .00001m, 1000000000.0001m })
            Assert.Throws<CostingValidationException>(() => Run(Input(s with { Objects = [s.Objects[0] with { OutputQuantity = q }] })));
    }

    [Fact]
    public void Duplicate_stage_or_object_unknown_target_and_cyclic_or_reused_sources_are_rejected()
    {
        var s = Stage(); var next = Second();
        Assert.Throws<CostingValidationException>(() => Run(Input(s, s)));
        Assert.Throws<CostingValidationException>(() => Run(Input(s with { Objects = [s.Objects[0], s.Objects[0]] })));
        foreach (var links in new IReadOnlyList<StageCarryInput>[] {
            [new("S1", "A", "C"), new("S1", "A", "C")], [new("S1", "A", "missing")],
            [new("S2", "C", "C")], [new("S3", "X", "C")], [new("S1", "missing", "C")] })
            Assert.Throws<CostingValidationException>(() => Run(Input(s, next with { CarryIns = links })));
        Assert.Throws<CostingValidationException>(() => Run(Input(s, next,
            next with { StageId = "S3", CarryIns = [new("S1", "A", "C")] })));
        // Distinct stages can use the same object identifier; identity includes stage.
        var sameName = next with { Objects = [next.Objects[0] with { CostObject = "A" }], CarryIns = [new("S1", "A", "A")] };
        Assert.Equal(250m, Run(Input(s, sameName)).FinishedCost);
    }

    [Fact]
    public void Global_cost_and_row_limits_fail_before_producing_exportable_results()
    {
        Assert.Throws<CostingValidationException>(() => Run(Input(Enumerable.Range(0, 33).Select(i => Stage("S" + i)).ToArray())));
        var s = Stage() with { Objects = Enumerable.Range(0, 1001).Select(i => new CostObjectInput("A" + i, "甲", 1, 0, 0, 0)).ToArray() };
        Assert.Throws<CostingValidationException>(() => Run(Input(s)));
        var max = Stage() with { Objects = [new("A", "甲", 1, 92233720368547758.07m, 0, 0)], DirectLabor = 0, ManufacturingOverhead = 0 };
        Assert.Throws<CostingValidationException>(() => Run(Input(max, Stage("S2"))));
        Assert.Throws<CostingValidationException>(() => Run(Input() with { PolicyVersion = "unknown" }));
        Assert.Throws<CostingValidationException>(() => Run(Input(Stage() with { LaborBasis = (AllocationBasis)99 })));
    }

    [Fact]
    public void Caller_mutation_and_collection_casts_cannot_rewrite_result_audit_input()
    {
        var objects = Stage().Objects.ToList(); var stages = new[] { Stage() with { Objects = objects } };
        var r = Run(Input(stages)); objects.Clear(); stages[0] = Stage("tampered");
        Assert.Equal(2, r.Input.Stages[0].Objects.Count); Assert.Equal("S1", r.Input.Stages[0].StageId);
        Assert.Throws<NotSupportedException>(() => ((IList<CostStageInput>)r.Input.Stages).Clear());
        Assert.Throws<NotSupportedException>(() => ((IList<CostObjectCalculation>)r.Stages[0].Objects).Clear());
        Assert.Throws<NotSupportedException>(() => ((IList<PoolAllocationDetail>)r.Stages[0].AllocationDetails).Clear());
        Assert.Throws<NotSupportedException>(() => ((IList<WorksheetVoucherLine>)r.VoucherSuggestions[0].Lines).Clear());
    }

    [Fact]
    public void Json_export_reopens_and_recalculates_identically_and_rejects_mismatches_or_foreign_books()
    {
        var input = Input(Stage(), Second()); var json = CostWorksheetExport.ToJson(input);
        var reopened = CostWorksheetExport.FromJson(json, Book);
        Assert.Equal(250m, reopened.FinishedCost);
        Assert.Equal(json, CostWorksheetExport.ToJson(reopened.Input));
        Assert.Throws<CostingValidationException>(() => CostWorksheetExport.FromJson(json, Guid.NewGuid()));
        var tree = JsonNode.Parse(json)!; tree["Calculation"]!["FinishedCost"] = 999;
        Assert.Throws<CostingValidationException>(() => CostWorksheetExport.FromJson(tree.ToJsonString(), Book));
        Assert.Throws<CostingValidationException>(() => CostWorksheetExport.FromJson("{}", Book));
        tree = JsonNode.Parse(json)!; tree["Calculation"]!["Stages"]![0]!["Objects"]![0]!["UnitCost"] = 999;
        Assert.Throws<CostingValidationException>(() => CostWorksheetExport.FromJson(tree.ToJsonString(), Book));
        tree = JsonNode.Parse(json)!; tree["Calculation"]!["Input"]!["Stages"]![0]!["Objects"]![0]!.AsObject().Remove("DirectMaterials");
        Assert.Throws<CostingValidationException>(() => CostWorksheetExport.FromJson(tree.ToJsonString(), Book));
        Assert.Throws<CostingValidationException>(() => CostWorksheetExport.FromJson(json.Replace("\"SchemaVersion\": 1", "\"SchemaVersion\": 1, \"SchemaVersion\": 1"), Book));
        Assert.Throws<CostingValidationException>(() => CostWorksheetExport.FromJson(new string(' ', CostWorksheetExport.MaximumJsonBytes + 1), Book));
        tree = JsonNode.Parse(json)!; tree["SchemaVersion"] = 2;
        Assert.Throws<CostingValidationException>(() => CostWorksheetExport.FromJson(tree.ToJsonString(), Book));
    }

    [Fact]
    public void Audit_import_detects_one_cent_or_sixth_decimal_tampering_even_at_large_amounts()
    {
        var stage = Stage() with { DirectLabor = 92233720368547758.07m, ManufacturingOverhead = 0,
            LaborBasis = AllocationBasis.OutputQuantity, Objects = [new("A", "甲", .0001m, 0, 0, 0)] };
        var json = CostWorksheetExport.ToJson(Input(stage));
        Assert.Equal(92233720368547758.07m, CostWorksheetExport.FromJson(json, Book).FinishedCost);
        var tree = JsonNode.Parse(json)!; tree["Calculation"]!["ExternalCost"] = 92233720368547758.06m;
        Assert.Throws<CostingValidationException>(() => CostWorksheetExport.FromJson(tree.ToJsonString(), Book));
        tree = JsonNode.Parse(json)!; tree["Calculation"]!["Stages"]![0]!["Objects"]![0]!["UnitCost"] = 922337203685477580700.000001m;
        Assert.Throws<CostingValidationException>(() => CostWorksheetExport.FromJson(tree.ToJsonString(), Book));
    }

    [Fact]
    public void Safe_exports_preserve_existing_bytes_and_do_not_accept_database_paths()
    {
        var directory = Path.Combine(Path.GetTempPath(), "caiwu-synthetic-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(directory);
        try
        {
            var path = Path.Combine(directory, "audit.json");
            CostWorksheetExport.SaveNewJson(path, Input()); var bytes = File.ReadAllBytes(path);
            Assert.Throws<IOException>(() => CostWorksheetExport.SaveNewJson(path, Input()));
            Assert.Equal(bytes, File.ReadAllBytes(path));
            Assert.Equal(220m, CostWorksheetExport.OpenJson(path, Book).FinishedCost);
            var book = Path.Combine(directory, "synthetic.caiwu"); File.WriteAllText(book, "synthetic-book-bytes");
            Assert.Throws<CostingValidationException>(() => CostWorksheetExport.SaveNewJson(book, Input()));
            Assert.Equal("synthetic-book-bytes", File.ReadAllText(book));
            var csv = Path.Combine(directory, "details.csv"); CostWorksheetExport.SaveNewCsv(csv, Input());
            Assert.Contains("分配审计", File.ReadAllText(csv));
            Assert.DoesNotContain(Directory.GetFiles(directory), f => f.EndsWith(".tmp"));
        }
        finally { Directory.Delete(directory, recursive: true); }
    }

    [Fact]
    public void Csv_quotes_text_and_neutralizes_spreadsheet_formula_prefixes()
    {
        var input = Input(Stage() with { Objects = [new("=1+1", "引号\"产品", 1, 0, 1, 1)] }) with { SourceReference = "@SUM(1,2)" };
        var csv = CostWorksheetExport.ToCsv(input);
        Assert.Contains("\"'=1+1\"", csv); Assert.Contains("\"'@SUM(1,2)\"", csv); Assert.Contains("引号\"\"产品", csv);
    }

    [Fact]
    public void Editor_actual_input_recalculate_export_import_loop_has_independent_expected_totals()
    {
        var editor = new CostWorksheetEditor(Book, new(2026, 10, 1));
        editor.LoadSyntheticExample(); Assert.False(editor.CanExport);
        Assert.True(editor.Calculate()); Assert.Equal(250m, editor.Result!.FinishedCost);
        editor.Stages[0].DirectLabor = "84.00"; Assert.False(editor.CanExport); Assert.Empty(editor.VoucherRows);
        Assert.True(editor.Calculate()); Assert.Equal(254m, editor.Result!.FinishedCost);
        // S1 A labor21, B63; S2 carries224 + new30 =254, unit50.8.
        Assert.Equal(21m, editor.CalculationRows.Single(o => o.StageId == "S1" && o.CostObject == "A").AllocatedLabor);
        Assert.Equal(50.8m, editor.CalculationRows.Single(o => o.StageId == "S2").UnitCost);
        var json = CostWorksheetExport.ToJson(editor.GetCalculatedInput());
        var second = new CostWorksheetEditor(Book, new(2026, 10, 1)); second.Load(CostWorksheetExport.FromJson(json, Book).Input);
        Assert.True(second.Calculate()); Assert.Equal(json, CostWorksheetExport.ToJson(second.GetCalculatedInput()));
        Assert.All(second.VoucherRows, row => Assert.Equal(CostVoucherStatus.PendingAccountingReview, row.Status));
    }

    [Theory]
    [InlineData("")]
    [InlineData("1e1")]
    [InlineData("1,00")]
    [InlineData("abc")]
    [InlineData("-0.01")]
    [InlineData("0.001")]
    [InlineData("1.0000000000000000000000000000001")]
    public void Editor_invalid_cell_is_never_silently_coerced_or_exported(string value)
    {
        var editor = new CostWorksheetEditor(Book, new(2026, 10, 1)); editor.LoadSyntheticExample(); Assert.True(editor.Calculate());
        editor.Objects[0].DirectMaterials = value;
        Assert.False(editor.Calculate()); Assert.Null(editor.Result); Assert.False(editor.CanExport);
        Assert.Throws<CostingValidationException>(() => editor.GetCalculatedInput()); Assert.Empty(editor.CalculationRows);
    }

    [Fact]
    public void Metadata_basis_carry_and_collection_edits_all_invalidate_previous_results()
    {
        var editor = new CostWorksheetEditor(Book, new(2026, 10, 1)); editor.LoadSyntheticExample();
        foreach (var edit in new Action[] { () => editor.PreparedBy = "另一合成人", () => editor.SourceReference = "另一合成来源",
            () => editor.DateText = "2026-10-02", () => editor.Stages[0].MaterialBasis = "LaborHours",
            () => editor.CarryIns[0].SourceCostObject = "B", () => editor.Objects.Add(new()), () => editor.Stages.Clear() })
        {
            editor.LoadSyntheticExample(); Assert.True(editor.Calculate()); edit(); Assert.False(editor.CanExport); Assert.Empty(editor.VoucherRows);
        }
        editor.LoadSyntheticExample(); editor.Objects[0].StageId = "missing";
        Assert.False(editor.Calculate()); Assert.Contains("阶段不存在", editor.Status);
    }
}
