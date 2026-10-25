using Caiwu.Contracts;
using Caiwu.Persistence.Sqlite;
using System.Text.Json;
using Xunit;

namespace Caiwu.BookTools.Tests;

public sealed class BoundaryTests
{
    [Fact]
    public void Preview_and_cancel_are_filesystem_readonly_and_inputs_invalidate_confirmation()
    {
        using var f = new SyntheticBook();
        var files = Directory.GetFileSystemEntries(f.Root);
        var hash = SyntheticBook.Hash(f.Source);
        var flow = new BookCopyWorkflow(new(), f.Read(), f.Source)
        { DestinationPath = f.Destination, NewBookName = "合成新账套", OperatorName = "合成" };
        flow.Preview(); flow.Confirmed = true;
        flow.NewBookName = "合成改名";
        Assert.Null(flow.Plan); Assert.False(flow.Confirmed);
        flow.Preview(); flow.Confirmed = true;
        flow.Scope = BookCopyScope.AccountsAndOpeningBalances;
        Assert.Null(flow.Plan); Assert.False(flow.Confirmed);
        flow.Preview(); flow.Confirmed = true; flow.CancelPreview();
        Assert.Null(flow.Plan); Assert.False(flow.Confirmed);
        Assert.Equal(files, Directory.GetFileSystemEntries(f.Root));
        Assert.Equal(hash, SyntheticBook.Hash(f.Source));
    }

    [Fact]
    public async Task Workflow_requires_explicit_confirmation_and_completes_once()
    {
        using var f = new SyntheticBook();
        var flow = new BookCopyWorkflow(new(), f.Read(), f.Source)
        { DestinationPath = f.Destination, NewBookName = "合成新账套", OperatorName = "合成" };
        await Assert.ThrowsAsync<InvalidOperationException>(() => flow.ExecuteConfirmedAsync());
        flow.Preview();
        await Assert.ThrowsAsync<InvalidOperationException>(() => flow.ExecuteConfirmedAsync());
        flow.Confirmed = true;
        var result = await flow.ExecuteConfirmedAsync();
        Assert.Equal(result, flow.Result); Assert.True(flow.IsCompleted); Assert.False(flow.IsBusy);
        await Assert.ThrowsAsync<InvalidOperationException>(() => flow.ExecuteConfirmedAsync());
        Assert.Throws<InvalidOperationException>(() => flow.NewBookName = "再改");
    }

    [Fact]
    public async Task Host_can_refresh_snapshot_before_repreview_after_stale_failure()
    {
        using var f = new SyntheticBook();
        var flow = new BookCopyWorkflow(new(), f.Read(), f.Source, () => f.Read())
        { DestinationPath = f.Destination, NewBookName = "合成新账套", OperatorName = "合成" };
        flow.Preview(); flow.Confirmed = true;
        using (var source = SqliteLedgerStore.Open(f.Source))
        {
            var s = source.Read(); source.Write(s with { Revision = 2 }, 1);
        }
        await Assert.ThrowsAsync<InvalidDataException>(() => flow.ExecuteConfirmedAsync());
        Assert.Null(flow.Plan); Assert.False(flow.Confirmed);
        Assert.Equal(2, flow.Preview().SourceRevision);
        flow.Confirmed = true;
        Assert.Equal(f.Destination, (await flow.ExecuteConfirmedAsync()).DestinationPath);
    }

    [Fact]
    public void Source_snapshot_lists_are_frozen_at_preview_including_nested_lines()
    {
        using var f = new SyntheticBook();
        var original = f.Read();
        var accounts = original.Accounts.ToArray();
        var lines = original.Vouchers[0].Lines.ToArray();
        var vouchers = original.Vouchers.ToArray();
        vouchers[0] = vouchers[0] with { Lines = lines };
        var mutable = original with { Accounts = accounts, Vouchers = vouchers };
        var service = new BookCopyService();
        var p = service.Preview(mutable, new(f.Source, f.Destination, "合成新账套", BookCopyScope.FullLedger, "合成"));
        accounts[0] = accounts[0] with { Name = "外部修改" };
        lines[0] = lines[0] with { Debit = 88 };
        vouchers[1] = vouchers[1] with { PreparedBy = "外部修改" };
        service.Execute(p);
        Assert.Equal(original.Accounts, f.Read(f.Destination).Accounts);
        Assert.Equal(original.Vouchers[0].Lines, f.Read(f.Destination).Vouchers[0].Lines);
    }

