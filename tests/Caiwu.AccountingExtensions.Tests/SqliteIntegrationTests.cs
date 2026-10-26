using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Persistence.Sqlite;
using Microsoft.Data.Sqlite;
using static Caiwu.AccountingExtensions.Tests.SyntheticFixture;

namespace Caiwu.AccountingExtensions.Tests;

public sealed class SqliteIntegrationTests
{
    [Fact]
    public void RecomputeRequiresRemovingLaterClosingThenReplaysMonthsWithoutDoubleTransfer()
    {
        using var f = new SyntheticFixture();
        var initial = State();
        var path = Path.Combine(f.DirectoryPath, "cross-month-recompute-synthetic.caiwu");
        using var store = SqliteLedgerStore.Create(path, initial.Book, initial.Accounts);
        store.Write(initial with { Revision = 1, Vouchers = [Receipt(amount: 100)] }, 0);
        var core = new LedgerService(store);
        var service = f.Service(store);
        void ReviewAndPost(Voucher voucher)
        {
            core.Review(voucher.Id, f.Reviewer.Identity.ActorKey, Context(store.Read()));
            core.Post(voucher.Id, f.Reviewer.Identity.ActorKey, Context(store.Read()));
        }
        void RejectJanuary()
        {
            var before = store.Read();
            Assert.Throws<LedgerValidationException>(() => service.GenerateMonthlyTransfer(Transfer(before, 1)));
            Assert.Equal(before.Revision, store.Read().Revision);
            Assert.Equal(before.AuditEvents.Count, store.Read().AuditEvents.Count);
        }

        var oldRequest = Transfer(store.Read(), 2);
        var oldClosing = service.GenerateMonthlyTransfer(oldRequest);
        ReviewAndPost(oldClosing);
        RejectJanuary();
        Assert.Throws<LedgerValidationException>(() => service.ReversePosting(new(2026, 1, 1, false, Context(store.Read()))));

        service.ReversePosting(new(2026, 2, 2, false, Context(store.Read())));
        RejectJanuary(); // Reviewed later closing must not survive and then be reposted.
        core.CancelReview(oldClosing.Id, f.Worker.Identity.ActorKey, Context(store.Read()));
        RejectJanuary(); // Merely making it Draft does not invalidate the dependency.
        core.DeleteDraft(oldClosing.Id, f.Worker.Identity.ActorKey, Context(store.Read()));
        Assert.Throws<StoreConcurrencyException>(() => service.GenerateMonthlyTransfer(oldRequest));

        ReviewAndPost(service.GenerateMonthlyTransfer(Transfer(store.Read(), 1)));
        Assert.Throws<LedgerValidationException>(() => service.GenerateMonthlyTransfer(Transfer(store.Read(), 2)));
        var current = store.Read();
        var februaryIncome = core.SaveDraft(new(null, new(2026, 2, 10), "记", null, 0,
            [new("1001", "合成二月收入", 50, 0), new("6001", "合成二月收入", 0, 50)],
            current.Revision, current.Book.Id), f.Worker.Identity.ActorKey);
        ReviewAndPost(februaryIncome);
        var replacement = service.GenerateMonthlyTransfer(Transfer(store.Read(), 2));
        Assert.Equal(50, replacement.Lines.Single(l => l.AccountCode == "4103").Credit);
        ReviewAndPost(replacement);

        using var independent = SqliteLedgerStore.Open(path);
        var rows = new LedgerService(independent).GetTrialBalance(new(2026, 1, 1), new(2026, 2, 28));
        Assert.Equal(0, rows.Single(r => r.AccountCode == "6001").ClosingDebit);
        Assert.Equal(0, rows.Single(r => r.AccountCode == "6001").ClosingCredit);
        Assert.Equal(150, rows.Single(r => r.AccountCode == "4103").ClosingCredit);
        Assert.DoesNotContain(independent.Read().Vouchers, v => v.Id == oldClosing.Id);
        independent.CheckIntegrity();
    }

