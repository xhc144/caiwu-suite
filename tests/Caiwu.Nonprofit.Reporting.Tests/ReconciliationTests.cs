using Caiwu.Nonprofit.Reporting;
using static Caiwu.Nonprofit.Reporting.Tests.SyntheticData;

namespace Caiwu.Nonprofit.Reporting.Tests;

public sealed class ReconciliationTests
{
    [Fact]
    public void ExampleA_ReconcilesYtdRatherThanJuneToYearOpeningForBothClasses()
    {
        var activity=NonprofitActivityStatement.Calculate(Activity(Context(),ExampleA()));
        // Independent hand result: opening U6000/R4000 + YTD U1205/R2010 = U7205/R6010.
        var balance=NonprofitBalanceSheet.Calculate(BalanceInput(new Dictionary<BalanceFact,decimal>
        {[BalanceFact.BankDeposits]=13215,[BalanceFact.UnrestrictedNetAssets]=7205,[BalanceFact.RestrictedNetAssets]=6010}));
        var set=NonprofitStatementReconciliation.Compare(balance,activity);
        set.RequireCompleteReconciliation();Assert.True(set.HasCompleteReconciledCalculations);Assert.False(set.CanIssueAsFormal);
        var wrong=NonprofitBalanceSheet.Calculate(BalanceInput(new Dictionary<BalanceFact,decimal>
        {[BalanceFact.BankDeposits]=12865,[BalanceFact.UnrestrictedNetAssets]=7105,[BalanceFact.RestrictedNetAssets]=5760}));
        set=NonprofitStatementReconciliation.Compare(wrong,activity);
        Assert.Contains(set.Issues,x=>x.Code=="NP_NET_ASSET_RECONCILIATION");Assert.Throws<InvalidOperationException>(set.RequireCompleteReconciliation);
    }
    [Fact]
    public void WrongBookRevisionAndPostedVersusPendingCannotBeCombined()
    {
        var b=NonprofitBalanceSheet.Calculate(BalanceInput());
        var ctx=new StatementContext(BookId,"synthetic",43,Context().Period,Clock,StatementSourceKind.PostedLedger,"synthetic-ledger-revision-42",true);
        var a=NonprofitActivityStatement.Calculate(Activity(ctx,[]));
        Assert.Throws<ArgumentException>(()=>NonprofitStatementReconciliation.Compare(b,a));
        a=NonprofitActivityStatement.Calculate(Activity(Context(source:StatementSourceKind.PendingReviewProjection),[]));
        Assert.Throws<ArgumentException>(()=>NonprofitStatementReconciliation.Compare(b,a));
    }
    [Fact]
    public void UnsupportedKnownSourceFactsRemainAnExplicitBlockEvenWhenAllAmountsNumeric()
    {
        var ctx=new StatementContext(BookId,"synthetic",42,Context().Period,Clock,StatementSourceKind.PostedLedger,"synthetic",true,
            [new("NP_DIRECT_CAPITAL_UNSUPPORTED","registered-capital","存在直接投入注册资金，本版业务活动表未实现其列报分析。")]);
        var r=NonprofitActivityStatement.Calculate(Activity(ctx,[]));
        Assert.All(r.Lines.SelectMany(l=>l.Values),v=>Assert.NotNull(v.Amount));
        Assert.Equal(StatementStatus.Incomplete,r.Status);Assert.Throws<InvalidOperationException>(r.RequireCompleteCalculation);
        Assert.Contains("NP_DIRECT_CAPITAL_UNSUPPORTED",NonprofitStatementExporter.ToCsv(r),StringComparison.Ordinal);
    }
    [Fact]
    public void NegativeAllowancesAndImpossibleMaturitySplitsCannotBeComplete()
    {
        var f=BalanceExampleA();f[BalanceFact.LongDebtDueWithinYear]=6000;
        var r=NonprofitBalanceSheet.Calculate(BalanceInput(f));
        Assert.Contains(r.MissingReasons,x=>x.Code=="NP_BALANCE_ANALYSIS");Assert.Null(Value(r,"long-debt").Amount);
        f=BalanceExampleA();f[BalanceFact.AccumulatedDepreciation]=-1;
        r=NonprofitBalanceSheet.Calculate(BalanceInput(f));Assert.Null(Value(r,"fixed.net").Amount);
    }
    [Fact]
    public void NonDisplayedIntermediateGrossSumsDoNotCauseOrderDependentFalseOverflow()
    {
        const decimal max=92233720368547758.07m;
        // max+1 gross less allowance1 = max; the non-displayed gross is not a money field.
        var facts=new Dictionary<BalanceFact,decimal>
        {[BalanceFact.NotesReceivable]=max,[BalanceFact.AccountsReceivable]=1,[BalanceFact.BadDebtAllowance]=1,[BalanceFact.UnrestrictedNetAssets]=max};
        var r=NonprofitBalanceSheet.Calculate(BalanceInput(facts));r.RequireCompleteCalculation();Assert.Equal(max,Amount(r,"receivables",1));
    }
}
