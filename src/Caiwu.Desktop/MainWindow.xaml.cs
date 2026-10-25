using System.Collections.ObjectModel;
using System.ComponentModel;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Caiwu.Contracts;
using Caiwu.Desktop.Dialogs;
using Caiwu.Desktop.Presentation;
using Microsoft.Win32;
using Caiwu.Reporting;

namespace Caiwu.Desktop;

public partial class MainWindow : Window
{
    private readonly DesktopBackend? _backend;
    private readonly LedgerSession? _session;
    private readonly ObservableCollection<OpeningBalanceEdit> _opening = [];
    private IReadOnlyList<VoucherListRow> _voucherRows = [];
    private IReadOnlyList<AccountDisplay> _accountRows = [];
    private IReadOnlyList<TrialBalanceRow> _trialRows = [];
    private IReadOnlyList<LedgerDisplay> _ledgerRows = [];
    private bool _ready, _openingDirty;
    private SessionBoundMutation? _voucherOrigin, _accountOrigin, _openingOrigin, _displayOrigin;
    private BookInfo? _displayBook, _newBookDraft;

    public MainWindow(DesktopBackend? backend = null)
    {
        InitializeComponent(); _backend = backend;
        _session = backend is null ? null : new LedgerSession(backend);
        OpeningGrid.ItemsSource = _opening;
        if (backend is null) BackendNoticeText.Text = "此启动骨架尚未接入账务模块，暂不能创建或保存账套。";
        Loaded += (_, _) => { _ready = true; Reload(); };
    }

    private bool HasBook => _session?.Snapshot is not null;
    private bool CanWriteBook => HasBook && PreviewLedgerService.AllowsWrites(Snapshot.Book);
    internal void OpenVerificationBook(string path) { _session!.Open(path); BookOpened(); }
    internal void ShowVerificationPage(int index) { Pages.SelectedIndex = index; QueryCurrent(); UpdateLayout(); }
    internal VoucherEditorWindow OpenVerificationVoucher(Guid id)
    {
        var voucher = Snapshot.Vouchers.Single(v => v.Id == id);
        var window = new VoucherEditorWindow(Snapshot.Book, Snapshot.Accounts, voucher, "验证操作员",
            _ => throw new InvalidOperationException("验证窗口只读。")) { Owner = this };
        window.Show(); return window;
    }
    private LedgerSnapshot Snapshot => _session?.Snapshot ?? throw new LedgerValidationException("请先打开账套。");
    private ILedgerService Service => _session?.Service ?? throw new LedgerValidationException("请先打开账套。");
    private string OperatorName()
    {
        var value = OperatorInput.Text.Trim();
        if (value.Length == 0) throw new LedgerValidationException("请填写当前操作员名称。");
        return value;
    }

