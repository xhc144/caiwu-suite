import { afterEach, beforeEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createTestBook, seedVouchers, type TestBook } from '@caiwu/testkit';

let book: TestBook;
beforeEach(async () => {
  book = await createTestBook();
});
afterEach(async () => book?.close());
const range = { periodFrom: 202601, periodTo: 202601 };

it('w_hdjz/w_zc_xjll_1：新分页与项目聚合沿用严格汇率影响判定，保留零本币原借贷侧', async () => {
  const bank = (await book.svc.accounts.require('100202')).id;
  const expense = (await book.svc.accounts.require('6603')).id;
  const voucherTypeId = (await book.svc.reference.voucherTypes())[0]!.id;
  const svc = book.forModule('period-close');
  const exchange = await svc.vouchers.create({
    voucherTypeId,
    date: '2026-01-31',
    source: { type: 'exchange', id: '202601' },
    closingKind: 'exchange',
    lines: [
      {
        accountId: bank,
        summary: '本月汇率折算',
        debit: 70,
        currency: 'USD',
        exchangeRate: '7.1',
        fcAmount: 0,
      },
      { accountId: expense, summary: '本月汇率折算', credit: 70 },
    ],
  });
  await svc.vouchers.changeStatus({ ids: [exchange.id], to: 'audited' });
  await svc.vouchers.changeStatus({ ids: [exchange.id], to: 'posted' });
  const adjustment = await book.svc.vouchers.create({
    voucherTypeId,
    date: '2026-01-31',
    lines: [
      {
        accountId: bank,
        summary: '零本币原币调整',
        entrySide: 'credit',
        debit: 0,
        credit: 0,
        currency: 'USD',
        exchangeRate: '7.1',
        fcAmount: 1,
      },
    ],
  });
  await book.svc.vouchers.changeStatus({ ids: [adjustment.id], to: 'audited' });
  await book.svc.vouchers.changeStatus({ ids: [adjustment.id], to: 'posted' });
  const page = await book.svc.ledger.cashflowPage({
    ...range,
    accountIds: [bank],
    currency: 'USD',
  });
  expect(page).toMatchObject({
    rowCount: 2,
    totals: { cashNet: 70, exchangeEffect: 70, unallocatedNet: 0, unallocatedCount: 1 },
  });
  expect(page.rows[1]).toMatchObject({
    voucherId: adjustment.id,
    debit: 0,
    credit: 0,
    entrySide: 'credit',
    fcAmount: 1,
  });
  expect(await book.svc.ledger.cashflowGroups({ ...range, currency: 'USD' })).toMatchObject({
    groupCount: 1,
    groups: [{ cashflowId: null, cashNet: 70, exchangeEffect: 70, unallocatedCount: 1 }],
  });
  expect(
    (await book.svc.ledger.cashflowPage({ ...range, excludeClosing: true })).totals,
  ).toMatchObject({ rowCount: 1, cashNet: 0, exchangeEffect: 0 });
  expect(
    (await book.svc.ledger.cashflowPage({ ...range, excludeClosingKinds: ['exchange'] })).totals,
  ).toMatchObject({ rowCount: 1, cashNet: 0, exchangeEffect: 0 });
});

