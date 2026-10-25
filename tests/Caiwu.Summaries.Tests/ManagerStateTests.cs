using Caiwu.Summaries;

namespace Caiwu.Summaries.Tests;

public sealed class ManagerStateTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "caiwu-summary-manager-" + Guid.NewGuid().ToString("N"));
    private readonly Guid book = Guid.NewGuid();
    private SummaryCatalogLocation Location => new(root, Path.Combine(root, "catalog.json"), book);
    public void Dispose() { if (Directory.Exists(root)) Directory.Delete(root, true); }

    [Fact]
    public void CategoryAndSummaryManagementRequiresSaveAndReallyPersists()
    {
        var catalog = JsonSummaryCatalog.Create(Location);
        var state = new SummaryManagerState(catalog, "合成账套");
        Assert.True(state.Refresh());
        Assert.Equal(book, state.BookId);
        Assert.Equal("合成账套", state.BookDisplayName);
        var initial = catalog.Read().Version;
        Assert.True(state.BeginAddCategory());
        state.DraftText = "费用";
        Assert.Equal(initial, catalog.Read().Version);
        Assert.True(state.Save());
        var first = Assert.Single(catalog.Read().Categories);
        Assert.Equal(first.Id, state.SelectedCategoryId);
        Assert.True(state.BeginRenameCategory());
        state.DraftText = "日常费用";
        Assert.Equal("费用", Assert.Single(catalog.Read().Categories).Name);
        Assert.True(state.Save());
        Assert.Equal(new SummaryCategory(first.Id, "日常费用"), Assert.Single(JsonSummaryCatalog.Open(Location).Read().Categories));

        Assert.True(state.BeginAddSummary());
        state.DraftText = "支付办公费\n保留完整说明";
        Assert.Empty(catalog.Read().Entries);
        Assert.False(state.CanAccept);
        Assert.True(state.Save());
        var entry = Assert.Single(catalog.Read().Entries);
        Assert.Equal(entry.Id, state.SelectedEntryId);
        Assert.True(state.BeginEditSummary());
        state.DraftText = "支付本月办公费";
        Assert.True(state.Save());
        Assert.Equal(new SummaryEntry(entry.Id, first.Id, "支付本月办公费"), Assert.Single(JsonSummaryCatalog.Open(Location).Read().Entries));

        Assert.True(state.BeginDeleteCategory());
        Assert.Equal("确认删除并保存", state.SaveButtonText);
        Assert.False(state.Save());
        Assert.Contains("仍有摘要", state.ErrorMessage);
        Assert.Equal("日常费用", state.DraftText);
        Assert.True(state.HasPendingEdit);
        state.CancelEdit();
        Assert.True(state.BeginDeleteSummary());
        var beforeDelete = catalog.Read().Version;
        state.CancelEdit();
        Assert.Equal(beforeDelete, catalog.Read().Version);
        Assert.True(state.BeginDeleteSummary());
        Assert.True(state.Save());
        Assert.Empty(catalog.Read().Entries);
        Assert.True(state.BeginDeleteCategory());
        Assert.True(state.Save());
        Assert.Empty(JsonSummaryCatalog.Open(Location).Read().Categories);
    }

    [Fact]
    public void CancelledDraftNeverWritesAndDoesNotUndoEarlierExplicitSaves()
    {
        var catalog = JsonSummaryCatalog.Create(Location);
        var state = new SummaryManagerState(catalog, "合成账套");
        Assert.True(state.Refresh());
        Assert.True(state.BeginAddCategory()); state.DraftText = "已保存分类";
        Assert.True(state.Save());
        var saved = catalog.Read().Version;
        Assert.True(state.BeginAddSummary()); state.DraftText = "未确认内容";
        Assert.False(state.Refresh());
        Assert.Equal(saved, state.EditVersion);
        Assert.Equal("未确认内容", state.DraftText);
        Assert.False(state.AcceptSelection().Accepted);
        Assert.False(state.CancelSelection().Accepted);
        state.CancelEdit();
        Assert.Equal(saved, catalog.Read().Version);
        Assert.Empty(catalog.Read().Entries);
        Assert.Single(catalog.Read().Categories);
        Assert.False(state.HasPendingEdit);
    }

    [Fact]
    public void StaleWindowCannotRefreshAwayItsCapturedVersionAndKeepsInputOnConflict()
    {
        var catalog = JsonSummaryCatalog.Create(Location);
        var snapshot = catalog.AddCategory("原分类", catalog.Read().Version);
        var state = new SummaryManagerState(catalog, "旧窗口");
        Assert.True(state.Refresh());
        state.SelectedCategoryId = snapshot.Categories[0].Id;
        Assert.True(state.BeginRenameCategory());
        state.DraftText = "我的待保存名称";
        var captured = state.EditVersion;
        var other = JsonSummaryCatalog.Open(Location);
        other.AddCategory("另一窗口的分类", other.Read().Version);
        Assert.False(state.Refresh());
        Assert.False(state.Save());
        Assert.Equal(SummaryCatalogStatus.Conflict, state.Status);
        Assert.Equal(captured, state.EditVersion);
        Assert.Equal("我的待保存名称", state.DraftText);
        Assert.True(state.HasPendingEdit);
        Assert.False(state.CanAccept);
        Assert.False(state.CanSave);
        Assert.Equal("原分类", catalog.Read().Categories.Single(c => c.Id == snapshot.Categories[0].Id).Name);
        Assert.Equal(2, catalog.Read().Categories.Count);
        state.CancelEdit();
        Assert.False(state.CanStartEdit);
        Assert.Equal(SummaryCatalogStatus.Conflict, state.Status);
        Assert.True(state.Refresh());
        Assert.True(state.BeginRenameCategory());
        state.DraftText = "核对后重新编辑";
        Assert.True(state.Save());
        Assert.Equal(2, catalog.Read().Categories.Count);
        Assert.Equal("核对后重新编辑", catalog.Read().Categories.Single(c => c.Id == snapshot.Categories[0].Id).Name);
    }

    [Fact]
    public void InvalidInputAndWriteFailureKeepDraftAndAllowExplicitRetry()
    {
        var catalog = JsonSummaryCatalog.Create(Location);
        var state = new SummaryManagerState(catalog, "合成账套");
        Assert.True(state.Refresh()); Assert.True(state.BeginAddCategory());
        state.DraftText = "　 \n";
        var captured = state.EditVersion;
        Assert.False(state.Save());
        Assert.Equal("　 \n", state.DraftText); Assert.Equal(captured, state.EditVersion);
        state.DraftText = "修正后分类"; Assert.True(state.Save());

        var attempt = 0;
        var faulty = JsonSummaryCatalog.WithWriter(Location, (stream, bytes) =>
        {
            if (attempt++ == 0) { stream.Write(bytes, 0, 17); throw new IOException("synthetic partial write failure"); }
            stream.Write(bytes);
        });
        var editor = new SummaryManagerState(faulty, "写入失败窗口");
        Assert.True(editor.Refresh()); Assert.True(editor.BeginAddSummary()); editor.DraftText = "失败后保留输入";
        var before = File.ReadAllBytes(Location.CatalogPath);
        Assert.False(editor.Save());
        Assert.Equal(SummaryCatalogStatus.IoError, editor.Status);
        Assert.Equal("失败后保留输入", editor.DraftText);
        Assert.Equal(before, File.ReadAllBytes(Location.CatalogPath));
        Assert.True(editor.CanSave);
        Assert.True(editor.Save());
        Assert.Equal("失败后保留输入", Assert.Single(JsonSummaryCatalog.Open(Location).Read().Entries).Text);
    }

    [Fact]
    public void SummaryCanMoveCategoriesAndSearchSelectionNeverModifiesVoucher()
    {
        var catalog = JsonSummaryCatalog.Create(Location);
        var s = catalog.AddCategory("收款", catalog.Read().Version);
        var first = s.Categories[0].Id;
        s = catalog.AddCategory("其他收入", s.Version);
        var second = s.Categories[1].Id;
        s = catalog.AddSummary(first, "收到款项", s.Version);
        var entry = s.Entries[0];
        var state = new SummaryManagerState(catalog, "合成账套");
        Assert.True(state.Refresh()); state.SelectedEntryId = entry.Id;
        Assert.True(state.BeginEditSummary());
        state.DraftCategoryId = second; state.DraftText = "收到其他款项";
        Assert.True(state.Save());
        Assert.Equal(entry.Id, Assert.Single(state.Rows).Id);
        Assert.Equal(second, state.SelectedCategoryId);
        Assert.Equal("其他收入", Assert.Single(state.Rows).CategoryName);
        var afterSave = catalog.Read().Version;
        state.Query = "没有匹配";
        Assert.Empty(state.Rows); Assert.False(state.CanAccept);
        Assert.False(state.AcceptSelection().Accepted);
        state.Query = "其他 款项"; state.SelectedEntryId = entry.Id;
        var original = "原分录的手写摘要";
        var canceled = state.CancelSelection();
        if (canceled.Accepted) original = canceled.Value!.Text;
        Assert.Equal("原分录的手写摘要", original);
        var chosen = state.AcceptSelection();
        Assert.True(chosen.Accepted); Assert.Equal("收到其他款项", chosen.Value!.Text);
        Assert.Equal(afterSave, catalog.Read().Version);
    }

    [Fact]
    public void CorruptionWhileEditingRetainsInputAndDisablesFurtherWritesUntilReload()
    {
        var catalog = JsonSummaryCatalog.Create(Location);
        var state = new SummaryManagerState(catalog, "合成账套");
        Assert.True(state.Refresh()); Assert.True(state.BeginAddCategory()); state.DraftText = "我的输入";
        File.WriteAllText(Location.CatalogPath, "broken");
        Assert.False(state.Save()); Assert.Equal("我的输入", state.DraftText);
        Assert.False(state.CanSave); Assert.False(state.CanAccept);
        state.CancelEdit();
        Assert.False(state.CanStartEdit);
        Assert.Contains("损坏", state.ErrorMessage);
        Assert.False(state.Refresh()); Assert.Equal(SummaryCatalogStatus.InvalidData, state.Status);
        Assert.Equal("broken", File.ReadAllText(Location.CatalogPath));
    }

    [Fact]
    public void InvalidQueryInManagerClearsSelectionWithoutClearingCatalogOrAnExistingConflict()
    {
        var catalog = JsonSummaryCatalog.Create(Location);
        var s = catalog.AddCategory("合成中文", catalog.Read().Version);
        s = catalog.AddSummary(s.Categories[0].Id, "中文摘要😀", s.Version);
        var state = new SummaryManagerState(catalog, "合成账套");
        Assert.True(state.Refresh()); state.SelectedEntryId = s.Entries[0].Id;
        state.Query = "\ud800";
        Assert.Equal(SummaryCatalogStatus.InvalidData, state.Status);
        Assert.False(state.CanAccept); Assert.Empty(state.Rows); Assert.Null(state.SelectedEntry);
        Assert.False(state.AcceptSelection().Accepted); Assert.Contains("搜索文字", state.ErrorMessage);
        Assert.Equal(s.Version, state.Snapshot!.Version);
        state.Query = "合成 😀";
        Assert.Single(state.Rows); Assert.Equal(SummaryCatalogStatus.Ready, state.Status);
        Assert.False(state.CanAccept); state.SelectedEntryId = s.Entries[0].Id;
        Assert.True(state.BeginEditSummary()); state.DraftText = "保留的编辑内容";
        catalog.AddCategory("外部变更", catalog.Read().Version);
        Assert.False(state.Save()); Assert.Equal(SummaryCatalogStatus.Conflict, state.Status);
        state.Query = "\udc00";
        Assert.False(state.CanSave); Assert.False(state.CanAccept);
        state.Query = "";
        Assert.Equal(SummaryCatalogStatus.Conflict, state.Status);
        Assert.Equal("保留的编辑内容", state.DraftText);
        Assert.Contains("输入已保留", state.ErrorMessage);
        Assert.Equal("中文摘要😀", Assert.Single(catalog.Read().Entries).Text);
    }
}
