using System.Windows;

namespace Caiwu.Cashier.Wpf;

/// <summary>
/// Original dw_cn_lr_add field coordinates/edit styles have not been recovered. The shell therefore
/// requires a real host editor, rather than inventing coordinates or shipping a pretend editor.
/// The host must bind all seven original fields and set/validate the returned DocumentInput.
/// </summary>
public interface ICashierDataWindowFactory
{
    ICashierDocumentEditor CreateDocumentEditor(DocumentInput initial, BookDefinition book);
}

public interface ICashierDocumentEditor
{
    FrameworkElement View { get; }
    DocumentInput ReadInput();
}
