using Caiwu.Contracts;

namespace Caiwu.Nonprofit.Reporting;

/// <summary>Reads only a saved snapshot. Explicit sidecar classifications supply absent semantics; summaries/names never choose them.</summary>
public sealed class LedgerSnapshotStatementDataSource : INonprofitStatementDataSource
{
    private readonly Func<LedgerSnapshot> readSnapshot;
    private readonly LedgerClassificationManifest manifest;
    public LedgerClassificationManifest Manifest => ClassificationJsonStore.Freeze(manifest);
    public string ClassificationFingerprint => ClassificationJsonStore.ManifestHash(manifest);
    public LedgerSnapshotStatementDataSource(Func<LedgerSnapshot> readSnapshot, LedgerClassificationManifest manifest)
    {
        ArgumentNullException.ThrowIfNull(readSnapshot);ValidateManifestShape(manifest);
        this.readSnapshot=readSnapshot;this.manifest=ClassificationJsonStore.Freeze(manifest);_ = Capture();
    }
    public void RequireCurrentSource() => _ = Capture();
    public StatementContext CreateContext(DateTimeOffset generatedAt)
    {
        var e=Analyze();return Context(e,generatedAt);
    }
    public NonprofitStatementSet CalculatePreview(DateTimeOffset generatedAt)
    {
        var e=Analyze();var context=Context(e,generatedAt);
        return NonprofitStatementReconciliation.Compare(NonprofitBalanceSheet.Calculate(BalanceInput(e,context)),
            NonprofitActivityStatement.Calculate(ActivityInput(e,context)));
    }
    public ClassifiedLedgerPreview CreateBoundPreview(DateTimeOffset generatedAt)
    {var result=CalculatePreview(generatedAt);RequireCurrentSource();return new(this,result);}
    public ClassificationValidationResult Validate() => new(CalculatePreview(manifest.CreatedAt).Issues);
    public BalanceSheetInput ReadBalanceSheet(StatementContext context)
    {var e=Analyze();RequireContext(e,context);return BalanceInput(e,Context(e,context.GeneratedAt));}
    public ActivityStatementInput ReadActivityStatement(StatementContext context)
    {var e=Analyze();RequireContext(e,context);return ActivityInput(e,Context(e,context.GeneratedAt));}

