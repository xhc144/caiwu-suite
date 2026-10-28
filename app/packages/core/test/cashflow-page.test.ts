import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestBook, seedVouchers, type TestBook } from '@caiwu/testkit';
import { CashflowPageSchema, type VoucherLineInput } from '../src';
let book: TestBook;
beforeEach(async () => {
  book = await createTestBook();
});
afterEach(async () => book?.close());
const range = { periodFrom: 202601, periodTo: 202601 };
async function post(lines: VoucherLineInput[]) {
  const voucher = await book.svc.vouchers.create({
    date: '2026-01-03',
    voucherTypeId: (await book.svc.reference.voucherTypes())[0]!.id,
    lines,
  });
  await book.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
  await book.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'posted' });
  return voucher;
}
it('w_zc_xjll_1：有限明细页、项目页与完整合计同口径，空项目单独分页', async () => {
  const cash = (await book.svc.accounts.require('1001')).id;
  const capital = (await book.svc.accounts.require('4001')).id;
  const incoming = (await book.svc.dimensions.getByCode('cashflow', 'CF01'))!.id;
  const outgoing = (await book.svc.dimensions.getByCode('cashflow', 'CF02'))!.id;
  await post([
    {
      accountId: cash,
      summary: '项目收款',
      debit: 123,
      dimensions: { cashflow: incoming },
      cashflowDirection: 'inflow',
    },
    {
      accountId: cash,
      summary: '项目付款',
      credit: 23,
      dimensions: { cashflow: outgoing },
      cashflowDirection: 'outflow',
    },
    { accountId: cash, summary: '历史空方向', debit: 7, dimensions: { cashflow: incoming } },
    { accountId: cash, summary: '未指定项目', debit: 11 },
    { accountId: capital, summary: '平衡', credit: 118 },
  ]);
  const old = await book.svc.ledger.cashflow(range);
  const { rows: oldRows, internalUnbalancedVouchers: _diagnostics, ...oldTotals } = old;
  const first = await book.svc.ledger.cashflowPage({ ...range, pageSize: 2, limit: 1 });
  expect(first).toMatchObject({
    rowCount: 4,
    offset: 0,
    pageSize: 2,
    hasMore: true,
    internalUnbalancedVoucherCount: 0,
    totals: { ...oldTotals, rowCount: 4 },
  });
  expect(first.rows).toEqual(oldRows.slice(0, 2));
  const last = await book.svc.ledger.cashflowPage({ ...range, offset: 2, pageSize: 2 });
  expect(last).toMatchObject({ rowCount: 4, hasMore: false, totals: first.totals });
  expect(last.rows).toEqual(oldRows.slice(2));
  const beyond = await book.svc.ledger.cashflowPage({ ...range, offset: 4, pageSize: 2 });
  expect(beyond.rows).toEqual([]);
  expect(beyond.hasMore).toBe(false);
  expect(beyond.totals).toEqual(first.totals);
  expect(await book.svc.ledger.cashflowGroups({ ...range, pageSize: 1 })).toMatchObject({
    groupCount: 3,
    offset: 0,
    hasMore: true,
    groups: [
      { cashflowId: null, rowCount: 1, cashNet: 11, unallocatedNet: 11, unallocatedCount: 1 },
    ],
  });
  const next = await book.svc.ledger.cashflowGroups({ ...range, offset: 1, pageSize: 2 });
  expect(next.hasMore).toBe(false);
  expect(next.groups).toEqual([
    expect.objectContaining({
      cashflowId: incoming,
      rowCount: 2,
      cashNet: 130,
      inflow: 123,
      unallocatedNet: 7,
    }),
    expect.objectContaining({ cashflowId: outgoing, rowCount: 1, cashNet: -23, outflow: 23 }),
  ]);
  const filtered = await book.svc.ledger.cashflowPage({
    ...range,
    dimensions: { cashflow: null },
    pageSize: 1,
  });
  expect(filtered).toMatchObject({
    rowCount: 1,
    hasMore: false,
    totals: { cashNet: 11, unallocatedCount: 1 },
  });
  expect(filtered.rows[0]!.summary).toBe('未指定项目');
});
it('w_zc_xjll_1：内部互转诊断读取完整凭证，异常列表独立分页', async () => {
  const cash = (await book.svc.accounts.require('1001')).id;
  const bank = (await book.svc.accounts.require('100201')).id;
  const cf = (await book.svc.dimensions.getByCode('cashflow', 'CF01'))!;
  await book.svc.dimensions.update(
    cf.id,
    { code: cf.code, name: cf.name, attrs: { cashflowDirection: 'internal' } },
    { expectedRevision: cf.revision! },
  );
  for (let i = 0; i < 3; i++)
    await post([
      {
        accountId: cash,
        summary: '内部收',
        debit: 100,
        dimensions: { cashflow: cf.id },
        cashflowDirection: 'internal',
      },
      {
        accountId: bank,
        summary: '内部付',
        credit: 100,
        dimensions: { cashflow: cf.id },
        cashflowDirection: 'internal',
      },
    ]);
  const filter = { ...range, accountIds: [cash] };
  expect(await book.svc.ledger.cashflowPage({ ...filter, pageSize: 1 })).toMatchObject({
    rowCount: 3,
    internalUnbalancedVoucherCount: 0,
    totals: { internalNet: 300, cashNet: 300 },
  });
  // 模拟受支持的历史异常：保留真实过账凭证，其一侧的历史方向缺失。
  book.book.raw
    .prepare('UPDATE voucher_line SET cashflow_direction=NULL WHERE account_id=?')
    .run(bank);
  expect(
    (await book.svc.ledger.cashflowPage({ ...filter, pageSize: 1 })).internalUnbalancedVoucherCount,
  ).toBe(3);
  const diagnostic = await book.svc.ledger.cashflowDiagnostics({ ...filter, pageSize: 2 });
  expect(diagnostic).toMatchObject({ voucherCount: 3, offset: 0, pageSize: 2, hasMore: true });
  expect(diagnostic.voucherIds).toHaveLength(2);
  const final = await book.svc.ledger.cashflowDiagnostics({ ...filter, offset: 2, pageSize: 2 });
  expect(final).toMatchObject({ voucherCount: 3, hasMore: false });
  expect(new Set([...diagnostic.voucherIds, ...final.voucherIds]).size).toBe(3);
});
it('w_zc_xjll_1：缺失期间、逆序期间与无界页请求明确拒绝', async () => {
  await expect(book.svc.ledger.cashflowPage({ ...range, periodTo: 202701 })).rejects.toMatchObject({
    data: { code: 'LEDGER_PERIOD_MISSING' },
  });
  await expect(
    book.svc.ledger.cashflowGroups({ ...range, periodFrom: 202602 }),
  ).rejects.toMatchObject({ data: { code: 'PERIOD_RANGE_INVALID' } });
  await expect(
    book.svc.ledger.cashflowDiagnostics({ ...range, periodFrom: 202512 }),
  ).rejects.toMatchObject({ data: { code: 'PERIOD_BEFORE_START' } });
  expect(() => CashflowPageSchema.parse({ ...range, pageSize: 5001 })).toThrow();
  expect(() => CashflowPageSchema.parse({ ...range, offset: -1 })).toThrow();
});
it('w_zc_xjll_1：超过安全整数的中间借贷经抵销仍精确，最终越界明确拒绝', async () => {
  const N = Number.MAX_SAFE_INTEGER;
  for (const [debit, credit] of [
    [N, 0],
    [2, 0],
    [0, N],
  ])
    await seedVouchers(book.svc, [
      {
        date: '2026-01-01',
        status: 'posted',
        lines: [
          { account: '1001', debit, credit },
          { account: '4001', debit: credit, credit: debit },
        ],
      },
    ]);
  expect((await book.svc.ledger.cashflowPage(range)).totals).toMatchObject({
    cashNet: 2,
    unallocatedNet: 2,
  });
  await seedVouchers(book.svc, [
    {
      date: '2026-01-01',
      status: 'posted',
      lines: [
        { account: '1001', debit: N },
        { account: '4001', credit: N },
      ],
    },
  ]);
  await expect(book.svc.ledger.cashflowPage(range)).rejects.toMatchObject({
    data: { code: 'LEDGER_AGGREGATE_OUT_OF_RANGE' },
  });
  await expect(book.svc.ledger.cashflowGroups(range)).rejects.toMatchObject({
    data: { code: 'LEDGER_AGGREGATE_OUT_OF_RANGE' },
  });
});
it('w_zc_xjll_1：真实合法200598条现金分录完整聚合，仅物化有限页并到达末页', async () => {
  const cash = (await book.svc.accounts.require('1001')).id;
  const capital = (await book.svc.accounts.require('4001')).id;
  const voucherTypeId = (await book.svc.reference.voucherTypes())[0]!.id;
  await book.svc.tx(async (svc) => {
    for (let i = 0; i < 201; i++) {
      const voucher = await svc.vouchers.create({
        date: '2026-01-03',
        voucherTypeId,
        lines: [
          ...Array.from({ length: 998 }, () => ({
            accountId: cash,
            summary: '合法大量分录',
            debit: 1,
          })),
          { accountId: capital, summary: '平衡', credit: 998 },
        ],
      });
      await svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
      await svc.vouchers.changeStatus({ ids: [voucher.id], to: 'posted' });
    }
  });
  const entryPage = await book.svc.ledger.entriesPage({ ...range, pageSize: 3, limit: 1 });
  expect(entryPage).toMatchObject({ rowCount: 200799, pageSize: 3, hasMore: true });
  expect(entryPage.rows).toHaveLength(3);
  const lastEntryPage = await book.svc.ledger.entriesPage({
    ...range,
    accountIds: [cash],
    offset: 200597,
    pageSize: 3,
  });
  expect(lastEntryPage).toMatchObject({ rowCount: 200598, hasMore: false });
  expect(lastEntryPage.rows).toHaveLength(1);
  expect(lastEntryPage.rows[0]!.lineNo).toBe(998);
  const page = await book.svc.ledger.cashflowPage({ ...range, pageSize: 3 });
  expect(page.rows).toHaveLength(3);
  expect(page).toMatchObject({
    rowCount: 200598,
    hasMore: true,
    totals: { cashNet: 200598, unallocatedNet: 200598, unallocatedCount: 200598 },
  });
  const last = await book.svc.ledger.cashflowPage({ ...range, offset: 200597, pageSize: 3 });
  expect(last.rows).toHaveLength(1);
  expect(last).toMatchObject({ rowCount: 200598, hasMore: false, totals: page.totals });
  expect(last.rows[0]!.lineNo).toBe(998);
  expect(await book.svc.ledger.cashflowGroups({ ...range, pageSize: 1 })).toMatchObject({
    groupCount: 1,
    hasMore: false,
    groups: [{ cashflowId: null, rowCount: 200598, cashNet: 200598 }],
  });
});
