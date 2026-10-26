import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestBook, seedVouchers, voucherInputFromSpec, type TestBook } from '@caiwu/testkit';

let book: TestBook;
afterEach(async () => book?.close());
describe('w_bb_proc / w_zw_ydjz 真实结转过滤', () => {
  it.each(['ytdDebit', 'ytdCredit'] as const)(
    '%s 原始未知累计+100/-100抵销后仍拒绝排除结转，分组不改变口径',
    async (field) => {
      book = await createTestBook({ startMonth: 7 });
      const account = await book.svc.accounts.require('1122');
      for (const [code, amount] of [
        ['C001', 100],
        ['S001', -100],
      ] as const) {
        await book.svc.opening.upsert({
          year: 2026,
          accountId: account.id,
          balance: 0,
          dimensions: { partner: (await book.svc.dimensions.getByCode('partner', code))!.id },
          [field]: amount,
        });
      }
      for (const groupBy of [[], ['partner']] as const) {
        const q = {
          periodFrom: 202607,
          periodTo: 202607,
          accountCodes: ['1122'],
          groupBy: [...groupBy],
          rollup: false,
          includeZero: true,
        };
        expect((await book.svc.ledger.balances(q)).reduce((n, r) => n + r[field], 0)).toBe(0);
        await expect(
          book.svc.ledger.balances({ ...q, excludeClosingKinds: ['pnl'] }),
        ).rejects.toMatchObject({ data: { code: 'LEDGER_CLOSING_SCOPE_UNKNOWN' } });
        await expect(
          book.svc.ledger.balances({ ...q, excludeClosing: true }),
        ).rejects.toMatchObject({ data: { code: 'LEDGER_CLOSING_SCOPE_UNKNOWN' } });
      }
    },
  );
  it('普通凭证与有来源的结转经唯一入口保存；历史期初保留，查询不解锁来源或修改状态', async () => {
    book = await createTestBook();
    const svc = book.svc;
    const source = book.forModule('period-close');
    const input = await voucherInputFromSpec(source, {
      date: '2026-01-31',
      lines: [
        { account: '6001', debit: 811 },
        { account: '4103', credit: 811 },
      ],
    });
    const closing = await source.vouchers.create({
      ...input,
      closingKind: 'profit-loss',
      source: { type: 'closing', id: '202601' },
    });
    await source.vouchers.changeStatus({ ids: [closing.id], to: 'audited' });
    await source.vouchers.changeStatus({ ids: [closing.id], to: 'posted' });
    await seedVouchers(svc, [
      {
        date: '2026-02-01',
        status: 'posted',
        lines: [
          { account: '6001', debit: 113 },
          { account: '4103', credit: 113 },
        ],
      },
    ]);
    const query = { periodFrom: 202602, periodTo: 202602, accountCodes: ['6001'], rollup: false };
    expect((await svc.ledger.balances({ ...query, excludeClosing: true }))[0]).toMatchObject({
      opening: 811,
      debit: 113,
      closing: 924,
      ytdDebit: 113,
    });
    expect((await svc.ledger.balances(query))[0]).toMatchObject({ ytdDebit: 924 });
    expect(await svc.vouchers.get(closing.id)).toMatchObject({
      status: 'posted',
      closingKind: 'profit-loss',
    });
    await expect(svc.vouchers.delete(closing.id)).rejects.toMatchObject({
      data: { code: 'VOUCHER_FROM_SOURCE' },
    });
  });

  it('年中启用的累计数无结转来源时明确拒绝；其它科目的可靠数据不受影响', async () => {
    book = await createTestBook({ startMonth: 7 });
    const account = await book.svc.accounts.require('6001');
    await book.svc.opening.upsert({
      year: 2026,
      accountId: account.id,
      balance: -200,
      ytdCredit: 700,
    });
    await expect(
      book.svc.ledger.balances({
        periodFrom: 202607,
        periodTo: 202607,
        accountCodes: ['6001'],
        excludeClosing: true,
      }),
    ).rejects.toMatchObject({ data: { code: 'LEDGER_CLOSING_SCOPE_UNKNOWN' } });
    expect(
      await book.svc.ledger.balances({
        periodFrom: 202607,
        periodTo: 202607,
        accountCodes: ['1001'],
        excludeClosing: true,
        includeZero: true,
      }),
    ).toEqual([expect.objectContaining({ accountCode: '1001', ytdDebit: 0 })]);
  });

  it('随机整数分：排除结转后的借贷发生额等于独立BigInt手算，试算仍平衡', async () => {
    book = await createTestBook();
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            amount: fc.integer({ min: -100000, max: 100000 }).filter((v) => v !== 0),
            closing: fc.boolean(),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        async (specs) => {
          const ids: number[] = [];
          try {
            for (const spec of specs) {
              const input = await voucherInputFromSpec(book.svc, {
                date: '2026-01-05',
                lines: [
                  { account: '6001', debit: spec.amount },
                  { account: '4103', credit: spec.amount },
                ],
              });
              const v = await book.svc.vouchers.create({
                ...input,
                closingKind: spec.closing ? 'test-closing' : null,
              });
              ids.push(v.id);
              await book.svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
              await book.svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
            }
            const rows = await book.svc.ledger.balances({
              periodFrom: 202601,
              periodTo: 202601,
              excludeClosing: true,
              includeZero: true,
            });
            const expected = specs.reduce(
              (sum, s) => (s.closing ? sum : sum + BigInt(s.amount)),
              0n,
            );
            expect(rows.find((r) => r.accountCode === '6001')!.debit).toBe(Number(expected));
            expect(rows.find((r) => r.accountCode === '4103')!.credit).toBe(Number(expected));
            expect(
              rows.filter((r) => r.isLeaf).reduce((sum, r) => sum + BigInt(r.closing), 0n),
            ).toBe(0n);
          } finally {
            await book.svc.vouchers.changeStatus({ ids, to: 'audited' });
            await book.svc.vouchers.changeStatus({ ids, to: 'pending' });
            for (const id of ids) await book.svc.vouchers.delete(id);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