    public static void RequireBinding(LedgerSnapshot snapshot,SnapshotBinding expected)
    {
        var actual=SnapshotIdentity.Binding(snapshot);
        if(expected is null||actual!=expected)throw new ClassificationStaleException("账套身份、来源revision或快照内容已改变；请读取新快照并重新核对分类，禁止自动沿用旧清单。");
    }
    public static void ValidateManifestShape(LedgerClassificationManifest value)
    {
        ArgumentNullException.ThrowIfNull(value);
        if(value.SchemaVersion!=1||value.Binding is null||value.Binding.BookId==Guid.Empty||value.Binding.Revision<0||!Hash(value.Binding.SnapshotSha256)||
            value.Period is null||value.CreatedAt==default||value.Accounts is null||value.Lines is null||value.BalanceMappings is null||value.Components is null||value.Review is null||value.SourceLimitations is null)
            throw new InvalidDataException("分类清单结构/版本无效。");
        if(value.Accounts.Any(a=>a is null||string.IsNullOrWhiteSpace(a.AccountCode)||!Hash(a.AccountSha256)||!Enum.IsDefined(a.Semantic)||a.ActivityFact is {} f&&!Enum.IsDefined(f))||
            value.Accounts.Select(a=>a.AccountCode).Distinct(StringComparer.Ordinal).Count()!=value.Accounts.Count||
            value.Lines.Any(l=>l is null||l.Source is null||l.Source.VoucherId==Guid.Empty||l.Source.LineIndex<0||!Hash(l.Source.ContentSha256)||!Enum.IsDefined(l.Role))||
            value.Lines.Select(l=>(l.Source.VoucherId,l.Source.LineIndex)).Distinct().Count()!=value.Lines.Count||
            value.BalanceMappings.Any(m => m is null || !Enum.IsDefined(m.Fact) || !Enum.IsDefined(m.Mode) ||
                m.Accounts is null || m.Accounts.Any(t => t is null || string.IsNullOrWhiteSpace(t.AccountCode) ||
                    !Hash(t.AccountSha256) || t.Coefficient != (CreditPositive(m.Fact) ? -1 : 1))) ||
            value.BalanceMappings.Select(m=>m.Fact).Distinct().Count()!=value.BalanceMappings.Count||
            value.Components.Any(c=>c is null||string.IsNullOrWhiteSpace(c.Id)||string.IsNullOrWhiteSpace(c.Label)||!Enum.IsDefined(c.Kind))||value.Components.Select(c=>c.Id).Distinct().Count()!=value.Components.Count||
            !Enum.IsDefined(value.Review.FundraisingDisclosure)||!Enum.IsDefined(value.Review.YearOpeningBasis)||
            value.SourceLimitations.Any(i=>i is null||string.IsNullOrWhiteSpace(i.Code)||string.IsNullOrWhiteSpace(i.Path)||string.IsNullOrWhiteSpace(i.Detail)))
            throw new InvalidDataException("分类清单含重复身份、无效枚举、定位或映射。");
        foreach(var m in value.BalanceMappings)
        {
            if(m.YearOpeningAnalysis is {} opening)Money.Validate(opening);if(m.ClosingAnalysis is {} closing)Money.Validate(closing);
            if(m.Accounts.Select(t=>t.AccountCode).Distinct(StringComparer.Ordinal).Count()!=m.Accounts.Count)throw new InvalidDataException("同一余额事实不能重复引用同一科目。");
        }
    }
    private static bool Hash(string? text)=>text is {Length:64}&&text.All(c=>char.IsAsciiHexDigit(c));
    private LedgerSnapshot Capture()
    {
        var snapshot=readSnapshot();SnapshotIdentity.ValidateSnapshot(snapshot);snapshot=SnapshotIdentity.Freeze(snapshot);RequireBinding(snapshot,manifest.Binding);VerifyReferences(snapshot,manifest);
        if(manifest.Period.To.Year!=snapshot.Book.FiscalYear||manifest.Period.From.Month<snapshot.Book.StartMonth)throw new ArgumentException("清单期间超出来源账套。");
        return snapshot;
    }
    internal static void VerifyReferences(LedgerSnapshot snapshot,LedgerClassificationManifest value)
    {
        var accounts=SnapshotIdentity.Leaves(snapshot).ToDictionary(a=>a.Code,StringComparer.Ordinal);
        var vouchers=snapshot.Vouchers.Where(v=>v.Status==VoucherStatus.Posted&&v.Date<=value.Period.To).ToDictionary(v=>v.Id);
        foreach(var a in value.Accounts)
            if(!accounts.TryGetValue(a.AccountCode,out var actual)||SnapshotIdentity.AccountHash(actual)!=a.AccountSha256)throw new ClassificationStaleException("科目定位/内容校验失败："+a.AccountCode);
        foreach(var m in value.BalanceMappings)
            foreach(var term in m.Accounts)
                if(!accounts.TryGetValue(term.AccountCode,out var actual)||SnapshotIdentity.AccountHash(actual)!=term.AccountSha256)throw new ClassificationStaleException("余额事实引用的科目定位失效："+term.AccountCode);
        foreach(var l in value.Lines)
            if(!vouchers.TryGetValue(l.Source.VoucherId,out var voucher)||l.Source.LineIndex>=voucher.Lines.Count||SnapshotIdentity.LineReference(voucher,l.Source.LineIndex)!=l.Source)
                throw new ClassificationStaleException("分录定位/内容校验失败："+l.Source.VoucherId+"/"+l.Source.LineIndex);
    }
    private string Evidence => "snapshot:"+manifest.Binding.SnapshotSha256+";classification:"+ClassificationJsonStore.ManifestHash(manifest);
    private StatementContext Context(Evaluation e,DateTimeOffset clock)=>new(e.Snapshot.Book.Id,e.Snapshot.Book.Name,e.Snapshot.Revision,manifest.Period,clock,
        StatementSourceKind.PostedLedger,Evidence,manifest.Review.CnyAmountsConfirmed,e.Issues.Concat(manifest.SourceLimitations));
    private void RequireContext(Evaluation e,StatementContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        if(context.BookId!=e.Snapshot.Book.Id||context.SourceLedgerRevision!=e.Snapshot.Revision||context.Period!=manifest.Period||context.SourceKind!=StatementSourceKind.PostedLedger||context.SourceEvidenceReference!=Evidence)
            throw new ArgumentException("请使用本数据源CreateContext返回的同一账套/版本/分类清单上下文。");
    }
    private sealed record Located(Voucher Voucher,int Index,VoucherLine Line,LedgerAccountClassification? Account,LedgerLineClassification? Classification);
    private sealed record Evaluation(LedgerSnapshot Snapshot,Dictionary<string,decimal> Opening,Dictionary<string,decimal> Closing,
        IReadOnlyList<MissingReason> Issues,IReadOnlyList<ActivityEntry> Entries,IReadOnlySet<ActivityFact> CoveredFacts,
        bool IncomeExpenseClosed,bool OpeningIncomeExpenseClosed,bool UnmappedBalance);

