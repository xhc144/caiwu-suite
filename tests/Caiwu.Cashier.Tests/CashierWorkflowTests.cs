using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace Caiwu.Cashier.Tests;

// Every file and ledger entry is generated here. No original program or real account set is used.
public sealed class CashierWorkflowTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "cashier-tests-" + Guid.NewGuid().ToString("N"));
    private readonly SqliteCashierStore store;
    private readonly CashierService service;
    private static readonly AccountKey Cash = new("1001", "CNY");
    private static readonly AccountKey Bank = new("1002", "CNY");
    private static readonly AccountKey Usd = new("1002", "USD");
    private const string Actor = "synthetic-operator";
    private static readonly DateOnly Day = new(2026, 1, 10);

    public CashierWorkflowTests()
    {
        Directory.CreateDirectory(directory);
        store = SqliteCashierStore.CreateSynthetic(Path.Combine(directory, "book.cashier-synthetic.db"), Book());
        service = new CashierService(store);
    }

    internal static BookDefinition Book() => new("synthetic-book", new(2026, 1, 1), new(2026, 1, 1),
        new(2026, 12, 31), "CNY",
        [new("1001", "合成现金", true, true, ["CNY"]), new("1002", "合成银行", true, true, ["CNY", "USD"]),
         new("6001", "合成收入", true, false, ["CNY"]), new("6601", "合成费用", true, false, ["CNY"]),
         new("600", "合成非明细", false, false, ["CNY"])]);

    private DocumentInput Input(decimal amount = 100, DocumentDirection direction = DocumentDirection.Receipt,
        AccountKey? account = null, DateOnly? date = null, string? counter = "6001") =>
        new(account ?? Cash, date ?? Day, "合成收支摘要", direction, amount, counter, Actor,
            "合成说明", "合成户名", "合成开户机构", "synthetic-bank-account");
    private CashierDocument Add(DocumentInput? input = null) => service.AddDocument(service.Read().Revision, input ?? Input());
    private LedgerEntry Entry(string id, decimal debit, decimal credit = 0, DateOnly? date = null,
        bool posted = true, AccountKey? account = null) => new(id, "v1", account ?? Cash, date ?? Day,
            "synthetic-voucher-" + id, "合成账务分录", debit, credit, posted);
    private void Stage(params LedgerEntry[] entries) => service.StageLedgerSnapshot(service.Read().Revision, entries, Actor);
    private CashierSnapshot Snapshot() => service.Read();
    private void SeedDocument(CashierDocument document) => store.Transact(Snapshot().Revision,
        s => s with { Documents = [document], NextDocumentNumber = document.Number + 1 });

    [Fact]
    public void Reusable_synthetic_fixture_runs_through_opening_documents_journal_match_and_cancel()
    {
        using var fixture = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "fixtures", "cashier-cycle.synthetic.json")));
        var root = fixture.RootElement;
        Assert.StartsWith("synthetic", root.GetProperty("provenance").GetString());
        service.SaveOpening(0, Cash, 2026, root.GetProperty("opening").GetDecimal(), Actor);
        foreach (var d in root.GetProperty("documents").EnumerateArray())
            Add(Input(d.GetProperty("amount").GetDecimal(), Enum.Parse<DocumentDirection>(d.GetProperty("direction").GetString()!),
                date: DateOnly.ParseExact(d.GetProperty("date").GetString()!, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
                counter: d.GetProperty("counterAccount").GetString()));
        Stage(root.GetProperty("postedLedger").EnumerateArray().Select(e => Entry(e.GetProperty("id").GetString()!,
            e.GetProperty("debit").GetDecimal(), e.GetProperty("credit").GetDecimal())).ToArray());
        Assert.Equal(root.GetProperty("expectedClosing").GetDecimal(), service.GetJournal(Cash, Day, Day).Closing);
        service.AutoReconcile(Snapshot().Revision, new(Cash, 2026, 1), Actor);
        Assert.Equal(2, Snapshot().Reconciliations.Length);
        foreach (var g in Snapshot().Reconciliations) service.CancelReconciliation(Snapshot().Revision, g.Code, Actor);
        Assert.Empty(Snapshot().Reconciliations);
    }

    [Fact]
    public void Opening_receipt_payment_update_delete_and_reopen_form_a_balanced_journal()
    {
        service.SaveOpening(0, Cash, 2026, 1000.123456m, Actor);
        var receipt = Add(Input(200.100001m));
        var payment = Add(Input(50.000001m, DocumentDirection.Payment));
        Assert.Equal(1, receipt.Number); Assert.Equal(2, payment.Number);
        var journal = service.GetJournal(Cash, new(2026, 1, 1), new(2026, 1, 31));
        Assert.Equal(1150.223456m, journal.Closing);
        Assert.Equal(200.100001m, journal.TotalDebit); Assert.Equal(50.000001m, journal.TotalCredit);
        Assert.Single(journal.Rows, x => x.Kind == JournalRowKind.DailySubtotal);
        service.UpdateDocument(Snapshot().Revision, payment.Id, Input(25, DocumentDirection.Payment), Actor);
        service.DeleteDocument(Snapshot().Revision, receipt.Id, Actor);
        var next = Add(Input(1)); Assert.Equal(3, next.Number); // deleted IDs never get reused
        var reopened = new CashierService(SqliteCashierStore.OpenSynthetic(Path.Combine(directory, "book.cashier-synthetic.db")));
        Assert.Equal(976.123456m, reopened.GetJournal(Cash, new(2026, 1, 1), new(2026, 1, 31)).Closing);
        Assert.Equal("合成开户机构", reopened.Read().Documents[0].CounterpartyBank);
        Assert.Equal(6, reopened.Read().Audit.Length);
    }

    [Fact]
    public void Subrange_carries_previous_activity_and_never_double_counts_subtotals()
    {
        service.SaveOpening(0, Cash, 2026, 100, Actor);
        Add(Input(10, date: new(2026, 1, 1)));
        Add(Input(5, date: new(2026, 1, 2)));
        var j = service.GetJournal(Cash, new(2026, 1, 2), new(2026, 1, 2));
        Assert.Equal(110, j.Opening); Assert.Equal(115, j.Closing); Assert.Equal(5, j.TotalDebit);
        Assert.Equal(j.Closing, service.GetJournal(Cash, j.From, j.Through, false).Closing);
    }

    [Fact]
    public void Screen_of_openings_saves_atomically_and_rejects_an_invalid_second_row()
    {
        Assert.Throws<CashierRuleException>(() => service.SaveOpenings(0,
            [new(Cash, 2026, 100), new(new("missing", "CNY"), 2026, 200)], Actor));
        Assert.Empty(Snapshot().Openings); Assert.Equal(0, Snapshot().Revision);
        service.SaveOpenings(0, [new(Cash, 2026, 100.000001m), new(Usd, 2026, 200.000002m)], Actor);
        Assert.Equal(2, Snapshot().Openings.Length); Assert.Single(Snapshot().Audit);
        Assert.Equal(100.000001m, service.GetJournal(Cash, Day, Day).Closing);
        Assert.Equal(200.000002m, service.GetJournal(Usd, Day, Day).Closing);
    }

    [Theory]
    [InlineData(false)] [InlineData(true)]
    public void Closed_history_cannot_be_rewritten_by_single_or_screen_opening_save(bool screen)
    {
        service.SaveOpening(0, Cash, 2026, 123.123456m, Actor);
        store.Transact(Snapshot().Revision, s => s with { Book = s.Book with { ActiveMonth = new(2026, 2, 1) } });
        var before = Snapshot();
        var failure = Assert.Throws<CashierRuleException>(() =>
        {
            if (screen) service.SaveOpenings(before.Revision, [new(Cash, 2026, 999), new(Usd, 2026, 1)], Actor);
            else service.SaveOpening(before.Revision, Cash, 2026, 999, Actor);
        });
        Assert.Equal("opening.history.protected", failure.Code);
        var after = Snapshot();
        Assert.Equal(before.Revision, after.Revision); Assert.Equal(before.Openings, after.Openings); Assert.Equal(before.Audit, after.Audit);
        Assert.Equal(123.123456m, service.GetJournal(Cash, Day, Day).Opening);
    }

    [Fact]
    public void Views_carry_the_revision_they_actually_read_for_stale_selection_protection()
    {
        var d = Add();
        var journal = service.GetJournal(Cash, Day, Day);
        var reconciliation = service.ReadReconciliation(new(Cash, 2026, 1));
        Add(Input(1));
        Assert.Throws<CashierConcurrencyException>(() => service.DeleteDocument(journal.SourceRevision, d.Id, Actor));
        Assert.True(reconciliation.SourceRevision < Snapshot().Revision);
    }

    [Theory]
    [InlineData(0)] [InlineData(0.0049)] [InlineData(-0.0049)]
    public void Below_original_minimum_amount_is_rejected_without_commit(decimal amount)
    {
        var e = Assert.Throws<CashierRuleException>(() => Add(Input(amount)));
        Assert.Equal("document.amount", e.Code); Assert.Equal(0, Snapshot().Revision);
        Assert.Empty(Snapshot().Audit); Assert.Empty(Snapshot().Documents);
    }

    [Fact]
    public void Exact_minimum_and_signed_reversal_are_preserved_without_cent_rounding()
    {
        Add(Input(0.005m)); Add(Input(-1.123456789m));
        Assert.Equal(-1.118456789m, service.GetJournal(Cash, Day, Day).Closing);
    }

    [Fact]
    public void Account_catalog_uses_cashflow_and_currency_flags_and_validates_detail_counteraccount()
    {
        Assert.Equal(new[] { Cash, Bank, Usd }, service.GetAccounts());
        Assert.Equal("account.invalid", Assert.Throws<CashierRuleException>(() => Add(Input(account: new("6001", "CNY")))).Code);
        Assert.Equal("account.invalid", Assert.Throws<CashierRuleException>(() => Add(Input(account: new("1001", "USD")))).Code);
        Assert.Equal("counteraccount.invalid", Assert.Throws<CashierRuleException>(() => Add(Input(counter: "600"))).Code);
    }

    [Fact]
    public void Dates_operator_and_cross_year_limits_are_enforced()
    {
        Assert.Equal("period.closed", Assert.Throws<CashierRuleException>(() => Add(Input(date: new(2025, 12, 31)))).Code);
        Assert.Equal("date.future", Assert.Throws<CashierRuleException>(() => Add(Input(date: new(2027, 1, 1)))).Code);
        Assert.Throws<CashierRuleException>(() => Add(Input() with { EnteredBy = " " }));
        Assert.Throws<CashierRuleException>(() => service.SaveOpening(0, Cash, 2027, 0, Actor));
    }

    [Theory]
    [InlineData(DocumentOrigin.GeneralLedger)] [InlineData(DocumentOrigin.External)]
    public void Transferred_documents_cannot_be_directly_edited_or_deleted(DocumentOrigin origin)
    {
        var d = Add(); SeedDocument(d with { Origin = origin });
        Assert.Equal("document.origin", Assert.Throws<CashierRuleException>(() => service.DeleteDocument(Snapshot().Revision, d.Id, Actor)).Code);
        Assert.Equal("document.origin", Assert.Throws<CashierRuleException>(() => service.UpdateDocument(Snapshot().Revision, d.Id, Input(), Actor)).Code);
    }

    [Fact]
    public void Generated_voucher_blocks_direct_edit_and_delete()
    {
        var d = Add(); SeedDocument(d with { GeneratedVoucherId = "synthetic-generated" });
        Assert.Equal("document.voucher", Assert.Throws<CashierRuleException>(() => service.GetEditableDocument(Snapshot().Revision, d.Id)).Code);
        Assert.Equal("document.voucher", Assert.Throws<CashierRuleException>(() => service.DeleteDocument(Snapshot().Revision, d.Id, Actor)).Code);
        Assert.Equal("document.voucher", Assert.Throws<CashierRuleException>(() => service.UpdateDocument(Snapshot().Revision, d.Id, Input(), Actor)).Code);
    }

    [Fact]
    public void Closed_period_blocks_monetary_edits_but_prior_unmatched_data_can_be_reconciled()
    {
        var d = Add(); Stage(Entry("l", 100));
        store.Transact(Snapshot().Revision, s => s with { Book = s.Book with { ActiveMonth = new(2026, 2, 1) } });
        Assert.Throws<CashierRuleException>(() => Add());
        Assert.Equal("period.closed", Assert.Throws<CashierRuleException>(() => service.DeleteDocument(Snapshot().Revision, d.Id, Actor)).Code);
        Assert.Equal("period.closed", Assert.Throws<CashierRuleException>(() => service.UpdateDocument(Snapshot().Revision, d.Id, Input(), Actor)).Code);
        service.AutoReconcile(Snapshot().Revision, new(Cash, 2026, 2, IncludeEarlierUnmatched: true), Actor);
        var group = Assert.Single(Snapshot().Reconciliations);
        service.CancelReconciliation(Snapshot().Revision, group.Code, Actor);
        Assert.Null(Snapshot().Documents[0].ReconciliationCode);
    }

    [Fact]
    public void Manual_many_to_one_match_is_persisted_and_cancelled_as_a_whole_group()
    {
        var a = Add(Input(60)); var b = Add(Input(40)); Stage(Entry("ledger", 100));
        var group = service.Reconcile(Snapshot().Revision, Cash, [a.Id, b.Id], ["ledger"], Actor);
        Assert.All(Snapshot().Documents, x => Assert.Equal(group.Code, x.ReconciliationCode));
        Assert.Equal("document.matched", Assert.Throws<CashierRuleException>(() => service.GetEditableDocument(Snapshot().Revision, a.Id, deleting: true)).Code);
        Assert.Equal(group.Code, Snapshot().LedgerEntries[0].ReconciliationCode);
        Assert.Equal("document.matched", Assert.Throws<CashierRuleException>(() => service.DeleteDocument(Snapshot().Revision, a.Id, Actor)).Code);
        Assert.Empty(service.ReadReconciliation(new(Cash, 2026, 1)).Documents);
        Assert.Equal(2, service.ReadReconciliation(new(Cash, 2026, 1, true)).Documents.Length);
        service.CancelReconciliation(Snapshot().Revision, group.Code, Actor);
        Assert.All(Snapshot().Documents, x => Assert.Null(x.ReconciliationCode));
        Assert.Null(Snapshot().LedgerEntries[0].ReconciliationCode); Assert.Empty(Snapshot().Reconciliations);
    }

    [Fact]
    public void Mismatch_duplicate_selection_unposted_and_cross_currency_are_atomic_failures()
    {
        var d = Add(); Stage(Entry("wrong", 99), Entry("unposted", 100, posted: false), Entry("usd", 100, account: Usd));
        long revision = Snapshot().Revision;
        Assert.Equal("reconcile.amount", Assert.Throws<CashierRuleException>(() => service.Reconcile(revision, Cash, [d.Id], ["wrong"], Actor)).Code);
        Assert.Equal("reconcile.selection", Assert.Throws<CashierRuleException>(() => service.Reconcile(revision, Cash, [d.Id, d.Id], ["wrong"], Actor)).Code);
        Assert.Equal("reconcile.unposted", Assert.Throws<CashierRuleException>(() => service.Reconcile(revision, Cash, [d.Id], ["unposted"], Actor)).Code);
        Assert.Equal("reconcile.account", Assert.Throws<CashierRuleException>(() => service.Reconcile(revision, Cash, [d.Id], ["usd"], Actor)).Code);
        Assert.Equal(revision, Snapshot().Revision); Assert.Empty(Snapshot().Reconciliations);
    }

    [Fact]
    public void Equal_net_does_not_match_different_gross_cash_flows()
    {
        var a = Add(Input(100)); var b = Add(Input(50, DocumentDirection.Payment)); Stage(Entry("net", 50));
        Assert.Equal("reconcile.amount", Assert.Throws<CashierRuleException>(() =>
            service.Reconcile(Snapshot().Revision, Cash, [a.Id, b.Id], ["net"], Actor)).Code);
    }

    [Theory]
    [InlineData("100.005", true)] [InlineData("100.005001", false)] [InlineData("99.995", true)]
    public void Original_reconciliation_tolerance_is_respected_without_rounding(string ledgerAmount, bool permitted)
    {
        var d = Add(); Stage(Entry("ledger", decimal.Parse(ledgerAmount, System.Globalization.CultureInfo.InvariantCulture)));
        if (permitted)
        {
            service.Reconcile(Snapshot().Revision, Cash, [d.Id], ["ledger"], Actor);
            Assert.Equal(ledgerAmount, Snapshot().LedgerEntries[0].Debit.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }
        else Assert.Equal("reconcile.amount", Assert.Throws<CashierRuleException>(() =>
            service.Reconcile(Snapshot().Revision, Cash, [d.Id], ["ledger"], Actor)).Code);
    }

    [Fact]
    public void Read_filters_month_earlier_unmatched_matched_and_only_posted_ledger()
    {
        Add(Input(date: new(2026, 1, 1))); Add(Input(date: new(2026, 2, 1)));
        Stage(Entry("old", 100, date: new(2026, 1, 1)), Entry("new", 100, date: new(2026, 2, 1)),
            Entry("draft", 100, date: new(2026, 2, 1), posted: false));
        var current = service.ReadReconciliation(new(Cash, 2026, 2));
        Assert.Single(current.Documents); Assert.Equal("new", Assert.Single(current.LedgerEntries).Id);
        Assert.Equal(2, service.ReadReconciliation(new(Cash, 2026, 2, IncludeEarlierUnmatched: true)).Documents.Length);
    }

    [Fact]
    public void Auto_match_uses_date_then_number_and_does_not_consume_a_ledger_row_twice()
    {
        var later = Add(Input(date: new(2026, 1, 12))); var earlier = Add(Input(date: new(2026, 1, 2)));
        Stage(Entry("later", 100, date: new(2026, 1, 12)), Entry("earlier", 100, date: new(2026, 1, 2)),
            Entry("unposted", 100, posted: false));
        service.AutoReconcile(Snapshot().Revision, new(Cash, 2026, 1), Actor);
        var groups = Snapshot().Reconciliations;
        Assert.Equal(2, groups.Length); Assert.Equal(earlier.Id, groups[0].DocumentIds[0]);
        Assert.Equal("earlier", groups[0].LedgerEntryIds[0]); Assert.Equal(later.Id, groups[1].DocumentIds[0]);
        Assert.Null(Snapshot().LedgerEntries.Single(x => x.Id == "unposted").ReconciliationCode);
    }

    [Fact]
    public void Matched_ledger_snapshot_cannot_disappear_or_change_until_group_cancelled()
    {
        var d = Add(); var e = Entry("ledger", 100); Stage(e);
        var g = service.Reconcile(Snapshot().Revision, Cash, [d.Id], [e.Id], Actor);
        var rev = Snapshot().Revision;
        Assert.Equal("ledger.matched.changed", Assert.Throws<CashierRuleException>(() => service.StageLedgerSnapshot(rev, [], Actor)).Code);
        Assert.Throws<CashierRuleException>(() => service.StageLedgerSnapshot(rev, [e with { Revision = "v2" }], Actor));
        service.StageLedgerSnapshot(rev, [e], Actor);
        Assert.Equal(g.Code, Snapshot().LedgerEntries[0].ReconciliationCode);
        service.CancelReconciliation(Snapshot().Revision, g.Code, Actor); Stage(e with { Revision = "v2" });
        Assert.Equal("v2", Snapshot().LedgerEntries[0].Revision);
    }

    [Fact]
    public void Revision_conflicts_and_throwing_transform_leave_numbers_and_audit_unchanged()
    {
        Add(); long revision = Snapshot().Revision;
        Assert.Throws<CashierConcurrencyException>(() => service.AddDocument(0, Input()));
        Assert.Throws<IOException>(() => store.Transact(revision, s => throw new IOException("synthetic failure")));
        Assert.Equal(revision, Snapshot().Revision); Assert.Equal(2, Snapshot().NextDocumentNumber); Assert.Single(Snapshot().Audit);
    }

    [Fact]
    public void Sqlite_write_failure_rolls_back_payload_revision_number_and_audit()
    {
        Add(); var before = Snapshot();
        using (var c = new SqliteConnection(new SqliteConnectionStringBuilder
            { DataSource = Path.Combine(directory, "book.cashier-synthetic.db"), Pooling = false }.ToString()))
        {
            c.Open(); using var cmd = c.CreateCommand();
            cmd.CommandText = "CREATE TRIGGER synthetic_write_failure BEFORE UPDATE ON cashier_state BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END";
            cmd.ExecuteNonQuery();
        }
        Assert.Throws<SqliteException>(() => Add());
        var after = Snapshot();
        Assert.Equal(before.Revision, after.Revision); Assert.Equal(before.NextDocumentNumber, after.NextDocumentNumber);
        Assert.Equal(before.Documents, after.Documents); Assert.Equal(before.Audit, after.Audit);
    }

    [Fact]
    public async Task Two_connections_with_same_revision_only_one_writer_can_commit()
    {
        var second = new CashierService(SqliteCashierStore.OpenSynthetic(Path.Combine(directory, "book.cashier-synthetic.db")));
        using var barrier = new Barrier(2);
        async Task<bool> Write(CashierService s) => await Task.Run(() =>
        {
            barrier.SignalAndWait();
            try { s.AddDocument(0, Input()); return true; }
            catch (CashierConcurrencyException) { return false; }
        });
        var results = await Task.WhenAll(Write(service), Write(second));
        Assert.Single(results, x => x); Assert.Single(Snapshot().Documents); Assert.Single(Snapshot().Audit);
    }

    [Fact]
    public void Original_extra_fields_NULL_and_precision_survive_unrelated_updates_and_reopen()
    {
        var d = Add(Input(1.1234567890123456789m));
        SeedDocument(d with { OriginalFields = new() { ["future-column"] = new("numeric(28,18)", "123.123456789012345678"),
            ["nullable-column"] = new("char(12)", null), ["trailing-space"] = new("char(5)", "x    ") } });
        service.UpdateDocument(Snapshot().Revision, d.Id, Input(2.1234567890123456789m), Actor);
        var reopened = SqliteCashierStore.OpenSynthetic(Path.Combine(directory, "book.cashier-synthetic.db")).Read();
        Assert.Equal(2.1234567890123456789m, reopened.Documents[0].Debit);
        Assert.Null(reopened.Documents[0].OriginalFields!["nullable-column"].RawValue);
        Assert.Equal("x    ", reopened.Documents[0].OriginalFields!["trailing-space"].RawValue);
    }

    [Fact]
    public void Voucher_plans_balance_per_document_and_month_and_do_not_mark_documents_transferred()
    {
        Add(Input(100)); Add(Input(30, DocumentDirection.Payment, counter: "6601"));
        long revision = Snapshot().Revision;
        var each = service.CreateVoucherPlan(2026, 1, VoucherGrouping.PerDocument);
        Assert.Equal(2, each.Vouchers.Length);
        var month = service.CreateVoucherPlan(2026, 1, VoucherGrouping.Monthly);
        Assert.Single(month.Vouchers);
        Assert.All(each.Vouchers.Concat(month.Vouchers), v => Assert.Equal(v.Lines.Sum(x => x.Debit), v.Lines.Sum(x => x.Credit)));
        Assert.All(Snapshot().Documents, d => Assert.Null(d.GeneratedVoucherId)); Assert.Equal(revision, Snapshot().Revision);
        Assert.Equal(revision, month.SourceRevision); Assert.Equal("synthetic-book", month.BookId);
    }

    [Fact]
    public void Foreign_plan_requires_explicit_rate_and_retains_foreign_amount_and_currency()
    {
        var d = Add(Input(10.12345m, account: Usd));
        Assert.Equal("voucher.exchange", Assert.Throws<CashierRuleException>(() => service.CreateVoucherPlan(2026, 1, VoucherGrouping.PerDocument)).Code);
        var plan = service.CreateVoucherPlan(2026, 1, VoucherGrouping.PerDocument, new Dictionary<string, decimal> { ["USD"] = 7.12345m });
        var line = plan.Vouchers[0].Lines[0]; Assert.Equal(72.1138899025m, line.Debit);
        Assert.Equal(10.12345m, line.ForeignDebit); Assert.Equal("USD", line.Currency); Assert.Equal(d.Id, line.SourceDocumentId);
    }

    [Fact]
    public void Missing_counteraccount_blocks_plan_until_document_is_corrected()
    {
        Add(Input(counter: null));
        Assert.Equal("counteraccount.invalid", Assert.Throws<CashierRuleException>(() => service.CreateVoucherPlan(2026, 1, VoucherGrouping.Monthly)).Code);
    }

    [Fact]
    public void Create_never_overwrites_and_open_unknown_format_never_changes_input()
    {
        var p = Path.Combine(directory, "unknown.cashier-synthetic.db");
        using (var c = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = p }.ToString()))
        { c.Open(); using var cmd = c.CreateCommand(); cmd.CommandText = "CREATE TABLE original_like_data(value TEXT)"; cmd.ExecuteNonQuery(); }
        var hash = SHA256.HashData(File.ReadAllBytes(p));
        Assert.Throws<IOException>(() => SqliteCashierStore.CreateSynthetic(p, Book()));
        Assert.Throws<InvalidDataException>(() => SqliteCashierStore.OpenSynthetic(p));
        Assert.Equal(hash, SHA256.HashData(File.ReadAllBytes(p)));
        Assert.Throws<ArgumentException>(() => SqliteCashierStore.OpenSynthetic(Path.Combine(directory, "original.db")));
    }

    public void Dispose() => Directory.Delete(directory, recursive: true);
}
