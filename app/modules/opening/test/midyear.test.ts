import { expect, it } from 'vitest';
import { createTestApp, seedVouchers } from '@caiwu/testkit';
import openingServer from '../server';
import { yearStart } from '../shared';
it('w_xt_ye：7月启用真实core起算与YTD一致，年初/启用余额分开；core试算未覆盖YTD的差额由模块检查', async () => {
  const app = await createTestApp({ modules: [openingServer], startMonth: 7 });
  try {
    const api = app.call(openingServer),
      cash = (await app.svc.accounts.require('1001')).id,
      equity = (await app.svc.accounts.require('4001')).id;
    await api.save({
      year: 2026,
      changes: [
        { data: { year: 2026, accountId: cash, balance: 13000, ytdDebit: 5000, ytdCredit: 2000 } },
        {
          data: { year: 2026, accountId: equity, balance: -13000, ytdDebit: 1000, ytdCredit: 3000 },
        },
      ],
    });
    const rows = (await api.list({ year: 2026 })).rows;
    expect(rows.map(yearStart)).toEqual([10000, -11000]);
    expect(await api.trial({ year: 2026 })).toMatchObject({
      balanced: false,
      yearDifference: -1000,
      ytdDifference: 1000,
      difference: 0,
      core: { balanced: true },
    });
    await expect(api.setLock({ year: 2026, locked: true })).rejects.toThrow('不能锁定');
    await api.save({
      year: 2026,
      changes: [
        {
          id: rows[1]!.id,
          expected: (await import('../shared')).rowVersion(rows[1]!),
          data: { ...rows[1]!, ytdDebit: 3000, ytdCredit: 6000 },
        },
      ],
    });
    expect(await api.trial({ year: 2026 })).toMatchObject({ balanced: true, ytdDifference: 0 });
    const balances = await app.svc.ledger.balances({
      periodFrom: 202607,
      periodTo: 202607,
      rollup: false,
    });
    expect(balances.find((r) => r.accountId === cash)).toMatchObject({
      opening: 13000,
      debit: 0,
      credit: 0,
      ytdDebit: 5000,
      ytdCredit: 2000,
    });
    await seedVouchers(app.svc, [
      {
        date: '2026-07-02',
        status: 'posted',
        lines: [
          { account: '1001', debit: 123 },
          { account: '4001', credit: 123 },
        ],
      },
    ]);
    const later = await app.svc.ledger.balances({
      periodFrom: 202608,
      periodTo: 202608,
      rollup: false,
    });
    expect(later.find((r) => r.accountId === cash)).toMatchObject({
      opening: 13123,
      debit: 0,
      credit: 0,
      ytdDebit: 5123,
      ytdCredit: 2000,
    });
    expect((await api.list({ year: 2026 })).rows.map(yearStart)).toEqual([10000, -10000]);
  } finally {
    await app.close();
  }
});
