import { emptyTemplate, ReportTemplateSchema, type ReportTemplate } from '../../shared';

export type NonprofitCode = '401' | '402' | '403';
export type FormRow = {
  id: string;
  label: string;
  section?: true;
  total?: string;
  outflow?: true;
};

/** nonprofit-2026.pdf pp.128–129, 134–142. 布局行号不是制度项目编号。 */
export const assetRows: readonly FormRow[] = [
  { id: 'currentAssets', label: '流动资产：', section: true },
  { id: 'cash', label: '货币资金' },
  { id: 'shortInvestment', label: '短期投资' },
  { id: 'receivables', label: '应收款项' },
  { id: 'prepayments', label: '预付账款' },
  { id: 'inventory', label: '存货' },
  { id: 'deferred', label: '待摊费用' },
  { id: 'currentInvestment', label: '一年内到期的长期投资' },
  { id: 'otherCurrentAssets', label: '其他流动资产' },
  { id: 'currentAssetsTotal', label: '流动资产合计' },
  { id: 'noncurrentAssets', label: '非流动资产：', section: true },
  { id: 'longInvestments', label: '长期投资：', section: true },
  { id: 'equityInvestment', label: '长期股权投资' },
  { id: 'debtInvestment', label: '长期债权投资' },
  { id: 'otherInvestment', label: '其他长期投资' },
  { id: 'investmentTotal', label: '长期投资合计' },
  { id: 'fixedAssets', label: '固定资产：', section: true },
  { id: 'fixedCost', label: '固定资产原价' },
  { id: 'depreciation', label: '减：累计折旧' },
  { id: 'fixedNet', label: '固定资产净值' },
  { id: 'construction', label: '在建工程' },
  { id: 'disposal', label: '固定资产清理' },
  { id: 'fixedTotal', label: '固定资产合计' },
  { id: 'culturalResources', label: '文物资源' },
  { id: 'intangibles', label: '无形资产：', section: true },
  { id: 'intangibleCost', label: '无形资产原价' },
  { id: 'amortization', label: '减：累计摊销' },
  { id: 'intangibleNet', label: '无形资产净值' },
  { id: 'longDeferred', label: '长期待摊费用' },
  { id: 'noncurrentAssetsTotal', label: '非流动资产合计' },
  { id: 'agencyAssets', label: '受托代理资产：', section: true },
  { id: 'agencyAsset', label: '受托代理资产' },
  { id: 'assetsTotal', label: '资产总计' },
];
export const liabilityRows: readonly FormRow[] = [
  { id: 'currentLiabilities', label: '流动负债：', section: true },
  { id: 'shortBorrowing', label: '短期借款' },
  { id: 'payables', label: '应付款项' },
  { id: 'employees', label: '应付职工薪酬' },
  { id: 'taxes', label: '应交税费' },
  { id: 'advances', label: '预收账款' },
  { id: 'accruals', label: '预提费用' },
  { id: 'currentDebt', label: '一年内到期的长期负债' },
  { id: 'otherCurrentLiabilities', label: '其他流动负债' },
  { id: 'currentLiabilitiesTotal', label: '流动负债合计' },
  { id: 'longLiabilities', label: '长期负债：', section: true },
  { id: 'longBorrowing', label: '长期借款' },
  { id: 'longPayables', label: '长期应付款' },
  { id: 'provisions', label: '预计负债' },
  { id: 'otherLongLiabilities', label: '其他长期负债' },
  { id: 'longLiabilitiesTotal', label: '长期负债合计' },
  { id: 'agencyLiabilities', label: '受托代理负债：', section: true },
  { id: 'agencyLiability', label: '受托代理负债' },
  { id: 'liabilitiesTotal', label: '负债合计' },
  { id: 'netAssets', label: '净资产：', section: true },
  { id: 'unrestricted', label: '非限定性净资产' },
  { id: 'restricted', label: '限定性净资产' },
  { id: 'netAssetsTotal', label: '净资产合计' },
  { id: 'liabilitiesNetAssetsTotal', label: '负债和净资产总计' },
];