    private bool Run(Action action, string? success = null, bool requireBook = true, bool discardOpening = false)
    {
        try
        {
            if (_backend is null) throw new LedgerValidationException("此开发包的账务模块尚未接入，请使用完整集成包。");
            if (requireBook && !HasBook) throw new LedgerValidationException("请先创建或打开账套。");
            if (discardOpening && !ConfirmDiscardOpening()) return false;
            action();
            if (success is not null) NotificationText.Text = success;
            return true;
        }
        catch (StoreConcurrencyException ex)
        {
            MessageBox.Show(this, ex.Message + "\n请重新载入账套数据后重试；未保存内容仍保留在当前窗口。", "数据已发生变化", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
        catch (Exception ex)
        {
            NotificationText.Text = "操作未完成：" + ex.Message;
            MessageBox.Show(this, ex.Message, "操作未完成", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
        return false;
    }

    private void Reload()
    {
        _session?.Refresh();
        WelcomePanel.Visibility = HasBook ? Visibility.Collapsed : Visibility.Visible;
        Pages.Visibility = HasBook ? Visibility.Visible : Visibility.Collapsed;
        if (!HasBook)
        {
            Title = "财务套件 · 开发预览"; BookNameText.Text = "财务工作台";
            BookSubtitleText.Text = "现代界面 · 熟悉的账务流程"; StatusText.Text = "尚未打开账套";
            _voucherOrigin = _accountOrigin = _openingOrigin = _displayOrigin = null; _displayBook = null;
            UpdateWriteAccess(this); return;
        }
        var snapshot = Snapshot; var book = snapshot.Book;
        _displayOrigin = new SessionBoundMutation(_session!, snapshot); _displayBook = book;
        var regime = book.Regime switch { AccountingRegime.SmallBusiness => "小企业", AccountingRegime.Enterprise => "企业", _ => "民间非营利组织" };
        var period = book.ClosedThroughMonth >= 12 ? "本年度已结账" : $"当前期间 {book.FiscalYear}-{book.ClosedThroughMonth + 1:00}";
        Title = $"{book.Name} — 财务套件 · 开发预览"; BookNameText.Text = book.Name;
        BookSubtitleText.Text = $"{regime} · {book.FiscalYear}年度 · {period} · 实验模板";
        if (!CanWriteBook) BookSubtitleText.Text += " · 只读核对，专有核算未开放";
        StatusText.Text = $"{period}    账套：{Path.GetFileName(_session!.DatabasePath)}";
        OverviewText.Text = $"本年度已保存 {snapshot.Vouchers.Count} 张凭证：草稿 {snapshot.Vouchers.Count(v => v.Status == VoucherStatus.Draft)} 张，" +
            $"已审核 {snapshot.Vouchers.Count(v => v.Status == VoucherStatus.Reviewed)} 张，已记账 {snapshot.Vouchers.Count(v => v.Status == VoucherStatus.Posted)} 张。";
        _accountRows = snapshot.Accounts.OrderBy(a => a.Code, StringComparer.Ordinal)
            .Select(a => new AccountDisplay(a, !snapshot.Accounts.Any(child => child.ParentCode == a.Code))).ToArray();
        AccountGrid.ItemsSource = _accountRows;
        _accountOrigin = new SessionBoundMutation(_session!, snapshot);
        var selectedCode = LedgerAccountInput.SelectedValue as string;
        LedgerAccountInput.ItemsSource = _accountRows;
        LedgerAccountInput.SelectedValue = selectedCode;
        if (LedgerAccountInput.SelectedIndex < 0 && _accountRows.Count > 0) LedgerAccountInput.SelectedIndex = 0;
        ReloadOpeningRows();
        AuditGrid.ItemsSource = snapshot.AuditEvents.OrderByDescending(a => a.At).ToArray();
        QueryVouchers();
        if (TrialFrom.SelectedDate is not null) QueryTrial();
        if (LedgerFrom.SelectedDate is not null && LedgerAccountInput.SelectedItem is not null) QueryLedger();
        UpdateWriteAccess(this);
    }

    private void BookOpened()
    {
        var book = Snapshot.Book; var month = Math.Clamp(book.ClosedThroughMonth + 1, book.StartMonth, 12);
        var from = new DateTime(book.FiscalYear, month, 1);
        var to = from.AddMonths(1).AddDays(-1);
        VoucherFrom.SelectedDate = TrialFrom.SelectedDate = LedgerFrom.SelectedDate = from;
        VoucherTo.SelectedDate = TrialTo.SelectedDate = LedgerTo.SelectedDate = to;
        Pages.SelectedIndex = 0; Reload();
    }

    private void NewBook_Click(object sender, RoutedEventArgs e) => Run(() =>
    {
        var dialog = new NewBookWindow(_backend!.Templates, _newBookDraft) { Owner = this };
        if (dialog.ShowDialog() != true || dialog.Book is null || dialog.SelectedTemplate is null) { _newBookDraft = null; return; }
        _newBookDraft = dialog.Book; // Native path cancellation/failure must retain the accepted form fields.
        var save = new SaveFileDialog { Title = "保存新账套", Filter = "财务账套 (*.caiwu)|*.caiwu", DefaultExt = ".caiwu",
            FileName = SafeFileName(dialog.Book.Name) + ".caiwu", AddExtension = true };
        if (save.ShowDialog(this) != true) return;
        if (File.Exists(save.FileName)) throw new LedgerValidationException("新账套不能覆盖已有文件，请选择新的文件名。");
        _session!.Create(save.FileName, dialog.Book, dialog.SelectedTemplate.Accounts); BookOpened(); _newBookDraft = null;
        NotificationText.Text = "账套已建立。请核对科目并录入期初余额。";
    }, requireBook: false, discardOpening: true);

    private void OpenBook_Click(object sender, RoutedEventArgs e) => Run(() =>
    {
        var open = new OpenFileDialog { Title = "打开账套", Filter = "财务账套 (*.caiwu)|*.caiwu|所有文件|*.*", CheckFileExists = true };
        if (open.ShowDialog(this) != true) return;
        _session!.Open(open.FileName); BookOpened(); NotificationText.Text = "账套已打开，数据已从本地文件载入。";
    }, requireBook: false, discardOpening: true);

    private void CloseBook_Click(object sender, RoutedEventArgs e) => Run(() =>
    { _session!.Close(); _openingDirty = false; Reload(); }, "账套已关闭。", discardOpening: true);
    private void Exit_Click(object sender, RoutedEventArgs e) => Close();

    private void Backup_Click(object sender, RoutedEventArgs e) => Run(() =>
    {
        var save = new SaveFileDialog { Title = "备份当前账套", Filter = "账套备份 (*.caiwubak)|*.caiwubak", DefaultExt = ".caiwubak",
            FileName = SafeFileName(Snapshot.Book.Name) + "-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".caiwubak" };
        if (save.ShowDialog(this) != true) return;
        WithBusy(() => _session!.BackupTo(save.FileName));
        NotificationText.Text = "备份已保存：" + save.FileName;
    });

    private void Restore_Click(object sender, RoutedEventArgs e) => Run(() =>
    {
        var open = new OpenFileDialog { Title = "选择账套备份", Filter = "账套备份 (*.caiwubak)|*.caiwubak|财务账套 (*.caiwu)|*.caiwu|所有文件|*.*" };
        if (open.ShowDialog(this) != true) return;
        var save = new SaveFileDialog { Title = "恢复到新的账套文件", Filter = "财务账套 (*.caiwu)|*.caiwu", DefaultExt = ".caiwu",
            FileName = Path.GetFileNameWithoutExtension(open.FileName) + "-恢复副本.caiwu" };
        if (save.ShowDialog(this) != true) return;
        if (File.Exists(save.FileName)) throw new LedgerValidationException("恢复副本不能覆盖已有账套，请选择新文件名。");
        WithBusy(() => _session!.RestoreTo(open.FileName, save.FileName));
        _session!.Open(save.FileName); BookOpened();
        NotificationText.Text = "备份已恢复到新文件并打开，原账套保持不变。";
    }, requireBook: false, discardOpening: true);

    private void WithBusy(Action action)
    {
        var previous = Mouse.OverrideCursor;
        try { Mouse.OverrideCursor = Cursors.Wait; action(); }
        finally { Mouse.OverrideCursor = previous; }
    }

    private void NewVoucher_Click(object sender, RoutedEventArgs e) => Run(() => EditVoucher(null), discardOpening: true);
    private void EditVoucher_Click(object sender, RoutedEventArgs e) => Run(() => EditVoucher(SelectedVoucher()), discardOpening: true);
    private void VoucherGrid_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    { if (VoucherGrid.SelectedItem is VoucherListRow) EditVoucher_Click(sender, e); }

    private Voucher SelectedVoucher() => VoucherGrid.SelectedItem is VoucherListRow row ? row.Value
        : throw new LedgerValidationException("请先选择一张凭证。");

    internal VoucherEditorWindow CreateVerificationEditor(Guid? id) => CreateVoucherEditor(id);
    private VoucherEditorWindow CreateVoucherEditor(Guid? id, Window? owner = null)
    {
        // Opening/reloading an editor loads its full data and token together. Submission never refreshes either.
        var editSnapshot = Service.GetSnapshot();
        var origin = new SessionBoundMutation(_session!, editSnapshot);
        var voucher = id is { } value ? editSnapshot.Vouchers.SingleOrDefault(v => v.Id == value)
            ?? throw new StoreConcurrencyException("该凭证已发生变化，请重新查询。") : null;
        var operatorName = OperatorName();
        return new VoucherEditorWindow(editSnapshot.Book, editSnapshot.Accounts, voucher, operatorName,
            draft => origin.GetService().SaveDraft(draft, operatorName), forceReadOnly: !PreviewLedgerService.AllowsWrites(editSnapshot.Book),
            expectedRevision: editSnapshot.Revision) { Owner = owner ?? this };
    }
    private void EditVoucher(Voucher? voucher, Window? owner = null)
    {
        var dialog = CreateVoucherEditor(voucher?.Id, owner);
        if (dialog.ShowDialog() == true)
        {
            Reload(); Pages.SelectedIndex = 1;
            VoucherGrid.SelectedItem = _voucherRows.FirstOrDefault(row => row.Id == dialog.SavedVoucher?.Id);
            NotificationText.Text = "凭证已保存为草稿；审核、记账后才计入账簿。";
        }
    }

    private void Review_Click(object sender, RoutedEventArgs e) => Run(() =>
    { var voucher = SelectedVoucher(); var origin = RequireOrigin(_voucherOrigin); origin.GetService().Review(voucher.Id, OperatorName(), origin.Context); Reload(); }, "凭证已审核。", discardOpening: true);
    private void CancelReview_Click(object sender, RoutedEventArgs e) => Run(() =>
    { var voucher = SelectedVoucher(); var origin = RequireOrigin(_voucherOrigin); origin.GetService().CancelReview(voucher.Id, OperatorName(), origin.Context); Reload(); }, "已取消审核；凭证可由制单人修改。", discardOpening: true);
    private void Post_Click(object sender, RoutedEventArgs e) => Run(() =>
    {
        var voucher = SelectedVoucher(); var origin = RequireOrigin(_voucherOrigin);
        if (MessageBox.Show(this, $"将记账 {voucher.Date:yyyy-MM-dd} {voucher.Kind}-{voucher.Number:0000}，金额 {AmountInput.Display(voucher.Lines.Sum(l => l.Debit))}。\n\n记账后不能直接修改或删除。是否继续？",
            "确认记账", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        origin.GetService().Post(voucher.Id, OperatorName(), origin.Context); Reload(); NotificationText.Text = "凭证已记账，可在余额表和明细账中联查。";
    }, discardOpening: true);
    private void DeleteVoucher_Click(object sender, RoutedEventArgs e) => Run(() =>
    {
        var voucher = SelectedVoucher(); var origin = RequireOrigin(_voucherOrigin);
        if (MessageBox.Show(this, $"删除草稿 {voucher.Kind}-{voucher.Number:0000}？", "删除草稿", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        origin.GetService().DeleteDraft(voucher.Id, OperatorName(), origin.Context); Reload(); VoucherGrid.SelectedItem = null; NotificationText.Text = "草稿已删除。";
    }, discardOpening: true);

    private void QueryVouchers()
    {
        if (!HasBook) return;
        var from = VoucherFrom.SelectedDate is { } f ? DateOnly.FromDateTime(f) : new DateOnly(Snapshot.Book.FiscalYear, Snapshot.Book.StartMonth, 1);
        var to = VoucherTo.SelectedDate is { } t ? DateOnly.FromDateTime(t) : new DateOnly(Snapshot.Book.FiscalYear, 12, 31);
        if (from > to) throw new LedgerValidationException("查询开始日期不能晚于结束日期。");
        var query = VoucherSearch.Text.Trim(); var state = VoucherStatusInput.SelectedIndex;
        _voucherRows = Snapshot.Vouchers.Where(v => v.Date >= from && v.Date <= to && (state <= 0 || (int)v.Status == state - 1))
            .Where(v => ReportingQueries.Matches(v, query)).Select(v => new VoucherListRow(v))
            .OrderBy(v => v.Value.Date).ThenBy(v => v.Value.Kind, StringComparer.Ordinal).ThenBy(v => v.Value.Number).ToArray();
        VoucherGrid.ItemsSource = _voucherRows;
        _voucherOrigin = new SessionBoundMutation(_session!, Snapshot);
        VoucherCountText.Text = $"当前查询 {_voucherRows.Count} 张凭证 · 金额合计 {AmountInput.Display(_voucherRows.Sum(v => v.Amount))}（含所选状态）";
    }

    private void AddAccount_Click(object sender, RoutedEventArgs e) => AccountEdit(null, null);
    private void AddChildAccount_Click(object sender, RoutedEventArgs e) => Run(() =>
    { if (AccountGrid.SelectedItem is not AccountDisplay row) throw new LedgerValidationException("请选择上级科目。"); AccountEdit(null, row.Code); });
    private void EditAccount_Click(object sender, RoutedEventArgs e) => Run(() =>
    { if (AccountGrid.SelectedItem is not AccountDisplay row) throw new LedgerValidationException("请选择会计科目。"); AccountEdit(row.Value, row.Parent); });
    private void AccountGrid_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    { if (AccountGrid.SelectedItem is AccountDisplay) EditAccount_Click(sender, e); }
    private void AccountEdit(Account? original, string? parent)
    {
        Run(() =>
        {
            var operatorName = OperatorName(); var origin = RequireOrigin(_accountOrigin);
            var dialog = new AccountWindow(original, parent, account => origin.GetService().SaveAccount(account, operatorName, origin.Context)) { Owner = this };
            if (dialog.ShowDialog() != true || dialog.Result is null) return;
            Reload(); NotificationText.Text = "会计科目已保存。";
        }, discardOpening: true);
    }
    private void DeleteAccount_Click(object sender, RoutedEventArgs e) => Run(() =>
    {
        if (AccountGrid.SelectedItem is not AccountDisplay row) throw new LedgerValidationException("请选择会计科目。");
        var origin = RequireOrigin(_accountOrigin);
        if (MessageBox.Show(this, $"删除科目 {row.Code} {row.Name}？", "删除科目", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        origin.GetService().DeleteAccount(row.Code, OperatorName(), origin.Context); Reload(); NotificationText.Text = "科目已删除。";
    }, discardOpening: true);

    private void ReloadOpeningRows()
    {
        _opening.Clear();
        foreach (var account in _accountRows.Where(a => a.IsLeaf))
        {
            var row = new OpeningBalanceEdit(account.Value);
            row.PropertyChanged += (_, _) => { _openingDirty = true; OpeningTotals(); };
            _opening.Add(row);
        }
        OpeningGrid.IsReadOnly = !CanWriteBook || Snapshot.Vouchers.Any(v => v.Status == VoucherStatus.Posted) || Snapshot.Book.ClosedThroughMonth >= Snapshot.Book.StartMonth;
        _openingOrigin = new SessionBoundMutation(_session!, Snapshot);
        _openingDirty = false; OpeningTotals();
    }
    private void OpeningTotals()
    {
        try
        {
            var values = _opening.Select(row => row.ToBalance()).ToArray();
            var debit = values.Sum(x => x.Debit); var credit = values.Sum(x => x.Credit);
            OpeningTotalsText.Text = $"借方合计 {AmountInput.Display(debit)}    贷方合计 {AmountInput.Display(credit)}    差额 {AmountInput.Display(debit - credit)}" + (_openingDirty ? "    · 尚未保存" : "");
        }
        catch (Exception ex) when (ex is LedgerValidationException or OverflowException) { OpeningTotalsText.Text = ex.Message; }
    }
    private void OpeningGrid_CellEditEnding(object sender, DataGridCellEditEndingEventArgs e) => Dispatcher.BeginInvoke(new Action(OpeningTotals));
    private void SaveOpening_Click(object sender, RoutedEventArgs e) => Run(() =>
    {
        OpeningGrid.CommitEdit(DataGridEditingUnit.Cell, true); OpeningGrid.CommitEdit(DataGridEditingUnit.Row, true);
        if (!_openingDirty) { NotificationText.Text = "没有待保存的期初修改。"; return; }
        var origin = RequireOrigin(_openingOrigin);
        origin.GetService().SetOpeningBalances(_opening.Select(row => row.ToBalance()).ToArray(), OperatorName(), origin.Context);
        _openingDirty = false; Reload();
    }, "期初余额已保存。请再次核对借贷合计。");
    private void ReloadOpening_Click(object sender, RoutedEventArgs e) => Run(Reload, "期初余额已重新载入。", discardOpening: true);
    private bool ConfirmDiscardOpening()
    {
        if (!_openingDirty) return true;
        return MessageBox.Show(this, "期初余额有尚未保存的修改。是否放弃这些修改？", "未保存的期初",
            MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes;
    }

    private static (DateOnly From, DateOnly To) Range(DatePicker from, DatePicker to)
    {
        if (from.SelectedDate is not { } f || to.SelectedDate is not { } t) throw new LedgerValidationException("请选择完整的查询期间。");
        if (f > t) throw new LedgerValidationException("查询开始日期不能晚于结束日期。");
        return (DateOnly.FromDateTime(f), DateOnly.FromDateTime(t));
    }
    private void QueryTrial()
    {
        var range = Range(TrialFrom, TrialTo); _trialRows = Service.GetTrialBalance(range.From, range.To);
        TrialGrid.ItemsSource = _trialRows; var leaf = _trialRows.Where(r => r.IsLeaf).ToArray();
        TrialTotalsText.Text = $"明细科目合计 · 本期借方 {AmountInput.Display(leaf.Sum(r => r.PeriodDebit))}    本期贷方 {AmountInput.Display(leaf.Sum(r => r.PeriodCredit))}    " +
            $"期末借方 {AmountInput.Display(leaf.Sum(r => r.ClosingDebit))}    期末贷方 {AmountInput.Display(leaf.Sum(r => r.ClosingCredit))}";
    }
    private void QueryLedger()
    {
        if (LedgerAccountInput.SelectedItem is not AccountDisplay account) { _ledgerRows = []; LedgerGrid.ItemsSource = _ledgerRows; return; }
        var range = Range(LedgerFrom, LedgerTo);
        _ledgerRows = Service.GetLedger(account.Code, range.From, range.To).Select(row => new LedgerDisplay(row)).ToArray();
        LedgerGrid.ItemsSource = _ledgerRows;
    }
    private void QueryCurrent()
    {
        if (Pages.SelectedIndex == 1) QueryVouchers();
        else if (Pages.SelectedIndex == 4) QueryTrial();
        else if (Pages.SelectedIndex == 5) QueryLedger();
    }
    private void Query_Click(object sender, RoutedEventArgs e) => Run(() => { Reload(); QueryCurrent(); }, discardOpening: true);
    private void TrialGrid_MouseDoubleClick(object sender, MouseButtonEventArgs e) => Run(() =>
    {
        if (TrialGrid.SelectedItem is not TrialBalanceRow row) return;
        LedgerAccountInput.SelectedValue = row.AccountCode;
        LedgerFrom.SelectedDate = TrialFrom.SelectedDate; LedgerTo.SelectedDate = TrialTo.SelectedDate;
        Pages.SelectedIndex = 5; QueryLedger();
    });
    private void LedgerGrid_MouseDoubleClick(object sender, MouseButtonEventArgs e) => Run(() =>
    {
        if (LedgerGrid.SelectedItem is not LedgerDisplay row || row.Value.VoucherId is not { } id) return;
        var voucher = Snapshot.Vouchers.FirstOrDefault(v => v.Id == id) ?? throw new LedgerValidationException("未找到对应凭证，请重新载入。");
        EditVoucher(voucher);
    }, discardOpening: true);

    private void CloseMonth_Click(object sender, RoutedEventArgs e) => Run(() =>
    {
        var book = _displayBook ?? throw new StoreConcurrencyException("请重新载入当前账套。");
        var origin = RequireOrigin(_displayOrigin); var month = book.ClosedThroughMonth + 1;
        if (month > 12) throw new LedgerValidationException("本年度已结账。首版尚不支持自动开立下一年度。");
        if (MessageBox.Show(this, $"确认结账 {book.FiscalYear}-{month:00}？\n请先检查余额并保存备份。结账后本期不再录入凭证。", "月度结账",
            MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        origin.GetService().CloseMonth(month, OperatorName(), origin.Context); Reload(); NotificationText.Text = $"{book.FiscalYear}-{month:00}已结账。";
    }, discardOpening: true);

    private ReportDocument CurrentReport()
    {
        var range = Pages.SelectedIndex switch
        {
            1 => Range(VoucherFrom, VoucherTo),
            4 => Range(TrialFrom, TrialTo),
            5 => Range(LedgerFrom, LedgerTo),
            _ => throw new LedgerValidationException("请在凭证列表、余额表或明细账页面导出。")
        };
        var kind = Pages.SelectedIndex switch { 1 => ReportKind.VoucherList, 4 => ReportKind.TrialBalance, _ => ReportKind.Ledger };
        return ReportingQueries.Build(Service, kind, LedgerAccountInput.SelectedValue as string, range.From, range.To,
            kind == ReportKind.VoucherList ? VoucherSearch.Text : "",
            kind == ReportKind.VoucherList && VoucherStatusInput.SelectedIndex > 0 ? (VoucherStatus)(VoucherStatusInput.SelectedIndex - 1) : null);
    }
    private void Export_Click(object sender, RoutedEventArgs e) => ExportCurrent(false);
    private void ExportHtml_Click(object sender, RoutedEventArgs e) => ExportCurrent(true);
    private void ExportCurrent(bool html) => Run(() =>
    {
        var report = CurrentReport(); var extension = html ? ".html" : ".csv";
        var save = new SaveFileDialog { Title = "导出 " + report.Title,
            Filter = html ? "分页 HTML (*.html)|*.html" : "CSV 文件 (*.csv)|*.csv", DefaultExt = extension,
            FileName = SafeFileName(report.Metadata.Book.Name + "-" + report.Title) + extension };
        if (save.ShowDialog(this) != true) return;
        using (var output = File.Create(save.FileName))
        {
            if (html) ReportExporter.WriteHtml(report, output, new HtmlExportOptions(12));
            else ReportExporter.WriteCsv(report, output);
        }
        NotificationText.Text = "已导出：" + save.FileName;
    });
    private void Print_Click(object sender, RoutedEventArgs e) => Run(() =>
    {
        if (Pages.SelectedIndex == 2)
        {
            var snapshot = Service.GetSnapshot();
            ReportPrinter.PrintTable(snapshot.Book.Name + " · 会计科目", snapshot.Book.TemplateVersion,
                ["代码", "名称", "上级", "方向", "状态"], snapshot.Accounts.Select(a =>
                    (IReadOnlyList<object?>)new object?[] { a.Code, a.Name, a.ParentCode, a.Direction == BalanceDirection.Debit ? "借" : "贷", a.IsActive ? "启用" : "停用" }));
        }
        else ReportPrinter.PrintReport(CurrentReport());
    });
    private void ReportCenter_Click(object sender, RoutedEventArgs e) => Run(() =>
    {
        var snapshot = Service.GetSnapshot(); var origin = new SessionBoundMutation(_session!, snapshot);
        var from = new DateOnly(snapshot.Book.FiscalYear, Math.Min(snapshot.Book.ClosedThroughMonth + 1, 12), 1);
        var to = new DateOnly(from.Year, from.Month, DateTime.DaysInMonth(from.Year, from.Month));
        var dialog = new ReportCenterWindow(snapshot.Accounts, from, to,
            (kind, account, first, last) => ReportingQueries.Build(origin.GetService(), kind, account, first, last),
            (id, owner) => { var source = origin.GetService(); EditVoucher(source.GetSnapshot().Vouchers.Single(v => v.Id == id), owner); }) { Owner = this };
        dialog.ShowDialog();
    }, discardOpening: true);

    private void ShowPage(int index) => Run(() => { Pages.SelectedIndex = index; QueryCurrent(); });
    private void VoucherPage_Click(object sender, RoutedEventArgs e) => ShowPage(1);
    private void AccountPage_Click(object sender, RoutedEventArgs e) => ShowPage(2);
    private void OpeningPage_Click(object sender, RoutedEventArgs e) => ShowPage(3);
    private void TrialPage_Click(object sender, RoutedEventArgs e) => ShowPage(4);
    private void LedgerPage_Click(object sender, RoutedEventArgs e) => ShowPage(5);
    private void AuditPage_Click(object sender, RoutedEventArgs e) => ShowPage(6);
    private void Pages_SelectionChanged(object sender, SelectionChangedEventArgs e)
    { if (_ready && HasBook && ReferenceEquals(e.Source, Pages)) Run(QueryCurrent); }

    private void BookInfo_Click(object sender, RoutedEventArgs e) => Run(() => MessageBox.Show(this,
        $"单位：{Snapshot.Book.Name}\n制度：{Snapshot.Book.Regime}\n模板版本：{Snapshot.Book.TemplateVersion}\n年度：{Snapshot.Book.FiscalYear}\n启用月份：{Snapshot.Book.StartMonth}\n已结账至：{Snapshot.Book.ClosedThroughMonth}月\n\n账套位置：{_session!.DatabasePath}\n\n当前为实验首版，未完成生产账务验收。",
        "账套信息", MessageBoxButton.OK, MessageBoxImage.Information));
    private void About_Click(object sender, RoutedEventArgs e) => MessageBox.Show(this,
        "财务套件 · 开发预览\n\n本版提供单年度人民币基础账务试用。财务报表、年结、成本分配、电子凭证与完整权限认证尚未完成，不能据此声称符合全部现行规范。\n\nCtrl+N 新凭证；Ctrl+O 打开账套；Ctrl+Shift+N 新建账套；Ctrl+L 凭证列表；F4 科目查找/列表审核；F7 平衡复制；Ctrl+S 保存；F10 备份。\n\n保留熟悉的业务流程，使用独立编写的代码与界面。",
        "本版范围与快捷键", MessageBoxButton.OK, MessageBoxImage.Information);
    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (Keyboard.Modifiers == (ModifierKeys.Control | ModifierKeys.Shift) && e.Key == Key.N) NewBook_Click(sender, e);
        else if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.O) OpenBook_Click(sender, e);
        else if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.N) NewVoucher_Click(sender, e);
        else if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.L) VoucherPage_Click(sender, e);
        else if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.S && Pages.SelectedIndex == 3) SaveOpening_Click(sender, e);
        else if (Keyboard.Modifiers == ModifierKeys.None && e.Key == Key.F10) Backup_Click(sender, e);
        else if (Keyboard.Modifiers == ModifierKeys.None && e.Key == Key.F4 && Pages.SelectedIndex == 1) Review_Click(sender, e);
        else return;
        e.Handled = true;
    }
    private void Window_Closing(object? sender, CancelEventArgs e)
    {
        if (!ConfirmDiscardOpening()) { e.Cancel = true; return; }
        _session?.Dispose();
    }
    private static SessionBoundMutation RequireOrigin(SessionBoundMutation? origin) => origin
        ?? throw new StoreConcurrencyException("显示数据的来源已失效，请重新载入并核对。");
    private static string SafeFileName(string name) => string.Concat(name.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c));
    private void UpdateWriteAccess(DependencyObject root)
    {
        foreach (var child in LogicalTreeHelper.GetChildren(root).OfType<DependencyObject>())
        {
            if (child is FrameworkElement element && Equals(element.Tag, "WriteOperation")) element.IsEnabled = CanWriteBook;
            UpdateWriteAccess(child);
        }
    }
}
