import type { CoreServices } from '@caiwu/core/server';
import { createTestApp, seedVouchers, type VoucherSpec } from '@caiwu/testkit';
import reportServer from '../../server';
import { cashflowItems, cashflowLines } from '../../templates/small-business/catalogue';

// 本任务的合成测试科目；既不读真实账套，也不依赖其他模块的页面/模板注册。
const accounts = [
  ['1001', '库存现金', 'asset'],
  ['1002', '银行存款', 'asset'],
  ['100201', '银行一户', 'asset'],
  ['1012', '其他货币资金', 'asset'],
  ['1101', '短期投资', 'asset'],
  ['1121', '应收票据', 'asset'],
  ['1122', '应收账款', 'asset'],
  ['1123', '预付账款', 'asset'],
  ['1131', '应收股利', 'asset'],
  ['1132', '应收利息', 'asset'],
  ['1221', '其他应收款', 'asset'],
  ['1403', '原材料', 'asset'],
  ['1405', '库存商品', 'asset'],
  ['1411', '周转材料', 'asset'],
  ['1501', '长期债券投资', 'asset'],
  ['1511', '长期股权投资', 'asset'],
  ['1601', '固定资产', 'asset'],
  ['1602', '累计折旧', 'asset', 'credit'],
  ['1604', '在建工程', 'asset'],
  ['1605', '工程物资', 'asset'],
  ['1606', '固定资产清理', 'asset'],
  ['1621', '生产性生物资产', 'asset'],
  ['1622', '生产性生物资产累计折旧', 'asset', 'credit'],
  ['1701', '无形资产', 'asset'],
  ['1702', '累计摊销', 'asset', 'credit'],
  ['2001', '短期借款', 'liability'],
  ['2201', '应付票据', 'liability'],
  ['2202', '应付账款', 'liability'],
  ['2203', '预收账款', 'liability'],
  ['2211', '应付职工薪酬', 'liability'],
  ['2221', '应交税费', 'liability'],
  ['2231', '应付利息', 'liability'],
  ['2232', '应付利润', 'liability'],
  ['2241', '其他应付款', 'liability'],
  ['3001', '实收资本', 'equity'],
  ['3002', '资本公积', 'equity'],
  ['3101', '盈余公积', 'equity'],
  ['3103', '本年利润', 'equity'],
  ['3104', '利润分配', 'equity'],
  ['4001', '生产成本', 'cost'],
  ['4301', '研发支出', 'cost'],
  ['5001', '主营业务收入', 'pnl', 'credit'],
  ['5051', '其他业务收入', 'pnl', 'credit'],
  ['5111', '投资收益', 'pnl', 'credit'],
  ['5301', '营业外收入', 'pnl', 'credit'],
  ['5401', '主营业务成本', 'pnl'],
  ['5402', '其他业务成本', 'pnl'],
  ['5403', '营业税金及附加', 'pnl'],
  ['5601', '销售费用', 'pnl'],
  ['5602', '管理费用', 'pnl'],
  ['5603', '财务费用', 'pnl'],
  ['5711', '营业外支出', 'pnl'],
  ['5801', '所得税费用', 'pnl'],
] as const;

const accountingFixture = {
  schemaVersion: 1,
  id: 'small-business-w2-03-fixture',
  version: '1',
  name: '小企业报表合成测试科目',
  regime: 'small-business',
  codeScheme: '4-2-2',
  categories: [
    { id: 'asset', name: '资产', direction: 'debit' },
    { id: 'liability', name: '负债', direction: 'credit' },
    { id: 'equity', name: '权益', direction: 'credit' },
    { id: 'cost', name: '成本', direction: 'debit' },
    { id: 'pnl', name: '损益', direction: 'debit', isPnl: true },
  ],
  accounts: accounts.map((row) => ({
    code: row[0],
    name: row[1],
    category: row[2],
    direction: row.length === 4 ? row[3] : undefined,
    dimensions: ['1122', '1123', '2202', '2203'].includes(row[0]) ? [{ type: 'partner' }] : [],
  })),
  voucherTypes: [{ code: '记', name: '记账凭证' }],
};

export async function smallBusinessApp(startMonth = 1, startYear = 2026) {
  return createTestApp({
    modules: [{ ...reportServer, templates: [accountingFixture] }],
    templateId: accountingFixture.id,
    startMonth,
    startYear,
  });
}

export async function prepareCashflow(svc: CoreServices) {
  for (const item of cashflowItems)
    await svc.dimensions.create({
      type: 'cashflow',
      code: item.code,
      name: cashflowLines[item.line - 1]!,
    });
  await svc.dimensions.create({ type: 'cashflow', code: 'SB_INTERNAL', name: '现金内部转存' });
}

