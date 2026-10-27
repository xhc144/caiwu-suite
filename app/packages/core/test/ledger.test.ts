import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { balanceSide, type BalanceRow } from '../src';
import { createTestBook, seedVouchers, type TestBook } from '@caiwu/testkit';

let t: TestBook;
afterEach(async () => {
  await t?.close();
});

const row = (rows: BalanceRow[], code: string) =>
  rows.find((r) => r.accountCode === code && Object.values(r.dimensions).every((v) => v == null));

async function setup() {
  t = await createTestBook();
  const cash = await t.svc.accounts.require('1001');
  const capital = await t.svc.accounts.require('4001');
  await t.svc.opening.upsert({ year: 2026, accountId: cash.id, balance: 500_00 });
  await t.svc.opening.upsert({ year: 2026, accountId: capital.id, balance: -500_00 });
  await seedVouchers(t.svc, [
    {
      date: '2026-01-05',
      summary: '销售收款',
      status: 'posted',
      lines: [
        { account: '1001', debit: 1000_00, dims: { cashflow: 'CF01' } },
        { account: '6001', credit: 1000_00 },
      ],
    },
    {
      date: '2026-02-03',
      summary: '采购原料',
      status: 'posted',
      lines: [
        { account: '1403', debit: 50_00, quantity: '10', unitPrice: '5' },
        { account: '22210101', debit: 6_50 },
        { account: '2202', credit: 56_50, dims: { partner: 'S001' } },
      ],
    },
    {
      date: '2026-02-10',
      summary: '收到美元',
      status: 'posted',
      lines: [
        { account: '100202', debit: 710_00, currency: 'USD', rate: '7.1', fcAmount: 100_00 },
        { account: '6051', credit: 710_00 },
      ],
    },
    {
      date: '2026-02-20',
      summary: '未过账的报销',
      status: 'pending',
      lines: [
        { account: '6602', debit: 100_00, dims: { department: '01' } },
        { account: '1001', credit: 100_00 },
      ],
    },
  ]);
}

