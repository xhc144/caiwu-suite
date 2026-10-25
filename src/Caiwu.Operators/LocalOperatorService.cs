using Microsoft.AspNetCore.Identity;

namespace Caiwu.Operators;

/// <summary>Process-local sessions. Do not expose the raw ledger service to untrusted UI callers.</summary>
public sealed class LocalOperatorService
{
    private readonly FileOperatorStore _store;
    private readonly TimeProvider _clock;
    private readonly PasswordHasher<StoredOperator> _hasher = new();
    private readonly object _gate = new();
    private readonly Dictionary<Guid, SessionEntry> _sessions = [];
    private int _failures;
    private DateTimeOffset _blockedUntil;
    private readonly TimeSpan _sessionLifetime;
    private sealed record SessionEntry(OperatorSession Session, Guid StoreId, Guid SecurityStamp);

    public LocalOperatorService(FileOperatorStore store, TimeProvider? timeProvider = null, TimeSpan? sessionLifetime = null)
    {
        _store = store ?? throw new ArgumentNullException(nameof(store));
        _clock = timeProvider ?? TimeProvider.System;
        _sessionLifetime = sessionLifetime ?? TimeSpan.FromHours(8);
        if (_sessionLifetime <= TimeSpan.Zero || _sessionLifetime > TimeSpan.FromHours(24))
            throw new ArgumentOutOfRangeException(nameof(sessionLifetime));
    }

    public bool IsFirstUse { get { lock (_gate) return _store.Access(doc => doc is null); } }

    /// <summary>Creates an administrator only in a genuinely unused store. Does not sign in.</summary>
    public void InitializeAdministrator(string loginName, string displayName, string password)
    {
        var login = OperatorRules.Login(loginName); var display = OperatorRules.Display(displayName); OperatorRules.Password(password);
        lock (_gate) _store.Access<object?>(doc =>
        {
            if (doc is not null) throw new OperatorValidationException("首次设置已完成，请使用现有管理员登录。");
            var op = NewOperator(login, display, password, OperatorRoles.Administrator);
            _store.WriteLocked(null, new(1, Guid.NewGuid(), 1, [op]), 0);
            return null;
        });
    }

    public OperatorSession Login(string loginName, string password)
    {
        lock (_gate)
        {
            if (_clock.GetUtcNow() < _blockedUntil) throw new OperatorAuthorizationException("登录尝试过多，请稍后再试。");
            string login;
            try { login = OperatorRules.Login(loginName); }
            catch (OperatorValidationException) { return LoginFailed(); }
            return _store.Access(doc =>
            {
                if (doc is null) throw new OperatorAuthorizationException("请先完成管理员首次设置。");
                var op = doc.Operators.SingleOrDefault(x => x.LoginName == login);
                if (op is null || !op.IsEnabled || password is null || password.Length > 128) return LoginFailed();
                PasswordVerificationResult result;
                try { result = _hasher.VerifyHashedPassword(op, op.PasswordHash, password); }
                catch (Exception ex) when (ex is FormatException or ArgumentException or OverflowException)
                { throw new OperatorStorageException("密码记录损坏；请保留存储并联系管理员，不能重新初始化。"); }
                if (result == PasswordVerificationResult.Failed) return LoginFailed();
                if (result == PasswordVerificationResult.SuccessRehashNeeded)
                {
                    op = op with { PasswordHash = _hasher.HashPassword(op, password) };
                    var next = doc with { Revision = checked(doc.Revision + 1), Operators = doc.Operators.Select(x => x.Id == op.Id ? op : x).ToArray() };
                    _store.WriteLocked(doc, next, doc.Revision);
                }
                var now = _clock.GetUtcNow();
                foreach (var expired in _sessions.Where(x => x.Value.Session.ExpiresAt <= now).Select(x => x.Key).ToArray()) _sessions.Remove(expired);
                if (_sessions.Count >= 1000) throw new OperatorAuthorizationException("会话数量已达上限，请退出旧会话或重新启动应用。");
                var session = new OperatorSession(Guid.NewGuid(), op.Identity, now + _sessionLifetime);
                _sessions.Add(session.Token, new(session, doc.StoreId, op.SecurityStamp));
                _failures = 0; _blockedUntil = default;
                return session;
            });
        }
    }

