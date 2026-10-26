using System.Collections.Immutable;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;

namespace Caiwu.Invoicing.Wpf;

internal static class InvoiceUi
{
    internal static Button Button(string text, Action action)
    {
        var button = new Button { Content = text, Padding = new(8, 4, 8, 4), Margin = new(3), MinHeight = 28 };
        button.Click += (_, _) => Run(action);
        return button;
    }
    internal static void Run(Action action)
    {
        try { action(); }
        catch (Exception ex) when (ex is InvoiceException or System.IO.IOException or System.Text.Json.JsonException
            or FormatException or OverflowException or ArgumentException)
        { MessageBox.Show(ex.Message, "发票", MessageBoxButton.OK, MessageBoxImage.Information); }
    }
    internal static TextBox Text(string text, double width = 110) => new() { Text = text, MinWidth = width, Margin = new(3), VerticalContentAlignment = VerticalAlignment.Center };
    internal static TextBlock Label(string text) => new() { Text = text, VerticalAlignment = VerticalAlignment.Center, Margin = new(3) };
    internal static void Column(DataGrid grid, string header, string path, bool readOnly = false) => grid.Columns.Add(
        new DataGridTextColumn { Header = header, Binding = new Binding(path) { UpdateSourceTrigger = UpdateSourceTrigger.LostFocus }, IsReadOnly = readOnly, MinWidth = 100 });
    internal static DataGrid Grid() => new() { AutoGenerateColumns = false, CanUserAddRows = false, CanUserDeleteRows = false,
        SelectionMode = DataGridSelectionMode.Extended, SelectionUnit = DataGridSelectionUnit.FullRow, Margin = new(4) };
    internal static InvoiceMonth Month(string text)
    {
        if (!DateOnly.TryParseExact(text + "-01", "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out var date)) throw new InvoiceException("period", "年月格式应为 yyyy-MM。");
        return InvoiceMonth.From(date);
    }
    internal static void Key(UIElement target, Key key, ModifierKeys modifiers, Action action) => target.InputBindings.Add(
        new KeyBinding(new ActionCommand(() => Run(action)), key, modifiers));
    private sealed class ActionCommand(Action action) : ICommand
    {
        public event EventHandler? CanExecuteChanged { add { } remove { } }
        public bool CanExecute(object? parameter) => true;
        public void Execute(object? parameter) => action();
    }
}

/// <summary>Relative placement from documented PBU coordinates. These are normalized layout
/// relations, not a claimed PBU/pixel or DPI conversion. Font/actual Windows parity remains untested.</summary>
internal sealed class OriginalFilterStrip : Panel
{
    private readonly List<(UIElement Child, Rect Bounds)> placements = [];
    internal void Place(UIElement child, double x, double y, double width, double height)
    {
        Children.Add(child);
        placements.Add((child, new(x, y - 200, width, height)));
    }
    protected override Size MeasureOverride(Size availableSize)
    {
        double width = double.IsInfinity(availableSize.Width) ? 1280 : availableSize.Width;
        foreach (var p in placements) p.Child.Measure(new(Math.Max(0, width * p.Bounds.Width / 5100), 36));
        return new(width, 76);
    }
    protected override Size ArrangeOverride(Size finalSize)
    {
        foreach (var p in placements)
            p.Child.Arrange(new(p.Bounds.X * finalSize.Width / 5100, p.Bounds.Y * finalSize.Height / 200,
                p.Bounds.Width * finalSize.Width / 5100, p.Bounds.Height * finalSize.Height / 200));
        return finalSize;
    }
}

public sealed class InvoiceParameters
{
    public VoucherAccounts Accounts { get; set; } = new("1122", "6001", "6002", "222101", "1403", "222102", "2202");
    public ImmutableHashSet<string> EligibleStatuses { get; set; } = ImmutableHashSet.Create("正常", "红字");
    public bool SeparateInputTax { get; set; } = true;
}
