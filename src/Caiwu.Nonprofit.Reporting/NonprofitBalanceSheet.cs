namespace Caiwu.Nonprofit.Reporting;

/// <summary>2026 form 会民非01表; official PDF128–129 and instructions134–142.</summary>
public static class NonprofitBalanceSheet
{
    public static NonprofitStatement Calculate(BalanceSheetInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(input.Context);
        ArgumentNullException.ThrowIfNull(input.YearOpening);
        ArgumentNullException.ThrowIfNull(input.Closing);
        var ctx = input.Context;
        if (input.YearOpening.Date != ctx.Period.YearStart || input.Closing.Date != ctx.Period.To)
            throw new ArgumentException("年初余额必须为同年1月1日；期末余额必须为报告期末，不能拿本期期初替代年初。");
        var opening = CalculateColumn(input.YearOpening, ctx, true);
        var closing = CalculateColumn(input.Closing, ctx, false);
        var issues = new List<MissingReason>();
        foreach (var column in new[] { (Values: opening, Name: "年初"), (Values: closing, Name: "期末") })
        {
            var a = column.Values["assets.total"].Amount;
            var b = column.Values["liabilities-net-assets.total"].Amount;
            if (a.HasValue && b.HasValue && a != b)
                issues.Add(new("NP_BALANCE_EQUATION", column.Name, "资产总计与负债和净资产总计不等；不得以差额倒挤净资产。"));
        }
        var lines = Definitions.Select((d, i) => new StatementLine(d.Key, i + 1, d.Label, d.Section, d.Total,
            d.Formula, $"正式PDF第128—129页表样；第134—142页填列说明{d.Locator}",
            Array.AsReadOnly(new[] { opening[d.Key], closing[d.Key] }))).ToArray();
        return new("资产负债表（2026制度计算预览）", "会民非01表", ctx,
            [new("year-opening", "年初余额"), new("closing", "期末余额")], lines, issues);
    }

