using System.Windows;
using System.Windows.Controls;
using System.Windows.Automation;
using Caiwu.Summaries;

namespace Caiwu.Desktop.Features;

/// <summary>Small async WPF adapter over the owner's actual SummaryManagerState, including its edit-version rules.</summary>
public sealed class AsyncSummaryManagerWindow : SessionFeatureWindow
{
    public SummaryManagerState State { get; }
    private readonly AsyncSummaryStateAdapter adapter;
    private readonly ListBox categories = new() { DisplayMemberPath = "Name", MinHeight = 120 };
    private readonly ListBox entries = new() { DisplayMemberPath = "Text", MinHeight = 180 };
    private readonly ComboBox draftCategory = new() { DisplayMemberPath = "Name", SelectedValuePath = "Id", MinWidth = 180 };
    private readonly TextBox draft = new() { AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 100, MaxLength = 4000 };
    private readonly TextBlock heading = new() { FontWeight = FontWeights.SemiBold };
    private readonly TextBox search;
    private readonly Button save;
    private readonly List<(Button Button, Func<bool> Enabled)> buttons = [];
    private bool busy, rendering;

    public AsyncSummaryManagerWindow(FeatureSessionBinding binding, SummaryFeatureRegistration registration) : base(binding)
    {
        Title = "常用摘要管理 · " + binding.Shown.Book.Name;
        AutomationProperties.SetAutomationId(categories, "Feature.Summary.Categories");
        AutomationProperties.SetAutomationId(entries, "Feature.Summary.Entries");
        AutomationProperties.SetAutomationId(draft, "Feature.Summary.Draft");
        adapter = new(new SessionSummaryCatalog(binding, registration.Catalog, registration.ManagementPermission), binding.Shown.Book.Name);
        State = adapter.State;
        var top = new StackPanel(); DockPanel.SetDock(top, Dock.Top);
        top.Children.Add(new TextBlock { Text = $"摘要文件：{registration.Catalog.Location.CatalogPath}", TextWrapping = TextWrapping.Wrap });
        top.Children.Add(new TextBlock { Text = $"备份附件：{registration.BackupAttachmentKey} · {registration.BackupPolicyDescription}", TextWrapping = TextWrapping.Wrap });
        search = new TextBox { Margin = new(0, 8, 0, 8), MaxLength = 512, ToolTip = "按摘要和分类名称搜索" };
        AutomationProperties.SetAutomationId(search, "Feature.Summary.Search");
        search.TextChanged += (_, _) => { if (busy || rendering) return; State.Query = search.Text; Render(); };
        top.Children.Add(search); Body.Children.Add(top);
        var footer = new WrapPanel { Margin = new(0, 12, 0, 0) }; DockPanel.SetDock(footer, Dock.Bottom);
        save = Add(footer, "保存更改", () => _ = ExecuteAsync(adapter.SaveAsync), () => State.CanSave);
        AutomationProperties.SetAutomationId(save, "Feature.Summary.Save");
        Add(footer, "取消本次编辑", () => { State.CancelEdit(); Render(); }, () => State.HasPendingEdit);
        Add(footer, "重新载入", () => _ = ExecuteAsync(adapter.RefreshAsync), () => State.CanRefresh);
        var close = new Button { Content = "关闭", IsCancel = true }; footer.Children.Add(close); Body.Children.Add(footer);
        var columns = new Grid(); columns.ColumnDefinitions.Add(new() { Width = new(250) }); columns.ColumnDefinitions.Add(new());
        var left = new DockPanel { Margin = new(0, 0, 12, 0) }; Grid.SetColumn(left, 0);
        var categoryActions = new WrapPanel(); DockPanel.SetDock(categoryActions, Dock.Bottom);
        Add(categoryActions, "新增分类", () => Begin(State.BeginAddCategory), () => State.CanStartEdit);
        Add(categoryActions, "改名", () => Begin(State.BeginRenameCategory), () => State.CanEditCategory);
        Add(categoryActions, "删除分类", () => Begin(State.BeginDeleteCategory), () => State.CanEditCategory);
        Add(categoryActions, "全部分类", () => { State.SelectedCategoryId = null; Render(); }, () => State.CanBrowse);
        left.Children.Add(categoryActions); left.Children.Add(categories); columns.Children.Add(left);
        var right = new DockPanel(); Grid.SetColumn(right, 1);
        var editor = new StackPanel(); DockPanel.SetDock(editor, Dock.Bottom);
        var entryActions = new WrapPanel();
        Add(entryActions, "新增摘要", () => Begin(State.BeginAddSummary), () => State.CanAddSummary);
        Add(entryActions, "编辑摘要", () => Begin(State.BeginEditSummary), () => State.CanEditSummary);
        Add(entryActions, "删除摘要", () => Begin(State.BeginDeleteSummary), () => State.CanEditSummary);
        editor.Children.Add(entryActions); editor.Children.Add(heading); editor.Children.Add(draftCategory); editor.Children.Add(draft);
        right.Children.Add(editor); right.Children.Add(entries); columns.Children.Add(right); Body.Children.Add(columns);
        categories.SelectionChanged += (_, _) => { if (!rendering && !busy && State.CanBrowse) { State.SelectedCategoryId = (categories.SelectedItem as SummaryCategory)?.Id; Render(); } };
        entries.SelectionChanged += (_, _) => { if (!rendering && !busy && State.CanBrowse) { State.SelectedEntryId = (entries.SelectedItem as SummaryManagerRow)?.Id; Render(); } };
        draft.TextChanged += (_, _) => { if (!rendering && !busy) State.DraftText = draft.Text; };
        draftCategory.SelectionChanged += (_, _) => { if (!rendering && !busy) State.DraftCategoryId = draftCategory.SelectedValue as Guid?; };
        Loaded += async (_, _) => await ExecuteAsync(adapter.RefreshAsync);
        Closing += (_, e) => { if (busy) { e.Cancel = true; Status.Text = "正在完成摘要文件操作，请等待结果后关闭。"; } };
        Render();
    }

