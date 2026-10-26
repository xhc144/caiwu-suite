using System.Globalization;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Caiwu.Nonprofit.Writable;

namespace Caiwu.Nonprofit.Wpf;

/// <summary>Module-owned w_zw_jz event binding. Canvas values are the documented PBU proportions,
/// not a claimed PBU-to-pixel conversion or original-runtime observation.</summary>
public sealed class NonprofitPostingWindow : Window
{
    public const string OriginalProduct = "minfeiqi/main";
    public const string OriginalObject = "w_zw_jz";
    private readonly NonprofitLedgerService service;
    private readonly NonprofitMutationContext context;
    private readonly string actor;
    private readonly TextBox year = new();
    private readonly TextBox month = new();
    private readonly Button confirm = new() { Content = "确定", IsDefault = true };
    private readonly TextBlock status = new() { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(12) };
    public NonprofitPostResult? Result { get; private set; }

    public NonprofitPostingWindow(NonprofitLedgerService service, string operatorId, int selectedMonth)
    {
        this.service = service ?? throw new ArgumentNullException(nameof(service));
        ArgumentException.ThrowIfNullOrWhiteSpace(operatorId); actor = operatorId;
        var snapshot = service.GetSnapshot(); context = new(snapshot.BookId, snapshot.Revision);
        Title = "凭证过账"; Width = 520; Height = 500; MinWidth = 440; MinHeight = 430;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        var root = new DockPanel(); DockPanel.SetDock(status, Dock.Bottom); root.Children.Add(status);
        var canvas = new Canvas { Width = 1111, Height = 888, Background = Brushes.White };
        var view = new Viewbox { Stretch = Stretch.Uniform, Child = canvas }; root.Children.Add(view); Content = root;
        void Place(FrameworkElement element, string id, double x, double y, double width, double height)
        {
            element.Name = id; element.Width = width; element.Height = height;
            if (element is Control control) control.FontSize = 40;
            Canvas.SetLeft(element, x); Canvas.SetTop(element, y); canvas.Children.Add(element);
        }
        void Label(string id, string text, double x, double y, double width, double height) =>
            Place(new TextBlock { Text = text, FontSize = 40, TextWrapping = TextWrapping.Wrap }, id, x, y, width, height);
        Label("st_4", "提 示", 233, 44, 567, 124);
        Label("st_2", "凭证一经过账，将不能直接", 238, 216, 718, 88);
        Label("st_3", "修改、删除本月已过帐凭证！", 96, 280, 951, 84);
        year.Text = snapshot.FiscalYear.ToString(CultureInfo.InvariantCulture);
        month.Text = selectedMonth.ToString(CultureInfo.InvariantCulture);
        Place(year, "em_nf", 169, 380, 306, 80); Place(month, "em_1", 581, 380, 201, 80);
        Label("st_1", "年", 494, 384, 69, 72); Label("st_5", "月", 805, 384, 101, 76);
        Place(confirm, "cb_1", 146, 532, 229, 96);
        var cancel = new Button { Content = "取消", IsCancel = true }; Place(cancel, "cb_2", 567, 532, 229, 96);
        Label("st_7", "记账人：", 96, 692, 270, 56); Label("st_6", operatorId, 366, 684, 398, 84);
        confirm.Click += (_, _) => Post(); cancel.Click += (_, _) => Close();
        status.Text = "账套：" + snapshot.BookName + "。只对当前确认的账簿版本提交；其他修改将要求重新核对。";
    }
    private void Post()
    {
        if (!int.TryParse(year.Text, NumberStyles.None, CultureInfo.InvariantCulture, out var selectedYear) ||
            !int.TryParse(month.Text, NumberStyles.None, CultureInfo.InvariantCulture, out var selectedMonth) || selectedMonth is < 1 or > 12)
        { status.Text = "请输入有效的年和月份。"; return; }
        try
        {
            if (selectedYear != service.GetSnapshot().FiscalYear) { status.Text = "所选年度超出当前账套，请先核对账套。"; return; }
            confirm.IsEnabled = false;
            Result = service.PostMonth(selectedMonth, context, actor);
            status.Text = $"已过账 {Result.Posted.Count} 张凭证；未审核未过账 {Result.SkippedUnreviewed.Count} 张。";
        }
        catch (Exception ex) when (ex is NonprofitValidationException or NonprofitConcurrencyException or UnauthorizedAccessException or IOException)
        { status.Text = ex.Message; confirm.IsEnabled = true; }
    }
}