/** pp.130–131, 142–146；两项按组织实际增列的明细也保留。 */
export const activityRows: readonly FormRow[] = [
  { id: 'income', label: '一、收入', section: true },
  { id: 'donations', label: '捐赠收入' },
  { id: 'dues', label: '会费收入' },
  { id: 'services', label: '提供服务收入' },
  { id: 'grants', label: '政府补助收入' },
  { id: 'sales', label: '商品销售收入' },
  { id: 'headquarters', label: '总部拨款收入' },
  { id: 'investmentIncome', label: '投资收益' },
  { id: 'otherIncome', label: '其他收入' },
  { id: 'incomeTotal', label: '收入合计' },
  { id: 'expenses', label: '二、费用', section: true },
  { id: 'activityCost', label: '业务活动成本' },
  { id: 'activityDetails', label: '其中：按实际业务增列成本明细', section: true },
  { id: 'charitableTrust', label: '其中：设立慈善信托支出（适用时）' },
  { id: 'taxExpense', label: '税金及附加' },
  { id: 'administration', label: '管理费用' },
  { id: 'fundraising', label: '筹资费用' },
  { id: 'fundraisingCost', label: '其中：募捐成本（适用时）' },
  { id: 'impairment', label: '资产减值损失' },
  { id: 'incomeTax', label: '所得税费用' },
  { id: 'otherExpense', label: '其他费用' },
  { id: 'expenseTotal', label: '费用合计' },
  { id: 'release', label: '三、限定性净资产转为非限定性净资产' },
  { id: 'restriction', label: '四、非限定性净资产转为限定性净资产' },
  { id: 'priorAdjustment', label: '五、以前年度净资产调整' },
  { id: 'netChange', label: '六、净资产变动额（减少以“-”号填列）' },
];

/** pp.132–133, 147–153；total 是本表 B 列公式，不含任何占位金额。 */
export const cashflowRows: readonly FormRow[] = [
  { id: 'operating', label: '一、业务活动产生的现金流量：', section: true },
  { id: 'donations', label: '接受捐赠收到的现金' },
  { id: 'dues', label: '收取会费收到的现金' },
  { id: 'services', label: '提供服务收到的现金' },
  { id: 'sales', label: '销售商品收到的现金' },
  { id: 'grants', label: '政府补助收到的现金' },
  { id: 'otherOperatingReceipts', label: '收到的其他与业务活动有关的现金' },
  { id: 'operatingReceipts', label: '现金流入小计', total: 'SUM(B6:B11)' },
  { id: 'donationsPaid', label: '提供捐赠或者资助支付的现金', outflow: true },
  { id: 'employeesPaid', label: '支付给员工以及为员工支付的现金', outflow: true },
  { id: 'goodsServicesPaid', label: '购买商品、接受服务支付的现金', outflow: true },
  { id: 'taxesPaid', label: '各项税费支付的现金', outflow: true },
  { id: 'otherOperatingPayments', label: '支付的其他与业务活动有关的现金', outflow: true },
  { id: 'operatingPayments', label: '现金流出小计', total: 'SUM(B13:B17)' },
  { id: 'operatingNet', label: '业务活动产生的现金流量净额', total: 'B12-B18' },
  { id: 'investing', label: '二、投资活动产生的现金流量：', section: true },
  { id: 'investmentRecovered', label: '收回投资所收到的现金' },
  { id: 'investmentIncome', label: '取得投资收益所收到的现金' },
  { id: 'assetDisposal', label: '处置固定资产、无形资产和其他非流动资产所收回的现金' },
  { id: 'otherInvestingReceipts', label: '收到的其他与投资活动有关的现金' },
  { id: 'investingReceipts', label: '现金流入小计', total: 'SUM(B21:B24)' },
  {
    id: 'assetPurchase',
    label: '购建固定资产、无形资产和其他非流动资产所支付的现金',
    outflow: true,
  },
  { id: 'investmentPaid', label: '对外投资所支付的现金', outflow: true },
  { id: 'otherInvestingPayments', label: '支付的其他与投资活动有关的现金', outflow: true },
  { id: 'investingPayments', label: '现金流出小计', total: 'SUM(B26:B28)' },
  { id: 'investingNet', label: '投资活动产生的现金流量净额', total: 'B25-B29' },
  { id: 'financing', label: '三、筹资活动产生的现金流量：', section: true },
  { id: 'borrowings', label: '借款所收到的现金' },
  { id: 'otherFinancingReceipts', label: '收到的其他与筹资活动有关的现金' },
  { id: 'financingReceipts', label: '现金流入小计', total: 'SUM(B32:B33)' },
  { id: 'principalPaid', label: '偿还借款所支付的现金', outflow: true },
  { id: 'interestPaid', label: '偿付利息所支付的现金', outflow: true },
  { id: 'otherFinancingPayments', label: '支付的其他与筹资活动有关的现金', outflow: true },
  { id: 'financingPayments', label: '现金流出小计', total: 'SUM(B35:B37)' },
  { id: 'financingNet', label: '筹资活动产生的现金流量净额', total: 'B34-B38' },
  { id: 'fx', label: '四、汇率变动对现金的影响额' },
  { id: 'cashNet', label: '五、现金及现金等价物净增加额', total: 'B19+B30+B39+B40' },
];
export const cashflowDetails = cashflowRows.filter((r) => !r.section && !r.total);

