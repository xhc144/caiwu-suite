using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Operators;

namespace Caiwu.Operators.Tests;

/// <summary>Real current Core, synthetic in-memory book. No changes to Core or Contracts.</summary>
public sealed class CoreBoundaryTests
{
    [Fact]
    public void TrustedActorMappingSurvivesRenameAndCoreEnforcesSeparateReview()
    {
        var folder = Path.Combine(Path.GetTempPath(), "caiwu-operator-core-" + Guid.NewGuid().ToString("N"));
        try
        {
            var users = new LocalOperatorService(new(folder)); var password = "Synthetic-core-fixture-only";
            users.InitializeAdministrator("admin-test", "虚构管理员", password); var admin = users.Login("admin-test", password);
            var preparer = users.AddOperator(admin, users.GetDirectory(admin).Revision, "prepare-test", "虚构制单员", password, OperatorRoles.Preparer | OperatorRoles.Reviewer);
            var reviewer = users.AddOperator(admin, users.GetDirectory(admin).Revision, "review-test", "虚构审核员", password, OperatorRoles.Reviewer | OperatorRoles.Preparer);
            var makerSession = users.Login(preparer.LoginName, password);
            var template = TemplateCatalog.Get(AccountingRegime.SmallBusiness);
            var snapshot = new LedgerSnapshot(0, new(Guid.NewGuid(), "纯合成账套", template.Regime, template.Version, 2026, 1, 0, DateTimeOffset.UtcNow),
                template.Accounts, [], []);
            using var store = new MemoryStore(snapshot); var ledger = new LedgerService(store);
            var draft = new VoucherDraft(null, new(2026, 1, 1), "记", null, 0,
                [new("1002", "合成借方", 10m, 0), new("3001", "合成贷方", 0, 10m)], snapshot.Revision, snapshot.Book.Id);
            var voucher = users.Execute(makerSession, OperatorPermission.PrepareVoucher, actor => ledger.SaveDraft(draft, actor.ActorKey));
            Assert.Equal(preparer.ActorKey, voucher.PreparedBy);
            Assert.Equal(preparer.ActorKey, ledger.GetSnapshot().AuditEvents.Single().OperatorName);
            users.UpdateOperator(admin, users.GetDirectory(admin).Revision, preparer.Id, "显示名已变", preparer.Roles, true);
            var renamed = users.Login(preparer.LoginName, password); var before = ledger.GetSnapshot();
            var context = new LedgerMutationContext(before.Book.Id, before.Revision);
            var reviewerSession = users.Login(reviewer.LoginName, password);
            var edit = draft with { Id = voucher.Id, ExpectedRevision = before.Revision };
            Assert.Throws<OperatorAuthorizationException>(() => users.ExecuteDraftEdit(reviewerSession, voucher.PreparedBy,
                actor => ledger.SaveDraft(edit, actor.ActorKey)));
            Assert.Throws<OperatorAuthorizationException>(() => users.ExecuteReview(renamed, voucher.PreparedBy, actor =>
            { ledger.Review(voucher.Id, actor.ActorKey, context); return true; }));
            // Even if a host skips the extra review guard, stable actor strings preserve Core's check.
            Assert.Throws<LedgerValidationException>(() => users.Execute(renamed, OperatorPermission.ReviewVoucher, actor =>
            { ledger.Review(voucher.Id, actor.ActorKey, context); return true; }));
            Assert.Equal(before.Revision, ledger.GetSnapshot().Revision);
            Assert.Throws<OperatorValidationException>(() => users.AddOperator(admin, users.GetDirectory(admin).Revision,
                "prepare-test", "另一个名字", password, OperatorRoles.Reviewer));
            Assert.Throws<OperatorValidationException>(() => users.AddOperator(admin, users.GetDirectory(admin).Revision,
                "new-user-test", preparer.DisplayName, password, OperatorRoles.Reviewer));
            users.ExecuteReview(reviewerSession, voucher.PreparedBy, actor => { ledger.Review(voucher.Id, actor.ActorKey, context); return true; });
            var reviewed = ledger.GetSnapshot().Vouchers.Single();
            Assert.Equal(VoucherStatus.Reviewed, reviewed.Status); Assert.Equal(reviewer.ActorKey, reviewed.ReviewedBy);
            Assert.Equal(preparer.ActorKey, reviewed.PreparedBy);
        }
        finally { if (Directory.Exists(folder)) Directory.Delete(folder, true); }
    }
    private sealed class MemoryStore(LedgerSnapshot initial) : ILedgerStore
    {
        private LedgerSnapshot _snapshot = initial;
        public string DatabasePath => "synthetic-memory-only";
        public LedgerSnapshot Read() => _snapshot;
        public void Write(LedgerSnapshot next, long expectedRevision)
        {
            if (_snapshot.Revision != expectedRevision) throw new StoreConcurrencyException("synthetic revision conflict");
            _snapshot = next;
        }
        public void BackupTo(string destinationPath) => throw new NotSupportedException();
        public void CheckIntegrity() { }
        public void Dispose() { }
    }
}