    private Evaluation Analyze()
    {
        var snapshot=Capture();var issues=new List<MissingReason>();var invalidFacts=new HashSet<ActivityFact>();
        void Issue(string code,string path,string detail)=>issues.Add(new(code,path,detail));
        var leaves=SnapshotIdentity.Leaves(snapshot);var sourceAccounts=leaves.ToDictionary(a=>a.Code,StringComparer.Ordinal);
        var accounts=manifest.Accounts.ToDictionary(a=>a.AccountCode,StringComparer.Ordinal);
        foreach(var mapping in manifest.Accounts)
        {
            if(!sourceAccounts.TryGetValue(mapping.AccountCode,out var actual)||SnapshotIdentity.AccountHash(actual)!=mapping.AccountSha256)
                throw new ClassificationStaleException("科目定位/内容校验失败："+mapping.AccountCode);
            if(mapping.Semantic==LedgerAccountSemantic.Unclassified||string.IsNullOrWhiteSpace(mapping.EvidenceReference))Issue("NP_ACCOUNT_CLASSIFICATION",mapping.AccountCode,"科目语义尚未明确分类/留依据。");
            if(mapping.Semantic==LedgerAccountSemantic.IncomeExpense&&mapping.ActivityFact is not (>=ActivityFact.DonationIncome and <=ActivityFact.OtherExpense)||
                mapping.Semantic==LedgerAccountSemantic.PriorYearAdjustment&&mapping.ActivityFact!=ActivityFact.PriorYearNetAssetAdjustment||
                mapping.Semantic is not (LedgerAccountSemantic.IncomeExpense or LedgerAccountSemantic.PriorYearAdjustment)&&mapping.ActivityFact is not null)
                Issue("NP_ACCOUNT_FACT",mapping.AccountCode,"科目语义与活动项目不一致。");
        }
        foreach(var account in leaves.Where(a=>!accounts.ContainsKey(a.Code)))Issue("NP_ACCOUNT_CLASSIFICATION",account.Code,"来源末级科目未在分类清单中明确处理。");
        var posted=snapshot.Vouchers.Where(v=>v.Status==VoucherStatus.Posted&&v.Date<=manifest.Period.To).ToArray();
        var known=posted.SelectMany(v=>v.Lines.Select((line,index)=>(Key:(v.Id,index),Voucher:v,Line:line))).ToDictionary(x=>x.Key);
        foreach(var line in manifest.Lines)
            if(!known.TryGetValue((line.Source.VoucherId,line.Source.LineIndex),out var actual)||SnapshotIdentity.LineReference(actual.Voucher,line.Source.LineIndex)!=line.Source)
                throw new ClassificationStaleException("分录定位/内容校验失败："+line.Source.VoucherId+"/"+line.Source.LineIndex);
        var lineMap=manifest.Lines.ToDictionary(l=>(l.Source.VoucherId,l.Source.LineIndex));
        var located=posted.SelectMany(v=>v.Lines.Select((l,i)=>new Located(v,i,l,accounts.GetValueOrDefault(l.AccountCode),lineMap.GetValueOrDefault((v.Id,i))))).ToArray();
        var opening=leaves.ToDictionary(a=>a.Code,a=>Money.Sum([a.OpeningDebit,-a.OpeningCredit]),StringComparer.Ordinal);
        var closing=leaves.ToDictionary(a=>a.Code,a=>Money.Sum(new[]{opening[a.Code]}.Concat(located.Where(l=>l.Line.AccountCode==a.Code).SelectMany(l=>new[]{l.Line.Debit,-l.Line.Credit}))),StringComparer.Ordinal);
        var mappings=manifest.BalanceMappings.ToDictionary(m=>m.Fact);
        foreach(var m in manifest.BalanceMappings)
        {
            foreach(var term in m.Accounts)
            {
                if(!sourceAccounts.TryGetValue(term.AccountCode,out var a)||SnapshotIdentity.AccountHash(a)!=term.AccountSha256)throw new ClassificationStaleException("余额映射的科目定位/内容已失效："+term.AccountCode);
                if(term.Coefficient!=(CreditPositive(m.Fact)?-1:1))Issue("NP_BALANCE_SIGN",m.Fact.ToString(),"余额映射方向须符合此事实的借/贷正数口径。");
            }
            if(m.Mode==BalanceMappingMode.Unspecified||string.IsNullOrWhiteSpace(m.EvidenceReference))Issue("NP_BALANCE_MAPPING",m.Fact.ToString(),"余额事实尚未明确取数/确认零值及留依据。");
            if(m.Mode==BalanceMappingMode.ConfirmedZero&&m.Accounts.Count!=0||m.Mode==BalanceMappingMode.AccountBalances&&m.Accounts.Count==0||m.Mode!=BalanceMappingMode.ReviewedAnalysis&&(m.YearOpeningAnalysis is not null||m.ClosingAnalysis is not null))
                Issue("NP_BALANCE_MAPPING",m.Fact.ToString(),"确认零值不能含科目项；按科目计算须有至少一个明确末级科目。");
            if(m.Mode==BalanceMappingMode.ReviewedAnalysis&&!Supplemental(m.Fact))
                Issue("NP_ANALYSIS_NOT_ALLOWED",m.Fact.ToString(),"可直接由账簿取数的基础余额须明确映射末级科目；仅受托货币明细、到期部分及其减值允许补充有据分析，不得手填覆盖账簿。");
        }
        var baseTerms=manifest.BalanceMappings.Where(m=>!Supplemental(m.Fact)&&m.Mode is BalanceMappingMode.AccountBalances or BalanceMappingMode.ReviewedAnalysis)
            .SelectMany(m=>m.Accounts.Select(t=>(Mapping:m,Term:t))).ToArray();
        foreach(var group in baseTerms.GroupBy(t=>t.Term.AccountCode).Where(g=>g.Count()>1))Issue("NP_DUPLICATE_BALANCE_MAPPING",group.Key,"同一末级科目被重复纳入基础余额事实；只允许到期/受托明细等明确子集复用。");
        var unmappedBalance=false;
        foreach(var a in leaves)
        {
            accounts.TryGetValue(a.Code,out var map);
            if(map?.Semantic is LedgerAccountSemantic.IncomeExpense or LedgerAccountSemantic.PriorYearAdjustment)continue;
            if(baseTerms.Any(t=>t.Term.AccountCode==a.Code))continue;
            if(map is {NoBalanceExpectedConfirmed:true}&&opening[a.Code]==0&&closing[a.Code]==0&&!string.IsNullOrWhiteSpace(map.EvidenceReference))continue;
            unmappedBalance=true;Issue("NP_UNMAPPED_BALANCE",a.Code,"科目未纳入基础余额事实，也未有据确认其期初/期末均为零；不能默默丢掉余额。");
        }
        foreach(var term in baseTerms)
        {
            var semantic=accounts.GetValueOrDefault(term.Term.AccountCode)?.Semantic;
            var expected=term.Mapping.Fact switch{BalanceFact.UnrestrictedNetAssets=>LedgerAccountSemantic.UnrestrictedNetAssets,BalanceFact.RestrictedNetAssets=>LedgerAccountSemantic.RestrictedNetAssets,_=>LedgerAccountSemantic.OtherBalance};
            if(semantic!=expected)Issue("NP_BALANCE_ACCOUNT_SEMANTIC",term.Term.AccountCode,"余额事实与明确科目语义不匹配。");
        }
        var entries=new List<ActivityEntry>();var allProfitLinesClassified=true;var closingGroupsValid=true;
        void Affect(Located l)
        {
            if(l.Account?.ActivityFact is {} fact)invalidFacts.Add(fact);
            else if(l.Account?.Semantic is LedgerAccountSemantic.UnrestrictedNetAssets or LedgerAccountSemantic.RestrictedNetAssets)
            {invalidFacts.Add(ActivityFact.ReleaseToUnrestricted);invalidFacts.Add(ActivityFact.TransferToRestricted);invalidFacts.Add(ActivityFact.PriorYearNetAssetAdjustment);}
            else foreach(var f in Enum.GetValues<ActivityFact>())invalidFacts.Add(f);
        }
        foreach(var l in located)
        {
            var path=l.Voucher.Id+"/"+l.Index;var c=l.Classification;var map=l.Account;
            if(map is null||map.Semantic==LedgerAccountSemantic.Unclassified||c is null||c.Role==SourceLineRole.Unclassified||string.IsNullOrWhiteSpace(c.EvidenceReference))
            {Issue("NP_LINE_CLASSIFICATION",path,"已记账分录尚未明确角色/分类依据。");Affect(l);if(map?.Semantic==LedgerAccountSemantic.IncomeExpense)allProfitLinesClassified=false;continue;}
            if(c.Role==SourceLineRole.BalanceOnly)
            {
                if(map.Semantic!=LedgerAccountSemantic.OtherBalance){Issue("NP_LINE_ROLE",path,"损益、净资产及前期调整分录不能标为普通余额对方行而被忽略。");Affect(l);allProfitLinesClassified=false;}
                continue;
            }
            if(!ValidTag(c.Classification)){Issue("NP_CLASSIFICATION",path,"缺明确类别或有效外部/法律限制ID、版本、项目及证据。");Affect(l);allProfitLinesClassified=false;continue;}
            if(c.Role is SourceLineRole.RecognizedActivity or SourceLineRole.IncomeExpenseClosing)
            {
                if(c.Role==SourceLineRole.IncomeExpenseClosing&&map.Semantic is LedgerAccountSemantic.UnrestrictedNetAssets or LedgerAccountSemantic.RestrictedNetAssets)continue;
                if(map.Semantic!=LedgerAccountSemantic.IncomeExpense||map.ActivityFact is not (>=ActivityFact.DonationIncome and <=ActivityFact.OtherExpense))
                {Issue("NP_LINE_ROLE",path,"普通损益/损益结转角色须引用明确收入费用科目。");Affect(l);allProfitLinesClassified=false;continue;}
                var income=map.ActivityFact<=ActivityFact.OtherIncome;
                entries.Add(new(SnapshotIdentity.EntryId(c.Source),l.Voucher.Date,map.ActivityFact.Value,income?Money.Sum([l.Line.Credit,-l.Line.Debit]):Money.Sum([l.Line.Debit,-l.Line.Credit]),
                    c.Classification,c.Role==SourceLineRole.IncomeExpenseClosing?ActivityEntryRole.IncomeExpenseClosing:ActivityEntryRole.RecognizedMovement,c.EvidenceReference,c.ComponentId));
            }
            else if(c.Role==SourceLineRole.PriorYearAdjustment)
            {
                if(map.Semantic!=LedgerAccountSemantic.PriorYearAdjustment){Issue("NP_LINE_ROLE",path,"前期调整事实须对应明确前期调整科目；机械结转不能重复列报。");Affect(l);continue;}
                entries.Add(new(SnapshotIdentity.EntryId(c.Source),l.Voucher.Date,ActivityFact.PriorYearNetAssetAdjustment,Money.Sum([l.Line.Credit,-l.Line.Debit]),c.Classification,ActivityEntryRole.RecognizedMovement,c.EvidenceReference));
            }
            else if(c.Role is SourceLineRole.ReleaseToUnrestricted or SourceLineRole.TransferToRestricted)
            {
                if(map.Semantic is not (LedgerAccountSemantic.UnrestrictedNetAssets or LedgerAccountSemantic.RestrictedNetAssets)||string.IsNullOrWhiteSpace(c.MovementGroupId))
                {Issue("NP_TRANSFER_GROUP",path,"转类须明确净资产科目、同凭证转类组及限制范围。");Affect(l);}
            }
            else if(c.Role==SourceLineRole.PriorYearAdjustmentClosing&&map.Semantic is not (LedgerAccountSemantic.PriorYearAdjustment or LedgerAccountSemantic.UnrestrictedNetAssets or LedgerAccountSemantic.RestrictedNetAssets))
            {Issue("NP_LINE_ROLE",path,"前期调整机械结转须在调整科目与对应净资产之间。");Affect(l);}
        }
        foreach(var role in new[]{SourceLineRole.IncomeExpenseClosing,SourceLineRole.PriorYearAdjustmentClosing})
            foreach(var group in located.Where(l=>l.Classification?.Role==role).GroupBy(l=>(l.Voucher.Id,Key:TagKey(l.Classification?.Classification))))
            {
                var expectedNet=group.First().Classification?.Classification?.Class==RestrictionClass.Restricted?LedgerAccountSemantic.RestrictedNetAssets:LedgerAccountSemantic.UnrestrictedNetAssets;
                var expectedSource=role==SourceLineRole.IncomeExpenseClosing?LedgerAccountSemantic.IncomeExpense:LedgerAccountSemantic.PriorYearAdjustment;
                if(group.Any(l=>!ValidTag(l.Classification?.Classification)||l.Account?.Semantic!=expectedNet&&l.Account?.Semantic!=expectedSource)||
                    !group.Any(l=>l.Account?.Semantic==expectedNet)||!group.Any(l=>l.Account?.Semantic==expectedSource)||Money.Sum(group.SelectMany(l=>new[]{l.Line.Debit,-l.Line.Credit}))!=0)
                {
                    Issue("NP_CLOSING_GROUP",group.Key.Id.ToString(),"结转须在同一限定范围的损益/前期调整与对应净资产间完整平衡，不得用结转角色隐藏业务。");
                    foreach(var l in group)Affect(l);closingGroupsValid=false;
                }
            }
        foreach(var group in located.Where(l=>l.Classification?.Role is SourceLineRole.ReleaseToUnrestricted or SourceLineRole.TransferToRestricted)
            .GroupBy(l=>(l.Voucher.Id,l.Classification!.Role,l.Classification.MovementGroupId)))
        {
            var restricted=group.Where(l=>l.Account?.Semantic==LedgerAccountSemantic.RestrictedNetAssets).ToArray();
            var unrestricted=group.Where(l=>l.Account?.Semantic==LedgerAccountSemantic.UnrestrictedNetAssets).ToArray();
            var release=group.Key.Role==SourceLineRole.ReleaseToUnrestricted;var fact=release?ActivityFact.ReleaseToUnrestricted:ActivityFact.TransferToRestricted;
            var amount=Money.Sum(restricted.SelectMany(l=>release?new[]{l.Line.Debit,-l.Line.Credit}:new[]{l.Line.Credit,-l.Line.Debit}));
            if(string.IsNullOrWhiteSpace(group.Key.MovementGroupId)||restricted.Length==0||unrestricted.Length==0||group.Count()!=restricted.Length+unrestricted.Length||amount<=0||
                restricted.Any(l=>!ValidTag(l.Classification?.Classification)||l.Classification!.Classification!.Class!=RestrictionClass.Restricted)||
                unrestricted.Any(l=>!ValidTag(l.Classification?.Classification)||l.Classification!.Classification!.Class!=RestrictionClass.Unrestricted)||
                restricted.Select(l=>TagKey(l.Classification?.Classification)).Distinct().Count()!=1||
                group.Any(l=>release?(l.Account?.Semantic==LedgerAccountSemantic.RestrictedNetAssets?l.Line.Credit!=0:l.Line.Debit!=0):(l.Account?.Semantic==LedgerAccountSemantic.RestrictedNetAssets?l.Line.Debit!=0:l.Line.Credit!=0))||
                Money.Sum(group.SelectMany(l=>new[]{l.Line.Debit,-l.Line.Credit}))!=0)
            {Issue("NP_TRANSFER_GROUP",group.Key.Id+"/"+group.Key.MovementGroupId,"双向转类组须同凭证、同限制范围、两类净资产方向相反且金额相等。");invalidFacts.Add(fact);continue;}
            var first=restricted[0];entries.Add(new(SnapshotIdentity.EntryId(first.Classification!.Source,"transfer:"+group.Key.MovementGroupId),first.Voucher.Date,fact,amount,
                first.Classification.Classification,ActivityEntryRole.RecognizedMovement,string.Join("；",group.Select(l=>l.Classification!.EvidenceReference))));
        }
        var profitAccounts=accounts.Values.Where(a=>a.Semantic==LedgerAccountSemantic.IncomeExpense).Select(a=>a.AccountCode).ToHashSet(StringComparer.Ordinal);
        var openClosed=profitAccounts.All(code=>opening.GetValueOrDefault(code)==0);
        var closed=openClosed&&allProfitLinesClassified&&closingGroupsValid&&located.Where(l=>profitAccounts.Contains(l.Line.AccountCode))
            .GroupBy(l=>(l.Line.AccountCode,Class:TagKey(l.Classification?.Classification))).All(g=>Money.Sum(g.SelectMany(l=>new[]{l.Line.Debit,-l.Line.Credit}))==0);
        if(accounts.Values.Where(a=>a.Semantic==LedgerAccountSemantic.PriorYearAdjustment).Any(a=>opening.GetValueOrDefault(a.AccountCode)!=0||closing.GetValueOrDefault(a.AccountCode)!=0))
        {Issue("NP_UNCLOSED_ADJUSTMENT","3201","前期调整尚未结入对应净资产。");closed=false;}
        if(snapshot.Book.StartMonth!=1)Issue("NP_PARTIAL_YEAR","Book.StartMonth","账套不是1月启用，当前快照不能证明1月年初与完整YTD；本版没有补造缺失月份。");
        var review=manifest.Review;
        if(!review.CompleteYearToDateConfirmed||!review.AccountMappingReviewed||!review.LineClassificationReviewed||string.IsNullOrWhiteSpace(review.EvidenceReference))
            Issue("NP_REVIEW_REQUIRED","Review","全年覆盖、科目/分录分类及复核依据尚未确认。");
        var covered=review.CompleteYearToDateConfirmed&&review.AccountMappingReviewed&&review.LineClassificationReviewed&&!string.IsNullOrWhiteSpace(review.EvidenceReference)&&snapshot.Book.StartMonth==1?
            Enum.GetValues<ActivityFact>().Where(f=>!invalidFacts.Contains(f)).ToHashSet():[];
        return new(snapshot,opening,closing,issues.AsReadOnly(),entries.AsReadOnly(),covered,closed,openClosed,unmappedBalance);
    }
    private BalanceSheetInput BalanceInput(Evaluation e,StatementContext context)
    {
        var mappings=manifest.BalanceMappings.ToDictionary(m=>m.Fact);var invalid=e.Issues.Where(i=>i.Code is "NP_BALANCE_SIGN" or "NP_BALANCE_MAPPING" or "NP_ANALYSIS_NOT_ALLOWED").Select(i=>i.Path).ToHashSet();
        BalanceColumnInput Column(bool opening)
        {
            var balances=opening?e.Opening:e.Closing;var facts=new List<BalanceFactValue>();
            foreach(var fact in Enum.GetValues<BalanceFact>())
            {
                decimal? amount=null;var detail="尚未明确映射/分析或确认零值。";var evidence="";
                if(mappings.TryGetValue(fact,out var m)&&!invalid.Contains(fact.ToString()))
                {
                    evidence=m.EvidenceReference;
                    if(opening&&e.Snapshot.Book.StartMonth!=1&&m.Mode!=BalanceMappingMode.ReviewedAnalysis)detail="启用月不是1月，不能把账套启用期初当作年初。";
                    else if(m.Mode==BalanceMappingMode.AccountBalances)amount=Money.Sum(m.Accounts.Select(t=>balances[t.AccountCode]*t.Coefficient));
                    else if(m.Mode==BalanceMappingMode.ReviewedAnalysis){amount=opening?m.YearOpeningAnalysis:m.ClosingAnalysis;detail="缺该日期明确的分析金额。";}
                    else if(m.Mode==BalanceMappingMode.ConfirmedZero&&!e.UnmappedBalance)amount=0;
                    else if(m.Mode==BalanceMappingMode.ConfirmedZero)detail="存在未归属余额，不能用确认零值掩盖未知归属。";
                }
                facts.Add(new(fact,amount,evidence,amount.HasValue?null:detail));
            }
            return new(opening?manifest.Period.YearStart:manifest.Period.To,facts,
                (opening?e.OpeningIncomeExpenseClosed:e.IncomeExpenseClosed)?IncomeExpenseClosingState.ClosedAndReconciled:IncomeExpenseClosingState.NotClosed,
                manifest.Review.YearOpeningBasis,manifest.Review.AccountMappingReviewed&&!string.IsNullOrWhiteSpace(manifest.Review.EvidenceReference),manifest.Review.EvidenceReference);
        }
        return new(context,Column(true),Column(false));
    }
    private ActivityStatementInput ActivityInput(Evaluation e,StatementContext context)
    {
        ActivityWindowInput Window(DateOnly from)=>new(from,manifest.Period.To,e.Entries.Where(x=>x.Date>=from),e.CoveredFacts,
            manifest.Review.EvidenceReference,manifest.Review.LineClassificationReviewed&&!string.IsNullOrWhiteSpace(manifest.Review.EvidenceReference),manifest.Review.BusinessBreakdownComplete,
            manifest.Review.FundraisingDisclosure,manifest.Review.RestrictedIncomeTaxTreatmentReviewed&&!string.IsNullOrWhiteSpace(manifest.Review.RestrictedIncomeTaxReviewEvidence),manifest.Review.RestrictedIncomeTaxReviewEvidence);
        return new(context,Window(manifest.Period.From),Window(manifest.Period.YearStart),manifest.Components);
    }
    public static bool CreditPositive(BalanceFact fact)=>fact>=BalanceFact.ShortTermBorrowings||fact is BalanceFact.ShortTermInvestmentAllowance or BalanceFact.BadDebtAllowance or BalanceFact.InventoryAllowance or
        BalanceFact.DueWithinYearInvestmentAllowance or BalanceFact.LongEquityAllowance or BalanceFact.LongDebtAllowance or BalanceFact.OtherLongInvestmentAllowance or BalanceFact.AccumulatedDepreciation or BalanceFact.FixedAssetImpairment or BalanceFact.AccumulatedAmortization or BalanceFact.IntangibleAssetImpairment;
    private static bool Supplemental(BalanceFact fact)=>fact is BalanceFact.AgencyMonetaryFunds or BalanceFact.LongDebtDueWithinYear or BalanceFact.OtherLongInvestmentDueWithinYear or BalanceFact.DueWithinYearInvestmentAllowance or
        BalanceFact.LongBorrowingsDueWithinYear or BalanceFact.LongPayablesDueWithinYear or BalanceFact.OtherLongLiabilitiesDueWithinYear;
    private static bool ValidTag(RestrictionTag? tag)=>tag is not null&&Enum.IsDefined(tag.Class)&&(tag.Class==RestrictionClass.Unrestricted?
        tag.RestrictionId is null&&tag.RestrictionVersion is null&&tag.SourceKind is null:
        !string.IsNullOrWhiteSpace(tag.RestrictionId)&&tag.RestrictionVersion>0&&!string.IsNullOrWhiteSpace(tag.ProjectId)&&
        tag.SourceKind is RestrictionSourceKind.ExternalProvider or RestrictionSourceKind.LawOrAdministrativeRegulation&&!string.IsNullOrWhiteSpace(tag.EvidenceReference));
    private static string TagKey(RestrictionTag? tag)=>tag is null?"missing":tag.Class==RestrictionClass.Unrestricted?"U":SnapshotIdentity.Hash(new{tag.RestrictionId,tag.RestrictionVersion,tag.ProjectId,tag.SourceKind});
}