    private static Dictionary<string, StatementValue> CalculateColumn(BalanceColumnInput input, StatementContext ctx, bool opening)
    {
        var facts = input.Facts.ToDictionary(f => f.Fact);
        var result = new Dictionary<string, StatementValue>(StringComparer.Ordinal);
        var path = opening ? "YearOpening" : "Closing";
        var invalid = new Dictionary<BalanceFact, string>();
        void Maturity(BalanceFact gross, BalanceFact due)
        {
            if (facts.TryGetValue(due, out var d) && d.Amount is { } amount &&
                (amount < 0 || facts.TryGetValue(gross, out var g) && g.Amount is { } total && amount > total))
            { invalid[gross] = invalid[due] = "一年内到期部分为负或超过对应总余额，需复核到期分析。"; }
        }
        Maturity(BalanceFact.LongDebtInvestments, BalanceFact.LongDebtDueWithinYear);
        Maturity(BalanceFact.OtherLongInvestments, BalanceFact.OtherLongInvestmentDueWithinYear);
        Maturity(BalanceFact.LongBorrowings, BalanceFact.LongBorrowingsDueWithinYear);
        Maturity(BalanceFact.LongPayables, BalanceFact.LongPayablesDueWithinYear);
        Maturity(BalanceFact.OtherLongLiabilities, BalanceFact.OtherLongLiabilitiesDueWithinYear);
        foreach (var fact in new[] { BalanceFact.AgencyMonetaryFunds, BalanceFact.ShortTermInvestmentAllowance,
            BalanceFact.BadDebtAllowance, BalanceFact.InventoryAllowance, BalanceFact.LongEquityAllowance,
            BalanceFact.LongDebtAllowance, BalanceFact.OtherLongInvestmentAllowance, BalanceFact.DueWithinYearInvestmentAllowance,
            BalanceFact.AccumulatedDepreciation, BalanceFact.FixedAssetImpairment, BalanceFact.AccumulatedAmortization, BalanceFact.IntangibleAssetImpairment })
            if (facts.TryGetValue(fact, out var supplied) && supplied.Amount is < 0)
                invalid[fact] = "抵减准备、累计折旧/摊销或受托货币明细余额为负，需复核，不能自动作为反向加项。";
        StatementValue F(BalanceFact fact)
        {
            if (!ctx.CnyAmountsConfirmed) return StatementValue.Missing("NP_CURRENCY", path, "尚未确认金额已按制度折算为人民币元。");
            if (!input.MappingReviewed) return StatementValue.Missing("NP_MAPPING_REVIEW", path, "余额取数、明细归属及不重计尚未复核。");
            if (opening && (input.OpeningBasis == YearOpeningBasis.Unknown ||
                ctx.Period.To.Year != 2026 && input.OpeningBasis == YearOpeningBasis.Reviewed2026TransitionLedger))
                return StatementValue.Missing("NP_YEAR_OPENING", path, "缺按本年制度调整的上年末报表/2026新账年初依据。");
            if (invalid.TryGetValue(fact, out var invalidReason))
                return StatementValue.Missing("NP_BALANCE_ANALYSIS", path + "." + fact, invalidReason);
            if (!facts.TryGetValue(fact, out var f))
                return StatementValue.Missing("NP_BALANCE_FACT", path + "." + fact, "未提供事实（包括经确认的零余额）；缺失不能默认0。");
            return f.Amount is { } amount ? StatementValue.Known(amount) :
                StatementValue.Missing("NP_BALANCE_FACT", path + "." + fact, f.MissingDetail!);
        }
        StatementValue Sum(params BalanceFact[] fs) => StatementValue.Sum(fs.Select(F));
        StatementValue Sub(BalanceFact a, params BalanceFact[] subtract) => StatementValue.Sum(new[] { F(a) }.Concat(subtract.Select(x => F(x).Negate())));
        void Put(string key, StatementValue value) => result.Add(key, value);
        void Total(string key, params string[] components) => Put(key, StatementValue.Sum(components.Select(k => result[k])));
        Put("cash", StatementValue.Sum(F(BalanceFact.Cash), F(BalanceFact.BankDeposits), F(BalanceFact.OtherMonetaryFunds), F(BalanceFact.AgencyMonetaryFunds).Negate()));
        Put("short-investments", Sub(BalanceFact.ShortTermInvestments, BalanceFact.ShortTermInvestmentAllowance));
        Put("receivables", StatementValue.Sum(F(BalanceFact.NotesReceivable), F(BalanceFact.AccountsReceivable), F(BalanceFact.OtherReceivables), F(BalanceFact.BadDebtAllowance).Negate()));
        Put("prepayments", F(BalanceFact.Prepayments));
        Put("inventory", Sub(BalanceFact.Inventory, BalanceFact.InventoryAllowance));
        Put("prepaid-expenses", F(BalanceFact.PrepaidExpenses));
        Put("investments-due", StatementValue.Sum(F(BalanceFact.LongDebtDueWithinYear), F(BalanceFact.OtherLongInvestmentDueWithinYear), F(BalanceFact.DueWithinYearInvestmentAllowance).Negate()));
        Put("other-current-assets", F(BalanceFact.OtherCurrentAssets));
        Total("current-assets.total", "cash", "short-investments", "receivables", "prepayments", "inventory", "prepaid-expenses", "investments-due", "other-current-assets");
        Put("long-equity", Sub(BalanceFact.LongEquityInvestments, BalanceFact.LongEquityAllowance));
        Put("long-debt", Sub(BalanceFact.LongDebtInvestments, BalanceFact.LongDebtAllowance, BalanceFact.LongDebtDueWithinYear));
        Put("long-other", Sub(BalanceFact.OtherLongInvestments, BalanceFact.OtherLongInvestmentAllowance, BalanceFact.OtherLongInvestmentDueWithinYear));
        // The literal instructions mention maturity allowances in both descriptions. Until their allocation is
        // reviewed, refuse the affected noncurrent totals rather than double deduct a current allowance.
        var dueAllowance = F(BalanceFact.DueWithinYearInvestmentAllowance);
        if (dueAllowance.Amount is null || dueAllowance.Amount != 0)
        {
            var value = dueAllowance.Amount is null ? dueAllowance : StatementValue.Missing("NP_MATURITY_IMPAIRMENT_REVIEW", path,
                "一年内到期投资存在减值准备，需复核其与长期投资减值归属；本版不自动重复扣减或猜测分摊。");
            result["long-debt"] = result["long-other"] = value;
        }
        Total("long-investments.total", "long-equity", "long-debt", "long-other");
        Put("fixed.cost", F(BalanceFact.FixedAssetCost));
        Put("fixed.depreciation", F(BalanceFact.AccumulatedDepreciation));
        Put("fixed.net", Sub(BalanceFact.FixedAssetCost, BalanceFact.AccumulatedDepreciation, BalanceFact.FixedAssetImpairment));
        Put("construction", F(BalanceFact.ConstructionInProgress));
        Put("fixed.disposal", F(BalanceFact.FixedAssetDisposal));
        Total("fixed.total", "fixed.net", "construction", "fixed.disposal");
        Put("heritage", F(BalanceFact.HeritageResources));
        Put("intangible.cost", F(BalanceFact.IntangibleAssetCost));
        Put("intangible.amortization", F(BalanceFact.AccumulatedAmortization));
        Put("intangible.net", Sub(BalanceFact.IntangibleAssetCost, BalanceFact.AccumulatedAmortization, BalanceFact.IntangibleAssetImpairment));
        Put("long-prepaid", F(BalanceFact.LongTermPrepaidExpenses));
        Total("noncurrent-assets.total", "long-investments.total", "fixed.total", "heritage", "intangible.net", "long-prepaid");
        Put("agency-assets", Sum(BalanceFact.DedicatedAgencyAssets, BalanceFact.AgencyMonetaryFunds));
        Total("assets.total", "current-assets.total", "noncurrent-assets.total", "agency-assets");
        Put("short-borrowings", F(BalanceFact.ShortTermBorrowings));
        Put("payables", Sum(BalanceFact.NotesPayable, BalanceFact.AccountsPayable, BalanceFact.OtherPayables));
        Put("payroll", F(BalanceFact.EmployeeBenefitsPayable));
        Put("taxes", F(BalanceFact.TaxesPayable));
        Put("advance-receipts", F(BalanceFact.ReceiptsInAdvance));
        Put("accruals", F(BalanceFact.AccruedExpenses));
        Put("liabilities-due", Sum(BalanceFact.LongBorrowingsDueWithinYear, BalanceFact.LongPayablesDueWithinYear, BalanceFact.OtherLongLiabilitiesDueWithinYear));
        Put("other-current-liabilities", F(BalanceFact.OtherCurrentLiabilities));
        Total("current-liabilities.total", "short-borrowings", "payables", "payroll", "taxes", "advance-receipts", "accruals", "liabilities-due", "other-current-liabilities");
        Put("long-borrowings", Sub(BalanceFact.LongBorrowings, BalanceFact.LongBorrowingsDueWithinYear));
        Put("long-payables", Sub(BalanceFact.LongPayables, BalanceFact.LongPayablesDueWithinYear));
        Put("provisions", F(BalanceFact.Provisions));
        Put("other-long-liabilities", Sub(BalanceFact.OtherLongLiabilities, BalanceFact.OtherLongLiabilitiesDueWithinYear));
        Total("long-liabilities.total", "long-borrowings", "long-payables", "provisions", "other-long-liabilities");
        Put("agency-liabilities", F(BalanceFact.AgencyLiabilities));
        Total("liabilities.total", "current-liabilities.total", "long-liabilities.total", "agency-liabilities");
        foreach (var item in new[] { ("net-assets.unrestricted", BalanceFact.UnrestrictedNetAssets), ("net-assets.restricted", BalanceFact.RestrictedNetAssets) })
            Put(item.Item1, input.ClosingState == IncomeExpenseClosingState.ClosedAndReconciled ? F(item.Item2) :
                StatementValue.Missing("NP_UNCLOSED_PL", path, "缺收入费用按限定类别结清并核对净资产的证据；不把未结转损益擅自补入3101/3102。"));
        Total("net-assets.total", "net-assets.unrestricted", "net-assets.restricted");
        Total("liabilities-net-assets.total", "liabilities.total", "net-assets.total");
        return result;
    }

