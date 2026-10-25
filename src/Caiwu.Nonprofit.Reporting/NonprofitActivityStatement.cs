namespace Caiwu.Nonprofit.Reporting;

/// <summary>2026 会民非02表; ordinary turnover is independent of whether closing has been posted.</summary>
public static class NonprofitActivityStatement
{
    private sealed record Definition(string Key, string Label, ActivityFact? Fact, bool Total, string Formula, string Locator);
    private static readonly Definition[] Definitions =
    [
        new("donation", "捐赠收入", ActivityFact.DonationIncome, false, "4101普通发生额，收入贷方正", "(1)"),
        new("membership", "会费收入", ActivityFact.MembershipIncome, false, "4201普通发生额", "(2)"),
        new("service", "提供服务收入", ActivityFact.ServiceIncome, false, "4301普通发生额", "(3)"),
        new("government", "政府补助收入", ActivityFact.GovernmentGrantIncome, false, "4401普通发生额", "(4)"),
        new("sales", "商品销售收入", ActivityFact.SalesIncome, false, "4501普通发生额", "(5)"),
        new("headquarters", "总部拨款收入", ActivityFact.HeadquartersGrantIncome, false, "4701普通发生额", "(6)"),
        new("investment", "投资收益", ActivityFact.InvestmentIncome, false, "4601贷方-借方普通发生额，净损失为负", "(7)"),
        new("other-income", "其他收入", ActivityFact.OtherIncome, false, "4901普通发生额", "(8)"),
        new("income.total", "收入合计", null, true, "8项收入之和，均不含损益结转", "表样"),
        new("business-cost", "业务活动成本", ActivityFact.BusinessActivityCost, false, "5101普通发生额，费用借方正；组成部分不重复计入费用", "(9)"),
        new("surcharges", "税金及附加", ActivityFact.TaxesAndSurcharges, false, "5201普通发生额", "(10)"),
        new("administration", "管理费用", ActivityFact.AdministrationExpense, false, "5301普通发生额", "(11)"),
        new("fundraising", "筹资费用", ActivityFact.FundraisingExpense, false, "5401普通发生额（包括募捐成本）", "(12)"),
        new("impairment", "资产减值损失", ActivityFact.AssetImpairmentLoss, false, "5501普通发生额（转回可为负）", "(13)"),
        new("income-tax", "所得税费用", ActivityFact.IncomeTaxExpense, false, "5601普通发生额；限定性税项需专门人工复核", "(14)"),
        new("other-expense", "其他费用", ActivityFact.OtherExpense, false, "有关费用科目普通发生额", "(15)"),
        new("expense.total", "费用合计", null, true, "7项费用之和，不再加其中项目", "表样"),
        new("release", "三、限定性净资产转为非限定性净资产", ActivityFact.ReleaseToUnrestricted, false, "已审解除：非限定性+金额，限定性-金额，合计0", "(16)"),
        new("designation", "四、非限定性净资产转为限定性净资产", ActivityFact.TransferToRestricted, false, "已审增设限制：非限定性-金额，限定性+金额，合计0", "(17)"),
        new("prior-adjustment", "五、以前年度净资产调整", ActivityFact.PriorYearNetAssetAdjustment, false, "3201影响按最终净资产类别分析，增加为正、减少为负", "(18)"),
        new("net-change", "六、净资产变动额", null, true, "收入合计-费用合计+解除+增设限制+以前年度调整（逐列）", "(19)")
    ];

