import {
  seedVouchers,
  voucherInputFromSpec,
  type LineSpec,
  type VoucherSpec,
} from '@caiwu/testkit';
import type { CoreServices } from '@caiwu/core/server';
import {
  entrySignature,
  initialConfiguration,
  type Role,
} from '../../templates/small-business/configuration';
import { saveConfiguration } from '../../templates/small-business/statutory.server';
import { smallBusinessApp } from './fixture';
import { detailSeeds } from './core-fixture';

// 全部为合成数据，金额单位分。2025每月业务为下列单位业务的2m倍，2026为m倍。
// 期初各资产、负债、权益均非零；两个客供对象共用末级科目，分别保留借贷余额。
const openingPortfolio: readonly (readonly [string, number, string?])[] = [
  ['1001', 100000],
  ['100201', 2000000],
  ['1012', 50000],
  ['1101', 20000],
  ['1121', 30000],
  ['112201', 40000, 'YEAR-A'],
  ['112201', -10000, 'YEAR-B'],
  ['1123', 50000, 'YEAR-A'],
  ['1123', -6000, 'YEAR-B'],
  ['1131', 600000],
  ['1132', 7000],
  ['1221', 8000],
  ['1401', 1010],
  ['1402', 1020],
  ['1403', 10030],
  ['1404', -1040],
  ['4001', 10050],
  ['4101', 550],
  ['1405', 100060],
  ['1407', -1070],
  ['1408', 1080],
  ['1411', 10090],
  ['1421', 1100],
  ['1499', 1110],
  ['1498', 14000],
  ['1501', 16000],
  ['1511', 17000],
  ['1601', 180000],
  ['1602', -19000],
  ['1604', 21000],
  ['1605', 22000],
  ['1606', -2300],
  ['1621', 24000],
  ['1622', -2400],
  ['1701', 25000],
  ['1702', -2500],
  ['4301', 26000],
  ['1801', 27000],
  ['1999', 28000],
  ['2001', -310000],
  ['2201', -32000],
  ['2202', -33000, 'YEAR-A'],
  ['2202', 7000, 'YEAR-B'],
  ['2203', -37000, 'YEAR-A'],
  ['2203', 8000, 'YEAR-B'],
  ['2211', -350000],
  ['2221', 3600],
  ['2231', -370000],
  ['2232', -380000],
  ['2241', -39000],
  ['2299', -40000],
  ['2501', -42000],
  ['2701', -43000],
  ['2401', -44000],
  ['2999', -45000],
  ['300101', -1502390],
  ['300102', 2000],
  ['3002', -49000],
  ['3101', -50000],
  ['3104', -51000],
];

// 独立按上述期初清单、合同期限、每单位业务逐笔纸算，固定为制度行次顺序。
// 差异：原材料10030-1040=8990，商品100060-1070=98990；两项不再在明细重复。
export const yearOpening = [
  2150000, 20000, 30000, 48000, 47000, 600000, 7000, 8000, 133990, 8990, 10600, 98990, 10090, 17000,
  3060990, 15000, 17000, 180000, 19000, 161000, 21000, 22000, -2300, 21600, 22500, 26000, 25000,
  38000, 366800, 3427790, 310000, 32000, 39000, 39000, 350000, -3600, 370000, 380000, 39000, 49000,
  1604400, 40000, 40000, 40000, 53000, 173000, 1777400, 1502390, 49000, 50000, 51000, 1650390,
  3427790,
] as const;
// 每单位业务的资产负债表增量；非现金成本539=折旧摊销239+商品成本300。
export const yearBalanceMovement = [
  8381, 300, 0, -100, 0, -901, 0, 0, 2500, 2800, 0, -300, 0, 27, 10207, 0, 0, 1200, 190, 1010, 0, 0,
  -1000, -24, -25, 260, 243, 0, 464, 10671, -200, 0, 0, 0, -500, -501, -170, -180, 202, 0, -1349, 0,
  0, 0, 0, 0, -1349, 1500, 0, 0, 10520, 12020, 10671,
] as const;
export const yearIncomeUnit = [
  50402, 20502, 28, 1, 2, 3, 4, 5, 6, 7, 2402, 1101, 1301, 5245, 1501, 1601, 1701, 1501, 1500, 2001,
  22725, 2301, 2301, 13505, 2501, 2601, 2701, 2801, 2901, 11521, 1001, 10520,
] as const;
// 经营7059+投资1872+筹资(-550)=现金增加8381；受限保证金50000不属于现金。
export const yearCashUnit = [
  50502, 2503, 23002, 500, 1530, 20914, 7059, 800, 2902, 1000, 1100, 1730, 1872, 1400, 1500, 1600,
  1670, 180, -550, 8381,
] as const;

const netLine = (account: string, value: number, summary?: string): LineSpec => ({
  account,
  debit: Math.max(0, value),
  credit: Math.max(0, -value),
  summary,
});