describe('余额', () => {
  it('期初 + 以前月份发生额 = 本期期初；本年累计从年初算', async () => {
    await setup();
    const rows = await t.svc.ledger.balances({ periodFrom: 202602, periodTo: 202602 });
    const cash = row(rows, '1001')!;
    expect(cash).toMatchObject({
      opening: 1500_00,
      debit: 0,
      credit: 0,
      closing: 1500_00,
      ytdDebit: 1000_00,
    });
    expect(row(rows, '4001')!.closing).toBe(-500_00);
    expect(balanceSide(row(rows, '4001')!.closing, 'credit')).toEqual({
      side: '贷',
      amount: 500_00,
    });
  });

  it('默认只算已过账，includeUnposted 时包含待审核凭证', async () => {
    await setup();
    const posted = await t.svc.ledger.balances({ periodFrom: 202602, periodTo: 202602 });
    expect(row(posted, '6602')).toBeUndefined();
    const all = await t.svc.ledger.balances({
      periodFrom: 202602,
      periodTo: 202602,
      includeUnposted: true,
    });
    expect(row(all, '6602')!.debit).toBe(100_00);
    expect(row(all, '1001')!.closing).toBe(1400_00);
  });

  it('上级科目汇总下级；rollup=false 只返回末级', async () => {
    await setup();
    const rows = await t.svc.ledger.balances({ periodFrom: 202601, periodTo: 202602 });
    expect(row(rows, '2221')!.debit).toBe(6_50);
    expect(row(rows, '222101')!.debit).toBe(6_50);
    expect(row(rows, '1002')!.closing).toBe(710_00);
    const leaves = await t.svc.ledger.balances({
      periodFrom: 202601,
      periodTo: 202602,
      rollup: false,
    });
    expect(leaves.every((r) => r.isLeaf)).toBe(true);
  });

  it('按辅助核算展开、按维度过滤', async () => {
    await setup();
    const s001 = (await t.svc.dimensions.getByCode('partner', 'S001'))!;
    const rows = await t.svc.ledger.balances({
      periodFrom: 202601,
      periodTo: 202602,
      accountCodes: ['2202'],
      groupBy: ['partner'],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accountCode: '2202',
      dimensions: { partner: s001.id },
      closing: -56_50,
    });
    const cf = (await t.svc.dimensions.getByCode('cashflow', 'CF01'))!;
    const byCashflow = await t.svc.ledger.balances({
      periodFrom: 202601,
      periodTo: 202601,
      dimensions: { cashflow: cf.id },
    });
    // 期初没有现金流量项目，按现金流量项目过滤时期初为 0
    expect(row(byCashflow, '1001')).toMatchObject({ opening: 0, debit: 1000_00 });
    expect(row(byCashflow, '6001')).toBeUndefined();
  });

  it('外币和数量', async () => {
    await setup();
    const usd = await t.svc.ledger.balances({
      periodFrom: 202602,
      periodTo: 202602,
      currency: 'USD',
      accountCodes: ['100202'],
    });
    expect(usd[0]).toMatchObject({ debit: 710_00, fcDebit: 100_00, fcClosing: 100_00 });
    const qty = await t.svc.ledger.balances({
      periodFrom: 202602,
      periodTo: 202602,
      accountCodes: ['1403'],
    });
    expect(qty[0]).toMatchObject({ qtyDebit: '10', qtyClosing: '10' });
  });

  it('年结前跨年查询：上年期末自动作为下年期初', async () => {
    await setup();
    await t.svc.periods.ensureYear(2027);
    await seedVouchers(t.svc, [
      {
        date: '2027-01-08',
        status: 'posted',
        lines: [
          { account: '1001', debit: 1_00 },
          { account: '6001', credit: 1_00 },
        ],
      },
    ]);
    const rows = await t.svc.ledger.balances({ periodFrom: 202701, periodTo: 202701 });
    expect(row(rows, '1001')).toMatchObject({ opening: 1500_00, debit: 1_00, ytdDebit: 1_00 });
  });

  it('年中启用：期初的本年累计计入本年累计', async () => {
    t = await createTestBook({ startMonth: 7 });
    const cash = await t.svc.accounts.require('1001');
    await t.svc.opening.upsert({
      year: 2026,
      accountId: cash.id,
      balance: 300_00,
      ytdDebit: 800_00,
      ytdCredit: 500_00,
    });
    const rows = await t.svc.ledger.balances({ periodFrom: 202607, periodTo: 202607 });
    expect(row(rows, '1001')).toMatchObject({
      opening: 300_00,
      ytdDebit: 800_00,
      ytdCredit: 500_00,
    });
    await expect(t.svc.ledger.balances({ periodFrom: 202606, periodTo: 202607 })).rejects.toThrow(
      /早于账套启用期间/,
    );
  });

  it('试算平衡', async () => {
    await setup();
    const tb = await t.svc.ledger.trialBalance(202601, 202602);
    expect(tb.balanced).toBe(true);
    expect(tb.openingDebit).toBe(500_00);
    expect(tb.debit).toBe(1766_50);
  });

  it('随机凭证：试算永远平衡，上级 = 下级之和', async () => {
    t = await createTestBook();
    const codes = [
      '1001',
      '100201',
      '1601',
      '1602',
      '2001',
      '2211',
      '4001',
      '6001',
      '6401',
      '6603',
    ];
    const types = await t.svc.reference.voucherTypes();
    const accounts = await Promise.all(codes.map((c) => t.svc.accounts.require(c)));
    const line = fc.record({
      a: fc.integer({ min: 0, max: accounts.length - 1 }),
      b: fc.integer({ min: 0, max: accounts.length - 1 }),
      amount: fc.integer({ min: -1_000_000_00, max: 1_000_000_00 }).filter((x) => x !== 0),
      month: fc.integer({ min: 1, max: 3 }),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(line, { minLength: 1, maxLength: 15 }), async (specs) => {
        await t.svc.db.deleteFrom('voucher').execute();
        for (const s of specs) {
          const v = await t.svc.vouchers.create({
            voucherTypeId: types[0]!.id,
            date: `2026-0${s.month}-15`,
            lines: [
              { summary: '随机', accountId: accounts[s.a]!.id, debit: s.amount },
              { summary: '随机', accountId: accounts[s.b]!.id, credit: s.amount },
            ],
          });
          await t.svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
          await t.svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
        }
        const tb = await t.svc.ledger.trialBalance(202602, 202603);
        expect(tb.balanced).toBe(true);
        const rows = await t.svc.ledger.balances({ periodFrom: 202601, periodTo: 202603 });
        const bank = row(rows, '1002')?.closing ?? 0;
        expect(bank).toBe(row(rows, '100201')?.closing ?? 0);
        expect(rows.filter((r) => r.isLeaf).reduce((sum, r) => sum + r.closing, 0)).toBe(0);
      }),
      { numRuns: 25 },
    );
  });
});