    public void Logout(OperatorSession? session)
    {
        if (session is null) return;
        lock (_gate) _sessions.Remove(session.Token);
    }

    public OperatorIdentity RequirePermission(OperatorSession session, OperatorPermission permission)
        => Execute(session, permission, identity => identity);

    /// <summary>Read-only presentation lookup, including disabled historical identities. Unknown legacy text returns null.</summary>
    public OperatorIdentity? ResolveActor(OperatorSession session, string actorKey)
    {
        lock (_gate) return _store.Access(doc =>
        {
            Require(doc, session, OperatorPermission.ReadLedger);
            return doc!.Operators.SingleOrDefault(x => x.ActorKey == actorKey)?.Identity;
        });
    }

    /// <summary>Checks live authorization and holds the identity-store lock through the host operation.</summary>
    public T Execute<T>(OperatorSession session, OperatorPermission permission, Func<OperatorIdentity, T> operation)
    {
        ArgumentNullException.ThrowIfNull(operation);
        RequireSynchronous<T>();
        lock (_gate) return _store.Access(doc => operation(Require(doc, session, permission).Identity));
    }

    /// <summary>Legacy names are rejected. Pass the actual persisted voucher PreparedBy, not UI text.</summary>
    public T ExecuteReview<T>(OperatorSession session, string preparedActorKey, Func<OperatorIdentity, T> operation)
        => ExecuteReviewFrom(session, () => preparedActorKey, operation);

    // The adapter obtains persisted PreparedBy and validates the caller's original book/revision
    // inside this same authorization lock. No nested call back into this service is required.
    internal T ExecuteReviewFrom<T>(OperatorSession session, Func<string> readPreparedActorKey, Func<OperatorIdentity, T> operation)
    {
        ArgumentNullException.ThrowIfNull(readPreparedActorKey);
        ArgumentNullException.ThrowIfNull(operation);
        RequireSynchronous<T>();
        lock (_gate) return _store.Access(doc =>
        {
            var reviewer = Require(doc, session, OperatorPermission.ReviewVoucher);
            var preparedActorKey = readPreparedActorKey();
            if (!doc!.Operators.Any(x => x.ActorKey == preparedActorKey))
                throw new OperatorAuthorizationException("制单身份未映射到可信操作员；请先完成历史身份迁移。");
            if (reviewer.ActorKey == preparedActorKey)
                throw new OperatorAuthorizationException("制单人与审核人必须分离。");
            return operation(reviewer.Identity);
        });
    }

    /// <summary>Current Core replaces PreparedBy when saving edits. Keep draft editing with its original actor.</summary>
    public T ExecuteDraftEdit<T>(OperatorSession session, string preparedActorKey, Func<OperatorIdentity, T> operation)
        => ExecuteDraftEditFrom(session, () => preparedActorKey, operation);

    internal T ExecuteDraftEditFrom<T>(OperatorSession session, Func<string> readPreparedActorKey, Func<OperatorIdentity, T> operation)
    {
        ArgumentNullException.ThrowIfNull(readPreparedActorKey);
        ArgumentNullException.ThrowIfNull(operation);
        RequireSynchronous<T>();
        lock (_gate) return _store.Access(doc =>
        {
            var preparer = Require(doc, session, OperatorPermission.PrepareVoucher);
            var preparedActorKey = readPreparedActorKey();
            if (preparer.ActorKey != preparedActorKey)
                throw new OperatorAuthorizationException("只能由原制单身份修改草稿；历史姓名须先完成可信映射。");
            return operation(preparer.Identity);
        });
    }

    public OperatorDirectory GetDirectory(OperatorSession administrator)
    {
        lock (_gate) return _store.Access(doc =>
        {
            Require(doc, administrator, OperatorPermission.ManageOperators);
            return new OperatorDirectory(doc!.Revision, doc.StoreId, Array.AsReadOnly(doc.Operators.Select(x => x.Identity).ToArray()));
        });
    }

