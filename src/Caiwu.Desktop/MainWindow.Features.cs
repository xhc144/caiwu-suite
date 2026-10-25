using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using System.Windows.Data;
using Caiwu.Contracts;
using Caiwu.Costing.Wpf;
using Caiwu.Desktop.Features;
using Caiwu.Desktop.Presentation;
using Caiwu.VoucherTools.Wpf;
using Caiwu.BookTools;
using Caiwu.BookTools.Wpf;
using Caiwu.Delivery;

namespace Caiwu.Desktop;

public partial class MainWindow
{
    private bool featuresInitialized, featureOpening;

    /// <summary>One explicit owner hook, after InitializeComponent and _session initialization.</summary>
    public void InitializeDesktopFeatures(DesktopFeatureOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        if (featuresInitialized) throw new InvalidOperationException("桌面新功能已初始化。");
        if (options.BookCopy is { } configured && (configured.AcquireDataLease is null ||
            configured.ValidateManagedDestination is null || configured.RegisterCreatedBook is null))
            throw new ArgumentException("账套复制必须同时配置数据租约、受管路径和新账套登记。", nameof(options));
        var menu = (Content as DockPanel)?.Children.OfType<Menu>().SingleOrDefault()
            ?? throw new InvalidOperationException("未找到宿主菜单，不能接入桌面新功能。");
        MenuItem Group(string prefix) => menu.Items.OfType<MenuItem>().Single(m => m.Header is string h && h.StartsWith(prefix, StringComparison.Ordinal));
        var business = Group("实务操作"); var archives = Group("会计档案");
        var copy = new MenuItem { Header = "复制凭证为新草稿…", ToolTip = "从当前显示的凭证复制，人工核对后单独保存。" };
        var summary = new MenuItem { Header = "常用摘要管理…" };
        var cost = new MenuItem { Header = "成本工作表（审核建议）…", ToolTip = "独立工作表，只预览与人工审核，不自动记账。" };
        var bookCopy = new MenuItem { Header = "复制账套…", IsEnabled = false,
            ToolTip = "暂未开放：宿主尚未配置 Delivery 受管路径、数据租约及新账套登记；默认不切换新账套。" };
        business.Items.Add(new Separator()); business.Items.Add(copy); business.Items.Add(cost);
        archives.Items.Add(new Separator()); archives.Items.Add(summary); archives.Items.Add(bookCopy);
        copy.Click += (_, _) => { if (!featureOpening) Run(OpenCopiedVoucher, discardOpening: true); };
        bookCopy.Click += async (_, _) =>
        {
            if (featureOpening || options.BookCopy is not { } gates) return;
            try
            {
                if (!ConfirmDiscardOpening()) return;
                var binding = CaptureDisplayedFeature(_displayOrigin); var actor = OperatorName();
                featureOpening = true; RefreshAvailability();
                using var lease = await Task.Run(() => gates.AcquireDataLease(binding))
                    ?? throw new LedgerValidationException("宿主未取得账套复制数据租约。");
                binding.DemandCurrent();
                var tools = new BookCopyService(validateSource: path =>
                { binding.DemandCurrent(); LedgerFilePolicy.Validate(path); }, validateDestination: path =>
                { binding.DemandCurrent(); gates.ValidateManagedDestination(binding, path); });
                var window = new BookCopyWindow(tools, binding.Shown, binding.DatabasePath, actor,
                    refreshSnapshot: () => { binding.DemandCurrent(); return binding.Shown; }) { Owner = this };
                // This host supplies the actor; the module's standalone audit-name field cannot impersonate another operator.
                var actorInput = ((StackPanel)window.FindName("Inputs")).Children.OfType<TextBox>().Single(text =>
                    BindingOperations.GetBindingExpression(text, TextBox.TextProperty)?.ParentBinding.Path.Path == nameof(BookCopyWorkflow.OperatorName));
                actorInput.IsReadOnly = true;
                if (TryFindResource(typeof(Window)) is Style style) window.Style = style;
                using var monitor = new FeatureWindowMonitor(window, binding);
                if (window.ShowDialog() == true && window.Result is { } created)
                {
                    try
                    {
                        await Task.Run(() => gates.RegisterCreatedBook(binding, created));
                        NotificationText.Text = "新账套已复制并登记：" + created.DestinationPath + "；当前仍为源账套。";
                    }
                    catch (Exception ex)
                    { NotificationText.Text = "新账套文件已创建，但宿主登记失败；请保留文件并核对，勿重复复制：" + created.DestinationPath + "。" + ex.Message; }
                }
            }
            catch (Exception ex) { NotificationText.Text = "账套复制未完成：" + ex.Message; }
            finally { featureOpening = false; RefreshAvailability(); }
        };
        summary.Click += async (_, _) =>
        {
            if (featureOpening) return;
            try
            {
                var binding = CaptureDisplayedFeature(_displayOrigin);
                if (options.OpenSummaryCatalog is null) throw new LedgerValidationException("摘要功能需要宿主先配置用户数据路径、原子摘要库和备份附件登记。");
                featureOpening = true; RefreshAvailability();
                var registration = await Task.Run(() => options.OpenSummaryCatalog(binding));
                binding.DemandCurrent();
                if (registration.Catalog.Location.BookId != binding.Shown.Book.Id ||
                    string.IsNullOrWhiteSpace(registration.BackupAttachmentKey) || string.IsNullOrWhiteSpace(registration.BackupPolicyDescription))
                    throw new LedgerValidationException("摘要配置必须绑定当前账套，并明确备份附件登记和备份策略。");
                new AsyncSummaryManagerWindow(binding, registration) { Owner = this }.ShowDialog();
            }
            catch (Exception ex) { NotificationText.Text = "摘要管理未打开：" + ex.Message; }
            finally { featureOpening = false; RefreshAvailability(); }
        };
        cost.Click += (_, _) => { if (!featureOpening) Run(() =>
        {
            var binding = CaptureDisplayedFeature(_displayOrigin);
            var month = Math.Clamp(binding.Shown.Book.ClosedThroughMonth + 1, binding.Shown.Book.StartMonth, 12);
            var window = new SessionFeatureWindow(binding) { Owner = this, Title = "成本工作表 · " + binding.Shown.Book.Name };
            var page = new CostWorksheetPage(binding.Shown.Book.Id, new(binding.Shown.Book.FiscalYear, month, 1));
            window.BodyForFeature().Children.Add(page);
            window.ShowDialog();
        }, discardOpening: true); };

        void RefreshAvailability()
        {
            copy.IsEnabled = !featureOpening && CanWriteBook && VoucherGrid.SelectedItem is VoucherListRow;
            summary.IsEnabled = !featureOpening && HasBook && options.OpenSummaryCatalog is not null;
            summary.ToolTip = options.OpenSummaryCatalog is null ? "未配置：宿主需明确用户数据路径、摘要库原子版本及备份附件登记。" : "管理当前账套的常用摘要。";
            cost.IsEnabled = !featureOpening && HasBook;
            // No WriteOperation tag: only these explicit Delivery gates may enable BookTools.
            bookCopy.IsEnabled = !featureOpening && HasBook && options.BookCopy is not null;
            bookCopy.ToolTip = options.BookCopy is null ? "未配置：Delivery 受管路径、数据租约及新账套登记；BookTools 8bbf842 Windows 并发仍待验。"
                : "复制当前显示的已保存快照；保持源会话，不自动切换新账套。Windows 并发发布待验。";
        }
        var timer = new DispatcherTimer(DispatcherPriority.Background, Dispatcher) { Interval = TimeSpan.FromMilliseconds(150) };
        timer.Tick += (_, _) => RefreshAvailability(); Closed += (_, _) => timer.Stop();
        RefreshAvailability(); timer.Start(); featuresInitialized = true;
    }