export function textCell(address: string, source: string): ReportTemplate['cells'][number] {
  return { address, source, kind: 'text', unit: 'number', currency: 'CNY' };
}

/** 明确标注草稿，所有未接入金额用文本呈现；不供自动生成法定报表使用。 */
export function nonprofitFormDraft(code: NonprofitCode, year: number): ReportTemplate {
  if (!Number.isInteger(year) || year < 2026 || year > 9999)
    throw new Error('民非新制度表样年度须为2026年或以后');
  const name = { '401': '资产负债表', '402': '业务活动表', '403': '现金流量表' }[code];
  const cols = code === '401' ? 6 : code === '402' ? (year === 2026 ? 7 : 9) : 3;
  const t = emptyTemplate({ code, name: `民非${name}（表样草稿，取数未完成）`, rows: 45, cols });
  t.readOnly = true;
  t.cells.push(textCell('A1', `${name}（表样草稿，不能作为已完成报表）`));
  t.cells.push(textCell('A2', `会民非 0${Number(code) - 400} 表；年度：${year}；单位：元`));
  t.cells.push(textCell('A3', '编制单位：待填；取数与附注尚未完成'));
  t.merges.push(
    { row: 1, col: 1, rows: 1, cols },
    { row: 2, col: 1, rows: 1, cols },
    { row: 3, col: 1, rows: 1, cols },
  );
  const addRows = (rows: readonly FormRow[], labelColumn: string, amountColumns: string[]) => {
    rows.forEach((r, i) => {
      t.cells.push(textCell(`${labelColumn}${i + 5}`, r.label));
      if (!r.section)
        for (const col of amountColumns) t.cells.push(textCell(`${col}${i + 5}`, '待接入真实取数'));
    });
  };
  if (code === '401') {
    ['资产', '年初余额', '期末余额', '负债和净资产', '年初余额', '期末余额'].forEach((s, i) =>
      t.cells.push(textCell(`${String.fromCharCode(65 + i)}4`, s)),
    );
    addRows(assetRows, 'A', ['B', 'C']);
    addRows(liabilityRows, 'D', ['E', 'F']);
  } else {
    const headers =
      code === '402'
        ? [
            '项目',
            '本月数·非限定性',
            '本月数·限定性',
            '本月数·合计',
            '本年累计·非限定性',
            '本年累计·限定性',
            '本年累计·合计',
            ...(year === 2026 ? [] : ['上年可比本月·合计', '上年可比累计·合计']),
          ]
        : ['项目', '本年金额', '上年金额'];
    headers.forEach((s, i) => t.cells.push(textCell(`${String.fromCharCode(65 + i)}4`, s)));
    addRows(
      code === '402' ? activityRows : cashflowRows,
      'A',
      headers.slice(1).map((_, i) => String.fromCharCode(66 + i)),
    );
    if (year === 2026) {
      t.cells.push(
        textCell(
          'A44',
          '2026首次执行：业务活动表、现金流量表不要求填列上年比较数；不豁免资产负债表年初余额。',
        ),
      );
      t.merges.push({ row: 44, col: 1, rows: 1, cols });
      if (code === '403')
        for (const cell of t.cells)
          if (/^C\d+$/.test(cell.address) && cell.source === '待接入真实取数')
            cell.source = '不要求填列（2026首次执行）';
    }
  }
  t.colWidths = Array.from({ length: cols }, (_, i) => ({
    col: i + 1,
    width: i === 0 || (code === '401' && i === 3) ? 320 : 150,
  }));
  t.styles = t.cells.map((c) => ({
    address: c.address,
    align: 'left',
    wrap: true,
    bold: /[1-4]$/.test(c.address),
    format: 'general',
  }));
  return ReportTemplateSchema.parse(t);
}
