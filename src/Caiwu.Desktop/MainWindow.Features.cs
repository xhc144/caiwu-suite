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
using Caiwu.Operators;
using Caiwu.Nonprofit.Reporting;
using Caiwu.Nonprofit.Reporting.Wpf;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using Caiwu.ReportDesigner;
using Caiwu.ReportDesigner.Wpf;
using Microsoft.Win32;
using System.Text.Json;

namespace Caiwu.Desktop;

public partial class MainWindow
{
    private bool featuresInitialized, featureOpening;
    private MenuItem? shellBookCopy;
    private FeatureAuthentication? featureAuthentication;
    private ManagedFeatureContext? managedFeatureContext;
    private Func<FeatureSessionBinding, SummaryFeatureRegistration>? editorSummaryCatalog;

    /// <summary>One explicit owner hook, after InitializeComponent and _session initialization.</summary>
    public void InitializeDesktopFeatures(DesktopFeatureOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        if (featuresInitialized) throw new InvalidOperationException("桌面新功能已初始化。");
        featureAuthentication = options.Authentication;
        managedFeatureContext = options.Managed;
        editorSummaryCatalog = options.OpenSummaryCatalog;
        if (options.BookCopy is { } configured && (configured.AcquireDataLease is null ||
            configured.ValidateManagedDestination is null || configured.RegisterCreatedBook is null))
            throw new ArgumentException("账套复制必须同时配置数据租约、受管路径和新账套登记。", nameof(options));
        var copy = new MenuItem { Header = "复制凭证为新草稿…", ToolTip = "现有扩展；原凭证复制窗口未完成。" };
        var summary = ShellMenu("m_i20");
        var cost = new MenuItem { Header = "成本工作表（审核建议）…" };
        var bookCopy = new MenuItem { Header = "复制当前账套…", IsEnabled = false };
        shellBookCopy = bookCopy;
        var nonprofit = new MenuItem { Header = "民非报表分类与预览（当前月）…" };
        var designer = new MenuItem { Header = "自定义当前基础账表…" };
        foreach (var tool in new[] { copy, cost, bookCopy, nonprofit, designer }) extensionMenu.Items.Add(tool);
        copy.Click += async (_, _) =>
        {
            if (featureOpening) return;
            try
            {
                if (!ConfirmDiscardOpening()) return;
                featureOpening = true; RefreshAvailability(); await OpenCopiedVoucherAsync();
            }
            catch (Exception ex) { NotificationText.Text = "复制凭证未完成：" + ex.Message; }
            finally { featureOpening = false; RefreshAvailability(); }
        };
        bookCopy.Click += async (_, _) =>
        {
            if (featureOpening || options.BookCopy is not { } gates) return;
            try
            {
                if (!ConfirmDiscardOpening()) return;
                var binding = CaptureDisplayedFeature(_displayOrigin);
                await binding.DemandPermissionAsync(OperatorPermission.RestoreLedger);
                var actor = binding.Authentication.ActorKey;
                featureOpening = true; RefreshAvailability();
                using var lease = await Task.Run(() => gates.AcquireDataLease(binding))
                    ?? throw new LedgerValidationException("宿主未取得账套复制数据租约。");
                binding.DemandCurrent();
                var tools = new BookCopyService(validateSource: path =>
                { binding.DemandCurrent(); binding.Authentication.Demand(OperatorPermission.RestoreLedger); LedgerFilePolicy.Validate(path); }, validateDestination: path =>
                { binding.DemandCurrent(); binding.Authentication.Demand(OperatorPermission.RestoreLedger); gates.ValidateManagedDestination(binding, path); });
                var window = new BookCopyWindow(tools, binding.Shown, binding.DatabasePath, actor,
                    refreshSnapshot: () => { binding.DemandCurrent(); return binding.Shown; }) { Owner = this };
                if (options.Managed is { } copyHost) ((BookCopyWorkflow)window.DataContext).DestinationPath = SafePaths.Child(copyHost.Data.DataRoot, "copy-" + Guid.NewGuid().ToString("N") + ".caiwu");
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
                        await Task.Run(() => { binding.Authentication.Demand(OperatorPermission.RestoreLedger); gates.RegisterCreatedBook(binding, created); });
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
            if (registeredWindows.ContainsKey(new("qingsong/main", "w_xt_zy", "m_frame_zw/m_i20"))) return;
            if (featureOpening) return;
            try
            {
                var binding = CaptureDisplayedFeature(_displayOrigin);
                await binding.DemandPermissionAsync(OperatorPermission.ReadLedger);
                if (options.OpenSummaryCatalog is null) throw new LedgerValidationException("摘要功能需要宿主先配置用户数据路径、原子摘要库和备份附件登记。");
                featureOpening = true; RefreshAvailability();
                SummaryFeatureRegistration registration;
                if (options.CanInitializeSummaryCatalog is not null && options.InitializeSummaryCatalog is not null &&
                    await Task.Run(() => options.CanInitializeSummaryCatalog(binding)))
                {
                    if (MessageBox.Show(this, "当前物理账套尚未建立摘要库。是否明确创建一个新的受管摘要库并登记备份附件？取消不会创建文件。",
                        "初始化摘要库", MessageBoxButton.YesNo, MessageBoxImage.Question, MessageBoxResult.No) != MessageBoxResult.Yes) return;
                    await binding.DemandPermissionAsync(OperatorPermission.PrepareVoucher);
                    registration = await Task.Run(() => options.InitializeSummaryCatalog(binding));
                }
                else registration = await Task.Run(() => options.OpenSummaryCatalog(binding));
                await binding.DemandPermissionAsync(registration.ManagementPermission);
                binding.DemandCurrent();
                if (registration.Catalog.Location.BookId != binding.Shown.Book.Id ||
                    string.IsNullOrWhiteSpace(registration.BackupAttachmentKey) || string.IsNullOrWhiteSpace(registration.BackupPolicyDescription))
                    throw new LedgerValidationException("摘要配置必须绑定当前账套，并明确备份附件登记和备份策略。");
                new AsyncSummaryManagerWindow(binding, registration) { Owner = this }.ShowDialog();
            }
            catch (Exception ex) { NotificationText.Text = "摘要管理未打开：" + ex.Message; }
            finally { featureOpening = false; RefreshAvailability(); }
        };
        cost.Click += async (_, _) =>
        {
            if (featureOpening) return;
            try
            {
            if (!ConfirmDiscardOpening()) return;
            featureOpening = true; RefreshAvailability();
            var binding = CaptureDisplayedFeature(_displayOrigin);
            await binding.DemandPermissionAsync(OperatorPermission.ReadLedger);
            var month = Math.Clamp(binding.Shown.Book.ClosedThroughMonth + 1, binding.Shown.Book.StartMonth, 12);
            var window = new SessionFeatureWindow(binding) { Owner = this, Title = "成本工作表 · " + binding.Shown.Book.Name };
            var page = new CostWorksheetPage(binding.Shown.Book.Id, new(binding.Shown.Book.FiscalYear, month, 1));
            if (managedFeatureContext is { } costingHost) AddManagedCostSave(window, page, binding, costingHost);
            window.BodyForFeature().Children.Add(page);
            window.ShowDialog();
            }
            catch (Exception ex) { NotificationText.Text = "成本工作表未打开：" + ex.Message; }
            finally { featureOpening = false; RefreshAvailability(); }
        };
        nonprofit.Click += async (_, _) =>
        {
            if (featureOpening) return;
            try
            {
                var binding = CaptureDisplayedFeature(_displayOrigin);
                if (binding.Shown.Book.Regime != AccountingRegime.Nonprofit) throw new LedgerValidationException("此入口仅用于民间非营利组织账套。");
                if (options.Managed is null && string.IsNullOrWhiteSpace(options.NonprofitPreviewRoot)) throw new LedgerValidationException("宿主尚未指定民非分类的用户预览目录。");
                featureOpening = true; RefreshAvailability(); await binding.DemandPermissionAsync(OperatorPermission.ReadLedger);
                if (options.Managed is not null) await binding.DemandPermissionAsync(OperatorPermission.PrepareVoucher);
                if (VoucherFrom.SelectedDate is not { } from || VoucherTo.SelectedDate is not { } to)
                    throw new LedgerValidationException("请先在凭证查询日期中明确完整的同一月份。");
                var period = new ReportingPeriod(DateOnly.FromDateTime(from), DateOnly.FromDateTime(to), ReportingPeriodKind.Monthly);
                var physical = Path.GetFullPath(binding.DatabasePath); if (OperatingSystem.IsWindows()) physical = physical.ToUpperInvariant();
                var key = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(physical + "|" + binding.Shown.Book.Id)));
                var directory = options.Managed is { } managed ? await Task.Run(() => managed.ModuleDirectory(binding, "Nonprofit")) : Path.Combine(options.NonprofitPreviewRoot!, key);
                var window = new SessionFeatureWindow(binding) { Owner = this, Title = "民非报表分类 · 仅本地预览", Width = 1400, Height = 900 };
                window.StatusForFeature().Text = options.Managed is null ? "分类 JSON 仅本地预览，尚未登记到受管附件或账套备份。请另行保管；缺维度不会猜测或默填零。"
                    : "分类 JSON 保存后尚未登记；关闭本窗口时逐项核验并登记到受管完整备份。失败会保留文件并明确阻断完整备份。";
                window.BodyForFeature().Children.Add(new NonprofitClassificationPanel(() => binding.DemandCurrent().GetSnapshot(), period, directory));
                window.ShowDialog();
                if (options.Managed is { } moduleData)
                {
                    var count = await Task.Run(() => moduleData.RegisterModuleFiles(binding, "Nonprofit", "nonprofit-classification-v1"));
                    NotificationText.Text = $"已核验并登记 {count} 个民非分类 JSON；完整账套备份包含已登记附件。";
                }
            }
            catch (Exception ex) { NotificationText.Text = "民非分类操作未完成，已保存文件保留，请核对登记：" + ex.Message; }
            finally { featureOpening = false; RefreshAvailability(); }
        };
        designer.Click += async (_, _) =>
        {
            if (featureOpening) return;
            try
            {
                var managed = options.Managed ?? throw new InvalidOperationException("设计器需要真实受管模板目录及附件登记。");
                var binding = CaptureDisplayedFeature(_displayOrigin);
                await binding.DemandPermissionAsync(OperatorPermission.PrepareVoucher);
                var context = CaptureReportContext(); var report = CurrentReport();
                if (binding.DemandCurrent().GetSnapshot().Revision != binding.Shown.Revision || report.Metadata.Book.Id != binding.Shown.Book.Id)
                    throw new StoreConcurrencyException("当前账表来源已变化，请重新查询后打开设计器。");
                featureOpening = true; RefreshAvailability();
                var directory = await Task.Run(() => managed.ModuleDirectory(binding, "Reports"));
                bool Current(ReportInputSnapshot _) { try { return binding.IsCurrent && context == CaptureReportContext() && binding.DemandCurrent().GetSnapshot().Revision == binding.Shown.Revision; } catch { return false; } }
                string? TemplatePath(TemplatePathPurpose purpose)
                {
                    string? path;
                    if (purpose == TemplatePathPurpose.Load)
                    { var dialog = new OpenFileDialog { InitialDirectory = directory, Filter = "受管模板 JSON|*.json", CheckFileExists = true }; path = dialog.ShowDialog(this) == true ? dialog.FileName : null; }
                    else
                    { var dialog = new SaveFileDialog { InitialDirectory = directory, Filter = "受管模板 JSON|*.json", FileName = "report-" + Guid.NewGuid().ToString("N") + ".json", OverwritePrompt = false }; path = dialog.ShowDialog(this) == true ? dialog.FileName : null; }
                    return path is null ? null : managed.ApproveModuleFile(binding, "Reports", path);
                }
                string? ExportPath(bool html)
                {
                    var directory = SafePaths.Child(managed.Data.DataRoot, "Exports"); Directory.CreateDirectory(directory);
                    var dialog = new SaveFileDialog { InitialDirectory = directory, Filter = html ? "HTML|*.html" : "CSV|*.csv", FileName = "report-" + Guid.NewGuid().ToString("N") + (html ? ".html" : ".csv"), OverwritePrompt = false };
                    if (dialog.ShowDialog(this) != true) return null;
                    var full = SafePaths.Full(dialog.FileName);
                    if (!string.Equals(Path.GetDirectoryName(full), directory, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("导出请选择受管 Exports 目录；不能把输出混入模块附件目录。");
                    return full;
                }
                var input = new ReportInputSnapshot(report, binding.Shown.Revision);
                var window = new SessionFeatureWindow(binding) { Owner = this, Title = "自定义当前账表", Width = 1400, Height = 940 };
                window.StatusForFeature().Text = "模板版本由原模块校验；关闭后核验并登记模板 JSON，失败保留文件并阻断完整备份。";
                window.BodyForFeature().Children.Add(new ReportDesignerControl(input, new(Current, TemplatePath, ExportPath)));
                window.ShowDialog();
                var count = await Task.Run(() => managed.RegisterModuleFiles(binding, "Reports", "report-template-v1"));
                NotificationText.Text = $"已核验并登记 {count} 个模板 JSON；来源账表和金额未改。";
            }
            catch (Exception ex) { NotificationText.Text = "设计器未完成，已保存文件保留，请核对登记：" + ex.Message; }
            finally { featureOpening = false; RefreshAvailability(); }
        };

        void RefreshAvailability()
        {
            var authenticated = featureAuthentication?.IsPotentiallyCurrent == true && _session?.Service is AuthorizedLedgerService;
            const string noAuthentication = "未认证：需要固定 OperatorSession 与集中授权账套服务；任意姓名不能启用业务动作。";
            copy.IsEnabled = authenticated && !featureOpening && CanWriteBook && VoucherGrid.SelectedItem is VoucherListRow;
            copy.ToolTip = authenticated ? "从原快照复制，显式保存为新草稿。" : noAuthentication;
            summary.IsEnabled = authenticated && !featureOpening && HasBook && (options.OpenSummaryCatalog is not null || registeredWindows.ContainsKey(new("qingsong/main", "w_xt_zy", "m_frame_zw/m_i20")));
            summary.ToolTip = !authenticated ? noAuthentication : options.OpenSummaryCatalog is null ? "未配置：宿主需明确用户数据路径、摘要库原子版本及备份附件登记。" : "管理当前账套的常用摘要。";
            cost.IsEnabled = authenticated && !featureOpening && HasBook;
            cost.ToolTip = authenticated ? "仅人工审核建议，不自动记账。" : noAuthentication;
            nonprofit.IsEnabled = authenticated && !featureOpening && HasBook && Snapshot.Book.Regime == AccountingRegime.Nonprofit && (options.Managed is not null || !string.IsNullOrWhiteSpace(options.NonprofitPreviewRoot));
            nonprofit.ToolTip = !authenticated ? noAuthentication : !HasBook || Snapshot.Book.Regime != AccountingRegime.Nonprofit ? "仅民非制度账套可用。"
                : options.Managed is not null ? "真实受管分类及两表预览；保存后关闭窗口完成附件登记。" : string.IsNullOrWhiteSpace(options.NonprofitPreviewRoot) ? "未配置用户预览目录。" : "真实分类与两表预览；JSON 尚未纳入受管附件/备份。";
            designer.IsEnabled = authenticated && !featureOpening && HasBook && options.Managed is not null && Pages.SelectedIndex is 1 or 4 or 5;
            designer.ToolTip = options.Managed is null ? "需要受管模板路径/版本/附件登记。" : "从当前凭证列表、余额表或明细账的原期间/筛选打开。";
            // No WriteOperation tag: only these explicit Delivery gates may enable BookTools.
            bookCopy.IsEnabled = authenticated && !featureOpening && HasBook && options.BookCopy is not null;
            bookCopy.ToolTip = !authenticated ? noAuthentication : options.BookCopy is null ? "未配置：Delivery 受管路径、数据租约及新账套登记；BookTools 8bbf842 Windows 并发仍待验。"
                : "复制当前显示的已保存快照；保持源会话，不自动切换新账套。Windows 并发发布待验。";
        }
        var timer = new DispatcherTimer(DispatcherPriority.Background, Dispatcher) { Interval = TimeSpan.FromMilliseconds(150) };
        timer.Tick += async (_, _) => { if (featureAuthentication is not null) await featureAuthentication.CheckAsync(); RefreshAvailability(); }; Closed += (_, _) => timer.Stop();
        RefreshAvailability(); timer.Start(); featuresInitialized = true;
    }

    private FeatureSessionBinding CaptureDisplayedFeature(SessionBoundMutation? origin)
    {
        var bound = RequireOrigin(origin); bound.GetService();
        var shown = Snapshot;
        if (bound.Context.ExpectedBookId != shown.Book.Id || bound.Context.ExpectedRevision != shown.Revision)
            throw new StoreConcurrencyException("显示的数据与当前账套不一致，请重新载入后核对。");
        return new(_session!, shown, featureAuthentication ?? throw new OperatorAuthorizationException("请先完成真实操作员登录。"));
    }

    private string? PickVoucherSummary(Window owner, FeatureSessionBinding binding)
    {
        binding.DemandCurrent(); binding.Authentication.Demand(OperatorPermission.PrepareVoucher);
        var registration = (editorSummaryCatalog ?? throw new LedgerValidationException("当前会话未配置摘要库。"))(binding);
        var catalog = new SessionSummaryCatalog(binding, registration.Catalog, registration.ManagementPermission);
        var shown = catalog.Read();
        var items = shown.ToPickerItems((id, category, text) => new Controls.SummaryLibraryItem(id, category, text));
        var selected = Controls.SelectionDialogs.PickSummary(owner, items);
        if (!selected.Accepted) return null;
        // Revalidate the original ledger/session and exact catalog version; never refresh a draft token.
        binding.Authentication.Demand(OperatorPermission.PrepareVoucher);
        var current = catalog.Read();
        if (current.Version != shown.Version)
            throw new Caiwu.Summaries.SummaryConflictException("摘要库版本已变化，原分录未修改；请关闭后重新核对。");
        if (selected.Value is not { } value || !shown.Entries.Any(e => e.Id.ToString("D") == value.Id && e.Text == value.Text))
            throw new Caiwu.Summaries.SummaryConflictException("摘要选择与原目录不一致，原分录未修改。");
        return value.Text;
    }

    private async Task OpenCopiedVoucherAsync()
    {
        if (!CanWriteBook) throw new LedgerValidationException("当前账套不允许新增草稿。");
        var binding = CaptureDisplayedFeature(_voucherOrigin);
        var source = SelectedVoucher();
        await binding.DemandPermissionAsync(OperatorPermission.PrepareVoucher);
        var choice = new VoucherCopyWindow(binding.Shown, source.Id, binding.Authentication.ActorKey) { Owner = this };
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
