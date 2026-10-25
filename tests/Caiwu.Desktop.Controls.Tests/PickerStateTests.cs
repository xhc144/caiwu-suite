using Caiwu.Contracts;

namespace Caiwu.Desktop.Controls.Tests;

public sealed class PickerStateTests
{
    private static Account A(string code, string name, string? parent = null, bool active = true) =>
        new(code, name, parent, BalanceDirection.Debit, active, 0, 0);
    private static Account[] Chart() => [A("1002", "银行存款"), A("100201", "基本账户", "1002"), A("100202", "旧账户", "1002", false),
        A("6602", "管理费用"), A("660201", "差旅费 🧾", "6602"), A("660202", "Office 办公费", "6602")];

    [Fact]
    public void OnlyActiveLeavesAreAcceptedAndParentsRemainNavigable()
    {
        var model = new AccountPickerState(Chart());
        foreach (var code in new[] { "1002", "100202", "6602" })
        { model.Select(code); Assert.False(model.CanAccept); Assert.False(model.AcceptSelection().Accepted); }
        model.Select("660201");
        Assert.True(model.CanAccept); Assert.Equal("660201", model.AcceptSelection().Value!.Code);
        Assert.Equal(2, model.TreeItems.Count);
        Assert.Equal(2, model.TreeItems[0].Children.Count);
    }

    [Theory]
    [InlineData("１００２０１", "100201")]
    [InlineData("差旅 🧾", "660201")]
    [InlineData("oFFiCe", "660202")]
    [InlineData("6602 办公", "660202")]
    public void AccountSearchCombinesCodeNameUnicodeAndCaseInsensitiveTerms(string query, string expected)
    {
        var model = new AccountPickerState(Chart()); model.SetQuery(query);
        Assert.Equal(expected, Assert.Single(model.VisibleItems).Code);
        Assert.Single(model.TreeItems);
        Assert.Equal(expected, Assert.Single(model.TreeItems[0].Children).Choice.Code);
    }

    [Fact]
    public void ArrowsSkipBlockedRowsClampAndNeverConfirmOnHighlight()
    {
        var original = Chart(); var model = new AccountPickerState(original, "100201");
        model.MoveSelection(1); Assert.Equal("660201", model.SelectedItem!.Code);
        model.MoveSelection(1); model.MoveSelection(1); Assert.Equal("660202", model.SelectedItem!.Code);
        model.MoveSelection(-1); Assert.Equal("660201", model.SelectedItem!.Code);
        model.Select("6602"); model.MoveSelection(1); Assert.Equal("660201", model.SelectedItem!.Code);
        var cancelled = model.CancelSelection(); Assert.False(cancelled.Accepted); Assert.Null(cancelled.Value);
        Assert.Equal("100201", original[1].Code);
        model.SetQuery("不存在"); Assert.False(model.CanAccept); Assert.Null(model.SelectedItem);
        model.MoveSelection(1); Assert.False(model.AcceptSelection().Accepted);
        Assert.Empty(model.VisibleItems); Assert.Empty(model.TreeItems); Assert.Null(model.LoadError);
        Assert.Contains("没有匹配", model.StatusText);
        model.SetQuery("100201"); Assert.False(model.CanAccept); // Recovering results does not auto-confirm an old choice.
        model.MoveSelection(1); Assert.Equal("100201", model.AcceptSelection().Value!.Code);
    }

    [Fact]
    public void FilteringSelectableLeavesKeepsTreeAncestorsAndClearsHiddenSelections()
    {
        var model = new AccountPickerState(Chart(), "100202");
        model.SetOnlySelectable(true);
        Assert.Equal(3, model.VisibleItems.Count); Assert.All(model.VisibleItems, i => Assert.True(i.IsSelectable));
        Assert.Equal(2, model.TreeItems.Count); Assert.Null(model.SelectedItem);
        model.Select("1002"); Assert.False(model.CanAccept);
        model.Select("100201"); model.SetQuery("费用"); Assert.False(model.CanAccept);
    }

    [Fact]
    public void InitialChoiceAndInputCollectionsAreSnapshotsAndCancellationHasNoValue()
    {
        var source = Chart().ToList(); var model = new AccountPickerState(source, "100201"); source.Clear();
        Assert.Equal(6, model.VisibleItems.Count); Assert.Equal("100201", model.SelectedItem!.Code);
        Assert.False(model.CancelSelection().Accepted); Assert.Null(model.CancelSelection().Value);
        Assert.Throws<NotSupportedException>(() => ((IList<AccountChoice>)model.VisibleItems).Clear());
        Assert.Throws<NotSupportedException>(() => ((IList<AccountTreeNode>)model.TreeItems).Clear());
    }

