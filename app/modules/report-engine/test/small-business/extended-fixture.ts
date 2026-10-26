import type { CoreServices } from '@caiwu/core/server';
import { makePeriod } from '@caiwu/core';
import { seedVouchers, voucherInputFromSpec, type VoucherSpec } from '@caiwu/testkit';
import { cashflowVouchers, prepareCashflow } from './fixture';

const trade = (date: string, account: string, amount: number, incoming: boolean): VoucherSpec => ({
  date,
  status: 'posted',
  lines: [
    { account: '1001', [incoming ? 'debit' : 'credit']: amount },
    { account, [incoming ? 'credit' : 'debit']: amount },
  ],
});

export const incomeVouchers: VoucherSpec[] = [
  trade('2025-12-05', '5001', 30001, true),
  trade('2025-12-05', '5401', 10001, false),
  trade('2025-12-05', '5602', 5001, false),
  trade('2025-12-05', '5603', 501, true),
  trade('2025-12-05', '5111', 201, false),
  trade('2025-12-05', '5301', 101, true),
  trade('2025-12-05', '5711', 301, false),
  trade('2025-12-05', '5801', 1001, false),
  trade('2026-01-05', '5001', 11002, true),
  trade('2026-01-06', '5001', 1001, false),
  trade('2026-01-05', '5401', 5002, false),
  trade('2026-01-06', '5401', 1001, true),
  trade('2026-01-05', '5602', 1000, false),
  trade('2026-01-05', '5111', 201, false),
  trade('2026-01-05', '5801', 1001, false),
  trade('2026-02-05', '5001', 20002, true),
  trade('2026-02-06', '5001', 1001, false),
  trade('2026-02-05', '5401', 8001, false),
  trade('2026-02-05', '5601', 1001, false),
  trade('2026-02-05', '5602', 2001, false),
  trade('2026-02-05', '5603', 201, true),
  trade('2026-02-05', '5111', 301, true),
  trade('2026-02-05', '5301', 401, true),
  trade('2026-02-05', '5711', 501, false),
  trade('2026-02-05', '5801', 2001, false),
];

/** 制度行次到纸笔金额，未配明细不填入该黄金集。年报只在12月使用上年全年。 */
export const incomeGolden = {
  previousYear: {
    1: 30001,
    2: 10001,
    3: 0,
    11: 0,
    14: 5001,
    18: -501,
    20: -201,
    21: 15299,
    22: 101,
    24: 301,
    30: 15099,
    31: 1001,
    32: 14098,
  },
  january: {
    1: 10001,
    2: 4001,
    3: 0,
    11: 0,
    14: 1501,
    18: 0,
    20: -201,
    21: 4298,
    22: 0,
    24: 0,
    30: 4298,
    31: 1001,
    32: 3297,
  },
  february: {
    1: 19001,
    2: 8001,
    3: 0,
    11: 1001,
    14: 2001,
    18: -201,
    20: 301,
    21: 8500,
    22: 401,
    24: 501,
    30: 8400,
    31: 2001,
    32: 6399,
  },
  ytd: {
    1: 29002,
    2: 12002,
    3: 0,
    11: 1001,
    14: 3502,
    18: -201,
    20: 100,
    21: 12798,
    22: 401,
    24: 501,
    30: 12698,
    31: 3002,
    32: 9696,
  },
} as const;

export async function seedWithClosingKind(
  svc: CoreServices,
  spec: VoucherSpec,
  closingKind: string,
) {
  const v = await svc.vouchers.create({ ...(await voucherInputFromSpec(svc, spec)), closingKind });
  await svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
  await svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
  return (await svc.vouchers.get(v.id))!;
}

