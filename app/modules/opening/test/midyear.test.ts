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

it('w_xt_ye：7月红字累计真实router/SQLite、core余额、Excel往返按原借贷列保留', async () => {
  const app = await createTestApp({ modules: [openingServer], startMonth: 7 });
  try {
    const api = app.call(openingServer),
      cash = (await app.svc.accounts.require('1001')).id,
      equity = (await app.svc.accounts.require('4001')).id;
    await api.save({
      year: 2026,
      changes: [
        { data: { year: 2026, accountId: cash, balance: 0, ytdDebit: -100, ytdCredit: 0 } },
        { data: { year: 2026, accountId: equity, balance: 0, ytdDebit: 0, ytdCredit: -100 } },
      ],
    });
    const before = (await api.list({ year: 2026 })).rows;
    expect(before.map(yearStart)).toEqual([100, -100]);
    expect(
      await app.svc.db
        .selectFrom('opening_balance')
        .select(['account_id', 'balance', 'ytd_debit', 'ytd_credit'])
        .orderBy('id')
        .execute(),
    ).toEqual([
      { account_id: cash, balance: 0, ytd_debit: -100, ytd_credit: 0 },
      { account_id: equity, balance: 0, ytd_debit: 0, ytd_credit: -100 },
    ]);
    expect(await api.trial({ year: 2026 })).toMatchObject({
      balanced: true,
      yearDebit: 100,
      yearCredit: 100,
      ytdDebit: -100,
      ytdCredit: -100,
      yearDifference: 0,
      ytdDifference: 0,
      difference: 0,
      core: { balanced: true },
    });
    const balances = await app.svc.ledger.balances({
      periodFrom: 202607,
      periodTo: 202607,
      rollup: false,
    });
    expect(balances.find((r) => r.accountId === cash)).toMatchObject({
      opening: 0,
      debit: 0,
      credit: 0,
      ytdDebit: -100,
      ytdCredit: 0,
      closing: 0,
    });
    expect(balances.find((r) => r.accountId === equity)).toMatchObject({
      opening: 0,
      debit: 0,
      credit: 0,
      ytdDebit: 0,
      ytdCredit: -100,
      closing: 0,
    });
    const output = await api.export({ year: 2026 });
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    await wb.xlsx.load(Uint8Array.from(Buffer.from(output.file, 'base64')).buffer);
    expect([
      wb.worksheets[0]!.getRow(2).getCell(13).value,
      wb.worksheets[0]!.getRow(2).getCell(14).value,
    ]).toEqual(['-1.00', '0.00']);
    expect([
      wb.worksheets[0]!.getRow(3).getCell(13).value,
      wb.worksheets[0]!.getRow(3).getCell(14).value,
    ]).toEqual(['0.00', '-1.00']);
    const { rowVersion } = await import('../shared');
    for (const row of before)
      await api.remove({ year: 2026, id: row.id, expected: rowVersion(row), confirmed: true });
    expect((await api.list({ year: 2026 })).rows).toEqual([]);
    const preview = await api.preview({ year: 2026, file: output.file, mode: 'add' });
    expect(preview.valid).toBe(true);
    expect(preview.preview.map((r) => r.source.slice(12, 14))).toEqual([
      ['-1.00', '0.00'],
      ['0.00', '-1.00'],
    ]);
    await api.import({
      year: 2026,
      file: output.file,
      mode: 'add',
      confirmed: true,
      expected: preview.expected,
    });
    const after = (await api.list({ year: 2026 })).rows;
    expect(after.map((r) => [r.accountId, r.balance, r.ytdDebit, r.ytdCredit])).toEqual(
      before.map((r) => [r.accountId, r.balance, r.ytdDebit, r.ytdCredit]),
    );
    const roundtrip = await api.export({ year: 2026 }),
      repreview = await api.preview({ year: 2026, file: roundtrip.file, mode: 'overwrite' });
    expect(repreview.valid).toBe(true);
    expect(repreview.preview.map((r) => r.source.slice(12, 14))).toEqual([
      ['-1.00', '0.00'],
      ['0.00', '-1.00'],
    ]);
    await api.setLock({ year: 2026, locked: true });
    expect((await api.list({ year: 2026 })).locked).toBe(true);
    await seedVouchers(app.svc, [
      {
        date: '2026-07-02',
        status: 'posted',
        lines: [
          { account: '1001', debit: -7 },
          { account: '4001', credit: -7 },
        ],
      },
    ]);
    const later = await app.svc.ledger.balances({
      periodFrom: 202607,
      periodTo: 202607,
      rollup: false,
    });
    expect(later.find((r) => r.accountId === cash)).toMatchObject({
      opening: 0,
      debit: -7,
      credit: 0,
      ytdDebit: -107,
      ytdCredit: 0,
      closing: -7,
    });
    expect(later.find((r) => r.accountId === equity)).toMatchObject({
      opening: 0,
      debit: 0,
      credit: -7,
      ytdDebit: 0,
      ytdCredit: -107,
      closing: 7,
    });
  } finally {
    await app.close();
  }
});
