using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using System.Windows.Automation;

namespace Caiwu.Desktop.Features;

/// <summary>Retains visible input after invalidation; never silently rebinds to another file.</summary>
public class SessionFeatureWindow : Window
{
    private readonly DispatcherTimer timer;
    protected FeatureSessionBinding Binding { get; }
    protected DockPanel Root { get; } = new() { Margin = new(16) };
    protected DockPanel Body { get; } = new();
    protected TextBlock Status { get; } = new() { TextWrapping = TextWrapping.Wrap, Margin = new(0, 8, 0, 8) };

    public SessionFeatureWindow(FeatureSessionBinding binding)
    {
        Binding = binding;
        AutomationProperties.SetAutomationId(Status, "Feature.Status");
        AutomationProperties.SetAutomationId(Body, "Feature.Body");
        Width = 1060; Height = 700; MinWidth = 760; MinHeight = 500;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        if (Application.Current?.TryFindResource(typeof(Window)) is Style style) Style = style;
        DockPanel.SetDock(Status, Dock.Top); Root.Children.Add(Status); Root.Children.Add(Body); Content = Root;
        timer = new(DispatcherPriority.Normal, Dispatcher) { Interval = TimeSpan.FromMilliseconds(100) };
        timer.Tick += (_, _) => CheckSession();
        Loaded += (_, _) => { CheckSession(); timer.Start(); };
        Closed += (_, _) => timer.Stop();
    }

    protected bool CheckSession()
    {
        if (Binding.IsCurrent) return true;
        Body.IsEnabled = false;
        Status.Text = "账套会话或来源快照已变化。此窗口已失效，输入仍保留；请关闭后重新打开核对。";
        return false;
    }

    internal DockPanel BodyForFeature() => Body;

    protected override void OnPreviewKeyDown(KeyEventArgs e)
    {
        if (e.Key == Key.Escape) { e.Handled = true; Close(); return; }
        if (!CheckSession()) e.Handled = true;
        base.OnPreviewKeyDown(e);
    }
    protected override void OnPreviewMouseDown(MouseButtonEventArgs e)
    { if (!CheckSession()) e.Handled = true; base.OnPreviewMouseDown(e); }
}
