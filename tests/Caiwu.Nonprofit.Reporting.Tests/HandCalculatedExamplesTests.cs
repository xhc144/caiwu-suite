using Caiwu.Nonprofit.Reporting;
using static Caiwu.Nonprofit.Reporting.Tests.SyntheticData;

namespace Caiwu.Nonprofit.Reporting.Tests;

public sealed class HandCalculatedExamplesTests
{
    [Fact]
    public void ExampleA_ActivityTwoClassesCurrentAndYtd_HandTotals()
    {
        var r = NonprofitActivityStatement.Calculate(Activity(Context(), ExampleA()));
        r.RequireCompleteCalculation();
        Assert.Equal(StatementStatus.CalculatedPreview, r.Status);
        Assert.Equal(1375m, Amount(r,"income.total",0)); Assert.Equal(2500m,Amount(r,"income.total",1)); Assert.Equal(3875m,Amount(r,"income.total",2));
        Assert.Equal(340m,Amount(r,"expense.total",0)); Assert.Equal(675m,Amount(r,"expense.total",1)); Assert.Equal(1015m,Amount(r,"expense.total",2));
        Assert.Equal(1105m,Amount(r,"net-change",0)); Assert.Equal(1760m,Amount(r,"net-change",1)); Assert.Equal(2865m,Amount(r,"net-change",2));
        Assert.Equal(1205m,Amount(r,"net-change",3)); Assert.Equal(2010m,Amount(r,"net-change",4)); Assert.Equal(3215m,Amount(r,"net-change",5));
        Assert.Equal(800m,Amount(r,"component:project-A",2));
        Assert.All(r.Lines,l=>Assert.Null(l.OfficialRowNumber));
        Assert.False(r.CanIssueAsFormal); Assert.Throws<InvalidOperationException>(r.RequireFormalReport);
    }

    [Fact]
    public void ExampleA_BalanceSheetMaturityAgencyContraAndNetAssets_HandTotals()
    {
        var r = NonprofitBalanceSheet.Calculate(BalanceInput(BalanceExampleA()));
        r.RequireCompleteCalculation();
        Assert.Equal(10000m,Amount(r,"cash",1)); Assert.Equal(950m,Amount(r,"short-investments",1));
        Assert.Equal(1000m,Amount(r,"receivables",1)); Assert.Equal(1200m,Amount(r,"investments-due",1));
        Assert.Equal(14200m,Amount(r,"current-assets.total",1)); Assert.Equal(6450m,Amount(r,"long-investments.total",1));
        Assert.Equal(3400m,Amount(r,"fixed.net",1)); Assert.Equal(3560m,Amount(r,"fixed.total",1));
        Assert.Equal(880m,Amount(r,"intangible.net",1)); Assert.Equal(11220m,Amount(r,"noncurrent-assets.total",1));
        Assert.Equal(700m,Amount(r,"agency-assets",1)); Assert.Equal(26120m,Amount(r,"assets.total",1));
        Assert.Equal(3250m,Amount(r,"current-liabilities.total",1)); Assert.Equal(4650m,Amount(r,"long-liabilities.total",1));
        Assert.Equal(8600m,Amount(r,"liabilities.total",1)); Assert.Equal(17520m,Amount(r,"net-assets.total",1));
        Assert.Equal(26120m,Amount(r,"liabilities-net-assets.total",1));
        Assert.Equal(10000m,Amount(r,"assets.total",0)); Assert.Equal(6000m,Amount(r,"net-assets.unrestricted",0)); Assert.Equal(4000m,Amount(r,"net-assets.restricted",0));
    }

