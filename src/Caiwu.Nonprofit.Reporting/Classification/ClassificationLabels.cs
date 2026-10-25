namespace Caiwu.Nonprofit.Reporting;

public sealed record ClassificationChoice(object? Value,string Label);
public static class ClassificationLabels
{
    public static IReadOnlyList<ClassificationChoice> Choices<T>(bool includeNull=false)where T:struct,Enum=>
        (includeNull?new[]{new ClassificationChoice(null,"未填写")}:[]).Concat(Enum.GetValues<T>().Select(v=>new ClassificationChoice(v,For(v)))).ToArray();
    public static string For(Enum value)=>value switch
    {
        BalanceFact f=>BalanceNames[(int)f],ActivityFact f=>ActivityNames[(int)f],
        LedgerAccountSemantic.Unclassified=>"未分类",LedgerAccountSemantic.OtherBalance=>"资产/负债等普通余额",LedgerAccountSemantic.IncomeExpense=>"收入/费用",LedgerAccountSemantic.UnrestrictedNetAssets=>"非限定性净资产",LedgerAccountSemantic.RestrictedNetAssets=>"限定性净资产",LedgerAccountSemantic.PriorYearAdjustment=>"以前年度净资产调整",
        SourceLineRole.Unclassified=>"未分类",SourceLineRole.BalanceOnly=>"资产/负债普通对方行",SourceLineRole.RecognizedActivity=>"普通收入费用发生",SourceLineRole.IncomeExpenseClosing=>"收入费用结转（含两侧）",SourceLineRole.ReleaseToUnrestricted=>"限定转非限定（含两侧）",SourceLineRole.TransferToRestricted=>"非限定转限定（含两侧）",SourceLineRole.PriorYearAdjustment=>"以前年度调整发生",SourceLineRole.PriorYearAdjustmentClosing=>"以前年度调整机械结转",
        BalanceMappingMode.Unspecified=>"未明确",BalanceMappingMode.AccountBalances=>"按末级科目余额计算",BalanceMappingMode.ReviewedAnalysis=>"有据分析金额",BalanceMappingMode.ConfirmedZero=>"已明确复核不存在/为零",
        RestrictionClass.Unrestricted=>"非限定性",RestrictionClass.Restricted=>"限定性",
        RestrictionSourceKind.ExternalProvider=>"外部资源提供者",RestrictionSourceKind.LawOrAdministrativeRegulation=>"法律/行政法规",RestrictionSourceKind.InternalBudget=>"内部预算（不构成限定）",
        ActivityComponentKind.Project=>"项目",ActivityComponentKind.Service=>"服务",ActivityComponentKind.Business=>"业务",ActivityComponentKind.CharitableTrustEstablishment=>"设立慈善信托支出",ActivityComponentKind.FundraisingCost=>"募捐成本",
        FundraisingDisclosure.Unknown=>"适用性未明确",FundraisingDisclosure.NotApplicableConfirmed=>"已复核无需单列募捐成本",FundraisingDisclosure.RequiredAndClassified=>"须单列且已区分募捐成本",
        YearOpeningBasis.Unknown=>"年初依据未复核",YearOpeningBasis.Reviewed2026TransitionLedger=>"已复核2026新账年初",YearOpeningBasis.ReviewedRestatedPriorYearStatement=>"已复核按本年口径调整的上年末",
        _=>value.ToString()
    };
    private static readonly string[] ActivityNames=["捐赠收入","会费收入","提供服务收入","政府补助收入","商品销售收入","总部拨款收入","投资收益","其他收入","业务活动成本","税金及附加","管理费用","筹资费用","资产减值损失","所得税费用","其他费用","限定转非限定","非限定转限定","以前年度净资产调整"];
    private static readonly string[] BalanceNames=["现金","银行存款","其他货币资金","货币科目中受托代理明细","短期投资原额","短期投资跌价准备","应收票据","应收账款","其他应收款","坏账准备","预付账款","存货原额","存货跌价准备","待摊费用","长期债权投资一年内到期额","其他长期投资一年内到期额","一年内到期投资对应减值","其他流动资产","长期股权投资原额","股权投资减值准备","长期债权投资原额","债权投资减值准备","其他长期投资原额","其他长期投资减值准备","固定资产原价","累计折旧","固定资产减值准备","在建工程","固定资产清理（借正贷负）","文物资源","无形资产原价","累计摊销","无形资产减值准备","长期待摊费用","专门受托代理资产科目","短期借款","应付票据","应付账款","其他应付款","应付职工薪酬（贷正借负）","应交税费（贷正借负）","预收账款","预提费用","长期借款一年内到期额","长期应付款一年内到期额","其他长期负债一年内到期额","其他流动负债","长期借款总额","长期应付款总额","预计负债","其他长期负债总额","受托代理负债","非限定性净资产","限定性净资产"];
}
