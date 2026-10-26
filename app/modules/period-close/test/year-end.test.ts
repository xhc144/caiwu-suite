import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import periodCloseServer from '../server';
import { call, errorData, snapshot, zeroOpening } from './helpers';
let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [periodCloseServer] });
  await zeroOpening(app);
});
afterEach(async () => app.close());
async function closeYear() {
  for (let month = 1; month <= 12; month++)
    await call(app).close({ period: 202600 + month, confirmed: true });
}
it('w_zw_fz 年结：全年前置、目标手工期初/业务不覆盖，缺失后年度不会被猜测删除', async () => {
  const api = call(app);
  expect((await errorData(api.yearEnd({ year: 2026, confirmed: true }))).code).toBe(
    'PERIOD_CLOSE_YEAR_NOT_CLOSED',
  );
  await closeYear();
  await app.svc.periods.ensureYear(2027, { openingStored: true });
  await app.svc.opening.upsert({
    year: 2027,
    accountId: (await app.svc.accounts.require('1001')).id,
    balance: 0,
  });
  let before = snapshot(app);
  expect((await errorData(api.yearEnd({ year: 2026, confirmed: true }))).code).toBe(
    'PERIOD_CLOSE_TARGET_HAS_DATA',
  );
  expect(snapshot(app)).toBe(before);
  await app.svc.opening.remove((await app.svc.opening.list(2027))[0]!.id);
  await seedVouchers(app.svc, [{ date: '2027-01-02', status: 'draft', lines: [] }]);
  before = snapshot(app);
  expect((await errorData(api.yearEnd({ year: 2026, confirmed: true }))).code).toBe(
    'PERIOD_CLOSE_TARGET_HAS_DATA',
  );
  expect(snapshot(app)).toBe(before);
  expect((await errorData(api.reopen({ from: 202612, to: 202701, confirmed: true }))).code).toBe(
    'PERIOD_CLOSE_CROSS_YEAR_DISABLED',
  );
  expect(snapshot(app)).toBe(before);
});
it('w_zw_fz 年结：ensureYear、replaceYear、来源标记后半失败整体回滚', async () => {
  await closeYear();
  const api = call(app);
  const raw = app.runtime.bookStore.open(app.book.id).raw;
  raw.exec(
    "CREATE TRIGGER period_close_test_year_fail BEFORE INSERT ON period_close_year BEGIN SELECT RAISE(ABORT,'测试年结后半失败'); END",
  );
  const before = snapshot(app);
  await expect(api.yearEnd({ year: 2026, confirmed: true })).rejects.toThrow('测试年结后半失败');
  expect(snapshot(app)).toBe(before);
  expect((await app.svc.periods.years()).map((y) => y.year)).toEqual([2026]);
  expect(await app.svc.opening.list(2027)).toEqual([]);
});
it('w_zw_fz 年结：逐桶结转、余额连续、累计重置、幂等；w_zw_qxfz禁止删除派生期初', async () => {
  const api = call(app);
  await seedVouchers(app.svc, [
    {
      date: '2026-01-02',
      status: 'posted',
      lines: [
        { account: '100202', debit: 71000, currency: 'USD', rate: '7.1', fcAmount: 10000 },
        { account: '4001', credit: 71000 },
      ],
    },
  ]);
  await seedVouchers(app.svc, [
    {
      date: '2026-02-02',
      status: 'posted',
      lines: [
        { account: '1403', debit: 2500, quantity: '1.234567' },
        { account: '4001', credit: 2500 },
      ],
    },
  ]);
  await closeYear();
  const before = await app.svc.ledger.balances({
    periodFrom: 202612,
    periodTo: 202612,
    currency: 'USD',
    rollup: false,
  });
  const out = await api.yearEnd({ year: 2026, confirmed: true });
  expect(out.year).toBe(2027);
  const next = await app.svc.ledger.balances({
    periodFrom: 202701,
    periodTo: 202701,
    currency: 'USD',
    rollup: false,
  });
  expect(next.find((r) => r.accountCode === '100202')).toMatchObject({
    opening: 71000,
    fcOpening: 10000,
    ytdDebit: 0,
    ytdCredit: 0,
  });
  expect(next.find((r) => r.accountCode === '100202')!.opening).toBe(
    before.find((r) => r.accountCode === '100202')!.closing,
  );
  const parentBank = (await app.svc.accounts.require('1002')).id;
  expect((await app.svc.opening.list(2027)).some((r) => r.accountId === parentBank)).toBe(false);
  const inventory = (await app.svc.accounts.require('1403')).id;
  expect((await app.svc.opening.list(2027)).find((r) => r.accountId === inventory)).toMatchObject({
    balance: 2500,
    quantity: '1.234567',
  });
  const after = snapshot(app);
  expect((await api.yearEnd({ year: 2026, confirmed: true })).message).toContain('已经年结');
  expect(snapshot(app)).toBe(after);
  const years = await app.svc.periods.years();
  expect(years.map((y) => [y.year, y.status, y.opening_stored])).toEqual([
    [2026, 'closed', 1],
    [2027, 'open', 1],
  ]);
  expect((await errorData(api.reopen({ from: 202612, to: 202612, confirmed: true }))).code).toBe(
    'PERIOD_CLOSE_YEAR_SNAPSHOT',
  );
  expect(snapshot(app)).toBe(after);
  await app.svc.opening.upsert({
    year: 2027,
    accountId: inventory,
    balance: 2501,
    quantity: '1.234567',
  });
  const changed = snapshot(app);
  expect((await errorData(api.yearEnd({ year: 2026, confirmed: true }))).code).toBe(
    'PERIOD_CLOSE_SNAPSHOT_CHANGED',
  );
  expect(snapshot(app)).toBe(changed);
});
