using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Operators;

namespace Caiwu.Operators.Tests;

public sealed class AuthorizedLedgerServiceTests
{
    private const OperatorRoles AllAccounting = OperatorRoles.Accountant | OperatorRoles.Preparer | OperatorRoles.Reviewer |
        OperatorRoles.Poster | OperatorRoles.PeriodCloser;
    public static TheoryData<string> Writes => new() { "SaveAccount", "DeleteAccount", "SetOpeningBalances", "SaveDraft", "DeleteDraft", "Review", "CancelReview", "Post", "CloseMonth" };
    public static TheoryData<string> EveryEntry => new() { "GetSnapshot", "GetTrialBalance", "GetLedger", "SaveAccount", "DeleteAccount", "SetOpeningBalances", "SaveDraft", "DeleteDraft", "Review", "CancelReview", "Post", "CloseMonth" };

    [Theory] [MemberData(nameof(Writes))]
    public void ReaderCannotReachAnyOfTheNineUnderlyingWriteEntries(string entry)
    {
        using var fixture = new Fixture(OperatorRoles.Reader); var before = fixture.Data;
        Assert.Throws<OperatorAuthorizationException>(() => fixture.Invoke(entry));
        Assert.Empty(fixture.Spy.Calls); Assert.Equal(before, fixture.Data);
    }

    [Theory] [MemberData(nameof(EveryEntry))]
    public void LogoutAndSwitchingUsersInvalidateEveryEntryOnAnOldCapturedService(string entry)
    {
        using var fixture = new Fixture(AllAccounting); var old = fixture.Guarded;
        fixture.Operators.Logout(fixture.Session);
        var replacement = fixture.Operators.Login(fixture.User.LoginName, Fixture.Password);
        var newService = new AuthorizedLedgerService(fixture.Spy, fixture.Operators, replacement);
        var before = fixture.Data;
        Assert.Throws<OperatorAuthorizationException>(() => fixture.Invoke(entry, old));
        Assert.Empty(fixture.Spy.Calls); Assert.Equal(before, fixture.Data);
        Assert.NotNull(newService.GetSnapshot());
    }

    [Theory] [MemberData(nameof(Writes))]
    public void AllWriteEntriesUseTrustedActorAndTheOriginalTokensWithRealCore(string entry)
    {
        using var fixture = new Fixture(AllAccounting);
        fixture.PrepareFor(entry);
        var originalContext = fixture.Context; var originalDraft = fixture.Draft;
        fixture.Invoke(entry);
        var write = Assert.Single(fixture.Spy.Calls, x => x.Name == entry);
        Assert.Equal(fixture.User.ActorKey, write.Actor); Assert.NotEqual(Fixture.ForgedActor, write.Actor);
        if (entry == "SaveDraft") Assert.Same(originalDraft, fixture.Spy.LastDraft);
        else Assert.Same(originalContext, write.Context);
        Assert.Equal(fixture.User.ActorKey, fixture.Raw.GetSnapshot().AuditEvents.Last().OperatorName);
    }

    [Theory]
    [InlineData("SaveAccount", OperatorRoles.Accountant)]
    [InlineData("DeleteAccount", OperatorRoles.Accountant)]
    [InlineData("SetOpeningBalances", OperatorRoles.Accountant)]
    [InlineData("SaveDraft", OperatorRoles.Preparer)]
    [InlineData("DeleteDraft", OperatorRoles.Preparer)]
    [InlineData("Review", OperatorRoles.Reviewer)]
    [InlineData("CancelReview", OperatorRoles.Reviewer)]
    [InlineData("Post", OperatorRoles.Poster)]
    [InlineData("CloseMonth", OperatorRoles.PeriodCloser)]
    public void EachWriteCanUseItsSpecificRoleWithoutUnrelatedRoles(string entry, OperatorRoles role)
    {
        using var fixture = new Fixture(role); fixture.PrepareFor(entry); fixture.Invoke(entry);
        Assert.Contains(fixture.Spy.Calls, x => x.Name == entry && x.Actor == fixture.User.ActorKey);
    }