    [Fact]
    public void ExampleB_ActivityNegativeIncomeRefundsImpairmentReversalAndExactCents_HandTotals()
    {
        ActivityEntry[] entries =
        [
            E(101,1,ActivityFact.DonationIncome,50,R),E(102,1,ActivityFact.AdministrationExpense,2,U),
            E(110,2,ActivityFact.DonationIncome,0.1m,U),E(111,2,ActivityFact.DonationIncome,0.2m,U),
            E(112,2,ActivityFact.ServiceIncome,500,R),E(113,2,ActivityFact.InvestmentIncome,-120,U),E(114,2,ActivityFact.OtherIncome,20,U),
            E(115,2,ActivityFact.BusinessActivityCost,15,U,"project-A"),E(116,2,ActivityFact.BusinessActivityCost,20,R,"project-A"),
            E(117,2,ActivityFact.TaxesAndSurcharges,-2,U),E(118,2,ActivityFact.AdministrationExpense,10,U),E(119,2,ActivityFact.AdministrationExpense,3,R),
            E(120,2,ActivityFact.FundraisingExpense,1.25m,U),E(121,2,ActivityFact.AssetImpairmentLoss,-4,U),E(122,2,ActivityFact.AssetImpairmentLoss,2,R),
            E(123,2,ActivityFact.IncomeTaxExpense,5,U),E(124,2,ActivityFact.OtherExpense,0.5m,R),
            E(125,2,ActivityFact.ReleaseToUnrestricted,30,R),E(126,2,ActivityFact.TransferToRestricted,12,R),
            E(127,2,ActivityFact.PriorYearNetAssetAdjustment,7,U),E(128,2,ActivityFact.PriorYearNetAssetAdjustment,-4,R)
        ];
        var r = NonprofitActivityStatement.Calculate(Activity(Context(2),entries));
        r.RequireCompleteCalculation();
        Assert.Equal(0.30m,Amount(r,"donation",0)); Assert.Equal(-99.70m,Amount(r,"income.total",0));
        Assert.Equal(25.25m,Amount(r,"expense.total",0));Assert.Equal(25.50m,Amount(r,"expense.total",1));
        Assert.Equal(-99.95m,Amount(r,"net-change",0));Assert.Equal(452.50m,Amount(r,"net-change",1));Assert.Equal(352.55m,Amount(r,"net-change",2));
        Assert.Equal(-101.95m,Amount(r,"net-change",3));Assert.Equal(502.50m,Amount(r,"net-change",4));Assert.Equal(400.55m,Amount(r,"net-change",5));
    }

    [Fact]
    public void ExampleB_BalanceSheetSignedDisposalPayablesAndNegativeUnrestrictedNetAssets_HandTotals()
    {
        var r = NonprofitBalanceSheet.Calculate(BalanceInput(new Dictionary<BalanceFact,decimal>
        {
            [BalanceFact.BankDeposits]=100,[BalanceFact.FixedAssetDisposal]=-20,[BalanceFact.HeritageResources]=1,
            [BalanceFact.IntangibleAssetCost]=500,[BalanceFact.AccumulatedAmortization]=200,[BalanceFact.IntangibleAssetImpairment]=50,
            [BalanceFact.EmployeeBenefitsPayable]=-10,[BalanceFact.TaxesPayable]=-5,
            [BalanceFact.UnrestrictedNetAssets]=-154,[BalanceFact.RestrictedNetAssets]=500
        }));
        r.RequireCompleteCalculation(); Assert.Equal(331m,Amount(r,"assets.total",1));
        Assert.Equal(-15m,Amount(r,"liabilities.total",1));Assert.Equal(346m,Amount(r,"net-assets.total",1));
        Assert.Equal(-154m,Amount(r,"net-assets.unrestricted",1));Assert.Equal(331m,Amount(r,"liabilities-net-assets.total",1));
    }

    [Fact]
    public void ClassifiedExpenseClosingAndRelease_AgreeWithBeforeAfterNetAssetsWithoutAutoRelease()
    {
        var entries = new[] {E(201,6,ActivityFact.DonationIncome,1000,R),E(202,6,ActivityFact.BusinessActivityCost,300,R,"project-A")};
        var before = NonprofitActivityStatement.Calculate(Activity(Context(),entries));
        Assert.Equal(700m,Amount(before,"net-change",1));Assert.Equal(0m,Amount(before,"release",0));
        var after = NonprofitActivityStatement.Calculate(Activity(Context(),entries.Concat([
            E(203,6,ActivityFact.DonationIncome,-1000,R,role:ActivityEntryRole.IncomeExpenseClosing),
            E(204,6,ActivityFact.BusinessActivityCost,-300,R,"project-A",ActivityEntryRole.IncomeExpenseClosing),
            E(205,6,ActivityFact.ReleaseToUnrestricted,700,R)])));
        Assert.Equal(1000m,Amount(after,"donation",1));Assert.Equal(300m,Amount(after,"business-cost",1));
        Assert.Equal(700m,Amount(after,"net-change",0));Assert.Equal(0m,Amount(after,"net-change",1));Assert.Equal(0m,Amount(after,"release",2));
        var unclosed = NonprofitBalanceSheet.Calculate(BalanceInput(new Dictionary<BalanceFact,decimal>{[BalanceFact.BankDeposits]=700},IncomeExpenseClosingState.NotClosed));
        Assert.Null(Value(unclosed,"net-assets.total").Amount);Assert.Contains(unclosed.MissingReasons,x=>x.Code=="NP_UNCLOSED_PL");
        var closed = NonprofitBalanceSheet.Calculate(BalanceInput(new Dictionary<BalanceFact,decimal>{[BalanceFact.BankDeposits]=700,[BalanceFact.UnrestrictedNetAssets]=700}));
        closed.RequireCompleteCalculation(); Assert.Equal(700m,Amount(closed,"net-assets.unrestricted",1));Assert.Equal(0m,Amount(closed,"net-assets.restricted",1));
    }
}