    public static NonprofitStatement Calculate(ActivityStatementInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var ctx = input.Context; var p = ctx.Period;
        CheckWindow(input.Current, p.From, p.To, "Current");
        CheckWindow(input.YearToDate, p.YearStart, p.To, "YearToDate");
        var issues = new List<MissingReason>();
        if (input.Current is { } current && input.YearToDate is { } ytd)
        {
            var slice = ytd.Entries.Where(e => e.Date >= p.From).ToDictionary(e => e.EntryId);
            if (slice.Count != current.Entries.Count || current.Entries.Any(e => !slice.TryGetValue(e.EntryId, out var other) || e != other))
                throw new ArgumentException("本期与本年累计重叠部分的稳定发生额ID/数据不一致，不能输出相互矛盾口径。");
        }
        var currentValues = CalculateWindow(input.Current, input, "Current");
        var ytdValues = CalculateWindow(input.YearToDate, input, "YearToDate");
        Dictionary<string, StatementValue[]>? prior = null;
        var comparative = ComparativeState.NotRequested;
        var annual = p.Kind == ReportingPeriodKind.Annual;
        if (annual)
        {
            if (input.PriorYearComparison is not null)
            {
                CheckWindow(input.PriorYearComparison, new(p.To.Year - 1, 1, 1), new(p.To.Year - 1, 12, 31), "PriorYear");
                prior = CalculateWindow(input.PriorYearComparison, input, "PriorYear");
                comparative = ComparativeState.Supplied;
            }
            else comparative = p.To.Year == 2026 ? ComparativeState.NotRequiredOn2026FirstAdoption : ComparativeState.Missing;
        }
        else if (input.PriorYearComparison is not null)
            throw new ArgumentException("本版仅支持年度比较数；中期比较列尚未实现，不能静默丢弃已传比较资料。");
        var columns = new List<StatementColumn>();
        if (!annual) AddColumns(columns, "current", p.CurrentLabel);
        AddColumns(columns, "ytd", annual ? "本年金额" : "本年累计数");
        if (prior is not null || comparative == ComparativeState.Missing) columns.Add(new("prior.total", "上年比较数（合计）"));
        var definitions = new List<Definition>();
        foreach (var d in Definitions)
        {
            definitions.Add(d);
            if (d.Key == "business-cost")
                definitions.AddRange(input.Components.Where(c => c.Kind != ActivityComponentKind.FundraisingCost)
                    .Select(c => new Definition("component:" + c.Id,
                        c.Kind == ActivityComponentKind.CharitableTrustEstablishment ? "其中：设立慈善信托支出（" + c.Label + "）" : "其中：" + c.Label,
                        ActivityFact.BusinessActivityCost, false, "5101对应组成发生额，为业务活动成本子集", "(9)，第144—145页")));
            if (d.Key == "fundraising")
                definitions.AddRange(input.Components.Where(c => c.Kind == ActivityComponentKind.FundraisingCost)
                    .Select(c => new Definition("component:" + c.Id, "其中：募捐成本（" + c.Label + "）",
                        ActivityFact.FundraisingExpense, false, "5401对应募捐成本发生额，为筹资费用子集", "(12)，第145页")));
        }
        var lines = definitions.Select((d, i) =>
        {
            var values = new List<StatementValue>();
            if (!annual) values.AddRange(currentValues[d.Key]);
            values.AddRange(ytdValues[d.Key]);
            if (prior is not null) values.Add(prior[d.Key][2]);
            else if (comparative == ComparativeState.Missing)
                values.Add(StatementValue.Missing("NP_COMPARATIVE", "PriorYear", "2026首次执行例外不能沿用到以后年度；缺按本年口径调整的上年比较数。"));
            return new StatementLine(d.Key, i + 1, d.Label,
                d.Fact is { } f && f <= ActivityFact.OtherIncome || d.Key == "income.total" ? "收入" :
                d.Fact is { } expense && expense <= ActivityFact.OtherExpense || d.Key == "expense.total" ? "费用" : "净资产变动",
                d.Total, d.Formula, "正式PDF第130—131页表样；第142—146页说明" + d.Locator,
                Array.AsReadOnly(values.ToArray()));
        }).ToArray();
        return new("业务活动表（2026制度计算预览）", "会民非02表", ctx, columns, lines, issues, comparative);
    }

    private static void AddColumns(List<StatementColumn> columns, string key, string title)
    {
        columns.Add(new(key + ".unrestricted", title + "·非限定性"));
        columns.Add(new(key + ".restricted", title + "·限定性"));
        columns.Add(new(key + ".total", title + "·合计"));
    }
    private static void CheckWindow(ActivityWindowInput? window, DateOnly from, DateOnly to, string name)
    {
        if (window is not null && (window.From != from || window.To != to))
            throw new ArgumentException(name + "覆盖期间必须精确为" + from + "至" + to + "，不能把本期数冒充累计。");
    }