    [Fact]
    public void CompleteGuardedCoreLifecycleKeepsDistinctActorsAndHandCalculatedBalances()
    {
        using var fixture = new Fixture(OperatorRoles.Accountant | OperatorRoles.Preparer | OperatorRoles.Reviewer);
        var maker = fixture.Guarded;
        var reviewer = new AuthorizedLedgerService(fixture.Raw, fixture.Operators,
            fixture.Operators.Login(fixture.Other.LoginName, Fixture.Password));
        var posterIdentity = fixture.Operators.AddOperator(fixture.Admin, fixture.Operators.GetDirectory(fixture.Admin).Revision,
            "poster-test", "合成独立记账结账员", Fixture.Password, OperatorRoles.Poster | OperatorRoles.PeriodCloser);
        var poster = new AuthorizedLedgerService(fixture.Raw, fixture.Operators,
            fixture.Operators.Login(posterIdentity.LoginName, Fixture.Password));
        static LedgerMutationContext Context(ILedgerService service)
        { var shown = service.GetSnapshot(); return new(shown.Book.Id, shown.Revision); }
        maker.SaveAccount(new("1009", "合成临时科目", null, BalanceDirection.Debit, true, 0, 0), "伪造管理员", Context(maker));
        maker.DeleteAccount("1009", "另一个伪造人", Context(maker));
        maker.SetOpeningBalances([new("1002", 100m, 0), new("3001", 0, 100m)], "伪造期初人", Context(maker));
        var shown = maker.GetSnapshot();
        var request = new VoucherDraft(null, new(2026, 1, 1), "记", null, 0,
            [new("1002", "合成资金增加", 10m, 0), new("3001", "合成出资", 0, 10m)], shown.Revision, shown.Book.Id);
        var voucher = maker.SaveDraft(request, "并非此人的姓名");
        Assert.Equal(fixture.User.ActorKey, voucher.PreparedBy);
        var reviewContext = Context(maker);
        Assert.Throws<OperatorAuthorizationException>(() => maker.Review(voucher.Id, "伪造审核人", reviewContext));
        reviewer.Review(voucher.Id, "伪造审核人", reviewContext);
        reviewer.CancelReview(voucher.Id, "伪造取消审核人", Context(reviewer));
        shown = maker.GetSnapshot();
        voucher = maker.SaveDraft(request with { Id = voucher.Id, ExpectedRevision = shown.Revision }, "再次伪造名字");
        reviewer.Review(voucher.Id, "伪造名字", Context(reviewer));
        poster.Post(voucher.Id, "伪造名字", Context(poster));
        var actual = maker.GetSnapshot().Vouchers.Single();
        Assert.Equal(VoucherStatus.Posted, actual.Status);
        Assert.Equal(fixture.User.ActorKey, actual.PreparedBy); Assert.Equal(fixture.Other.ActorKey, actual.ReviewedBy);
        var trial = maker.GetTrialBalance(new(2026, 1, 1), new(2026, 1, 31));
        Assert.Equal(110m, trial.Single(row => row.AccountCode == "1002").ClosingDebit);
        Assert.Equal(110m, trial.Single(row => row.AccountCode == "3001").ClosingCredit);
        Assert.Contains(maker.GetLedger("1002", new(2026, 1, 1), new(2026, 1, 31)), row => row.VoucherId == voucher.Id);
        poster.CloseMonth(1, "伪造结账人", Context(poster));
        var final = maker.GetSnapshot(); Assert.Equal(1, final.Book.ClosedThroughMonth);
        Assert.Equal(posterIdentity.ActorKey, final.AuditEvents.Last().OperatorName);
        Assert.All(final.AuditEvents, item => Assert.StartsWith("operator:", item.OperatorName));
    }

    [Fact]
    public void EveryQueryIsGuardedAndReaderCanUseAllThreeReadEntries()
    {
        using var fixture = new Fixture(OperatorRoles.Reader);
        fixture.Invoke("GetSnapshot"); fixture.Invoke("GetTrialBalance"); fixture.Invoke("GetLedger");
        Assert.Equal(new[] { "GetSnapshot", "GetTrialBalance", "GetLedger" }, fixture.Spy.Calls.Select(x => x.Name));
    }

