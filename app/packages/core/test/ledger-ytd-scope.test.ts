import { afterEach, describe, expect, it } from 'vitest';
import { createTestBook, seedVouchers, type TestBook } from '@caiwu/testkit';

let book: TestBook;
afterEach(async () => book?.close());
const seed = () =>
  seedVouchers(book.svc, [
    {
      date: '2026-07-05',
      status: 'posted',
      lines: [
        { account: '1001', debit: 37, dims: { cashflow: 'CF01' } },
        { account: '6001', credit: 37 },
      ],
    },
  ]);
describe('w_bb_proc 本年累计的真实期间范围', () => {
  it('非首年只建立7–12月时不能把1–6月累计当零；补齐后才返回37', async () => {
    book = await createTestBook({ startYear: 2025 });
    await book.svc.periods.ensureYear(2026, { fromMonth: 7 });
    await seed();
    const q = { periodFrom: 202607, periodTo: 202607, accountCodes: ['1001'], rollup: false };
    await expect(book.svc.ledger.balances(q)).rejects.toMatchObject({
      data: { code: 'LEDGER_YTD_PERIOD_MISSING' },
    });
    await book.svc.periods.ensureYear(2026);
    expect((await book.svc.ledger.balances(q))[0]).toMatchObject({ debit: 37, ytdDebit: 37 });
  });

  it('首启用年从startPeriod累计仍允许，已录账前累计100加当期37为137', async () => {
    book = await createTestBook({ startYear: 2026, startMonth: 7 });
    await book.svc.opening.upsert({
      year: 2026,
      accountId: (await book.svc.accounts.require('1001')).id,
      balance: 0,
      ytdDebit: 100,
    });
    await seed();
    expect(
      (
        await book.svc.ledger.balances({
          periodFrom: 202607,
          periodTo: 202607,
          accountCodes: ['1001'],
          rollup: false,
        })
      )[0],
    ).toMatchObject({ ytdDebit: 137 });
  });
});
