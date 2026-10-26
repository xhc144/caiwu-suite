using System.Windows;
using System.Windows.Controls;

namespace Caiwu.Cashier.Wpf;

/// <summary>
/// Preserves known window-level PBU relative positions. It does not assert a PBU/pixel conversion.
/// Dropdown design height describes its expanded list, so closed controls use their desired height.
/// Internal DataWindow field coordinates are unknown and must be supplied separately by the host.
/// </summary>
internal sealed class OriginalLayoutPanel(double sourceWidth, double sourceHeight) : Panel
{
    private readonly Dictionary<UIElement, (Rect Bounds, bool AutoHeight)> positions = [];
    public void Put(UIElement child, double x, double y, double width, double height, bool autoHeight = false)
    {
        positions.Add(child, (new Rect(x, y, width, height), autoHeight)); Children.Add(child);
    }
    protected override Size MeasureOverride(Size availableSize)
    {
        var size = new Size(double.IsInfinity(availableSize.Width) ? 1000 : availableSize.Width,
            double.IsInfinity(availableSize.Height) ? 650 : availableSize.Height);
        foreach (UIElement child in Children)
        {
            var p = positions[child];
            child.Measure(new Size(p.Bounds.Width / sourceWidth * size.Width,
                p.AutoHeight ? double.PositiveInfinity : p.Bounds.Height / sourceHeight * size.Height));
        }
        return size;
    }
    protected override Size ArrangeOverride(Size finalSize)
    {
        foreach (UIElement child in Children)
        {
            var p = positions[child];
            child.Arrange(new Rect(p.Bounds.X / sourceWidth * finalSize.Width, p.Bounds.Y / sourceHeight * finalSize.Height,
                p.Bounds.Width / sourceWidth * finalSize.Width,
                p.AutoHeight ? child.DesiredSize.Height : p.Bounds.Height / sourceHeight * finalSize.Height));
        }
        return finalSize;
    }
}