    [Theory]
    [InlineData("UPDATE accounts SET name='变化' WHERE code='1002'")]
    [InlineData("UPDATE voucher_lines SET summary='变化' WHERE ordinal=0")]
    [InlineData("UPDATE vouchers SET attachment_count=99 WHERE ordinal=0")]
    [InlineData("UPDATE audit_events SET detail='变化' WHERE ordinal=0")]
    [InlineData("UPDATE ledger SET name='变化'")]
    [InlineData("UPDATE ledger SET revision=revision+1")]
    public void Stale_preview_rejects_any_contract_change_even_without_revision_increment(string sql)
    {
        using var f = new SyntheticBook();
        var p = f.Preview();
        using (var db = f.Raw()) { using var q = db.CreateCommand(); q.CommandText = sql; q.ExecuteNonQuery(); }
        var changed = f.Read();
        var hash = SyntheticBook.Hash(f.Source);
        var ex = Assert.Throws<InvalidDataException>(() => new BookCopyService().Execute(p));
        Assert.Contains("重新预览", ex.Message);
        Assert.False(File.Exists(f.Destination)); Assert.Empty(Directory.GetDirectories(f.Root));
        Assert.Equal(hash, SyntheticBook.Hash(f.Source)); CopyTests.AssertSnapshot(changed, f.Read());
    }

    [Theory]
    [InlineData(BookCopyStage.SnapshotCaptured)]
    [InlineData(BookCopyStage.TargetSaved)]
    [InlineData(BookCopyStage.ReadyVerified)]
    public void Cancellation_at_each_prepublication_boundary_removes_only_owned_temporaries(BookCopyStage stage)
    {
        using var f = new SyntheticBook();
        var untouched = Path.Combine(f.Root, "unrelated-backup.caiwu");
        File.WriteAllText(untouched, "合成备份保留");
        var sourceHash = SyntheticBook.Hash(f.Source);
        using var cts = new CancellationTokenSource();
        var progress = new InlineProgress(s => { if (s == stage) cts.Cancel(); });
        Assert.Throws<OperationCanceledException>(() => new BookCopyService().Execute(f.Preview(), cts.Token, progress));
        Assert.False(File.Exists(f.Destination)); Assert.Empty(Directory.GetDirectories(f.Root));
        Assert.Equal(sourceHash, SyntheticBook.Hash(f.Source)); Assert.Equal("合成备份保留", File.ReadAllText(untouched));
    }

    [Fact]
    public void Already_cancelled_execution_allocates_no_files()
    {
        using var f = new SyntheticBook();
        var p = f.Preview(); var before = Directory.GetFileSystemEntries(f.Root);
        Assert.Throws<OperationCanceledException>(() => new BookCopyService().Execute(p, new CancellationToken(true)));
        Assert.Equal(before, Directory.GetFileSystemEntries(f.Root));
    }

    [Fact]
    public void Cleanup_never_recursively_deletes_unknown_files_and_reports_retained_directory()
    {
        using var f = new SyntheticBook();
        using var cts = new CancellationTokenSource();
        string? unknown = null;
        var progress = new InlineProgress(stage =>
        {
            if (stage != BookCopyStage.TargetSaved) return;
            unknown = Path.Combine(Assert.Single(Directory.GetDirectories(f.Root)), "unknown.txt");
            File.WriteAllText(unknown, "不是复制器的文件"); cts.Cancel();
        });
        var error = Assert.Throws<OperationCanceledException>(() => new BookCopyService().Execute(f.Preview(), cts.Token, progress));
        Assert.Equal("不是复制器的文件", File.ReadAllText(unknown!));
        Assert.NotNull(error.Data["BookCopyCleanupWarnings"]);
        Assert.Equal(new[] { unknown }, Directory.GetFiles(Path.GetDirectoryName(unknown!)!));
        Assert.False(File.Exists(f.Destination));
    }