function monthlyBusiness(year: number, month: number, factor: number): VoucherSpec[] {
  const date = `${year}-${String(month).padStart(2, '0')}-05`;
  const specs: VoucherSpec[] = [];
  const cash = (account: string, value: number, project: number, partner?: string) => {
    specs.push({
      date,
      status: 'posted',
      summary: `现金项目${project}`,
      lines: [
        { ...netLine(account, value * factor), ...(partner ? { dims: { partner } } : {}) },
        netLine('100201', -value * factor),
      ],
    });
  };
  for (const [code, , amount, project] of detailSeeds) cash(code, amount, project);
  for (const [code, value, project] of [
    ['5001', -50001, 1],
    ['5401', 20001, 3],
    ['5111', -2001, 9],
    ['5801', 1001, 5],
    ['5001', 100, 1],
    ['5051', -501, 1],
    ['5402', 201, 3],
    ['560301', -200, 17],
    ['2241', -202, 2],
    ['1403', 3000, 3],
    ['1403', -200, 3],
    ['2211', 500, 4],
    ['2221', 501, 5],
    ['560204', 203, 6],
    ['1101', -800, 8],
    ['1131', -901, 9],
    ['1606', -1200, 10],
    ['1606', 200, 10],
    ['1101', 1100, 11],
    ['1601', 1200, 12],
    ['4301', 260, 12],
    ['1801', 270, 12],
    ['2001', -1400, 14],
    ['300101', -1500, 15],
    ['2001', 1600, 16],
    ['2231', 170, 17],
    ['2232', 180, 18],
  ] as const)
    cash(code, value, project);
  cash('112201', -100, 1, 'YEAR-A');
  specs.push({
    date,
    status: 'posted',
    summary: '银行转存与手续费',
    lines: [
      netLine('1001', 700 * factor),
      netLine('560302', factor),
      netLine('100201', -701 * factor),
    ],
  });
  specs.push({
    date,
    status: 'posted',
    summary: '非现金成本、折旧与摊销',
    lines: [
      netLine('560204', 239 * factor),
      netLine('1602', -190 * factor),
      netLine('1622', -24 * factor),
      netLine('1702', -25 * factor),
      netLine('5401', 300 * factor),
      netLine('1405', -300 * factor),
    ],
  });
  return specs;
}

