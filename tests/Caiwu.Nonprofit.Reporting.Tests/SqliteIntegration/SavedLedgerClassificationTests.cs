using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Persistence.Sqlite;
using Caiwu.Nonprofit.Reporting;

namespace Caiwu.Nonprofit.Reporting.SqliteIntegration.Tests;

public sealed class SavedLedgerClassificationTests
{
    private static readonly DateTimeOffset Clock=new(2026,7,1,0,0,0,TimeSpan.Zero);
    private static readonly ReportingPeriod Period=new(new(2026,6,1),new(2026,6,30),ReportingPeriodKind.Monthly);
    private static RestrictionTag U=>new(RestrictionClass.Unrestricted);
    private static RestrictionTag R(string id)=>new(RestrictionClass.Restricted,id,1,"synthetic-project-"+id,RestrictionSourceKind.ExternalProvider,"synthetic-agreement-"+id);
    [Fact]
    public void SavedSqliteLedger_ExplicitClassification_TwoStatements_JsonAndExports_RevisionChangeInvalidates()
    {
        using var f=new Fixture();
        var original=f.Store.Read();var blank=LedgerClassificationDraft.Create(original,Period,Clock);
        var unknown=new LedgerSnapshotStatementDataSource(f.Store.Read,blank).CalculatePreview(Clock);
        Assert.False(unknown.HasCompleteReconciledCalculations);Assert.Null(Value(unknown.ActivityStatement,"donation",1));
        var manifest=f.Classified();var json=new ClassificationJsonStore(Path.Combine(f.Root,"user-data"));
        var file=json.SaveNew("reviewed.json",manifest);var bytes=File.ReadAllBytes(file);
        Assert.Throws<IOException>(()=>json.SaveNew("reviewed.json",manifest));Assert.Equal(bytes,File.ReadAllBytes(file));
        f.Reopen();
        var loaded=json.Load("reviewed.json",f.Store.Read());
        var source=new LedgerSnapshotStatementDataSource(f.Store.Read,loaded);
        var bound=source.CreateBoundPreview(Clock);var ctx=source.CreateContext(Clock);
        var pair=NonprofitStatementReconciliation.Compare(NonprofitBalanceSheet.Calculate(source.ReadBalanceSheet(ctx)),NonprofitActivityStatement.Calculate(source.ReadActivityStatement(ctx)));
        pair.RequireCompleteReconciliation();Assert.True(source.Validate().IsValid);
        Assert.Equal(1000m,Value(pair.ActivityStatement,"donation",1));Assert.Equal(300m,Value(pair.ActivityStatement,"business-cost",1));
        Assert.Equal(200m,Value(pair.ActivityStatement,"release",0));Assert.Equal(-200m,Value(pair.ActivityStatement,"release",1));
        Assert.Equal(-50m,Value(pair.ActivityStatement,"designation",0));Assert.Equal(50m,Value(pair.ActivityStatement,"designation",1));
        Assert.Equal(150m,Value(pair.ActivityStatement,"net-change",0));Assert.Equal(550m,Value(pair.ActivityStatement,"net-change",1));
        Assert.Equal(700m,Value(pair.BalanceSheet,"cash",1));Assert.Equal(150m,Value(pair.BalanceSheet,"net-assets.unrestricted",1));Assert.Equal(550m,Value(pair.BalanceSheet,"net-assets.restricted",1));
        Assert.False(pair.CanIssueAsFormal);
        var csvPath=Path.Combine(f.Root,"activity.csv");var htmlPath=Path.Combine(f.Root,"balance.html");
        using(var output=File.Create(csvPath))NonprofitStatementExporter.WriteCsv(pair.ActivityStatement,output);
        using(var output=File.Create(htmlPath))NonprofitStatementExporter.WriteHtml(pair.BalanceSheet,output);
        Assert.Contains("700.00",File.ReadAllText(htmlPath),StringComparison.Ordinal);Assert.Contains("150.00",File.ReadAllText(csvPath),StringComparison.Ordinal);
        var service=new LedgerService(f.Store);service.SaveDraft(new(null,new(2026,6,25),"变更",null,0,[new("1002","即使只是草稿，也须重核来源",1,0),new("4101","摘要称限定但不作分类依据",0,1)]),"synthetic-maker");
        Assert.Throws<ClassificationStaleException>(source.RequireCurrentSource);
        using var staleExport=new MemoryStream();Assert.Throws<ClassificationStaleException>(()=>bound.WriteCsv(NonprofitStatementForm.ActivityStatement,staleExport));Assert.Equal(0,staleExport.Length);
        Assert.Throws<ClassificationStaleException>(()=>source.ReadActivityStatement(ctx));
        Assert.Throws<ClassificationStaleException>(()=>json.Load("reviewed.json",f.Store.Read()));
        Assert.Equal(bytes,File.ReadAllBytes(file)); // Old review stays available; no silent rebind or overwrite.
    }
    [Fact]
    public void UnclosedProfitLossRemainsMissingAndSpendingNeverAutoReleases()
    {
        using var f=new Fixture(includeClosingAndTransfers:false);var source=new LedgerSnapshotStatementDataSource(f.Store.Read,f.Classified());
        var pair=source.CalculatePreview(Clock);
        Assert.Equal(1000m,Value(pair.ActivityStatement,"donation",1));Assert.Equal(300m,Value(pair.ActivityStatement,"business-cost",1));Assert.Equal(0m,Value(pair.ActivityStatement,"release",0));
        Assert.Null(Value(pair.BalanceSheet,"net-assets.restricted",1));Assert.Contains(pair.Issues,i=>i.Code=="NP_UNCLOSED_PL");
    }
    [Fact]
    public void ReorderedOrChangedLineContentCannotReuseOldPositionalClassificationEvenIfRevisionSpoofed()
    {
        using var f=new Fixture();var snapshot=f.Store.Read();var m=f.Classified();
        var v=snapshot.Vouchers[0];var changed=snapshot with{Vouchers=snapshot.Vouchers.Select(x=>x.Id==v.Id?x with{Lines=x.Lines.Reverse().ToArray()}:x).ToArray()};
        Assert.Throws<ClassificationStaleException>(()=>new LedgerSnapshotStatementDataSource(()=>changed,m));
        var bad=m with{Lines=m.Lines.Select((l,i)=>i==0?l with{Source=l.Source with{ContentSha256=new string('a',64)}}:l).ToArray()};
        Assert.Throws<ClassificationStaleException>(()=>new LedgerSnapshotStatementDataSource(()=>snapshot,bad));
    }
    [Fact]
    public void BadClosingRolesTransferGroupsAndUnknownMappingsCannotProduceCompleteReports()
    {
        using var f=new Fixture();var m=f.Classified();
        var wrong=m with{Lines=m.Lines.Select(l=>l.Role==SourceLineRole.ReleaseToUnrestricted?l with{MovementGroupId="different-"+l.Source.LineIndex}:l).ToArray()};
        var pair=new LedgerSnapshotStatementDataSource(f.Store.Read,wrong).CalculatePreview(Clock);
        Assert.Contains(pair.Issues,i=>i.Code=="NP_TRANSFER_GROUP");Assert.Null(Value(pair.ActivityStatement,"release",0));
        wrong=m with{Lines=m.Lines.Select(l=>l.Role==SourceLineRole.IncomeExpenseClosing?l with{Role=SourceLineRole.BalanceOnly}:l).ToArray()};
        pair=new LedgerSnapshotStatementDataSource(f.Store.Read,wrong).CalculatePreview(Clock);Assert.False(pair.HasCompleteReconciledCalculations);
        wrong=m with{BalanceMappings=m.BalanceMappings.Select(x=>x.Fact==BalanceFact.BankDeposits?x with{Mode=BalanceMappingMode.ConfirmedZero,Accounts=[]}:x).ToArray()};
        pair=new LedgerSnapshotStatementDataSource(f.Store.Read,wrong).CalculatePreview(Clock);Assert.Contains(pair.Issues,i=>i.Code=="NP_UNMAPPED_BALANCE");Assert.Null(Value(pair.BalanceSheet,"cash",1));
        wrong=m with{BalanceMappings=m.BalanceMappings.Select(x=>x.Fact==BalanceFact.BankDeposits?x with{Mode=BalanceMappingMode.ReviewedAnalysis,YearOpeningAnalysis=1,ClosingAnalysis=1}:x).ToArray()};
        pair=new LedgerSnapshotStatementDataSource(f.Store.Read,wrong).CalculatePreview(Clock);Assert.Contains(pair.Issues,i=>i.Code=="NP_ANALYSIS_NOT_ALLOWED");Assert.Null(Value(pair.BalanceSheet,"cash",1));
    }
    [Fact]
    public void JsonRejectsTamperingTraversalUnknownFieldsAndInstallationDestination()
    {
        using var f=new Fixture();var store=new ClassificationJsonStore(Path.Combine(f.Root,"sidecar"));var path=store.SaveNew("one.json",f.Classified());
        Assert.Throws<ArgumentException>(()=>store.SaveNew("../escaped.json",f.Classified()));
        var badSign=f.Classified();badSign=badSign with{BalanceMappings=badSign.BalanceMappings.Select(m=>m with{Accounts=m.Accounts.Select(t=>t with{Coefficient=-t.Coefficient}).ToArray()}).ToArray()};
        Assert.Throws<InvalidDataException>(()=>store.SaveNew("bad-sign.json",badSign));
        Assert.Throws<ArgumentException>(()=>new ClassificationJsonStore(AppContext.BaseDirectory));
        var json=File.ReadAllText(path);File.WriteAllText(path,json.Replace("synthetic-user-review","tampered-user-review",StringComparison.Ordinal));
        Assert.Throws<InvalidDataException>(()=>store.Load("one.json",f.Store.Read()));
        File.WriteAllText(path,"{\"Unexpected\":1}");Assert.Throws<System.Text.Json.JsonException>(()=>store.Load("one.json",f.Store.Read()));
        File.WriteAllText(path,"{\"FormatVersion\":1,\"FormatVersion\":1}");Assert.Throws<InvalidDataException>(()=>store.Load("one.json",f.Store.Read()));
        File.WriteAllText(path,"{\"YearOpeningAnalysis\":0.00000000000000000000000000000000000000000000000001}");Assert.Throws<InvalidDataException>(()=>store.Load("one.json",f.Store.Read()));
    }
    [Fact]
    public void SharedEditorBufferCompletesClassificationWithoutInferringAnythingAndRoundTripsJson()
    {
        using var f=new Fixture();var snapshot=f.Store.Read();var reviewed=f.Classified();
        var partial=new ClassificationEditorSession(snapshot,reviewed with{Accounts=[],Lines=[],BalanceMappings=[]});
        Assert.Equal(snapshot.Accounts.Count,partial.Accounts.Count);Assert.Equal(snapshot.Vouchers.Sum(v=>v.Lines.Count),partial.Lines.Count);
        Assert.All(partial.Lines,l=>Assert.Equal(SourceLineRole.Unclassified,l.Role));
        var editor=new ClassificationEditorSession(snapshot,Period,Clock);
        Assert.All(editor.Accounts,a=>Assert.Equal(LedgerAccountSemantic.Unclassified,a.Semantic));
        Assert.All(editor.Lines,l=>Assert.Equal(SourceLineRole.Unclassified,l.Role));
        Assert.All(editor.Balances,b=>Assert.Equal(BalanceMappingMode.Unspecified,b.Mode));
        // Simulate explicit edits in the same row models used by WPF; values come from this synthetic operator's decisions.
        var spaced=reviewed with{Lines=reviewed.Lines.Select(l=>l.Classification?.RestrictionId is {} id?l with{Classification=l.Classification with{RestrictionId=" "+id+" "}}:l).ToArray()};
        var preserved=new ClassificationEditorSession(snapshot,spaced).BuildManifest();
        Assert.All(preserved.Lines.Where(l=>l.Classification?.RestrictionId is not null),l=>Assert.StartsWith(" ",l.Classification!.RestrictionId!,StringComparison.Ordinal));
        var prepared=new ClassificationEditorSession(snapshot,reviewed);
        foreach(var a in editor.Accounts)
        {var from=prepared.Accounts.Single(x=>x.Code==a.Code);a.Semantic=from.Semantic;a.ActivityFact=from.ActivityFact;a.EvidenceReference=from.EvidenceReference;}
        foreach(var l in editor.Lines)
        {
            var from=prepared.Lines.Single(x=>x.VoucherId==l.VoucherId&&x.LineIndex==l.LineIndex);
            l.Role=from.Role;l.Class=from.Class;l.RestrictionId=from.RestrictionId;l.RestrictionVersion=from.RestrictionVersion;l.ProjectId=from.ProjectId;l.SourceKind=from.SourceKind;
            l.RestrictionEvidence=from.RestrictionEvidence;l.ComponentId=from.ComponentId;l.MovementGroupId=from.MovementGroupId;l.EvidenceReference=from.EvidenceReference;
        }
        foreach(var b in editor.Balances)
        {var from=prepared.Balances.Single(x=>x.Fact==b.Fact);b.Mode=from.Mode;b.AccountCodes=from.AccountCodes;b.EvidenceReference=from.EvidenceReference;}
        editor.Components.Add(new(){Id="project-A",Label="合成A项目",Kind=ActivityComponentKind.Project});
        editor.Review.CnyAmountsConfirmed=true;editor.Review.CompleteYearToDateConfirmed=true;editor.Review.AccountMappingReviewed=true;editor.Review.LineClassificationReviewed=true;
        editor.Review.BusinessBreakdownComplete=true;editor.Review.FundraisingDisclosure=FundraisingDisclosure.NotApplicableConfirmed;
        editor.Review.YearOpeningBasis=YearOpeningBasis.Reviewed2026TransitionLedger;editor.Review.EvidenceReference="synthetic-UI-review";
        var source=new LedgerSnapshotStatementDataSource(f.Store.Read,editor.BuildManifest());source.CalculatePreview(Clock).RequireCompleteReconciliation();
        var json=new ClassificationJsonStore(Path.Combine(f.Root,"editor-user-data"));json.SaveNew("operator.json",editor.BuildManifest());
        var reopened=new ClassificationEditorSession(f.Store.Read(),json.Load("operator.json",f.Store.Read()));
        new LedgerSnapshotStatementDataSource(f.Store.Read,reopened.BuildManifest()).CalculatePreview(Clock).RequireCompleteReconciliation();
        editor.Balances.Single(x=>x.Fact==BalanceFact.BankDeposits).AccountCodes="1002;1002";
        Assert.Throws<InvalidDataException>(()=>editor.BuildManifest());
    }
    [Fact]
    public void CanonicalSnapshotOrderMayChangeWhileLineOrderAndAllContentStayBound()
    {
        using var f=new Fixture();var snapshot=f.Store.Read();var reordered=snapshot with{Accounts=snapshot.Accounts.Reverse().ToArray(),Vouchers=snapshot.Vouchers.Reverse().ToArray(),AuditEvents=snapshot.AuditEvents.Reverse().ToArray()};
        Assert.Equal(SnapshotIdentity.Binding(snapshot),SnapshotIdentity.Binding(reordered));
        new LedgerSnapshotStatementDataSource(()=>reordered,f.Classified()).CalculatePreview(Clock).RequireCompleteReconciliation();
    }
    [Theory]
    [InlineData(10)]
    [InlineData(-10)]
    public void PriorYearAdjustmentAndItsMechanicalClosingAreCountedOnce(decimal amount)
    {
        using var f=new Fixture(priorAdjustment:amount);
        var pair=new LedgerSnapshotStatementDataSource(f.Store.Read,f.Classified()).CalculatePreview(Clock);pair.RequireCompleteReconciliation();
        Assert.Equal(amount,Value(pair.ActivityStatement,"prior-adjustment",0));Assert.Equal(150+amount,Value(pair.ActivityStatement,"net-change",0));
        Assert.Equal(700+amount,Value(pair.BalanceSheet,"cash",1));Assert.Equal(150+amount,Value(pair.BalanceSheet,"net-assets.unrestricted",1));
    }
    [Fact]
    public void ZeroAccountTotalsDoNotHideUnclosedRestrictionScopes()
    {
        using var f=new Fixture();var m=f.Classified();
        var wrong=m with{Lines=m.Lines.Select(l=>l.Role==SourceLineRole.IncomeExpenseClosing&&l.Classification?.RestrictionId=="B"?l with{Classification=R("A")}:l).ToArray()};
        var trial=new LedgerService(f.Store).GetTrialBalance(new(2026,1,1),new(2026,6,30)).Single(r=>r.AccountCode=="4101");
        Assert.Equal(0m,trial.ClosingDebit);Assert.Equal(0m,trial.ClosingCredit);
        var pair=new LedgerSnapshotStatementDataSource(f.Store.Read,wrong).CalculatePreview(Clock);
        Assert.Null(Value(pair.BalanceSheet,"net-assets.restricted",1));Assert.Contains(pair.Issues,i=>i.Code=="NP_UNCLOSED_PL");
    }
    private static decimal? Value(NonprofitStatement report,string key,int column)=>report.Lines.Single(x=>x.Key==key).Values[column].Amount;
    private sealed class Fixture:IDisposable
    {
        internal string Root {get;}=Path.Combine(Path.GetTempPath(),"caiwu-np-report-"+Guid.NewGuid().ToString("N"));
        internal SqliteLedgerStore Store {get;private set;}
        private readonly Dictionary<Guid,(SourceLineRole Role,RestrictionTag? Tag,string? Component,string? Group)[]> classifications=[];
        private string Db=>Path.Combine(Root,"synthetic.caiwu");
        internal Fixture(bool includeClosingAndTransfers=true,decimal priorAdjustment=0)
        {
            Directory.CreateDirectory(Root);var book=new BookInfo(Guid.NewGuid(),"合成民非真实SQLite",AccountingRegime.Nonprofit,"nonprofit-2026-synthetic",2026,1,0,Clock);
            Account[] accounts=[new("1002","合成银行",null,BalanceDirection.Debit,true,0,0),new("3101","合成非限定",null,BalanceDirection.Credit,true,0,0),new("3102","合成限定",null,BalanceDirection.Credit,true,0,0),new("4101","合成捐赠",null,BalanceDirection.Credit,true,0,0),new("5101","合成业务成本",null,BalanceDirection.Debit,true,0,0)];
            if(priorAdjustment!=0)accounts=accounts.Append(new Account("3201","合成前期调整",null,BalanceDirection.Credit,true,0,0)).ToArray();
            Store=SqliteLedgerStore.Create(Db,book,accounts);
            Post(1,[new("1002","摘要不决定类别",1000,0),new("4101","A",0,500),new("4101","B",0,500)],
                [(SourceLineRole.BalanceOnly,null,null,null),(SourceLineRole.RecognizedActivity,R("A"),null,null),(SourceLineRole.RecognizedActivity,R("B"),null,null)]);
            Post(2,[new("5101","A成本",300,0),new("1002","支付",0,300)],[(SourceLineRole.RecognizedActivity,R("A"),"project-A",null),(SourceLineRole.BalanceOnly,null,null,null)]);
            if(!includeClosingAndTransfers)return;
            Post(20,[new("4101","A结转",500,0),new("4101","B结转",500,0),new("5101","A成本结转",0,300),new("3102","A结转",0,200),new("3102","B结转",0,500)],
                [(SourceLineRole.IncomeExpenseClosing,R("A"),null,null),(SourceLineRole.IncomeExpenseClosing,R("B"),null,null),(SourceLineRole.IncomeExpenseClosing,R("A"),"project-A",null),(SourceLineRole.IncomeExpenseClosing,R("A"),null,null),(SourceLineRole.IncomeExpenseClosing,R("B"),null,null)]);
            Post(21,[new("3102","A范围完全解除",200,0),new("3101","转非限定",0,200)],[(SourceLineRole.ReleaseToUnrestricted,R("A"),null,"release-A"),(SourceLineRole.ReleaseToUnrestricted,U,null,"release-A")]);
            Post(22,[new("3101","新增外部限制C",50,0),new("3102","限制C",0,50)],[(SourceLineRole.TransferToRestricted,U,null,"designation-C"),(SourceLineRole.TransferToRestricted,R("C"),null,"designation-C")]);
            if(priorAdjustment>0)
            {
                Post(23,[new("1002","合成前期增加",priorAdjustment,0),new("3201","合成前期增加",0,priorAdjustment)],[(SourceLineRole.BalanceOnly,null,null,null),(SourceLineRole.PriorYearAdjustment,U,null,null)]);
                Post(24,[new("3201","合成机械结转",priorAdjustment,0),new("3101","合成机械结转",0,priorAdjustment)],[(SourceLineRole.PriorYearAdjustmentClosing,U,null,null),(SourceLineRole.PriorYearAdjustmentClosing,U,null,null)]);
            }
            else if(priorAdjustment<0)
            {
                Post(23,[new("3201","合成前期减少",-priorAdjustment,0),new("1002","合成前期减少",0,-priorAdjustment)],[(SourceLineRole.PriorYearAdjustment,U,null,null),(SourceLineRole.BalanceOnly,null,null,null)]);
                Post(24,[new("3101","合成机械结转",-priorAdjustment,0),new("3201","合成机械结转",0,-priorAdjustment)],[(SourceLineRole.PriorYearAdjustmentClosing,U,null,null),(SourceLineRole.PriorYearAdjustmentClosing,U,null,null)]);
            }
        }
        private void Post(int day,VoucherLine[] lines,(SourceLineRole Role,RestrictionTag? Tag,string? Component,string? Group)[] types)
        {
            var s=new LedgerService(Store);var voucher=s.SaveDraft(new(null,new(2026,6,day),"合成",null,0,lines),"synthetic-maker");
            s.Review(voucher.Id,"synthetic-reviewer");s.Post(voucher.Id,"synthetic-poster");classifications.Add(voucher.Id,types);
        }
        internal void Reopen(){Store.Dispose();Store=SqliteLedgerStore.Open(Db);}
        internal LedgerClassificationManifest Classified()
        {
            var snapshot=Store.Read();var draft=LedgerClassificationDraft.Create(snapshot,Period,Clock);
            var accounts=draft.Accounts.Select(a=>a with{Semantic=a.AccountCode switch{"4101"or"5101"=>LedgerAccountSemantic.IncomeExpense,"3101"=>LedgerAccountSemantic.UnrestrictedNetAssets,"3102"=>LedgerAccountSemantic.RestrictedNetAssets,"3201"=>LedgerAccountSemantic.PriorYearAdjustment,_=>LedgerAccountSemantic.OtherBalance},
                ActivityFact=a.AccountCode switch{"4101"=>ActivityFact.DonationIncome,"5101"=>ActivityFact.BusinessActivityCost,"3201"=>ActivityFact.PriorYearNetAssetAdjustment,_=>(ActivityFact?)null},EvidenceReference="synthetic-account-review"}).ToArray();
            var lines=draft.Lines.Select(l=>{var x=classifications[l.Source.VoucherId][l.Source.LineIndex];return l with{Role=x.Role,Classification=x.Tag,ComponentId=x.Component,MovementGroupId=x.Group,EvidenceReference="synthetic-line-review"};}).ToArray();
            var mappings=draft.BalanceMappings.Select(m=>m.Fact switch
            {
                BalanceFact.BankDeposits=>Mapped(m,"1002",1),BalanceFact.UnrestrictedNetAssets=>Mapped(m,"3101",-1),BalanceFact.RestrictedNetAssets=>Mapped(m,"3102",-1),
                _=>m with{Mode=BalanceMappingMode.ConfirmedZero,EvidenceReference="synthetic-reviewed-no-such-balance"}
            }).ToArray();
            return draft with{Accounts=accounts,Lines=lines,BalanceMappings=mappings,Components=[new("project-A","合成A项目",ActivityComponentKind.Project)],
                Review=new(true,true,true,true,true,FundraisingDisclosure.NotApplicableConfirmed,YearOpeningBasis.Reviewed2026TransitionLedger,false,"","synthetic-user-review")};
            BalanceFactMapping Mapped(BalanceFactMapping m,string code,int sign)=>m with{Mode=BalanceMappingMode.AccountBalances,Accounts=[new(code,SnapshotIdentity.AccountHash(snapshot.Accounts.Single(a=>a.Code==code)),sign)],EvidenceReference="synthetic-verified-account-balance"};
        }
        public void Dispose(){Store.Dispose();Directory.Delete(Root,true);}
    }
}