    [Fact]
    public async Task Workflow_refuses_concurrent_execution_and_input_changes_while_busy()
    {
        using var f = new SyntheticBook();
        using var entered = new ManualResetEventSlim(); using var resume = new ManualResetEventSlim();
        var flow = new BookCopyWorkflow(new(), f.Read(), f.Source)
        { DestinationPath = f.Destination, NewBookName = "合成新账套", OperatorName = "合成" };
        flow.Preview(); flow.Confirmed = true;
        var progress = new InlineProgress(stage =>
        {
            if (stage != BookCopyStage.TargetSaved) return;
            entered.Set();
            if (!resume.Wait(TimeSpan.FromSeconds(10))) throw new TimeoutException("test synchronization");
        });
        var active = flow.ExecuteConfirmedAsync(progress: progress);
        try
        {
            Assert.True(entered.Wait(TimeSpan.FromSeconds(10)));
            await Assert.ThrowsAsync<InvalidOperationException>(() => flow.ExecuteConfirmedAsync());
            Assert.Throws<InvalidOperationException>(() => flow.NewBookName = "并发修改");
            Assert.Throws<InvalidOperationException>(() => flow.CancelPreview());
        }
        finally { resume.Set(); }
        Assert.Equal(f.Destination, (await active).DestinationPath);
    }

    [Theory]
    [InlineData("")]
    [InlineData("-wal")]
    [InlineData("-shm")]
    [InlineData("-journal")]
    public void Destination_race_or_sidecar_is_preserved_and_cannot_be_overwritten(string suffix)
    {
        using var f = new SyntheticBook();
        var p = f.Preview();
        var other = f.Destination + suffix;
        var progress = new InlineProgress(stage => { if (stage == BookCopyStage.ReadyVerified) File.WriteAllText(other, "其他进程的文件"); });
        Assert.Throws<IOException>(() => new BookCopyService().Execute(p, progress: progress));
        Assert.Equal("其他进程的文件", File.ReadAllText(other));
        Assert.Empty(Directory.GetDirectories(f.Root));
        if (suffix.Length > 0) Assert.False(File.Exists(f.Destination));
    }

    [Fact]
    public void Reopen_verification_detects_changed_saved_data_before_publication()
    {
        using var f = new SyntheticBook();
        var sourceHash = SyntheticBook.Hash(f.Source);
        var progress = new InlineProgress(stage =>
        {
            if (stage != BookCopyStage.TargetSaved) return;
            var candidate = Path.Combine(Assert.Single(Directory.GetDirectories(f.Root)), "candidate.caiwu");
            using var db = f.Raw(candidate); using var q = db.CreateCommand();
            q.CommandText = "UPDATE accounts SET opening_debit_cents=1 WHERE code='1002'"; q.ExecuteNonQuery();
        });
        var ex = Assert.Throws<InvalidDataException>(() => new BookCopyService().Execute(f.Preview(), progress: progress));
        Assert.Contains("重新打开", ex.Message);
        Assert.False(File.Exists(f.Destination)); Assert.Empty(Directory.GetDirectories(f.Root));
        Assert.Equal(sourceHash, SyntheticBook.Hash(f.Source));
    }

    [Fact]
    public void Bad_source_fails_without_target_or_temporary_files()
    {
        using var f = new SyntheticBook();
        var p = f.Preview();
        File.WriteAllText(f.Source, "合成坏文件");
        Assert.ThrowsAny<Exception>(() => new BookCopyService().Execute(p));
        Assert.Equal("合成坏文件", File.ReadAllText(f.Source));
        Assert.False(File.Exists(f.Destination)); Assert.Empty(Directory.GetDirectories(f.Root));
    }

    [Fact]
    public void Existing_delivery_file_policy_can_reject_without_any_copy_side_effect()
    {
        using var f = new SyntheticBook();
        var hash = SyntheticBook.Hash(f.Source);
        var service = new BookCopyService(validateSource: _ => throw new InvalidDataException("host gate"));
        Assert.Throws<InvalidDataException>(() => service.Execute(f.Preview()));
        Assert.Equal(hash, SyntheticBook.Hash(f.Source));
        Assert.Equal(new[] { f.Source }, Directory.GetFileSystemEntries(f.Root));
    }

    [Fact]
    public void Host_destination_policy_is_checked_before_any_staging()
    {
        using var f = new SyntheticBook();
        var service = new BookCopyService(validateDestination: _ => throw new InvalidDataException("outside managed root"));
        Assert.Throws<InvalidDataException>(() => service.Execute(f.Preview()));
        Assert.Equal(new[] { f.Source }, Directory.GetFileSystemEntries(f.Root));
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("合成源账套")]
    [InlineData("新\n账套")]
    public void New_name_is_explicit_and_distinct(string name)
    {
        using var f = new SyntheticBook();
        Assert.Throws<LedgerValidationException>(() => new BookCopyService().Preview(f.Read(),
            new(f.Source, f.Destination, name, BookCopyScope.FullLedger, "合成")));
        Assert.False(File.Exists(f.Destination));
    }

