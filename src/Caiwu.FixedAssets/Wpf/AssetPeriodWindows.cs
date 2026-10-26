using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;

namespace Caiwu.FixedAssets.Wpf;

/// <summary>
/// Uses source PBU as an abstract coordinate system in a Viewbox; no pixel/PBU multiplier is asserted.
/// Known container/control bounds are preserved. No original executable/resource is loaded.
/// </summary>
public abstract class AssetOriginalModal : Window
{
    protected readonly Canvas Surface;
    protected AssetOriginalModal(string objectName, string title, double sourceWidth, double sourceHeight)
    {
        Title = title; Width = sourceWidth / 3 + 30; Height = sourceHeight / 3 + 60;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        ResizeMode = ResizeMode.CanResize; MinWidth = 380; MinHeight = 260;
        AutomationProperties.SetAutomationId(this, objectName);
        Surface = new Canvas { Width = sourceWidth, Height = sourceHeight, Background = Brushes.White };
        Content = new Viewbox { Stretch = Stretch.Uniform, Child = Surface };
    }
    protected T Put<T>(T element, string name, double x, double y, double width, double height) where T : FrameworkElement
    {
        AutomationProperties.SetAutomationId(element, name);
        element.Name = name; element.Width = width; element.Height = height;
        Canvas.SetLeft(element, x); Canvas.SetTop(element, y); Surface.Children.Add(element);
        return element;
    }
    protected void Label(string name, string text, double x, double y, double width, double height) =>
        Put(new TextBlock { Text = text, FontSize = 46, VerticalAlignment = VerticalAlignment.Center }, name, x, y, width, height);
    protected Button Action(string name, string caption, double x, double y, double width, double height, Action action)
    {
        var button = Put(new Button { Content = caption, FontSize = 46 }, name, x, y, width, height);
        button.Click += (_, _) =>
        {
            try { action(); }
            catch (Exception ex) when (ex is AssetRuleException or System.IO.IOException or FormatException or OverflowException)
            { MessageBox.Show(this, ex.Message, Title, MessageBoxButton.OK, MessageBoxImage.Information); }
        };
        return button;
    }
}

public sealed class AssetDepreciationWindow : AssetOriginalModal
{
    public AssetDepreciationBatch? Result { get; private set; }
    /// <param name="workloads">Explicit inputs for the chosen period. Missing workloads fail visibly without mutation.</param>
    public AssetDepreciationWindow(AssetBookService service, IReadOnlyDictionary<Guid, decimal>? workloads = null)
        : base("w_zjjs", "计提折旧", 1573, 848)
    {
        var snapshot = service.Read(); var period = snapshot.NextDepreciationPeriod;
        Label("st_4", "提  示", 425, 76, 782, 168);
        Label("st_2", "本模块对", 219, 352, 407, 88);
        Label("st_1", period.ToString(), 645, 352, 366, 72);
        Label("st_3", "计提折旧", 1024, 352, 375, 84);
        var ok = Action("cb_1", "确定", 443, 576, 247, 108, () =>
        {
            Result = service.CalculateDepreciation(snapshot.Revision, period, workloads); DialogResult = true;
        });
        ok.IsDefault = true;
        var cancel = Action("cb_2", "取消", 928, 576, 247, 108, () => DialogResult = false); cancel.IsCancel = true;
    }
}

public sealed class AssetCancelDepreciationWindow : AssetOriginalModal
{
    public AssetDepreciationBatch? Result { get; private set; }
    public AssetCancelDepreciationWindow(AssetBookService service) : base("w_zc_qxfz", "取消折旧", 1449, 724)
    {
        var snapshot = service.Read();
        var batch = snapshot.Batches.Where(x => !x.Cancelled).OrderByDescending(x => x.Period).FirstOrDefault();
        Label("st_4", "提  示", 425, 48, 567, 124);
        Label("st_2", "本功能将取消", 59, 256, 750, 88);
        Label("st_jzyf", batch?.Period.ToString() ?? "", 133, 360, 375, 88);
        Label("st_1", "月的固定资产折旧信息", 517, 360, 814, 88);
        var ok = Action("cb_1", "确定", 315, 492, 247, 100, () =>
        {
            if (batch is null) throw new AssetRuleException("batch-missing", "没有可取消的折旧批次。");
            Result = service.CancelDepreciation(snapshot.Revision, batch.Id); DialogResult = true;
        });
        ok.IsDefault = true;
        var cancel = Action("cb_2", "取消", 745, 492, 247, 100, () => DialogResult = false); cancel.IsCancel = true;
    }
}
