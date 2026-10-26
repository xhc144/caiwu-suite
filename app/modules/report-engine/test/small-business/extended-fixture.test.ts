import { afterEach, expect, it } from 'vitest';
import type { TestApp } from '@caiwu/testkit';
import { smallBusinessApp } from './fixture';
import {
  incomeGolden,
  seedAnnualCashflowBook,
  seedExtendedIncomeBook,
  seedReclassificationBook,
} from './extended-fixture';

let app: TestApp | undefined;
afterEach(async () => {
  await app?.close();
});

it('共享契约下一切片的真实结转夹具：pnl和custom标记不同，结转后损益为零，黄金利润仍有原始凭证依据', async () => {
  app = await smallBusinessApp(1, 2025);
  const seeded = await seedExtendedIncomeBook(app.svc);
  expect(seeded.other.closingKind).toBe('custom');
  for (const v of [seeded.previous, seeded.january, seeded.february])
    expect(v).toMatchObject({ closingKind: 'pnl', status: 'posted' });
  const balances = await app.svc.ledger.balances({
    periodFrom: 202602,
    periodTo: 202602,
    includeZero: true,
    rollup: false,
  });
  const pnlCodes = new Set(
    (await app.svc.accounts.list()).filter((a) => a.categoryId === 'pnl').map((a) => a.code),
  );
  expect(balances.filter((r) => pnlCodes.has(r.accountCode)).every((r) => r.closing === 0)).toBe(
    true,
  );
  const cash = balances.find((r) => r.accountCode === '1001')!;
  expect(cash.opening).toBe(incomeGolden.previousYear[32] + incomeGolden.january[32]);
  expect(cash.closing).toBe(incomeGolden.previousYear[32] + incomeGolden.ytd[32]);
  expect((await app.svc.ledger.trialBalance(202501, 202602)).balanced).toBe(true);
});

it('往来重分类夹具保留同一末级的正负往来余额和不同末级的正负余额', async () => {
  app = await smallBusinessApp();
  await seedReclassificationBook(app.svc);
  const customer = (await app.svc.dimensions.getByCode('partner', 'C001'))!;
  const supplier = (await app.svc.dimensions.getByCode('partner', 'S001'))!;
  const rows = await app.svc.ledger.balances({
    periodFrom: 202602,
    periodTo: 202602,
    accountCodes: ['1122', '1123', '2202', '2203'],
    groupBy: ['partner'],
    rollup: false,
  });
  const amounts = new Map(rows.map((r) => [`${r.accountCode}:${r.dimensions.partner}`, r.closing]));
  for (const [code, partner, value] of [
    ['112201', customer.id, 600],
    ['112201', supplier.id, -701],
    ['112202', customer.id, 501],
    ['112202', supplier.id, -201],
    ['1123', customer.id, 201],
    ['1123', supplier.id, -301],
    ['2202', customer.id, 301],
    ['2202', supplier.id, -901],
    ['2203', customer.id, 301],
    ['2203', supplier.id, -701],
  ] as const)
    expect(amounts.get(`${code}:${partner}`)).toBe(value);
  expect((await app.svc.ledger.trialBalance(202601, 202602)).balanced).toBe(true);
});

it('年报比较夹具的两年现金范围真实分开：上年末274397分、本年末466384分', async () => {
  app = await smallBusinessApp(1, 2025);
  await seedAnnualCashflowBook(app.svc);
  const previous = await app.svc.ledger.balances({
    periodFrom: 202501,
    periodTo: 202512,
    accountCodes: ['1001', '1002', '1012'],
    rollup: false,
  });
  const current = await app.svc.ledger.balances({
    periodFrom: 202601,
    periodTo: 202612,
    accountCodes: ['1001', '1002', '1012'],
    rollup: false,
  });
  expect(previous.reduce((sum, r) => sum + r.opening, 0)).toBe(100000);
  expect(previous.reduce((sum, r) => sum + r.closing, 0)).toBe(274397);
  expect(current.reduce((sum, r) => sum + r.opening, 0)).toBe(274397);
  expect(current.reduce((sum, r) => sum + r.closing, 0)).toBe(466384);
});