    [Theory]
    [InlineData("-wal")]
    [InlineData("-shm")]
    [InlineData("-journal")]
    public void Preexisting_target_sidecars_are_not_removed(string suffix)
    {
        using var f = new SyntheticBook();
        File.WriteAllText(f.Destination + suffix, "合成保留");
        Assert.Throws<IOException>(() => f.Preview());
        Assert.Equal("合成保留", File.ReadAllText(f.Destination + suffix));
    }

    [Fact]
    public void Same_source_existing_target_and_source_sidecars_are_rejected()
    {
        using var f = new SyntheticBook();
        var source = f.Read();
        var hash = SyntheticBook.Hash(f.Source);
        foreach (var destination in new[] { f.Source, f.Source + "-wal", f.Source + "-shm", f.Source + "-journal" })
            Assert.Throws<IOException>(() => new BookCopyService().Preview(source,
                new(f.Source, destination, "新账套", BookCopyScope.FullLedger, "合成")));
        File.WriteAllText(f.Destination, "不能覆盖的合成目标");
        Assert.Throws<IOException>(() => f.Preview());
        Assert.Equal("不能覆盖的合成目标", File.ReadAllText(f.Destination));
        Assert.Equal(hash, SyntheticBook.Hash(f.Source));
    }

    [Fact]
    public void Source_and_destination_directory_aliases_cannot_bypass_same_file_guard()
    {
        if (OperatingSystem.IsWindows()) return; // Windows symlink permission varies; no Windows execution claim.
        using var f = new SyntheticBook();
        var alias = Path.Combine(f.Root, "alias"); Directory.CreateSymbolicLink(alias, f.Root);
        try
        {
            var same = Path.Combine(alias, "source.caiwu");
            Assert.Throws<IOException>(() => new BookCopyService().Preview(f.Read(),
                new(f.Source, same, "新账套", BookCopyScope.FullLedger, "合成")));
            var dangling = Path.Combine(f.Root, "dangling.caiwu");
            File.CreateSymbolicLink(dangling, Path.Combine(f.Root, "missing.caiwu"));
            Assert.Throws<IOException>(() => new BookCopyService().Preview(f.Read(),
                new(f.Source, dangling, "新账套", BookCopyScope.FullLedger, "合成")));
            Assert.NotNull(new FileInfo(dangling).LinkTarget);
        }
        finally { Directory.Delete(alias); }
    }

    [Fact]
    public void Snapshot_capture_uses_committed_WAL_and_excludes_uncommitted_writer()
    {
        using var f = new SyntheticBook();
        using var db = f.Raw();
        using (var q = db.CreateCommand())
        {
            q.CommandText = "PRAGMA journal_mode=WAL; UPDATE accounts SET name='已提交WAL科目' WHERE code='1002';";
            q.ExecuteNonQuery();
        }
        var p = f.Preview();
        using var transaction = db.BeginTransaction();
        using (var q = db.CreateCommand())
        {
            q.Transaction = transaction;
            q.CommandText = "UPDATE accounts SET name='未提交不得复制' WHERE code='1002'"; q.ExecuteNonQuery();
        }
        new BookCopyService().Execute(p);
        Assert.Equal("已提交WAL科目", f.Read(f.Destination).Accounts.Single(a => a.Code == "1002").Name);
        transaction.Rollback();
        Assert.Equal("已提交WAL科目", f.Read().Accounts.Single(a => a.Code == "1002").Name);
    }

    [Fact]
    public void Writes_after_capture_do_not_mix_into_approved_snapshot()
    {
        using var f = new SyntheticBook();
        var p = f.Preview();
        var progress = new InlineProgress(stage =>
        {
            if (stage != BookCopyStage.SnapshotCaptured) return;
            using var source = SqliteLedgerStore.Open(f.Source);
            var s = source.Read(); source.Write(s with { Revision = s.Revision + 1, Book = s.Book with { Name = "源后续新名称" } }, s.Revision);
        });
        new BookCopyService().Execute(p, progress: progress);
        Assert.Equal("源后续新名称", f.Read().Book.Name);
        Assert.Equal(p.NewBook, f.Read(f.Destination).Book);
        using var provenance = JsonDocument.Parse(f.Read(f.Destination).AuditEvents.Last().Detail);
        Assert.Equal("合成源账套", provenance.RootElement.GetProperty("SourceName").GetString());
    }

    internal sealed class InlineProgress(Action<BookCopyStage> action) : IProgress<BookCopyStage>
    {
        public void Report(BookCopyStage value) => action(value);
    }
}
