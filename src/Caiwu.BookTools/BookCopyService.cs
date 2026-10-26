using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Persistence.Sqlite;

namespace Caiwu.BookTools;

/// <summary>Copies only persisted schema-v1 contract data; never owns the host's source store.</summary>
public sealed class BookCopyService
{
    private readonly TimeProvider clock;
    private readonly Action<string>? validateSource;
    private readonly Action<string>? validateDestination;

    /// <param name="validateSource">Optional existing host file policy (for example Delivery's
    /// LedgerFilePolicy.Validate). Called on the source and captured copy before opening it.</param>
    /// <param name="validateDestination">Optional host managed-data path policy. Called before
    /// staging and again before publication. Must only validate and never reserve/delete the path.</param>
    public BookCopyService(TimeProvider? clock = null, Action<string>? validateSource = null,
        Action<string>? validateDestination = null)
    {
        this.clock = clock ?? TimeProvider.System;
        this.validateSource = validateSource;
        this.validateDestination = validateDestination;
    }

    /// <summary>Uses LedgerSession.Snapshot and DatabasePath. Does not open/write SQLite or create files.</summary>
    public BookCopyPlan Preview(LedgerSnapshot persistedSnapshot, BookCopyRequest request)
    {
        ArgumentNullException.ThrowIfNull(persistedSnapshot);
        ArgumentNullException.ThrowIfNull(request);
        if (!Enum.IsDefined(request.Scope)) throw new ArgumentOutOfRangeException(nameof(request));
        var source = SnapshotData.Freeze(persistedSnapshot);
        if (source.Revision < 0 || source.Book.Id == Guid.Empty)
            throw new LedgerValidationException("源账套身份或版本无效。");
        var name = RequiredText(request.NewBookName, "新账套名称");
        if (string.Equals(name, source.Book.Name.Trim(), StringComparison.OrdinalIgnoreCase))
            throw new LedgerValidationException("复制为新账套必须使用与源不同的新名称。");
        var actor = RequiredText(request.OperatorName, "操作人");
        var sourcePath = CopyPaths.ExistingSource(request.SourcePath);
        var destination = CopyPaths.NewDestination(sourcePath, request.DestinationPath);
        request = request with { SourcePath = sourcePath, DestinationPath = destination, NewBookName = name, OperatorName = actor };
        var full = request.Scope == BookCopyScope.FullLedger;
        var hasModuleJournal = source.AuditEvents.Any(a => a.Action.StartsWith("ParityModuleCommit.", StringComparison.Ordinal));
        if (full && hasModuleJournal && source.Revision == long.MaxValue)
            throw new LedgerValidationException("源版本已达上限，不能安全建立含历史模块收据的新账套版本。");
        // Keep historical receipt revisions strictly below the new book's initial revision.
        // Their embedded old identities remain provenance, never a new mutation context.
        var targetRevision = full && hasModuleJournal ? source.Revision + 1 : 1;
        var at = clock.GetUtcNow();
        var book = source.Book with
        {
            Id = Guid.NewGuid(), Name = name, CreatedAt = at,
            ClosedThroughMonth = full ? source.Book.ClosedThroughMonth : source.Book.StartMonth - 1
        };
        var provenance = new AuditEvent(Guid.NewGuid(), at, actor, "BookCopiedAsNew", null,
            JsonSerializer.Serialize(new
            {
                SourceBookId = source.Book.Id, SourceName = source.Book.Name,
                SourceRevision = source.Revision, SourceFingerprint = SnapshotData.Fingerprint(source),
                Scope = request.Scope.ToString(), NewBookId = book.Id, NewRevision = targetRevision,
                ModuleJournalIncluded = full && hasModuleJournal,
                ModulePayloadBookIdsRebound = false
            }));
        var target = SnapshotData.Freeze(new LedgerSnapshot(targetRevision, book, source.Accounts,
            full ? source.Vouchers : [], full ? source.AuditEvents.Append(provenance).ToArray() : [provenance]));
        return new BookCopyPlan(request, source, target);
    }

    /// <summary>Call only after the host explicitly confirms this exact plan.
    /// Cancellation is observed between synchronous Storage calls and immediately before publication.</summary>
    public BookCopyResult Execute(BookCopyPlan confirmedPlan, CancellationToken cancellationToken = default,
        IProgress<BookCopyStage>? progress = null)
    {
        ArgumentNullException.ThrowIfNull(confirmedPlan);
        cancellationToken.ThrowIfCancellationRequested();
        var source = CopyPaths.ExistingSource(confirmedPlan.Request.SourcePath);
        var destination = CopyPaths.NewDestination(source, confirmedPlan.Request.DestinationPath);
        // A directory link changed since preview must not silently redirect the confirmed destination.
        if (source != confirmedPlan.Request.SourcePath || destination != confirmedPlan.Request.DestinationPath)
            throw new IOException("路径已变化，请重新预览。");
        validateSource?.Invoke(source);
        validateDestination?.Invoke(destination);
        using var work = new CopyWorkspace(Path.GetDirectoryName(destination)!);
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            // Existing public API opens the source read-only and captures committed WAL consistently.
            SqliteLedgerStore.RestoreBackup(source, work.Capture);
            cancellationToken.ThrowIfCancellationRequested();
            validateSource?.Invoke(work.Capture);
            using (var captured = SqliteLedgerStore.Open(work.Capture))
                SnapshotData.RequireMatch(confirmedPlan.Source, captured.Read(), "源账套已变化，必须重新预览并确认后再复制。");
            progress?.Report(BookCopyStage.SnapshotCaptured);
            cancellationToken.ThrowIfCancellationRequested();
            using (var target = SqliteLedgerStore.CreateFromSnapshot(work.Candidate, confirmedPlan.Target))
            {
                target.CheckIntegrity();
                SnapshotData.RequireMatch(confirmedPlan.Target, target.Read(), "新账套保存回读不一致，复制未发布。");
                progress?.Report(BookCopyStage.TargetSaved);
                cancellationToken.ThrowIfCancellationRequested();
                // Storage's backup API publishes a checked standalone database in DELETE mode.
                target.BackupTo(work.Ready);
            }
            using (var saved = SqliteLedgerStore.Open(work.Ready))
            {
                saved.CheckIntegrity();
                SnapshotData.RequireMatch(confirmedPlan.Target, saved.Read(), "新账套重新打开后不一致，复制未发布。");
            }
            progress?.Report(BookCopyStage.ReadyVerified);
            var savedFingerprint = SnapshotData.Fingerprint(confirmedPlan.Target);
            // Recheck sidecars and host policy, then atomically reject any competing destination.
            if (CopyPaths.NewDestination(source, destination) != destination)
                throw new IOException("目标目录已变化，请重新预览。");
            validateDestination?.Invoke(destination);
            cancellationToken.ThrowIfCancellationRequested();
            NewBookPublication.Publish(work.Ready, destination);
            // Publication is the last fallible functional step; cancellation after it means success.
            var warnings = work.Cleanup();
            return new(confirmedPlan.PlanId, destination, confirmedPlan.NewBook, confirmedPlan.Target.Revision,
                confirmedPlan.TargetCounts, confirmedPlan.SourceFingerprint, savedFingerprint, warnings);
        }
        catch (Exception error)
        {
            var warnings = work.Cleanup();
            if (warnings.Count > 0) error.Data["BookCopyCleanupWarnings"] = string.Join(Environment.NewLine, warnings);
            throw;
        }
    }

    private static string RequiredText(string value, string label)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Any(char.IsControl))
            throw new LedgerValidationException($"{label}不能为空或含控制字符。");
        return value.Trim();
    }
}
