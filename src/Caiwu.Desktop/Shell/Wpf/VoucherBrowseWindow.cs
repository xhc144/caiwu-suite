using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using Caiwu.Contracts;

namespace Caiwu.Desktop.Shell.Wpf;

public sealed class VoucherBrowseWindow : Window
{
    private readonly TextBox from = new(), to = new(), kind = new(), first = new(), last = new();
    private readonly TextBlock error = new() { TextWrapping = TextWrapping.Wrap };
    public DateOnly From { get; private set; }
    public DateOnly To { get; private set; }
    public string Kind => kind.Text.Trim();
    public int? FirstNumber { get; private set; }
    public int? LastNumber { get; private set; }
    public VoucherBrowseWindow(BookInfo book)
    {
        Title = "凭证浏览查看"; Width = 490; SizeToContent = SizeToContent.Height; ResizeMode = ResizeMode.NoResize;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        SetResourceReference(StyleProperty, typeof(Window));
        var form = new StackPanel { Margin = new Thickness(24) }; Content = form;
        from.Text = $"{book.FiscalYear}-{book.StartMonth:00}"; to.Text = $"{book.FiscalYear}-12";
        Row(form, "年月起止（yyyy-MM）", from, to); Row(form, "凭证类型（空为全部）", kind); Row(form, "凭证号起止（空为不限）", first, last);
        form.Children.Add(error);
        var actions = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 20, 0, 0) };
        var ok = new Button { Content = "确定", MinWidth = 100 }; var cancel = new Button { Content = "取消", MinWidth = 100 };
        actions.Children.Add(ok); actions.Children.Add(cancel); form.Children.Add(actions);
        cancel.Click += (_, _) => DialogResult = false;
        ok.Click += (_, _) =>
        {
            try
            {
                if (!DateOnly.TryParseExact(from.Text + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var f) ||
                    !DateOnly.TryParseExact(to.Text + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var t) || f > t)
                    throw new ArgumentException("请填写有效的年月起止，开始年月不能晚于结束年月。");
                From = f; To = t.AddMonths(1).AddDays(-1); FirstNumber = Number(first.Text); LastNumber = Number(last.Text);
                if (FirstNumber > LastNumber) throw new ArgumentException("开始凭证号不能大于结束凭证号。");
                DialogResult = true;
            }
            catch (Exception ex) when (ex is ArgumentException or FormatException or OverflowException) { error.Text = ex.Message; }
        };
    }
    private static int? Number(string text) => string.IsNullOrWhiteSpace(text) ? null :
        int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var value) && value > 0 ? value : throw new ArgumentException("凭证号应为正整数。");
    private static void Row(Panel panel, string title, params TextBox[] fields)
    {
        panel.Children.Add(new TextBlock { Text = title, Margin = new Thickness(0, 12, 0, 6) });
        var row = new UniformGrid { Columns = fields.Length }; foreach (var field in fields) { field.Margin = new Thickness(0, 0, 8, 0); row.Children.Add(field); }
        panel.Children.Add(row);
    }
}
