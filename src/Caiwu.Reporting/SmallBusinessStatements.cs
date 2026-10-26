using System.Globalization;
using Caiwu.Contracts;

namespace Caiwu.Reporting;

/// <summary>Source-pinned 2026 calculation preview of 财会〔2011〕17号 forms. Missing dimensions stay missing.</summary>
public static class SmallBusinessStatements
{
    public static SmallBusinessStatement BalanceSheet(LedgerSnapshot snapshot, DateOnly asOf,
        DateTimeOffset generatedAt, SmallBusinessStatementOptions? options = null)
    {
        if (asOf.Day != DateTime.DaysInMonth(asOf.Year, asOf.Month))
            throw new ArgumentException("首版资产负债表使用月末报告日。", nameof(asOf));
        var ledger = new StatementLedger(snapshot, asOf, options ?? new());
        var closing = BalanceValues(ledger, false);
        var opening = BalanceValues(ledger, true);
        var lines = Enumerable.Range(1, 53).Select(i => new StatementLine(i, BalanceLabels[i - 1], closing[i], opening[i],
            BalanceFormulas.GetValueOrDefault(i, "依正式附录余额分析填列；见覆盖说明"), "附录 PDF 第68—75页；资产负债表编制说明及勾稽关系")).ToArray();
        return Create(ledger, asOf, generatedAt, ReportKind.BalanceSheet, "会小企01表", "资产负债表", "期末余额", "年初余额", lines,
            "年初栏由1月期初账簿计算，尚未与上年末法定报表核对。未完成往来分户/期限、未结转损益或其他分析维度时相关行与依赖总计留缺失。");
    }

    public static SmallBusinessStatement IncomeStatement(LedgerSnapshot snapshot, int month,
        DateTimeOffset generatedAt, SmallBusinessStatementOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        if (month is < 1 or > 12) throw new ArgumentOutOfRangeException(nameof(month));
        var to = new DateOnly(snapshot.Book.FiscalYear, month, DateTime.DaysInMonth(snapshot.Book.FiscalYear, month));
        var ledger = new StatementLedger(snapshot, to, options ?? new());
        var details = ValidateDetails(ledger);
        var cumulative = IncomeValues(ledger, new(ledger.Book.FiscalYear, 1, 1), to, details);
        var current = IncomeValues(ledger, new(ledger.Book.FiscalYear, month, 1), to, details);
        var lines = Enumerable.Range(1, 32).Select(i => new StatementLine(i, IncomeLabels[i - 1], cumulative[i], current[i],
            IncomeFormulas.GetValueOrDefault(i, "显式明细科目映射；不按科目名或摘要猜测类别"), "附录 PDF 第75—78页；利润表编制说明及勾稽关系")).ToArray();
        return Create(ledger, to, generatedAt, ReportKind.IncomeStatement, "会小企02表", "利润表", "本年累计金额", "本月金额", lines,
            "本表为月报；12月本月栏仍为12月，未实现年度上年比较。经营发生额排除显式确认的损益结转凭证；其中行未分费用类别时留缺失。行3保留2011正式表样原名，规则包5403的现名为税金及附加，未声称已覆盖后续税制变更。");
    }

