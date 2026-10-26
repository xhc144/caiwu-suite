using Caiwu.Contracts;
using Caiwu.Core;
using static Caiwu.AccountingExtensions.Tests.SyntheticFixture;

namespace Caiwu.AccountingExtensions.Tests;

public sealed class MonthlyTransferTests
{
    [Fact]
    public void CannotTransferAnEarlierMonthAfterALaterTransferHasPosted()
    {
        using var f = new SyntheticFixture();
        var state = State() with { Vouchers = [Receipt(amount: 100)] };
        using var store = new SyntheticMemoryStore(state);
        var service = f.Service(store);
        var core = new LedgerService(store);
        void ReviewAndPost(Voucher voucher)
        {
            core.Review(voucher.Id, f.Reviewer.Identity.ActorKey, Context(store.State));
            core.Post(voucher.Id, f.Reviewer.Identity.ActorKey, Context(store.State));
        }

        ReviewAndPost(service.GenerateMonthlyTransfer(Transfer(store.State, 2)));
        var before = store.State;
        Voucher? duplicate = null;
        var error = Record.Exception(() => duplicate = service.GenerateMonthlyTransfer(Transfer(store.State, 1)));
        if (duplicate is not null)
        {
            ReviewAndPost(duplicate);
            var rows = core.GetTrialBalance(new(2026, 1, 1), new(2026, 2, 28));
            Assert.Fail($"倒序结转未拒绝，实跑收入借方余额={rows.Single(r => r.AccountCode == "6001").ClosingDebit}，利润贷方余额={rows.Single(r => r.AccountCode == "4103").ClosingCredit}");
        }
        Assert.IsType<LedgerValidationException>(error);
        Assert.Same(before, store.State);
    }

    [Fact]
    public void IncomeAndExpensePlanUsesActualBalancesAndIsReadOnly()
    {
        var state = State() with { Vouchers = [Receipt(), Expense()] };
        var plan = MonthlyTransferPlanner.CreatePlan(state, Transfer(state));
        Assert.Equal(new DateOnly(2026, 1, 31), plan.Date);
        Assert.Equal(1000, plan.DebitTotal); Assert.Equal(1000, plan.CreditTotal);
        Assert.Equal(1000, plan.Lines.Single(l => l.AccountCode == "6001").Debit);
        Assert.Equal(250, plan.Lines.Single(l => l.AccountCode == "6602").Credit);
        Assert.Equal(750, plan.Lines.Single(l => l.AccountCode == "4103").Credit);
        Assert.Throws<NotSupportedException>(() => ((IList<VoucherLine>)plan.Lines).Clear());
        Assert.Throws<NotSupportedException>(() => ((IList<string>)plan.Definition.SourceAccountCodes).Clear());
        Assert.Equal(0, state.Revision); Assert.Empty(state.AuditEvents);
    }

    [Fact]
    public void PlanIncludesOpeningAndUntransferredPreviousPeriod()
    {
        var state = State() with { Vouchers = [Receipt(), Expense(), Receipt(2, 200)] };
        state = state with { Accounts = state.Accounts.Select(a => a.Code switch
        {
            "1001" => a with { OpeningDebit = 50 }, "6001" => a with { OpeningCredit = 50 }, _ => a
        }).ToArray() };
        var plan = MonthlyTransferPlanner.CreatePlan(state, Transfer(state, 2));
        Assert.Equal(1250, plan.Lines.Single(l => l.AccountCode == "6001").Debit);
        Assert.Equal(1000, plan.Lines.Single(l => l.AccountCode == "4103").Credit);
    }

    [Theory]
    [InlineData(VoucherStatus.Posted)]
    [InlineData(VoucherStatus.Reviewed)]
    [InlineData(VoucherStatus.Draft)]
    public void LaterAffectedVouchersBlockBackdatedTransferInEveryStatus(VoucherStatus status)
    {
        var state = State() with { Vouchers = [Receipt(), Receipt(2, status: status)] };
        Assert.Throws<LedgerValidationException>(() => MonthlyTransferPlanner.CreatePlan(state, Transfer(state)));
    }

    [Fact]
    public void FutureUnrelatedAccountsDoNotPreventTransfer()
    {
        var state = State();
        var liability = new Account("2001", "合成借款", null, BalanceDirection.Credit, true, 0, 0);
        var future = Receipt(2) with { Lines = [new("1001", "合成借款", 500, 0), new("2001", "合成借款", 0, 500)] };
        state = state with { Accounts = state.Accounts.Append(liability).ToArray(), Vouchers = [Receipt(), Expense(), future] };
        Assert.Equal(750, MonthlyTransferPlanner.CreatePlan(state, Transfer(state)).Lines.Single(l => l.AccountCode == "4103").Credit);
    }

    [Theory]
    [InlineData(100, 250, 150, 0)]
    [InlineData(250, 250, 0, 0)]
    [InlineData(500, 250, 0, 250)]
    public void LossBreakEvenAndProfitUseCorrectTargetDirection(int income, int expense, int targetDebit, int targetCredit)
    {
        var state = State() with { Vouchers = [Receipt(amount: income), Expense(amount: expense)] };
        var plan = MonthlyTransferPlanner.CreatePlan(state, Transfer(state));
        var target = plan.Lines.SingleOrDefault(l => l.AccountCode == "4103");
        Assert.Equal(targetDebit, target?.Debit ?? 0); Assert.Equal(targetCredit, target?.Credit ?? 0);
        Assert.Equal(targetDebit == 0 && targetCredit == 0 ? 2 : 3, plan.Lines.Count);
        Assert.Equal(plan.DebitTotal, plan.CreditTotal);
    }

