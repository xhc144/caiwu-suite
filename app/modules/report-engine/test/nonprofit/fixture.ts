import type { AccountingTemplateInput } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { seedVouchers, type VoucherSpec } from '@caiwu/testkit';
import reportServer from '../../server';
import { cashflowDetails } from '../../templates/nonprofit/forms';
import type { Cashflow403Mapping } from '../../templates/nonprofit/cashflow';

/** 手工编造的最小民非测试科目，不是正式会计制度模板；限定性来自明细科目及捐赠约定。 */
export const fixtureChart: AccountingTemplateInput = {
  schemaVersion: 1,
  id: 'test-nonprofit-w2-04',
  version: '1',
  name: '民非报表测试专用',
  regime: 'nonprofit',
  devOnly: true,
  codeScheme: '4-2-2',
  categories: [
    { id: 'asset', name: '资产', direction: 'debit' },
    { id: 'liability', name: '负债', direction: 'credit' },
    { id: 'net-assets', name: '净资产', direction: 'credit' },
    { id: 'revenue', name: '收入', direction: 'credit', isPnl: true },
    { id: 'expense', name: '费用', direction: 'debit', isPnl: true },
  ],
  accounts: [
    { code: '1001', name: '现金', category: 'asset', cash: true, cashflow: true },
    { code: '1002', name: '银行存款', category: 'asset', bank: true },
    { code: '100201', name: '可随时支付的银行存款', category: 'asset', bank: true, cashflow: true },
    { code: '100202', name: '受托代理资产银行专户', category: 'asset', bank: true, cashflow: true },
    { code: '1101', name: '短期投资', category: 'asset' },
    { code: '1102', name: '短期投资跌价准备', category: 'asset', direction: 'credit' },
    { code: '1122', name: '应收账款', category: 'asset' },
    { code: '1131', name: '坏账准备', category: 'asset', direction: 'credit' },
    { code: '1401', name: '存货', category: 'asset' },
    { code: '1402', name: '存货跌价准备', category: 'asset', direction: 'credit' },
    { code: '1501', name: '长期债权投资', category: 'asset' },
    { code: '150101', name: '一年内到期', category: 'asset' },
    { code: '150102', name: '一年后到期', category: 'asset' },
    { code: '1502', name: '长期投资减值准备', category: 'asset', direction: 'credit' },
    { code: '150201', name: '一年内到期减值', category: 'asset', direction: 'credit' },
    { code: '150202', name: '一年后到期减值', category: 'asset', direction: 'credit' },
    { code: '1601', name: '固定资产', category: 'asset' },
    { code: '1602', name: '累计折旧', category: 'asset', direction: 'credit' },
    { code: '1603', name: '固定资产减值准备', category: 'asset', direction: 'credit' },
    { code: '1701', name: '文物资源', category: 'asset' },
    { code: '1801', name: '无形资产', category: 'asset' },
    { code: '1802', name: '累计摊销', category: 'asset', direction: 'credit' },
    { code: '1803', name: '无形资产减值准备', category: 'asset', direction: 'credit' },
    { code: '1901', name: '受托代理资产', category: 'asset' },
    { code: '2001', name: '短期借款', category: 'liability' },
    { code: '2101', name: '受托代理负债', category: 'liability' },
    { code: '2301', name: '长期借款', category: 'liability' },
    { code: '230101', name: '一年内到期借款', category: 'liability' },
    { code: '230102', name: '一年后到期借款', category: 'liability' },
    { code: '3101', name: '非限定性净资产', category: 'net-assets' },
    { code: '3102', name: '限定性净资产', category: 'net-assets' },
    { code: '4101', name: '捐赠收入', category: 'revenue' },
    {
      code: '410101',
      name: '非限定性捐赠收入',
      category: 'revenue',
      source: '虚构外部捐赠者乙协议U1：取得时无用途或时间限制；后续变化须另有外部依据',
    },
    {
      code: '410102',
      name: '限定性捐赠收入',
      category: 'revenue',
      source: '虚构外部捐赠者甲协议R1：食品救助专用、无时间限制；不能仅凭内部用途决议认定或解除',
    },
    { code: '4201', name: '提供服务收入', category: 'revenue' },
    { code: '5101', name: '业务活动成本', category: 'expense' },
    { code: '510101', name: '非限定性业务活动成本', category: 'expense' },
    { code: '510102', name: '限定性业务活动成本', category: 'expense' },
    { code: '5201', name: '管理费用', category: 'expense' },
    { code: '5301', name: '筹资费用', category: 'expense' },
    { code: '5901', name: '以前年度净资产调整', category: 'net-assets' },
  ],
  voucherTypes: [{ code: '记', name: '记账凭证' }],
};
export const nonprofitTestServer = { ...reportServer, templates: [fixtureChart] };