    private static StatementValue[] BalanceValues(StatementLedger l, bool opening)
    {
        var v = Enumerable.Range(0, 54).Select(_ => Missing("此分析项目尚未覆盖。")).ToArray();
        if (l.FatalCoverageIssue is not null) return v.Select(_ => Missing(l.FatalCoverageIssue)).ToArray();
        decimal B(params string[] roots) => l.Balance(opening, roots);
        void Put(int row, decimal amount) => v[row] = Value(amount, "按完整账套快照的末级余额取数；未设置且无发生额的科目贡献为0。");
        Put(1, B("1001", "1002", "1012")); Put(2, B("1101")); Put(3, B("1121"));
        Put(6, B("1131")); Put(7, B("1132")); Put(8, B("1221"));
        Put(9, B("1401", "1402", "1403", "1404", "1405", "1407", "1408", "1411", "1421", "4001"));
        Put(10, B("1403")); Put(11, B("4001")); Put(12, B("1405", "1407")); Put(13, B("1411"));
        Put(14, 0); Put(16, B("1501")); Put(17, B("1511")); Put(18, B("1601")); Put(19, -B("1602"));
        Put(20, B("1601", "1602")); Put(21, B("1604")); Put(22, B("1605")); Put(23, B("1606"));
        Put(24, B("1621", "1622")); Put(25, B("1701", "1702")); Put(26, B("4301")); Put(27, B("1801")); Put(28, 0);
        Put(31, -B("2001")); Put(32, -B("2201")); Put(35, -B("2211")); Put(36, -B("2221"));
        Put(37, -B("2231")); Put(38, -B("2232")); Put(39, -B("2241")); Put(40, 0);
        Put(42, -B("2501")); Put(43, -B("2701")); Put(44, -B("2401")); Put(45, 0);
        Put(48, -B("3001")); Put(49, -B("3002")); Put(50, -B("3101")); Put(51, -B("3104"));

        var settlements = (opening ? l.Opening : l.Closing).Where(p => l.Roots[p.Key] is "1122" or "1123" or "2202" or "2203").ToArray();
        if (!l.Options.SettlementLeavesAreCounterpartySeparated && settlements.Length > 0)
            foreach (var row in new[] { 4, 5, 28, 33, 34, 45 }) v[row] = Missing("缺往来单位/合同分户余额维度；科目末级不自动等同于已分户，不能按总净额重分类。");
        else
        {
            Put(4, StatementLedger.Sum(settlements.Where(p => l.Roots[p.Key] is "1122" or "2203").Select(p => Math.Max(p.Value, 0))));
            Put(33, -StatementLedger.Sum(settlements.Where(p => l.Roots[p.Key] is "2202" or "1123").Select(p => Math.Min(p.Value, 0))));
            Put(5, 0); Put(34, 0);
            foreach (var pair in settlements.Where(p => p.Value != 0))
            {
                var prepaid = pair.Value > 0 && l.Roots[pair.Key] is "1123" or "2202";
                var received = pair.Value < 0 && l.Roots[pair.Key] is "2203" or "1122";
                if (!prepaid && !received) continue;
                var term = l.Options.SettlementTerms.SingleOrDefault(t => t.AccountCode == pair.Key);
                var currentRow = prepaid ? 5 : 34; var longRow = prepaid ? 28 : 45;
                if (term is null)
                {
                    v[currentRow] = v[longRow] = Missing("缺预付/预收款项超过1年的期限分类（含往来负余额重分类）；不能默认全部流动。");
                    continue;
                }
                var row = (opening ? term.OpeningOverOneYear : term.ClosingOverOneYear) ? longRow : currentRow;
                if (v[row].Amount.HasValue) v[row] = Value(MoneyMath.Add(v[row].Amount!.Value, Math.Abs(pair.Value)), "调用方确认往来分户，并提供年初/期末两列期限分类。");
            }
        }
        void Need(string reason, params int[] rows) { foreach (var row in rows) v[row] = Missing(reason); }
        bool Nonzero(params string[] roots) => l.Leaves(roots).Any(k => (opening ? l.Opening : l.Closing)[k] != 0);
        if (Nonzero("1501")) Need("长期债券投资缺1年内到期本息明细，不能直接确定流动/非流动。", 14, 16);
        if (Nonzero("1801")) Need("长期待摊费用缺下一年摊销额明细。", 14, 27);
        if (Nonzero("1901")) Need("待处理财产损溢未处理或缺资产类别，不能猜列流动/非流动。", 14, 28);
        if (Nonzero("2501")) Need("长期借款缺1年内到期本金明细。", 40, 42);
        if (Nonzero("2701")) Need("长期应付款缺1年内到期部分明细。", 40, 43);
        if (Nonzero("2401")) Need("递延收益缺期限及分析填列明细。", 40, 44);
        if (Nonzero("4101", "4401", "4403")) Need("制造费用/工程施工/机械作业尚有余额，缺成本归集与资产分类结果。", 9, 11);
        if (Nonzero("1404")) Need("原材料其中行缺材料成本差异归属；存货总额仍按带符号余额计算。", 10);
        if (Nonzero("3103") || l.Leaves(StatementLedger.ProfitAccounts.ToArray()).Any(k => (opening ? l.Opening : l.Closing)[k] != 0))
            Need("损益或本年利润尚未归入利润分配；正式行51按利润分配填列，本版不擅自补入未结转利润。", 51);

        void Total(int row, params int[] inputs) => v[row] = SumValues(v, inputs);
        Total(15, 1, 2, 3, 4, 5, 6, 7, 8, 9, 14);
        Total(29, 16, 17, 20, 21, 22, 23, 24, 25, 26, 27, 28); Total(30, 15, 29);
        Total(41, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40); Total(46, 42, 43, 44, 45); Total(47, 41, 46);
        Total(52, 48, 49, 50, 51); Total(53, 47, 52);
        return v;
    }

