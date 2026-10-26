using System.Text.Json;
using Caiwu.Nonprofit.Writable;

namespace Caiwu.Nonprofit.Reporting;

/// <summary>Reads actual saved posted entries with permanent line identity and explicit classifications.
/// Drafts/reviewed vouchers never become report movements. Source changes invalidate the review.</summary>
public sealed class WritableNonprofitStatementDataSource : INonprofitStatementDataSource
{
    private readonly Func<NonprofitLedgerSnapshot> read;
    private readonly WritableStatementReview review;
    private readonly string evidence;
    public WritableNonprofitStatementDataSource(Func<NonprofitLedgerSnapshot> read, WritableStatementReview review)
    {
        this.read = read ?? throw new ArgumentNullException(nameof(read));
        ArgumentNullException.ThrowIfNull(review);
        // Freeze all caller-owned collections, including evidence and components.
        this.review = JsonSerializer.Deserialize<WritableStatementReview>(JsonSerializer.SerializeToUtf8Bytes(review))!;
        if (review.BalanceAnalyses is null || review.Components is null || review.SourceLimitations is null || review.Period is null ||
            review.ReviewedAt == default || !Enum.IsDefined(review.FundraisingDisclosure) || !Enum.IsDefined(review.YearOpeningBasis) ||
            review.BalanceAnalyses.Any(a => a is null || !Enum.IsDefined(a.Fact) || string.IsNullOrWhiteSpace(a.EvidenceReference)) ||
            review.BalanceAnalyses.Select(a => a.Fact).Distinct().Count() != review.BalanceAnalyses.Count)
            throw new ArgumentException("复核结构、分析身份、证据或期间无效。");
        if ((review.MappingReviewed || review.ClassificationReviewed || review.AccountPopulationCompleteConfirmed || review.CompleteYearToDateConfirmed) && string.IsNullOrWhiteSpace(review.EvidenceReference))
            throw new ArgumentException("复核确认须保存明确证据。");
        if (review.BalanceAnalyses.Any(a => Direct.ContainsKey(a.Fact)))
            throw new ArgumentException("基础科目余额只能直接取自账簿，不能手填覆盖。");
        evidence = "writable-ledger:" + review.SnapshotSha256 + ";review:" +
            Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(this.review)));
        _ = Capture();
    }
    private NonprofitLedgerSnapshot Capture()
    {
        var snapshot = JsonSerializer.Deserialize<NonprofitLedgerSnapshot>(JsonSerializer.SerializeToUtf8Bytes(read()))!;
        NonprofitLedgerValidation.Validate(snapshot);
        if (snapshot.BookId != review.BookId || snapshot.Revision != review.Revision || WritableLedgerIdentity.Sha256(snapshot) != review.SnapshotSha256)
            throw new ClassificationStaleException("完整账簿/维度/来源字段已经改变，请重新核对分类与分析。");
        if (review.Period.To.Year != snapshot.FiscalYear || review.Period.From.Month < snapshot.StartMonth)
            throw new ArgumentException("报告期间超出账套启用范围。");
        return snapshot;
    }
    public void RequireCurrentSource() => _ = Capture();
    public StatementContext CreateContext(DateTimeOffset at) => Context(Capture(), at);
    private StatementContext Context(NonprofitLedgerSnapshot s, DateTimeOffset at)
    {
        var issues = review.SourceLimitations.ToList();
        if (!review.AccountPopulationCompleteConfirmed) issues.Add(new("NP_ACCOUNT_POPULATION", "Accounts", "尚未确认全部科目及业务记录已完整接入；缺科目不能自动解释为零。"));
        if (s.StartMonth != 1) issues.Add(new("NP_YEAR_OPENING", "Opening", "年中启用余额不是年初余额，缺启用前完整年度发生额。"));
        if (s.Vouchers.Any(v => v.State == NonprofitVoucherState.Posted && v.Date <= review.Period.To && v.Role == NonprofitMovementRole.Activity && v.Lines.Any(l => s.Accounts.Single(a => a.Code == l.AccountCode).Kind == NonprofitAccountKind.NetAsset)))
            issues.Add(new("NP_DIRECT_NET_ASSET", "Vouchers", "存在直接净资产业务，未纳入本切片业务活动表组成；不得倒挤勾稽。"));
        return new(s.BookId, s.BookName, s.Revision, review.Period, at, StatementSourceKind.PostedLedger,
            evidence, review.CnyAmountsConfirmed, issues);
    }
    private void RequireContext(NonprofitLedgerSnapshot s, StatementContext context)
    {
        if (context.BookId != s.BookId || context.SourceLedgerRevision != s.Revision || context.Period != review.Period ||
            context.SourceKind != StatementSourceKind.PostedLedger || context.SourceEvidenceReference != evidence)
            throw new ArgumentException("请使用本数据源当前账簿与复核生成的上下文。");
    }
    public BalanceSheetInput ReadBalanceSheet(StatementContext context)
    { var s = Capture(); RequireContext(s, context); return Balance(s, Context(s, context.GeneratedAt)); }
    public ActivityStatementInput ReadActivityStatement(StatementContext context)
    { var s = Capture(); RequireContext(s, context); return Activity(s, Context(s, context.GeneratedAt)); }
    public NonprofitStatementSet Calculate(DateTimeOffset at)
    {
        var s = Capture(); var context = Context(s, at);
        var result = NonprofitStatementReconciliation.Compare(NonprofitBalanceSheet.Calculate(Balance(s, context)), NonprofitActivityStatement.Calculate(Activity(s, context)));
        RequireCurrentSource(); return result;
    }

    private BalanceSheetInput Balance(NonprofitLedgerSnapshot s, StatementContext context)
    {
        var opening = s.Opening.GroupBy(o => o.AccountCode).ToDictionary(g => g.Key, g => Money.Sum(g.Select(o => o.Debit - o.Credit)));
        var closing = NonprofitLedgerService.Balances(s, review.Period.To).GroupBy(b => b.AccountCode).ToDictionary(g => g.Key, g => Money.Sum(g.Select(b => b.NetDebit)));
        decimal Root(Dictionary<string, decimal> source, string root) => Money.Sum(s.Accounts.Where(a => a.OfficialRoot == root && !s.Accounts.Any(c => c.ParentCode == a.Code)).Select(a => source.GetValueOrDefault(a.Code)));
        BalanceColumnInput Column(bool first)
        {
            var source = first ? opening : closing; var facts = new List<BalanceFactValue>();
            foreach (var fact in Enum.GetValues<BalanceFact>())
            {
                if (Direct.TryGetValue(fact, out var term))
                {
                    var present = s.Accounts.Any(a => a.OfficialRoot == term.Root);
                    var known = (!first || s.StartMonth == 1) && (present || review.AccountPopulationCompleteConfirmed);
                    facts.Add(new(fact, known ? term.Sign * Root(source, term.Root) : null, evidence,
                        known ? null : "缺年初来源或未确认科目全集，不能把缺项视为零。"));
                }
                else
                {
                    var analysis = review.BalanceAnalyses.SingleOrDefault(a => a.Fact == fact);
                    var value = first ? analysis?.YearOpening : analysis?.Closing;
                    if (first && s.StartMonth != 1) value = null;
                    facts.Add(new(fact, value, analysis?.EvidenceReference ?? "", value.HasValue ? null : analysis?.MissingDetail ?? "缺经复核的受托/减值归属/到期等分析；包括零也须明确确认。"));
                }
            }
            // 1421 is one ledger allowance; its allocations must neither disappear nor double count.
            var allowances = new[] { BalanceFact.LongEquityAllowance, BalanceFact.LongDebtAllowance, BalanceFact.OtherLongInvestmentAllowance, BalanceFact.DueWithinYearInvestmentAllowance };
            var allocated = facts.Where(f => allowances.Contains(f.Fact)).ToArray();
            if (allocated.All(f => f.Amount.HasValue) && Money.Sum(allocated.Select(f => f.Amount!.Value)) != -Root(source, "1421"))
                for (var i = 0; i < facts.Count; i++)
                    if (allowances.Contains(facts[i].Fact)) facts[i] = new(facts[i].Fact, null, "", "1421减值分配之和与已记账原科目余额不符。");
            var classified = first ? s.Opening.Select(o => new NonprofitAccountBalance(o.AccountCode, o.Classification, o.Debit - o.Credit))
                .GroupBy(b => (b.AccountCode, b.Classification)).Select(g => new NonprofitAccountBalance(g.Key.AccountCode, g.Key.Classification, Money.Sum(g.Select(b => b.NetDebit))))
                : NonprofitLedgerService.Balances(s, review.Period.To);
            var closed = !classified.Any(b => s.Accounts.Single(a => a.Code == b.AccountCode).Kind is NonprofitAccountKind.Income or NonprofitAccountKind.Expense && b.NetDebit != 0);
            return new(first ? review.Period.YearStart : review.Period.To, facts,
                closed && s.OpeningConfirmed ? IncomeExpenseClosingState.ClosedAndReconciled : IncomeExpenseClosingState.NotClosed,
                review.YearOpeningBasis, review.MappingReviewed && review.AccountPopulationCompleteConfirmed, review.EvidenceReference);
        }
        return new(context, Column(true), Column(false));
    }

    private ActivityStatementInput Activity(NonprofitLedgerSnapshot s, StatementContext context)
    {
        var entries = new List<ActivityEntry>();
        foreach (var v in s.Vouchers.Where(v => v.State == NonprofitVoucherState.Posted && v.Date <= review.Period.To))
        foreach (var l in v.Lines)
        {
            var a = s.Accounts.Single(a => a.Code == l.AccountCode);
            if (!ActivityRoots.TryGetValue(a.OfficialRoot, out var fact)) continue;
            RestrictionTag? tag = null;
            if (l.Classification is { } c)
            {
                var restriction = s.Restrictions.SingleOrDefault(r => r.Id == c.RestrictionId && r.Version == c.RestrictionVersion);
                tag = new((RestrictionClass)(int)c.Class, c.RestrictionId, c.RestrictionVersion, c.ProjectId,
                    restriction is null ? null : (RestrictionSourceKind)(int)restriction.SourceKind,
                    restriction?.EvidenceReference ?? v.EvidenceReference);
            }
            entries.Add(new(l.Id, v.Date, fact, a.Kind == NonprofitAccountKind.Income ? l.Credit - l.Debit : l.Debit - l.Credit,
                tag, v.Role == NonprofitMovementRole.IncomeExpenseClosing ? ActivityEntryRole.IncomeExpenseClosing : ActivityEntryRole.RecognizedMovement,
                v.EvidenceReference, l.ComponentId));
        }
        ActivityWindowInput Window(DateOnly from) => new(from, review.Period.To, entries.Where(e => e.Date >= from),
            review.CompleteYearToDateConfirmed && review.AccountPopulationCompleteConfirmed && s.StartMonth == 1 ? Enum.GetValues<ActivityFact>() : [],
            review.EvidenceReference, review.ClassificationReviewed, review.BusinessBreakdownComplete, review.FundraisingDisclosure,
            review.RestrictedIncomeTaxTreatmentReviewed, review.RestrictedIncomeTaxReviewEvidence);
        return new(context, Window(review.Period.From), Window(review.Period.YearStart), review.Components);
    }
    private static readonly IReadOnlyDictionary<string, ActivityFact> ActivityRoots = new Dictionary<string, ActivityFact>
    {
        ["4101"]=ActivityFact.DonationIncome, ["4201"]=ActivityFact.MembershipIncome, ["4301"]=ActivityFact.ServiceIncome,
        ["4401"]=ActivityFact.GovernmentGrantIncome, ["4501"]=ActivityFact.SalesIncome, ["4701"]=ActivityFact.HeadquartersGrantIncome,
        ["4601"]=ActivityFact.InvestmentIncome, ["4901"]=ActivityFact.OtherIncome, ["5101"]=ActivityFact.BusinessActivityCost,
        ["5201"]=ActivityFact.TaxesAndSurcharges, ["5301"]=ActivityFact.AdministrationExpense, ["5401"]=ActivityFact.FundraisingExpense,
        ["5501"]=ActivityFact.AssetImpairmentLoss, ["5601"]=ActivityFact.IncomeTaxExpense, ["5901"]=ActivityFact.OtherExpense
    };
    private static readonly IReadOnlyDictionary<BalanceFact, (string Root, int Sign)> Direct = new Dictionary<BalanceFact, (string, int)>
    {
        [BalanceFact.Cash]=("1001",1), [BalanceFact.BankDeposits]=("1002",1), [BalanceFact.OtherMonetaryFunds]=("1009",1),
        [BalanceFact.ShortTermInvestments]=("1101",1), [BalanceFact.ShortTermInvestmentAllowance]=("1102",-1),
        [BalanceFact.NotesReceivable]=("1111",1), [BalanceFact.AccountsReceivable]=("1121",1), [BalanceFact.OtherReceivables]=("1122",1), [BalanceFact.BadDebtAllowance]=("1131",-1),
        [BalanceFact.Prepayments]=("1141",1), [BalanceFact.Inventory]=("1201",1), [BalanceFact.InventoryAllowance]=("1202",-1), [BalanceFact.PrepaidExpenses]=("1301",1),
        [BalanceFact.LongEquityInvestments]=("1401",1), [BalanceFact.LongDebtInvestments]=("1402",1), [BalanceFact.OtherLongInvestments]=("1403",1),
        [BalanceFact.FixedAssetCost]=("1501",1), [BalanceFact.AccumulatedDepreciation]=("1502",-1), [BalanceFact.ConstructionInProgress]=("1505",1),
        [BalanceFact.HeritageResources]=("1506",1), [BalanceFact.FixedAssetDisposal]=("1509",1), [BalanceFact.IntangibleAssetCost]=("1601",1),
        [BalanceFact.AccumulatedAmortization]=("1602",-1), [BalanceFact.LongTermPrepaidExpenses]=("1701",1), [BalanceFact.DedicatedAgencyAssets]=("1801",1),
        [BalanceFact.ShortTermBorrowings]=("2101",-1), [BalanceFact.NotesPayable]=("2201",-1), [BalanceFact.AccountsPayable]=("2202",-1),
        [BalanceFact.ReceiptsInAdvance]=("2203",-1), [BalanceFact.EmployeeBenefitsPayable]=("2204",-1), [BalanceFact.TaxesPayable]=("2206",-1),
        [BalanceFact.OtherPayables]=("2209",-1), [BalanceFact.AccruedExpenses]=("2301",-1), [BalanceFact.LongBorrowings]=("2501",-1),
        [BalanceFact.LongPayables]=("2502",-1), [BalanceFact.Provisions]=("2503",-1), [BalanceFact.AgencyLiabilities]=("2601",-1),
        [BalanceFact.UnrestrictedNetAssets]=("3101",-1), [BalanceFact.RestrictedNetAssets]=("3102",-1)
    };
}