describe('分录明细', () => {
  it('按日期排序，含下级科目，可按维度过滤', async () => {
    await setup();
    const rows = await t.svc.ledger.entries({
      periodFrom: 202601,
      periodTo: 202602,
      accountCode: '1002',
    });
    expect(rows.map((r) => r.accountCode)).toEqual(['100202']);
    expect(rows[0]).toMatchObject({ displayNo: '记-0002', fcAmount: 100_00, currency: 'USD' });
    const s001 = (await t.svc.dimensions.getByCode('partner', 'S001'))!;
    const byPartner = await t.svc.ledger.entries({
      periodFrom: 202601,
      periodTo: 202612,
      dimensions: { partner: s001.id },
    });
    expect(byPartner).toHaveLength(1);
    const withPending = await t.svc.ledger.entries({
      periodFrom: 202602,
      periodTo: 202602,
      accountCode: '1001',
      includeUnposted: true,
    });
    expect(withPending.map((r) => r.status)).toEqual(['pending']);
  });
});

it.each([{ excludeClosing: true }, { excludeClosingKinds: ['pnl'] }])(
  'w_zc_zc：%j只筛发生额，期初零且仅有结转的非零本币/外币/数量期末仍保留',
  async (filter) => {
    t = await createTestBook();
    const v = await t.svc.vouchers.create({
      voucherTypeId: (await t.svc.reference.voucherTypes())[0]!.id,
      date: '2026-01-10',
      closingKind: 'pnl',
      lines: [
        {
          accountId: (await t.svc.accounts.require('1001')).id,
          summary: '结转',
          debit: 100,
          credit: 0,
        },
        {
          accountId: (await t.svc.accounts.require('4001')).id,
          summary: '结转',
          debit: 0,
          credit: 100,
        },
        {
          accountId: (await t.svc.accounts.require('100202')).id,
          summary: '原币调整',
          debit: 0,
          credit: 0,
          entrySide: 'debit',
          currency: 'USD',
          exchangeRate: '7.1',
          fcAmount: 5,
        },
        {
          accountId: (await t.svc.accounts.require('1403')).id,
          summary: '数量调整',
          debit: 0,
          credit: 0,
          entrySide: 'credit',
          quantity: '3',
        },
      ],
    });
    await t.svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
    await t.svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
    const query = {
      periodFrom: 202601,
      periodTo: 202601,
      includeZero: false,
      rollup: false,
      ...filter,
    };
    const balances = await t.svc.ledger.balances(query);
    expect(row(balances, '1001')).toMatchObject({
      opening: 0,
      debit: 0,
      credit: 0,
      ytdDebit: 0,
      ytdCredit: 0,
      closing: 100,
    });
    expect(row(balances, '4001')).toMatchObject({ opening: 0, debit: 0, credit: 0, closing: -100 });
    expect(row(balances, '1403')).toMatchObject({
      opening: 0,
      debit: 0,
      credit: 0,
      qtyDebit: '0',
      qtyCredit: '0',
      qtyClosing: '-3',
    });
    const foreign = await t.svc.ledger.balances({ ...query, currency: 'USD' });
    expect(row(foreign, '100202')).toMatchObject({
      opening: 0,
      closing: 0,
      fcDebit: 0,
      fcCredit: 0,
      fcClosing: 5,
    });
    expect(
      (await t.svc.ledger.balances({ ...query, includeZero: true })).find(
        (r) => r.accountCode === '1001',
      ),
    ).toEqual(row(balances, '1001'));
  },
);
