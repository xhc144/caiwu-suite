using System.Collections.Immutable;
using System.ComponentModel;
using System.Globalization;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Microsoft.Win32;

namespace Caiwu.Invoicing.Wpf;

/// <summary>w_fp_lr_1/w_fp_lr_2 module view; original shell integration is intentionally external.</summary>
public sealed class InvoiceEntryView : UserControl
{
    private readonly InvoiceService service;
    private readonly InvoiceDirection direction;
    private readonly DataGrid grid = InvoiceUi.Grid();
    private readonly TextBox from;
    private readonly TextBox to;
    private readonly TextBox party = InvoiceUi.Text("");
    private readonly CheckBox unprocessed = new() { Content = "只显示未生成凭证的发票", VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock status = InvoiceUi.Label("");
    private List<EditableLine> lines = [];
    private InvoiceKind kind = InvoiceKind.Special;
    private long revision;
    public bool HasUnsavedChanges => lines.Any(x => x.Dirty || x.IsNew);

    public InvoiceEntryView(InvoiceService service, InvoiceDirection direction, Action returnToCaller)
    {
        this.service = service;
        this.direction = direction;
        var month = service.Read().OpenMonth;
        from = InvoiceUi.Text(month.FirstDay.ToString("yyyy-MM-dd"));
        to = InvoiceUi.Text(month.FirstDay.AddMonths(1).AddDays(-1).ToString("yyyy-MM-dd"));
        var root = new DockPanel();
        var menu = new Menu();
        var operation = new MenuItem { Header = "O.操作" };
        menu.Items.Add(operation);
        void Action(string text, Action action) { var item = new MenuItem { Header = text }; item.Click += (_, _) => InvoiceUi.Run(action); operation.Items.Add(item); }
        Action("另存...", Export);
        Action("数据刷新 Ctrl+F", RefreshWithPrompt);
        Action("存盘", Save);
        Action("增加 Ctrl+A", Add);
        Action("删除", Delete);
        Action("批量删除", DeleteAllVisible);
        Action("转入", Import);
        Action("凭证删除", DeleteVoucher);
        Action("查询", RefreshWithPrompt);
        Action("F.返回 Ctrl+F4", () => { if (MayLeave()) returnToCaller(); });
        DockPanel.SetDock(menu, Dock.Top); root.Children.Add(menu);
        var toolbar = new StackPanel { Orientation = Orientation.Horizontal };
        foreach (var item in new (string, Action)[] { ("另存", Export), ("刷新", RefreshWithPrompt), ("存盘", Save),
                     ("增加", Add), ("删除", Delete), ("批删除", DeleteAllVisible), ("转入", Import), ("删凭证", DeleteVoucher),
                     ("查询", RefreshWithPrompt), ("返回", () => { if (MayLeave()) returnToCaller(); }) })
            toolbar.Children.Add(InvoiceUi.Button(item.Item1, item.Item2));
        DockPanel.SetDock(toolbar, Dock.Top); root.Children.Add(toolbar);
        var filters = new OriginalFilterStrip();
        bool incoming = direction == InvoiceDirection.Input;
        void Place(string id, UIElement element)
        {
            var bounds = OriginalInvoiceLayout.Entry(direction)[id];
            filters.Place(element, bounds.X, bounds.Y, bounds.Width, bounds.Height);
        }
        Place("cb_3", InvoiceUi.Button("发票转入", Import)); Place("em_rq1", from);
        Place("st_1", InvoiceUi.Label("到")); Place("em_rq2", to);
        Place("cb_1", InvoiceUi.Button("开票日期查询", RefreshWithPrompt));
        Place("st_2", InvoiceUi.Label(incoming ? "销方企业名称" : "购方企业名称"));
        Place("sle_kh", party); Place("cb_2", InvoiceUi.Button("查询", RefreshWithPrompt));
        Place("st_4", InvoiceUi.Label("类型:"));
        var special = new RadioButton { Content = "专票", IsChecked = true, VerticalAlignment = VerticalAlignment.Center };
        var ordinary = new RadioButton { Content = "普票", VerticalAlignment = VerticalAlignment.Center };
        special.Click += (_, _) => SwitchKind(InvoiceKind.Special, special, ordinary);
        ordinary.Click += (_, _) => SwitchKind(InvoiceKind.Ordinary, special, ordinary);
        Place("rb_1", special); Place("rb_2", ordinary);
        unprocessed.Click += (_, _) => InvoiceUi.Run(RefreshWithPrompt);
        Place("cbx_1", unprocessed);
        DockPanel.SetDock(filters, Dock.Top); root.Children.Add(filters);
        DockPanel.SetDock(status, Dock.Bottom); root.Children.Add(status);
        root.Children.Add(grid);
        Content = root;
        InvoiceUi.Key(this, Key.A, ModifierKeys.Control, Add);
        InvoiceUi.Key(this, Key.F, ModifierKeys.Control, RefreshWithPrompt);
        InvoiceUi.Key(this, Key.F4, ModifierKeys.Control, () => { if (MayLeave()) returnToCaller(); });
        Reload();
    }

    public bool MayLeave()
    {
        grid.CommitEdit(DataGridEditingUnit.Cell, true);
        grid.CommitEdit(DataGridEditingUnit.Row, true);
        if (!HasUnsavedChanges) return true;
        var choice = MessageBox.Show("有数据未存盘，退出前是否存盘？", "发票", MessageBoxButton.YesNoCancel);
        if (choice == MessageBoxResult.Cancel) return false;
        if (choice == MessageBoxResult.Yes) { Save(); return !HasUnsavedChanges; }
        return true;
    }
    private void RefreshWithPrompt() { if (MayLeave()) Reload(); }
    private void SwitchKind(InvoiceKind next, RadioButton special, RadioButton ordinary) => InvoiceUi.Run(() =>
    {
        if (MayLeave()) { kind = next; Reload(); }
        special.IsChecked = kind == InvoiceKind.Special;
        ordinary.IsChecked = kind == InvoiceKind.Ordinary;
    });
    private void Reload()
    {
        var state = service.Read();
        revision = state.Revision;
        if (!DateOnly.TryParseExact(from.Text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var start)
            || !DateOnly.TryParseExact(to.Text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var end) || end < start)
            throw new InvoiceException("date-range", "请输入有效开票日期范围 yyyy-MM-dd。");
        lines = state.Documents.Where(x => x.Key.Direction == direction && x.Key.Kind == kind && x.IssueDate >= start && x.IssueDate <= end
                && x.PartyName.Contains(party.Text, StringComparison.OrdinalIgnoreCase) && (unprocessed.IsChecked != true || x.IsUnprocessed))
            .SelectMany(doc => doc.Rows.Select((row, index) => new EditableLine(doc.Id, false, row, index))).ToList();
        Rebind();
    }
    private void Rebind()
    {
        grid.Columns.Clear();
        var fields = (direction == InvoiceDirection.Output ? InvoiceColumns.Output : InvoiceColumns.Input)
            .Concat(lines.SelectMany(x => x.Raw.Fields.Keys)).Distinct().ToArray();
        foreach (var field in fields)
            InvoiceUi.Column(grid, Caption(field), $"[{field}]", field is "pz_bz" or "sh_bz" || field.StartsWith("p_", StringComparison.Ordinal));
        grid.ItemsSource = lines;
        status.Text = $"{(direction == InvoiceDirection.Output ? "销项" : "进项")}发票：{lines.Select(x => x.DocumentId).Distinct().Count()} 张，{lines.Count} 行";
    }
    private void Add()
    {
        var state = service.Read();
        var row = LegacyInvoiceRow.Parse("{}").Set("rq", state.OpenMonth.FirstDay.ToString("yyyy-MM-dd"))
            .Set("sh_bz", "0").Set("pz_bz", "0");
        var line = new EditableLine(Guid.NewGuid(), true, row);
        lines.Add(line); Rebind(); grid.SelectedItem = line; grid.ScrollIntoView(line);
    }
    private void Save()
    {
        grid.CommitEdit(DataGridEditingUnit.Cell, true); grid.CommitEdit(DataGridEditingUnit.Row, true);
        var edits = lines.GroupBy(x => ((x.Raw.Text("fpdm") ?? "").Trim(), (x.Raw.Text("fphm") ?? "").Trim()))
            .Where(x => x.Any(y => y.Dirty || y.IsNew)).Select(group =>
            {
                var existing = group.Where(x => !x.IsNew).Select(x => x.DocumentId).Distinct().ToArray();
                if (existing.Length > 1) throw new InvoiceException("duplicate-invoice", "两张已有发票不能通过改号码合并。");
                return new InvoiceEdit(existing.Length == 0 ? null : existing[0], new(direction, kind, group.Select(x => x.Raw).ToImmutableArray()));
            }).ToImmutableArray();
        if (edits.Length == 0) return;
        service.SaveMany(revision, edits);
        Reload();
    }
    private void RequireSaved()
    {
        grid.CommitEdit(DataGridEditingUnit.Cell, true); grid.CommitEdit(DataGridEditingUnit.Row, true);
        if (HasUnsavedChanges) throw new InvoiceException("unsaved", "有数据未存盘，请先存盘或刷新后再操作。");
    }
    private void Delete()
    {
        RequireSaved();
        var selected = grid.SelectedItems.Cast<EditableLine>().Select(x => new InvoiceRowSelection(x.DocumentId, x.SourceRowIndex)).ToImmutableArray();
        if (selected.Length == 0) throw new InvoiceException("selection", "请先查询并选择要删除的发票行。");
        if (MessageBox.Show($"删除 {selected.Length} 条数据，请确认。", "发票", MessageBoxButton.YesNo, MessageBoxImage.Question, MessageBoxResult.No) != MessageBoxResult.Yes) return;
        service.DeleteRows(revision, selected); Reload();
    }
    private void DeleteAllVisible()
    {
        RequireSaved();
        var ids = lines.Select(x => x.DocumentId).Distinct().ToImmutableArray();
        if (ids.Length == 0) throw new InvoiceException("selection", "请先将需要删除的发票，用【查询】功能查询到当前界面上！");
        if (MessageBox.Show($"请确定是否要删除以下 {ids.Length} 张发票？", "发票", MessageBoxButton.YesNo,
                MessageBoxImage.Question, MessageBoxResult.No) != MessageBoxResult.Yes) return;
        if (MessageBox.Show("再次确认，是否要删除以下发票？", "发票", MessageBoxButton.YesNo,
                MessageBoxImage.Question, MessageBoxResult.No) != MessageBoxResult.Yes) return;
        var result = service.DeleteBatch(revision, ids); Reload();
        status.Text = $"删除 {result.DeletedInvoices} 张；审核、后续处理或结账保护跳过 {result.Skipped.Length} 张。";
    }
    private void DeleteVoucher()
    {
        RequireSaved();
        var selected = grid.SelectedItem as EditableLine ?? throw new InvoiceException("selection", "请选择发票。");
        var journal = service.Read().Journals.SingleOrDefault(x => x.SourceIds.Contains(selected.DocumentId))
            ?? throw new InvoiceException("journal-missing", "未找到本合成工作区生成的凭证；原回链需总账适配器核验。");
        if (MessageBox.Show($"是否删除发票生成的凭证？该凭证关联 {journal.SourceIds.Length} 张发票。", "发票", MessageBoxButton.YesNo,
                MessageBoxImage.Question, MessageBoxResult.No) != MessageBoxResult.Yes) return;
        service.DeleteGeneratedVoucherFromSandbox(revision, journal.Id); Reload();
    }
    private void Import()
    {
        RequireSaved();
        var dialog = new OpenFileDialog { Filter = "发票切片交换文件 (*.invoice-transfer.json)|*.invoice-transfer.json", CheckFileExists = true };
        if (dialog.ShowDialog() != true) return;
        var transfer = InvoiceJson.Deserialize<InvoiceTransfer>(File.ReadAllText(dialog.FileName));
        if (transfer.Invoices.Any(x => x.Direction != direction || x.Kind != kind))
            throw new InvoiceException("transfer-kind", "交换文件方向/票种与当前窗口不一致，请切换进销项和专/普票。");
        var result = service.ImportTransfer(revision, transfer);
        Reload(); status.Text = $"转入 {result.Added} 张；重复跳过 {result.Duplicates} 张。";
    }
    private void Export()
    {
        RequireSaved();
        var state = service.Read();
        var selected = lines.Select(x => x.DocumentId).ToHashSet();
        var transfer = new InvoiceTransfer(1, state.BookId, state.Product, state.Documents.Where(x => selected.Contains(x.Id))
            .Select(x => new InvoiceImport(x.Key.Direction, x.Key.Kind, x.Rows)).ToImmutableArray());
        var dialog = new SaveFileDialog { Filter = "发票切片交换文件|*.invoice-transfer.json", DefaultExt = ".invoice-transfer.json", AddExtension = true };
        if (dialog.ShowDialog() != true) return;
        // A new file is required even if a race occurs after the file picker.
        using var stream = new FileStream(dialog.FileName, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        JsonSerializer.Serialize(stream, transfer, InvoiceJson.Options);
    }
    private string Caption(string field) => field switch
    {
        "fpdm" => "发票代码", "fphm" => "发票号码", "g_qymc" => direction == InvoiceDirection.Output ? "购方企业名称" : "销方企业名称",
        "g_sh" => direction == InvoiceDirection.Output ? "购方税号" : "销方税号", "rq" => "开票日期", "rq_2" => "认证日期", "je0" => "金额",
        "se" => "税额", "je1" => "开票总额", "sl" => "数量", "dj" => "单价", "slv" => "税率", "fpzt" => "发票状态", "sh_bz" => "审核/认证方式",
        "pz_bz" => "处理标志", "spmc" => "商品名称", "gg" => "规格", "jldw" => "单位", "bz1" => "备注", _ => field
    };

    private sealed class EditableLine(Guid documentId, bool isNew, LegacyInvoiceRow row, int sourceRowIndex = -1) : INotifyPropertyChanged
    {
        public Guid DocumentId { get; } = documentId;
        public bool IsNew { get; } = isNew;
        public int SourceRowIndex { get; } = sourceRowIndex;
        public LegacyInvoiceRow Raw { get; private set; } = row;
        public bool Dirty { get; private set; }
        public event PropertyChangedEventHandler? PropertyChanged;
        public string? this[string field]
        {
            get => Raw.Text(field);
            set
            {
                if (value == Raw.Text(field)) return;
                object? stored = string.IsNullOrEmpty(value) ? null : value;
                if (field is "sl" or "dj" or "je0" or "slv" or "se" or "je1" or "nf" or "yf" or "xh"
                    && decimal.TryParse(value, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var number)) stored = number;
                Raw = Raw.Set(field, stored); Dirty = true;
                PropertyChanged?.Invoke(this, new("Item[]"));
            }
        }
    }
}
