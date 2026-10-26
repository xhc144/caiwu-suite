import type { CoreServices } from '@caiwu/core/server';
import { seedVouchers, type VoucherSpec } from '@caiwu/testkit';
import { buildBalanceSheetSlice, buildCashflowSlice } from '../../templates/enterprise';

/** 编码全部是测试账套自定义映射，绝不据此声称存在完整官方科目表。 */
export const balanceBindings = {
  cash: ['1001', '1002'],
  fixedAssets: ['1601', '1602', '1603', '1606'],
  construction: ['1604', '1609', '1605', '1608'],
  shortTermLoans: ['2001'],
  capital: ['4001'],
} as const;

export const cashBindings = {
  cashAccounts: ['1001', '1002'],
  items: {
    salesReceipts: 'CF01',
    purchases: 'CF02',
    otherOperatingReceipts: 'CF03',
    assetPurchases: 'CF04',
    loanReceipts: 'CF05',
    debtPayments: 'CF06',
  },
};

export const january: VoucherSpec[] = [
  {
    date: '2026-01-05',
    status: 'posted',
    lines: [
      { account: '100201', debit: 12345, dims: { cashflow: 'CF01' } },
      { account: '6001', credit: 12345 },
    ],
  },
  {
    date: '2026-01-06',
    status: 'posted',
    lines: [
      { account: '6001', debit: 345 },
      { account: '100201', credit: 345, dims: { cashflow: 'CF01' } },
    ],
  },
  {
    date: '2026-01-07',
    status: 'posted',
    lines: [
      { account: '1001', debit: 2000, dims: { cashflow: 'CF01' } },
      { account: '6051', credit: 2000 },
    ],
  },
  {
    date: '2026-01-08',
    status: 'posted',
    lines: [
      { account: '6401', debit: 305 },
      { account: '1001', credit: 305, dims: { cashflow: 'CF02' } },
    ],
  },
  {
    date: '2026-01-09',
    status: 'posted',
    lines: [
      { account: '1001', debit: 10000, dims: { cashflow: 'CF01' } },
      { account: '100201', credit: 10000, dims: { cashflow: 'CF01' } },
    ],
  },
  {
    date: '2026-01-10',
    status: 'posted',
    lines: [
      { account: '100201', debit: 2500, dims: { cashflow: 'CF03' } },
      { account: '6117', credit: 2500 },
    ],
  },
  {
    date: '2026-01-11',
    status: 'posted',
    lines: [
      { account: '1601', debit: 7000 },
      { account: '100201', credit: 7000, dims: { cashflow: 'CF04' } },
    ],
  },
  {
    date: '2026-01-12',
    status: 'posted',
    lines: [
      { account: '6602', debit: 5000, dims: { department: '01' } },
      { account: '1602', credit: 5000 },
    ],
  },
  {
    date: '2026-01-13',
    status: 'posted',
    lines: [
      { account: '6701', debit: 1000 },
      { account: '1603', credit: 1000 },
    ],
  },
  {
    date: '2026-01-14',
    status: 'posted',
    lines: [
      { account: '100201', debit: 20000, dims: { cashflow: 'CF05' } },
      { account: '2001', credit: 20000 },
    ],
  },
  {
    date: '2026-01-15',
    status: 'posted',
    lines: [
      { account: '2001', debit: 5000 },
      { account: '100201', credit: 5000, dims: { cashflow: 'CF06' } },
    ],
  },
];

/** 手算：不是调用报表公式产生的期望值。金额全为分。 */
export const GOLDEN = {
  opening: {
    cash: 150000,
    fixedAssets: 94000,
    construction: 35000,
    shortTermLoans: 40000,
    capital: 239000,
  },
  january: {
    cash: 174195,
    fixedAssets: 95000,
    construction: 35000,
    shortTermLoans: 55000,
    capital: 239000,
    salesReceipts: 14000,
    purchases: 305,
    otherOperatingReceipts: 2500,
    assetPurchases: 7000,
    loanReceipts: 20000,
    debtPayments: 5000,
    // 本期收入14000 + 其他收益2500 - 成本305 - 管理5000 - 减值1000。
    revenue: 14000,
    netProfit: 10195,
    cashIncrease: 24195,
    assetsTotal: 304195,
    liabilitiesEquityTotal: 304195,
  },
  february: { cash: 174696, salesReceipts: 501, purchases: 0 },
};

export async function setupEnterpriseFixture(svc: CoreServices) {
  for (const [code, name, direction] of [
    ['1603', '测试固定资产减值准备', 'credit'],
    ['1604', '测试在建工程', 'debit'],
    ['1609', '测试在建工程减值准备', 'credit'],
    ['1605', '测试工程物资', 'debit'],
    ['1608', '测试工程物资减值准备', 'credit'],
    ['1606', '测试固定资产清理', 'debit'],
    ['6117', '测试其他收益', 'credit'],
    ['6701', '测试资产减值损失', 'debit'],
  ] as const)
    await svc.accounts.create(
      { code, name, direction, categoryId: code.startsWith('1') ? 'asset' : 'pnl' },
      [4, 2, 2],
    );
  for (const [code, name] of [
    ['CF03', '测试其他经营收款（含政府补助）'],
    ['CF04', '测试购建长期资产'],
    ['CF05', '测试借款收款'],
    ['CF06', '测试偿还借款'],
  ])
    await svc.dimensions.create({ type: 'cashflow', code: code!, name: name! });
  for (const [code, amount] of [
    ['1001', 100000],
    ['100201', 50000],
    ['1601', 120000],
    ['1602', -20000],
    ['1603', -5000],
    ['1606', -1000],
    ['1604', 30000],
    ['1609', -3000],
    ['1605', 10000],
    ['1608', -2000],
    ['2001', -40000],
    ['4001', -239000],
  ] as const)
    await svc.opening.upsert({
      year: 2026,
      accountId: (await svc.accounts.require(code)).id,
      balance: amount,
    });
  await seedVouchers(svc, january);
}

export function balanceSlice() {
  return buildBalanceSheetSlice(
    Object.fromEntries(Object.entries(balanceBindings).map(([k, v]) => [k, [...v]])),
  );
}
export async function cashSlice(svc: CoreServices) {
  return buildCashflowSlice(cashBindings, await svc.accounts.list());
}

export const closingTransfer: VoucherSpec = {
  date: '2026-01-31',
  status: 'posted',
  lines: [
    { account: '6001', debit: 12000 },
    { account: '6051', debit: 2000 },
    { account: '6117', debit: 2500 },
    { account: '6401', credit: 305 },
    { account: '6602', credit: 5000, dims: { department: '01' } },
    { account: '6701', credit: 1000 },
    { account: '4103', credit: 10195 },
  ],
};
