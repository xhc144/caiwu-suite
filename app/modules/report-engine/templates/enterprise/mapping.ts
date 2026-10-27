import type { Account, DimensionItem } from '@caiwu/core';
import { ASSETS, LIABILITIES_EQUITY, PROFIT, CASHFLOW } from './lines';
import type { EnterpriseConfig, SourceData } from './model';
type Rule = EnterpriseConfig['rules'][number];
const names: Record<string, Partial<Rule> & Pick<Rule, 'line'>> = {
  库存现金: { line: 'cash' },
  银行存款: { line: 'cash' },
  其他货币资金: { line: 'cash' },
  预付账款: { line: 'prepayments', kind: 'payable' },
  预付款项: { line: 'prepayments', kind: 'payable' },
  应付账款: { line: 'accountsPayable', kind: 'payable' },
  应收账款: { line: 'accountsReceivable', kind: 'receivable' },
  预收账款: { line: 'advances', kind: 'receivable' },
  预收款项: { line: 'advances', kind: 'receivable' },
  应收票据: { line: 'notesReceivable', kind: 'financial' },
  债权投资: { line: 'debtInvestments', kind: 'financial' },
  其他债权投资: { line: 'otherDebtInvestments', kind: 'financial' },
  交易性金融资产: { line: 'tradingAssets', kind: 'financial' },
  其他权益工具投资: { line: 'otherEquityInvestments', kind: 'financial' },
  应收利息: { line: 'otherReceivables' },
  应收股利: { line: 'otherReceivables' },
  其他应收款: { line: 'otherReceivables', kind: 'receivable' },
  应付利息: { line: 'otherPayables' },
  应付股利: { line: 'otherPayables' },
  其他应付款: { line: 'otherPayables' },
  材料采购: { line: 'inventory' },
  在途物资: { line: 'inventory' },
  原材料: { line: 'inventory' },
  材料成本差异: { line: 'inventory' },
  库存商品: { line: 'inventory' },
  发出商品: { line: 'inventory' },
  委托加工物资: { line: 'inventory' },
  周转材料: { line: 'inventory' },
  生产成本: { line: 'inventory' },
  制造费用: { line: 'inventory' },
  劳务成本: { line: 'inventory' },
  消耗性生物资产: { line: 'inventory' },
  存货跌价准备: { line: 'inventory', role: 'allowance' },
  商品进销差价: { line: 'inventory', role: 'allowance' },
  累计折旧: { line: 'fixedAssets', role: 'depreciation' },
  固定资产减值准备: { line: 'fixedAssets', role: 'allowance' },
  固定资产清理: { line: 'fixedAssets', role: 'clearing' },
  工程物资: { line: 'construction' },
  在建工程: { line: 'construction' },
  在建工程减值准备: { line: 'construction', role: 'allowance' },
  工程物资减值准备: { line: 'construction', role: 'allowance' },
  使用权资产累计折旧: { line: 'rightOfUseAssets', role: 'depreciation' },
  使用权资产减值准备: { line: 'rightOfUseAssets', role: 'allowance' },
  累计摊销: { line: 'intangibleAssets', role: 'amortization' },
  无形资产减值准备: { line: 'intangibleAssets', role: 'allowance' },
  商誉减值准备: { line: 'goodwill', role: 'allowance' },
  生产性生物资产累计折旧: { line: 'biologicalAssets', role: 'depreciation' },
  生产性生物资产减值准备: { line: 'biologicalAssets', role: 'allowance' },
  累计折耗: { line: 'oilGasAssets', role: 'depreciation' },
  油气资产减值准备: { line: 'oilGasAssets', role: 'allowance' },
  投资性房地产累计折旧: { line: 'investmentProperty', role: 'depreciation' },
  投资性房地产累计摊销: { line: 'investmentProperty', role: 'depreciation' },
  投资性房地产减值准备: { line: 'investmentProperty', role: 'allowance' },
  长期股权投资减值准备: { line: 'equityInvestments', role: 'allowance' },
  持有待售资产减值准备: { line: 'heldForSaleAssets', role: 'allowance' },
  合同资产: { line: 'contractAssets', kind: 'contract' },
  合同负债: { line: 'contractLiabilities', kind: 'contract' },
  合同结算: { line: 'contractAssets', kind: 'contract' },
  合同资产减值准备: { line: 'contractAssets', kind: 'contract', role: 'allowance' },
  合同取得成本: { line: 'contractAcquisition', kind: 'contractCost' },
  合同履约成本: { line: 'contractFulfilment', kind: 'contractCost' },
  合同取得成本减值准备: { line: 'contractAcquisition', kind: 'contractCost', role: 'allowance' },
  合同履约成本减值准备: { line: 'contractFulfilment', kind: 'contractCost', role: 'allowance' },
  应收退货成本: { line: 'returnAsset', kind: 'return' },
  应付退货款: { line: 'returnLiability', kind: 'return' },
  其他权益工具: { line: 'otherEquity', kind: 'equityInstrument' },
  应付债券: { line: 'bondsPayable', kind: 'equityInstrument' },
  未确认融资费用: { line: 'longTermPayables', role: 'financing', kind: 'maturity' },
  专项应付款: { line: 'longTermPayables', role: 'special', kind: 'maturity' },
  长期应付款: { line: 'longTermPayables', kind: 'maturity' },
  长期借款: { line: 'longTermLoans', kind: 'maturity' },
  租赁负债: { line: 'leaseLiabilities', kind: 'maturity' },
  长期应收款: { line: 'longTermReceivables', kind: 'maturity' },
  未实现融资收益: { line: 'longTermReceivables', kind: 'maturity', role: 'financing' },
  债权投资减值准备: { line: 'debtInvestments', kind: 'financial', role: 'allowance' },
  长期应收款坏账准备: { line: 'longTermReceivables', kind: 'maturity', role: 'allowance' },
  实收资本: { line: 'capital' },
  股本: { line: 'capital' },
  利润分配: { line: 'retainedEarnings' },
  本年利润: { line: 'retainedEarnings', kind: 'currentProfit' },
  其他综合收益: { line: 'otherComprehensive', kind: 'oci' },
  应交税费: { line: 'taxesPayable', kind: 'receivable' },
  研发支出: { line: 'development' },
  研究费用: { line: 'research', kind: 'pnl' },
  无形资产摊销: { line: 'research', kind: 'pnl' },
  主营业务收入: { line: 'revenue', kind: 'pnl' },
  其他业务收入: { line: 'revenue', kind: 'pnl' },
  主营业务成本: { line: 'cost', kind: 'pnl' },
  其他业务成本: { line: 'cost', kind: 'pnl' },
  税金及附加: { line: 'taxes', kind: 'pnl' },
  利息费用: { line: 'interestExpense', parent: 'finance', kind: 'pnl' },
  利息收入: { line: 'interestIncome', parent: 'finance', kind: 'pnl' },
  对联营企业和合营企业的投资收益: {
    line: 'associateIncome',
    parent: 'investmentIncome',
    kind: 'pnl',
  },
  以摊余成本计量的金融资产终止确认收益: {
    line: 'derecognitionIncome',
    parent: 'investmentIncome',
    kind: 'pnl',
  },
  净敞口套期损益: { line: 'hedgeIncome', kind: 'pnl' },
  公允价值变动损益: { line: 'fairValueIncome', kind: 'pnl' },
  资产处置损益: { line: 'disposalIncome', kind: 'pnl' },
  所得税费用: { line: 'incomeTax', kind: 'pnl' },
  补偿性资产: { line: 'otherCurrentAssets', kind: 'maturity' },
};
for (const l of [...ASSETS, ...LIABILITIES_EQUITY, ...PROFIT]) {
  if (l.section || l.total) continue;
  const label = l.label
    .replace(/^[一二三四五六七八九十]+、|^减：|^加：/g, '')
    .replace(/（.*?）/g, '');
  if (!names[label]) names[label] = { line: l.key, kind: PROFIT.includes(l) ? 'pnl' : 'balance' };
}
/** 仅按实际账套科目及其上级语义匹配；没有数字编码猜测，也不将未知科目归“其他”。 */
export function suggestEnterpriseRules(accounts: readonly Account[]) {
  const suggestions: Rule[] = [],
    unmatched: Account[] = [];
  for (const account of accounts.filter((a) => a.isLeaf)) {
    let current: Account | undefined = account,
      binding: (Partial<Rule> & Pick<Rule, 'line'>) | undefined;
    const visited = new Set<number>();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      binding =
        current.name === '无形资产摊销' && !account.fullName.includes('管理费用')
          ? undefined
          : names[current.name];
      if (binding) break;
      current = accounts.find((a) => a.id === current!.parentId);
    }
    if (binding)
      suggestions.push({
        accountId: account.id,
        line: binding.line,
        kind: binding.kind ?? 'balance',
        role: binding.role ?? 'gross',
        ...(binding.parent ? { parent: binding.parent } : {}),
      });
    else unmatched.push(account);
  }
  return { suggestions, unmatched };
}
const cashNames: Record<string, string> = {
  '销售商品、提供劳务收到的现金': 'salesReceipts',
  收到的税费返还: 'taxRefunds',
  政府补助: 'otherOperatingReceipts',
  收到政府补助: 'otherOperatingReceipts',
  '购买商品、接受劳务支付的现金': 'purchases',
  支付给职工以及为职工支付的现金: 'employees',
};
for (const line of CASHFLOW)
  if (!line.section && !line.total && !['exchangeEffect', 'cashOpening'].includes(line.key))
    cashNames[line.label] = line.key;
