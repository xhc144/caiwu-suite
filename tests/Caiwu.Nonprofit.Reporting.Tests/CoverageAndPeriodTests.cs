using Caiwu.Contracts;
using Caiwu.Nonprofit.Reporting;
using static Caiwu.Nonprofit.Reporting.Tests.SyntheticData;

namespace Caiwu.Nonprofit.Reporting.Tests;

public sealed class CoverageAndPeriodTests
{
    [Fact]
    public void AbsentBalanceFactPropagatesThroughTotals_ExplicitZeroDoesNot()
    {
        var input = BalanceInput();
        input = input with {Closing=Balances(input.Closing.Date,omit:BalanceFact.DedicatedAgencyAssets)};
        var r = NonprofitBalanceSheet.Calculate(input);
        Assert.Null(Value(r,"agency-assets").Amount);Assert.Null(Value(r,"assets.total").Amount);
        Assert.Equal(0m,Amount(r,"cash",1));Assert.Equal(0m,Amount(r,"current-assets.total",1));
        Assert.Throws<InvalidOperationException>(r.RequireCompleteCalculation);
        Assert.Contains(r.MissingReasons,x=>x.Path=="Closing.DedicatedAgencyAssets");
    }
    [Fact]
    public void UnknownOpeningBasisPreservesClosingButNeverSubstitutesPeriodOpening()
    {
        var input=BalanceInput();
        input=input with {YearOpening=Balances(new(2026,1,1),basis:YearOpeningBasis.Unknown)};
        var r=NonprofitBalanceSheet.Calculate(input);
        Assert.Null(Value(r,"cash",0).Amount);Assert.Equal(0m,Amount(r,"cash",1));
        Assert.Contains(r.MissingReasons,x=>x.Code=="NP_YEAR_OPENING");
        Assert.Throws<ArgumentException>(()=>NonprofitBalanceSheet.Calculate(input with {YearOpening=Balances(new(2026,6,1))}));
    }
    [Fact]
    public void NoBalanceEquationPlugAndUnreviewedMappingOrCurrencyStayIncomplete()
    {
        var input=BalanceInput(new Dictionary<BalanceFact,decimal>{[BalanceFact.BankDeposits]=1});
        var r=NonprofitBalanceSheet.Calculate(input);
        Assert.Equal(0m,Amount(r,"net-assets.total",1));Assert.Contains(r.MissingReasons,x=>x.Code=="NP_BALANCE_EQUATION");
        Assert.Equal(StatementStatus.Incomplete,r.Status);
        r=NonprofitBalanceSheet.Calculate(input with {Closing=Balances(new(2026,6,30),reviewed:false)});
        Assert.Contains(r.MissingReasons,x=>x.Code=="NP_MAPPING_REVIEW");
        var ctx=new StatementContext(BookId,"synthetic",42,Context().Period,Clock,StatementSourceKind.PostedLedger,"synthetic",false);
        r=NonprofitBalanceSheet.Calculate(input with {Context=ctx}); Assert.Null(Value(r,"cash").Amount);
        Assert.Contains(r.MissingReasons,x=>x.Code=="NP_CURRENCY");
    }
    [Fact]
    public void CurrentInvestmentImpairmentIsARealExplicitBlock_NotDoubleDeducted()
    {
        var facts=BalanceExampleA();facts[BalanceFact.DueWithinYearInvestmentAllowance]=30;
        var r=NonprofitBalanceSheet.Calculate(BalanceInput(facts));
        Assert.Equal(1170m,Amount(r,"investments-due",1));
        Assert.Null(Value(r,"long-debt").Amount);Assert.Null(Value(r,"assets.total").Amount);
        Assert.Contains(r.MissingReasons,x=>x.Code=="NP_MATURITY_IMPAIRMENT_REVIEW");
    }
    [Fact]
    public void MissingActivityCoverageAndMissingDimensionCannotProduceZeroTotals()
    {
        var ctx=Context();
        var current=Window(ctx.Period.From,ctx.Period.To,coverage:Enum.GetValues<ActivityFact>().Where(f=>f!=ActivityFact.DonationIncome));
        var r=NonprofitActivityStatement.Calculate(new(ctx,current,null,Components));
        Assert.Null(Value(r,"donation",0).Amount);Assert.Null(Value(r,"income.total",0).Amount);
        Assert.Equal(0m,Amount(r,"membership",0));Assert.Null(Value(r,"membership",3).Amount);
        Assert.Contains(r.MissingReasons,x=>x.Code=="NP_ACTIVITY_WINDOW");
        r=NonprofitActivityStatement.Calculate(Activity(ctx,[E(300,6,ActivityFact.DonationIncome,100,null)]));
        Assert.Null(Value(r,"donation",0).Amount);Assert.Null(Value(r,"donation",1).Amount);
        Assert.Null(Value(r,"donation",2).Amount);Assert.Contains(r.MissingReasons,x=>x.Code=="NP_CLASSIFICATION");
    }
    [Theory]
    [InlineData(RestrictionSourceKind.InternalBudget)]
    [InlineData((RestrictionSourceKind)999)]
    public void InternalBudgetsAndUnknownRestrictionSourceCannotMasqueradeAsRestricted(RestrictionSourceKind source)
    {
        var tag=R with {SourceKind=source};
        var r=NonprofitActivityStatement.Calculate(Activity(Context(),[E(310,6,ActivityFact.DonationIncome,100,tag)]));
        Assert.Null(Value(r,"donation",1).Amount);Assert.Contains(r.MissingReasons,x=>x.Code=="NP_CLASSIFICATION");
    }
    [Fact]
    public void ReleaseMustBeAnExplicitScopedMovement_NotAnUnrestrictedEntryOrExpense()
    {
        var r=NonprofitActivityStatement.Calculate(Activity(Context(),[E(320,6,ActivityFact.ReleaseToUnrestricted,10,U)]));
        Assert.Contains(r.MissingReasons,x=>x.Code=="NP_TRANSFER_SCOPE");Assert.Null(Value(r,"release",0).Amount);
        Assert.Throws<ArgumentException>(()=>Window(new(2026,6,1),new(2026,6,30),[E(321,6,ActivityFact.ReleaseToUnrestricted,-1,R)]));
        Assert.Throws<ArgumentException>(()=>Window(new(2026,6,1),new(2026,6,30),[E(322,6,ActivityFact.ReleaseToUnrestricted,1,R,role:ActivityEntryRole.IncomeExpenseClosing)]));
    }
    [Fact]
    public void MissingBusinessBreakdownAndUnreviewedRestrictedTaxAreExplicit()
    {
        var r=NonprofitActivityStatement.Calculate(Activity(Context(),[E(330,6,ActivityFact.BusinessActivityCost,100,R)]));
        Assert.Contains(r.MissingReasons,x=>x.Code=="NP_BUSINESS_BREAKDOWN");Assert.Null(Value(r,"expense.total",1).Amount);
        var tax=E(331,6,ActivityFact.IncomeTaxExpense,5,R);
        var input=Activity(Context(),[tax]);
        r=NonprofitActivityStatement.Calculate(input);Assert.Contains(r.MissingReasons,x=>x.Code=="NP_RESTRICTED_TAX_REVIEW");
        var c=Window(new(2026,6,1),new(2026,6,30),[tax],taxReviewed:true);
        var y=Window(new(2026,1,1),new(2026,6,30),[tax],taxReviewed:true);
        r=NonprofitActivityStatement.Calculate(new(Context(),c,y,Components));r.RequireCompleteCalculation();Assert.Equal(5m,Amount(r,"income-tax",1));
    }
    [Fact]
    public void CharityTrustAndFundraisingDetailsAreSubsets_NotExtraExpenses()
    {
        ActivityComponent[] details=[new("trust","合成慈善信托",ActivityComponentKind.CharitableTrustEstablishment),new("fund","合成募捐",ActivityComponentKind.FundraisingCost)];
        var entries=new[]{E(340,6,ActivityFact.BusinessActivityCost,100,R,"trust"),E(341,6,ActivityFact.FundraisingExpense,20,U,"fund"),E(342,6,ActivityFact.FundraisingExpense,10,U)};
        var c=Window(new(2026,6,1),new(2026,6,30),entries,fundraising:FundraisingDisclosure.RequiredAndClassified);
        var y=Window(new(2026,1,1),new(2026,6,30),entries,fundraising:FundraisingDisclosure.RequiredAndClassified);
        var r=NonprofitActivityStatement.Calculate(new(Context(),c,y,details));r.RequireCompleteCalculation();
        Assert.Equal(130m,Amount(r,"expense.total",2));Assert.Equal(100m,Amount(r,"component:trust",2));Assert.Equal(20m,Amount(r,"component:fund",2));
        Assert.Contains(r.Lines,x=>x.Label.Contains("设立慈善信托支出",StringComparison.Ordinal));
    }
    [Fact]
    public void PeriodMismatchDuplicateIdsAndOverlapContradictionsRejectWithoutFilteringAwayData()
    {
        var ctx=Context();var e=E(350,6,ActivityFact.DonationIncome,10,U);
        Assert.Throws<ArgumentException>(()=>Window(new(2026,6,1),new(2026,6,30),[e,e]));
        Assert.Throws<ArgumentException>(()=>Window(new(2026,5,1),new(2026,5,31),[e]));
        Assert.Throws<ArgumentException>(()=>NonprofitActivityStatement.Calculate(new(ctx,
            Window(new(2026,6,1),new(2026,6,30),[e]),Window(new(2026,1,1),new(2026,6,30),[e with {Amount=11}]))));
        Assert.Throws<ArgumentException>(()=>NonprofitActivityStatement.Calculate(new(ctx,null,Window(new(2026,6,1),new(2026,6,30)))));
        Assert.Throws<ArgumentException>(()=>new ReportingPeriod(new(2025,1,1),new(2025,1,31),ReportingPeriodKind.Monthly));
        Assert.Throws<ArgumentException>(()=>new ReportingPeriod(new(2026,2,1),new(2026,4,30),ReportingPeriodKind.Quarterly));
    }
    [Fact]
    public void QuarterAndHalfYearLabelsAndCumulativeAreDistinct()
    {
        foreach(var period in new[]{new ReportingPeriod(new(2026,4,1),new(2026,6,30),ReportingPeriodKind.Quarterly),new ReportingPeriod(new(2026,7,1),new(2026,12,31),ReportingPeriodKind.HalfYearly)})
        {
            var ctx=new StatementContext(BookId,"合成",42,period,Clock,StatementSourceKind.PostedLedger,"synthetic",true);
            var entries=new[]{E(360,1,ActivityFact.DonationIncome,10,U),E(361,period.From.Month,ActivityFact.DonationIncome,20,U)};
            var r=NonprofitActivityStatement.Calculate(Activity(ctx,entries));
            Assert.Equal(20m,Amount(r,"donation",0));Assert.Equal(30m,Amount(r,"donation",3));
            Assert.StartsWith(period.CurrentLabel,r.Columns[0].Label,StringComparison.Ordinal);
        }
    }
    [Fact]
    public void Annual2026IsAnnualAndPriorComparisonNotRequiredNotZero_2027RequiresIt()
    {
        var ctx=Context(kind:ReportingPeriodKind.Annual);
        var r=NonprofitActivityStatement.Calculate(new(ctx,null,Window(new(2026,1,1),new(2026,12,31)),Components));
        r.RequireCompleteCalculation();Assert.Equal(3,r.Columns.Count);Assert.Equal(ComparativeState.NotRequiredOn2026FirstAdoption,r.ComparativeState);
        Assert.DoesNotContain(r.Columns,x=>x.Label.Contains("本月",StringComparison.Ordinal));
        var next=Context(year:2027,kind:ReportingPeriodKind.Annual);
        r=NonprofitActivityStatement.Calculate(new(next,null,Window(new(2027,1,1),new(2027,12,31)),Components));
        Assert.Equal(4,r.Columns.Count);Assert.Equal(ComparativeState.Missing,r.ComparativeState);Assert.Null(Value(r,"donation",3).Amount);
        Assert.Contains(r.MissingReasons,x=>x.Code=="NP_COMPARATIVE");
        r=NonprofitActivityStatement.Calculate(new(next,null,Window(new(2027,1,1),new(2027,12,31)),Components,
            Window(new(2026,1,1),new(2026,12,31),[E(362,5,ActivityFact.DonationIncome,50,U)])));
        r.RequireCompleteCalculation();Assert.Equal(50m,Amount(r,"donation",3));
    }
    [Fact]
    public void PendingProjectionAndFrozenCollectionsNeverBecomePostedOrFormal()
    {
        var entries=new List<ActivityEntry>{E(370,6,ActivityFact.DonationIncome,10,U)};
        var r=NonprofitActivityStatement.Calculate(Activity(Context(source:StatementSourceKind.PendingReviewProjection),entries));
        entries.Clear();Assert.Equal(10m,Amount(r,"donation",0));Assert.Equal(StatementStatus.PendingReviewProjection,r.Status);Assert.False(r.CanIssueAsFormal);
        Assert.Throws<InvalidOperationException>(()=>NonprofitStatementExporter.ToCsv(r,StatementExportPurpose.FormalReport));
    }
    [Fact]
    public void V1LedgerSnapshotGapAnalyzerNeverPretendsToSupplyMissingClassifications()
    {
        var snapshot=new LedgerSnapshot(42,new(BookId,"synthetic",AccountingRegime.Nonprofit,"nonprofit-2026",2026,1,0,Clock),[],[],[]);
        var issues=LedgerSnapshotGapAnalyzer.Analyze(snapshot);
        Assert.Contains(issues,x=>x.Code=="NP_DIMENSIONS");Assert.Contains(issues,x=>x.Code=="NP_MOVEMENT_ROLES");Assert.Contains(issues,x=>x.Code=="NP_BALANCE_ANALYSIS");
    }
}