    [Theory]
    [InlineData("closed")]
    [InlineData("unposted")]
    [InlineData("earlier-unposted")]
    [InlineData("empty")]
    [InlineData("duplicate-source")]
    [InlineData("source-target")]
    [InlineData("inactive")]
    [InlineData("foreign-year")]
    [InlineData("unbalanced-opening")]
    public void UnsafePlansCannotGenerateAnyDraft(string kind)
    {
        using var f = new SyntheticFixture();
        var state = State() with { Vouchers = [Receipt(), Expense()] };
        var request = Transfer(state);
        switch (kind)
        {
            case "closed": state = state with { Book = state.Book with { ClosedThroughMonth = 1 } }; break;
            case "unposted": state = state with { Vouchers = [Receipt(status: VoucherStatus.Reviewed)] }; break;
            case "earlier-unposted":
                state = state with { Vouchers = [Receipt(status: VoucherStatus.Draft), Receipt(2)] };
                request = request with { Month = 2 }; break;
            case "empty": state = state with { Vouchers = [] }; break;
            case "duplicate-source": request = request with { Definition = request.Definition with { SourceAccountCodes = ["6001", "6001"] } }; break;
            case "source-target": request = request with { Definition = request.Definition with { DestinationAccountCode = "6001" } }; break;
            case "inactive": state = state with { Accounts = state.Accounts.Select(a => a.Code == "4103" ? a with { IsActive = false } : a).ToArray() }; break;
            case "foreign-year": request = request with { FiscalYear = 2025 }; break;
            case "unbalanced-opening": state = state with { Accounts = state.Accounts.Select(a => a.Code == "1001" ? a with { OpeningDebit = 1 } : a).ToArray() }; break;
        }
        using var store = new SyntheticMemoryStore(state);
        Assert.Throws<LedgerValidationException>(() => f.Service(store).GenerateMonthlyTransfer(request));
        Assert.Equal(0, store.Attempts); Assert.Same(state, store.State);
    }

    [Fact]
    public void ActualCoreDraftReviewPostingClearsSourcesWithoutAutomaticReviewOrDuplicate()
    {
        using var f = new SyntheticFixture();
        var state = State() with { Vouchers = [Receipt(), Expense()] };
        using var store = new SyntheticMemoryStore(state);
        var service = f.Service(store);
        var draft = service.GenerateMonthlyTransfer(Transfer(state));
        Assert.Equal(VoucherStatus.Draft, draft.Status); Assert.Null(draft.ReviewedBy);
        Assert.Equal(f.Worker.Identity.ActorKey, draft.PreparedBy);
        Assert.Equal(1, store.Writes); Assert.Equal(1, store.State.Revision);
        var core = new LedgerService(store);
        var beforeReview = Context(store.State);
        f.Operators.ExecuteReview(f.Reviewer, draft.PreparedBy, actor =>
        {
            core.Review(draft.Id, actor.ActorKey, beforeReview); return true;
        });
        core.Post(draft.Id, f.Reviewer.Identity.ActorKey, Context(store.State));
        var rows = core.GetTrialBalance(new(2026, 1, 1), new(2026, 1, 31));
        Assert.All(rows.Where(r => r.AccountCode is "6001" or "6602"), r =>
        {
            Assert.Equal(0, r.ClosingDebit); Assert.Equal(0, r.ClosingCredit);
        });
        Assert.Equal(750, rows.Single(r => r.AccountCode == "4103").ClosingCredit);
        Assert.Throws<LedgerValidationException>(() => service.GenerateMonthlyTransfer(Transfer(store.State)));
        Assert.Equal(3, store.Writes);
    }

    [Fact]
    public void SavedDraftBlocksDuplicateAndOldContextCannotBeRefreshedSilently()
    {
        using var f = new SyntheticFixture();
        var state = State() with { Vouchers = [Receipt(), Expense()] };
        using var store = new SyntheticMemoryStore(state);
        var service = f.Service(store);
        var request = Transfer(state);
        service.GenerateMonthlyTransfer(request);
        Assert.Throws<StoreConcurrencyException>(() => service.GenerateMonthlyTransfer(request));
        Assert.Throws<LedgerValidationException>(() => service.GenerateMonthlyTransfer(Transfer(store.State)));
        Assert.Equal(1, store.Writes); Assert.Equal(3, store.State.Vouchers.Count);
    }

    [Fact]
    public void ConcurrentChangeBetweenPlanningAndCoreSaveCannotPersistStalePlan()
    {
        using var f = new SyntheticFixture();
        var state = State() with { Vouchers = [Receipt(), Expense()] };
        using var store = new SyntheticMemoryStore(state);
        store.AfterRead = () => store.State = state with { Revision = 1 };
        Assert.Throws<StoreConcurrencyException>(() => f.Service(store).GenerateMonthlyTransfer(Transfer(state)));
        Assert.Equal(0, store.Writes); Assert.Equal(0, store.Attempts); Assert.Empty(store.State.AuditEvents);
    }

    [Fact]
    public void RuleInputsAreCopiedSoPreviewCannotChangeAfterCreation()
    {
        var state = State() with { Vouchers = [Receipt(), Expense()] };
        var sources = new List<string> { "6001", "6602" };
        var request = Transfer(state);
        request = request with { Definition = request.Definition with { SourceAccountCodes = sources } };
        var plan = MonthlyTransferPlanner.CreatePlan(state, request);
        sources.Clear();
        Assert.Equal(2, plan.Definition.SourceAccountCodes.Count); Assert.Equal(3, plan.Lines.Count);
    }
}