export function suggestEnterpriseCashProjects(items: readonly DimensionItem[]) {
  return items
    .filter((i) => i.isLeaf)
    .flatMap((i) => (cashNames[i.name] ? [{ itemId: i.id, line: cashNames[i.name]! }] : []));
}
/** 来自已过账分录的实际现金项目；仅提供建议，用户保存时仍需逐笔守恒和来源绑定。 */
export function suggestEnterpriseCashAllocations(source: SourceData) {
  const mapped = suggestEnterpriseCashProjects(source.cashflowItems),
    allocations: EnterpriseConfig['cashAllocations'] = [];
  for (const entry of source.entries) {
    const account = source.accounts.find((a) => a.id === entry.accountId);
    if (!account?.isCash && !account?.isBank && !account?.cashflowRequired) continue;
    const item = source.cashflowItems.find((i) => i.id === entry.dimensions.cashflow),
      line =
        entry.cashflowDirection === 'internal'
          ? 'internal'
          : mapped.find((x) => x.itemId === item?.id)?.line;
    if (!line) continue;
    allocations.push({
      lineId: entry.lineId,
      parts: [{ line, amount: (BigInt(entry.debit) - BigInt(entry.credit)).toString() }],
      source: `已过账凭证${entry.displayNo}第${entry.lineNo}行；现金项目${item?.name ?? '内部划转'}`,
      version: String(source.vouchers.find((v) => v.id === entry.voucherId)?.revision ?? 1),
    });
  }
  return allocations;
}
export function createEnterpriseDraft(
  period: number,
  scope: EnterpriseConfig['scope'],
  adoption: EnterpriseConfig['adoption'],
  accounts: readonly Account[],
): EnterpriseConfig {
  return {
    format: 'enterprise-2019-appendix2',
    period,
    scope,
    adoption,
    rules: suggestEnterpriseRules(accounts).suggestions,
    facts: [],
    absentRoles: [],
    cashPolicies: [],
    cashAllocations: [],
    cashScopeChanges: [],
    equityEvents: [],
    adjustments: [],
    oci: [],
    discontinued: [],
    shares: [],
    eps: [],
    contractNetAllocations: [],
  };
}