    [Theory] [InlineData("SaveDraft")] [InlineData("DeleteDraft")]
    public void DifferentPreparerCannotEditOrDeleteAnotherActorsDraftEvenWithSpoofedName(string entry)
    {
        using var fixture = new Fixture(OperatorRoles.Preparer); fixture.SeedVoucher(fixture.Other.ActorKey);
        fixture.CaptureDraftEdit(); var before = fixture.Data;
        Assert.Throws<OperatorAuthorizationException>(() => fixture.Invoke(entry));
        Assert.Equal(before, fixture.Data); Assert.DoesNotContain(fixture.Spy.Calls, x => x.Name == entry);
    }

    [Fact]
    public void RenamingAndNewLoginDoNotChangeDraftOwnerOrAllowSelfReview()
    {
        using var fixture = new Fixture(OperatorRoles.Preparer | OperatorRoles.Reviewer); fixture.SeedVoucher(fixture.User.ActorKey);
        var directory = fixture.Operators.GetDirectory(fixture.Admin);
        fixture.Operators.UpdateOperator(fixture.Admin, directory.Revision, fixture.User.Id, "已改名的虚构制单员", fixture.User.Roles, true);
        fixture.CaptureDraftEdit(); var before = fixture.Data;
        Assert.Throws<OperatorAuthorizationException>(() => fixture.Guarded.SaveDraft(fixture.Draft, "伪造名"));
        var fresh = fixture.Operators.Login(fixture.User.LoginName, Fixture.Password);
        ILedgerService service = new AuthorizedLedgerService(fixture.Spy, fixture.Operators, fresh);
        var edited = service.SaveDraft(fixture.Draft, "伪造另一个制单人");
        Assert.Equal(fixture.User.ActorKey, edited.PreparedBy);
        var shown = service.GetSnapshot(); var context = new LedgerMutationContext(shown.Book.Id, shown.Revision);
        var afterEdit = fixture.Data;
        Assert.Throws<OperatorAuthorizationException>(() => service.Review(edited.Id, "看起来是另一个人", context));
        Assert.Equal(afterEdit, fixture.Data); Assert.NotEqual(before, afterEdit);
    }

    [Theory] [InlineData("SaveDraft")] [InlineData("DeleteDraft")] [InlineData("Review")]
    public void UnknownLegacyPreparedNameCannotBeClaimedByTheUi(string entry)
    {
        using var fixture = new Fixture(AllAccounting); fixture.SeedVoucher("未验证的旧制单姓名"); fixture.CaptureDraftEdit();
        var before = fixture.Data;
        Assert.Throws<OperatorAuthorizationException>(() => fixture.Invoke(entry)); Assert.Equal(before, fixture.Data);
        Assert.DoesNotContain(fixture.Spy.Calls, x => x.Name == entry);
    }

    [Theory] [InlineData("SaveDraft")] [InlineData("DeleteDraft")] [InlineData("Review")]
    public void StaleOrForeignSnapshotsAreRejectedBeforeTheMutationIsInvoked(string entry)
    {
        using var fixture = new Fixture(AllAccounting); fixture.SeedVoucher(entry == "Review" ? fixture.Other.ActorKey : fixture.User.ActorKey);
        fixture.CaptureDraftEdit(); var stale = fixture.Context;
        fixture.Raw.SaveAccount(fixture.Raw.GetSnapshot().Accounts.Single(a => a.Code == "1002") with { Name = "外部更新" }, fixture.Other.ActorKey, stale);
        var before = fixture.Data;
        Assert.Throws<StoreConcurrencyException>(() => fixture.Invoke(entry)); Assert.Equal(before, fixture.Data);
        Assert.DoesNotContain(fixture.Spy.Calls, x => x.Name == entry);
        fixture.Context = new(Guid.NewGuid(), fixture.Raw.GetSnapshot().Revision);
        fixture.Draft = fixture.Draft with { ExpectedBookId = fixture.Context.ExpectedBookId, ExpectedRevision = fixture.Context.ExpectedRevision };
        Assert.Throws<StoreConcurrencyException>(() => fixture.Invoke(entry)); Assert.Equal(before, fixture.Data);
    }

