using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Documents;
using Caiwu.ReportDesigner.Cells;

namespace Caiwu.ReportDesigner.Wpf.Cells;

/// <summary>Coordinates below are existing PBU evidence used as a proportional design surface, not a PBU-to-pixel assertion.</summary>
internal static class CellFormatDialogs
{
    private static (Window Window, Canvas Canvas) Dialog(string title, double width, double height, Window? owner)
    {
        var canvas = new Canvas { Width = width, Height = height };
        TextElement.SetFontSize(canvas, 44);
        var window = new Window { Title = title, Width = 580, Height = 360, MinWidth = 440, MinHeight = 280,
            Owner = owner, WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Content = new Viewbox { Stretch = Stretch.Uniform, Child = canvas } };
        return (window, canvas);
    }
    private static T Put<T>(Canvas canvas, T element, double x, double y, double width, double height) where T : FrameworkElement
    { element.Width = width; element.Height = height; Canvas.SetLeft(element, x); Canvas.SetTop(element, y); canvas.Children.Add(element); return element; }
    internal static (decimal Value, decimal Default, bool UseDefault)? Dimension(bool row, decimal value, decimal defaultValue, bool useDefault, Window? owner)
    {
        var (window, canvas) = Dialog(row ? "行高" : "列宽设置", row ? 1426 : 1376, row ? 696 : 644, owner);
        Put(canvas, new GroupBox { Header = row ? "缺省高度" : "缺省宽度" }, row ? 41 : 37, row ? 160 : 156, row ? 933 : 882, row ? 392 : 332);
        Put(canvas, new TextBlock { Text = row ? "高　　度：" : "宽　　度：" }, row ? 87 : 59, 52, 361, 80);
        var entry = Put(canvas, new TextBox { Text = value.ToString(CultureInfo.InvariantCulture) }, row ? 407 : 425, row ? 48 : 40, row ? 279 : 293, 88);
        var check = Put(canvas, new CheckBox { Content = row ? "使用缺省高度" : "使用缺省宽度", IsChecked = useDefault }, row ? 142 : 201, row ? 252 : 224, row ? 448 : 430, 84);
        Put(canvas, new TextBlock { Text = "缺省值：" }, row ? 151 : 128, row ? 360 : 316, 293, 72);
        var defaults = Put(canvas, new TextBox { Text = defaultValue.ToString(CultureInfo.InvariantCulture) }, row ? 416 : 425, row ? 352 : 312, row ? 279 : 293, row ? 88 : 84);
        Put(canvas, new TextBlock { Text = row ? "单位：英寸" : "单位：字符" }, 210, row ? 456 : 396, row ? 434 : 379, 72);
        var ok = Put(canvas, new Button { Content = "确定", IsDefault = true }, row ? 1056 : 992, row ? 288 : 224, row ? 315 : 306, 108);
        var cancel = Put(canvas, new Button { Content = "取消", IsCancel = true }, row ? 1051 : 987, row ? 416 : 360, row ? 315 : 306, 108);
        (decimal, decimal, bool)? answer = null;
        ok.Click += (_, _) => {
            if (!decimal.TryParse(entry.Text, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var a) ||
                !decimal.TryParse(defaults.Text, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var b) ||
                a < (row ? .05m : 1m) || b < (row ? .05m : 1m) || a > (row ? 10m : 255m) || b > (row ? 10m : 255m))
            { MessageBox.Show(window, row ? "行高须为0.05–10英寸。" : "列宽须为1–255字符。"); return; }
            answer = (a, b, check.IsChecked == true); window.DialogResult = true;
        };
        cancel.Click += (_, _) => window.DialogResult = false;
        window.ShowDialog(); return answer;
    }
    internal static CellFormat? Alignment(CellFormat format, Window? owner)
    {
        var (window, canvas) = Dialog("排列格式", 1179, 908, owner);
        Put(canvas, new GroupBox { Header = "水平对齐" }, 37, 28, 539, 728);
        Put(canvas, new GroupBox { Header = "垂直对齐" }, 613, 28, 494, 332);
        var horizontal = new[] { "普通", "靠左", "置中", "靠右" }.Select((s, i) => Put(canvas,
            new RadioButton { Content = s, GroupName = "h", IsChecked = (int)format.Horizontal == i }, 114, 144 + 84 * i, i == 0 ? 315 : 247, 72)).ToArray();
        var vertical = new[] { "靠上", "置中", "靠下" }.Select((s, i) => Put(canvas,
            new RadioButton { Content = s, GroupName = "v", IsChecked = (int)format.Vertical == i }, 713, 96 + 84 * i, 247, 72)).ToArray();
        var wrap = Put(canvas, new CheckBox { Content = "自动换行", IsChecked = format.Wrap }, 709, 384, 389, 72);
        var ok = Put(canvas, new Button { Content = "确定", IsDefault = true }, 686, 496, 389, 100);
        Put(canvas, new Button { Content = "取消", IsCancel = true }, 686, 640, 389, 96);
        CellFormat? answer = null;
        ok.Click += (_, _) => { answer = format with { Horizontal = (CellHorizontalAlignment)Array.FindIndex(horizontal, x => x.IsChecked == true), Vertical = (CellVerticalAlignment)Array.FindIndex(vertical, x => x.IsChecked == true), Wrap = wrap.IsChecked == true }; window.DialogResult = true; };
        window.ShowDialog(); return answer;
    }
    // Original u_f_num delegates to OLE; no source coordinates exist. This adaptive dialog makes no original coordinate claim.
    internal static CellFormat? Number(CellFormat format, Window? owner)
    {
        var panel = new StackPanel { Margin = new Thickness(16) };
        var window = new Window { Title = "数字格式", Owner = owner, WindowStartupLocation = WindowStartupLocation.CenterOwner,
            SizeToContent = SizeToContent.WidthAndHeight, Content = panel, MinWidth = 280, ResizeMode = ResizeMode.NoResize };
        panel.Children.Add(new TextBlock { Text = "小数位数：" });
        var digits = new ComboBox { ItemsSource = Enumerable.Range(0, 7), SelectedItem = format.DecimalPlaces, Margin = new Thickness(0, 6, 0, 12) }; panel.Children.Add(digits);
        var grouping = new CheckBox { Content = "千位分隔符", IsChecked = format.Thousands }; panel.Children.Add(grouping);
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 16, 0, 0) };
        var ok = new Button { Content = "确定", IsDefault = true, Padding = new Thickness(16, 6, 16, 6) };
        var cancel = new Button { Content = "取消", IsCancel = true, Padding = new Thickness(16, 6, 16, 6), Margin = new Thickness(8, 0, 0, 0) };
        buttons.Children.Add(ok); buttons.Children.Add(cancel); panel.Children.Add(buttons);
        CellFormat? answer = null;
        ok.Click += (_, _) => { answer = format with { DecimalPlaces = (int)digits.SelectedItem, Thousands = grouping.IsChecked == true }; window.DialogResult = true; };
        window.ShowDialog(); return answer;
    }

}
