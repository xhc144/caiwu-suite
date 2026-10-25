using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Persistence.Sqlite;
using Xunit;

namespace Caiwu.BookTools.Tests;

public sealed class CopyTests
{
    [Fact]
    public void Full_copy_has_new_identity_and_preserves_every_contract_field_and_balances()
    {
        using var f = new SyntheticBook();
        var before = f.Read();
        var sourceHash = SyntheticBook.Hash(f.Source);
        var service = new BookCopyService();
        var p = f.Preview(service: service);
        var result = service.Execute(p);
        var actual = f.Read(f.Destination);

        Assert.NotEqual(before.Book.Id, actual.Book.Id);
        Assert.Equal(p.NewBook, actual.Book);
        Assert.Equal("合成新账套", actual.Book.Name);
        Assert.Equal(1, actual.Revision);
        Assert.Equal(before.Book.Regime, actual.Book.Regime);
        Assert.Equal(before.Book.TemplateVersion, actual.Book.TemplateVersion);
        Assert.Equal(before.Book.FiscalYear, actual.Book.FiscalYear);
        Assert.Equal(before.Book.StartMonth, actual.Book.StartMonth);
        Assert.Equal(before.Book.ClosedThroughMonth, actual.Book.ClosedThroughMonth);
        Assert.Equal(before.Accounts, actual.Accounts);
        AssertVouchers(before.Vouchers, actual.Vouchers);
        Assert.Equal(before.AuditEvents, actual.AuditEvents.Take(before.AuditEvents.Count));
        var audit = actual.AuditEvents.Last();
        Assert.Equal("BookCopiedAsNew", audit.Action);
        Assert.Equal("合成复制人", audit.OperatorName);
        Assert.Null(audit.VoucherId);
        Assert.Contains(before.Book.Id.ToString(), audit.Detail);
        Assert.Contains(p.SourceFingerprint, audit.Detail);
        Assert.Equal(p.NewBook.CreatedAt, audit.At);
        Assert.Equal(sourceHash, SyntheticBook.Hash(f.Source));
        AssertSnapshot(before, f.Read());
        Assert.Empty(result.CleanupWarnings);
        Assert.Empty(Directory.GetDirectories(f.Root));
        using var target = SqliteLedgerStore.Open(f.Destination);
        var ledger = new LedgerService(target);
        var trial = ledger.GetTrialBalance(new(2026, 1, 1), new(2026, 1, 31));
        Assert.Equal(108800, trial.Single(a => a.AccountCode == "1002").ClosingDebit);
        Assert.Equal(10000, trial.Single(a => a.AccountCode == "140301").ClosingDebit);
        Assert.Equal(1200, trial.Single(a => a.AccountCode == "6602").ClosingDebit);
        Assert.Equal(20000, trial.Single(a => a.AccountCode == "6001").ClosingCredit);
        Assert.Equal(31200, trial.Where(a => a.IsLeaf).Sum(a => a.PeriodDebit));
        Assert.Equal(120000, trial.Where(a => a.IsLeaf).Sum(a => a.ClosingDebit));
        Assert.Equal(120000, trial.Where(a => a.IsLeaf).Sum(a => a.ClosingCredit));
        Assert.Equal(result.Book, actual.Book);
        Assert.Equal(result.PlanId, p.PlanId);
        Assert.NotEqual(result.SourceFingerprint, result.SavedFingerprint);
    }

    [Fact]
    public void Accounts_and_openings_copy_does_not_roll_posted_activity_into_openings()
    {
        using var f = new SyntheticBook();
        var before = f.Read();
        new BookCopyService().Execute(f.Preview(BookCopyScope.AccountsAndOpeningBalances));
        var actual = f.Read(f.Destination);
        Assert.Equal(before.Accounts, actual.Accounts);
        Assert.Empty(actual.Vouchers);
        Assert.Equal(actual.Book.StartMonth - 1, actual.Book.ClosedThroughMonth);
        Assert.Equal(100000, actual.Accounts.Single(a => a.Code == "1002").OpeningDebit);
        Assert.Equal(10, actual.Accounts.Single(a => a.Code == "9999").OpeningCredit);
        Assert.False(actual.Accounts.Single(a => a.Code == "9999").IsActive);
        Assert.Equal("BookCopiedAsNew", Assert.Single(actual.AuditEvents).Action);
        using var target = SqliteLedgerStore.Open(f.Destination);
        var core = new LedgerService(target);
        var saved = core.SaveDraft(new(null, new(2026, 1, 10), "记", null, 0,
            [new("1002", "新业务", 1.23m, 0), new("6001", "新业务", 0, 1.23m)]), "新制单");
        Assert.Equal(1, saved.Number);
        Assert.Equal(VoucherStatus.Draft, saved.Status);
        Assert.Equal(2, target.Read().Revision);
        AssertSnapshot(before, f.Read());
    }