it('w_zc_xjll_1：明细和全量合计共用过滤，草稿与作废始终排除，未过账须明确选择', async () => {
  const posted = await seedVouchers(book.svc, [
    {
      date: '2026-01-01',
      status: 'posted',
      lines: [
        { account: '1001', debit: 10 },
        { account: '4001', credit: 10 },
      ],
    },
  ]);
  const pending = await seedVouchers(book.svc, [
    {
      date: '2026-01-02',
      lines: [
        { account: '1001', debit: 20 },
        { account: '4001', credit: 20 },
      ],
    },
  ]);
  const draft = await seedVouchers(book.svc, [
    {
      date: '2026-01-03',
      status: 'draft',
      lines: [
        { account: '1001', debit: 30 },
        { account: '4001', credit: 30 },
      ],
    },
  ]);
  const voided = await seedVouchers(book.svc, [
    {
      date: '2026-01-04',
      lines: [
        { account: '1001', debit: 40 },
        { account: '4001', credit: 40 },
      ],
    },
  ]);
  await book.svc.vouchers.setVoided(voided[0]!.id, true);
  const exact = await book.svc.ledger.cashflowPage({ ...range, currency: 'CNY', pageSize: 1 });
  expect(exact).toMatchObject({ rowCount: 1, totals: { cashNet: 10 } });
  expect(exact.rows[0]!.voucherId).toBe(posted[0]!.id);
  const all = await book.svc.ledger.cashflowPage({
    ...range,
    includeUnposted: true,
    pageSize: 1,
    offset: 1,
  });
  expect(all).toMatchObject({ rowCount: 2, hasMore: false, totals: { cashNet: 30 } });
  expect(all.rows[0]!.voucherId).toBe(pending[0]!.id);
  expect(all.rows.some((row) => [draft[0]!.id, voided[0]!.id].includes(row.voucherId))).toBe(false);
});

it('w_zc_xjll_1：跨调用导出在svc.tx中保持同一真实SQLite快照', async () => {
  const [voucher] = await seedVouchers(book.svc, [
    {
      date: '2026-01-01',
      status: 'posted',
      lines: [
        { account: '1001', debit: 10 },
        { account: '4001', credit: 10 },
      ],
    },
  ]);
  const connection = new Database(book.book.raw.name);
  try {
    await book.svc.tx(async (svc) => {
      const first = await svc.ledger.cashflowPage(range);
      const firstEntries = await svc.ledger.entriesPage({ ...range, pageSize: 1 });
      // 外部进程的已提交历史数据修正模拟：当前导出仍须读到先前的快照。
      connection
        .prepare('UPDATE voucher_line SET debit=12 WHERE voucher_id=? AND debit=10')
        .run(voucher!.id);
      const second = await svc.ledger.cashflowPage(range);
      expect(second).toEqual(first);
      expect(await svc.ledger.entriesPage({ ...range, pageSize: 1 })).toEqual(firstEntries);
      expect((await svc.ledger.cashflowGroups(range)).groups[0]!.cashNet).toBe(10);
    });
    expect((await book.svc.ledger.cashflowPage(range)).totals.cashNet).toBe(12);
    expect((await book.svc.ledger.entriesPage({ ...range, pageSize: 1 })).rows[0]!.debit).toBe(12);
  } finally {
    connection.close();
  }
});

it('w_zc_xjll_1：真实SQLite SUM超过64位时页合计与项目合计均返回明确错误', async () => {
  const cash = (await book.svc.accounts.require('1001')).id;
  const capital = (await book.svc.accounts.require('4001')).id;
  const voucherTypeId = (await book.svc.reference.voucherTypes())[0]!.id;
  await book.svc.tx(async (svc) => {
    for (let i = 0; i < 1025; i++) {
      const voucher = await svc.vouchers.create({
        voucherTypeId,
        date: '2026-01-01',
        lines: [
          { accountId: cash, summary: '合法极值分录', debit: Number.MAX_SAFE_INTEGER },
          { accountId: capital, summary: '合法极值分录', credit: Number.MAX_SAFE_INTEGER },
        ],
      });
      await svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
      await svc.vouchers.changeStatus({ ids: [voucher.id], to: 'posted' });
    }
  });
  await expect(book.svc.ledger.cashflowPage(range)).rejects.toMatchObject({
    data: { code: 'LEDGER_AGGREGATE_OUT_OF_RANGE' },
  });
  await expect(book.svc.ledger.cashflowGroups(range)).rejects.toMatchObject({
    data: { code: 'LEDGER_AGGREGATE_OUT_OF_RANGE' },
  });
});
