using System.Globalization;
using System.Text.Json;
using Caiwu.Costing.Parity;

namespace Caiwu.Costing.Tests;

public sealed class InventoryLayoutTests
{
    [Fact]
    public void KnownDialogRectanglesAndCaptionsMatchOriginalAnalysisWithoutPixelMultiplier()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "docs/original-analysis/json/windows.json"))) root = root.Parent;
        Assert.NotNull(root);
        using var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(root.FullName, "docs/original-analysis/json/windows.json")));
        var windows = json.RootElement.GetProperty("chengben/main");
        foreach (var layout in new[] { InventoryWindowLayout.Calculate, InventoryWindowLayout.Cancel, InventoryWindowLayout.SelectWarehouse })
        {
            var original = windows.GetProperty(layout.ObjectName);
            var controls = original.GetProperty("controls").EnumerateArray().ToDictionary(c => c.GetProperty("name").GetString()!);
            foreach (var p in layout.Controls)
            {
                var props = controls[p.Id].GetProperty("props");
                Assert.Equal(p.X, decimal.Parse(props.GetProperty("x").GetString()!, CultureInfo.InvariantCulture));
                Assert.Equal(p.Y, decimal.Parse(props.GetProperty("y").GetString()!, CultureInfo.InvariantCulture));
                Assert.Equal(p.Width, decimal.Parse(props.GetProperty("width").GetString()!, CultureInfo.InvariantCulture));
                Assert.Equal(p.Height, decimal.Parse(props.GetProperty("height").GetString()!, CultureInfo.InvariantCulture));
                if (p.Text is not null) Assert.Equal(p.Text, props.GetProperty("text").GetString());
            }
        }
    }
}