    private static Dictionary<string, StatementValue[]> CalculateWindow(ActivityWindowInput? window, ActivityStatementInput input, string path)
    {
        var result = new Dictionary<string, StatementValue[]>(StringComparer.Ordinal);
        var components = input.Components.ToDictionary(c => c.Id, StringComparer.Ordinal);
        var ordinary = window?.Entries.Where(e => e.Role == ActivityEntryRole.RecognizedMovement).ToArray() ?? [];
        StatementValue Calc(ActivityFact fact, RestrictionClass cls, string? componentId = null)
        {
            var target = path + "." + fact + "." + cls;
            if (window is null) return StatementValue.Missing("NP_ACTIVITY_WINDOW", path, "缺完整发生额期间数据。");
            if (!input.Context.CnyAmountsConfirmed) return StatementValue.Missing("NP_CURRENCY", path, "尚未确认人民币元口径。");
            if (!window.CoveredFacts.Contains(fact)) return StatementValue.Missing("NP_ACTIVITY_COVERAGE", target, "未声明此项目（含两类及明确零发生额）的完整覆盖。");
            if (!window.ClassificationReviewed) return StatementValue.Missing("NP_CLASSIFICATION_REVIEW", target, "限定性/非限定性分类与确认计量尚未人工复核。");
            var entries = ordinary.Where(e => e.Fact == fact).ToArray();
            if (entries.Any(e => !ValidTag(e.Classification)))
                return StatementValue.Missing("NP_CLASSIFICATION", target, "发生额缺有效类别或外部/法律限制ID、版本、项目与证据；不能按总额猜分。");
            if (fact is ActivityFact.ReleaseToUnrestricted or ActivityFact.TransferToRestricted &&
                entries.Any(e => e.Classification!.Class != RestrictionClass.Restricted))
                return StatementValue.Missing("NP_TRANSFER_SCOPE", target, "双向转类须绑定具体限定范围及已审业务证据，不能用普通3101/3102发生额猜测。");
            if (fact == ActivityFact.BusinessActivityCost && (!window.BusinessBreakdownComplete || entries.Any(e =>
                e.ComponentId is null || !components.TryGetValue(e.ComponentId, out var c) || c.Kind == ActivityComponentKind.FundraisingCost)))
                return StatementValue.Missing("NP_BUSINESS_BREAKDOWN", target, "业务活动成本缺项目/服务/业务组成（含设立慈善信托支出）完整明细。");
            if (fact == ActivityFact.FundraisingExpense && (window.FundraisingDisclosure == FundraisingDisclosure.Unknown ||
                entries.Any(e => e.ComponentId is not null && (!components.TryGetValue(e.ComponentId, out var c) || c.Kind != ActivityComponentKind.FundraisingCost)) ||
                window.FundraisingDisclosure == FundraisingDisclosure.NotApplicableConfirmed && entries.Any(e => e.ComponentId is not null) ||
                window.FundraisingDisclosure == FundraisingDisclosure.RequiredAndClassified && !components.Values.Any(c => c.Kind == ActivityComponentKind.FundraisingCost)))
                return StatementValue.Missing("NP_FUNDRAISING_DETAIL", target, "募捐成本披露适用性或明细尚不明确。");
            if (fact == ActivityFact.IncomeTaxExpense && cls == RestrictionClass.Restricted &&
                entries.Any(e => e.Classification!.Class == cls && e.Amount != 0) && !window.RestrictedIncomeTaxTreatmentReviewed)
                return StatementValue.Missing("NP_RESTRICTED_TAX_REVIEW", target, "5601专门说明与一般分类说明需专门复核，不能宣称自动支持限定性所得税处理。");
            if (componentId is not null) entries = entries.Where(e => e.ComponentId == componentId).ToArray();
            if (fact is ActivityFact.ReleaseToUnrestricted or ActivityFact.TransferToRestricted)
            {
                var amount = Money.Sum(entries.Select(e => e.Amount));
                var positive = fact == ActivityFact.ReleaseToUnrestricted ? cls == RestrictionClass.Unrestricted : cls == RestrictionClass.Restricted;
                return StatementValue.Known(positive ? amount : -amount);
            }
            return StatementValue.Known(Money.Sum(entries.Where(e => e.Classification!.Class == cls).Select(e => e.Amount)));
        }
        StatementValue[] Pair(ActivityFact f, string? component = null)
        {
            var u = Calc(f, RestrictionClass.Unrestricted, component); var r = Calc(f, RestrictionClass.Restricted, component);
            return [u, r, StatementValue.Sum(u, r)];
        }
        foreach (var d in Definitions.Where(d => d.Fact.HasValue)) result.Add(d.Key, Pair(d.Fact!.Value));
        foreach (var c in input.Components) result.Add("component:" + c.Id, Pair(c.Kind == ActivityComponentKind.FundraisingCost ? ActivityFact.FundraisingExpense : ActivityFact.BusinessActivityCost, c.Id));
        void Sum(string key, IEnumerable<string> keys)
        {
            var selected = keys.ToArray();
            result.Add(key, Enumerable.Range(0, 3).Select(i => StatementValue.Sum(selected.Select(k => result[k][i]))).ToArray());
        }
        Sum("income.total", Definitions.Where(d => d.Fact is { } f && f <= ActivityFact.OtherIncome).Select(d => d.Key));
        Sum("expense.total", Definitions.Where(d => d.Fact is >= ActivityFact.BusinessActivityCost and <= ActivityFact.OtherExpense).Select(d => d.Key));
        result.Add("net-change", Enumerable.Range(0, 3).Select(i => StatementValue.Sum(result["income.total"][i], result["expense.total"][i].Negate(),
            result["release"][i], result["designation"][i], result["prior-adjustment"][i])).ToArray());
        return result;
    }

    private static bool ValidTag(RestrictionTag? tag)
    {
        if (tag is null || !Enum.IsDefined(tag.Class)) return false;
        if (tag.Class == RestrictionClass.Unrestricted)
            return tag.RestrictionId is null && tag.RestrictionVersion is null && tag.SourceKind is null;
        return !string.IsNullOrWhiteSpace(tag.RestrictionId) && tag.RestrictionVersion > 0 && !string.IsNullOrWhiteSpace(tag.ProjectId) &&
            tag.SourceKind is RestrictionSourceKind.ExternalProvider or RestrictionSourceKind.LawOrAdministrativeRegulation && !string.IsNullOrWhiteSpace(tag.EvidenceReference);
    }
}
