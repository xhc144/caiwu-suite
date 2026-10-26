using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Caiwu.Costing.Parity;

namespace Caiwu.Costing.Wpf;

/// <summary>Real module dialogs. The host must supply a ledger-scoped transactional store and authenticated operator.</summary>
public static class InventoryParityDialogs
{
    public static Window CostCalculation(IInventoryBookStore store, Guid bookId, string actor)
    {
        var source = store.Load(bookId);
        var layout = InventoryWindowLayout.Calculate;
        var (window, canvas) = Create(layout, "成本核算");
        var month = new TextBox { Text = $"{source.Period.Year:D4}.{source.Period.Month:D2}", FontSize = 48 };
        var adjust = new CheckBox { Content = layout.Controls.Single(c => c.Id == "cbx_1").Text, FontSize = 43, VerticalContentAlignment = VerticalAlignment.Center };
        foreach (var p in layout.Controls)
        {
            FrameworkElement control = p.Id switch
            {
                "em_1" => month,
                "cbx_1" => adjust,
                "cb_1" => Button("确定", () => Execute(window, () =>
                {
                    if (month.Text != $"{source.Period.Year:D4}.{source.Period.Month:D2}")
                        throw new CostingValidationException("本窗口只核算当前账册期间，请重取对应期间。");
                    var next = InventoryWorkflow.Calculate(source, adjust.IsChecked == true, actor, source.Revision);
                    if (!store.TryCommit(source.Revision, next)) throw new CostingConcurrencyException("数据已变化，请关闭窗口并重取。");
                    MessageBox.Show(window, "成本核算完毕，本月数据不能再输入！", "成本核算");
                    window.Close();
                })),
                "cb_2" => Button("取消", window.Close),
                _ => Label(p.Text)
            };
            Place(canvas, p, control);
        }
        return window;
    }
    public static Window CancelCostCalculation(IInventoryBookStore store, Guid bookId, string actor)
    {
        var source = store.Load(bookId);
        var layout = InventoryWindowLayout.Cancel;
        var (window, canvas) = Create(layout, "反结账");
        foreach (var p in layout.Controls)
        {
            FrameworkElement control = p.Id switch
            {
                "cb_1" => Button("确定", () => Execute(window, () =>
                {
                    var next = InventoryWorkflow.CancelCalculation(source, actor, source.Revision);
                    if (!store.TryCommit(source.Revision, next)) throw new CostingConcurrencyException("数据已变化，请关闭窗口并重取。");
                    window.Close();
                })),
                "cb_2" => Button("取消", window.Close),
                "st_jzyf" => Label($"{source.Period.Year:D4}.{source.Period.Month:D2}"),
                _ => Label(p.Text)
            };
            Place(canvas, p, control);
        }
        return window;
    }
    public static Window WarehouseSelection(Action<WarehouseKind> selected)
    {
        ArgumentNullException.ThrowIfNull(selected);
        var layout = InventoryWindowLayout.SelectWarehouse;
        var (window, canvas) = Create(layout, "请选择仓库");
        var warehouse = new RadioButton { Content = "仓库", GroupName = "warehouse", FontSize = 48 };
        var workshop = new RadioButton { Content = "车间", GroupName = "warehouse", FontSize = 48 };
        // No undocumented default selection; caller must make the choice explicitly.
        foreach (var p in layout.Controls)
        {
            FrameworkElement control = p.Id switch
            {
                "rb_1" => warehouse,
                "rb_2" => workshop,
                _ => Button("确定", () => Execute(window, () =>
                {
                    if (warehouse.IsChecked != true && workshop.IsChecked != true) throw new CostingValidationException("请选择仓库或车间。");
                    selected(warehouse.IsChecked == true ? WarehouseKind.Warehouse : WarehouseKind.Workshop); window.Close();
                }))
            };
            Place(canvas, p, control);
        }
        return window;
    }
    private static (Window Window, Canvas Canvas) Create(InventoryDialogLayout layout, string title)
    {
        var canvas = new Canvas { Width = (double)layout.Width, Height = (double)layout.Height, Background = Brushes.WhiteSmoke };
        var window = new Window
        {
            Title = title, Width = 700, SizeToContent = SizeToContent.Height, ResizeMode = ResizeMode.CanResize,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Content = new Viewbox { Stretch = Stretch.Uniform, Child = canvas }
        };
        AutomationProperties.SetAutomationId(window, layout.ObjectName);
        window.InputBindings.Add(new KeyBinding(new CloseCommand(window), new KeyGesture(Key.F4, ModifierKeys.Control)));
        return (window, canvas);
    }
    private static FrameworkElement Label(string? text) => new TextBlock { Text = text ?? "", FontSize = 43, VerticalAlignment = VerticalAlignment.Center };
    private static Button Button(string text, Action action)
    {
        var b = new Button { Content = text, FontSize = 48 }; b.Click += (_, _) => action(); return b;
    }
    private static void Place(Canvas canvas, InventoryControlPlacement p, FrameworkElement control)
    {
        AutomationProperties.SetAutomationId(control, p.Id);
        control.Width = (double)p.Width; control.Height = (double)p.Height;
        Canvas.SetLeft(control, (double)p.X); Canvas.SetTop(control, (double)p.Y); canvas.Children.Add(control);
    }
    private static void Execute(Window owner, Action action)
    {
        try { action(); }
        catch (Exception ex) when (ex is CostingValidationException or CostingConcurrencyException or System.IO.IOException)
        { MessageBox.Show(owner, ex.Message, owner.Title, MessageBoxButton.OK, MessageBoxImage.Warning); }
    }
    private sealed class CloseCommand(Window window) : ICommand
    {
        public event EventHandler? CanExecuteChanged { add { } remove { } }
        public bool CanExecute(object? parameter) => true;
        public void Execute(object? parameter) => window.Close();
    }
}