/** 仅通过core创建带真实closingKind标记的结转夹具，不直接改凭证/分录表。 */
export async function closeProfitAndLoss(svc: CoreServices, year: number, month: number) {
  const period = makePeriod(year, month);
  const balances = await svc.ledger.balances({
    periodFrom: period,
    periodTo: period,
    rollup: false,
  });
  const accounts = await svc.accounts.list();
  const pnl = new Set(accounts.filter((a) => a.categoryId === 'pnl').map((a) => a.code));
  const lines: VoucherSpec['lines'] = [];
  let debit = 0;
  let credit = 0;
  for (const row of balances) {
    if (!pnl.has(row.accountCode) || !row.closing) continue;
    const d = row.closing < 0 ? -row.closing : 0;
    const c = row.closing > 0 ? row.closing : 0;
    lines.push({ account: row.accountCode, debit: d, credit: c });
    debit += d;
    credit += c;
  }
  lines.push({
    account: '3103',
    debit: Math.max(credit - debit, 0),
    credit: Math.max(debit - credit, 0),
  });
  return seedWithClosingKind(
    svc,
    {
      date: `${year}-${String(month).padStart(2, '0')}-28`,
      status: 'posted',
      summary: '合成损益结转',
      lines,
    },
    'pnl',
  );
}

export async function seedExtendedIncomeBook(svc: CoreServices) {
  await svc.periods.ensureYear(2026);
  await seedVouchers(svc, incomeVouchers);
  // 非pnl结转仍是该月真实费用；exclude全部结转会把这501分漏掉。
  const other = await seedWithClosingKind(svc, trade('2026-01-05', '5602', 501, false), 'custom');
  const previous = await closeProfitAndLoss(svc, 2025, 12);
  const january = await closeProfitAndLoss(svc, 2026, 1);
  const february = await closeProfitAndLoss(svc, 2026, 2);
  return { other, previous, january, february };
}

/** 同一末级的不同往来方向不能先互相抵销；不同末级也不能先抵销。 */
export async function seedReclassificationBook(svc: CoreServices) {
  for (const code of ['112201', '112202'])
    await svc.accounts.create(
      { code, name: `应收明细${code}`, dimensions: [{ type: 'partner', required: true }] },
      [4, 2, 2],
    );
  const customer = (await svc.dimensions.getByCode('partner', 'C001'))!;
  const supplier = (await svc.dimensions.getByCode('partner', 'S001'))!;
  for (const [code, partner, balance] of [
    ['112201', customer.id, 1001],
    ['112201', supplier.id, -601],
    ['112202', customer.id, 501],
    ['112202', supplier.id, -201],
    ['2203', customer.id, 301],
    ['2203', supplier.id, -701],
    ['2202', customer.id, 401],
    ['2202', supplier.id, -901],
    ['1123', customer.id, 201],
    ['1123', supplier.id, -101],
  ] as const)
    await svc.opening.upsert({
      year: 2026,
      accountId: (await svc.accounts.require(code)).id,
      dimensions: { partner },
      balance,
    });
  await svc.opening.upsert({
    year: 2026,
    accountId: (await svc.accounts.require('1001')).id,
    balance: 100,
  });
  await seedVouchers(svc, [
    {
      date: '2026-02-05',
      status: 'posted',
      lines: [
        { account: '1001', debit: 401 },
        { account: '112201', credit: 401, dims: { partner: 'C001' } },
      ],
    },
    {
      date: '2026-02-05',
      status: 'posted',
      lines: [
        { account: '1001', debit: 100 },
        { account: '112201', credit: 100, dims: { partner: 'S001' } },
      ],
    },
    {
      date: '2026-02-05',
      status: 'posted',
      lines: [
        { account: '1001', debit: 100 },
        { account: '2202', credit: 100, dims: { partner: 'C001' } },
      ],
    },
    {
      date: '2026-02-05',
      status: 'posted',
      lines: [
        { account: '1001', debit: 200 },
        { account: '1123', credit: 200, dims: { partner: 'S001' } },
      ],
    },
  ]);
}

/** 2025年现金净增174397分，2026年净增191987分；两年连续但取数范围不同。 */
export async function seedAnnualCashflowBook(svc: CoreServices) {
  await svc.periods.ensureYear(2026);
  await prepareCashflow(svc);
  await svc.opening.upsert({
    year: 2025,
    accountId: (await svc.accounts.require('1001')).id,
    balance: 100000,
  });
  await svc.opening.upsert({
    year: 2025,
    accountId: (await svc.accounts.require('3001')).id,
    balance: -100000,
  });
  await seedVouchers(
    svc,
    cashflowVouchers
      .filter((v) => v.date.startsWith('2026-01'))
      .map((v) => ({ ...v, date: '2025-12-05' })),
  );
  await seedVouchers(svc, cashflowVouchers);
}
