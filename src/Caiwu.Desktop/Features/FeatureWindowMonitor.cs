using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;

namespace Caiwu.Desktop.Features;

/// <summary>Apply session invalidation to the owner's existing BookCopyWindow without modifying its source.</summary>
internal sealed class FeatureWindowMonitor : IDisposable
{
    private readonly Window window;
    private readonly FeatureSessionBinding binding;
    private readonly DispatcherTimer timer;
    public FeatureWindowMonitor(Window window, FeatureSessionBinding binding)
    {
        this.window = window; this.binding = binding;
        timer = new(DispatcherPriority.Normal, window.Dispatcher) { Interval = TimeSpan.FromMilliseconds(100) };
        timer.Tick += Tick; window.PreviewKeyDown += Key; window.PreviewMouseDown += Mouse;
        window.Closed += Closed; timer.Start();
    }
    private async void Tick(object? sender, EventArgs e) { await binding.Authentication.CheckAsync(); Check(); }
    private bool Check()
    {
        if (binding.IsCurrent) return true;
        if (window.Content is UIElement content) content.IsEnabled = false;
        window.Title = "账套会话已失效 · 请关闭后重新打开（输入保留）";
        return false;
    }
    private void Key(object sender, KeyEventArgs e) { if (!Check() && e.Key != System.Windows.Input.Key.Escape) e.Handled = true; }
    private void Mouse(object sender, MouseButtonEventArgs e) { if (!Check()) e.Handled = true; }
    private void Closed(object? sender, EventArgs e) => Dispose();
    public void Dispose()
    { timer.Stop(); window.PreviewKeyDown -= Key; window.PreviewMouseDown -= Mouse; window.Closed -= Closed; }
}