    private Button Add(Panel parent, string title, Action action, Func<bool> enabled)
    {
        var button = new Button { Content = title }; button.Click += (_, _) => { if (!busy && CheckSession()) action(); };
        buttons.Add((button, enabled)); parent.Children.Add(button); return button;
    }
    private void Begin(Func<bool> begin) { if (adapter.BeginEdit(begin)) { Render(); draft.Focus(); } }
    private async Task ExecuteAsync(Func<Task<bool>> action)
    {
        if (busy || !CheckSession()) return;
        busy = true; Body.IsEnabled = false; Status.Text = "正在处理摘要文件…";
        try { await action(); }
        catch (Exception ex) { Status.Text = "操作未完成，输入已保留：" + ex.Message; return; }
        finally { busy = false; Body.IsEnabled = Binding.IsCurrent; }
        Render();
    }
    private void Render()
    {
        rendering = true;
        try
        {
            search.Text = State.Query;
            categories.ItemsSource = State.Categories; categories.SelectedItem = State.Categories.FirstOrDefault(c => c.Id == State.SelectedCategoryId);
            entries.ItemsSource = State.Rows; entries.SelectedItem = State.SelectedEntry;
            categories.IsEnabled = entries.IsEnabled = State.CanBrowse;
            draftCategory.ItemsSource = State.Categories; draftCategory.SelectedValue = State.DraftCategoryId;
            draftCategory.Visibility = State.IsSummaryEditor ? Visibility.Visible : Visibility.Collapsed;
            draft.Text = State.DraftText; draft.IsReadOnly = !State.HasPendingEdit || State.IsDeleteEditor;
            heading.Text = State.EditHeading; save.Content = State.SaveButtonText;
            foreach (var pair in buttons) pair.Button.IsEnabled = !busy && pair.Enabled();
            Status.Text = State.StatusText; CheckSession();
        }
        finally { rendering = false; }
    }
}
