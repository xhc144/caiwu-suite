using System.Collections.ObjectModel;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Automation;
using Caiwu.Contracts;
using Caiwu.Desktop.Presentation;

namespace Caiwu.Desktop.Features;

/// <summary>Host-owned unsaved draft workspace. Closing or cancelling performs no ledger write.</summary>
public sealed class CopiedDraftWindow : SessionFeatureWindow
{
    private readonly PendingVoucherCopy pending;
    private readonly ObservableCollection<VoucherLineEdit> lines;
    private readonly DatePicker date = new();
    private readonly TextBox kind = new() { Width = 80 }, number = new() { Width = 80 }, attachments = new() { Width = 80 };
    private readonly DataGrid grid;
    private readonly Button save = new() { Content = "保存新草稿" };
    private bool busy;
    public Voucher? SavedVoucher => pending.SavedVoucher;

    public CopiedDraftWindow(PendingVoucherCopy pending) : base(pending.Binding)
    {
        this.pending = pending; Title = "复制凭证 · 未保存的新草稿";
        AutomationProperties.SetAutomationId(save, "Feature.Copy.Save");
        AutomationProperties.SetAutomationId(date, "Feature.Copy.Date");
        AutomationProperties.SetAutomationId(kind, "Feature.Copy.Kind");
        AutomationProperties.SetAutomationId(number, "Feature.Copy.Number");
        AutomationProperties.SetAutomationId(attachments, "Feature.Copy.Attachments");
        var draft = pending.Plan.Draft;
        lines = new(draft.Lines.Select(VoucherLineEdit.From));
        date.SelectedDate = draft.Date.ToDateTime(TimeOnly.MinValue); kind.Text = draft.Kind;
        number.Text = draft.Number?.ToString(CultureInfo.InvariantCulture) ?? "";
        attachments.Text = draft.AttachmentCount.ToString(CultureInfo.InvariantCulture);
        var header = new WrapPanel { Margin = new(0, 0, 0, 12) };
        foreach (var field in new (string, Control)[] { ("日期", date), ("类别", kind), ("编号", number), ("附件数", attachments) })
        { header.Children.Add(new TextBlock { Text = field.Item1, Margin = new(8), VerticalAlignment = VerticalAlignment.Center }); header.Children.Add(field.Item2); }
        DockPanel.SetDock(header, Dock.Top); Body.Children.Add(header);
        var actions = new WrapPanel { Margin = new(0, 12, 0, 0) };
        save.Click += async (_, _) => await SaveAsync(); actions.Children.Add(save);
        var cancel = new Button { Content = "取消并关闭", IsCancel = true }; actions.Children.Add(cancel);
        DockPanel.SetDock(actions, Dock.Bottom); Body.Children.Add(actions);
        grid = new() { AutoGenerateColumns = false, ItemsSource = lines, CanUserAddRows = false, CanUserDeleteRows = false };
        AutomationProperties.SetAutomationId(grid, "Feature.Copy.Lines");
        foreach (var column in new[] { ("科目编码", nameof(VoucherLineEdit.AccountCode)), ("摘要", nameof(VoucherLineEdit.Summary)),
            ("借方", nameof(VoucherLineEdit.DebitText)), ("贷方", nameof(VoucherLineEdit.CreditText)) })
            grid.Columns.Add(new DataGridTextColumn { Header = column.Item1, Width = new DataGridLength(column.Item1 == "摘要" ? 3 : 1, DataGridLengthUnitType.Star),
                Binding = new Binding(column.Item2) { UpdateSourceTrigger = UpdateSourceTrigger.PropertyChanged } });
        Body.Children.Add(grid);
        Status.Text = $"{Binding.Shown.Book.Name} · 制单：{pending.Plan.PreparedBy} · 源凭证仅供复制；保存前未写入账套。";
        Closing += (_, e) => { if (busy) { e.Cancel = true; Status.Text = "正在保存，请等待结果后关闭。"; } };
    }

    private async Task SaveAsync()
    {
        if (busy || !CheckSession()) return;
        try
        {
            grid.CommitEdit(DataGridEditingUnit.Cell, true); grid.CommitEdit(DataGridEditingUnit.Row, true);
            if (date.SelectedDate is not { } value || !int.TryParse(number.Text, NumberStyles.None, CultureInfo.InvariantCulture, out var n) ||
                n <= 0 || !int.TryParse(attachments.Text, NumberStyles.None, CultureInfo.InvariantCulture, out var count) || count < 0)
                throw new LedgerValidationException("请填写完整日期、正整数编号和非负整数附件数。");
            var draft = pending.Plan.Draft with { Date = DateOnly.FromDateTime(value), Kind = kind.Text.Trim(), Number = n,
                AttachmentCount = count, Lines = lines.Select((line, index) => line.ToLine(index + 1)).ToArray() };
            busy = true; Body.IsEnabled = false; Status.Text = "正在保存新草稿…";
            await pending.SaveAsync(draft);
            busy = false; DialogResult = true;
        }
        catch (Exception ex) { Status.Text = "未保存，输入已保留：" + ex.Message; }
        finally { busy = false; Body.IsEnabled = Binding.IsCurrent && SavedVoucher is null; }
    }
}
