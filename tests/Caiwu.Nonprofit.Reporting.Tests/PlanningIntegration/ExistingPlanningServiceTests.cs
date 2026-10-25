using Caiwu.Contracts;
using Domain = Caiwu.Nonprofit;
using Reporting = Caiwu.Nonprofit.Reporting;

namespace Caiwu.Nonprofit.Reporting.PlanningIntegration.Tests;

public sealed class ExistingPlanningServiceTests
{
    [Fact]
    public void RealPlanningDonationExpenseClosingAndReleaseRemainPendingAndReconcileByClass()
    {
        var service=new Domain.NonprofitPlanningService();
        var book=new Guid("20260000-0000-0000-0000-000000000001");
        var evidence=new Domain.RestrictionEvidence("synthetic-A",1,"synthetic-project-A",Domain.RestrictionSourceKind.ExternalProvider,"synthetic-agreement",
            [new(Domain.RestrictionConditionKind.Purpose,"合成用途A")]);
        var tag=new Domain.Classification(Domain.RestrictionClass.Restricted,evidence.Id,evidence.Version,evidence.ProjectId);
        var start=service.CreateState(book,new(2026,6,1),new(2026,6,30),[evidence],[],42);
        var donated=service.SuggestDonation(start,new(Guid.NewGuid(),start.Revision,new(2026,6,1),1000,tag,Domain.DonationKind.Cash,"synthetic-recognition",true));
        var spent=service.SuggestExpense(donated.ProjectedState,new(Guid.NewGuid(),donated.ProjectedState.Revision,new(2026,6,2),"5101",300,tag,"synthetic-expense"));
        var closed=service.SuggestClosing(spent.ProjectedState,new(Guid.NewGuid(),spent.ProjectedState.Revision,new(2026,6,30)));
        var released=service.SuggestRelease(closed.ProjectedState,new(Guid.NewGuid(),closed.ProjectedState.Revision,new(2026,6,30),700,
            new(evidence.Id,evidence.Version,true,true,false,"synthetic-fully-released")));
        Assert.Empty(start.Balances);Assert.Equal(Domain.SuggestionStatus.PendingReview,released.Status);
        Assert.All(closed.ProjectedState.Balances.Where(b=>b.AccountCode is "4101" or "5101"),b=>Assert.Equal(0,b.NetDebit));
        var ctx=new Reporting.StatementContext(book,"合成待审投影",42,new(new(2026,6,1),new(2026,6,30),Reporting.ReportingPeriodKind.Monthly),
            new(2026,7,1,0,0,0,TimeSpan.Zero),Reporting.StatementSourceKind.PendingReviewProjection,"synthetic-projected-sequence",true);
        var movements=new List<Reporting.ActivityEntry>();
        foreach(var proposal in new[]{donated,spent,closed})
            foreach(var v in proposal.Vouchers)
                foreach(var line in v.Lines.Where(l=>l.AccountCode is "4101" or "5101"))
                    movements.Add(new(line.Id,v.Date,line.AccountCode=="4101"?Reporting.ActivityFact.DonationIncome:Reporting.ActivityFact.BusinessActivityCost,
                        line.AccountCode=="4101"?line.Credit-line.Debit:line.Debit-line.Credit,
                        new(Reporting.RestrictionClass.Restricted,evidence.Id,evidence.Version,evidence.ProjectId,Reporting.RestrictionSourceKind.ExternalProvider,evidence.EvidenceReference),
                        v.Kind==Domain.SuggestionKind.Closing?Reporting.ActivityEntryRole.IncomeExpenseClosing:Reporting.ActivityEntryRole.RecognizedMovement,
                        "synthetic-proposal-"+proposal.RequestId,line.AccountCode=="5101"?"A":null));
        var releaseVoucher=Assert.Single(released.Vouchers);var releaseLine=Assert.Single(releaseVoucher.Lines,l=>l.AccountCode=="3102");
        movements.Add(new(releaseLine.Id,releaseVoucher.Date,Reporting.ActivityFact.ReleaseToUnrestricted,releaseLine.Debit,
            new(Reporting.RestrictionClass.Restricted,evidence.Id,1,evidence.ProjectId,Reporting.RestrictionSourceKind.ExternalProvider,evidence.EvidenceReference),
            Reporting.ActivityEntryRole.RecognizedMovement,"synthetic-release-assessment-in-pending-proposal"));
        Reporting.ActivityWindowInput W(DateOnly from)=>new(from,new(2026,6,30),movements,Enum.GetValues<Reporting.ActivityFact>(),"synthetic-full-year-with-zero-prior-months",
            true,true,Reporting.FundraisingDisclosure.NotApplicableConfirmed);
        var activity=Reporting.NonprofitActivityStatement.Calculate(new(ctx,W(new(2026,6,1)),W(new(2026,1,1)),[new("A","合成A",Reporting.ActivityComponentKind.Project)]));
        Assert.Equal(Reporting.StatementStatus.PendingReviewProjection,activity.Status);
        Assert.Equal(1000,activity.Lines.Single(l=>l.Key=="donation").Values[1].Amount);
        Assert.Equal(300,activity.Lines.Single(l=>l.Key=="business-cost").Values[1].Amount);
        Assert.Equal(700,activity.Lines.Single(l=>l.Key=="net-change").Values[0].Amount);
        Assert.Equal(0,activity.Lines.Single(l=>l.Key=="net-change").Values[1].Amount);
        Reporting.BalanceColumnInput B(DateOnly date,bool final)=>new(date,Enum.GetValues<Reporting.BalanceFact>().Select(f=>
            new Reporting.BalanceFactValue(f,final ? f switch
            {
                Reporting.BalanceFact.BankDeposits => released.ProjectedState.Balances.Where(b=>b.AccountCode=="1002").Sum(b=>b.NetDebit),
                Reporting.BalanceFact.UnrestrictedNetAssets => -released.ProjectedState.Balances.Where(b=>b.AccountCode=="3101").Sum(b=>b.NetDebit),
                Reporting.BalanceFact.RestrictedNetAssets => -released.ProjectedState.Balances.Where(b=>b.AccountCode=="3102").Sum(b=>b.NetDebit),
                _ => 0m
            }:0m,"synthetic-explicit-zero-or-pending-balance")),Reporting.IncomeExpenseClosingState.ClosedAndReconciled,
            Reporting.YearOpeningBasis.Reviewed2026TransitionLedger,true,"synthetic-review-of-projected-calculation-only");
        var balance=Reporting.NonprofitBalanceSheet.Calculate(new(ctx,B(new(2026,1,1),false),B(new(2026,6,30),true)));
        var set=Reporting.NonprofitStatementReconciliation.Compare(balance,activity);set.RequireCompleteReconciliation();
        Assert.False(set.CanIssueAsFormal);Assert.False(activity.CanIssueAsFormal);
        Assert.Contains("待审假设投影",Reporting.NonprofitStatementExporter.ToCsv(activity),StringComparison.Ordinal);
    }

    [Fact]
    public void ExistingReportingAndNewIndependentDtoAndExportCanBeReferencedTogether()
    {
        var clock=new DateTimeOffset(2026,7,1,0,0,0,TimeSpan.Zero);
        var book=new BookInfo(Guid.NewGuid(),"合成民非",AccountingRegime.Nonprofit,"nonprofit-2026",2026,1,0,clock);
        var doc=Caiwu.Reporting.ReportBuilder.VoucherList(new(book,new(2026,6,1),new(2026,6,30),clock),[]);
        Assert.Contains("凭证清单",Caiwu.Reporting.ReportExporter.ToCsv(doc),StringComparison.Ordinal);
        var ctx=new Reporting.StatementContext(book.Id,book.Name,0,new(new(2026,6,1),new(2026,6,30),Reporting.ReportingPeriodKind.Monthly),clock,
            Reporting.StatementSourceKind.PostedLedger,"synthetic-gap-only",true);
        var missing=Reporting.NonprofitActivityStatement.Calculate(new(ctx,null,null));
        Assert.Equal(Reporting.StatementStatus.Incomplete,missing.Status);Assert.Contains("缺失",Reporting.NonprofitStatementExporter.ToCsv(missing),StringComparison.Ordinal);
    }
}
