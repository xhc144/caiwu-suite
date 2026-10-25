using System.Diagnostics;
using System.Reflection;
using System.Text.Json.Nodes;
using Caiwu.Summaries;

namespace Caiwu.Summaries.Tests;

public sealed class CatalogTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "caiwu-summary-tests-" + Guid.NewGuid().ToString("N"));
    private readonly Guid bookId = Guid.NewGuid();
    private SummaryCatalogLocation Location(string name = "catalog.json", Guid? book = null) => new(root, Path.Combine(root, name), book ?? bookId);
    public void Dispose() { if (Directory.Exists(root)) Directory.Delete(root, recursive: true); }

    [Fact]
    public void ChineseCrudReallyPersistsAndKeepsStableIdsAcrossRenameMoveAndReopen()
    {
        var catalog = JsonSummaryCatalog.Create(Location());
        var state = catalog.AddCategory("  收入  ", catalog.Read().Version);
        var first = Assert.Single(state.Categories);
        Assert.Equal("收入", first.Name);
        state = catalog.AddSummary(first.Id, "  收到货款\n第二行说明  ", state.Version);
        var entry = Assert.Single(state.Entries);
        Assert.Equal("收到货款\n第二行说明", entry.Text);
        state = catalog.RenameCategory(first.Id, "营业收入", state.Version);
        Assert.Equal(first.Id, Assert.Single(state.Categories).Id);
        state = catalog.AddCategory("其他", state.Version);
        var other = state.Categories.Single(c => c.Name == "其他");
        state = catalog.UpdateSummary(entry.Id, other.Id, "收到预付款", state.Version);
        var reopened = JsonSummaryCatalog.Open(Location()).Read();
        Assert.Equal(state.Version, reopened.Version);
        Assert.Equal(new SummaryEntry(entry.Id, other.Id, "收到预付款"), Assert.Single(reopened.Entries));
        Assert.Equal(5, reopened.Version.Revision);
        Assert.Equal(bookId, reopened.BookId);
        state = catalog.DeleteSummary(entry.Id, reopened.Version);
        state = catalog.DeleteCategory(first.Id, state.Version);
        state = catalog.DeleteCategory(other.Id, state.Version);
        var empty = JsonSummaryCatalog.Open(Location()).Read();
        Assert.Empty(empty.Entries); Assert.Empty(empty.Categories);
        Assert.Equal(8, empty.Version.Revision);
        Assert.Equal(reopened.Version.CatalogId, empty.Version.CatalogId);
    }

    [Theory]
    [InlineData("")]
    [InlineData(" \t\r\n　 ")]
    [InlineData("跨\n行")]
    [InlineData("空\0字")]
    public void InvalidCategoryDoesNotModifyFile(string name)
    {
        var catalog = JsonSummaryCatalog.Create(Location());
        var before = File.ReadAllBytes(Location().CatalogPath);
        Assert.Throws<SummaryValidationException>(() => catalog.AddCategory(name, catalog.Read().Version));
        Assert.Equal(before, File.ReadAllBytes(Location().CatalogPath));
    }

    [Fact]
    public void DuplicateNamesUseUnicodeCompatibilityAndCaseWhileEntriesAreScopedToCategory()
    {
        var catalog = JsonSummaryCatalog.Create(Location());
        var state = catalog.AddCategory("办公Ａ", catalog.Read().Version);
        var first = Assert.Single(state.Categories).Id;
        Assert.Throws<SummaryValidationException>(() => catalog.AddCategory(" 办公a ", state.Version));
        state = catalog.AddCategory("收入", state.Version);
        var other = state.Categories.Single(c => c.Id != first).Id;
        Assert.Throws<SummaryValidationException>(() => catalog.RenameCategory(other, "办公a", state.Version));
        state = catalog.AddSummary(first, "支付费用Ａ", state.Version);
        Assert.Throws<SummaryValidationException>(() => catalog.AddSummary(first, " 支付费用a ", state.Version));
        Assert.Throws<SummaryValidationException>(() => catalog.AddSummary(first, "　\n \t", state.Version));
        state = catalog.AddSummary(other, "支付费用a", state.Version);
        var secondEntry = state.Entries.Single(e => e.CategoryId == other);
        Assert.Throws<SummaryValidationException>(() => catalog.UpdateSummary(secondEntry.Id, first, "支付费用a", state.Version));
        Assert.Equal(2, catalog.Read().Entries.Count);
    }

    [Fact]
    public void NonemptyCategoryDeleteAndMissingIdsAreRefusedWithoutCascading()
    {
        var catalog = JsonSummaryCatalog.Create(Location());
        var state = catalog.AddCategory("费用", catalog.Read().Version);
        var category = Assert.Single(state.Categories).Id;
        state = catalog.AddSummary(category, "支付办公费", state.Version);
        var before = File.ReadAllBytes(Location().CatalogPath);
        Assert.Throws<SummaryValidationException>(() => catalog.DeleteCategory(category, state.Version));
        Assert.Throws<SummaryValidationException>(() => catalog.DeleteSummary(Guid.NewGuid(), state.Version));
        Assert.Throws<SummaryValidationException>(() => catalog.AddSummary(Guid.NewGuid(), "内容", state.Version));
        Assert.Equal(before, File.ReadAllBytes(Location().CatalogPath));
    }

    [Fact]
    public void SearchSupportsChineseCategoryAndWhitespaceAndReturnsNoFallbackOnNoMatch()
    {
        var catalog = JsonSummaryCatalog.Create(Location());
        var state = catalog.AddCategory("费用", catalog.Read().Version);
        var category = Assert.Single(state.Categories).Id;
        state = catalog.AddSummary(category, "支付办公Ａ费用", state.Version);
        state = catalog.AddSummary(category, "支付差旅费", state.Version);
        Assert.Equal("支付办公Ａ费用", Assert.Single(state.Search("费用  办公a")).Text);
        Assert.Equal(2, state.Search("　\t").Count);
        Assert.Empty(state.Search("不存在"));
        Assert.Empty(state.Search(categoryId: Guid.NewGuid()));
    }

    [Fact]
    public void BooksAreIsolatedEvenWhenWrongPathIsExplicitlyProvided()
    {
        var a = JsonSummaryCatalog.Create(Location("a.json"));
        var bId = Guid.NewGuid();
        var b = JsonSummaryCatalog.Create(Location("b.json", bId));
        a.AddCategory("账套甲", a.Read().Version);
        Assert.Empty(b.Read().Categories);
        Assert.Throws<SummaryValidationException>(() => JsonSummaryCatalog.Open(Location("a.json", bId)));
        Assert.Throws<SummaryConflictException>(() => b.AddCategory("误用甲版本", a.Read().Version));
        Assert.Empty(b.Read().Categories);
    }

    [Fact]
    public void TwoWindowsRejectStaleSnapshotAndSameRevisionExternalRewrite()
    {
        var a = JsonSummaryCatalog.Create(Location());
        var b = JsonSummaryCatalog.Open(Location());
        var loaded = b.Read();
        var saved = a.AddCategory("窗口甲", loaded.Version);
        Assert.Throws<SummaryConflictException>(() => b.AddCategory("窗口乙", loaded.Version));
        Assert.Single(b.Read().Categories);
        var json = JsonNode.Parse(File.ReadAllText(Location().CatalogPath))!;
        json["categories"]![0]!["name"] = "外部修改但未增版本";
        File.WriteAllText(Location().CatalogPath, json.ToJsonString());
        Assert.Throws<SummaryConflictException>(() => a.RenameCategory(saved.Categories[0].Id, "不能覆盖", saved.Version));
        Assert.Equal("外部修改但未增版本", Assert.Single(a.Read().Categories).Name);
    }

    [Fact]
    public async Task RealChildProcessCannotOverwriteOldVersionOrBypassHeldLock()
    {
        var catalog = JsonSummaryCatalog.Create(Location());
        var old = catalog.Read().Version;
        catalog.AddCategory("主窗口", old);
        Assert.Equal(3, await Child(old, "旧进程"));
        var current = catalog.Read().Version;
        using (new FileStream(Location().CatalogPath + ".lock", FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            Assert.Equal(4, await Child(current, "锁被持有"));
        Assert.Equal(0, await Child(current, "新进程成功"));
        Assert.Equal(new[] { "主窗口", "新进程成功" }, catalog.Read().Categories.Select(c => c.Name));
    }

    private async Task<int> Child(CatalogVersion version, string name)
    {
        var probe = typeof(CatalogTests).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>().Single(a => a.Key == "ProcessProbePath").Value!;
        var start = new ProcessStartInfo(Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet")
        { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var argument in new[] { probe, root, Location().CatalogPath, bookId.ToString(), version.CatalogId.ToString(),
            version.Revision.ToString(System.Globalization.CultureInfo.InvariantCulture), version.Sha256, name }) start.ArgumentList.Add(argument);
        using var process = Process.Start(start)!;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        try { await process.WaitForExitAsync(timeout.Token); }
        catch { process.Kill(entireProcessTree: true); throw; }
        var errors = await process.StandardError.ReadToEndAsync();
        Assert.True(process.ExitCode is 0 or 3 or 4, errors);
        return process.ExitCode;
    }

    [Fact]
    public void PartialTemporaryWriteFailurePreservesOriginalBytesAndLeavesNoTempFile()
    {
        var catalog = JsonSummaryCatalog.Create(Location());
        var state = catalog.AddCategory("已有分类", catalog.Read().Version);
        var before = File.ReadAllBytes(Location().CatalogPath);
        var failed = JsonSummaryCatalog.WithWriter(Location(), (stream, bytes) =>
        { stream.Write(bytes, 0, 17); throw new IOException("synthetic disk write failure after 17 bytes"); });
        Assert.Throws<IOException>(() => failed.AddCategory("不能落盘", state.Version));
        Assert.Equal(before, File.ReadAllBytes(Location().CatalogPath));
        Assert.Empty(Directory.GetFiles(root, ".summary-*.tmp"));
        Assert.Equal(state.Version, JsonSummaryCatalog.Open(Location()).Read().Version);
        Assert.Equal(2, catalog.AddCategory("下一次正常写入", state.Version).Categories.Count);
    }

    [Theory]
    [InlineData("")]
    [InlineData("null")]
    [InlineData("{oops")]
    [InlineData("{}")]
    [InlineData("{\"schemaVersion\":1,\"schemaVersion\":1}")]
    public void CorruptInputIsNeverReinitializedOrOverwritten(string input)
    {
        Directory.CreateDirectory(root);
        File.WriteAllText(Location().CatalogPath, input);
        var before = File.ReadAllBytes(Location().CatalogPath);
        Assert.Throws<SummaryCorruptException>(() => JsonSummaryCatalog.Open(Location()));
        Assert.Throws<IOException>(() => JsonSummaryCatalog.Create(Location()));
        Assert.Equal(before, File.ReadAllBytes(Location().CatalogPath));
    }

    [Theory]
    [InlineData("schema")]
    [InlineData("negativeRevision")]
    [InlineData("missingField")]
    [InlineData("orphan")]
    [InlineData("duplicateId")]
    [InlineData("duplicateName")]
    [InlineData("nullEntry")]
    [InlineData("unknownField")]
    public void StructurallyValidButInvalidCatalogIsRejected(string damage)
    {
        var catalog = JsonSummaryCatalog.Create(Location());
        var state = catalog.AddCategory("合成分类", catalog.Read().Version);
        state = catalog.AddSummary(state.Categories[0].Id, "合成摘要", state.Version);
        var json = JsonNode.Parse(File.ReadAllText(Location().CatalogPath))!;
        switch (damage)
        {
            case "schema": json["schemaVersion"] = 999; break;
            case "negativeRevision": json["revision"] = -1; break;
            case "missingField": json.AsObject().Remove("revision"); break;
            case "orphan": json["entries"]![0]!["categoryId"] = Guid.NewGuid(); break;
            case "duplicateId": json["entries"]!.AsArray().Add(json["entries"]![0]!.DeepClone()); break;
            case "duplicateName":
                var c = json["categories"]![0]!.DeepClone(); c["id"] = Guid.NewGuid(); json["categories"]!.AsArray().Add(c); break;
            case "nullEntry": json["entries"]!.AsArray().Add((JsonNode?)null); break;
            case "unknownField": json["foreignField"] = "no silent acceptance"; break;
        }
        File.WriteAllText(Location().CatalogPath, json.ToJsonString());
        var before = File.ReadAllBytes(Location().CatalogPath);
        Assert.Throws<SummaryCorruptException>(() => catalog.Read());
        Assert.Throws<SummaryCorruptException>(() => catalog.AddCategory("不能修复为空", state.Version));
        Assert.Equal(before, File.ReadAllBytes(Location().CatalogPath));
    }

    [Fact]
    public void MissingOpenDoesNotCreateAFileAndPathsMustBeExplicitlyInsideUserRoot()
    {
        Assert.ThrowsAny<IOException>(() => JsonSummaryCatalog.Open(Location()));
        Assert.False(File.Exists(Location().CatalogPath));
        Assert.Throws<ArgumentException>(() => new SummaryCatalogLocation("relative", "/tmp/summary.json", bookId));
        Assert.Throws<ArgumentException>(() => new SummaryCatalogLocation(root, Path.Combine(root, "..", "escape.json"), bookId));
        Assert.Throws<ArgumentException>(() => new SummaryCatalogLocation(root, Path.Combine(root + "-sibling", "escape.json"), bookId));
        Assert.Throws<ArgumentException>(() => new SummaryCatalogLocation(root, Location().CatalogPath, Guid.Empty));
        var applicationRoot = Path.GetFullPath(AppContext.BaseDirectory);
        Assert.Throws<ArgumentException>(() => new SummaryCatalogLocation(applicationRoot, Path.Combine(applicationRoot, "summary.json"), bookId));
    }

    [Fact]
    public async Task ReadersSeeWholeSnapshotsDuringRepeatedAtomicReplacement()
    {
        var catalog = JsonSummaryCatalog.Create(Location());
        var state = catalog.AddCategory("并发分类", catalog.Read().Version);
        var category = state.Categories[0].Id;
        using var started = new ManualResetEventSlim();
        var writer = Task.Run(() =>
        {
            started.Set();
            for (var i = 0; i < 40; i++) state = catalog.AddSummary(category, $"合成并发摘要 {i}", state.Version);
        }, TestContext.Current.CancellationToken);
        Assert.True(started.Wait(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken));
        var observed = 0;
        do
        {
            var read = catalog.Read();
            Assert.Equal(read.Entries.Count + 1, read.Version.Revision);
            Assert.Equal(read.Entries.Count, read.Entries.Select(e => e.Id).Distinct().Count());
            observed++;
        } while (!writer.IsCompleted && observed < 500);
        await writer;
        Assert.Equal(40, catalog.Read().Entries.Count);
        Assert.True(observed > 0);
    }

    [Fact]
    public void ValidJsonBackupTamperingFailsHashBeforeCreatingRestoreTarget()
    {
        var catalog = JsonSummaryCatalog.Create(Location());
        catalog.AddCategory("可信登记名称", catalog.Read().Version);
        var backup = catalog.ExportBackup(Path.Combine(root, "backup.json"));
        var json = JsonNode.Parse(File.ReadAllText(backup.Path))!;
        json["categories"]![0]!["name"] = "改过的名称";
        File.WriteAllText(backup.Path, json.ToJsonString());
        Assert.Throws<SummaryValidationException>(() => catalog.ValidateBackup(backup.Path, backup.Sha256));
        Assert.Throws<SummaryValidationException>(() => JsonSummaryCatalog.RestoreBackup(backup.Path, backup.Sha256, Location("tampered.json")));
        Assert.False(File.Exists(Location("tampered.json").CatalogPath));
        Assert.Equal("可信登记名称", Assert.Single(catalog.Read().Categories).Name);
    }

    [Fact]
    public void OversizedInputAndRevisionOverflowAreRejectedWithoutWriting()
    {
        var catalog = JsonSummaryCatalog.Create(Location());
        var json = JsonNode.Parse(File.ReadAllText(Location().CatalogPath))!;
        json["revision"] = long.MaxValue;
        File.WriteAllText(Location().CatalogPath, json.ToJsonString());
        var before = File.ReadAllBytes(Location().CatalogPath);
        Assert.Throws<SummaryValidationException>(() => catalog.AddCategory("超出修订范围", catalog.Read().Version));
        Assert.Equal(before, File.ReadAllBytes(Location().CatalogPath));
        using (var stream = new FileStream(Location().CatalogPath, FileMode.Open, FileAccess.Write)) stream.SetLength(16 * 1024 * 1024 + 1);
        Assert.Throws<SummaryCorruptException>(() => catalog.Read());
        Assert.Equal(16 * 1024 * 1024 + 1, new FileInfo(Location().CatalogPath).Length);
    }

    [Fact]
    public void BackupValidatesHashAndBookAndRestoreNeverOverwritesAnExistingTarget()
    {
        var catalog = JsonSummaryCatalog.Create(Location());
        var state = catalog.AddCategory("合成备份", catalog.Read().Version);
        state = catalog.AddSummary(state.Categories[0].Id, "备份摘要", state.Version);
        var backupPath = Path.Combine(root, "backups", "copy.json");
        var receipt = catalog.ExportBackup(backupPath);
        Assert.Equal(state.Version.Sha256, receipt.Sha256);
        Assert.Equal(receipt, catalog.ValidateBackup(backupPath, receipt.Sha256));
        var restored = JsonSummaryCatalog.RestoreBackup(backupPath, receipt.Sha256, Location("restored.json")).Read();
        Assert.Equal(state.Version, restored.Version);
        Assert.Equal(state.Categories, restored.Categories);
        Assert.Equal(state.Entries, restored.Entries);
        var original = File.ReadAllBytes(Location().CatalogPath);
        Assert.Throws<IOException>(() => JsonSummaryCatalog.RestoreBackup(backupPath, receipt.Sha256, Location()));
        Assert.Throws<IOException>(() => catalog.ExportBackup(backupPath));
        Assert.Throws<IOException>(() => catalog.ExportBackup(Location().CatalogPath));
        Assert.Throws<SummaryValidationException>(() => JsonSummaryCatalog.RestoreBackup(backupPath, new string('0', 64), Location("bad-hash.json")));
        Assert.Throws<SummaryValidationException>(() => JsonSummaryCatalog.RestoreBackup(backupPath, receipt.Sha256, Location("wrong-book.json", Guid.NewGuid())));
        Assert.False(File.Exists(Location("bad-hash.json").CatalogPath));
        Assert.False(File.Exists(Location("wrong-book.json").CatalogPath));
        File.AppendAllText(backupPath, "tampering");
        Assert.Throws<SummaryCorruptException>(() => catalog.ValidateBackup(backupPath, receipt.Sha256));
        Assert.Throws<SummaryCorruptException>(() => JsonSummaryCatalog.RestoreBackup(backupPath, receipt.Sha256, Location("corrupt-copy.json")));
        Assert.Equal(original, File.ReadAllBytes(Location().CatalogPath));
    }

    [Fact]
    public void SelectionAndAdapterPreserveFullTextAndCancellationLeavesOriginalEntryAlone()
    {
        var catalog = JsonSummaryCatalog.Create(Location());
        var s = catalog.AddCategory("全部分类", catalog.Read().Version);
        s = catalog.AddSummary(s.Categories[0].Id, "收到货款\n原文第二行", s.Version);
        var adapted = Assert.Single(s.ToPickerItems((id, category, text) => new PickerDto(id, category, text)));
        Assert.Equal(s.Entries[0].Id.ToString("D"), adapted.Id);
        Assert.Equal("全部分类", adapted.Category);
        Assert.Equal("收到货款\n原文第二行", adapted.Text);
        var view = new SummaryCatalogState(catalog);
        Assert.True(view.Refresh());
        var notifications = 0;
        view.PropertyChanged += (_, _) => notifications++;
        view.SelectedId = s.Entries[0].Id;
        Assert.True(view.CanAccept);
        const string originalVoucherSummary = "原分录手写摘要";
        var voucherSummary = originalVoucherSummary;
        var cancelled = view.CancelSelection();
        if (cancelled.Accepted) voucherSummary = cancelled.Value!.Text;
        Assert.Equal(originalVoucherSummary, voucherSummary);
        Assert.Null(cancelled.Value);
        view.Query = "无结果";
        Assert.False(view.CanAccept); Assert.Null(view.SelectedEntry);
        Assert.Equal("没有匹配的摘要。", view.StatusText);
        Assert.False(view.AcceptSelection().Accepted);
        view.Query = "";
        Assert.False(view.CanAccept);
        view.SelectedId = s.Entries[0].Id;
        var accepted = view.AcceptSelection();
        if (accepted.Accepted) voucherSummary = accepted.Value!.Text;
        Assert.Equal(adapted.Text, voucherSummary);
        Assert.True(notifications >= 4);
        Assert.Equal(s.Version, catalog.Read().Version);
    }

    [Fact]
    public void StateRetainsSnapshotAndReportsConflictCorruptionAndIoFailures()
    {
        var catalog = JsonSummaryCatalog.Create(Location());
        var a = new SummaryCatalogState(catalog); var b = new SummaryCatalogState(JsonSummaryCatalog.Open(Location()));
        Assert.True(a.Refresh()); Assert.True(b.Refresh());
        Assert.True(a.AddCategory("甲窗口"));
        Assert.False(b.AddCategory("乙窗口"));
        Assert.Equal(SummaryCatalogStatus.Conflict, b.Status);
        Assert.Empty(b.Categories); Assert.False(b.CanAccept);
        Assert.True(b.Refresh()); Assert.Single(b.Categories);
        File.WriteAllText(Location().CatalogPath, "corrupt");
        Assert.False(b.Refresh()); Assert.Equal(SummaryCatalogStatus.InvalidData, b.Status);
        Assert.Single(b.Categories); Assert.NotNull(b.ErrorMessage);
        File.Delete(Location().CatalogPath);
        Assert.False(b.Refresh()); Assert.Equal(SummaryCatalogStatus.IoError, b.Status);
        Assert.Single(b.Categories); Assert.False(b.AddCategory("不能覆盖错误"));
    }

    private sealed record PickerDto(string Id, string Category, string Text);

    [Theory]
    [InlineData(0xD800)]
    [InlineData(0xDC00)]
    public void InvalidQueryClearsSelectionAndReturnsReadableErrorWithoutChangingCatalog(int codeUnit)
    {
        // Attribute strings pass through metadata encodings; construct the invalid UTF-16 unit at runtime.
        var badQuery = new string((char)codeUnit, 1);
        var catalog = JsonSummaryCatalog.Create(Location());
        var s = catalog.AddCategory("中文", catalog.Read().Version);
        s = catalog.AddSummary(s.Categories[0].Id, "中文摘要😀", s.Version);
        var view = new SummaryCatalogState(catalog);
        Assert.True(view.Refresh()); view.SelectedId = s.Entries[0].Id;
        Assert.True(view.CanAccept);
        view.Query = badQuery;
        Assert.False(view.CanAccept); Assert.False(view.AcceptSelection().Accepted);
        Assert.Null(view.SelectedEntry); Assert.Empty(view.VisibleEntries);
        Assert.Equal(SummaryCatalogStatus.InvalidData, view.Status); Assert.Contains("搜索文字", view.ErrorMessage);
        Assert.Equal(s.Version, view.Snapshot!.Version);
        Assert.Throws<SummaryValidationException>(() => s.Search(badQuery));
        view.Query = "中文 😀";
        Assert.Equal(SummaryCatalogStatus.Ready, view.Status); Assert.Single(view.VisibleEntries);
        Assert.False(view.CanAccept); // fixing a query does not silently reselect the previous row.
        view.SelectedId = s.Entries[0].Id;
        Assert.True(view.AcceptSelection().Accepted);
        Assert.Equal(s.Version, catalog.Read().Version);
    }
}
