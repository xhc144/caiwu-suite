using System.Windows;
using System.Windows.Controls;

namespace Caiwu.Operators.Wpf;

internal static class DialogSupport
{
    // Inherit host implicit styles and Fluent templates; no local default styles, colors or font overrides.
    internal static void Error(TextBlock target, Exception error) => target.Text = error switch
    {
        OperatorException => error.Message,
        _ => "操作未完成，请检查用户数据目录或联系管理员。"
    };
    internal static void Prepare(Window window)
    {
        // WPF implicit styles use the concrete class key. Fall back to the host's Window
        // style dynamically, while preserving any host style for this exact dialog class.
        if (window.TryFindResource(window.GetType()) is not Style)
            window.SetResourceReference(FrameworkElement.StyleProperty, typeof(Window));
        window.WindowStartupLocation = WindowStartupLocation.CenterOwner;
        window.ShowInTaskbar = false;
    }
}
