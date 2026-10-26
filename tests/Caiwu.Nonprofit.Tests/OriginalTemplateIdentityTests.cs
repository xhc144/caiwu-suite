using System.Text.Json;
using Caiwu.Nonprofit.Writable;

namespace Caiwu.Nonprofit.Tests;

public sealed class OriginalTemplateIdentityTests
{
    [Fact]
    public void PriorityIdentityAndOrderMatchExistingOriginalAnalysisWithoutInventingTheOtherTemplates()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "docs/original-analysis/json/tables.json"))) root = root.Parent;
        Assert.NotNull(root);
        using var json = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(root.FullName, "docs/original-analysis/json/tables.json")));
        var originals = json.RootElement.GetProperty("templates");
        Assert.Equal(OriginalRegimeTemplates.OriginalVisibleTemplateCount, originals.EnumerateObject().Count());
        Assert.Equal(new[] { "a01", "a02", "a05", "a52", "a54" }, OriginalRegimeTemplates.Priority.Select(t => t.Id));
        foreach (var template in OriginalRegimeTemplates.Priority)
        {
            var source = originals.GetProperty(template.Id);
            Assert.Equal(source.GetProperty("name").GetString(), template.Name);
            Assert.Equal(source.GetProperty("order").GetInt32(), template.DisplayOrder);
            Assert.Contains("未取得", template.ContentStatus);
        }
        Assert.Null(OriginalRegimeTemplates.Priority.Single(t => t.Id == "a54").CodeLengths);
        Assert.Equal(new[] {4,3,3}, OriginalRegimeTemplates.Priority.Single(t => t.Id == "a01").CodeLengths);
        Assert.Equal(new[] {4,2,2}, OriginalRegimeTemplates.Priority.Single(t => t.Id == "a02").CodeLengths);
    }
}
