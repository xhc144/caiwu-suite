using System.Globalization;
using System.Text.Json;
using Caiwu.Contracts;

namespace Caiwu.Core.Tests;

public sealed class LedgerServiceTests
{
    private static readonly DateOnly Jan1 = new(2026, 1, 1);
    private static readonly DateOnly Jan31 = new(2026, 1, 31);
    private static readonly DateOnly Feb1 = new(2026, 2, 1);
    private static readonly DateOnly Dec31 = new(2026, 12, 31);

    private static MemoryLedgerStore Store(int startMonth = 1, AccountingRegime regime = AccountingRegime.Enterprise) => new(
        new(0, new(Guid.NewGuid(), "独立算例", regime, TemplateCatalog.Get(regime).Version, 2026, startMonth, startMonth - 1,
            new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero)),
            TemplateCatalog.Get(regime).Accounts.ToArray(), [], []));

    private static VoucherDraft Draft(decimal amount = 10m, DateOnly? date = null, string debit = "1403", string credit = "1002",
        int? number = null, string kind = "记") => new(null, date ?? Jan1, kind, number, 0,
        [new(debit, "业务借方", amount, 0), new(credit, "业务贷方", 0, amount)]);

    // Loading is explicit: this helper cannot read a newer revision from a service at save time.
    private static VoucherDraft EditFrom(LedgerSnapshot opened, Guid id, VoucherDraft changes) => changes with
    { Id = id, ExpectedRevision = opened.Revision, ExpectedBookId = opened.Book.Id };

    private static Voucher Posted(LedgerService service, VoucherDraft? draft = null)
    {
        var voucher = service.SaveDraft(At(service.GetSnapshot(), draft ?? Draft()), "制单员");
        service.Review(voucher.Id, "审核员", Context(service.GetSnapshot()));
        service.Post(voucher.Id, "记账员", Context(service.GetSnapshot()));
        return service.GetSnapshot().Vouchers.Single(v => v.Id == voucher.Id);
    }

    // Ordinary rule fixtures load inputs explicitly; stale/concurrent tests retain their own earlier snapshots.
    private static LedgerMutationContext Context(LedgerSnapshot shown) => new(shown.Book.Id, shown.Revision);
    private static VoucherDraft At(LedgerSnapshot shown, VoucherDraft input) => input with
    { ExpectedBookId = shown.Book.Id, ExpectedRevision = shown.Revision };

    private static string Data(MemoryLedgerStore store) => JsonSerializer.Serialize(store.Read());

    private static void Rejected(MemoryLedgerStore store, Action command)
    {
        var before = Data(store);
        var writes = store.WriteAttempts;
        Assert.Throws<LedgerValidationException>(command);
        Assert.Equal(before, Data(store));
        Assert.Equal(writes, store.WriteAttempts);
    }

    [Theory]
    [InlineData(AccountingRegime.Enterprise, "4001", "6001", "6602")]
    [InlineData(AccountingRegime.SmallBusiness, "3001", "5001", "5602")]
    public void Contract_hand_calculated_sample_balances_and_drills_through(AccountingRegime regime, string capital, string income, string expense)
    {
        using var store = Store(regime: regime);
        var s = new LedgerService(store);
        s.SetOpeningBalances([new("1002", 100000m, 0), new(capital, 0, 100000m)], "期初员", Context(s.GetSnapshot()));
        var material = Posted(s, Draft(10000m));
        Posted(s, Draft(1200m, debit: expense));
        Posted(s, Draft(20000m, debit: "1002", credit: income));

        var rows = s.GetTrialBalance(Jan1, Jan31);
        Assert.Equal(108800m, rows.Single(r => r.AccountCode == "1002").ClosingDebit);
        Assert.Equal(10000m, rows.Single(r => r.AccountCode == "1403").ClosingDebit);
        Assert.Equal(1200m, rows.Single(r => r.AccountCode == expense).ClosingDebit);
        Assert.Equal(20000m, rows.Single(r => r.AccountCode == income).ClosingCredit);
        Assert.Equal(100000m, rows.Sum(r => r.OpeningDebit));
        Assert.Equal(100000m, rows.Sum(r => r.OpeningCredit));
        Assert.Equal(31200m, rows.Where(r => r.IsLeaf).Sum(r => r.PeriodDebit));
        Assert.Equal(31200m, rows.Where(r => r.IsLeaf).Sum(r => r.PeriodCredit));
        Assert.Equal(120000m, rows.Where(r => r.IsLeaf).Sum(r => r.ClosingDebit));
        Assert.Equal(120000m, rows.Where(r => r.IsLeaf).Sum(r => r.ClosingCredit));

        var ledger = s.GetLedger("1002", Jan1, Jan31);
        Assert.Equal(4, ledger.Count);
        Assert.Null(ledger[0].Date);
        Assert.Null(ledger[0].VoucherId);
        Assert.Equal("期初余额", ledger[0].Summary);
        Assert.Equal(100000m, ledger[0].RunningBalance);
        Assert.Equal(90000m, ledger[1].RunningBalance);
        Assert.Equal(88800m, ledger[2].RunningBalance);
        Assert.Equal(108800m, ledger[3].RunningBalance);
        var target = s.GetSnapshot().Vouchers.Single(v => v.Id == ledger[1].VoucherId);
        Assert.Equal(material.Id, target.Id);
        Assert.Equal(target.Number, ledger[1].VoucherNumber);
        Assert.Equal(target.Kind, ledger[1].VoucherKind);
        Assert.Equal(target.Date, ledger[1].Date);
        Assert.Contains(target.Lines, l => l.Credit == ledger[1].Credit && l.Summary == ledger[1].Summary);
        Assert.Equal(-20000m, s.GetLedger(income, Jan1, Jan31)[1].RunningBalance);
    }

    [Fact]
    public void Decimal_tenths_and_cents_remain_exact()
    {
        using var store = Store();
        var s = new LedgerService(store);
        Posted(s, Draft() with { Lines = [new("1403", "一角", 0.1m, 0), new("1403", "两角", 0.2m, 0), new("1002", "三角", 0, 0.3m)] });
        var rows = s.GetTrialBalance(Jan1, Jan31);
        Assert.Equal(0.3m, rows.Single(r => r.AccountCode == "1403").ClosingDebit);
        Assert.Equal(0.3m, rows.Single(r => r.AccountCode == "1002").ClosingCredit);
        Assert.Equal(0.3m, rows.Sum(r => r.PeriodDebit));
        Assert.Equal(0.3m, rows.Sum(r => r.PeriodCredit));
    }

    [Theory]
    [InlineData("-0.01")]
    [InlineData("0")]
    [InlineData("0.001")]
    [InlineData("92233720368547758.08")]
    [InlineData("79228162514264337593543950335")]
    public void Invalid_amounts_are_rejected_without_rounding(string input)
    {
        using var store = Store();
        var s = new LedgerService(store);
        var value = decimal.Parse(input, CultureInfo.InvariantCulture);
        Rejected(store, () => s.SaveDraft(At(s.GetSnapshot(), Draft(value)), "制单员"));
    }

    [Fact]
    public void Maximum_storage_amount_and_trailing_decimal_zeroes_are_exact()
    {
        using var store = Store();
        var s = new LedgerService(store);
        Posted(s, Draft(92233720368547758.07m));
        Assert.Equal(92233720368547758.07m, s.GetTrialBalance(Jan1, Jan31).Single(r => r.AccountCode == "1403").ClosingDebit);
        s.SaveDraft(At(s.GetSnapshot(), Draft(0.1000m)), "制单员");
    }

    [Fact]
    public void Invalid_lines_accounts_and_unbalanced_drafts_are_atomic()
    {
        using var store = Store();
        var s = new LedgerService(store);
        Rejected(store, () => s.SaveDraft(At(s.GetSnapshot(), Draft(debit: "9999")), "制单员"));
        Rejected(store, () => s.SaveDraft(At(s.GetSnapshot(), Draft() with { Lines = [] }), "制单员"));
        Rejected(store, () => s.SaveDraft(At(s.GetSnapshot(), Draft() with { Lines = [new("1002", "单行", 1, 0)] }), "制单员"));
        Rejected(store, () => s.SaveDraft(At(s.GetSnapshot(), Draft() with { Lines = [new("1403", "借贷同填", 10, 10), new("1002", "贷方", 0, 10)] }), "制单员"));
        Rejected(store, () => s.SaveDraft(At(s.GetSnapshot(), Draft() with { Lines = [new("1403", "借方", 9.99m, 0), new("1002", "贷方", 0, 10)] }), "制单员"));
        Rejected(store, () => s.SaveDraft(At(s.GetSnapshot(), Draft() with { Lines = null! }), "制单员"));
        Rejected(store, () => s.SaveDraft(At(s.GetSnapshot(), Draft() with { Lines = [null!, new("1002", "贷方", 0, 10)] }), "制单员"));
        Rejected(store, () => s.SaveDraft(At(s.GetSnapshot(), Draft() with { Kind = " " }), "制单员"));
        Rejected(store, () => s.SaveDraft(At(s.GetSnapshot(), Draft() with { AttachmentCount = -1 }), "制单员"));
        Rejected(store, () => s.SaveDraft(At(s.GetSnapshot(), Draft()), " "));
    }

    [Fact]
    public void Inactive_and_parent_accounts_are_not_usable()
    {
        using var store = Store();
        var s = new LedgerService(store);
        var bank = s.GetSnapshot().Accounts.Single(a => a.Code == "1002");
        s.SaveAccount(bank with { IsActive = false }, "科目员", Context(s.GetSnapshot()));
        Rejected(store, () => s.SaveDraft(At(s.GetSnapshot(), Draft()), "制单员"));
        s.SaveAccount(bank, "科目员", Context(s.GetSnapshot()));
        s.SaveAccount(new("100201", "银行明细", "1002", BalanceDirection.Debit, true, 0, 0), "科目员", Context(s.GetSnapshot()));
        Rejected(store, () => s.SaveDraft(At(s.GetSnapshot(), Draft()), "制单员"));
        s.SaveDraft(At(s.GetSnapshot(), Draft(credit: "100201")), "制单员");
    }

    [Theory]
    [InlineData(2025, 12, 31)]
    [InlineData(2027, 1, 1)]
    [InlineData(2026, 2, 28)]
    public void Dates_must_be_in_the_book_year_and_on_or_after_start(int year, int month, int day)
    {
        using var store = Store(3);
        var s = new LedgerService(store);
        Rejected(store, () => s.SaveDraft(At(s.GetSnapshot(), Draft(date: new(year, month, day))), "制单员"));
        Rejected(store, () => s.GetTrialBalance(new(year, month, day), Dec31));
        Rejected(store, () => s.GetLedger("1002", new(year, month, day), Dec31));
    }

    [Fact]
    public void Query_ranges_are_inclusive_and_validate_both_ends_and_order()
    {
        using var store = Store();
        var s = new LedgerService(store);
        Posted(s, Draft(1m, Jan1));
        Posted(s, Draft(2m, Jan31));
        Posted(s, Draft(4m, Feb1));
        Assert.Equal(3m, s.GetTrialBalance(Jan1, Jan31).Single(r => r.AccountCode == "1403").PeriodDebit);
        Assert.Equal(2m, s.GetTrialBalance(Jan31, Jan31).Single(r => r.AccountCode == "1403").PeriodDebit);
        Assert.Equal(3, s.GetLedger("1002", Jan1, Jan31).Count);
        Rejected(store, () => s.GetTrialBalance(Feb1, Jan1));
        Rejected(store, () => s.GetTrialBalance(Jan1, new(2027, 1, 1)));
        Rejected(store, () => s.GetLedger("1002", Feb1, Jan1));
        Rejected(store, () => s.GetLedger("9999", Jan1, Jan31));
    }

    [Fact]
    public void Numbers_are_unique_per_month_and_kind_and_edits_keep_their_number()
    {
        using var store = Store();
        var s = new LedgerService(store);
        var first = s.SaveDraft(At(s.GetSnapshot(), Draft()), "A");
        Assert.Equal(1, first.Number);
        var second = s.SaveDraft(At(s.GetSnapshot(), Draft(number: 5)), "A");
        Assert.Equal(6, s.SaveDraft(At(s.GetSnapshot(), Draft()), "A").Number);
        Assert.Equal(1, s.SaveDraft(At(s.GetSnapshot(), Draft(date: Feb1)), "A").Number);
        Assert.Equal(1, s.SaveDraft(At(s.GetSnapshot(), Draft(kind: "收")), "A").Number);
        var opened = s.GetSnapshot();
        var updated = s.SaveDraft(EditFrom(opened, second.Id, Draft(20) with { AttachmentCount = 3 }), "B");
        Assert.Equal(5, updated.Number);
        Assert.Equal("B", updated.PreparedBy);
        Assert.Equal(3, updated.AttachmentCount);
        Rejected(store, () => s.SaveDraft(At(s.GetSnapshot(), Draft(number: 5)), "A"));
        Rejected(store, () => s.SaveDraft(At(s.GetSnapshot(), Draft(number: 0)), "A"));
        Rejected(store, () => s.SaveDraft(At(s.GetSnapshot(), Draft(number: -1)), "A"));
        var reopened = s.GetSnapshot();
        var duplicateEdit = EditFrom(reopened, first.Id, Draft(number: 5));
        Rejected(store, () => s.SaveDraft(duplicateEdit, "A"));
        var moved = s.SaveDraft(EditFrom(reopened, second.Id, Draft(date: Feb1)), "A");
        Assert.Equal(2, moved.Number);
    }

    [Fact]
    public void Number_exhaustion_is_a_validation_error_and_does_not_overflow()
    {
        using var store = Store();
        var s = new LedgerService(store);
        s.SaveDraft(At(s.GetSnapshot(), Draft(number: int.MaxValue)), "A");
        Rejected(store, () => s.SaveDraft(At(s.GetSnapshot(), Draft()), "A"));
    }

    [Fact]
    public void Draft_delete_and_missing_identifiers_have_no_hidden_side_effects()
    {
        using var store = Store();
        var s = new LedgerService(store);
        var v = s.SaveDraft(At(s.GetSnapshot(), Draft()), "制单员");
        s.DeleteDraft(v.Id, "制单员", Context(s.GetSnapshot()));
        Assert.Empty(s.GetSnapshot().Vouchers);
        Assert.Equal("DeleteDraft", s.GetSnapshot().AuditEvents[^1].Action);
        Rejected(store, () => s.DeleteDraft(v.Id, "A", Context(s.GetSnapshot())));
        var missingEdit = EditFrom(s.GetSnapshot(), Guid.NewGuid(), Draft());
        Rejected(store, () => s.SaveDraft(missingEdit, "A"));
        Rejected(store, () => s.Review(Guid.NewGuid(), "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.CancelReview(Guid.NewGuid(), "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.Post(Guid.NewGuid(), "A", Context(s.GetSnapshot())));
    }

    [Theory]
    [InlineData("Alice", "alice")]
    [InlineData(" Alice ", "ALICE ")]
    [InlineData("Ａｌｉｃｅ", "Alice")]
    [InlineData("制单员", " 制单员 ")]
    public void Preparer_cannot_review_even_with_cosmetic_identity_changes(string preparer, string reviewer)
    {
        using var store = Store();
        var s = new LedgerService(store);
        var v = s.SaveDraft(At(s.GetSnapshot(), Draft()), preparer);
        Rejected(store, () => s.Review(v.Id, reviewer, Context(s.GetSnapshot())));
    }

    [Fact]
    public void Review_can_be_cancelled_before_posting_and_requires_a_new_review()
    {
        using var store = Store();
        var s = new LedgerService(store);
        var v = s.SaveDraft(At(s.GetSnapshot(), Draft()), "A");
        Rejected(store, () => s.Post(v.Id, "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.CancelReview(v.Id, "B", Context(s.GetSnapshot())));
        s.Review(v.Id, "B", Context(s.GetSnapshot()));
        Assert.Equal("B", s.GetSnapshot().Vouchers.Single().ReviewedBy);
        Rejected(store, () => s.Review(v.Id, "C", Context(s.GetSnapshot())));
        var reviewedEdit = EditFrom(s.GetSnapshot(), v.Id, Draft());
        Rejected(store, () => s.SaveDraft(reviewedEdit, "A"));
        Rejected(store, () => s.DeleteDraft(v.Id, "A", Context(s.GetSnapshot())));
        s.CancelReview(v.Id, "B", Context(s.GetSnapshot()));
        Assert.Null(s.GetSnapshot().Vouchers.Single().ReviewedBy);
        Assert.Equal(VoucherStatus.Draft, s.GetSnapshot().Vouchers.Single().Status);
        Rejected(store, () => s.Post(v.Id, "A", Context(s.GetSnapshot())));
        var reopenedDraft = s.GetSnapshot();
        s.SaveDraft(EditFrom(reopenedDraft, v.Id, Draft(20)), "C");
        Rejected(store, () => s.Review(v.Id, "C", Context(s.GetSnapshot())));
        s.Review(v.Id, "B", Context(s.GetSnapshot()));
        s.Post(v.Id, "C", Context(s.GetSnapshot()));
        Assert.Equal(20m, s.GetTrialBalance(Jan1, Jan31).Sum(r => r.PeriodDebit));
    }

    [Fact]
    public void Posted_vouchers_are_irreversible_and_repeat_post_has_no_balance_or_audit_effect()
    {
        using var store = Store();
        var s = new LedgerService(store);
        var v = Posted(s);
        var postedEdit = EditFrom(s.GetSnapshot(), v.Id, Draft(20));
        Rejected(store, () => s.Post(v.Id, "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.CancelReview(v.Id, "B", Context(s.GetSnapshot())));
        Rejected(store, () => s.DeleteDraft(v.Id, "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.Review(v.Id, "B", Context(s.GetSnapshot())));
        Rejected(store, () => s.SaveDraft(postedEdit, "A"));
        Assert.Equal(10m, s.GetTrialBalance(Jan1, Jan31).Sum(r => r.PeriodDebit));
    }

    [Fact]
    public void Review_and_post_revalidate_account_availability()
    {
        using var store = Store();
        var s = new LedgerService(store);
        var bank = s.GetSnapshot().Accounts.Single(a => a.Code == "1002");
        var v = s.SaveDraft(At(s.GetSnapshot(), Draft()), "A");
        s.SaveAccount(bank with { IsActive = false }, "科目员", Context(s.GetSnapshot()));
        Rejected(store, () => s.Review(v.Id, "B", Context(s.GetSnapshot())));
        s.SaveAccount(bank, "科目员", Context(s.GetSnapshot()));
        s.Review(v.Id, "B", Context(s.GetSnapshot()));
        s.SaveAccount(bank with { IsActive = false }, "科目员", Context(s.GetSnapshot()));
        Rejected(store, () => s.Post(v.Id, "C", Context(s.GetSnapshot())));
        s.SaveAccount(bank, "科目员", Context(s.GetSnapshot()));
        s.Post(v.Id, "C", Context(s.GetSnapshot()));
    }

    [Fact]
    public void Closing_is_sequential_and_draft_or_reviewed_vouchers_block_it()
    {
        using var store = Store(3);
        var s = new LedgerService(store);
        Rejected(store, () => s.CloseMonth(2, "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.CloseMonth(4, "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.CloseMonth(13, "A", Context(s.GetSnapshot())));
        var v = s.SaveDraft(At(s.GetSnapshot(), Draft(date: new(2026, 3, 1))), "A");
        Rejected(store, () => s.CloseMonth(3, "A", Context(s.GetSnapshot())));
        s.Review(v.Id, "B", Context(s.GetSnapshot()));
        Rejected(store, () => s.CloseMonth(3, "A", Context(s.GetSnapshot())));
        s.Post(v.Id, "A", Context(s.GetSnapshot()));
        // Future drafts must not block closing the current month.
        s.SaveDraft(At(s.GetSnapshot(), Draft(date: new(2026, 4, 1))), "A");
        s.CloseMonth(3, "A", Context(s.GetSnapshot()));
        Assert.Equal(3, s.GetSnapshot().Book.ClosedThroughMonth);
        Rejected(store, () => s.CloseMonth(3, "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.CloseMonth(4, "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.SetOpeningBalances([], "A", Context(s.GetSnapshot())));
    }

    [Fact]
    public void Closed_period_blocks_new_moved_and_existing_voucher_commands_but_allows_reads()
    {
        using var store = Store();
        var s = new LedgerService(store);
        var posted = Posted(s);
        var feb = s.SaveDraft(At(s.GetSnapshot(), Draft(date: Feb1)), "A");
        s.CloseMonth(1, "A", Context(s.GetSnapshot()));
        var lockedSnapshot = s.GetSnapshot();
        var febToJan = EditFrom(lockedSnapshot, feb.Id, Draft());
        var janToFeb = EditFrom(lockedSnapshot, posted.Id, Draft(date: Feb1));
        Rejected(store, () => s.SaveDraft(At(s.GetSnapshot(), Draft()), "A"));
        Rejected(store, () => s.SaveDraft(febToJan, "A"));
        Rejected(store, () => s.SaveDraft(janToFeb, "A"));
        Rejected(store, () => s.DeleteDraft(posted.Id, "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.Review(posted.Id, "B", Context(s.GetSnapshot())));
        Rejected(store, () => s.CancelReview(posted.Id, "B", Context(s.GetSnapshot())));
        Rejected(store, () => s.Post(posted.Id, "A", Context(s.GetSnapshot())));
        Assert.Equal(10m, s.GetTrialBalance(Jan1, Jan31).Sum(r => r.PeriodDebit));
        Assert.Equal(2, s.GetLedger("1002", Jan1, Jan31).Count);
        s.SaveDraft(EditFrom(lockedSnapshot, feb.Id, Draft(20, Feb1)), "A");
    }

    [Fact]
    public void An_empty_final_month_can_close_without_reopening_or_cross_year_rollover()
    {
        using var store = Store(12);
        var s = new LedgerService(store);
        s.CloseMonth(12, "A", Context(s.GetSnapshot()));
        Rejected(store, () => s.CloseMonth(12, "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.CloseMonth(1, "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.SaveDraft(At(s.GetSnapshot(), Draft(date: Dec31)), "A"));
        Rejected(store, () => s.SaveDraft(At(s.GetSnapshot(), Draft(date: new(2027, 1, 1))), "A"));
        Assert.Equal("期初余额", Assert.Single(s.GetLedger("1002", new(2026, 12, 1), Dec31)).Summary);
    }

    [Fact]
    public void Only_posted_lines_affect_reports_and_prior_activity_becomes_the_query_opening()
    {
        using var store = Store();
        var s = new LedgerService(store);
        s.SetOpeningBalances([new("1002", 100, 0), new("4001", 0, 100)], "A", Context(s.GetSnapshot()));
        Posted(s, Draft(10));
        s.SaveDraft(At(s.GetSnapshot(), Draft(40)), "A");
        var reviewed = s.SaveDraft(At(s.GetSnapshot(), Draft(50)), "A");
        s.Review(reviewed.Id, "B", Context(s.GetSnapshot()));
        Posted(s, Draft(5, Feb1, debit: "1002", credit: "6001"));
        var bank = s.GetTrialBalance(Feb1, new(2026, 2, 28)).Single(r => r.AccountCode == "1002");
        Assert.Equal(90m, bank.OpeningDebit);
        Assert.Equal(5m, bank.PeriodDebit);
        Assert.Equal(0m, bank.PeriodCredit);
        Assert.Equal(95m, bank.ClosingDebit);
        var ledger = s.GetLedger("1002", Feb1, new(2026, 2, 28));
        Assert.Equal(2, ledger.Count);
        Assert.Equal(90m, ledger[0].RunningBalance);
        Assert.Equal(95m, ledger[1].RunningBalance);
        Assert.Single(s.GetLedger("1002", new(2026, 3, 1), new(2026, 3, 31)));
    }

    [Fact]
    public void Hierarchy_aggregates_multiple_levels_and_opposite_leaf_balances_without_prefix_guessing()
    {
        using var store = Store();
        var s = new LedgerService(store);
        s.SaveAccount(new("100201", "支行", "1002", BalanceDirection.Debit, true, 0, 0), "A", Context(s.GetSnapshot()));
        s.SaveAccount(new("10020101", "人民币户", "100201", BalanceDirection.Debit, true, 0, 0), "A", Context(s.GetSnapshot()));
        s.SaveAccount(new("100202", "另行", "1002", BalanceDirection.Debit, true, 0, 0), "A", Context(s.GetSnapshot()));
        s.SaveAccount(new("100299", "相同前缀但无父关系", null, BalanceDirection.Debit, true, 0, 0), "A", Context(s.GetSnapshot()));
        s.SetOpeningBalances([new("10020101", 100, 0), new("100202", 0, 20), new("4001", 0, 80)], "A", Context(s.GetSnapshot()));
        var one = Posted(s, Draft(10, debit: "1403", credit: "10020101"));
        Posted(s, Draft(3, debit: "100202", credit: "6001"));
        Posted(s, Draft(99, debit: "100299", credit: "6001"));
        var rows = s.GetTrialBalance(Jan1, Jan31);
        var bank = rows.Single(r => r.AccountCode == "1002");
        Assert.False(bank.IsLeaf);
        Assert.Equal(100m, bank.OpeningDebit);
        Assert.Equal(20m, bank.OpeningCredit);
        Assert.Equal(3m, bank.PeriodDebit);
        Assert.Equal(10m, bank.PeriodCredit);
        Assert.Equal(90m, bank.ClosingDebit);
        Assert.Equal(17m, bank.ClosingCredit);
        Assert.Equal(90m, rows.Single(r => r.AccountCode == "100201").ClosingDebit);
        Assert.Equal(112m, rows.Where(r => r.IsLeaf).Sum(r => r.PeriodDebit));
        Assert.Equal(112m, rows.Where(r => r.IsLeaf).Sum(r => r.PeriodCredit));
        var ledger = s.GetLedger("1002", Jan1, Jan31);
        Assert.Equal(3, ledger.Count);
        Assert.Equal(80m, ledger[0].RunningBalance);
        Assert.Equal(one.Id, ledger[1].VoucherId);
        Assert.Equal(73m, ledger[^1].RunningBalance);
    }

    [Fact]
    public void Opening_balances_are_a_balanced_atomic_replacement_and_freeze_after_posting()
    {
        using var store = Store();
        var s = new LedgerService(store);
        Rejected(store, () => s.SetOpeningBalances([new("1002", 100, 0)], "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.SetOpeningBalances([new("1002", 1, 0), new("1002", 0, 1)], "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.SetOpeningBalances([new("9999", 0, 0)], "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.SetOpeningBalances([new("1002", 1, 1)], "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.SetOpeningBalances([new("1002", 0.001m, 0)], "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.SetOpeningBalances([new("1002", -1, 0)], "A", Context(s.GetSnapshot())));
        s.SetOpeningBalances([new("1002", 100, 0), new("4001", 0, 100)], "A", Context(s.GetSnapshot()));
        s.SetOpeningBalances([new("1403", 20, 0), new("4001", 0, 20)], "A", Context(s.GetSnapshot()));
        Assert.Equal(0, s.GetSnapshot().Accounts.Single(a => a.Code == "1002").OpeningDebit);
        Assert.Equal(20, s.GetSnapshot().Accounts.Single(a => a.Code == "1403").OpeningDebit);
        Posted(s);
        Rejected(store, () => s.SetOpeningBalances([], "A", Context(s.GetSnapshot())));
        var material = s.GetSnapshot().Accounts.Single(a => a.Code == "1403");
        Rejected(store, () => s.SaveAccount(material with { OpeningDebit = 0 }, "A", Context(s.GetSnapshot())));
    }

    [Fact]
    public void Account_validation_and_reference_guards_protect_historical_meaning()
    {
        using var store = Store();
        var s = new LedgerService(store);
        var bank = s.GetSnapshot().Accounts.Single(a => a.Code == "1002");
        Rejected(store, () => s.SaveAccount(bank with { Code = "ABCD" }, "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.SaveAccount(bank with { Code = "123" }, "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.SaveAccount(bank with { Direction = (BalanceDirection)9 }, "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.SaveAccount(bank with { Name = " " }, "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.SaveAccount(bank with { OpeningDebit = 0.001m }, "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.SaveAccount(bank with { OpeningDebit = 1 }, "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.SaveAccount(new("100201", "孤儿", "9999", BalanceDirection.Debit, true, 0, 0), "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.SaveAccount(new("999901", "错误父关系", "1002", BalanceDirection.Debit, true, 0, 0), "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.SaveAccount(bank with { ParentCode = "1002" }, "A", Context(s.GetSnapshot())));
        s.SaveAccount(new("100201", "明细", "1002", BalanceDirection.Debit, true, 0, 0), "A", Context(s.GetSnapshot()));
        Rejected(store, () => s.DeleteAccount("1002", "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.SaveAccount(bank with { ParentCode = "100201" }, "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.SaveAccount(bank with { IsActive = false }, "A", Context(s.GetSnapshot())));
        var v = s.SaveDraft(At(s.GetSnapshot(), Draft(credit: "100201")), "A");
        var child = s.GetSnapshot().Accounts.Single(a => a.Code == "100201");
        Rejected(store, () => s.DeleteAccount("100201", "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.SaveAccount(child with { Direction = BalanceDirection.Credit }, "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.SaveAccount(child with { ParentCode = null }, "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.SaveAccount(bank with { Direction = BalanceDirection.Credit }, "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.SaveAccount(new("10020101", "引用末级下增子级", "100201", BalanceDirection.Debit, true, 0, 0), "A", Context(s.GetSnapshot())));
        s.SaveAccount(child with { Name = "更正显示名称" }, "A", Context(s.GetSnapshot()));
        s.DeleteDraft(v.Id, "A", Context(s.GetSnapshot()));
        s.DeleteAccount("100201", "A", Context(s.GetSnapshot()));
        s.DeleteAccount("1002", "A", Context(s.GetSnapshot()));
        Rejected(store, () => s.DeleteAccount("1002", "A", Context(s.GetSnapshot())));
    }

    [Fact]
    public void Nonzero_opening_leaf_cannot_be_deleted_or_converted_to_a_parent()
    {
        using var store = Store();
        var s = new LedgerService(store);
        s.SetOpeningBalances([new("1002", 100, 0), new("4001", 0, 100)], "A", Context(s.GetSnapshot()));
        Rejected(store, () => s.DeleteAccount("1002", "A", Context(s.GetSnapshot())));
        Rejected(store, () => s.SaveAccount(new("100201", "明细", "1002", BalanceDirection.Debit, true, 0, 0), "A", Context(s.GetSnapshot())));
    }

    [Fact]
    public void Failed_storage_write_does_not_mutate_input_state_or_append_audit()
    {
        using var store = Store();
        var s = new LedgerService(store);
        var v = s.SaveDraft(At(s.GetSnapshot(), Draft()), "A");
        var before = Data(store);
        var failure = new IOException("注入提交前写入失败");
        store.WriteFailure = failure;
        Assert.Same(failure, Assert.Throws<IOException>(() => s.Review(v.Id, "B", Context(s.GetSnapshot()))));
        Assert.Equal(before, Data(store));
        Assert.Equal(2, store.WriteAttempts);
        Assert.Equal(1, store.SuccessfulWrites);
        store.WriteFailure = null;
        s.Review(v.Id, "B", Context(s.GetSnapshot()));
        Assert.Equal(2, s.GetSnapshot().Revision);
    }

    [Fact]
    public async Task Concurrent_services_cannot_allocate_the_same_number_or_lose_audit_history()
    {
        using var store = Store();
        var opened = store.Read();
        using var barrier = new Barrier(2);
        store.AfterRead = () => Assert.True(barrier.SignalAndWait(TimeSpan.FromSeconds(10)));
        // Both commands see revision 0, independently choose number 1, then race the CAS write.
        var tasks = new[] { "A", "B" }.Select(actor => Task.Run(() =>
            Record.Exception(() => new LedgerService(store).SaveDraft(At(opened, Draft()), actor)))).ToArray();
        var results = await Task.WhenAll(tasks);
        store.AfterRead = null;
        Assert.Single(results, r => r is null);
        Assert.Single(results, r => r is StoreConcurrencyException);
        Assert.Equal(2, store.WriteAttempts);
        Assert.Equal(1, store.SuccessfulWrites);
        Assert.Equal(1, store.Read().Revision);
        Assert.Single(store.Read().AuditEvents);
        Assert.Equal(1, Assert.Single(store.Read().Vouchers).Number);
        Assert.Equal(2, new LedgerService(store).SaveDraft(At(store.Read(), Draft()), "重试员").Number);
    }

    [Fact]
    public async Task Concurrent_posting_of_one_voucher_changes_balances_exactly_once()
    {
        using var store = Store();
        var s = new LedgerService(store);
        var v = s.SaveDraft(At(s.GetSnapshot(), Draft()), "A");
        s.Review(v.Id, "B", Context(s.GetSnapshot()));
        var opened = s.GetSnapshot();
        using var barrier = new Barrier(2);
        store.AfterRead = () => Assert.True(barrier.SignalAndWait(TimeSpan.FromSeconds(10)));
        var results = await Task.WhenAll(new[] { "记账1", "记账2" }.Select(actor => Task.Run(() =>
            Record.Exception(() => new LedgerService(store).Post(v.Id, actor, Context(opened))))));
        store.AfterRead = null;
        Assert.Single(results, e => e is null);
        Assert.Single(results, e => e is StoreConcurrencyException);
        Assert.Equal(3, store.Read().Revision);
        Assert.Single(store.Read().AuditEvents, e => e.Action == "Post");
        Assert.Equal(10m, s.GetTrialBalance(Jan1, Jan31).Sum(r => r.PeriodDebit));
    }

    [Fact]
    public async Task Closing_racing_with_new_draft_cannot_commit_a_closed_month_with_an_unposted_voucher()
    {
        using var store = Store();
        var opened = store.Read();
        using var barrier = new Barrier(2);
        store.AfterRead = () => Assert.True(barrier.SignalAndWait(TimeSpan.FromSeconds(10)));
        var results = await Task.WhenAll(
            Task.Run(() => Record.Exception(() => new LedgerService(store).CloseMonth(1, "结账员", Context(opened)))),
            Task.Run(() => Record.Exception(() => new LedgerService(store).SaveDraft(At(opened, Draft()), "制单员"))));
        store.AfterRead = null;
        Assert.Single(results, e => e is null);
        Assert.Single(results, e => e is StoreConcurrencyException);
        var state = store.Read();
        Assert.Equal(1, state.Revision);
        Assert.False(state.Book.ClosedThroughMonth == 1 && state.Vouchers.Any());
        if (state.Book.ClosedThroughMonth == 1)
            Rejected(store, () => new LedgerService(store).SaveDraft(At(state, Draft()), "制单员"));
        else
            Rejected(store, () => new LedgerService(store).CloseMonth(1, "结账员", Context(state)));
    }

    [Theory]
    [InlineData("account")]
    [InlineData("delete-account")]
    [InlineData("openings")]
    [InlineData("save-draft")]
    [InlineData("delete-draft")]
    [InlineData("cancel-review")]
    [InlineData("post")]
    [InlineData("close")]
    public void Every_mutation_preserves_the_original_snapshot_when_storage_rejects_the_write(string operation)
    {
        using var store = Store();
        var s = new LedgerService(store);
        var v = s.SaveDraft(At(s.GetSnapshot(), Draft()), "A");
        if (operation is "cancel-review" or "post") s.Review(v.Id, "B", Context(s.GetSnapshot()));
        if (operation == "close") { s.Review(v.Id, "B", Context(s.GetSnapshot())); s.Post(v.Id, "C", Context(s.GetSnapshot())); }
        var edit = EditFrom(s.GetSnapshot(), v.Id, Draft(20));
        Action command = operation switch
        {
            "account" => () => s.SaveAccount(new("9999", "新科目", null, BalanceDirection.Debit, true, 0, 0), "A", Context(s.GetSnapshot())),
            "delete-account" => () => s.DeleteAccount("1001", "A", Context(s.GetSnapshot())),
            "openings" => () => s.SetOpeningBalances([new("1002", 100, 0), new("4001", 0, 100)], "A", Context(s.GetSnapshot())),
            "save-draft" => () => s.SaveDraft(edit, "A"),
            "delete-draft" => () => s.DeleteDraft(v.Id, "A", Context(s.GetSnapshot())),
            "cancel-review" => () => s.CancelReview(v.Id, "B", Context(s.GetSnapshot())),
            "post" => () => s.Post(v.Id, "C", Context(s.GetSnapshot())),
            "close" => () => s.CloseMonth(1, "C", Context(s.GetSnapshot())),
            _ => throw new ArgumentOutOfRangeException(nameof(operation))
        };
        var before = Data(store);
        var attempts = store.WriteAttempts;
        store.WriteFailure = new StoreConcurrencyException("注入外部revision冲突");
        Assert.Throws<StoreConcurrencyException>(command);
        Assert.Equal(attempts + 1, store.WriteAttempts);
        Assert.Equal(before, Data(store));
    }

    [Fact]
    public void Successful_commands_increment_once_and_preserve_audit_fields()
    {
        using var store = Store();
        var s = new LedgerService(store);
        var started = DateTimeOffset.UtcNow;
        var v = Posted(s);
        s.CloseMonth(1, "结账员", Context(s.GetSnapshot()));
        var snapshot = s.GetSnapshot();
        Assert.Equal(4, snapshot.Revision);
        Assert.Equal(4, store.SuccessfulWrites);
        Assert.Equal(new[] { "SaveDraft", "Review", "Post", "CloseMonth" }, snapshot.AuditEvents.Select(a => a.Action));
        Assert.Equal(new[] { "制单员", "审核员", "记账员", "结账员" }, snapshot.AuditEvents.Select(a => a.OperatorName));
        Assert.All(snapshot.AuditEvents.Take(3), a => Assert.Equal(v.Id, a.VoucherId));
        Assert.Null(snapshot.AuditEvents[3].VoucherId);
        Assert.Equal(4, snapshot.AuditEvents.Select(a => a.Id).Distinct().Count());
        Assert.All(snapshot.AuditEvents, a => { Assert.InRange(a.At, started, DateTimeOffset.UtcNow); Assert.False(string.IsNullOrWhiteSpace(a.Detail)); });
        Assert.False(store.IsDisposed);
    }

    [Fact]
    public void Returned_snapshots_and_saved_draft_lines_cannot_mutate_store_state()
    {
        using var store = Store();
        var s = new LedgerService(store);
        var lines = Draft().Lines.ToArray();
        var returned = s.SaveDraft(At(s.GetSnapshot(), Draft() with { Lines = lines }), "A");
        lines[0] = new("1403", "调用方篡改", 999, 0);
        Assert.Equal(10, returned.Lines[0].Debit);
        Assert.Throws<NotSupportedException>(() => ((IList<VoucherLine>)returned.Lines)[0] = lines[0]);
        var snapshot = s.GetSnapshot();
        Assert.Throws<NotSupportedException>(() => ((IList<Account>)snapshot.Accounts).Clear());
        Assert.Throws<NotSupportedException>(() => ((IList<Voucher>)snapshot.Vouchers).Clear());
        Assert.Throws<NotSupportedException>(() => ((IList<VoucherLine>)snapshot.Vouchers[0].Lines).Clear());
        Assert.Throws<NotSupportedException>(() => ((IList<AuditEvent>)snapshot.AuditEvents).Clear());
        Assert.Equal(10, s.GetSnapshot().Vouchers[0].Lines[0].Debit);
    }

    [Fact]
    public void Constructor_requires_a_store_and_services_observe_each_others_latest_revision()
    {
        Assert.Throws<ArgumentNullException>(() => new LedgerService(null!));
        using var store = Store();
        var first = new LedgerService(store);
        var second = new LedgerService(store);
        var v = first.SaveDraft(At(first.GetSnapshot(), Draft()), "A");
        second.Review(v.Id, "B", Context(second.GetSnapshot()));
        first.Post(v.Id, "C", Context(first.GetSnapshot()));
        Assert.Equal(VoucherStatus.Posted, second.GetSnapshot().Vouchers.Single().Status);
        Assert.Equal(3, second.GetSnapshot().Revision);
    }

    [Fact]
    public void Opening_grid_zero_row_for_disabled_unused_leaf_is_accepted_but_vouchers_still_reject_it()
    {
        using var store = Store();
        var s = new LedgerService(store);
        var cash = s.GetSnapshot().Accounts.Single(a => a.Code == "1001");
        s.SaveAccount(cash with { IsActive = false }, "科目员", Context(s.GetSnapshot()));
        // The real grid submits every leaf, including the disabled cash row with zero values.
        var visible = s.GetSnapshot().Accounts.Select(a => new OpeningBalance(a.Code,
            a.Code == "1002" ? 100.01m : 0, a.Code == "4001" ? 100.01m : 0)).ToArray();
        s.SetOpeningBalances(visible, "期初员", Context(s.GetSnapshot()));
        Assert.Equal(100.01m, s.GetSnapshot().Accounts.Single(a => a.Code == "1002").OpeningDebit);
        Assert.Equal(100.01m, s.GetSnapshot().Accounts.Single(a => a.Code == "4001").OpeningCredit);
        Assert.False(s.GetSnapshot().Accounts.Single(a => a.Code == "1001").IsActive);
        Assert.Equal(0m, s.GetSnapshot().Accounts.Single(a => a.Code == "1001").OpeningDebit);
        Rejected(store, () => s.SaveDraft(At(s.GetSnapshot(), Draft(debit: "1001")), "制单员"));
    }

    [Theory]
    [InlineData("1002")]
    [InlineData("4001")]
    public void Disabled_leaf_existing_nonzero_opening_can_be_resubmitted_unchanged(string inactiveCode)
    {
        using var store = Store();
        var s = new LedgerService(store);
        s.SetOpeningBalances([new("1002", 100.01m, 0), new("4001", 0, 100.01m)], "期初员", Context(s.GetSnapshot()));
        var account = s.GetSnapshot().Accounts.Single(a => a.Code == inactiveCode);
        s.SaveAccount(account with { IsActive = false }, "科目员", Context(s.GetSnapshot()));
        var visible = s.GetSnapshot().Accounts.Select(a => new OpeningBalance(a.Code, a.OpeningDebit, a.OpeningCredit)).ToArray();
        s.SetOpeningBalances(visible, "期初员", Context(s.GetSnapshot()));
        var retained = s.GetSnapshot().Accounts.Single(a => a.Code == inactiveCode);
        Assert.Equal(account.OpeningDebit, retained.OpeningDebit);
        Assert.Equal(account.OpeningCredit, retained.OpeningCredit);
        Assert.False(retained.IsActive);
        Assert.Equal(100.01m, s.GetTrialBalance(Jan1, Jan31).Where(r => r.IsLeaf).Sum(r => r.OpeningDebit));
        Assert.Equal(100.01m, s.GetTrialBalance(Jan1, Jan31).Where(r => r.IsLeaf).Sum(r => r.OpeningCredit));
    }

    [Fact]
    public void Omission_or_clearing_of_disabled_nonzero_opening_cannot_silently_replace_it_even_when_totals_balance()
    {
        using var store = Store();
        var s = new LedgerService(store);
        s.SetOpeningBalances([new("1002", 100.01m, 0), new("4001", 0, 100.01m)], "期初员", Context(s.GetSnapshot()));
        var bank = s.GetSnapshot().Accounts.Single(a => a.Code == "1002");
        s.SaveAccount(bank with { IsActive = false }, "科目员", Context(s.GetSnapshot()));
        // Both payloads would be balanced if a filter quietly erased the disabled bank balance.
        Rejected(store, () => s.SetOpeningBalances([new("1403", 100.01m, 0), new("4001", 0, 100.01m)], "期初员", Context(s.GetSnapshot())));
        Rejected(store, () => s.SetOpeningBalances([new("1002", 0, 0), new("1403", 100.01m, 0), new("4001", 0, 100.01m)], "期初员", Context(s.GetSnapshot())));
        Rejected(store, () => s.SetOpeningBalances([new("1002", 200.02m, 0), new("4001", 0, 200.02m)], "期初员", Context(s.GetSnapshot())));
        s.SaveAccount(bank, "科目员", Context(s.GetSnapshot()));
        s.SetOpeningBalances([new("1403", 100.01m, 0), new("4001", 0, 100.01m)], "期初员", Context(s.GetSnapshot()));
        Assert.Equal(0m, s.GetSnapshot().Accounts.Single(a => a.Code == "1002").OpeningDebit);
    }

    [Fact]
    public void Disabled_zero_opening_cannot_gain_new_amounts_and_nonleaf_zero_rows_remain_invalid()
    {
        using var store = Store();
        var s = new LedgerService(store);
        var cash = s.GetSnapshot().Accounts.Single(a => a.Code == "1001");
        s.SaveAccount(cash with { IsActive = false }, "科目员", Context(s.GetSnapshot()));
        Rejected(store, () => s.SetOpeningBalances([new("1001", 100, 0), new("4001", 0, 100)], "期初员", Context(s.GetSnapshot())));
        s.SaveAccount(new("100201", "停用银行明细", "1002", BalanceDirection.Debit, false, 0, 0), "科目员", Context(s.GetSnapshot()));
        var bank = s.GetSnapshot().Accounts.Single(a => a.Code == "1002");
        s.SaveAccount(bank with { IsActive = false }, "科目员", Context(s.GetSnapshot()));
        Rejected(store, () => s.SetOpeningBalances([new("1002", 0, 0)], "期初员", Context(s.GetSnapshot())));
    }
}
