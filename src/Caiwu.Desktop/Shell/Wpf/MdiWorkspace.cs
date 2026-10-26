using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;

namespace Caiwu.Desktop.Shell.Wpf;

/// <summary>Coexisting document sheets; no top-level business navigation tabs.</summary>
public sealed class MdiWorkspace : ScrollViewer
{
    private readonly Canvas surface = new() { Background = new SolidColorBrush(Color.FromRgb(229, 235, 242)) };
    private readonly Dictionary<string, Sheet> sheets = [];
    private int front;
    public string? ActiveId { get; private set; }
    public event Action<string?>? ActiveChanged;
    public Func<string, bool>? CanClose { get; set; }
    public IReadOnlyList<(string Id, string Title)> OpenSheets => sheets.Values.Select(s => (s.Id, s.Title)).ToArray();

    public MdiWorkspace()
    {
        Content = surface; HorizontalScrollBarVisibility = VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        SizeChanged += (_, _) => Extent();
    }

    public void Open(string id, string title, UIElement content)
    {
        if (sheets.ContainsKey(id)) { Activate(id); return; }
        var child = new Sheet(id, title, content);
        sheets.Add(id, child); surface.Children.Add(child.Frame);
        child.Frame.PreviewMouseDown += (_, _) => Activate(id, restore: false);
        child.Move.DragDelta += (_, e) =>
        {
            Canvas.SetLeft(child.Frame, Math.Max(0, Canvas.GetLeft(child.Frame) + e.HorizontalChange));
            Canvas.SetTop(child.Frame, Math.Max(0, Canvas.GetTop(child.Frame) + e.VerticalChange)); Extent();
        };
        child.Resize.DragDelta += (_, e) =>
        {
            if (child.Minimized) return;
            child.Frame.Width = Math.Max(480, child.Frame.Width + e.HorizontalChange);
            child.Frame.Height = Math.Max(240, child.Frame.Height + e.VerticalChange); Extent();
        };
        child.Close.Click += (_, _) => Close(id);
        child.Minimize.Click += (_, _) =>
        {
            if (child.Minimized) { Restore(child); return; }
            child.BeforeMinimize = Bounds(child); child.Minimized = true; child.Body.Visibility = Visibility.Collapsed;
            child.Resize.Visibility = Visibility.Collapsed; child.Frame.Height = 34; child.Frame.Width = 216; Extent();
        };
        child.Maximize.Click += (_, _) =>
        {
            if (child.Minimized) Restore(child);
            if (child.Maximized) { Apply(child, child.Saved); child.Maximized = false; }
            else { child.Saved = Bounds(child); Apply(child, MdiLayout.Arrange(MdiArrangement.Fill, 1, AvailableWidth, AvailableHeight)[0]); child.Maximized = true; }
            Extent();
        };
        Apply(child, new(sheets.Count % 8 * 24, sheets.Count % 8 * 24, Math.Max(700, AvailableWidth - 65), Math.Max(400, AvailableHeight - 65)));
        Activate(id); Extent();
    }