export async function opening(
  svc: CoreServices,
  code: string,
  balance: number,
  extra: { ytdDebit?: number; ytdCredit?: number } = {},
) {
  await svc.opening.upsert({
    year: 2026,
    accountId: (await svc.accounts.require(code)).id,
    balance,
    ...extra,
  });
}

function cash(
  date: string,
  code: string,
  amount: number,
  incoming: boolean,
  other: string,
): VoucherSpec {
  return {
    date,
    status: 'posted',
    lines: [
      { account: '1001', [incoming ? 'debit' : 'credit']: amount, dims: { cashflow: code } },
      { account: other, [incoming ? 'credit' : 'debit']: amount },
    ],
  };
}

export const cashflowVouchers: VoucherSpec[] = [
  cash('2026-01-05', 'SB01', 120001, true, '5001'),
  cash('2026-01-05', 'SB02', 2001, true, '5301'),
  cash('2026-01-05', 'SB03', 30001, false, '1405'),
  cash('2026-01-05', 'SB04', 10001, false, '2211'),
  cash('2026-01-05', 'SB05', 2001, false, '2221'),
  cash('2026-01-05', 'SB06', 3001, false, '5602'),
  cash('2026-01-05', 'SB08', 8001, true, '1101'),
  cash('2026-01-05', 'SB09', 901, true, '5111'),
  cash('2026-01-05', 'SB10', 6001, true, '1606'),
  cash('2026-01-05', 'SB10', 1001, false, '1606'),
  cash('2026-01-05', 'SB11', 4001, false, '1101'),
  cash('2026-01-05', 'SB12', 20001, false, '1601'),
  cash('2026-01-05', 'SB14', 50001, true, '2001'),
  cash('2026-01-05', 'SB15', 70001, true, '3001'),
  cash('2026-01-05', 'SB16', 10001, false, '2001'),
  cash('2026-01-05', 'SB17', 501, false, '5603'),
  cash('2026-01-05', 'SB18', 2001, false, '2232'),
  {
    date: '2026-01-06',
    status: 'posted',
    lines: [
      { account: '100201', debit: 7001, dims: { cashflow: 'SB_INTERNAL' } },
      { account: '1001', credit: 7001, dims: { cashflow: 'SB_INTERNAL' } },
    ],
  },
  cash('2026-02-05', 'SB01', 22002, true, '5001'),
  cash('2026-02-05', 'SB01', 2002, false, '5001'),
  cash('2026-02-05', 'SB03', 5001, false, '1405'),
  cash('2026-02-05', 'SB03', 1001, true, '1405'),
  cash('2026-02-05', 'SB04', 2001, false, '2211'),
  cash('2026-02-05', 'SB04', 401, false, '1604'),
  cash('2026-02-05', 'SB05', 501, false, '2221'),
  cash('2026-02-05', 'SB06', 1001, false, '5602'),
  cash('2026-02-05', 'SB08', 2000, true, '1101'),
  cash('2026-02-05', 'SB09', 101, true, '5111'),
  cash('2026-02-05', 'SB10', 301, false, '1606'),
  cash('2026-02-05', 'SB11', 1001, false, '1101'),
  cash('2026-02-05', 'SB12', 3001, false, '1601'),
  cash('2026-02-05', 'SB14', 10000, true, '2001'),
  cash('2026-02-05', 'SB16', 1001, false, '2001'),
  cash('2026-02-05', 'SB17', 101, false, '5603'),
  cash('2026-02-05', 'SB17', 201, false, '1604'),
  cash('2026-02-05', 'SB18', 1001, false, '2232'),
];

/** 独立纸笔累计，制度行1—22，单位分；没有调用公式构造器计算期望值。 */
export const cashflowGolden = {
  january: [
    120001, 2001, 30001, 10001, 2001, 3001, 76998, 8001, 901, 5000, 4001, 20001, -10100, 50001,
    70001, 10001, 501, 2001, 107499, 174397, 100000, 274397,
  ],
  february: [
    20000, 0, 4000, 2402, 501, 1001, 12096, 2000, 101, -301, 1001, 3001, -2202, 10000, 0, 1001, 302,
    1001, 7696, 17590, 274397, 291987,
  ],
  ytdFebruary: [
    140001, 2001, 34001, 12403, 2502, 4002, 89094, 10001, 1002, 4699, 5002, 23002, -12302, 60001,
    70001, 11002, 803, 3002, 115195, 191987, 100000, 291987,
  ],
} as const;

export async function seedCashflowBook(svc: CoreServices) {
  await prepareCashflow(svc);
  await opening(svc, '1001', 100000);
  await opening(svc, '3001', -100000);
  await seedVouchers(svc, cashflowVouchers);
}