// 固定结转金额来自单位凭证清单，不从待测余额/报表反算。
const pnlUnit: readonly (readonly [string, number])[] = [
  ...detailSeeds.map(([code, , value]) => [code, code === '560301' ? 1500 : value] as const),
  ['5001', -49901],
  ['5051', -501],
  ['5401', 20301],
  ['5402', 201],
  ['5111', -2001],
  ['5801', 1001],
  ['560204', 442],
  ['560302', 1],
];
export async function closeFixedMonth(
  svc: CoreServices,
  year: number,
  month: number,
  factor: number,
) {
  const date = `${year}-${String(month).padStart(2, '0')}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
  const input = await voucherInputFromSpec(svc, {
    date,
    summary: '固定账套月末损益结转',
    lines: [
      ...pnlUnit.map(([code, value]) => netLine(code, -value * factor)),
      netLine('3103', -10520 * factor),
    ],
  });
  const voucher = await svc.vouchers.create({ ...input, closingKind: 'pnl' });
  await svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
  await svc.vouchers.changeStatus({ ids: [voucher.id], to: 'posted' });
  return voucher;
}

export async function fixedYearBook() {
  const app = await smallBusinessApp(1, 2025);
  const svc = app.svcFor('report-engine');
  await svc.periods.ensureYear(2026);
  for (const [code, name, categoryId] of [
    ['112201', '应收客户', 'asset'],
    ['4101', '制造费用', 'cost'],
    ['1499', '其他存货', 'asset'],
    ['1498', '其他流动资产', 'asset'],
    ['1999', '其他非流动资产', 'asset'],
    ['1801', '长期待摊费用', 'asset'],
    ['2299', '其他流动负债', 'liability'],
    ['2501', '长期借款', 'liability'],
    ['2701', '长期应付款', 'liability'],
    ['2401', '递延收益', 'liability'],
    ['2999', '其他非流动负债', 'liability'],
    ['300101', '投入资本', 'equity'],
    ['300102', '已归还投资', 'equity'],
  ] as const)
    await svc.accounts.create(
      {
        code,
        name,
        categoryId,
        dimensions: code === '112201' ? [{ type: 'partner' }] : [],
      },
      [4, 2, 2],
    );
  for (const [code, line] of detailSeeds)
    await svc.accounts.create({ code, name: `报表明细${line}` }, [4, 2, 2]);
  await svc.accounts.create({ code: '560204', name: '其他管理费用' }, [4, 2, 2]);
  await svc.accounts.create({ code: '560302', name: '转存手续费' }, [4, 2, 2]);
  const partners = new Map<string, number>();
  for (const code of ['YEAR-A', 'YEAR-B'])
    partners.set(code, (await svc.dimensions.create({ type: 'partner', code, name: code })).id);
  for (const [code, balance, partner] of openingPortfolio)
    await svc.opening.upsert({
      year: 2025,
      accountId: (await svc.accounts.require(code)).id,
      balance,
      ...(partner ? { dimensions: { partner: partners.get(partner)! } } : {}),
    });
  for (const year of [2025, 2026])
    for (let month = 1; month <= 12; month++) {
      const factor = (year === 2025 ? 2 : 1) * month;
      await seedVouchers(svc, monthlyBusiness(year, month, factor));
      await closeFixedMonth(svc, year, month, factor);
    }
  let config = initialConfiguration(app.book.id);
  config.firstYear = { year: 2025, reason: '2025年1月设立的合成测试企业' };
  for (const [code, role] of [
    ['1499', 'otherInventory'],
    ['1498', 'currentAsset'],
    ['1999', 'noncurrentAsset'],
    ['2299', 'currentLiability'],
    ['2999', 'noncurrentLiability'],
  ] as const)
    config.mappings[code] = { role, reason: '测试科目对应实际会计性质' };
  for (const [code, line] of detailSeeds) config.details[code] = { line, reason: '按原始业务明细' };
  config.details['560204'] = { line: null, reason: '折旧摊销和其他管理费用' };
  config.details['560302'] = { line: null, reason: '转存手续费不属于利息' };
  config.cashScope = ['1001', '100201', '1012'].map((account) => ({
    account,
    from: '2025-01-01',
    to: '2026-12-31',
    available: account !== '1012',
    reason: account === '1012' ? '不可随时支用的保证金' : '可随时支用的现金与银行存款',
  }));
  const key = (code: string, partner?: string) =>
    `${code}|${partner ? partners.get(partner) : ''}|||`;
  const fact = (
    period: number,
    code: string,
    balance: number,
    allocations: { role: Role; amount: number }[],
    partner?: string,
  ) => {
    config.facts.push({
      period,
      key: key(code, partner),
      balance,
      allocations,
      reason: '固定合同与原始明细',
    });
  };
  for (const [period, units] of [
    [202412, 0],
    ...[2025, 2026].flatMap((year) =>
      Array.from({ length: 12 }, (_, i) => {
        const month = i + 1;
        return [
          year * 100 + month,
          (year === 2025 ? 0 : 156) + ((year === 2025 ? 2 : 1) * month * (month + 1)) / 2,
        ];
      }),
    ),
  ]) {
    fact(period!, '1404', -1040, [{ role: 'raw', amount: -1040 }]);
    fact(
      period!,
      '112201',
      -10000,
      [
        { role: 'advance', amount: -5000 },
        { role: 'noncurrentLiability', amount: -5000 },
      ],
      'YEAR-B',
    );
    fact(
      period!,
      '1123',
      50000,
      [
        { role: 'prepaid', amount: 40000 },
        { role: 'noncurrentAsset', amount: 10000 },
      ],
      'YEAR-A',
    );
    fact(period!, '2202', 7000, [{ role: 'prepaid', amount: 7000 }], 'YEAR-B');
    fact(
      period!,
      '2203',
      -37000,
      [
        { role: 'advance', amount: -34000 },
        { role: 'noncurrentLiability', amount: -3000 },
      ],
      'YEAR-A',
    );
    fact(period!, '1501', 16000, [
      { role: 'bond', amount: 15000 },
      { role: 'currentAsset', amount: 1000 },
    ]);
    fact(period!, '1801', 27000 + 270 * units!, [
      { role: 'deferredExpense', amount: 25000 + 243 * units! },
      { role: 'currentAsset', amount: 2000 + 27 * units! },
    ]);
    fact(period!, '2501', -42000, [
      { role: 'longLoan', amount: -40000 },
      { role: 'currentLiability', amount: -2000 },
    ]);
    fact(period!, '2701', -43000, [
      { role: 'longPayable', amount: -40000 },
      { role: 'currentLiability', amount: -3000 },
    ]);
    fact(period!, '2401', -44000, [
      { role: 'deferredIncome', amount: -40000 },
      { role: 'currentLiability', amount: -4000 },
    ]);
    fact(period!, '300101', -1502390 - 1500 * units!, [
      { role: 'capital', amount: -1502390 - 1500 * units! },
    ]);
    fact(period!, '300102', 2000, [{ role: 'returnedCapital', amount: 2000 }]);
    fact(period!, '4301', 26000 + 260 * units!, [
      { role: 'development', amount: 26000 + 260 * units! },
    ]);
  }
  const entries = await svc.ledger.entries({ periodFrom: 202501, periodTo: 202612, limit: 200000 });
  for (const entry of entries.filter((e) => ['1001', '100201'].includes(e.accountCode))) {
    const signed = entry.debit - entry.credit;
    const parts =
      entry.summary === '银行转存与手续费'
        ? entry.accountCode === '1001'
          ? [{ line: 0, amount: signed }]
          : [
              { line: 0, amount: (signed / 701) * 700 },
              { line: 6, amount: signed / 701 },
            ]
        : [{ line: Number(entry.summary.replace('现金项目', '')), amount: signed }];
    config.cashAllocations[String(entry.lineId)] = {
      signature: entrySignature(entry, entries),
      parts,
      reason: '逐笔现金业务及手续费的独立分类',
    };
  }
  config = await svc.tx((t) => saveConfiguration(t, config, 1));
  return { app, svc, config };
}
