using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Caiwu.Contracts;

namespace Caiwu.VoucherTools.Wpf;

/// <summary>A modal UI over one already displayed snapshot. Returns a plan; never saves or rereads a ledger.</summary>
public partial class VoucherCopyWindow : Window
{
    private readonly LedgerSnapshot shown;
    private readonly Guid sourceId;
    private readonly string currentPreparedBy;
    private readonly IVoucherCopyPlanner planner;
    private bool confirmed;

    public VoucherCopyWindow(LedgerSnapshot displayedSnapshot, Guid sourceVoucherId, string currentPreparedBy,
        IVoucherCopyPlanner? planner = null)
    {
        ArgumentNullException.ThrowIfNull(displayedSnapshot);
        ArgumentNullException.ThrowIfNull(currentPreparedBy);
        shown = displayedSnapshot;
        sourceId = sourceVoucherId;
        this.currentPreparedBy = currentPreparedBy;
        this.planner = planner ?? new VoucherCopyPlanner();
        InitializeComponent();
        ApplyThemeFallbacks();
        PreparedByText.Text = currentPreparedBy;
        BookText.Text = shown.Book.Name;
        var sources = shown.Vouchers.Where(v => v.Id == sourceId).ToArray();
        var source = sources.Length == 1 ? sources[0] : null;
        SourceText.Text = source is null ? "源凭证不在显示的账套快照中，请返回重新选择。" :
            $"源凭证：{source.Date:yyyy-MM-dd}  {source.Kind}-{source.Number}  ·  {Status(source.Status)}  ·  {source.Lines?.Count ?? 0} 条分录";
        var accounts = shown.Accounts.GroupBy(a => a.Code).ToDictionary(g => g.Key, g => g.First().Name);
        var rows = (source?.Lines ?? []).Select((line, index) => new PreviewLine(index + 1,
            line?.AccountCode ?? "", line?.AccountCode is not null && accounts.TryGetValue(line.AccountCode, out var name) ? name : "科目不存在",
            line?.Summary ?? "（空分录）", line?.Debit ?? 0, line?.Credit ?? 0)).ToArray();
        LinesGrid.ItemsSource = Array.AsReadOnly(rows);
        try
        {
            TotalsText.Text = $"{rows.Length} 条分录    借方合计 {rows.Sum(r => r.Debit).ToString("N2", CultureInfo.CurrentCulture)}    " +
                $"贷方合计 {rows.Sum(r => r.Credit).ToString("N2", CultureInfo.CurrentCulture)}";
        }
        catch (OverflowException) { TotalsText.Text = "源分录金额无效，请核对源凭证。"; }
        Loaded += (_, _) => DateInput.Focus();
        Closing += (_, _) => { if (!confirmed) Plan = null; };
    }

    /// <summary>Only populated after a successful explicit confirmation. Cancel/Escape/window-close returns null.</summary>
    public VoucherCopyPlan? Plan { get; private set; }

    private void Confirm_Click(object sender, RoutedEventArgs e)
    {
        if (confirmed) return;
        ClearErrors();
        var feedback = CopyForm.Validate(shown, sourceId, currentPreparedBy,
            new(DateInput.Text, KindInput.Text, NumberInput.Text, AttachmentInput.Text), planner);
        if (feedback.Plan is not { } plan)
        {
            foreach (var group in feedback.Errors.GroupBy(error => error.Field))
                ErrorBlock(group.Key).Text = string.Join(Environment.NewLine, group.Select(error => error.Message));
            GeneralError.Text = string.Join(Environment.NewLine, feedback.Errors.Select(error => error.Message));
            Input(feedback.Errors.FirstOrDefault()?.Field ?? CopyField.General)?.Focus();
            return;
        }
        Plan = plan;
        confirmed = true;
        ConfirmButton.IsEnabled = false;
        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        if (confirmed) return;
        Plan = null;
        DialogResult = false;
    }

    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            e.Handled = true;
            Cancel_Click(sender, new RoutedEventArgs());
            return;
        }
        if (e.Key == Key.Enter && (Keyboard.Modifiers & ModifierKeys.Control) != 0)
        {
            e.Handled = true;
            Confirm_Click(sender, new RoutedEventArgs());
        }
    }

    private void ClearErrors()
    {
        foreach (var field in Enum.GetValues<CopyField>()) ErrorBlock(field).Text = "";
    }

    private TextBlock ErrorBlock(CopyField field) => field switch
    {
        CopyField.Date => DateError, CopyField.Kind => KindError, CopyField.Number => NumberError,
        CopyField.Attachments => AttachmentError, CopyField.PreparedBy => PreparedByError, _ => GeneralError
    };

    private Control? Input(CopyField field) => field switch
    {
        CopyField.Date => DateInput, CopyField.Kind => KindInput, CopyField.Number => NumberInput,
        CopyField.Attachments => AttachmentInput, _ => null
    };

    private void ApplyThemeFallbacks()
    {
        // Existing application styles win. A standalone host gets the .NET 10 Fluent theme.
        if (Application.Current?.Resources[typeof(Button)] is not System.Windows.Style)
            Resources.MergedDictionaries.Add(new ResourceDictionary
            {
                Source = new Uri("pack://application:,,,/PresentationFramework.Fluent;component/Themes/Fluent.xaml", UriKind.Absolute)
            });
        if (Application.Current?.Resources[typeof(Window)] is not System.Windows.Style)
        {
            FontFamily = new FontFamily("Segoe UI, Microsoft YaHei UI");
            FontSize = 13;
        }
        Fallback("Caiwu.Copy.Background", Colors.White);
        Fallback("Caiwu.Copy.Foreground", Color.FromRgb(27, 38, 52));
        Fallback("Caiwu.Copy.Surface", Color.FromRgb(246, 248, 251));
        Fallback("Caiwu.Copy.Border", Color.FromRgb(220, 227, 235));
        Fallback("Caiwu.Copy.Muted", Color.FromRgb(85, 101, 120));
        Fallback("Caiwu.Copy.Error", Color.FromRgb(180, 35, 24));
    }

    private void Fallback(string key, Color color)
    {
        if (TryFindResource(key) is not null) return;
        var brush = new SolidColorBrush(color);
        brush.Freeze();
        Resources[key] = brush;
    }

    private static string Status(VoucherStatus status) => status switch
    {
        VoucherStatus.Draft => "草稿", VoucherStatus.Reviewed => "已审核", VoucherStatus.Posted => "已记账", _ => "未知状态"
    };

    private sealed record PreviewLine(int Number, string AccountCode, string AccountName, string Summary, decimal Debit, decimal Credit);
}