    private FeatureSessionBinding CaptureDisplayedFeature(SessionBoundMutation? origin)
    {
        var bound = RequireOrigin(origin); bound.GetService();
        var shown = Snapshot;
        if (bound.Context.ExpectedBookId != shown.Book.Id || bound.Context.ExpectedRevision != shown.Revision)
            throw new StoreConcurrencyException("显示的数据与当前账套不一致，请重新载入后核对。");
        return new(_session!, shown);
    }

    private void OpenCopiedVoucher()
    {
        if (!CanWriteBook) throw new LedgerValidationException("当前账套不允许新增草稿。");
        var binding = CaptureDisplayedFeature(_voucherOrigin);
        var source = SelectedVoucher();
        var choice = new VoucherCopyWindow(binding.Shown, source.Id, OperatorName()) { Owner = this };
        using var choiceMonitor = new FeatureWindowMonitor(choice, binding);
        if (choice.ShowDialog() != true || choice.Plan is not { } plan) return;
        binding.DemandCurrent();
        var editor = new CopiedDraftWindow(new(binding, plan)) { Owner = this };
        if (editor.ShowDialog() != true || editor.SavedVoucher is not { } saved) return;
        try
        {
            Reload(); Pages.SelectedIndex = 1;
            VoucherGrid.SelectedItem = _voucherRows.FirstOrDefault(row => row.Id == saved.Id);
            NotificationText.Text = "复制凭证已保存为新草稿；尚未审核或记账。";
        }
        catch (Exception ex) { NotificationText.Text = "新草稿已保存，显示刷新失败；请重新载入，勿重复保存：" + ex.Message; }
    }
}