    [Theory] [InlineData("SaveDraft")] [InlineData("DeleteDraft")] [InlineData("Review")]
    public void AWriterBetweenOwnershipReadAndMutationIsStillRejectedByCoresOriginalCas(string entry)
    {
        using var fixture = new Fixture(AllAccounting); fixture.SeedVoucher(entry == "Review" ? fixture.Other.ActorKey : fixture.User.ActorKey);
        fixture.CaptureDraftEdit(); var original = fixture.Context; string? winner = null;
        fixture.Spy.AfterRead = shown =>
        {
            fixture.Raw.SaveAccount(shown.Accounts.Single(a => a.Code == "1002") with { Name = "并发获胜更新" }, fixture.Other.ActorKey,
                new(shown.Book.Id, shown.Revision));
            winner = fixture.Data;
        };
        Assert.Throws<StoreConcurrencyException>(() => fixture.Invoke(entry));
        Assert.NotNull(winner); Assert.Equal(winner, fixture.Data);
        var attempted = Assert.Single(fixture.Spy.Calls, x => x.Name == entry);
        if (entry == "SaveDraft") Assert.Equal(original.ExpectedRevision, fixture.Spy.LastDraft!.ExpectedRevision);
        else Assert.Same(original, attempted.Context);
    }

    [Theory] [InlineData("SaveDraft")] [InlineData("DeleteDraft")] [InlineData("Review")]
    public void MissingContextCannotBeSubstitutedWithAFreshRead(string entry)
    {
        using var fixture = new Fixture(AllAccounting); fixture.SeedVoucher(fixture.Other.ActorKey); fixture.CaptureDraftEdit();
        fixture.Context = null!; fixture.Draft = fixture.Draft with { ExpectedBookId = null, ExpectedRevision = null };
        var before = fixture.Data;
        Assert.Throws<StoreConcurrencyException>(() => fixture.Invoke(entry)); Assert.Equal(before, fixture.Data); Assert.Empty(fixture.Spy.Calls);
    }

    [Theory] [InlineData(false)] [InlineData(true)]
    public void CrossInstanceRoleOrEnableChangesRevokeTheCapturedAdapter(bool disable)
    {
        using var fixture = new Fixture(AllAccounting); var other = new LocalOperatorService(new(fixture.Directory));
        var admin = other.Login("admin-test", Fixture.Password); var directory = other.GetDirectory(admin);
        other.UpdateOperator(admin, directory.Revision, fixture.User.Id, fixture.User.DisplayName,
            disable ? fixture.User.Roles : OperatorRoles.Reader, !disable);
        var before = fixture.Data;
        Assert.Throws<OperatorAuthorizationException>(() => fixture.Guarded.GetSnapshot());
        Assert.Throws<OperatorAuthorizationException>(() => fixture.Invoke("SaveDraft"));
        Assert.Empty(fixture.Spy.Calls); Assert.Equal(before, fixture.Data);
    }

    [Fact]
    public void BoundFactoryDoesNotInvokeRawFactoryAfterLogoutOrAdoptANewerLogin()
    {
        using var fixture = new Fixture(AllAccounting); var creations = 0;
        var factory = AuthorizedLedgerServiceFactory.BindSession(fixture.Operators, fixture.Session, _ => { creations++; return fixture.Raw; });
        var first = factory(fixture.Store); Assert.Equal(1, creations);
        fixture.Operators.Logout(fixture.Session); _ = fixture.Operators.Login(fixture.User.LoginName, Fixture.Password);
        Assert.Throws<OperatorAuthorizationException>(() => factory(fixture.Store));
        Assert.Throws<OperatorAuthorizationException>(() => first.GetSnapshot()); Assert.Equal(1, creations);
    }

