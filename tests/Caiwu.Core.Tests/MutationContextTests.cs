using System.Text.Json;
using Caiwu.Contracts;

namespace Caiwu.Core.Tests;

public sealed class MutationContextTests
{
    private static readonly string[] Operations = ["SaveAccount", "DeleteAccount", "SetOpeningBalances",
        "DeleteDraft", "Review", "CancelReview", "Post", "CloseMonth"];

    public static IEnumerable<object[]> InvalidContexts() =>
        from operation in Operations
        from mode in new[] { "old-interface", "old-concrete", "null", "stale", "future", "negative", "empty-book", "other-book" }
        select new object[] { operation, mode };

    public static IEnumerable<object[]> ValidContexts() => Operations.Select(x => new object[] { x });

    private static MemoryLedgerStore NewStore() => new(new(0,
        new(Guid.NewGuid(), "来源快照", AccountingRegime.Enterprise, "context-v1.2", 2026, 1, 0, DateTimeOffset.UtcNow),
        TemplateCatalog.Get(AccountingRegime.Enterprise).Accounts, [], []));
    private static LedgerMutationContext Context(LedgerSnapshot shown) => new(shown.Book.Id, shown.Revision);
    private static VoucherDraft Draft(LedgerSnapshot shown) => new(null, new(2026, 1, 1), "记", null, 0,
        [new("1002", "独立金额10", 10, 0), new("4001", "独立金额10", 0, 10)], shown.Revision, shown.Book.Id);

    private static LedgerSnapshot Setup(LedgerService service, string operation)
    {
        if (operation is "DeleteDraft" or "Review" or "CancelReview" or "Post" or "CloseMonth")
        {
            var v = service.SaveDraft(Draft(service.GetSnapshot()), "maker");
            if (operation is "CancelReview" or "Post" or "CloseMonth")
                service.Review(v.Id, "reviewer", Context(service.GetSnapshot()));
            if (operation == "CloseMonth") service.Post(v.Id, "poster", Context(service.GetSnapshot()));
        }
        return service.GetSnapshot();
    }

    private static void Invoke(ILedgerService service, string op, LedgerSnapshot shown, LedgerMutationContext? context)
    {
        var id = shown.Vouchers.FirstOrDefault()?.Id ?? Guid.Empty;
        switch (op)
        {
            case "SaveAccount": service.SaveAccount(shown.Accounts.Single(a => a.Code == "1002") with { Name = "新名称" }, "editor", context); break;
            case "DeleteAccount": service.DeleteAccount("1001", "editor", context); break;
            case "SetOpeningBalances": service.SetOpeningBalances([new("1002", 100, 0), new("4001", 0, 100)], "editor", context); break;
            case "DeleteDraft": service.DeleteDraft(id, "editor", context); break;
            case "Review": service.Review(id, "reviewer", context); break;
            case "CancelReview": service.CancelReview(id, "reviewer", context); break;
            case "Post": service.Post(id, "poster", context); break;
            case "CloseMonth": service.CloseMonth(1, "editor", context); break;
            default: throw new ArgumentOutOfRangeException(nameof(op));
        }
    }

    // These deliberately omit the optional argument, as old compiled source callers do.
    private static void Legacy(ILedgerService service, string op, LedgerSnapshot shown)
    {
        var id = shown.Vouchers.FirstOrDefault()?.Id ?? Guid.Empty;
        switch (op)
        {
            case "SaveAccount": service.SaveAccount(shown.Accounts.Single(a => a.Code == "1002"), "editor"); break;
            case "DeleteAccount": service.DeleteAccount("1001", "editor"); break;
            case "SetOpeningBalances": service.SetOpeningBalances([], "editor"); break;
            case "DeleteDraft": service.DeleteDraft(id, "editor"); break;
            case "Review": service.Review(id, "reviewer"); break;
            case "CancelReview": service.CancelReview(id, "reviewer"); break;
            case "Post": service.Post(id, "poster"); break;
            case "CloseMonth": service.CloseMonth(1, "editor"); break;
        }
    }

    private static void LegacyConcrete(LedgerService service, string op, LedgerSnapshot shown)
    {
        var id = shown.Vouchers.FirstOrDefault()?.Id ?? Guid.Empty;
        switch (op)
        {
            case "SaveAccount": service.SaveAccount(shown.Accounts.Single(a => a.Code == "1002"), "editor"); break;
            case "DeleteAccount": service.DeleteAccount("1001", "editor"); break;
            case "SetOpeningBalances": service.SetOpeningBalances([], "editor"); break;
            case "DeleteDraft": service.DeleteDraft(id, "editor"); break;
            case "Review": service.Review(id, "reviewer"); break;
            case "CancelReview": service.CancelReview(id, "reviewer"); break;
            case "Post": service.Post(id, "poster"); break;
            case "CloseMonth": service.CloseMonth(1, "editor"); break;
        }
    }

    [Theory]
    [MemberData(nameof(InvalidContexts))]
    public void Every_non_draft_mutation_requires_its_original_book_and_revision_without_legacy_bypass(string operation, string mode)
    {
        using var store = NewStore(); var first = new LedgerService(store); var second = new LedgerService(store);
        var shown = Setup(first, operation); LedgerMutationContext? context = Context(shown);
        if (mode == "stale")
        {
            // A real second service commits after the target user's snapshot was captured.
            second.SaveDraft(Draft(second.GetSnapshot()), "other-maker");
        }
        context = mode switch
        {
            "null" => null,
            "future" => context with { ExpectedRevision = shown.Revision + 1 },
            "negative" => context with { ExpectedRevision = -1 },
            "empty-book" => context with { ExpectedBookId = Guid.Empty },
            "other-book" => context with { ExpectedBookId = Guid.NewGuid() },
            _ => context
        };
        var before = JsonSerializer.Serialize(store.Read());
        var originalInput = JsonSerializer.Serialize(shown);
        var writes = store.WriteAttempts;
        Assert.Throws<StoreConcurrencyException>(() =>
        {
            if (mode == "old-interface") Legacy(first, operation, shown);
            else if (mode == "old-concrete") LegacyConcrete(first, operation, shown);
            else Invoke(first, operation, shown, context);
        });
        Assert.Equal(before, JsonSerializer.Serialize(store.Read()));
        Assert.Equal(originalInput, JsonSerializer.Serialize(shown));
        Assert.Equal(writes, store.WriteAttempts);
    }

    [Theory]
    [MemberData(nameof(ValidContexts))]
    public void A_command_confirmed_against_the_current_snapshot_commits_once_with_one_audit(string operation)
    {
        using var store = NewStore(); var service = new LedgerService(store);
        var shown = Setup(service, operation);
        var writes = store.WriteAttempts;
        Invoke(service, operation, shown, Context(shown));
        var after = store.Read();
        Assert.Equal(shown.Revision + 1, after.Revision);
        Assert.Equal(shown.AuditEvents.Count + 1, after.AuditEvents.Count);
        Assert.Equal(operation, after.AuditEvents[^1].Action);
        Assert.Equal(writes + 1, store.WriteAttempts);
    }
}