    private sealed record Definition(string Key, string Label, string Section, bool Total, string Formula, string Locator);
    private static readonly Definition[] Definitions =
    [
        new("cash", "货币资金", "流动资产", false, "现金+银行存款+其他货币资金-其中受托代理货币资金", "(1)"),
        new("short-investments", "短期投资", "流动资产", false, "短期投资-短期投资跌价准备", "(2)"),
        new("receivables", "应收款项", "流动资产", false, "应收票据+应收账款+其他应收款-坏账准备", "(3)"),
        new("prepayments", "预付账款", "流动资产", false, "预付账款余额", "(4)"),
        new("inventory", "存货", "流动资产", false, "存货-存货跌价准备", "(5)"),
        new("prepaid-expenses", "待摊费用", "流动资产", false, "待摊费用余额", "(6)"),
        new("investments-due", "一年内到期的长期投资", "流动资产", false, "一年内到期长期债权及其他投资-对应减值准备", "(7)"),
        new("other-current-assets", "其他流动资产", "流动资产", false, "有关科目经复核分析余额", "(8)"),
        new("current-assets.total", "流动资产合计", "流动资产", true, "上述8项之和", "(9)"),
        new("long-equity", "长期股权投资", "非流动资产/长期投资", false, "长期股权投资-对应减值准备", "(10)"),
        new("long-debt", "长期债权投资", "非流动资产/长期投资", false, "长期债权投资-对应减值准备-一年内到期部分；到期减值非零时待复核", "(11)"),
        new("long-other", "其他长期投资", "非流动资产/长期投资", false, "其他长期投资-对应减值准备-一年内到期部分；到期减值非零时待复核", "(12)"),
        new("long-investments.total", "长期投资合计", "非流动资产/长期投资", true, "长期股权投资+长期债权投资+其他长期投资", "(13)"),
        new("fixed.cost", "固定资产原价", "非流动资产/固定资产", false, "固定资产原价余额", "(14)"),
        new("fixed.depreciation", "减：累计折旧", "非流动资产/固定资产", false, "累计折旧贷方正数（不再次作为加项）", "(14)"),
        new("fixed.net", "固定资产净值", "非流动资产/固定资产", true, "原价-累计折旧-固定资产减值准备（如有）", "(14)"),
        new("construction", "在建工程", "非流动资产/固定资产", false, "在建工程余额", "(15)"),
        new("fixed.disposal", "固定资产清理", "非流动资产/固定资产", false, "固定资产清理借方正、贷方负", "(16)"),
        new("fixed.total", "固定资产合计", "非流动资产/固定资产", true, "固定资产净值+在建工程+固定资产清理", "(17)"),
        new("heritage", "文物资源", "非流动资产", false, "文物资源余额", "(18)"),
        new("intangible.cost", "无形资产原价", "非流动资产/无形资产", false, "无形资产原价余额", "(19)"),
        new("intangible.amortization", "减：累计摊销", "非流动资产/无形资产", false, "累计摊销贷方正数（不再次作为加项）", "(19)"),
        new("intangible.net", "无形资产净值", "非流动资产/无形资产", true, "原价-累计摊销-无形资产减值准备（如有）", "(19)"),
        new("long-prepaid", "长期待摊费用", "非流动资产", false, "长期待摊费用余额", "(20)"),
        new("noncurrent-assets.total", "非流动资产合计", "非流动资产", true, "长期投资合计+固定资产合计+文物资源+无形资产净值+长期待摊费用", "(21)"),
        new("agency-assets", "受托代理资产", "受托代理资产", false, "专门受托代理资产科目+货币科目中受托代理明细", "(22)"),
        new("assets.total", "资产总计", "资产", true, "流动资产合计+非流动资产合计+受托代理资产", "(23)"),
        new("short-borrowings", "短期借款", "流动负债", false, "短期借款余额", "(24)"),
        new("payables", "应付款项", "流动负债", false, "应付票据+应付账款+其他应付款", "(25)"),
        new("payroll", "应付职工薪酬", "流动负债", false, "应付职工薪酬贷方正、借方负", "(26)"),
        new("taxes", "应交税费", "流动负债", false, "应交税费贷方正、借方负", "(27)"),
        new("advance-receipts", "预收账款", "流动负债", false, "预收账款余额", "(28)"),
        new("accruals", "预提费用", "流动负债", false, "预提费用余额", "(29)"),
        new("liabilities-due", "一年内到期的长期负债", "流动负债", false, "一年内到期长期借款+长期应付款+其他长期负债", "(30)"),
        new("other-current-liabilities", "其他流动负债", "流动负债", false, "有关科目经复核分析余额", "(31)"),
        new("current-liabilities.total", "流动负债合计", "流动负债", true, "上述8项之和", "(32)"),
        new("long-borrowings", "长期借款", "长期负债", false, "长期借款-一年内到期部分", "(33)"),
        new("long-payables", "长期应付款", "长期负债", false, "长期应付款-一年内到期部分", "(34)"),
        new("provisions", "预计负债", "长期负债", false, "预计负债余额", "(35)"),
        new("other-long-liabilities", "其他长期负债", "长期负债", false, "其他长期负债-一年内到期部分", "(36)"),
        new("long-liabilities.total", "长期负债合计", "长期负债", true, "长期借款+长期应付款+预计负债+其他长期负债", "(37)"),
        new("agency-liabilities", "受托代理负债", "受托代理负债", false, "受托代理负债余额", "(38)"),
        new("liabilities.total", "负债合计", "负债", true, "流动负债合计+长期负债合计+受托代理负债", "(39)"),
        new("net-assets.unrestricted", "非限定性净资产", "净资产", false, "已结转核对的3101余额（贷方正）", "(40)"),
        new("net-assets.restricted", "限定性净资产", "净资产", false, "已结转核对的3102余额（贷方正）", "(41)"),
        new("net-assets.total", "净资产合计", "净资产", true, "非限定性净资产+限定性净资产", "(42)"),
        new("liabilities-net-assets.total", "负债和净资产总计", "负债和净资产", true, "负债合计+净资产合计", "(43)")
    ];
}