    private sealed class Fixture : IDisposable
    {
        internal const string Password = "Synthetic-adapter-only-fixture";
        internal const string ForgedActor = "ui-supplied-untrusted-administrator";
        internal string Directory { get; } = Path.Combine(Path.GetTempPath(), "caiwu-authorized-ledger-" + Guid.NewGuid().ToString("N"));
        internal LocalOperatorService Operators { get; }
        internal OperatorIdentity User { get; }
        internal OperatorIdentity Other { get; }
        internal OperatorSession Admin { get; }
        internal OperatorSession Session { get; }
        internal MemoryStore Store { get; }
        internal LedgerService Raw { get; }
        internal ObservedLedger Spy { get; }
        internal ILedgerService Guarded { get; }
        internal LedgerMutationContext Context { get; set; }
        internal VoucherDraft Draft { get; set; }
        private Guid _voucherId;
        internal string Data => JsonSerializer.Serialize(Raw.GetSnapshot());
        internal Fixture(OperatorRoles roles)
        {
            Operators = new(new FileOperatorStore(Directory)); Operators.InitializeAdministrator("admin-test", "合成管理员", Password);
            Admin = Operators.Login("admin-test", Password);
            User = Operators.AddOperator(Admin, Operators.GetDirectory(Admin).Revision, "user-test", "合成当前操作员", Password, roles);
            Other = Operators.AddOperator(Admin, Operators.GetDirectory(Admin).Revision, "other-test", "合成另一操作员", Password, OperatorRoles.Preparer | OperatorRoles.Reviewer);
            Session = Operators.Login(User.LoginName, Password);
            var template = TemplateCatalog.Get(AccountingRegime.SmallBusiness);
            Store = new(new(0, new(Guid.NewGuid(), "合成适配测试账套", template.Regime, template.Version, 2026, 1, 0, DateTimeOffset.UtcNow), template.Accounts, [], []));
            Raw = new(Store); Spy = new(Raw); Guarded = new AuthorizedLedgerService(Spy, Operators, Session);
            Context = CurrentContext(); Draft = NewDraft();
        }
        private LedgerMutationContext CurrentContext() { var snapshot = Raw.GetSnapshot(); return new(snapshot.Book.Id, snapshot.Revision); }
        private VoucherDraft NewDraft() => new(null, new(2026, 1, 1), "记", null, 0,
            [new("1002", "合成借方", 10m, 0), new("3001", "合成贷方", 0, 10m)], Context.ExpectedRevision, Context.ExpectedBookId);
        internal void SeedVoucher(string preparedBy)
        { Context = CurrentContext(); Draft = NewDraft(); _voucherId = Raw.SaveDraft(Draft, preparedBy).Id; Context = CurrentContext(); }
        internal void CaptureDraftEdit()
        { Context = CurrentContext(); Draft = NewDraft() with { Id = _voucherId }; Spy.Calls.Clear(); }
        internal void PrepareFor(string entry)
        {
            if (entry == "DeleteAccount") Raw.SaveAccount(new("1009", "合成可删除科目", null, BalanceDirection.Debit, true, 0, 0), Other.ActorKey, CurrentContext());
            if (entry is "DeleteDraft" or "Review" or "CancelReview" or "Post")
            {
                SeedVoucher(entry == "DeleteDraft" ? User.ActorKey : Other.ActorKey);
                if (entry is "CancelReview" or "Post") Raw.Review(_voucherId, User.ActorKey, CurrentContext());
            }
            Context = CurrentContext(); Draft = NewDraft(); Spy.Calls.Clear();
        }
        internal void Invoke(string name, ILedgerService? service = null)
        {
            service ??= Guarded;
            switch (name)
            {
                case "GetSnapshot": service.GetSnapshot(); break;
                case "GetTrialBalance": service.GetTrialBalance(new(2026, 1, 1), new(2026, 1, 31)); break;
                case "GetLedger": service.GetLedger("1002", new(2026, 1, 1), new(2026, 1, 31)); break;
                case "SaveAccount": service.SaveAccount(Raw.GetSnapshot().Accounts.Single(a => a.Code == "1002") with { Name = "合成重命名" }, ForgedActor, Context); break;
                case "DeleteAccount": service.DeleteAccount("1009", ForgedActor, Context); break;
                case "SetOpeningBalances": service.SetOpeningBalances([new("1002", 100, 0), new("3001", 0, 100)], ForgedActor, Context); break;
                case "SaveDraft": service.SaveDraft(Draft, ForgedActor); break;
                case "DeleteDraft": service.DeleteDraft(_voucherId, ForgedActor, Context); break;
                case "Review": service.Review(_voucherId, ForgedActor, Context); break;
                case "CancelReview": service.CancelReview(_voucherId, ForgedActor, Context); break;
                case "Post": service.Post(_voucherId, ForgedActor, Context); break;
                case "CloseMonth": service.CloseMonth(1, ForgedActor, Context); break;
                default: throw new ArgumentOutOfRangeException(nameof(name));
            }
        }
        public void Dispose() { Store.Dispose(); if (System.IO.Directory.Exists(Directory)) System.IO.Directory.Delete(Directory, true); }
    }
    private sealed class MemoryStore(LedgerSnapshot snapshot) : ILedgerStore
    {
        private LedgerSnapshot _snapshot = snapshot;
        public string DatabasePath => "synthetic-memory";
        public LedgerSnapshot Read() => _snapshot;
        public void Write(LedgerSnapshot next, long expectedRevision)
        { if (_snapshot.Revision != expectedRevision) throw new StoreConcurrencyException("合成并发冲突"); _snapshot = next; }
        public void BackupTo(string destinationPath) => throw new NotSupportedException();
        public void CheckIntegrity() { }
        public void Dispose() { }
    }
    private sealed record Call(string Name, string? Actor = null, LedgerMutationContext? Context = null);
    private sealed class ObservedLedger(ILedgerService inner) : ILedgerService
    {
        internal List<Call> Calls { get; } = [];
        internal VoucherDraft? LastDraft { get; private set; }
        internal Action<LedgerSnapshot>? AfterRead { get; set; }
        public LedgerSnapshot GetSnapshot()
        { Calls.Add(new("GetSnapshot")); var value = inner.GetSnapshot(); var after = AfterRead; AfterRead = null; after?.Invoke(value); return value; }
        public IReadOnlyList<TrialBalanceRow> GetTrialBalance(DateOnly from, DateOnly to)
        { Calls.Add(new("GetTrialBalance")); return inner.GetTrialBalance(from, to); }
        public IReadOnlyList<LedgerEntryRow> GetLedger(string code, DateOnly from, DateOnly to)
        { Calls.Add(new("GetLedger")); return inner.GetLedger(code, from, to); }
        public void SaveAccount(Account a, string actor, LedgerMutationContext? context = null) { Calls.Add(new("SaveAccount", actor, context)); inner.SaveAccount(a, actor, context); }
        public void DeleteAccount(string code, string actor, LedgerMutationContext? context = null) { Calls.Add(new("DeleteAccount", actor, context)); inner.DeleteAccount(code, actor, context); }
        public void SetOpeningBalances(IReadOnlyList<OpeningBalance> balances, string actor, LedgerMutationContext? context = null) { Calls.Add(new("SetOpeningBalances", actor, context)); inner.SetOpeningBalances(balances, actor, context); }
        public Voucher SaveDraft(VoucherDraft draft, string actor) { Calls.Add(new("SaveDraft", actor)); LastDraft = draft; return inner.SaveDraft(draft, actor); }
        public void DeleteDraft(Guid id, string actor, LedgerMutationContext? context = null) { Calls.Add(new("DeleteDraft", actor, context)); inner.DeleteDraft(id, actor, context); }
        public void Review(Guid id, string actor, LedgerMutationContext? context = null) { Calls.Add(new("Review", actor, context)); inner.Review(id, actor, context); }
        public void CancelReview(Guid id, string actor, LedgerMutationContext? context = null) { Calls.Add(new("CancelReview", actor, context)); inner.CancelReview(id, actor, context); }
        public void Post(Guid id, string actor, LedgerMutationContext? context = null) { Calls.Add(new("Post", actor, context)); inner.Post(id, actor, context); }
        public void CloseMonth(int month, string actor, LedgerMutationContext? context = null) { Calls.Add(new("CloseMonth", actor, context)); inner.CloseMonth(month, actor, context); }
    }
}