    [Fact]
    public void Restore_preserves_identity_and_revision_while_new_book_restarts_local_revision()
    {
        using var f = new SyntheticBook();
        using (var store = SqliteLedgerStore.Open(f.Source))
        {
            var s = store.Read();
            store.Write(s with { Revision = 2 }, 1);
            store.Write(s with { Revision = 3 }, 2);
        }
        var before = f.Read();
        var restored = Path.Combine(f.Root, "restored.caiwu");
        SqliteLedgerStore.RestoreBackup(f.Source, restored);
        AssertSnapshot(before, f.Read(restored));
        new BookCopyService().Execute(f.Preview());
        var actual = f.Read(f.Destination);
        Assert.NotEqual(before.Book.Id, actual.Book.Id);
        Assert.Equal(1, actual.Revision);
        using var target = SqliteLedgerStore.Open(f.Destination);
        Assert.Throws<LedgerValidationException>(() => target.Write(before with { Revision = 2 }, 1));
        AssertSnapshot(actual, target.Read());
        using var sameIdentity = SqliteLedgerStore.Open(restored);
        sameIdentity.Write(before with { Revision = 4 }, 3);
        Assert.Equal(before.Book.Id, sameIdentity.Read().Book.Id);
        Assert.Equal(3, f.Read().Revision);
    }

    [Fact]
    public void Actual_raw_sql_confirms_saved_identity_money_state_and_no_half_destination()
    {
        using var f = new SyntheticBook();
        var p = f.Preview();
        new BookCopyService().Execute(p);
        using var db = f.Raw(f.Destination);
        using var q = db.CreateCommand();
        q.CommandText = "SELECT book_id, name, revision, closed_through_month FROM ledger";
        using (var r = q.ExecuteReader())
        {
            Assert.True(r.Read()); Assert.Equal(p.NewBook.Id.ToString("D"), r.GetString(0));
            Assert.Equal("合成新账套", r.GetString(1)); Assert.Equal(1, r.GetInt64(2)); Assert.Equal(1, r.GetInt64(3));
            Assert.False(r.Read());
        }
        q.CommandText = "SELECT opening_debit_cents FROM accounts WHERE code='1002'";
        Assert.Equal(10000000L, q.ExecuteScalar());
        q.CommandText = "SELECT sum(debit_cents) FROM voucher_lines JOIN vouchers ON vouchers.id=voucher_id WHERE status=2";
        Assert.Equal(3120000L, q.ExecuteScalar());
        q.CommandText = "SELECT count(*) FROM vouchers";
        Assert.Equal(5L, q.ExecuteScalar());
        q.CommandText = "PRAGMA integrity_check"; Assert.Equal("ok", q.ExecuteScalar());
        q.CommandText = "PRAGMA foreign_key_check"; Assert.Null(q.ExecuteScalar());
    }

    [Fact]
    public void Copy_can_read_a_readonly_backup_without_rewriting_original_or_backup()
    {
        using var f = new SyntheticBook();
        var snapshot = f.Read();
        var hash = SyntheticBook.Hash(f.Source);
        var backup = Path.Combine(f.Root, "archive-backup.caiwu");
        SqliteLedgerStore.RestoreBackup(f.Source, backup);
        var backupHash = SyntheticBook.Hash(backup);
        var attrs = File.GetAttributes(backup);
        File.SetAttributes(backup, attrs | FileAttributes.ReadOnly);
        try
        {
            var service = new BookCopyService();
            var p = service.Preview(snapshot, new(backup, f.Destination, "只读合成副本", BookCopyScope.FullLedger, "合成"));
            service.Execute(p);
            Assert.Equal(hash, SyntheticBook.Hash(f.Source));
            Assert.Equal(backupHash, SyntheticBook.Hash(backup));
            AssertVouchers(snapshot.Vouchers, f.Read(f.Destination).Vouchers);
        }
        finally { File.SetAttributes(backup, attrs); }
    }

    internal static void AssertSnapshot(LedgerSnapshot expected, LedgerSnapshot actual)
    {
        Assert.Equal(expected.Revision, actual.Revision); Assert.Equal(expected.Book, actual.Book);
        Assert.Equal(expected.Accounts, actual.Accounts); AssertVouchers(expected.Vouchers, actual.Vouchers);
        Assert.Equal(expected.AuditEvents, actual.AuditEvents);
    }

    private static void AssertVouchers(IReadOnlyList<Voucher> expected, IReadOnlyList<Voucher> actual)
    {
        Assert.Equal(expected.Count, actual.Count);
        for (var i = 0; i < expected.Count; i++)
        {
            Assert.Equal(expected[i] with { Lines = actual[i].Lines }, actual[i]);
            Assert.Equal(expected[i].Lines, actual[i].Lines);
        }
    }
}
