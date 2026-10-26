using System.Text.Json;
using Caiwu.Invoicing;

namespace Caiwu.Invoicing.Tests;

public sealed class OriginalEvidenceTests
{
    private static string Repository()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
            if (File.Exists(Path.Combine(dir.FullName, "docs/original-analysis/json/windows.json"))) return dir.FullName;
        throw new InvalidOperationException("Original evidence was not found in this checkout.");
    }

    [Theory]
    [InlineData(InvoiceDirection.Output, "w_fp_lr_1")]
    [InlineData(InvoiceDirection.Input, "w_fp_lr_2")]
    public void EntryAnchorsMatchBothProductsExistingEvidence(InvoiceDirection direction, string window)
    {
        using var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(Repository(), "docs/original-analysis/json/windows.json")));
        foreach (var product in new[] { "qingsong/fp", "chengben/fp" })
        {
            var controls = json.RootElement.GetProperty(product).GetProperty(window).GetProperty("controls").EnumerateArray()
                .ToDictionary(x => x.GetProperty("name").GetString()!, x => x.GetProperty("props"));
            foreach (var pair in OriginalInvoiceLayout.Entry(direction))
            {
                var source = controls[pair.Key];
                Assert.Equal(new OriginalPbuBounds(int.Parse(source.GetProperty("x").GetString()!), int.Parse(source.GetProperty("y").GetString()!),
                    int.Parse(source.GetProperty("width").GetString()!), int.Parse(source.GetProperty("height").GetString()!)), pair.Value);
            }
        }
    }

    [Theory]
    [InlineData(InvoiceDirection.Output, "g_fp_mx", "dw_fp_lr")]
    [InlineData(InvoiceDirection.Input, "g_fp_mx_2", "dw_fp_lr_2")]
    public void KnownColumnsCoverOriginalTableAndDataWindowFields(InvoiceDirection direction, string table, string dw)
    {
        var directory = Path.Combine(Repository(), "docs/original-analysis/json");
        using var tables = JsonDocument.Parse(File.ReadAllText(Path.Combine(directory, "tables.json")));
        using var windows = JsonDocument.Parse(File.ReadAllText(Path.Combine(directory, "datawindows.json")));
        var known = direction == InvoiceDirection.Output ? InvoiceColumns.Output : InvoiceColumns.Input;
        var schema = tables.RootElement.GetProperty("tables").GetProperty(table).GetProperty("columns").EnumerateArray()
            .Select(x => x.GetProperty("name").GetString()!).ToArray();
        Assert.Equal(schema.Order(), known.Order());
        foreach (var product in new[] { "qingsong", "chengben" })
        {
            var fields = windows.RootElement.GetProperty(product + "/" + dw).GetProperty("columns").EnumerateArray()
                .Select(x => x.GetProperty("name").GetString()!);
            Assert.All(fields, field => Assert.Contains(field, known));
        }
    }

    [Theory]
    [InlineData(InvoiceProduct.Qingsong)]
    [InlineData(InvoiceProduct.Chengben)]
    public void ReviewFixtureIsFullySyntheticAndIncludesAllKnownFields(InvoiceProduct product)
    {
        var state = InvoiceSyntheticFixture.Create(product);
        Assert.Equal(product, state.Product);
        Assert.Equal(2, state.Documents.Length);
        Assert.Empty(state.Journals);
        foreach (var document in state.Documents)
        {
            var row = Assert.Single(document.Rows);
            var schema = document.Key.Direction == InvoiceDirection.Output ? InvoiceColumns.Output : InvoiceColumns.Input;
            Assert.All(schema, field => Assert.True(row.Fields.ContainsKey(field), field));
            Assert.Equal("SYNTHETIC-NOT-A-TAX-ID", row.Text("g_sh"));
            Assert.Equal(JsonValueKind.True, row.Fields["fixture_only"].ValueKind);
        }
    }
}
