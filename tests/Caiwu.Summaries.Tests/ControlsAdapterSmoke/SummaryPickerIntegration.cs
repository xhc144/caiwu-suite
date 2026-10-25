using System.Windows;
using System.Windows.Controls;
using Caiwu.Desktop.Controls;
using Caiwu.Summaries;

namespace Caiwu.Summaries.ControlsAdapterSmoke;

/// <summary>Compile-checks the exact Controls bf75d563 API. Host-owned example; no Desktop code is changed.</summary>
public static class SummaryPickerIntegration
{
    public static SelectionResult<SummaryLibraryItem> PickInto(Window owner, TextBox summaryEditor,
        ISummaryCatalog catalog, string? initialItemId = null)
    {
        owner.Dispatcher.VerifyAccess();
        var items = catalog.Read().ToPickerItems((id, category, text) => new SummaryLibraryItem(id, category, text));
        var result = SelectionDialogs.PickSummary(owner, items, initialItemId, summaryEditor);
        if (result.Accepted) summaryEditor.Text = result.Value!.Text;
        return result;
    }
}
