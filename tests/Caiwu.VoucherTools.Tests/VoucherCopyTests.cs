using System.Globalization;
using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Core;

namespace Caiwu.VoucherTools.Tests;

public sealed class VoucherCopyTests
{
    private readonly IVoucherCopyPlanner planner = new VoucherCopyPlanner();

    private static VoucherCopyOptions Options() => new(new(2026, 1, 6), "转", 8, 0, "新制单员");
    private static LedgerMutationContext Context(LedgerSnapshot shown) => new(shown.Book.Id, shown.Revision);
    private static string Data(object value) => JsonSerializer.Serialize(value);
    private static Voucher Source(LedgerSnapshot shown) => Assert.Single(shown.Vouchers);

    private static SyntheticLedgerStore Store(VoucherStatus status = VoucherStatus.Posted,
        IReadOnlyList<VoucherLine>? lines = null)
    {
        var store = new SyntheticLedgerStore(new(0,
            new(Guid.NewGuid(), "合成账套", AccountingRegime.Enterprise, "synthetic-only", 2026, 1, 0,
                new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero)),
            [new("1002", "合成银行", null, BalanceDirection.Debit, true, 0, 0),
             new("1403", "合成材料", null, BalanceDirection.Debit, true, 0, 0)], [], []));
        var service = new LedgerService(store);
        var shown = service.GetSnapshot();
        var source = service.SaveDraft(new(null, new(2026, 1, 5), "记", 7, 3,
            lines ?? [new("1403", "合成采购 甲", 0.3m, 0), new("1002", "合成付款 乙", 0, 0.3m)],
            shown.Revision, shown.Book.Id), "原制单员");
        if (status is VoucherStatus.Reviewed or VoucherStatus.Posted)
            service.Review(source.Id, "原审核员", Context(service.GetSnapshot()));
        if (status == VoucherStatus.Posted)
            service.Post(source.Id, "原记账员", Context(service.GetSnapshot()));
        return store;
    }

    private VoucherCopyPlan Plan(LedgerSnapshot shown, VoucherCopyOptions? options = null)
    {
        var result = planner.Plan(shown, Source(shown).Id, options ?? Options());
        Assert.True(result.IsSuccess, string.Join("; ", result.Issues.Select(i => i.Message)));
        Assert.Empty(result.Issues);
        return Assert.IsType<VoucherCopyPlan>(result.Plan);
    }

    [Theory]
    [InlineData(VoucherStatus.Draft)]
    [InlineData(VoucherStatus.Reviewed)]
    [InlineData(VoucherStatus.Posted)]
    public void Host_explicitly_saves_a_new_draft_without_source_identity_or_review_history(VoucherStatus status)
    {
        using var store = Store(status);
        var service = new LedgerService(store);
        var shown = service.GetSnapshot();
        var source = Source(shown);
        var original = Data(shown);
        var sourceData = Data(source);
        var balances = Data(service.GetTrialBalance(new(2026, 1, 1), new(2026, 1, 31)));
        var reads = store.ReadCount;
        var writes = store.WriteCount;
        var plan = Plan(shown);

        Assert.Equal(reads, store.ReadCount);
        Assert.Equal(writes, store.WriteCount);
        Assert.Equal(original, Data(shown));
        Assert.Null(plan.Draft.Id);
        Assert.Equal(source.Id, plan.SourceVoucherId);
        Assert.Equal(shown.Book.Id, plan.Draft.ExpectedBookId);
        Assert.Equal(shown.Revision, plan.Draft.ExpectedRevision);
        Assert.Equal(Options().Date, plan.Draft.Date);
        Assert.Equal(Options().Kind, plan.Draft.Kind);
        Assert.Equal(Options().Number, plan.Draft.Number);
        Assert.Equal(Options().AttachmentCount, plan.Draft.AttachmentCount);
        Assert.Equal(Options().PreparedBy, plan.PreparedBy);
        Assert.NotSame(source.Lines, plan.Draft.Lines);
        for (var index = 0; index < source.Lines.Count; index++)
        {
            Assert.Equal(source.Lines[index], plan.Draft.Lines[index]);
            Assert.NotSame(source.Lines[index], plan.Draft.Lines[index]);
        }

        // This is the host save boundary; the planner has no service/store to call.
        var saved = service.SaveDraft(plan.Draft, plan.PreparedBy);
        Assert.NotEqual(Guid.Empty, saved.Id);
        Assert.NotEqual(source.Id, saved.Id);
        Assert.Equal(VoucherStatus.Draft, saved.Status);
        Assert.Null(saved.ReviewedBy);
        Assert.Equal("新制单员", saved.PreparedBy);
        Assert.Equal(plan.Draft.Date, saved.Date);
        Assert.Equal(plan.Draft.Kind, saved.Kind);
        Assert.Equal(plan.Draft.Number, saved.Number);
        Assert.Equal(plan.Draft.AttachmentCount, saved.AttachmentCount);
        Assert.Equal(Data(source.Lines), Data(saved.Lines));
        Assert.Equal(balances, Data(service.GetTrialBalance(new(2026, 1, 1), new(2026, 1, 31))));
        var after = service.GetSnapshot();
        Assert.Equal(2, after.Vouchers.Count);
        Assert.Equal(shown.Revision + 1, after.Revision);
        Assert.Equal(writes + 1, store.WriteCount);
        Assert.Equal(sourceData, Data(after.Vouchers.Single(v => v.Id == source.Id)));
        Assert.Equal(original, Data(shown));
        var audit = after.AuditEvents.Last();
        Assert.Equal("SaveDraft", audit.Action);
        Assert.Equal(saved.Id, audit.VoucherId);
        Assert.Equal("新制单员", audit.OperatorName);
    }

    [Fact]
    public void Repeated_lines_and_decimal_bits_are_preserved_in_original_order()
    {
        var repeated = new VoucherLine("1403", "重复行 ①", 0.1000m, 0m);
        using var store = Store(lines: [repeated, repeated, new("1002", "精确合计", 0m, 0.2000m)]);
        var shown = new LedgerService(store).GetSnapshot();
        var plan = Plan(shown);
        Assert.Equal(3, plan.Draft.Lines.Count);
        Assert.Equal(plan.Draft.Lines[0], plan.Draft.Lines[1]);
        Assert.NotSame(plan.Draft.Lines[0], plan.Draft.Lines[1]);
        for (var index = 0; index < 3; index++)
        {
            var original = Source(shown).Lines[index];
            var copied = plan.Draft.Lines[index];
            Assert.Equal(original.AccountCode, copied.AccountCode);
            Assert.Equal(original.Summary, copied.Summary);
            Assert.Equal(decimal.GetBits(original.Debit), decimal.GetBits(copied.Debit));
            Assert.Equal(decimal.GetBits(original.Credit), decimal.GetBits(copied.Credit));
        }
        Assert.Throws<NotSupportedException>(() => ((IList<VoucherLine>)plan.Draft.Lines)[0] = new("1002", "改动", 1, 0));
    }

    [Theory]
    [InlineData("0.01")]
    [InlineData("0.1000")]
    [InlineData("92233720368547758.07")]
    public void Cent_precision_and_Int64_cent_boundary_reach_Core_unchanged(string text)
    {
        var amount = decimal.Parse(text, CultureInfo.InvariantCulture);
        using var store = Store(lines: [new("1403", "合成借方", amount, 0), new("1002", "合成贷方", 0, amount)]);
        var service = new LedgerService(store);
        var plan = Plan(service.GetSnapshot());
        var saved = service.SaveDraft(plan.Draft, plan.PreparedBy);
        Assert.Equal(decimal.GetBits(amount), decimal.GetBits(saved.Lines[0].Debit));
        Assert.Equal(decimal.GetBits(amount), decimal.GetBits(saved.Lines[1].Credit));
        Assert.Equal(0m, saved.Lines[0].Credit);
        Assert.Equal(0m, saved.Lines[1].Debit);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-0.01")]
    [InlineData("0.001")]
    [InlineData("92233720368547758.08")]
    public void Invalid_source_amount_is_reported_without_rounding_omitting_or_balancing(string text)
    {
        using var store = Store();
        var shown = new LedgerService(store).GetSnapshot();
        var amount = decimal.Parse(text, CultureInfo.InvariantCulture);
        var bad = shown with { Vouchers = [Source(shown) with { Lines =
            [new("1403", "合成借方", amount, 0), new("1002", "合成贷方", 0, amount)] }] };
        var before = Data(bad);
        var result = planner.Plan(bad, Source(bad).Id, Options());
        Assert.False(result.IsSuccess);
        Assert.Null(result.Plan);
        Assert.Contains(result.Issues, i => i.Code == VoucherCopyIssueCode.InvalidAmount && i.LineNumber == 1);
        Assert.Equal(before, Data(bad));
    }

    [Theory]
    [InlineData("missing", VoucherCopyIssueCode.AccountMissing)]
    [InlineData("inactive", VoucherCopyIssueCode.AccountInactive)]
    [InlineData("parent", VoucherCopyIssueCode.AccountNotLeaf)]
    public void Invalid_account_is_located_by_row_without_guessing_a_replacement(string mode, VoucherCopyIssueCode code)
    {
        using var store = Store();
        var shown = new LedgerService(store).GetSnapshot();
        // Missing/nonleaf cases intentionally model invalid imported synthetic snapshots;
        // Core normally prevents deleting/reparenting an account already used by a voucher.
        var accounts = mode switch
        {
            "missing" => shown.Accounts.Where(a => a.Code != "1403").ToArray(),
            "inactive" => shown.Accounts.Select(a => a.Code == "1403" ? a with { IsActive = false } : a).ToArray(),
            _ => shown.Accounts.Append(new("140301", "合成明细", "1403", BalanceDirection.Debit, true, 0, 0)).ToArray()
        };
        var invalid = shown with { Accounts = accounts };
        var before = Data(invalid);
        var result = planner.Plan(invalid, Source(invalid).Id, Options());
        Assert.Null(result.Plan);
        Assert.Contains(result.Issues, i => i.Code == code && i.LineNumber == 1 && i.Message.Contains("1403"));
        Assert.Equal(before, Data(invalid));
    }

    [Theory]
    [InlineData("closed", VoucherCopyIssueCode.PeriodClosed)]
    [InlineData("year", VoucherCopyIssueCode.DateOutsideBook)]
    [InlineData("before-start", VoucherCopyIssueCode.DateOutsideBook)]
    [InlineData("number-zero", VoucherCopyIssueCode.InvalidNumber)]
    [InlineData("number-negative", VoucherCopyIssueCode.InvalidNumber)]
    [InlineData("duplicate", VoucherCopyIssueCode.NumberAlreadyUsed)]
    [InlineData("kind", VoucherCopyIssueCode.InvalidKind)]
    [InlineData("kind-space", VoucherCopyIssueCode.InvalidKind)]
    [InlineData("attachments", VoucherCopyIssueCode.InvalidAttachmentCount)]
    [InlineData("maker", VoucherCopyIssueCode.InvalidPreparedBy)]
    [InlineData("maker-control", VoucherCopyIssueCode.InvalidPreparedBy)]
    public void Explicit_header_options_are_validated_without_defaults(string mode, VoucherCopyIssueCode code)
    {
        using var store = Store();
        var shown = new LedgerService(store).GetSnapshot();
        var options = Options();
        if (mode == "closed") shown = shown with { Book = shown.Book with { ClosedThroughMonth = 1 } };
        if (mode == "before-start") shown = shown with { Book = shown.Book with { StartMonth = 2, ClosedThroughMonth = 1 } };
        options = mode switch
        {
            "year" => options with { Date = new(2027, 1, 6) },
            "number-zero" => options with { Number = 0 },
            "number-negative" => options with { Number = -1 },
            "duplicate" => options with { Kind = "记", Number = 7 },
            "kind" => options with { Kind = "" },
            "kind-space" => options with { Kind = " 记 " },
            "attachments" => options with { AttachmentCount = -1 },
            "maker" => options with { PreparedBy = "" },
            "maker-control" => options with { PreparedBy = "新\n制单" },
            _ => options
        };
        var before = Data(shown);
        var result = planner.Plan(shown, Source(shown).Id, options);
        Assert.Null(result.Plan);
        Assert.Contains(result.Issues, i => i.Code == code);
        Assert.Equal(before, Data(shown));
    }

    [Fact]
    public void Closed_source_period_can_be_copied_to_an_explicit_open_month()
    {
        using var store = Store();
        var service = new LedgerService(store);
        service.CloseMonth(1, "结账员", Context(service.GetSnapshot()));
        var shown = service.GetSnapshot();
        var options = new VoucherCopyOptions(new(2026, 2, 1), "记", 7, int.MaxValue, "本次制单员");
        var plan = Plan(shown, options);
        var saved = service.SaveDraft(plan.Draft, plan.PreparedBy);
        Assert.Equal(options.Date, saved.Date);
        Assert.Equal(7, saved.Number); // Same number is valid in a different month.
        Assert.Equal(int.MaxValue, saved.AttachmentCount);
        Assert.Equal(VoucherStatus.Posted, service.GetSnapshot().Vouchers.Single(v => v.Id == plan.SourceVoucherId).Status);
    }

    [Fact]
    public void Cancel_means_discarding_the_plan_and_changes_neither_snapshot_nor_store()
    {
        using var store = Store();
        var service = new LedgerService(store);
        var shown = service.GetSnapshot();
        var before = Data(shown);
        var reads = store.ReadCount;
        var writes = store.WriteCount;
        _ = Plan(shown);
        // User presses Cancel: host drops this value and makes no SaveDraft call.
        Assert.Equal(reads, store.ReadCount);
        Assert.Equal(writes, store.WriteCount);
        Assert.Equal(before, Data(shown));
        Assert.Equal(before, Data(store.Read()));
    }

    [Fact]
    public void A_foreign_selection_cannot_substitute_a_voucher_from_another_snapshot()
    {
        using var first = Store();
        using var other = Store();
        var shown = new LedgerService(first).GetSnapshot();
        var foreignId = Source(new LedgerService(other).GetSnapshot()).Id;
        var before = Data(shown);
        var result = planner.Plan(shown, foreignId, Options());
        Assert.Null(result.Plan);
        Assert.Contains(result.Issues, i => i.Code == VoucherCopyIssueCode.SourceNotFound);
        Assert.Equal(before, Data(shown));
    }

    [Fact]
    public void Core_rejects_cross_book_save_even_when_both_revisions_are_equal()
    {
        using var first = Store();
        using var other = Store();
        var shown = new LedgerService(first).GetSnapshot();
        var target = new LedgerService(other);
        var targetBefore = target.GetSnapshot();
        Assert.Equal(shown.Revision, targetBefore.Revision);
        Assert.NotEqual(shown.Book.Id, targetBefore.Book.Id);
        var plan = Plan(shown);
        var planBefore = Data(plan);
        var writes = other.WriteCount;
        Assert.Throws<StoreConcurrencyException>(() => target.SaveDraft(plan.Draft, plan.PreparedBy));
        Assert.Equal(writes, other.WriteCount);
        Assert.Equal(Data(targetBefore), Data(target.GetSnapshot()));
        Assert.Equal(planBefore, Data(plan));
        Assert.Equal(Data(shown), Data(first.Read()));
    }

    [Fact]
    public void Core_rejects_stale_plan_and_preflight_reports_the_now_inactive_account()
    {
        using var store = Store();
        var service = new LedgerService(store);
        var shown = service.GetSnapshot();
        var plan = Plan(shown);
        var inputBefore = Data(plan);
        service.SaveAccount(shown.Accounts.Single(a => a.Code == "1403") with { IsActive = false },
            "科目员", Context(shown));
        var changed = service.GetSnapshot();
        var writes = store.WriteCount;
        Assert.Throws<StoreConcurrencyException>(() => service.SaveDraft(plan.Draft, plan.PreparedBy));
        Assert.Equal(writes, store.WriteCount);
        Assert.Equal(Data(changed), Data(service.GetSnapshot()));
        Assert.Equal(inputBefore, Data(plan));
        Assert.Equal(shown.Revision, plan.Draft.ExpectedRevision);
        var reselected = planner.Plan(changed, Source(changed).Id, Options());
        Assert.Null(reselected.Plan);
        Assert.Contains(reselected.Issues, i => i.Code == VoucherCopyIssueCode.AccountInactive && i.LineNumber == 1);
    }

    [Fact]
    public void Period_closing_after_planning_rejects_the_old_token_without_saving()
    {
        using var store = Store();
        var service = new LedgerService(store);
        var shown = service.GetSnapshot();
        var plan = Plan(shown);
        service.CloseMonth(1, "结账员", Context(shown));
        var closed = service.GetSnapshot();
        var writes = store.WriteCount;
        Assert.Throws<StoreConcurrencyException>(() => service.SaveDraft(plan.Draft, plan.PreparedBy));
        Assert.Equal(writes, store.WriteCount);
        Assert.Equal(Data(closed), Data(service.GetSnapshot()));
        Assert.Equal(shown.Revision, plan.Draft.ExpectedRevision);
    }

    [Fact]
    public void Detached_readonly_copy_survives_changes_to_the_callers_mutable_source_array()
    {
        using var store = Store();
        var shown = new LedgerService(store).GetSnapshot();
        var sourceLines = Source(shown).Lines.ToArray();
        var mutable = shown with { Vouchers = [Source(shown) with { Lines = sourceLines }] };
        var plan = Plan(mutable);
        var before = Data(plan);
        sourceLines[0] = new("1002", "外部改动", 999, 0);
        Assert.Equal(before, Data(plan));
        Assert.Equal(Data(shown), Data(store.Read()));
    }

    [Theory]
    [InlineData("summary", VoucherCopyIssueCode.InvalidSummary)]
    [InlineData("both-sides", VoucherCopyIssueCode.InvalidAmount)]
    [InlineData("unbalanced", VoucherCopyIssueCode.Unbalanced)]
    [InlineData("empty-lines", VoucherCopyIssueCode.InvalidLines)]
    [InlineData("null-line", VoucherCopyIssueCode.InvalidLines)]
    public void Malformed_source_is_reported_without_rewriting_its_content(string mode, VoucherCopyIssueCode code)
    {
        using var store = Store();
        var shown = new LedgerService(store).GetSnapshot();
        var lines = Source(shown).Lines.ToArray();
        if (mode == "summary") lines[0] = lines[0] with { Summary = " 首尾空格 " };
        if (mode == "both-sides") lines[0] = lines[0] with { Credit = 0.3m };
        if (mode == "unbalanced") lines[0] = lines[0] with { Debit = 0.2m };
        if (mode == "empty-lines") lines = [];
        if (mode == "null-line") lines[0] = null!;
        var bad = shown with { Vouchers = [Source(shown) with { Lines = lines }] };
        var before = Data(bad);
        var result = planner.Plan(bad, Source(bad).Id, Options());
        Assert.Null(result.Plan);
        Assert.Contains(result.Issues, i => i.Code == code);
        Assert.Equal(before, Data(bad));
    }
}
