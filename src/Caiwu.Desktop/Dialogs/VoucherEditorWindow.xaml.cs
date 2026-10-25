using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Caiwu.Contracts;
using Caiwu.Desktop.Presentation;

namespace Caiwu.Desktop.Dialogs;

public partial class VoucherEditorWindow : Window
{
    private readonly BookInfo _book;
    private readonly IReadOnlyList<Account> _accounts;
    private readonly Voucher? _original;
    private readonly Func<VoucherDraft, Voucher> _save;
    private readonly bool _readOnly;
    private readonly ObservableCollection<VoucherLineEdit> _lines = [];
    private bool _dirty, _saved, _ready;
    public Voucher? SavedVoucher { get; private set; }

    public VoucherEditorWindow(BookInfo book, IReadOnlyList<Account> accounts, Voucher? voucher,
        string operatorName, Func<VoucherDraft, Voucher> save)
    {
        InitializeComponent();
        _book = book; _accounts = accounts; _original = voucher; _save = save;
        _readOnly = voucher is not null && voucher.Status != VoucherStatus.Draft;
        BookText.Text = book.Name;
        var defaultMonth = Math.Clamp(book.ClosedThroughMonth + 1, book.StartMonth, 12);
        DateInput.SelectedDate = voucher?.Date.ToDateTime(TimeOnly.MinValue) ?? new DateTime(book.FiscalYear, defaultMonth, 1);
        KindInput.Text = voucher?.Kind ?? "记";
        NumberText.Text = voucher?.Number.ToString("0000") ?? "自动编号";
        AttachmentInput.Text = (voucher?.AttachmentCount ?? 0).ToString();
        SignatureText.Text = $"制单：{voucher?.PreparedBy ?? operatorName}    审核：{voucher?.ReviewedBy ?? "—"}    状态：{Status(voucher?.Status)}";
        if (voucher is not null)
            foreach (var line in voucher.Lines) AddLine(VoucherLineEdit.From(line));
        while (_lines.Count < 4) AddLine(new VoucherLineEdit());
        LinesGrid.ItemsSource = _lines;
        LinesGrid.IsReadOnly = _readOnly;
        foreach (var control in new Control[] { DateInput, KindInput, AttachmentInput, SaveButton,
            AddLineButton, RemoveLineButton, PickAccountButton, BalanceButton }) control.IsEnabled = !_readOnly;
        DateInput.SelectedDateChanged += (_, _) => MarkDirty();
        KindInput.TextChanged += (_, _) => MarkDirty();
        AttachmentInput.TextChanged += (_, _) => MarkDirty();
        PreviewKeyDown += Window_PreviewKeyDown;
        Closing += OnClosing;
        Loaded += (_, _) => { _ready = true; if (!_readOnly) DateInput.Focus(); };
        UpdateTotals();
    }

    private static string Status(VoucherStatus? state) => state switch
    { VoucherStatus.Reviewed => "已审核（只读）", VoucherStatus.Posted => "已记账（只读）", _ => "草稿" };

    private void AddLine(VoucherLineEdit line)
    {
        line.AccountName = _accounts.FirstOrDefault(a => a.Code == line.AccountCode)?.Name ?? "";
        line.PropertyChanged += RowChanged; _lines.Add(line);
    }