    public OperatorIdentity AddOperator(OperatorSession administrator, long expectedRevision,
        string loginName, string displayName, string password, OperatorRoles roles)
    {
        var login = OperatorRules.Login(loginName); var display = OperatorRules.Display(displayName);
        OperatorRules.Password(password); OperatorRules.Roles(roles);
        lock (_gate) return _store.Access(doc =>
        {
            Require(doc, administrator, OperatorPermission.ManageOperators); CheckRevision(doc!, expectedRevision);
            if (doc!.Operators.Length >= 1000) throw new OperatorValidationException("操作员已达1000位上限。");
            if (doc.Operators.Any(x => x.LoginName == login || x.ReservedDisplayNames.Contains(display, StringComparer.OrdinalIgnoreCase)))
                throw new OperatorValidationException("登录名或显示名已存在；停用身份也不能重新创建，请启用原身份。");
            var op = NewOperator(login, display, password, roles);
            _store.WriteLocked(doc, doc with { Revision = checked(doc.Revision + 1), Operators = [.. doc.Operators, op] }, expectedRevision);
            return op.Identity;
        });
    }

    /// <summary>Login name, ID and actor key cannot be edited. Disabled identities are never deleted.</summary>
    public OperatorIdentity UpdateOperator(OperatorSession administrator, long expectedRevision,
        Guid operatorId, string displayName, OperatorRoles roles, bool isEnabled)
    {
        var display = OperatorRules.Display(displayName); OperatorRules.Roles(roles);
        lock (_gate) return _store.Access(doc =>
        {
            Require(doc, administrator, OperatorPermission.ManageOperators); CheckRevision(doc!, expectedRevision);
            var old = Find(doc!, operatorId);
            if (doc!.Operators.Any(x => x.Id != operatorId && x.ReservedDisplayNames.Contains(display, StringComparer.OrdinalIgnoreCase)))
                throw new OperatorValidationException("显示名已被其他身份使用。");
            if ((!isEnabled || !roles.HasFlag(OperatorRoles.Administrator)) && old.IsEnabled && old.Roles.HasFlag(OperatorRoles.Administrator) &&
                !doc.Operators.Any(x => x.Id != operatorId && x.IsEnabled && x.Roles.HasFlag(OperatorRoles.Administrator)))
                throw new OperatorValidationException("不能停用或降级最后一位启用的管理员。");
            var names = old.ReservedDisplayNames.Contains(display, StringComparer.OrdinalIgnoreCase)
                ? old.ReservedDisplayNames : [.. old.ReservedDisplayNames, display];
            if (names.Length > 1000) throw new OperatorValidationException("此身份的历史显示名已达上限。");
            var updated = old with { DisplayName = display, Roles = roles, IsEnabled = isEnabled, SecurityStamp = Guid.NewGuid(), ReservedDisplayNames = names };
            SaveUpdated(doc, updated, expectedRevision);
            return updated.Identity;
        });
    }

    public void ResetPassword(OperatorSession administrator, long expectedRevision, Guid operatorId, string newPassword)
    {
        OperatorRules.Password(newPassword);
        lock (_gate) _store.Access<object?>(doc =>
        {
            Require(doc, administrator, OperatorPermission.ManageOperators); CheckRevision(doc!, expectedRevision);
            var old = Find(doc!, operatorId);
            SaveUpdated(doc!, old with { PasswordHash = _hasher.HashPassword(old, newPassword), SecurityStamp = Guid.NewGuid() }, expectedRevision);
            return null;
        });
    }

    public void ChangePassword(OperatorSession session, string currentPassword, string newPassword)
    {
        OperatorRules.Password(newPassword);
        lock (_gate) _store.Access<object?>(doc =>
        {
            var old = Require(doc, session, OperatorPermission.ReadLedger);
            if (currentPassword is null || currentPassword.Length > 128 ||
                _hasher.VerifyHashedPassword(old, old.PasswordHash, currentPassword) == PasswordVerificationResult.Failed)
                throw new OperatorAuthorizationException("当前密码不正确。");
            SaveUpdated(doc!, old with { PasswordHash = _hasher.HashPassword(old, newPassword), SecurityStamp = Guid.NewGuid() }, doc!.Revision);
            return null;
        });
    }

