using System.Collections.ObjectModel;
using Caiwu.Contracts;

namespace Caiwu.Nonprofit.Reporting;

/// <summary>Testable edit buffer shared by the standalone WPF control. Amounts in saved ledger lines are read-only.</summary>
public sealed class ClassificationEditorSession
{
    private readonly LedgerSnapshot snapshot;
    private readonly LedgerClassificationManifest original;
    public ObservableCollection<AccountClassificationRow> Accounts {get;}
    public ObservableCollection<LineClassificationRow> Lines {get;}
    public ObservableCollection<BalanceMappingRow> Balances {get;}
    public ObservableCollection<ComponentEditorRow> Components {get;}
    public ObservableCollection<LimitationEditorRow> Limitations {get;}
    public ReviewEditorRow Review {get;}
    public SnapshotBinding Binding=>original.Binding;
    public ReportingPeriod Period=>original.Period;
    public string BookName=>snapshot.Book.Name;
    public ClassificationEditorSession(LedgerSnapshot snapshot,ReportingPeriod period,DateTimeOffset clock)
        :this(snapshot,LedgerClassificationDraft.Create(snapshot,period,clock)){}
    public ClassificationEditorSession(LedgerSnapshot snapshot,LedgerClassificationManifest manifest)
    {
        LedgerSnapshotStatementDataSource.ValidateManifestShape(manifest);LedgerSnapshotStatementDataSource.RequireBinding(snapshot,manifest.Binding);LedgerSnapshotStatementDataSource.VerifyReferences(snapshot,manifest);
        this.snapshot=SnapshotIdentity.Freeze(snapshot);original=ClassificationJsonStore.Freeze(manifest);
        var accounts=snapshot.Accounts.ToDictionary(a=>a.Code,StringComparer.Ordinal);var vouchers=snapshot.Vouchers.ToDictionary(v=>v.Id);
        var completeDraft=LedgerClassificationDraft.Create(this.snapshot,manifest.Period,manifest.CreatedAt);
        var suppliedAccounts=original.Accounts.ToDictionary(a=>a.AccountCode,StringComparer.Ordinal);
        var suppliedLines=original.Lines.ToDictionary(l=>(l.Source.VoucherId,l.Source.LineIndex));
        Accounts=new(completeDraft.Accounts.Select(a=>new AccountClassificationRow(suppliedAccounts.GetValueOrDefault(a.AccountCode)??a,accounts[a.AccountCode])));
        Lines=new(completeDraft.Lines.Select(l=>new LineClassificationRow(suppliedLines.GetValueOrDefault((l.Source.VoucherId,l.Source.LineIndex))??l,vouchers[l.Source.VoucherId])));
        Balances=new(Enum.GetValues<BalanceFact>().Select(f=>new BalanceMappingRow(original.BalanceMappings.SingleOrDefault(m=>m.Fact==f)??new(f,BalanceMappingMode.Unspecified,[],null,null,""))));
        Components=new(original.Components.Select(c=>new ComponentEditorRow{Id=c.Id,Label=c.Label,Kind=c.Kind}));
        Limitations=new(original.SourceLimitations.Select(i=>new LimitationEditorRow{Code=i.Code,Path=i.Path,Detail=i.Detail}));Review=new(original.Review);
    }
    public LedgerClassificationManifest BuildManifest()
    {
        var actual=snapshot.Accounts.ToDictionary(a=>a.Code,StringComparer.Ordinal);
        var result=original with
        {
            Accounts=Accounts.Select(a=>a.Build()).ToArray(),Lines=Lines.Select(l=>l.Build()).ToArray(),
            BalanceMappings=Balances.Select(b=>b.Build(actual)).ToArray(),Components=Components.Select(c=>new ActivityComponent(c.Id,c.Label,c.Kind)).ToArray(),
            Review=Review.Build(),SourceLimitations=Limitations.Select(l=>new MissingReason(l.Code,l.Path,l.Detail)).ToArray()
        };
        LedgerSnapshotStatementDataSource.ValidateManifestShape(result);return result;
    }
}
public sealed class AccountClassificationRow
{
    private readonly LedgerAccountClassification original;
    public string Code=>original.AccountCode;public string Name {get;}public BalanceDirection Direction {get;}public string DirectionLabel=>Direction==BalanceDirection.Debit?"借方":"贷方";
    public LedgerAccountSemantic Semantic {get;set;}public ActivityFact? ActivityFact {get;set;}public bool NoBalanceExpectedConfirmed {get;set;}public string EvidenceReference {get;set;}
    public AccountClassificationRow(LedgerAccountClassification value,Account account)
    {original=value;Name=account.Name;Direction=account.Direction;Semantic=value.Semantic;ActivityFact=value.ActivityFact;NoBalanceExpectedConfirmed=value.NoBalanceExpectedConfirmed;EvidenceReference=value.EvidenceReference;}
    internal LedgerAccountClassification Build()=>original with{Semantic=Semantic,ActivityFact=ActivityFact,NoBalanceExpectedConfirmed=NoBalanceExpectedConfirmed,EvidenceReference=EvidenceReference};
}
public sealed class LineClassificationRow
{
    private readonly LedgerLineClassification original;
    public Guid VoucherId=>original.Source.VoucherId;public int LineIndex=>original.Source.LineIndex;
    public DateOnly Date {get;}public string Kind {get;}public int Number {get;}public string AccountCode {get;}public string Summary {get;}public decimal Debit {get;}public decimal Credit {get;}
    public SourceLineRole Role {get;set;}public RestrictionClass? Class {get;set;}public string? RestrictionId {get;set;}public int? RestrictionVersion {get;set;}public string? ProjectId {get;set;}
    public RestrictionSourceKind? SourceKind {get;set;}public string? RestrictionEvidence {get;set;}public string? ComponentId {get;set;}public string? MovementGroupId {get;set;}public string EvidenceReference {get;set;}
    public LineClassificationRow(LedgerLineClassification value,Voucher voucher)
    {
        original=value;var line=voucher.Lines[value.Source.LineIndex];Date=voucher.Date;Kind=voucher.Kind;Number=voucher.Number;AccountCode=line.AccountCode;Summary=line.Summary;Debit=line.Debit;Credit=line.Credit;
        Role=value.Role;Class=value.Classification?.Class;RestrictionId=value.Classification?.RestrictionId;RestrictionVersion=value.Classification?.RestrictionVersion;
        ProjectId=value.Classification?.ProjectId;SourceKind=value.Classification?.SourceKind;RestrictionEvidence=value.Classification?.EvidenceReference;ComponentId=value.ComponentId;MovementGroupId=value.MovementGroupId;EvidenceReference=value.EvidenceReference;
    }
    public void SetBalanceOnly(){Role=SourceLineRole.BalanceOnly;Class=null;RestrictionId=null;RestrictionVersion=null;ProjectId=null;SourceKind=null;RestrictionEvidence=null;ComponentId=null;MovementGroupId=null;}
    public void SetOrdinaryUnrestricted(){Role=SourceLineRole.RecognizedActivity;Class=RestrictionClass.Unrestricted;RestrictionId=null;RestrictionVersion=null;SourceKind=null;RestrictionEvidence=null;MovementGroupId=null;}
    internal LedgerLineClassification Build()=>original with{Role=Role,Classification=Class is {} cls?new(cls,Null(RestrictionId),RestrictionVersion,Null(ProjectId),SourceKind,Null(RestrictionEvidence)):null,
        ComponentId=Null(ComponentId),MovementGroupId=Null(MovementGroupId),EvidenceReference=EvidenceReference};
    private static string? Null(string? value)=>string.IsNullOrWhiteSpace(value)?null:value;
}
public sealed class BalanceMappingRow
{
    public BalanceFact Fact {get;}public string Label=>ClassificationLabels.For(Fact);public string NormalSide=>LedgerSnapshotStatementDataSource.CreditPositive(Fact)?"贷方正":"借方正";
    public BalanceMappingMode Mode {get;set;}public string AccountCodes {get;set;}public decimal? YearOpeningAnalysis {get;set;}public decimal? ClosingAnalysis {get;set;}public string EvidenceReference {get;set;}
    public BalanceMappingRow(BalanceFactMapping value){Fact=value.Fact;Mode=value.Mode;AccountCodes=string.Join(';',value.Accounts.Select(t=>t.AccountCode));YearOpeningAnalysis=value.YearOpeningAnalysis;ClosingAnalysis=value.ClosingAnalysis;EvidenceReference=value.EvidenceReference;}
    public void ConfirmZero(string evidence){Mode=BalanceMappingMode.ConfirmedZero;AccountCodes="";YearOpeningAnalysis=null;ClosingAnalysis=null;EvidenceReference=evidence;}
    internal BalanceFactMapping Build(IReadOnlyDictionary<string,Account> accounts)
    {
        var terms=AccountCodes.Split([',',';','，','；'],StringSplitOptions.RemoveEmptyEntries|StringSplitOptions.TrimEntries).Select(code=>
        {
            if(!accounts.TryGetValue(code,out var a))throw new ArgumentException("余额事实"+Fact+"引用不存在的科目："+code);
            return new AccountBalanceTerm(code,SnapshotIdentity.AccountHash(a),LedgerSnapshotStatementDataSource.CreditPositive(Fact)?-1:1);
        }).ToArray();
        return new(Fact,Mode,terms,YearOpeningAnalysis,ClosingAnalysis,EvidenceReference);
    }
}
public sealed class ComponentEditorRow {public string Id {get;set;}="";public string Label {get;set;}="";public ActivityComponentKind Kind {get;set;}}
public sealed class LimitationEditorRow {public string Code {get;set;}="";public string Path {get;set;}="";public string Detail {get;set;}="";}
public sealed class ReviewEditorRow
{
    public bool CnyAmountsConfirmed {get;set;}public bool CompleteYearToDateConfirmed {get;set;}public bool AccountMappingReviewed {get;set;}public bool LineClassificationReviewed {get;set;}public bool BusinessBreakdownComplete {get;set;}
    public FundraisingDisclosure FundraisingDisclosure {get;set;}public YearOpeningBasis YearOpeningBasis {get;set;}public bool RestrictedIncomeTaxTreatmentReviewed {get;set;}
    public string RestrictedIncomeTaxReviewEvidence {get;set;}public string EvidenceReference {get;set;}
    public ReviewEditorRow(ClassificationReview r){CnyAmountsConfirmed=r.CnyAmountsConfirmed;CompleteYearToDateConfirmed=r.CompleteYearToDateConfirmed;AccountMappingReviewed=r.AccountMappingReviewed;LineClassificationReviewed=r.LineClassificationReviewed;BusinessBreakdownComplete=r.BusinessBreakdownComplete;FundraisingDisclosure=r.FundraisingDisclosure;YearOpeningBasis=r.YearOpeningBasis;RestrictedIncomeTaxTreatmentReviewed=r.RestrictedIncomeTaxTreatmentReviewed;RestrictedIncomeTaxReviewEvidence=r.RestrictedIncomeTaxReviewEvidence;EvidenceReference=r.EvidenceReference;}
    internal ClassificationReview Build()=>new(CnyAmountsConfirmed,CompleteYearToDateConfirmed,AccountMappingReviewed,LineClassificationReviewed,BusinessBreakdownComplete,FundraisingDisclosure,YearOpeningBasis,RestrictedIncomeTaxTreatmentReviewed,RestrictedIncomeTaxReviewEvidence,EvidenceReference);
}
