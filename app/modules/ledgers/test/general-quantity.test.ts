import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestBook, seedVouchers, type TestBook } from '@caiwu/testkit';
import { QuerySchema, type LedgerQuery } from '../shared';
import { buildGeneralReport } from '../server/general';

let book: TestBook;
beforeEach(async () => {
  book = await createTestBook({ startMonth: 7 });
});
afterEach(async () => {
  await book?.close();
});
const query = (patch: Partial<LedgerQuery> = {}) =>
  QuerySchema.parse({
    kind: 'general',
    periodFrom: 202607,
    periodTo: 202608,
    account: '1601',
    ...patch,
  });
const report = (patch: Partial<LedgerQuery> = {}) =>
  book
    .forModule('ledgers')
    .tx(async (svc) => buildGeneralReport(svc, query(patch), await svc.accounts.list()));
async function leaves() {
  return Promise.all([
    book.svc.accounts.create({ code: '160101', name: '千克计量', quantityUnit: '千克' }, [4, 2, 2]),
    book.svc.accounts.create({ code: '160102', name: '件计量', quantityUnit: '件' }, [4, 2, 2]),
  ]);
}

describe('w_zc_zc_1 总账仅金额汇总', () => {
  it('不同数量单位的同一父科目可查总账金额，期中启用累计与范围去重保留', async () => {
    const [kg, piece] = await leaves();
    await book.svc.opening.upsert({
      year: 2026,
      accountId: kg!.id,
      balance: 10000,
      quantity: '1.5',
      ytdDebit: 300,
      ytdCredit: 20,
    });
    await book.svc.opening.upsert({
      year: 2026,
      accountId: piece!.id,
      balance: 20000,
      quantity: '2.5',
      ytdDebit: 400,
      ytdCredit: 30,
    });
    await seedVouchers(book.svc, [
      {
        date: '2026-07-03',
        status: 'posted',
        lines: [
          { account: kg!.code, debit: 123, quantity: '0.3' },
          { account: piece!.code, credit: 45, quantity: '0.2' },
          { account: '4001', credit: 78 },
        ],
      },
      {
        date: '2026-08-03',
        status: 'posted',
        lines: [
          { account: piece!.code, debit: 22, quantity: '0.1' },
          { account: '4001', credit: 22 },
        ],
      },
    ]);
    await expect(
      book.svc.ledger.balances({
        periodFrom: 202607,
        periodTo: 202607,
        accountCodes: ['1601'],
        rollup: true,
      }),
    ).rejects.toThrow(/不能混加数量/);
    const result = await report({ periodFrom: 202606 });
    expect(result.rows[0]).toMatchObject({
      kind: 'month',
      side: '未知',
      signedBalance: null,
      debit: null,
    });
    expect(result.rows.find((r) => r.kind === 'opening')?.signedBalance).toBe(30000);
    expect(
      result.rows
        .filter((r) => r.kind === 'month' && r.side !== '未知')
        .map((r) => [r.debit, r.credit, r.signedBalance]),
    ).toEqual([
      [123, 45, 30078],
      [22, 0, 30100],
    ]);
    expect(result.rows.filter((r) => r.kind === 'ytd').map((r) => [r.debit, r.credit])).toEqual([
      [823, 95],
      [845, 95],
    ]);
    expect(new Set(result.rows.map((r) => r.account))).toEqual(new Set(['1601 固定资产']));
    expect(result.dynamicColumns).toBeUndefined();
    const edge = await report({ account: kg!.code, accountTo: piece!.code });
    expect(
      edge.rows
        .filter((r) => r.kind === 'closing' && r.date === '2026年08月')
        .reduce((n, r) => n + (r.signedBalance ?? 0), 0),
    ).toBe(30100);
    expect(new Set(edge.rows.map((r) => r.account))).toEqual(
      new Set(['160101 固定资产/千克计量', '160102 固定资产/件计量']),
    );
  });

  it('大额只在根科目金额最终合计时检查安全整分，溢出明确拒绝', async () => {
    const [kg, piece] = await leaves();
    const meter = await book.svc.accounts.create(
      { code: '160103', name: '米计量', quantityUnit: '米' },
      [4, 2, 2],
    );
    const max = Number.MAX_SAFE_INTEGER;
    for (const [accountId, balance] of [
      [kg!.id, max],
      [piece!.id, max],
      [meter.id, -max],
    ] as const)
      await book.svc.opening.upsert({ year: 2026, accountId, balance, quantity: '1' });
    const result = await report({ periodTo: 202607 });
    expect(result.rows[0]?.signedBalance).toBe(max);
    expect(result.rows.at(-1)?.signedBalance).toBe(max);
    await book.svc.opening.upsert({
      year: 2026,
      accountId: meter.id,
      balance: -max + 1,
      quantity: '1',
    });
    await expect(report({ periodTo: 202607 })).rejects.toThrow(/安全整数/);
  });
});