    private void RowChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (sender is VoucherLineEdit line && e.PropertyName == nameof(VoucherLineEdit.AccountCode))
            line.AccountName = _accounts.FirstOrDefault(a => a.Code == line.AccountCode.Trim())?.Name ?? "未找到科目";
        MarkDirty(); UpdateTotals();
    }

    private void MarkDirty() { if (_ready && !_readOnly) _dirty = true; }

    private void UpdateTotals()
    {
        try
        {
            var debit = _lines.Sum(l => AmountInput.Parse(l.DebitText, "借方"));
            var credit = _lines.Sum(l => AmountInput.Parse(l.CreditText, "贷方"));
            TotalsText.Text = $"借方合计  {AmountInput.Display(debit)}       贷方合计  {AmountInput.Display(credit)}";
            var difference = debit - credit;
            DifferenceText.Text = difference == 0m ? "借贷平衡" : $"借贷差额  {AmountInput.Display(difference)}";
            DifferenceText.Foreground = difference == 0m ? Brushes.SeaGreen : Brushes.Firebrick;
        }
        catch (LedgerValidationException) { DifferenceText.Text = "金额格式有误"; DifferenceText.Foreground = Brushes.Firebrick; }
        catch (OverflowException) { DifferenceText.Text = "金额合计超出范围"; DifferenceText.Foreground = Brushes.Firebrick; }
    }

    private VoucherLineEdit? CurrentLine() => LinesGrid.CurrentCell.Item as VoucherLineEdit
        ?? LinesGrid.SelectedItem as VoucherLineEdit ?? _lines.FirstOrDefault();

    private void Save_Click(object sender, RoutedEventArgs e) => Save();
    private void Save()
    {
        if (_readOnly) return;
        try
        {
            LinesGrid.CommitEdit(DataGridEditingUnit.Cell, true); LinesGrid.CommitEdit(DataGridEditingUnit.Row, true);
            if (DateInput.SelectedDate is not { } date) throw new LedgerValidationException("请选择凭证日期。");
            if (!int.TryParse(AttachmentInput.Text, out var attachments) || attachments < 0)
                throw new LedgerValidationException("附单张数请输入非负整数。");
            var lines = _lines.Where(l => !l.IsEmpty).Select((line, index) => line.ToLine(index + 1)).ToArray();
            var draft = new VoucherDraft(_original?.Id, DateOnly.FromDateTime(date), KindInput.Text.Trim(),
                _original?.Number, attachments, lines);
            SavedVoucher = _save(draft); _saved = true; DialogResult = true;
        }
        catch (Exception ex) when (ex is LedgerValidationException or StoreConcurrencyException or ArgumentException
            or InvalidOperationException or OverflowException or System.IO.IOException)
        { ErrorText.Text = ex.Message; }
    }

    private void AddLine_Click(object sender, RoutedEventArgs e)
    {
        AddLine(new VoucherLineEdit()); MarkDirty(); FocusCell(_lines[^1], 0);
    }
    private void RemoveLine_Click(object sender, RoutedEventArgs e)
    {
        if (CurrentLine() is not { } line) return;
        line.PropertyChanged -= RowChanged; _lines.Remove(line);
        if (_lines.Count == 0) AddLine(new VoucherLineEdit()); MarkDirty(); UpdateTotals();
    }
    private void PickAccount_Click(object sender, RoutedEventArgs e) => PickAccount();
    private void PickAccount()
    {
        if (_readOnly || CurrentLine() is not { } line) return;
        LinesGrid.CommitEdit(DataGridEditingUnit.Cell, true);
        var picker = new AccountPickerWindow(_accounts) { Owner = this };
        if (picker.ShowDialog() == true && picker.Selected is { } account)
        { line.AccountCode = account.Code; FocusCell(line, 3); }
    }
    private void Balance_Click(object sender, RoutedEventArgs e) => BalanceCurrent();
    private void BalanceCurrent()
    {
        if (_readOnly || CurrentLine() is not { } line) return;
        try
        {
            LinesGrid.CommitEdit(DataGridEditingUnit.Cell, true);
            var index = _lines.IndexOf(line);
            if (index > 0 && string.IsNullOrWhiteSpace(line.Summary)) line.Summary = _lines[index - 1].Summary;
            var other = _lines.Where(l => !ReferenceEquals(l, line));
            var difference = other.Sum(l => AmountInput.Parse(l.DebitText, "借方") - AmountInput.Parse(l.CreditText, "贷方"));
            line.DebitText = difference < 0m ? AmountInput.Edit(-difference) : "";
            line.CreditText = difference > 0m ? AmountInput.Edit(difference) : "";
            ErrorText.Text = "";
        }
        catch (Exception ex) when (ex is LedgerValidationException or OverflowException) { ErrorText.Text = ex.Message; }
    }

    private void LinesGrid_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (_readOnly) return;
        if (e.Key == Key.F4) { PickAccount(); e.Handled = true; }
        else if (e.Key == Key.F7) { BalanceCurrent(); e.Handled = true; }
        else if (e.Key == Key.Enter && Keyboard.Modifiers == ModifierKeys.None && CurrentLine() is { } row)
        {
            var column = LinesGrid.CurrentColumn?.DisplayIndex ?? 0;
            LinesGrid.CommitEdit(DataGridEditingUnit.Cell, true);
            if (column < 4) FocusCell(row, column == 1 ? 3 : column + 1);
            else
            {
                var index = _lines.IndexOf(row) + 1;
                if (index == _lines.Count) AddLine(new VoucherLineEdit());
                var next = _lines[index]; if (string.IsNullOrWhiteSpace(next.Summary)) next.Summary = row.Summary;
                FocusCell(next, 1);
            }
            e.Handled = true;
        }
    }

    private void FocusCell(VoucherLineEdit row, int column)
    {
        Dispatcher.BeginInvoke(new Action(() =>
        {
            LinesGrid.ScrollIntoView(row, LinesGrid.Columns[column]);
            LinesGrid.CurrentCell = new DataGridCellInfo(row, LinesGrid.Columns[column]);
            LinesGrid.Focus(); LinesGrid.BeginEdit();
        }));
    }
    private void LinesGrid_SelectionChanged(object sender, SelectionChangedEventArgs e) { }
    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.S && Keyboard.Modifiers == ModifierKeys.Control) { Save(); e.Handled = true; }
        else if (e.Key == Key.Escape) { Close(); e.Handled = true; }
    }
    private void OnClosing(object? sender, CancelEventArgs e)
    {
        if (_dirty && !_saved && MessageBox.Show(this, "凭证尚未保存。是否放弃本次修改？", "未保存的凭证",
            MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) e.Cancel = true;
    }
    private void Print_Click(object sender, RoutedEventArgs e)
    {
        if (_original is null || _dirty)
        { ErrorText.Text = "请先保存凭证，再从凭证列表打开打印。"; return; }
        try { ReportPrinter.PrintVoucher(_book, _original); }
        catch (Exception ex) { ErrorText.Text = $"打印未完成：{ex.Message}"; }
    }
}