    [Fact]
    public void InvalidCatalogsAndDisabledAncestorsCannotProduceAcceptedChoices()
    {
        foreach (var chart in new[] { new[] { A("x", "A"), A("x", "B") }, new[] { A("x", "A", "missing") },
            new[] { A("x", "A", "y"), A("y", "B", "x") }, new[] { A("", "无代码") } })
        {
            var model = new AccountPickerState(chart);
            Assert.NotNull(model.LoadError); Assert.Empty(model.VisibleItems); Assert.False(model.AcceptSelection().Accepted);
        }
        var disabled = new AccountPickerState([A("1", "停用上级", active: false), A("11", "未同步的启用明细", "1")]);
        disabled.Select("11"); Assert.False(disabled.CanAccept); Assert.Contains("上级", disabled.SelectedItem!.SelectionHint);
        var grandparent = new AccountPickerState([A("1002", "停用根", active: false), A("100201", "启用父级", "1002"),
            A("10020101", "启用末级", "100201")]);
        grandparent.Select("10020101"); Assert.False(grandparent.CanAccept);
        grandparent.SetOnlySelectable(true); Assert.Empty(grandparent.VisibleItems);
        var empty = new AccountPickerState([]); Assert.Contains("暂无", empty.StatusText); Assert.False(empty.CanAccept);
    }

    [Fact]
    public void SameNamedAccountsRemainDistinctByCodeAcrossListTreeAndKeyboard()
    {
        var model = new AccountPickerState([A("1002", "银行存款"), A("100201", "基本账户", "1002"),
            A("100202", "基本账户", "1002")], "100202");
        model.SetQuery("基本账户");
        Assert.Equal(new[] { "100201", "100202" }, model.VisibleItems.Select(i => i.Code));
        Assert.Equal(new[] { "100201", "100202" }, Assert.Single(model.TreeItems).Children.Select(i => i.Choice.Code));
        Assert.Equal("100202", model.AcceptSelection().Value!.Code);
        model.MoveSelection(-1); Assert.Equal("100201", model.AcceptSelection().Value!.Code);
        model.Select("100202"); Assert.Equal("100202", model.AcceptSelection().Value!.Code);
    }

    [Fact]
    public void LargeCatalogSearchKeepsOnlyMatchingBranches()
    {
        var model = new AccountPickerState(Enumerable.Range(0, 10000).Select(i => A(i.ToString("D6"), "科目" + i)));
        model.SetQuery("009999"); Assert.Single(model.VisibleItems); Assert.Single(model.TreeItems);
        model.MoveSelection(1); Assert.Equal("009999", model.AcceptSelection().Value!.Code);
    }

    private static SummaryLibraryItem[] Summaries() => [new("travel", "费用", "支付差旅费 🧾"), new("office", "费用", "Office 办公费"),
        new("receipt", "收款", "收到销售款"), new("named-all", "全部分类", "分类名称本身为全部分类")];

    [Fact]
    public void CategoryAndSearchAreCombinedAndPreserveFullSelectedText()
    {
        var model = new SummaryPickerState(Summaries()); model.SetCategory("费用"); model.SetQuery("差旅 🧾");
        Assert.Equal("travel", Assert.Single(model.VisibleItems).Id);
        model.MoveSelection(1); var result = model.AcceptSelection();
        Assert.True(result.Accepted); Assert.Equal("支付差旅费 🧾", result.Value!.Text);
        model.SetCategory("收款"); Assert.False(model.CanAccept); Assert.Empty(model.VisibleItems);
        model.SetQuery(""); Assert.Single(model.VisibleItems);
    }

    [Fact]
    public void SummaryCategoriesDoNotConfuseLiteralAllCategoryWithNullAllFilter()
    {
        var model = new SummaryPickerState(Summaries(), "travel");
        model.SetCategory("全部分类"); Assert.Equal("named-all", Assert.Single(model.VisibleItems).Id);
        model.SetCategory(null); Assert.Equal(4, model.VisibleItems.Count);
        model.SetQuery("ｏｆｆｉｃｅ"); Assert.Equal("office", Assert.Single(model.VisibleItems).Id);
    }

    [Fact]
    public void SummaryNavigationCancelAndSnapshotNeverWriteCallerText()
    {
        const string originalText = "原来手写的摘要";
        var source = Summaries().ToList(); var model = new SummaryPickerState(source, "travel"); source.Clear();
        Assert.Equal(4, model.VisibleItems.Count);
        model.MoveSelection(1); Assert.NotNull(model.SelectedItem);
        var result = model.CancelSelection(); Assert.False(result.Accepted); Assert.Null(result.Value);
        var value = result.Accepted ? result.Value!.Text : originalText; Assert.Equal(originalText, value);
        model.SetQuery("不存在"); model.MoveSelection(-1); Assert.False(model.CanAccept);
        Assert.Empty(model.VisibleItems); Assert.Null(model.SelectedItem); Assert.Null(model.LoadError);
        Assert.Contains("没有匹配", model.StatusText);
        model.SetQuery("差旅"); Assert.False(model.CanAccept);
        model.MoveSelection(1); Assert.Equal("travel", model.AcceptSelection().Value!.Id);
    }

    [Fact]
    public void MissingOrDuplicateSummaryDataHasExplicitEmptyOrErrorStates()
    {
        var empty = new SummaryPickerState([]); Assert.Null(empty.LoadError); Assert.Contains("暂无", empty.StatusText);
        foreach (var items in new[] { new[] { new SummaryLibraryItem("a", "类", "甲"), new SummaryLibraryItem("a", "类", "乙") },
            new[] { new SummaryLibraryItem("a", "", "甲") }, new[] { new SummaryLibraryItem("a", "类", " ") } })
        {
            var model = new SummaryPickerState(items); Assert.NotNull(model.LoadError); Assert.Empty(model.VisibleItems); Assert.False(model.CanAccept);
        }
    }
}
