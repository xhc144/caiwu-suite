using Caiwu.Contracts;

namespace Caiwu.Core;

/// <summary>Small, versioned demonstration charts, never a claim of complete regime support.</summary>
public static class TemplateCatalog
{
    public static IReadOnlyList<TemplateDefinition> All { get; } = Array.AsReadOnly(new[]
    {
        new TemplateDefinition("small-business-demo", "小企业会计准则（试用科目，待会计复核）",
            AccountingRegime.SmallBusiness, "small-business-2011-demo.1", false, Accounts(
                A("1001", "库存现金"), A("1002", "银行存款"), A("1403", "原材料"),
                A("3001", "实收资本", BalanceDirection.Credit), A("3103", "本年利润", BalanceDirection.Credit),
                A("5001", "主营业务收入", BalanceDirection.Credit), A("5602", "管理费用"))),
        new TemplateDefinition("enterprise-demo", "企业会计准则（试用科目，待会计复核）",
            AccountingRegime.Enterprise, "enterprise-2006-demo.1", false, Accounts(
                A("1001", "库存现金"), A("1002", "银行存款"), A("1403", "原材料"),
                A("4001", "实收资本", BalanceDirection.Credit), A("4103", "本年利润", BalanceDirection.Credit),
                A("6001", "主营业务收入", BalanceDirection.Credit), A("6602", "管理费用"))),
        // 财会〔2024〕25号正式附录：存货1201、两类净资产3101/3102、管理费用5301。
        // Do not insert enterprise capital/profit/income accounts into a nonprofit chart.
        // Local child codes express the two classifications; they do not automate eligibility or closing.
        new TemplateDefinition("nonprofit-2026-experimental", "民间非营利组织2026（实验科目，制度功能未完备）",
            AccountingRegime.Nonprofit, "nonprofit-2024-25-2026-experimental.1", false, Accounts(
                A("1001", "现金"), A("1002", "银行存款"), A("1201", "存货"),
                A("3101", "非限定性净资产", BalanceDirection.Credit), A("3102", "限定性净资产", BalanceDirection.Credit),
                A("4101", "捐赠收入", BalanceDirection.Credit),
                A("410101", "非限定性收入", BalanceDirection.Credit, "4101"),
                A("410102", "限定性收入", BalanceDirection.Credit, "4101"),
                A("5101", "业务活动成本"), A("510101", "非限定性费用", parent: "5101"),
                A("510102", "限定性费用", parent: "5101"),
                A("5301", "管理费用"), A("530101", "非限定性费用", parent: "5301"),
                A("530102", "限定性费用", parent: "5301")))
    });

    public static TemplateDefinition Get(AccountingRegime regime) =>
        All.SingleOrDefault(t => t.Regime == regime) ?? throw new LedgerValidationException("未提供该会计制度的模板。");

    private static Account A(string code, string name, BalanceDirection direction = BalanceDirection.Debit, string? parent = null) =>
        new(code, name, parent, direction, true, 0, 0);

    private static IReadOnlyList<Account> Accounts(params Account[] accounts) => Array.AsReadOnly(accounts);
}
