import { afterEach, describe, expect, it } from 'vitest';
import { createTestBook, seedVouchers, type TestBook } from '@caiwu/testkit';
import type { BalanceQuery, BalanceRow } from '../src';

let t: TestBook;
afterEach(async () => {
  await t?.close();
});

describe('账簿本位币筛选', () => {
  it.each(['外币', '数量'] as const)('次年本币为零但%s余额非零时不丢行', async (kind) => {
    t = await createTestBook();
    const code = kind === '外币' ? '100202' : '1403';
    const account = await t.svc.accounts.require(code);
    await t.svc.opening.upsert({
      year: 2026,
      accountId: account.id,
      balance: 71_000,
      ...(kind === '外币' ? { currency: 'USD', fcBalance: 10_000 } : { quantity: '100' }),
    });
    await seedVouchers(t.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          {
            account: code,
            credit: 71_000,
            ...(kind === '外币'
              ? { currency: 'USD', rate: '3.55', fcAmount: 20_000 }
              : { quantity: '200' }),
          },
          { account: '1001', debit: 71_000 },
        ],
      },
    ]);
    await t.svc.periods.ensureYear(2027);
    const query = {
      periodFrom: 202701,
      periodTo: 202701,
      accountCodes: [code],
      currency: kind === '外币' ? 'USD' : undefined,
    };
    const rows = await t.svc.ledger.balances(query);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      opening: 0,
      closing: 0,
      ytdDebit: 0,
      ytdCredit: 0,
      ...(kind === '外币'
        ? { fcOpening: -10_000, fcClosing: -10_000 }
        : { qtyOpening: '-100', qtyClosing: '-100' }),
    });
    if (kind === '外币')
      expect(await t.svc.ledger.balances({ ...query, currency: undefined })).toEqual([]);
  });
  it.each(['CNY', 'EUR'])(
    '%s：NULL/显式本位币覆盖期间、YTD、父级、辅助和年结边界',
    async (baseCurrency) => {
      t = await createTestBook({ startMonth: 7 });
      if (baseCurrency !== 'CNY') {
        await t.svc.db
          .insertInto('currency')
          .values({
            code: baseCurrency,
            name: '测试本位币',
            symbol: null,
            is_base: 0,
            disabled: 0,
            sort: 10,
          })
          .execute();
        await t.svc.db
          .updateTable('book_info')
          .set({ base_currency: baseCurrency })
          .where('id', '=', 1)
          .execute();
      }
      const department = (await t.svc.dimensions.getByCode('department', '01'))!;
      const variants = [
        {
          code: '160101',
          currency: null,
          opening: 100,
          debit: 10,
          credit: 3,
          ytdDebit: 40,
          ytdCredit: 10,
          quantity: '1',
        },
        {
          code: '160102',
          currency: baseCurrency,
          opening: 200,
          debit: 20,
          credit: 4,
          ytdDebit: 50,
          ytdCredit: 20,
          quantity: '2',
        },
        {
          code: '160103',
          currency: 'USD',
          opening: 700,
          debit: 70,
          credit: 7,
          ytdDebit: 70,
          ytdCredit: 30,
          quantity: '7',
        },
      ];
      for (const v of variants) {
        const a = await t.svc.accounts.create(
          {
            code: v.code,
            name: v.code,
            currency: v.currency,
            quantityUnit: '件',
            dimensions: [{ type: 'department' }],
          },
          [4, 2, 2],
        );
        await t.svc.opening.upsert({
          year: 2026,
          accountId: a.id,
          dimensions: { department: department.id },
          currency: v.currency,
          balance: v.opening,
          ytdDebit: v.ytdDebit,
          ytdCredit: v.ytdCredit,
          quantity: v.quantity,
          fcBalance: v.currency === 'USD' ? 100 : 0,
        });
        for (const month of [7, 8]) {
          const amount = month === 7 ? v.debit : v.credit;
          await seedVouchers(t.svc, [
            {
              date: `2026-0${month}-05`,
              status: 'posted',
              lines: [
                {
                  account: v.code,
                  debit: month === 7 ? amount : 0,
                  credit: month === 8 ? amount : 0,
                  dims: { department: '01' },
                  currency: v.currency ?? undefined,
                  rate: v.currency ? '1' : undefined,
                  fcAmount: v.currency === 'USD' ? amount / 7 : v.currency ? 0 : undefined,
                  quantity: String(amount / 100),
                },
                {
                  account: '4001',
                  debit: month === 8 ? amount : 0,
                  credit: month === 7 ? amount : 0,
                },
              ],
            },
          ]);
        }
      }
      const query: BalanceQuery = {
        periodFrom: 202608,
        periodTo: 202608,
        accountCodes: ['1601'],
        groupBy: ['department'],
        dimensions: { department: department.id },
      };
      const parent = (rows: BalanceRow[]) => rows.find((r) => r.accountCode === '1601')!;
      const local = await t.svc.ledger.balances({ ...query, currency: baseCurrency });
      expect(local.map((r) => r.accountCode)).toEqual(['1601', '160101', '160102']);
      expect(parent(local)).toMatchObject({
        opening: 330,
        debit: 0,
        credit: 7,
        closing: 323,
        ytdDebit: 120,
        ytdCredit: 37,
        qtyOpening: '3.3',
        qtyCredit: '0.07',
        qtyClosing: '3.23',
        dimensions: { department: department.id },
      });
      const usd = await t.svc.ledger.balances({ ...query, currency: 'USD' });
      expect(usd.map((r) => r.accountCode)).toEqual(['1601', '160103']);
      expect(parent(usd)).toMatchObject({
        opening: 770,
        credit: 7,
        closing: 763,
        fcOpening: 110,
        fcCredit: 1,
        fcClosing: 109,
      });
      expect(parent(await t.svc.ledger.balances(query))).toMatchObject({
        opening: 1100,
        credit: 14,
        closing: 1086,
        fcOpening: 0,
        fcClosing: 0,
      });
      const entries = await t.svc.ledger.entries({
        periodFrom: 202607,
        periodTo: 202608,
        accountCode: '1601',
        currency: baseCurrency,
        dimensions: { department: department.id },
      });
      expect(entries.map((r) => r.currency).sort()).toEqual(
        [null, null, baseCurrency, baseCurrency].sort(),
      );
      expect(
        await t.svc.ledger.entries({
          periodFrom: 202607,
          periodTo: 202608,
          accountCode: '1601',
          currency: 'USD',
        }),
      ).toHaveLength(2);
      expect(
        await t.svc.ledger.entries({
          periodFrom: 202607,
          periodTo: 202608,
          accountCode: '1601',
        }),
      ).toHaveLength(6);
      await t.svc.periods.ensureYear(2027);
      const next = { ...query, periodFrom: 202701, periodTo: 202701, currency: baseCurrency };
      expect(parent(await t.svc.ledger.balances(next))).toMatchObject({
        opening: 323,
        closing: 323,
        ytdDebit: 0,
        ytdCredit: 0,
      });
      const carried = await t.svc.opening.list(2026);
      await t.svc.opening.replaceYear(
        2027,
        carried.map((r) => {
          const end = [...local, ...usd].find((a) => a.accountId === r.accountId)!;
          return {
            accountId: r.accountId,
            dimensions: r.dimensions,
            currency: r.currency,
            balance: end.closing,
            fcBalance: end.fcClosing,
            quantity: end.qtyClosing,
          };
        }),
      );
      expect(parent(await t.svc.ledger.balances(next))).toMatchObject({
        opening: 323,
        closing: 323,
        ytdDebit: 0,
        ytdCredit: 0,
      });
      expect(
        parent(await t.svc.ledger.balances({ ...query, currency: baseCurrency })),
      ).toMatchObject({ opening: 330, closing: 323 });
    },
  );
  it('CNY 同时包括 NULL 期初和分录，USD 仍隔离，不带币种仍统计全部', async () => {
    t = await createTestBook();
    const cash = await t.svc.accounts.require('1001');
    await t.svc.opening.upsert({ year: 2026, accountId: cash.id, balance: 100 });
    await seedVouchers(t.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1001', debit: 200 },
          { account: '4001', credit: 200 },
        ],
      },
    ]);
    const query = { periodFrom: 202601, periodTo: 202601, accountCodes: ['1001'] };
    expect(await t.svc.ledger.balances({ ...query, currency: 'CNY' })).toEqual(
      await t.svc.ledger.balances(query),
    );
    expect(
      await t.svc.ledger.entries({
        periodFrom: 202601,
        periodTo: 202601,
        accountCode: '1001',
        currency: 'CNY',
      }),
    ).toHaveLength(1);
    expect(await t.svc.ledger.balances({ ...query, currency: 'USD' })).toEqual([]);
  });
});