    [Fact]
    public void ActualStoreReopenReverseRepostAndTransferSurviveIndependentReadback()
    {
        using var f = new SyntheticFixture();
        var initial = State();
        var path = Path.Combine(f.DirectoryPath, "synthetic.caiwu");
        Guid generatedId;
        using (var store = SqliteLedgerStore.Create(path, initial.Book, initial.Accounts))
        {
            store.Write(initial with { Revision = 1, Vouchers = [Receipt(), Expense()] }, 0);
            var core = new LedgerService(store);
            core.CloseMonth(1, f.Worker.Identity.ActorKey, Context(store.Read()));
            var service = f.Service(store);
            Assert.Throws<LedgerValidationException>(() => service.ReversePosting(new(2026, 1, 1, false, Context(store.Read()))));
            service.ReopenPeriod(new(2026, false, Context(store.Read())));
            service.ReversePosting(new(2026, 1, 1, false, Context(store.Read())));
            Assert.All(store.Read().Vouchers, v => Assert.Equal(VoucherStatus.Reviewed, v.Status));
            foreach (var id in store.Read().Vouchers.Select(v => v.Id))
                core.Post(id, f.Worker.Identity.ActorKey, Context(store.Read()));
            var draft = service.GenerateMonthlyTransfer(Transfer(store.Read()));
            generatedId = draft.Id;
            f.Operators.ExecuteReview(f.Reviewer, draft.PreparedBy, actor =>
            {
                core.Review(draft.Id, actor.ActorKey, Context(store.Read())); return true;
            });
            core.Post(draft.Id, f.Reviewer.Identity.ActorKey, Context(store.Read()));
            store.CheckIntegrity();
        }
        using (var independent = SqliteLedgerStore.Open(path))
        {
            var state = independent.Read();
            Assert.Equal(0, state.Book.ClosedThroughMonth);
            Assert.Equal(VoucherStatus.Posted, state.Vouchers.Single(v => v.Id == generatedId).Status);
            Assert.Equal(2, state.AuditEvents.Count(a => a.Action == "ReversePosting"));
            Assert.Single(state.AuditEvents, a => a.Action == "ReopenPeriod");
            var rows = new LedgerService(independent).GetTrialBalance(new(2026, 1, 1), new(2026, 1, 31));
            Assert.Equal(750, rows.Single(r => r.AccountCode == "4103").ClosingCredit);
            Assert.Equal(0, rows.Single(r => r.AccountCode == "6001").ClosingCredit);
        }
        using var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path }.ToString());
        db.Open();
        using var command = db.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM vouchers WHERE status = 2";
        Assert.Equal(3L, command.ExecuteScalar());
    }

    [Fact]
    public void ActualStoreRollsBackVoucherStatusRevisionAndAuditsOnAuditInsertFailure()
    {
        using var f = new SyntheticFixture();
        var initial = State();
        var path = Path.Combine(f.DirectoryPath, "rollback-synthetic.caiwu");
        using var store = SqliteLedgerStore.Create(path, initial.Book, initial.Accounts);
        store.Write(initial with { Revision = 1, Vouchers = [Receipt()] }, 0);
        var before = store.Read();
        using (var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path }.ToString()))
        {
            db.Open(); using var command = db.CreateCommand();
            command.CommandText = "CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='ReversePosting' BEGIN SELECT RAISE(ABORT,'synthetic audit fault'); END";
            command.ExecuteNonQuery();
        }
        Assert.Throws<SqliteException>(() => f.Service(store).ReversePosting(new(2026, 1, 1, false, Context(before))));
        using var independent = SqliteLedgerStore.Open(path);
        var after = independent.Read();
        Assert.Equal(before.Revision, after.Revision); Assert.Equal(before.Book, after.Book);
        Assert.Equal(before.Vouchers[0].Status, after.Vouchers[0].Status); Assert.Equal(before.AuditEvents, after.AuditEvents);
        independent.CheckIntegrity();
    }
}