    public void Activate(string id) => Activate(id, restore: true);
    private void Activate(string id, bool restore)
    {
        if (!sheets.TryGetValue(id, out var sheet)) return;
        if (sheet.Minimized && restore) Restore(sheet);
        Panel.SetZIndex(sheet.Frame, ++front); ActiveId = id;
        foreach (var other in sheets.Values)
            other.Caption.Background = new SolidColorBrush(other == sheet ? Color.FromRgb(34, 79, 119) : Color.FromRgb(103, 121, 140));
        ActiveChanged?.Invoke(id);
    }
    public bool Close(string id)
    {
        if (!sheets.TryGetValue(id, out var sheet)) return true;
        if (CanClose?.Invoke(id) == false) return false;
        surface.Children.Remove(sheet.Frame); sheet.Body.Child = null; sheets.Remove(id);
        if (ActiveId == id)
        {
            ActiveId = null;
            var next = sheets.Values.OrderByDescending(s => Panel.GetZIndex(s.Frame)).FirstOrDefault();
            if (next is not null) Activate(next.Id); else ActiveChanged?.Invoke(null);
        }
        Extent(); return true;
    }
    public bool CloseAll()
    {
        foreach (var id in sheets.Keys.ToArray()) if (!Close(id)) return false;
        return true;
    }
    public void Arrange(MdiArrangement arrangement)
    {
        var targets = sheets.Values.Where(s => arrangement == MdiArrangement.Icons ? s.Minimized : !s.Minimized).ToArray();
        var bounds = MdiLayout.Arrange(arrangement, targets.Length, AvailableWidth, AvailableHeight);
        for (var i = 0; i < targets.Length; i++)
        {
            var b = bounds[i];
            if (arrangement == MdiArrangement.Icons) b = b with { Y = Math.Max(0, AvailableHeight - b.Y - b.Height) };
            if (arrangement == MdiArrangement.Fill && !targets[i].Maximized) targets[i].Saved = Bounds(targets[i]);
            Apply(targets[i], b); targets[i].Maximized = arrangement == MdiArrangement.Fill;
        }
        Extent();
    }
    private double AvailableWidth => Math.Max(480, ActualWidth - 20);
    private double AvailableHeight => Math.Max(240, ActualHeight - 20);
    private static SheetBounds Bounds(Sheet s) => new(Canvas.GetLeft(s.Frame), Canvas.GetTop(s.Frame), s.Frame.Width, s.Frame.Height);
    private static void Apply(Sheet s, SheetBounds b) { Canvas.SetLeft(s.Frame, b.X); Canvas.SetTop(s.Frame, b.Y); s.Frame.Width = b.Width; s.Frame.Height = b.Height; }
    private void Restore(Sheet sheet)
    { sheet.Minimized = false; sheet.Body.Visibility = Visibility.Visible; sheet.Resize.Visibility = Visibility.Visible; Apply(sheet, sheet.BeforeMinimize); Extent(); }
    private void Extent()
    {
        surface.Width = Math.Max(AvailableWidth, sheets.Values.Select(s => Canvas.GetLeft(s.Frame) + s.Frame.Width).DefaultIfEmpty(0).Max());
        surface.Height = Math.Max(AvailableHeight, sheets.Values.Select(s => Canvas.GetTop(s.Frame) + s.Frame.Height).DefaultIfEmpty(0).Max());
    }
    private sealed class Sheet
    {
        public string Id { get; }
        public string Title { get; }
        public Border Frame { get; } = new() { BorderBrush = Brushes.SlateGray, BorderThickness = new Thickness(1), Background = Brushes.White };
        public DockPanel Caption { get; } = new() { Height = 32, LastChildFill = true };
        public Border Body { get; } = new();
        public Thumb Move { get; } = new() { Cursor = Cursors.SizeAll, Background = Brushes.Transparent };
        public Thumb Resize { get; } = new() { Width = 15, Height = 15, Cursor = Cursors.SizeNWSE, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Bottom };
        public Button Close { get; } = CaptionButton("×", "关闭当前窗口");
        public Button Minimize { get; } = CaptionButton("—", "最小化 / 还原");
        public Button Maximize { get; } = CaptionButton("□", "铺满 / 还原");
        public bool Minimized, Maximized;
        public SheetBounds Saved, BeforeMinimize;
        public Sheet(string id, string title, UIElement content)
        {
            Id = id; Title = title; Body.Child = content;
            var root = new DockPanel(); Frame.Child = root;
            DockPanel.SetDock(Caption, Dock.Top); root.Children.Add(Caption);
            var controls = new StackPanel { Orientation = Orientation.Horizontal }; controls.Children.Add(Minimize); controls.Children.Add(Maximize); controls.Children.Add(Close);
            DockPanel.SetDock(controls, Dock.Right); Caption.Children.Add(controls);
            var drag = new Grid();
            var template = new ControlTemplate(typeof(Thumb)); var background = new FrameworkElementFactory(typeof(Border)); background.SetValue(Border.BackgroundProperty, Brushes.Transparent); template.VisualTree = background;
            Move.Template = template; drag.Children.Add(Move);
            drag.Children.Add(new TextBlock { Text = title, Foreground = Brushes.White, Margin = new Thickness(10, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center, IsHitTestVisible = false });
            Caption.Children.Add(drag);
            var body = new Grid(); body.Children.Add(Body); body.Children.Add(Resize); root.Children.Add(body);
        }
        private static Button CaptionButton(string label, string name)
        {
            var button = new Button { Content = label, ToolTip = name, Padding = new Thickness(0), Margin = new Thickness(1), Width = 30, Height = 28, MinWidth = 0, MinHeight = 0 };
            System.Windows.Automation.AutomationProperties.SetName(button, name); return button;
        }
    }
}
