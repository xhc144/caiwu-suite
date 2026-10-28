import { seedVouchers, voucherInputFromSpec } from '@caiwu/testkit';
import type { CoreServices } from '@caiwu/core/server';
import type { Voucher } from '@caiwu/core';
import {
  ConfigurationSchema,
  balanceKey,
  lineIdentity,
  mappedRow,
  type Configuration,
  type StatementRequest,
  type Sources,
  type NetAssetEvent,
} from '../../templates/nonprofit/model';
import { readNonprofitSources } from '../../templates/nonprofit/sources.server';

export const annual: StatementRequest = {
  code: '401',
  from: 202601,
  to: 202612,
  kind: 'annual',
  includeUnposted: false,
  comparison: true,
};
export const income: [string, number][] = [
  ['4101', 1000],
  ['4201', 200],
  ['4301', 300],
  ['4401', 400],
  ['4501', 500],
  ['4701', 600],
  ['4601', 700],
  ['4901', 800],
];
export const expenses: [string, number][] = [
  ['5101', 100],
  ['5201', 200],
  ['5301', 300],
  ['5401', 400],
  ['5501', 500],
  ['5601', 600],
  ['5901', 700],
];
export function blankConfiguration(bookId: string, year = 2026): Configuration {
  return ConfigurationSchema.parse({
    version: 1,
    bookId,
    year,
    accountingBasis: '合成资料采用2026制度',
    transitionOpeningReference: '合成新旧衔接工作底稿与新账年初',
    mappings: [
      { account: '1503', row: 'fixedAllowance', basis: '按原文137页固定资产备抵' },
      { account: '1603', row: 'intangibleAllowance', basis: '按原文138页无形资产备抵' },
      { account: '1991', row: 'otherCurrentAssets', basis: '合成其他流动资产' },
      { account: '2401', row: 'otherCurrentLiabilities', basis: '合成其他流动负债' },
      { account: '2509', row: 'otherLongLiabilities', basis: '合成长期合同' },
    ],
    resources: [
      {
        id: 'U',
        name: '合成不受外部限制资源',
        classification: 'unrestricted',
        sourceReference: '合成提供者文件U',
        acquisitionReference: '合成资源取得U',
        openingBalance: 300000,
        openingReference: '合成年初资源U',
        unrestrictedBasis: '提供者原文未设置时间和用途限制',
      },
      {
        id: 'R',
        name: '合成限定资源',
        classification: 'restricted',
        sourceReference: '合成提供者文件R',
        acquisitionReference: '合成资源取得R',
        openingBalance: 52430,
        openingReference: '合成年初资源R',
        restriction: {
          authority: 'assetProvider',
          issuer: '合成资源提供者',
          sourceReference: '合成提供者文件R',
          resourceReference: 'R',
          specificClause: '限用于合成教学项目',
          purpose: { description: '合成教学项目' },
        },
      },
    ],
    recognitions: [],
    events: [],
    balanceFacts: [],
    cashScope: [
      {
        account: '1001',
        included: true,
        basis: '合成可随时支付现金',
        agency: false,
        restricted: false,
        equivalent: false,
      },
      {
        account: '1002',
        included: true,
        basis: '合成随时支付银行存款',
        agency: false,
        restricted: false,
        equivalent: false,
      },
      {
        account: '1009',
        included: false,
        basis: '合成受托货币资金',
        agency: true,
        restricted: false,
        equivalent: false,
      },
    ],
    cashConfirmations: [],
    cashPolicy: '合成现金范围政策，受托款项不属于本组织现金',
  });
}
export async function seedFullYear(
  svc: CoreServices,
  year = 2026,
  factors: readonly number[] = Array<number>(12).fill(1),
) {
  const p1 = await svc.dimensions.create({ type: 'partner', code: 'A', name: '合成对象甲' }),
    p2 = await svc.dimensions.create({ type: 'partner', code: 'B', name: '合成对象乙' });
  const opening: [string, number, number?][] = [
    ['1001', 100000],
    ['1002', 200000],
    ['1009', 5000],
    ['1101', 10000],
    ['1102', -100],
    ['1111', 1000],
    ['1121', 2000, p1.id],
    ['1121', -300, p2.id],
    ['1122', 3000],
    ['1131', -50],
    ['1141', 4000],
    ['1201', 5000],
    ['1202', -80],
    ['1301', 600],
    ['1401', 7000],
    ['1402', 8000],
    ['1403', 9000],
    ['1421', -90],
    ['1501', 20000],
    ['1502', -1000],
    ['1503', -100],
    ['1505', 2000],
    ['1506', 4000],
    ['1509', -200],
    ['1601', 6000],
    ['1602', -300],
    ['1603', -50],
    ['1701', 700],
    ['1801', 8000],
    ['1991', 900],
    ['2101', -10000],
    ['2201', -1000],
    ['220201', -1000],
    ['220202', 500],
    ['2203', -700],
    ['2204', -300],
    ['2206', -400],
    ['2209', -1500],
    ['2301', -200],
    ['2401', -800],
    ['2501', -10000],
    ['2502', -2000],
    ['2503', -500],
    ['2509', -600],
    ['2601', -13000],
    ['3101', -300000],
    ['3102', -52430],
  ];
  for (const [code, balance, partner] of opening) {
    const a = await svc.accounts.require(code);
    await svc.opening.upsert({
      year,
      accountId: a.id,
      balance,
      dimensions: partner ? { partner } : undefined,
    });
  }
  await seedBusinessYear(svc, year, factors);
  const create = async (
    date: string,
    lines: { account: string; debit?: number; credit?: number }[],
  ) => (await seedVouchers(svc, [{ date, status: 'posted', lines }]))[0]!;
  const release = await create(`${year}-02-10`, [
    { account: '3102', debit: 50 },
    { account: '3101', credit: 50 },
  ]);
  const impose = await create(`${year}-03-10`, [
    { account: '3101', debit: 30 },
    { account: '3102', credit: 30 },
  ]);
  const adjustment = await create(`${year}-04-10`, [
    { account: '1122', debit: 70 },
    { account: '3201', credit: 70 },
  ]);
  await create(`${year}-04-11`, [
    { account: '3201', debit: 70 },
    { account: '3101', credit: 70 },
  ]);
  const capital = await create(`${year}-05-10`, [
    { account: '1002', debit: 80 },
    { account: '3101', credit: 80 },
  ]);
  return { release, impose, adjustment, capital };
}
export async function seedBusinessYear(
  svc: CoreServices,
  year: number,
  factors: readonly number[],
) {
  if (factors.length !== 12) throw new Error('固定账套须提供十二个月的业务倍数');
  for (const [i, factor] of factors.entries()) {
    const date = `${year}-${String(i + 1).padStart(2, '0')}-05`;
    for (const [account, amount] of income)
      await seedVouchers(svc, [
        {
          date,
          status: 'posted',
          summary: '合成每月收入',
          lines: [
            { account: '1002', debit: amount * factor },
            { account, credit: amount * factor },
          ],
        },
      ]);
    for (const [account, amount] of expenses)
      await seedVouchers(svc, [
        {
          date,
          status: 'posted',
          summary: '合成每月费用',
          lines: [
            { account, debit: amount * factor },
            { account: account === '5501' ? '1102' : '1002', credit: amount * factor },
          ],
        },
      ]);
  }
}
function event(
  v: Voucher,
  kind: NetAssetEvent['kind'],
  resourceId: string,
  amount: number,
): NetAssetEvent {
  return {
    id: `合成事件${v.id}`,
    kind,
    date: v.date,
    resourceId,
    amount,
    sourceReference: '合成外部凭据',
    lines: v.lines.map((l) => ({
      line: {
        voucherId: v.id,
        lineId: l.id,
        revision: v.revision,
        period: v.period,
        account: l.accountCode,
        debit: l.debit,
        credit: l.credit,
      },
      debit: l.debit,
      credit: l.credit,
    })),
  };
}
export async function confirmFixture(
  svc: CoreServices,
  v: Awaited<ReturnType<typeof seedFullYear>> | undefined,
  year = 2026,
): Promise<Configuration> {
  const sources = await readNonprofitSources(svc, {
    ...annual,
    from: year * 100 + 1,
    to: year * 100 + 12,
  });
  const c = blankConfiguration(sources.book.id, year);
  c.events = v
    ? [
        {
          ...event(v.release, 'release', 'R', 50),
          restriction: {
            ...c.resources[1]!.restriction!,
            purpose: {
              description: '合成教学项目',
              releaseReference: '提供者书面解除全部用途限制',
            },
          },
        },
        {
          ...event(v.impose, 'restriction', 'U', 30),
          restriction: {
            authority: 'lawOrRegulation',
            issuer: '合成外部提供者',
            sourceReference: '合成新增具体限制',
            resourceReference: 'U',
            specificClause: '后续特定用途限制',
            purpose: { description: '合成专项用途' },
          },
        },
        {
          ...event(v.adjustment, 'priorAdjustment', 'U', 70),
          originalPeriod: (year - 1) * 100 + 12,
        },
        event(v.capital, 'directCapital', 'U', 80),
      ]
    : [];
  for (const e of sources.entries) {
    const row = mappedRow(e.accountCode, c.mappings);
    if (
      row &&
      [...income.map((x) => x[0]), ...expenses.map((x) => x[0])].includes(e.accountCode) &&
      e.closingKind !== 'pnl'
    )
      c.recognitions.push({
        line: lineIdentity(e),
        row: row as Configuration['recognitions'][number]['row'],
        allocations: [
          {
            resourceId: 'U',
            classification: 'unrestricted',
            debit: (e.debit * 3) / 5,
            credit: (e.credit * 3) / 5,
            recognitionReference: '合成逐笔取得或使用U',
            acquisitionReference: '合成资源取得U',
            ...(row === 'activityCost' ? { detail: '合成教育活动' } : {}),
            charitableTrust: false,
            fundraisingCost: row === 'fundraising',
          },
          {
            resourceId: 'R',
            classification: 'restricted',
            debit: (e.debit * 2) / 5,
            credit: (e.credit * 2) / 5,
            recognitionReference: '合成逐笔取得或使用R',
            acquisitionReference: '合成资源取得R',
            ...(row === 'activityCost' ? { detail: '合成慈善信托' } : {}),
            charitableTrust: row === 'activityCost',
            fundraisingCost: false,
          },
        ],
      });
    if (c.cashScope.some((a) => a.account === e.accountCode && a.included)) {
      const voucher = await svc.vouchers.get(e.voucherId);
      const other = voucher!.lines.find((l) => l.accountCode !== e.accountCode)!;
      const cf: Configuration['cashConfirmations'][number]['allocations'][number]['row'] =
        other.accountCode === '4101'
          ? 'donations'
          : other.accountCode === '4201'
            ? 'dues'
            : other.accountCode === '4301'
              ? 'services'
              : other.accountCode === '4401'
                ? 'grants'
                : other.accountCode === '4501'
                  ? 'sales'
                  : other.accountCode === '4601'
                    ? 'investmentIncome'
                    : other.accountCode === '5101'
                      ? 'goodsServicesPaid'
                      : ['5201', '5601'].includes(other.accountCode)
                        ? 'taxesPaid'
                        : other.accountCode.startsWith('5')
                          ? 'otherOperatingPayments'
                          : 'otherOperatingReceipts';
      c.cashConfirmations.push({
        line: lineIdentity(e),
        allocations: [
          {
            row: cf,
            amount: e.debit - e.credit,
            sourceReference: '合成逐笔现金分类',
            nature: 'ordinary',
          },
        ],
      });
    }
  }
  c.balanceFacts = balanceFacts(sources, c);
  return ConfigurationSchema.parse(c);
}
export function balanceFacts(s: Sources, c: Configuration): Configuration['balanceFacts'] {
  const facts: Configuration['balanceFacts'] = [];
  for (const point of ['opening', 'closing'] as const) {
    const at = point === 'opening' ? s.openingDate : s.closingDate;
    for (const row of s.balances) {
      const id = mappedRow(row.accountCode, c.mappings),
        n = row[point];
      if (!n) continue;
      type Part = Configuration['balanceFacts'][number]['allocations'][number];
      let allocations: Part[] = [];
      const part = (target: string, amount: number, maturity?: string, agency = false): Part => ({
        row: target,
        amount,
        sourceReference: '合成对应资产合同或托管协议',
        maturity,
        agency,
      });
      if (id === 'debtInvestment')
        allocations =
          point === 'opening'
            ? [
                part('currentInvestment', 2000, '2026-06-01'),
                part('debtInvestment', 3000, '2027-06-01'),
                part('debtInvestment', 3000, '2028-06-01'),
              ]
            : [
                part('currentInvestment', 2000, '2026-06-01'),
                part('currentInvestment', 3000, '2027-06-01'),
                part('debtInvestment', 3000, '2028-06-01'),
              ];
      if (id === 'otherInvestment') allocations = [part('otherInvestment', n, '2029-06-01')];
      if (id === 'investmentAllowance')
        allocations =
          point === 'opening'
            ? [
                part('equityInvestment', -30),
                part('currentInvestment', -10, '2026-06-01'),
                part('debtInvestment', -10, '2027-06-01'),
                part('debtInvestment', -10, '2028-06-01'),
                part('otherInvestment', -30, '2029-06-01'),
              ]
            : [
                part('equityInvestment', -30),
                part('currentInvestment', -10, '2026-06-01'),
                part('currentInvestment', -10, '2027-06-01'),
                part('debtInvestment', -10, '2028-06-01'),
                part('otherInvestment', -30, '2029-06-01'),
              ];
      if (id === 'longBorrowing')
        allocations =
          point === 'opening'
            ? [
                part('currentDebt', -4000, '2026-06-01'),
                part('longBorrowing', -3000, '2027-06-01'),
                part('longBorrowing', -3000, '2028-06-01'),
              ]
            : [
                part('currentDebt', -4000, '2026-06-01'),
                part('currentDebt', -3000, '2027-06-01'),
                part('longBorrowing', -3000, '2028-06-01'),
              ];
      if (id === 'longPayables' || id === 'otherLongLiabilities')
        allocations = [part(id, n, '2029-06-01')];
      if (id === 'fixedAllowance') allocations = [part('fixedNet', n)];
      if (id === 'intangibleAllowance') allocations = [part('intangibleNet', n)];
      if (id === 'cash')
        allocations = [
          part(
            row.accountCode === '1009' ? 'agencyAsset' : 'cash',
            n,
            undefined,
            row.accountCode === '1009',
          ),
        ];
      if (allocations.length) facts.push({ at, key: balanceKey(row), balance: n, allocations });
    }
  }
  return facts;
}
export async function closePnl(svc: CoreServices, year = 2026) {
  const input = await voucherInputFromSpec(svc, {
    date: `${year}-12-31`,
    lines: [
      ...income.map(([account, n]) => ({ account, debit: n * 12 })),
      ...expenses.map(([account, n]) => ({ account, credit: n * 12 })),
      { account: '3101', credit: 12240 },
      { account: '3102', credit: 8160 },
    ],
  });
  const v = await svc.vouchers.create({ ...input, closingKind: 'pnl' });
  await svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
  await svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
  return v;
}