    private static Dictionary<int, string[]> ValidateDetails(StatementLedger l)
    {
        var result = new Dictionary<int, string[]>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var group in l.Options.IncomeDetails.GroupBy(m => m.OfficialRowNumber))
        {
            if (!DetailParents.TryGetValue(group.Key, out var parent)) throw new ArgumentException("不是支持的利润表其中行。");
            var leaves = group.SelectMany(m => l.DescendantLeaves(m.AccountCode)).ToArray();
            foreach (var leaf in leaves)
                if (l.Roots[leaf] != parent || !seen.Add(leaf))
                    throw new ArgumentException("其中行映射须隶属对应正式损益科目，且各明细映射不能重叠重复。");
            result.Add(group.Key, leaves);
        }
        return result;
    }

    private static StatementValue[] IncomeValues(StatementLedger l, DateOnly from, DateOnly to, Dictionary<int, string[]> details)
    {
        var v = Enumerable.Range(0, 33).Select(_ => Missing("缺费用类别明细。")).ToArray();
        if (l.IncomeCoverageIssue is not null) return v.Select(_ => Missing(l.IncomeCoverageIssue)).ToArray();
        void Put(int row, decimal sign, params string[] roots) => v[row] = Value(sign * l.Activity(from, to, l.Leaves(roots)), "已记账经营发生额（借方-贷方）；排除显式确认的损益结转。");
        Put(1, -1, "5001", "5051"); Put(2, 1, "5401", "5402"); Put(3, 1, "5403");
        Put(11, 1, "5601"); Put(14, 1, "5602"); Put(18, 1, "5603"); Put(20, -1, "5111");
        Put(22, -1, "5301"); Put(24, 1, "5711"); Put(31, 1, "5801");
        foreach (var (row, parent) in DetailParents)
        {
            if (details.TryGetValue(row, out var codes)) v[row] = Value((row == 23 ? -1 : 1) * l.Activity(from, to, codes), "调用方显式费用明细映射。");
            else if (!l.HasActivity(from, to, parent)) v[row] = Value(0, "该期间完整快照无对应主科目经营发生额；此其中行可证为0。");
        }
        v[21] = Formula(v, [(1, 1), (2, -1), (3, -1), (11, -1), (14, -1), (18, -1), (20, 1)]);
        v[30] = Formula(v, [(21, 1), (22, 1), (24, -1)]);
        v[32] = Formula(v, [(30, 1), (31, -1)]);
        return v;
    }

    private static SmallBusinessStatement Create(StatementLedger l, DateOnly to, DateTimeOffset at, ReportKind kind,
        string form, string title, string firstLabel, string secondLabel, StatementLine[] lines, string limitation)
    {
        var from = kind == ReportKind.IncomeStatement ? new DateOnly(to.Year, to.Month, 1) : new DateOnly(to.Year, 1, 1);
        var metadata = new ReportMetadata(l.Book, from, to, at, new[] {
            new ReportSource("财会〔2011〕17号正式附录，PDF第68—78页", SmallBusinessStatement.OfficialAppendixUrl),
            new ReportSource("固定规则快照（不含完整公式集）", "https://github.com/xhc144/caiwu-suite/blob/" + SmallBusinessStatement.RuleCommit + "/rules/packages/small-business.json")
        }.Concat(l.Options.AdditionalSources));
        ReportColumn[] columns = [new("rowNumber", "行次", ReportValueKind.Text), new("item", "项目", ReportValueKind.Text),
            new("firstAmount", firstLabel, ReportValueKind.Amount), new("secondAmount", secondLabel, ReportValueKind.Amount),
            new("firstCoverage", firstLabel + "覆盖", ReportValueKind.Text), new("secondCoverage", secondLabel + "覆盖", ReportValueKind.Text),
            new("formula", "计算依据", ReportValueKind.Text), new("limitation", "数据及未覆盖说明", ReportValueKind.Text), new("sourceLocator", "来源位置", ReportValueKind.Text)];
        ReportCell Cell(StatementValue value) => value.Amount.HasValue ? ReportCell.Money(value.Amount.Value) : ReportCell.Text("资料不足");
        var rows = lines.Select(line => new ReportRow([ReportCell.Text(line.RowNumber.ToString(CultureInfo.InvariantCulture)), ReportCell.Text(line.Label),
            Cell(line.First), Cell(line.Second), ReportCell.Text(line.First.Coverage == StatementCoverage.Calculated ? "已计算" : "缺失/未覆盖"),
            ReportCell.Text(line.Second.Coverage == StatementCoverage.Calculated ? "已计算" : "缺失/未覆盖"), ReportCell.Text(line.Formula),
            ReportCell.Text(firstLabel + "：" + line.First.Explanation + "\n" + secondLabel + "：" + line.Second.Explanation), ReportCell.Text(line.SourceLocator)])).ToArray();
        var issues = l.Issues.Where(issue => kind != ReportKind.BalanceSheet || issue.Code != "IncomeBasis").ToList();
        foreach (var line in lines.Where(x => !x.First.Amount.HasValue || !x.Second.Amount.HasValue))
            issues.Add(new("MissingRow", $"行{line.RowNumber} {line.Label}：{(!line.First.Amount.HasValue ? line.First.Explanation : line.Second.Explanation)}"));
        if (kind == ReportKind.BalanceSheet)
        {
            foreach (var (first, label) in new[] { (true, firstLabel), (false, secondLabel) })
            {
                var assets = first ? lines[29].First.Amount : lines[29].Second.Amount;
                var liabilitiesEquity = first ? lines[52].First.Amount : lines[52].Second.Amount;
                if (assets.HasValue && liabilitiesEquity.HasValue && assets != liabilitiesEquity)
                    issues.Add(new("BalanceEquationMismatch", label + "行30不等于行53；不能据此宣称平衡或合规。"));
            }
        }
        ReportAnnotation[] annotations = [new("正式表号", form), new("规则包", SmallBusinessStatement.RulePackageId + "@" + SmallBusinessStatement.RulePackageVersion),
            new("原模板标识", l.Options.OriginalTemplateId ?? "未提供；不推断为a05或a52"),
            new("原模板内容核验", "否；本计算采用已有官方规则映射，未声称恢复原科目、报表格式和公式"),
            new("规则提交", SmallBusinessStatement.RuleCommit), new("公式版本", SmallBusinessStatement.FormulaVersion), new("生产核验", "否"), new("完整公式集", "否"),
            new("账套快照版本", l.Revision.ToString(CultureInfo.InvariantCulture)),
            new("期间类型", "月报；不提供年度上年比较"), new("年初/累计基础", "2026年1月启用的完整账套；账簿期初及已记账分录，不含草稿/已审核"),
            new("科目编码基础", "2011正式一级编码或调用方显式根映射；多级沿ParentCode，仅计末级"),
            new("显式根科目映射", l.Options.AccountMappings.Count == 0 ? "未提供；按2011正式一级编码" : string.Join("；", l.Options.AccountMappings.Select(m => m.RootAccountCode + "→" + m.OfficialAccountCode))),
            new("显式损益结转排除ID", l.ClosingIds.Count == 0 ? "未提供；不按摘要猜测" : string.Join("；", l.ClosingIds.Order().Select(id => id.ToString("D")))),
            new("往来分户确认", l.Options.SettlementLeavesAreCounterpartySeparated ? "调用方确认末级余额按往来单位/合同分户，未独立核验" : "未确认；相关项目不能按总净额重分类"),
            new("往来期限分类", l.Options.SettlementTerms.Count == 0 ? "未提供" : string.Join("；", l.Options.SettlementTerms.Select(t => t.AccountCode +
                "：年初" + (t.OpeningOverOneYear ? ">1年" : "≤1年") + "/期末" + (t.ClosingOverOneYear ? ">1年" : "≤1年")))),
            new("费用其中行映射", l.Options.IncomeDetails.Count == 0 ? "未提供" : string.Join("；", l.Options.IncomeDetails.Select(m => "行" + m.OfficialRowNumber.ToString(CultureInfo.InvariantCulture) + "←" + m.AccountCode))),
            new("官方附件SHA256", "5e0b73597f57f3eb4d3a22ffcd5a1043df6ab852e1e852b5fc7212f6dfa17a65"),
            new("两列均已计算行数", lines.Count(x => x.First.Amount.HasValue && x.Second.Amount.HasValue).ToString(CultureInfo.InvariantCulture)),
            new("缺失/未覆盖行次", string.Join("、", lines.Where(x => !x.First.Amount.HasValue || !x.Second.Amount.HasValue).Select(x => x.RowNumber))),
            new("输入及勾稽问题", issues.Count == 0 ? "本计算范围未发现问题；不代表合规验收" : issues.All(x => x.Code == "MissingRow") ? "行级缺失见缺失行次及逐行说明；不代表合规验收" :
                string.Join("\n", issues.Where(x => x.Code != "MissingRow").Select(x => x.Code + "：" + x.Detail)))];
        var document = new ReportDocument(kind, title, metadata, columns, rows,
            new ReportRow(columns.Select(_ => ReportCell.Text(""))),
            "计算预览，未经生产核验，完整公式集/附注/制度适用性尚未验收；数值齐全不等于财报合规。" + limitation, annotations, includeTotal: false);
        return new(form, document, lines, issues);
    }

    private static StatementValue Value(decimal amount, string explanation) => new(amount, StatementCoverage.Calculated, explanation);
    private static StatementValue Missing(string reason) => new(null, StatementCoverage.MissingData, reason);
    private static StatementValue SumValues(StatementValue[] values, int[] inputs) => Formula(values, inputs.Select(i => (i, 1)).ToArray());
    private static StatementValue Formula(StatementValue[] values, (int Row, int Sign)[] terms)
    {
        if (terms.Any(t => !values[t.Row].Amount.HasValue))
            return Missing("依赖行缺数据：" + string.Join("、", terms.Where(t => !values[t.Row].Amount.HasValue).Select(t => t.Row)));
        return Value(StatementLedger.Sum(terms.Select(t => t.Sign * values[t.Row].Amount!.Value)), "按正式表样行间公式计算；其中行不重复计入。");
    }

    private static readonly Dictionary<int, string> DetailParents = new()
    {
        [4]="5403", [5]="5403", [6]="5403", [7]="5403", [8]="5403", [9]="5403", [10]="5403",
        [12]="5601", [13]="5601", [15]="5602", [16]="5602", [17]="5602", [19]="5603", [23]="5301",
        [25]="5711", [26]="5711", [27]="5711", [28]="5711", [29]="5711"
    };
    private static readonly string[] BalanceLabels = ["货币资金", "短期投资", "应收票据", "应收账款", "预付账款", "应收股利", "应收利息", "其他应收款", "存货", "其中：原材料", "在产品", "库存商品", "周转材料", "其他流动资产", "流动资产合计", "长期债券投资", "长期股权投资", "固定资产原价", "减：累计折旧", "固定资产账面价值", "在建工程", "工程物资", "固定资产清理", "生产性生物资产", "无形资产", "开发支出", "长期待摊费用", "其他非流动资产", "非流动资产合计", "资产总计", "短期借款", "应付票据", "应付账款", "预收账款", "应付职工薪酬", "应交税费", "应付利息", "应付利润", "其他应付款", "其他流动负债", "流动负债合计", "长期借款", "长期应付款", "递延收益", "其他非流动负债", "非流动负债合计", "负债合计", "实收资本（或股本）", "资本公积", "盈余公积", "未分配利润", "所有者权益（或股东权益）合计", "负债和所有者权益（或股东权益）总计"];
    private static readonly string[] IncomeLabels = ["一、营业收入", "减：营业成本", "营业税金及附加", "其中：消费税", "营业税", "城市维护建设税", "资源税", "土地增值税", "城镇土地使用税、房产税、车船税、印花税", "教育费附加、矿产资源补偿费、排污费", "销售费用", "其中：商品维修费", "广告费和业务宣传费", "管理费用", "其中：开办费", "业务招待费", "研究费用", "财务费用", "其中：利息费用（收入以“-”号填列）", "加：投资收益（损失以“-”号填列）", "二、营业利润（亏损以“-”号填列）", "加：营业外收入", "其中：政府补助", "减：营业外支出", "其中：坏账损失", "无法收回的长期债券投资损失", "无法收回的长期股权投资损失", "自然灾害等不可抗力因素造成的损失", "税收滞纳金", "三、利润总额（亏损总额以“-”号填列）", "减：所得税费用", "四、净利润（净亏损以“-”号填列）"];
    private static readonly Dictionary<int, string> BalanceFormulas = new()
    {
        [1]="1001+1002+1012；借正贷负", [2]="1101", [3]="1121", [4]="应收1122及预收2203借方分户余额", [5]="预付1123及应付2202借方分户余额；期限分类",
        [6]="1131", [7]="1132", [8]="1221",
        [9]="1401+1402+1403+1404+1405+1407+1408+1411+1421+4001；借正贷负", [15]="行1+2+3+4+5+6+7+8+9+14",
        [10]="1403；1404差异未归属则缺失", [11]="4001；未分配制造/工程成本则缺失", [12]="1405+1407", [13]="1411", [14]="1年内到期等流动部分；缺辅助明细则缺失",
        [16]="1501按到期期限分析；缺明细则缺失", [17]="1511", [18]="1601", [19]="-1602（贷方折旧正列）", [20]="行18-行19=1601+1602",
        [21]="1604", [22]="1605", [23]="1606；贷方以负号列示", [24]="1621+1622", [25]="1701+1702", [26]="4301",
        [27]="1801按下一年摊销额分析；缺明细则缺失", [28]="超过1年的预付款等；缺明细则缺失",
        [29]="行16+17+20+21+22+23+24+25+26+27+28", [30]="行15+行29", [33]="应付2202及预付1123贷方分户余额",
        [31]="-2001", [32]="-2201", [34]="预收2203及应收1122贷方分户余额；期限分类", [35]="-2211", [36]="-2221；借方余额负列", [37]="-2231", [38]="-2232", [39]="-2241",
        [40]="1年内到期等流动负债；缺明细则缺失", [41]="行31+32+33+34+35+36+37+38+39+40",
        [42]="-2501按到期期限分析；缺明细则缺失", [43]="-2701按到期期限分析；缺明细则缺失", [44]="-2401分析填列；缺明细则缺失", [45]="超过1年的预收款等；缺明细则缺失",
        [46]="行42+43+44+45", [47]="行41+行46", [48]="-3001", [49]="-3002", [50]="-3101", [51]="-3104；未结转损益不自动补入", [52]="行48+49+50+51", [53]="行47+行52；须与行30核对"
    };
    private static readonly Dictionary<int, string> IncomeFormulas = new()
    {
        [1]="-(5001+5051)经营借贷净发生额", [2]="5401+5402经营借贷净发生额", [3]="5403经营借贷净发生额（2011表样原名）",
        [11]="5601经营借贷净发生额", [14]="5602经营借贷净发生额", [18]="5603经营借贷净发生额", [20]="-5111经营借贷净发生额",
        [21]="行1-2-3-11-14-18+20", [22]="-5301经营借贷净发生额", [24]="5711经营借贷净发生额", [30]="行21+22-24", [31]="5801经营借贷净发生额", [32]="行30-行31"
    };
}
