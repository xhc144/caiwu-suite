using System.Text.Json;
using Caiwu.Contracts;

namespace Caiwu.Core.Tests;

public sealed class DraftEditTokenTests
{
    private static MemoryLedgerStore NewStore() => new(new(0,
        new(Guid.NewGuid(), "编辑token回归", AccountingRegime.Enterprise, "token-test", 2026, 1, 0, DateTimeOffset.UtcNow),
        TemplateCatalog.Get(AccountingRegime.Enterprise).Accounts, [], []));

    private static VoucherDraft CreateDraft(decimal amount = 10) => new(null, new(2026, 1, 1), "记", null, 0,
        [new("1002", "银行", amount, 0), new("4001", "资本", 0, amount)]);

    // This accepts the loaded document, not a service: it cannot refresh a stale editor's token.
    private static VoucherDraft Edit(LedgerSnapshot opened, decimal amount) => CreateDraft(amount) with
    {
        Id = opened.Vouchers.Single().Id, Number = opened.Vouchers.Single().Number,
        ExpectedRevision = opened.Revision, ExpectedBookId = opened.Book.Id
    };

    private static VoucherDraft At(LedgerSnapshot shown, VoucherDraft input) => input with
    { ExpectedBookId = shown.Book.Id, ExpectedRevision = shown.Revision };

    private static void Conflict(MemoryLedgerStore store, VoucherDraft input, Action action)
    {
        var dataBefore = JsonSerializer.Serialize(store.Read());
        var inputBefore = JsonSerializer.Serialize(input);
        var attempts = store.WriteAttempts;
        Assert.Throws<StoreConcurrencyException>(action);
        Assert.Equal(dataBefore, JsonSerializer.Serialize(store.Read()));
        Assert.Equal(inputBefore, JsonSerializer.Serialize(input));
        Assert.Equal(attempts, store.WriteAttempts);
    }

    [Theory]
    [InlineData("missing-both")]
    [InlineData("missing-revision")]
    [InlineData("missing-book")]
    [InlineData("stale")]
    [InlineData("future")]
    [InlineData("negative")]
    [InlineData("wrong-book")]
    [InlineData("empty-book")]
    public void Existing_edit_requires_matching_load_revision_and_book_before_any_write(string invalid)
    {
        using var store = NewStore(); var s = new LedgerService(store);
        s.SaveDraft(At(s.GetSnapshot(), CreateDraft()), "A");
        var opened = s.GetSnapshot();
        var correct = Edit(opened, 20);
        var input = invalid switch
        {
            "missing-both" => correct with { ExpectedRevision = null, ExpectedBookId = null },
            "missing-revision" => correct with { ExpectedRevision = null },
            "missing-book" => correct with { ExpectedBookId = null },
            "stale" => correct with { ExpectedRevision = opened.Revision - 1 },
            "future" => correct with { ExpectedRevision = opened.Revision + 1 },
            "negative" => correct with { ExpectedRevision = -1 },
            "wrong-book" => correct with { ExpectedBookId = Guid.NewGuid() },
            "empty-book" => correct with { ExpectedBookId = Guid.Empty },
            _ => throw new ArgumentOutOfRangeException(nameof(invalid))
        };
        Conflict(store, input, () => s.SaveDraft(input, "B"));
        Assert.Equal(10m, store.Read().Vouchers.Single().Lines[0].Debit);
    }

    [Fact]
    public void Two_editors_keep_their_original_tokens_and_old_input_cannot_replace_twenty_with_ten()
    {
        using var store = NewStore(); var one = new LedgerService(store); var two = new LedgerService(store);
        one.SaveDraft(At(one.GetSnapshot(), CreateDraft()), "A");
        var documentA = one.GetSnapshot(); var documentB = two.GetSnapshot();
        var inputA = Edit(documentA, 20);
        var oldVoucher = documentB.Vouchers.Single();
        var inputB = new VoucherDraft(oldVoucher.Id, oldVoucher.Date, oldVoucher.Kind, oldVoucher.Number,
            oldVoucher.AttachmentCount, oldVoucher.Lines, documentB.Revision, documentB.Book.Id);
        one.SaveDraft(inputA, "A");
        Conflict(store, inputB, () => two.SaveDraft(inputB, "B"));
        Assert.Equal(20m, store.Read().Vouchers.Single().Lines[0].Debit);
        Assert.Equal(2L, store.Read().Revision);
        Assert.Equal(2, store.Read().AuditEvents.Count);
        Assert.Equal(1L, inputB.ExpectedRevision);
        Assert.Equal(10m, inputB.Lines[0].Debit);
    }

