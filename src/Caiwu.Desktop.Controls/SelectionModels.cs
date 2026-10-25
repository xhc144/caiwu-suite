using System.Text;
using Caiwu.Contracts;

namespace Caiwu.Desktop.Controls;

public sealed class SelectionResult<T> where T : class
{
    public bool Accepted { get; }
    public T? Value { get; }
    private SelectionResult(bool accepted, T? value) { Accepted = accepted; Value = value; }
    public static SelectionResult<T> Cancelled { get; } = new(false, null);
    public static SelectionResult<T> Accept(T value)
    {
        ArgumentNullException.ThrowIfNull(value);
        return new(true, value);
    }
}

public sealed record AccountChoice(Account Account, bool IsSelectable, string SelectionHint)
{
    public string Code => Account.Code;
    public string Name => Account.Name;
}

public sealed class AccountTreeNode
{
    public AccountChoice Choice { get; }
    public IReadOnlyList<AccountTreeNode> Children { get; }
    internal AccountTreeNode(AccountChoice choice, IEnumerable<AccountTreeNode> children)
    { Choice = choice; Children = Array.AsReadOnly(children.ToArray()); }
}

public sealed record SummaryLibraryItem(string Id, string Category, string Text);

/// <summary>Optional host-owned read source. This library supplies no database, persistence or sample production service.</summary>
public interface ISummaryLibrarySource
{
    IReadOnlyList<SummaryLibraryItem> GetItems();
}

internal static class PickerSearch
{
    internal static string[] Terms(string? query) => (query ?? "").Normalize(NormalizationForm.FormKC)
        .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
    internal static bool Matches(string[] terms, params string[] fields)
    {
        var normalized = fields.Select(f => f.Normalize(NormalizationForm.FormKC)).ToArray();
        return terms.All(term => normalized.Any(field => field.Contains(term, StringComparison.OrdinalIgnoreCase)));
    }
}
