using System.Text.Json.Nodes;
using Caiwu.Operators;

namespace Caiwu.Operators.Tests;

public sealed class OperatorServiceTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "caiwu-operators-tests-" + Guid.NewGuid().ToString("N"));
    // Deliberately synthetic test input, never a product default or a real user's password.
    private static string Password => "Synthetic-" + "Only-credential-2026";
    private readonly FileOperatorStore _store;
    private readonly LocalOperatorService _service;
    private OperatorSession Admin => _service.Login("admin-test", Password);
    public OperatorServiceTests()
    {
        _store = new FileOperatorStore(_root); _service = new LocalOperatorService(_store);
        _service.InitializeAdministrator("admin-test", "虚构管理员", Password);
    }
    public void Dispose() { if (Directory.Exists(_root)) Directory.Delete(_root, true); }
    private OperatorIdentity Add(OperatorRoles roles = OperatorRoles.Reader, string login = "user-test", string display = "虚构操作员")
    {
        var admin = Admin;
        return _service.AddOperator(admin, _service.GetDirectory(admin).Revision, login, display, Password, roles);
    }
    private byte[] Bytes() => File.ReadAllBytes(_store.DataFilePath);

    [Fact] public void CorrectLoginUsesNormalizedImmutableIdentity()
    {
        var identity = Add(); var session = _service.Login(" USER-test ", Password);
        Assert.Equal(identity, session.Identity);
        Assert.Equal("operator:" + identity.Id.ToString("N"), identity.ActorKey);
        Assert.Equal(identity, _service.RequirePermission(session, OperatorPermission.ReadLedger));
    }
    [Theory] [InlineData("admin-test", "incorrect")] [InlineData("unknown-test", "incorrect")] [InlineData("!", "incorrect")]
    public void WrongLoginDoesNotWriteOrCreateUsableSession(string login, string password)
    {
        var before = Bytes();
        Assert.Throws<OperatorAuthorizationException>(() => _service.Login(login, password));
        Assert.Equal(before, Bytes());
    }
    [Fact] public void FirstUseDuplicateSubmissionDoesNotReplaceAdministrator()
    {
        var before = Bytes();
        Assert.False(_service.IsFirstUse);
        Assert.Throws<OperatorValidationException>(() => _service.InitializeAdministrator("replacement", "替换管理员", Password));
        Assert.Equal(before, Bytes()); Assert.Equal("ADMIN-TEST", Admin.Identity.LoginName);
    }
    [Fact] public void FirstUseDoesNotSignInAndRequiresARealPassword()
    {
        var folder = Path.Combine(_root, "unused"); var service = new LocalOperatorService(new(folder));
        Assert.True(service.IsFirstUse);
        Assert.Throws<OperatorValidationException>(() => service.InitializeAdministrator("new-test", "虚构新管理员", "short"));
        Assert.True(service.IsFirstUse);
        service.InitializeAdministrator("new-test", "虚构新管理员", Password);
        Assert.False(service.IsFirstUse);
        Assert.Throws<OperatorAuthorizationException>(() => service.RequirePermission(null!, OperatorPermission.ManageOperators));
    }
    [Fact] public void LogoutAndForeignServiceSessionsAreRejected()
    {
        var session = Admin; var other = new LocalOperatorService(new(_root));
        Assert.Throws<OperatorAuthorizationException>(() => other.RequirePermission(session, OperatorPermission.ReadLedger));
        _service.Logout(session); _service.Logout(session); _service.Logout(null);
        Assert.Throws<OperatorAuthorizationException>(() => _service.RequirePermission(session, OperatorPermission.ReadLedger));
    }
    [Fact] public void DisableRevokesExistingSessionsAcrossInstancesAndKeepsHistory()
    {
        var user = Add(); var session = _service.Login(user.LoginName, Password);
        var other = new LocalOperatorService(new(_root)); var admin = other.Login("admin-test", Password);
        other.UpdateOperator(admin, other.GetDirectory(admin).Revision, user.Id, user.DisplayName, user.Roles, false);
        var before = Bytes();
        Assert.Throws<OperatorAuthorizationException>(() => _service.RequirePermission(session, OperatorPermission.ReadLedger));
        Assert.Throws<OperatorAuthorizationException>(() => _service.Login(user.LoginName, Password));
        Assert.Equal(before, Bytes());
        Assert.Contains(other.GetDirectory(admin).Operators, x => x.Id == user.Id && x.ActorKey == user.ActorKey && !x.IsEnabled);
        Assert.Equal(user.Id, other.ResolveActor(admin, user.ActorKey)!.Id);
        Assert.Null(other.ResolveActor(admin, "未映射旧姓名"));
        Assert.Throws<OperatorValidationException>(() => other.AddOperator(admin, other.GetDirectory(admin).Revision,
            user.LoginName, "新的显示名", Password, OperatorRoles.Reader));
        other.UpdateOperator(admin, other.GetDirectory(admin).Revision, user.Id, user.DisplayName, user.Roles, true);
        Assert.Equal(user.Id, other.Login(user.LoginName, Password).Identity.Id);
    }
    [Fact] public void RoleRejectionNeverInvokesHostCallbackOrWrites()
    {
        var user = Add(); var session = _service.Login(user.LoginName, Password); var called = false; var before = Bytes();
        Assert.Throws<OperatorAuthorizationException>(() => _service.Execute(session, OperatorPermission.PrepareVoucher, _ => called = true));
        Assert.Throws<OperatorAuthorizationException>(() => _service.GetDirectory(session));
        Assert.Throws<OperatorAuthorizationException>(() => _service.AddOperator(session, 0, "blocked-test", "拒绝", Password, OperatorRoles.Administrator));
        Assert.False(called); Assert.Equal(before, Bytes());
    }
    [Fact] public void AsyncCallbacksAreRejectedBeforeInvokingHostCode()
    {
        var called = false; var admin = Admin;
        Assert.Throws<ArgumentException>(() =>
        {
            _ = _service.Execute(admin, OperatorPermission.ReadLedger, _ => { called = true; return Task.FromResult(true); });
        });
        Assert.Throws<ArgumentException>(() =>
        {
            _ = _service.ExecuteReview(admin, "unused", _ => { called = true; return ValueTask.FromResult(true); });
        });
        Assert.False(called);
    }
    [Theory]
    [InlineData(OperatorRoles.Administrator, OperatorPermission.ManageOperators)]
    [InlineData(OperatorRoles.Accountant, OperatorPermission.EditAccounts)]
    [InlineData(OperatorRoles.Accountant, OperatorPermission.EditOpeningBalances)]
    [InlineData(OperatorRoles.Preparer, OperatorPermission.PrepareVoucher)]
    [InlineData(OperatorRoles.Reviewer, OperatorPermission.ReviewVoucher)]
    [InlineData(OperatorRoles.Poster, OperatorPermission.PostVoucher)]
    [InlineData(OperatorRoles.PeriodCloser, OperatorPermission.ClosePeriod)]
    [InlineData(OperatorRoles.Accountant, OperatorPermission.BackupLedger)]
    [InlineData(OperatorRoles.Administrator, OperatorPermission.RestoreLedger)]
    public void RoleGrantsOnlyExplicitCapabilities(OperatorRoles role, OperatorPermission granted)
    {
        var user = Add(role); var session = _service.Login(user.LoginName, Password);
        Assert.Equal(user.Id, _service.RequirePermission(session, granted).Id);
        foreach (var permission in Enum.GetValues<OperatorPermission>())
        {
            var expected = permission == OperatorPermission.ReadLedger || (role, permission) switch
            {
                (OperatorRoles.Administrator, OperatorPermission.ManageOperators or OperatorPermission.RestoreLedger) => true,
                (OperatorRoles.Accountant, OperatorPermission.EditAccounts or OperatorPermission.EditOpeningBalances or OperatorPermission.BackupLedger) => true,
                (OperatorRoles.Preparer, OperatorPermission.PrepareVoucher) => true,
                (OperatorRoles.Reviewer, OperatorPermission.ReviewVoucher) => true,
                (OperatorRoles.Poster, OperatorPermission.PostVoucher) => true,
                (OperatorRoles.PeriodCloser, OperatorPermission.ClosePeriod) => true,
                _ => false
            };
            if (expected) _service.RequirePermission(session, permission);
            else Assert.Throws<OperatorAuthorizationException>(() => _service.RequirePermission(session, permission));
        }
    }
    [Fact] public void StaleRevisionAndLastAdministratorProtectionHaveNoSideEffects()
    {
        var admin = Admin; var revision = _service.GetDirectory(admin).Revision;
        Add(); var before = Bytes();
        Assert.Throws<OperatorConcurrencyException>(() => _service.AddOperator(admin, revision, "stale-test", "虚构过期", Password, OperatorRoles.Reader));
        Assert.Throws<OperatorValidationException>(() => _service.UpdateOperator(admin, revision + 1, admin.Identity.Id, admin.Identity.DisplayName, OperatorRoles.Reader, true));
        Assert.Throws<OperatorValidationException>(() => _service.UpdateOperator(admin, revision + 1, admin.Identity.Id, admin.Identity.DisplayName, OperatorRoles.Administrator, false));
        Assert.Equal(before, Bytes());
    }
    [Fact] public void PasswordsAreSaltedAndNotPersistedInPlainText()
    {
        Add(); var json = File.ReadAllText(_store.DataFilePath);
        Assert.DoesNotContain(Password, json); Assert.DoesNotContain("Token", json);
        var records = JsonNode.Parse(json)!["Operators"]!.AsArray();
        Assert.NotEqual(records[0]!["PasswordHash"]!.GetValue<string>(), records[1]!["PasswordHash"]!.GetValue<string>());
    }
    [Fact] public void RenameCannotChangeActorOrAllowSelfReview()
    {
        var user = Add(OperatorRoles.Preparer | OperatorRoles.Reviewer); var session = _service.Login(user.LoginName, Password);
        var admin = Admin; var revised = _service.UpdateOperator(admin, _service.GetDirectory(admin).Revision, user.Id, "改名仍是同一人", user.Roles, true);
        Assert.Equal(user.Id, revised.Id); Assert.Equal(user.ActorKey, revised.ActorKey); Assert.Equal(user.LoginName, revised.LoginName);
        Assert.Throws<OperatorAuthorizationException>(() => _service.RequirePermission(session, OperatorPermission.ReadLedger));
        var renamed = _service.Login(user.LoginName, Password); var called = false;
        Assert.Throws<OperatorAuthorizationException>(() => _service.ExecuteReview(renamed, user.ActorKey, _ => called = true));
        Assert.Throws<OperatorAuthorizationException>(() => _service.ExecuteReview(renamed, user.DisplayName, _ => called = true));
        Assert.False(called);
        var reviewer = Add(OperatorRoles.Reviewer, "review-test", "虚构独立审核员");
        Assert.Equal(reviewer.ActorKey, _service.ExecuteReview(_service.Login(reviewer.LoginName, Password), user.ActorKey, x => x.ActorKey));
    }
    [Fact] public void ResetAndChangePasswordRevokeOldSessionsAndRejectOldPassword()
    {
        var user = Add(); var session = _service.Login(user.LoginName, Password); var admin = Admin;
        var newPassword = Password + "-changed";
        _service.ResetPassword(admin, _service.GetDirectory(admin).Revision, user.Id, newPassword);
        Assert.Throws<OperatorAuthorizationException>(() => _service.RequirePermission(session, OperatorPermission.ReadLedger));
        Assert.Throws<OperatorAuthorizationException>(() => _service.Login(user.LoginName, Password));
        var current = _service.Login(user.LoginName, newPassword); var before = Bytes();
        Assert.Throws<OperatorAuthorizationException>(() => _service.ChangePassword(current, "wrong", Password));
        Assert.Equal(before, Bytes());
        _service.ChangePassword(current, newPassword, Password);
        Assert.Throws<OperatorAuthorizationException>(() => _service.RequirePermission(current, OperatorPermission.ReadLedger));
        Assert.Equal(user.Id, _service.Login(user.LoginName, Password).Identity.Id);
    }
    [Theory] [InlineData("corrupt")] [InlineData("missing-data")] [InlineData("missing-marker")] [InlineData("future-schema")] [InlineData("actor-tampered")]
    public void DamagedStoreNeverOffersSetupOrCreatesReplacement(string damage)
    {
        var marker = Path.Combine(_root, "operators.initialized");
        switch (damage)
        {
            case "corrupt": File.WriteAllText(_store.DataFilePath, "{"); break;
            case "missing-data": File.Delete(_store.DataFilePath); break;
            case "missing-marker": File.Delete(marker); break;
            default:
                var node = JsonNode.Parse(File.ReadAllText(_store.DataFilePath))!;
                if (damage == "future-schema") node["SchemaVersion"] = 999;
                else node["Operators"]![0]!["ActorKey"] = "different";
                File.WriteAllText(_store.DataFilePath, node.ToJsonString()); break;
        }
        var exists = File.Exists(_store.DataFilePath); var before = exists ? Bytes() : [];
        Assert.Throws<OperatorStorageException>(() => _service.IsFirstUse);
        Assert.Throws<OperatorStorageException>(() => _service.Login("admin-test", Password));
        Assert.Throws<OperatorStorageException>(() => _service.InitializeAdministrator("replace-test", "替换", Password));
        Assert.Equal(exists, File.Exists(_store.DataFilePath)); if (exists) Assert.Equal(before, Bytes());
    }
    [Fact] public void BackupIsConsistentPrivateNewFileAndCannotOverwrite()
    {
        var admin = Admin; Add(); var backup = Path.Combine(_root, "synthetic-backup.json"); var before = Bytes();
        _service.BackupOperators(admin, backup); Assert.Equal(before, File.ReadAllBytes(backup));
        Assert.Throws<OperatorStorageException>(() => _service.BackupOperators(admin, backup));
        Assert.Throws<OperatorValidationException>(() => _service.BackupOperators(admin, _store.DataFilePath));
        Assert.Equal(before, Bytes()); Assert.Empty(Directory.GetFiles(_root, "*.tmp"));
        if (!OperatingSystem.IsWindows())
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(backup));
    }
    [Fact] public void CrossInstanceRevisionConflictPreservesWinner()
    {
        var other = new LocalOperatorService(new(_root)); var first = Admin; var second = other.Login("admin-test", Password);
        var revision = _service.GetDirectory(first).Revision;
        _service.AddOperator(first, revision, "winner-test", "获胜虚构账户", Password, OperatorRoles.Reader); var before = Bytes();
        Assert.Throws<OperatorConcurrencyException>(() => other.AddOperator(second, revision, "loser-test", "过期虚构账户", Password, OperatorRoles.Reader));
        Assert.Equal(before, Bytes()); Assert.DoesNotContain(_service.GetDirectory(first).Operators, x => x.LoginName == "LOSER-TEST");
    }
    [Fact] public void RenameReservesHistoricalDisplayNamesAndDisabledNames()
    {
        var user = Add(); var admin = Admin;
        var changed = _service.UpdateOperator(admin, _service.GetDirectory(admin).Revision, user.Id, "后来的显示名", user.Roles, false);
        var before = Bytes();
        Assert.Throws<OperatorValidationException>(() => _service.AddOperator(admin, _service.GetDirectory(admin).Revision,
            "new-user-test", user.DisplayName, Password, OperatorRoles.Reader));
        Assert.Throws<OperatorValidationException>(() => _service.AddOperator(admin, _service.GetDirectory(admin).Revision,
            "new-user-test", changed.DisplayName, Password, OperatorRoles.Reader));
        Assert.Equal(before, Bytes());
    }
    [Theory] [InlineData(OperatorRoles.None)] [InlineData((OperatorRoles)1024)]
    public void InvalidRolesCannotBePersisted(OperatorRoles roles)
    {
        var admin = Admin; var before = Bytes();
        Assert.Throws<OperatorValidationException>(() => _service.AddOperator(admin, _service.GetDirectory(admin).Revision,
            "invalid-test", "虚构无效角色", Password, roles));
        Assert.Equal(before, Bytes());
    }
    [Fact] public void RestoreToNewDirectoryPreservesHistoricalIdentityAndRejectsOverwrite()
    {
        var user = Add(); var admin = Admin;
        _service.UpdateOperator(admin, _service.GetDirectory(admin).Revision, user.Id, user.DisplayName, user.Roles, false);
        var backup = Path.Combine(_root, "synthetic-restore.json"); var target = Path.Combine(_root, "restored");
        _service.BackupOperators(admin, backup); var before = Bytes();
        _service.RestoreOperatorsToNewDirectory(admin, backup, target);
        var restored = new LocalOperatorService(new(target)); var restoredAdmin = restored.Login("admin-test", Password);
        var directory = restored.GetDirectory(restoredAdmin);
        Assert.Equal(_service.GetDirectory(admin).StoreId, directory.StoreId);
        Assert.Equal(_service.GetDirectory(admin).Revision, directory.Revision);
        Assert.Contains(directory.Operators, x => x.Id == user.Id && x.ActorKey == user.ActorKey && !x.IsEnabled);
        Assert.Throws<OperatorAuthorizationException>(() => restored.RequirePermission(admin, OperatorPermission.ReadLedger));
        Assert.Throws<OperatorValidationException>(() => _service.RestoreOperatorsToNewDirectory(admin, backup, target));
        Assert.Throws<OperatorValidationException>(() => _service.RestoreOperatorsToNewDirectory(admin, backup, _root));
        Assert.Equal(before, Bytes());
    }
    [Fact] public void CorruptBackupAndUnauthorizedRestoreHaveNoDestinationSideEffect()
    {
        var reader = Add(); var session = _service.Login(reader.LoginName, Password); var admin = Admin;
        var backup = Path.Combine(_root, "broken-backup.json"); File.WriteAllText(backup, "{");
        var target = Path.Combine(_root, "must-not-exist"); var before = Bytes();
        Assert.Throws<OperatorAuthorizationException>(() => _service.RestoreOperatorsToNewDirectory(session, backup, target));
        Assert.Throws<OperatorStorageException>(() => _service.RestoreOperatorsToNewDirectory(admin, backup, target));
        Assert.False(Directory.Exists(target)); Assert.Equal(before, Bytes());
    }
    [Fact] public async Task TwoWritersAtSameRevisionCannotOverwriteEachOther()
    {
        var other = new LocalOperatorService(new(_root)); var first = Admin; var second = other.Login("admin-test", Password);
        var revision = _service.GetDirectory(first).Revision;
        using var barrier = new Barrier(2);
        Task<Exception?> Write(LocalOperatorService service, OperatorSession session, string login, string display) => Task.Run(() =>
        {
            barrier.SignalAndWait();
            try { service.AddOperator(session, revision, login, display, Password, OperatorRoles.Reader); return (Exception?)null; }
            catch (OperatorException ex) { return ex; }
        });
        var outcomes = await Task.WhenAll(Write(_service, first, "parallel-one", "虚构并发甲"), Write(other, second, "parallel-two", "虚构并发乙"));
        Assert.Single(outcomes, x => x is null);
        Assert.Single(outcomes, x => x is OperatorConcurrencyException or OperatorStorageException);
        var directory = _service.GetDirectory(first); Assert.Equal(revision + 1, directory.Revision); Assert.Equal(2, directory.Operators.Count);
        Assert.Empty(Directory.GetFiles(_root, "*.tmp"));
    }
    [Fact] public async Task RacingFirstUseDoesNotReplaceTheWinningAdministrator()
    {
        var folder = Path.Combine(_root, "racing-first-use"); var first = new LocalOperatorService(new(folder)); var second = new LocalOperatorService(new(folder));
        using var barrier = new Barrier(2);
        Task<Exception?> Initialize(LocalOperatorService service, string login, string display) => Task.Run(() =>
        {
            barrier.SignalAndWait();
            try { service.InitializeAdministrator(login, display, Password); return (Exception?)null; }
            catch (OperatorException ex) { return ex; }
        });
        var outcomes = await Task.WhenAll(Initialize(first, "first-admin", "虚构管理员甲"), Initialize(second, "second-admin", "虚构管理员乙"));
        Assert.Single(outcomes, x => x is null); Assert.Single(outcomes, x => x is not null); Assert.False(first.IsFirstUse);
        var winner = outcomes[0] is null ? "first-admin" : "second-admin";
        var session = first.Login(winner, Password); var directory = first.GetDirectory(session);
        Assert.Single(directory.Operators); Assert.Equal(1, directory.Revision);
    }
    [Fact] public void ExclusiveLockFailsWithoutModifyingStore()
    {
        var before = Bytes(); using var locked = new FileStream(Path.Combine(_root, "operators.lock"), FileMode.Open, FileAccess.ReadWrite, FileShare.None);
        Assert.Throws<OperatorStorageException>(() => _service.IsFirstUse); Assert.Equal(before, Bytes());
    }
    [Fact] public void RestartRequiresLoginAndPreservesActors()
    {
        var user = Add(); var service = new LocalOperatorService(new(_root)); var session = service.Login(user.LoginName, Password);
        Assert.Equal(user, session.Identity); Assert.Throws<OperatorAuthorizationException>(() => service.RequirePermission(Admin, OperatorPermission.ReadLedger));
    }
    [Fact] public void SessionExpiresAndThrottleCanRecoverWithoutPersistentWrites()
    {
        var clock = new TestClock(); var service = new LocalOperatorService(new(_root), clock, TimeSpan.FromMinutes(1));
        var session = service.Login("admin-test", Password); var before = Bytes();
        clock.Advance(TimeSpan.FromMinutes(2));
        Assert.Throws<OperatorAuthorizationException>(() => service.RequirePermission(session, OperatorPermission.ReadLedger));
        for (var i = 0; i < 5; i++) Assert.Throws<OperatorAuthorizationException>(() => service.Login("admin-test", "wrong"));
        Assert.Throws<OperatorAuthorizationException>(() => service.Login("admin-test", Password));
        clock.Advance(TimeSpan.FromSeconds(31)); Assert.NotNull(service.Login("admin-test", Password)); Assert.Equal(before, Bytes());
    }
    private sealed class TestClock : TimeProvider
    {
        private DateTimeOffset _now = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now += by;
    }
}