    [Fact]
    public void Other_book_token_is_rejected_even_when_its_revision_matches()
    {
        using var oneStore = NewStore(); using var twoStore = NewStore();
        var one = new LedgerService(oneStore); var two = new LedgerService(twoStore);
        one.SaveDraft(At(one.GetSnapshot(), CreateDraft()), "A"); two.SaveDraft(At(two.GetSnapshot(), CreateDraft()), "B");
        var target = one.GetSnapshot(); var other = two.GetSnapshot();
        Assert.Equal(target.Revision, other.Revision);
        Assert.NotEqual(target.Book.Id, other.Book.Id);
        var input = Edit(target, 20) with { ExpectedBookId = other.Book.Id, ExpectedRevision = other.Revision };
        Conflict(oneStore, input, () => one.SaveDraft(input, "A"));
    }

    [Fact]
    public void Next_legitimate_save_uses_the_accepted_version_without_refreshing_the_token_for_old_input()
    {
        using var store = NewStore(); var s = new LedgerService(store); s.SaveDraft(At(s.GetSnapshot(), CreateDraft()), "A");
        var opened = s.GetSnapshot();
        var firstInput = Edit(opened, 20); var saved = s.SaveDraft(firstInput, "A");
        var next = new VoucherDraft(saved.Id, saved.Date, saved.Kind, saved.Number, saved.AttachmentCount,
            CreateDraft(30).Lines, opened.Revision + 1, opened.Book.Id);
        s.SaveDraft(next, "A");
        Assert.Equal(30m, store.Read().Vouchers.Single().Lines[0].Debit);
        Assert.Equal(3L, store.Read().Revision);
        Assert.Equal(3, store.Read().AuditEvents.Count);
    }

    [Theory]
    [InlineData("none")]
    [InlineData("both")]
    [InlineData("revision-only")]
    [InlineData("book-only")]
    public void New_draft_requires_both_origin_fields_and_rejects_legacy_missing_context(string mode)
    {
        using var store = NewStore(); var s = new LedgerService(store); var opened = s.GetSnapshot();
        var input = CreateDraft() with
        {
            ExpectedRevision = mode is "both" or "revision-only" ? opened.Revision : null,
            ExpectedBookId = mode is "both" or "book-only" ? opened.Book.Id : null
        };
        if (mode == "both")
        {
            s.SaveDraft(input, "A");
            Assert.Equal(1L, store.Read().Revision);
            Assert.Single(store.Read().Vouchers);
        }
        else
        {
            Conflict(store, input, () => s.SaveDraft(input, "A"));
            Assert.Equal(0L, store.Read().Revision);
            Assert.Empty(store.Read().Vouchers);
        }
    }

    [Theory]
    [InlineData("future")]
    [InlineData("negative")]
    [InlineData("wrong-book")]
    [InlineData("empty-book")]
    public void New_draft_with_a_supplied_invalid_token_fails_without_allocating_a_number_or_audit(string invalid)
    {
        using var store = NewStore(); var s = new LedgerService(store); var opened = s.GetSnapshot();
        var valid = CreateDraft() with { ExpectedRevision = opened.Revision, ExpectedBookId = opened.Book.Id };
        var input = invalid switch
        {
            "future" => valid with { ExpectedRevision = opened.Revision + 1 },
            "negative" => valid with { ExpectedRevision = -1 },
            "wrong-book" => valid with { ExpectedBookId = Guid.NewGuid() },
            "empty-book" => valid with { ExpectedBookId = Guid.Empty },
            _ => throw new ArgumentOutOfRangeException(nameof(invalid))
        };
        Conflict(store, input, () => s.SaveDraft(input, "A"));
        Assert.Empty(store.Read().Vouchers);
    }
}