export function fixtureMapping(): Cashflow403Mapping {
  return {
    year: 2026,
    policyBasis: '虚构单位董事会政策：现金及随时支付的银行存款；无现金等价物',
    accounts: [
      { code: '1001', basis: '现金盘点表' },
      { code: '100201', basis: '可随时支取银行对账单' },
    ],
    excludedAccounts: [{ code: '100202', basis: '受托代理专户，逐笔对账，本测试无发生额' }],
    items: Object.fromEntries(
      cashflowDetails.map((r) => [
        r.id,
        { code: `NF_${r.id}`, basis: `虚构原始单据分类：${r.label}` },
      ]),
    ),
    internalTransfer: { code: 'NF_INTERNAL', basis: '库存现金与银行存款内部划转单' },
  };
}

export async function seedCashflowDimensions(svc: CoreServices) {
  const mapping = fixtureMapping();
  for (const d of [...Object.values(mapping.items), mapping.internalTransfer])
    await svc.dimensions.create({
      type: 'cashflow',
      code: d.code,
      name: d.code,
      attrs: { basis: d.basis },
    });
}

export const cashflowSpecs: VoucherSpec[] = [
  {
    date: '2026-01-05',
    status: 'posted',
    lines: [
      { account: '100201', debit: 100_000, dims: { cashflow: 'NF_donations' } },
      { account: '410101', credit: 60_000 },
      { account: '410102', credit: 40_000 },
    ],
  },
  {
    date: '2026-01-10',
    status: 'posted',
    lines: [
      { account: '510101', debit: 10_000 },
      { account: '100201', credit: 10_000, dims: { cashflow: 'NF_goodsServicesPaid' } },
    ],
  },
  // 有原单据的退回冲减同一流入项目，不能把借贷发生额全部当收入。
  {
    date: '2026-02-01',
    status: 'posted',
    lines: [
      { account: '410101', debit: 2_000 },
      { account: '100201', credit: 2_000, dims: { cashflow: 'NF_donations' } },
    ],
  },
  {
    date: '2026-02-02',
    status: 'posted',
    lines: [
      { account: '100201', debit: 20_000, dims: { cashflow: 'NF_services' } },
      { account: '4201', credit: 20_000 },
    ],
  },
  // 处置收入扣处置费用后的净现金：5000-300=4700。
  {
    date: '2026-02-03',
    status: 'posted',
    lines: [
      { account: '100201', debit: 5_000, dims: { cashflow: 'NF_assetDisposal' } },
      { account: '1601', credit: 5_000 },
    ],
  },
  {
    date: '2026-02-03',
    status: 'posted',
    lines: [
      { account: '5201', debit: 300 },
      { account: '100201', credit: 300, dims: { cashflow: 'NF_assetDisposal' } },
    ],
  },
  {
    date: '2026-02-04',
    status: 'posted',
    lines: [
      { account: '1601', debit: 30_000 },
      { account: '100201', credit: 30_000, dims: { cashflow: 'NF_assetPurchase' } },
    ],
  },
  {
    date: '2026-02-05',
    status: 'posted',
    lines: [
      { account: '100201', debit: 50_000, dims: { cashflow: 'NF_borrowings' } },
      { account: '2001', credit: 50_000 },
    ],
  },
  {
    date: '2026-02-06',
    status: 'posted',
    lines: [
      { account: '2001', debit: 10_000 },
      { account: '100201', credit: 10_000, dims: { cashflow: 'NF_principalPaid' } },
    ],
  },
  {
    date: '2026-02-06',
    status: 'posted',
    lines: [
      { account: '5301', debit: 1_000 },
      { account: '100201', credit: 1_000, dims: { cashflow: 'NF_interestPaid' } },
    ],
  },
  {
    date: '2026-02-07',
    status: 'posted',
    lines: [
      { account: '1001', debit: 500, dims: { cashflow: 'NF_INTERNAL' } },
      { account: '100201', credit: 500, dims: { cashflow: 'NF_INTERNAL' } },
    ],
  },
  {
    date: '2026-02-08',
    status: 'pending',
    lines: [
      { account: '100201', debit: 999, dims: { cashflow: 'NF_donations' } },
      { account: '410101', credit: 999 },
    ],
  },
];

export async function seedCashflowBook(svc: CoreServices) {
  await seedCashflowDimensions(svc);
  return seedVouchers(svc, cashflowSpecs);
}

/** 独立手算：经营108000，投资-25300，筹资39000，汇兑0，净增121700分。 */
export const cashflowGolden = {
  B6: '98000',
  B7: '0',
  B8: '20000',
  B9: '0',
  B10: '0',
  B11: '0',
  B12: '118000',
  B13: '0',
  B14: '0',
  B15: '10000',
  B16: '0',
  B17: '0',
  B18: '10000',
  B19: '108000',
  B21: '0',
  B22: '0',
  B23: '4700',
  B24: '0',
  B25: '4700',
  B26: '30000',
  B27: '0',
  B28: '0',
  B29: '30000',
  B30: '-25300',
  B32: '50000',
  B33: '0',
  B34: '50000',
  B35: '10000',
  B36: '1000',
  B37: '0',
  B38: '11000',
  B39: '39000',
  B40: '0',
  B41: '121700',
};