    /// <summary>Exports hashes and immutable identities to a new file. Host must protect backup access.</summary>
    public void BackupOperators(OperatorSession administrator, string absoluteDestination)
    {
        lock (_gate) _store.Access<object?>(doc =>
        {
            Require(doc, administrator, OperatorPermission.ManageOperators);
            _store.BackupLocked(doc!, absoluteDestination); return null;
        });
    }

    /// <summary>Explicit administrator recovery to a new directory only. The host must verify backup provenance.</summary>
    public void RestoreOperatorsToNewDirectory(OperatorSession administrator, string backupPath, string newUserDataDirectory)
    {
        lock (_gate) _store.Access<object?>(doc =>
        {
            Require(doc, administrator, OperatorPermission.ManageOperators);
            FileOperatorStore.RestoreBackupToNewDirectory(backupPath, newUserDataDirectory);
            return null;
        });
    }

    private void SaveUpdated(StoreDocument doc, StoredOperator updated, long revision)
    {
        _store.WriteLocked(doc, doc with { Revision = checked(doc.Revision + 1), Operators = doc.Operators.Select(x => x.Id == updated.Id ? updated : x).ToArray() }, revision);
        foreach (var token in _sessions.Where(x => x.Value.Session.Identity.Id == updated.Id).Select(x => x.Key).ToArray()) _sessions.Remove(token);
    }
    private StoredOperator NewOperator(string login, string display, string password, OperatorRoles roles)
    {
        var id = Guid.NewGuid();
        var op = new StoredOperator(id, OperatorRules.ActorKey(id), login, display, roles, true, "", Guid.NewGuid(), [display]);
        return op with { PasswordHash = _hasher.HashPassword(op, password) };
    }
    private OperatorSession LoginFailed()
    {
        if (++_failures >= 5) { _blockedUntil = _clock.GetUtcNow().AddSeconds(30); _failures = 0; }
        throw new OperatorAuthorizationException("登录名或密码不正确，或账户已停用。");
    }
    private StoredOperator Require(StoreDocument? doc, OperatorSession? session, OperatorPermission permission)
    {
        if (session is null || !_sessions.TryGetValue(session.Token, out var entry) || !ReferenceEquals(entry.Session, session) ||
            session.ExpiresAt <= _clock.GetUtcNow() || doc is null || entry.StoreId != doc.StoreId)
            throw new OperatorAuthorizationException("会话无效或已退出，请重新登录。");
        var op = doc.Operators.SingleOrDefault(x => x.Id == session.Identity.Id);
        if (op is null || !op.IsEnabled || op.SecurityStamp != entry.SecurityStamp)
        { _sessions.Remove(session.Token); throw new OperatorAuthorizationException("操作员权限或密码已变化，请重新登录。"); }
        if (!OperatorRules.Allows(op.Roles, permission)) throw new OperatorAuthorizationException("当前操作员没有此操作权限。");
        return op;
    }
    private static StoredOperator Find(StoreDocument doc, Guid id) => doc.Operators.SingleOrDefault(x => x.Id == id)
        ?? throw new OperatorValidationException("操作员不存在。");
    private static void CheckRevision(StoreDocument doc, long expectedRevision)
    { if (doc.Revision != expectedRevision) throw new OperatorConcurrencyException(); }
    private static void RequireSynchronous<T>()
    {
        var result = typeof(T);
        if (typeof(Task).IsAssignableFrom(result) || result == typeof(ValueTask) ||
            (result.IsGenericType && result.GetGenericTypeDefinition() == typeof(ValueTask<>)))
            throw new ArgumentException("授权回调必须同步完成；不能返回 Task 或 ValueTask。");
    }
}
