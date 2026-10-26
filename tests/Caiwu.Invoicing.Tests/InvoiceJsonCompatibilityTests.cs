using System.Text.Json;
using System.Text.Json.Nodes;
using Caiwu.Invoicing;

namespace Caiwu.Invoicing.Tests;

public sealed class InvoiceJsonCompatibilityTests
{
    [Theory]
    [InlineData("workspace")]
    [InlineData("document")]
    [InlineData("row")]
    public void UnknownStructureStopsFileReadAndReplacementWithoutChangingTheFile(string level)
    {
        var directory = Path.Combine(Path.GetTempPath(), "caiwu-json-compat-" + Guid.NewGuid());
        Directory.CreateDirectory(directory);
        try
        {
            var state = InvoiceSyntheticFixture.Create(InvoiceProduct.Qingsong);
            var path = Path.Combine(directory, "fixture.invoice-synthetic.json");
            var store = new SyntheticJsonInvoiceStore(path);
            store.Create(state);
            var node = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
            var target = level switch
            {
                "workspace" => node,
                "document" => node["Documents"]![0]!.AsObject(),
                "row" => node["Documents"]![0]!["Rows"]![0]!.AsObject(),
                _ => throw new ArgumentOutOfRangeException(nameof(level))
            };
            target["FutureField"] = JsonNode.Parse("""{"Nested":[null,{"Precise":9007199254740993.1234567890123456789}]}""");
            File.WriteAllText(path, node.ToJsonString());
            var before = File.ReadAllBytes(path);
            Assert.Throws<JsonException>(() => store.Read());
            Assert.Throws<JsonException>(() => store.TrySave(state.Revision, state with { Revision = state.Revision + 1 }));
            Assert.Equal(before, File.ReadAllBytes(path));
            Assert.Empty(Directory.GetFiles(directory, "*.tmp"));
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public void UnknownTransferStructureIsRejectedBeforeImport()
    {
        var state = InvoiceSyntheticFixture.Create(InvoiceProduct.Qingsong);
        var invoice = state.Documents[0];
        var transfer = new InvoiceTransfer(1, state.BookId, state.Product,
            [new(invoice.Key.Direction, invoice.Key.Kind, invoice.Rows)]);
        var node = JsonNode.Parse(InvoiceJson.Serialize(transfer))!;
        node["Invoices"]![0]!["FutureField"] = null;
        Assert.Throws<JsonException>(() => InvoiceJson.Deserialize<InvoiceTransfer>(node.ToJsonString()));
    }
}
