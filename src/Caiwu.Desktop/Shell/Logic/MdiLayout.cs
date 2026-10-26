namespace Caiwu.Desktop.Shell;

public enum MdiArrangement { Cascade, Horizontal, Vertical, Fill, Icons }
public readonly record struct SheetBounds(double X, double Y, double Width, double Height);
public static class MdiLayout
{
    public static SheetBounds[] Arrange(MdiArrangement arrangement, int count, double width, double height)
    {
        if (count < 0 || count > 1000) throw new ArgumentOutOfRangeException(nameof(count));
        if (!double.IsFinite(width) || !double.IsFinite(height) || width <= 0 || height <= 0)
            throw new ArgumentOutOfRangeException(nameof(width));
        return Enumerable.Range(0, count).Select(i => arrangement switch
        {
            MdiArrangement.Horizontal => new SheetBounds(0, i * Math.Max(240, height / count), Math.Max(480, width), Math.Max(240, height / count)),
            MdiArrangement.Vertical => new SheetBounds(i * Math.Max(480, width / count), 0, Math.Max(480, width / count), Math.Max(240, height)),
            MdiArrangement.Fill => new SheetBounds(0, 0, Math.Max(480, width), Math.Max(240, height)),
            MdiArrangement.Icons => new SheetBounds((i % Math.Max(1, (int)(width / 220))) * 220, (i / Math.Max(1, (int)(width / 220))) * 36, 216, 34),
            _ => new SheetBounds(i % 8 * 28, i % 8 * 28, Math.Max(480, width - 7 * 28), Math.Max(240, height - 7 * 28))
        }).ToArray();
    }
}
