import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestBook, type TestBook } from '@caiwu/testkit';
import type { VoucherInput } from '../src';

let book: TestBook;
let bank: number, expense: number, type: number;
beforeEach(async () => {
  book = await createTestBook();
  bank = (await book.svc.accounts.require('100202')).id;
  expense = (await book.svc.accounts.require('6603')).id;
  type = (await book.svc.reference.voucherTypes())[0]!.id;
});
afterEach(async () => book?.close());
const query = { periodFrom: 202601, periodTo: 202601 };
const owner = () => book.forModule('period-close');
function exchange(side: 'debit' | 'credit' = 'debit', amount = 1000): VoucherInput {
  return {
    voucherTypeId: type,
    date: '2026-01-31',
    source: { type: 'exchange', id: '202601' },
    closingKind: 'exchange',
    lines: [
      {
        summary: '月末汇兑损益',
        accountId: bank,
        debit: side === 'debit' ? amount : 0,
        credit: side === 'credit' ? amount : 0,
        currency: 'USD',
        exchangeRate: '7.2',
        fcAmount: 0,
        dimensions: { cashflow: null },
        cashflowDirection: null,
      },
      {
        summary: '月末汇兑损益',
        accountId: expense,
        debit: side === 'credit' ? amount : 0,
        credit: side === 'debit' ? amount : 0,
      },
    ],
  };
}
async function post(id: number, svc = owner()) {
  await svc.vouchers.changeStatus({ ids: [id], to: 'audited' });
  await svc.vouchers.changeStatus({ ids: [id], to: 'posted' });
}

it('w_hdjz/w_xjll：期末汇兑增加1000分单列汇率影响，既非经营收付也非未分配', async () => {
  const voucher = await owner().vouchers.create(exchange());
  await post(voucher.id);
  const result = await book.svc.ledger.cashflow(query);
  expect(result).toMatchObject({
    cashNet: 1000,
    exchangeEffect: 1000,
    inflow: 0,
    outflow: 0,
    internalNet: 0,
    unallocatedNet: 0,
    unallocatedCount: 0,
    internalUnbalancedVouchers: [],
  });
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({
    sourceModule: 'period-close',
    sourceType: 'exchange',
    sourceId: '202601',
    closingKind: 'exchange',
    currency: 'USD',
    fcAmount: 0,
    debit: 1000,
    credit: 0,
  });
  expect(
    (await book.svc.ledger.entries(query)).find((row) => row.accountId === bank),
  ).toMatchObject({ sourceType: 'exchange', sourceId: '202601', closingKind: 'exchange' });
});

it.each([
  ['debit', 1000, 1000],
  ['credit', 1000, -1000],
  ['debit', -1000, -1000],
  ['credit', -1000, 1000],
] as const)('w_hdjz/w_xjll：%s栏%s的汇率影响保持有符号整数分%s', async (side, amount, expected) => {
  const voucher = await owner().vouchers.create(exchange(side, amount));
  await post(voucher.id);
  expect(await book.svc.ledger.cashflow(query)).toMatchObject({
    exchangeEffect: expected,
    cashNet: expected,
    unallocatedCount: 0,
    unallocatedNet: 0,
    inflow: 0,
    outflow: 0,
  });
});

it('w_hdjz/w_xjll：真实原币收款即使带同样汇兑标记仍按收款，历史空方向仅凭摘要不能冒充汇率影响', async () => {
  const svc = owner();
  await post((await svc.vouchers.create(exchange())).id);
  const cashflow = (await book.svc.dimensions.getByCode('cashflow', 'CF01'))!.id;
  const payment = exchange();
  payment.lines[0] = {
    ...payment.lines[0]!,
    debit: 700,
    fcAmount: 100,
    exchangeRate: '7',
    dimensions: { cashflow },
    cashflowDirection: 'inflow',
  };
  payment.lines[1] = { ...payment.lines[1]!, credit: 700 };
  await post((await svc.vouchers.create(payment)).id);
  const historical = exchange();
  historical.source = undefined;
  historical.closingKind = undefined;
  historical.lines[0] = { ...historical.lines[0]!, debit: 100 };
  historical.lines[1] = { ...historical.lines[1]!, credit: 100 };
  const manual = await book.svc.vouchers.create(historical);
  await post(manual.id, book.svc);
  expect(await book.svc.ledger.cashflow(query)).toMatchObject({
    cashNet: 1800,
    inflow: 700,
    exchangeEffect: 1000,
    unallocatedNet: 100,
    unallocatedCount: 1,
  });
});

it.each([
  '模块不符',
  '来源类型不符',
  '结转标记不符',
  '来源期间不符',
  '本位币行',
  '历史原币空值',
  '仅现金流标志',
] as const)('w_hdjz/w_xjll：%s不得单列汇率影响，原未分配提示保留', async (fault) => {
  const value = exchange();
  if (fault === '来源类型不符') value.source = { type: 'closing', id: '202601' };
  if (fault === '结转标记不符') value.closingKind = 'pnl';
  if (fault === '来源期间不符') value.source = { type: 'exchange', id: '202602' };
  if (fault === '仅现金流标志') {
    const account = await book.svc.accounts.create(
      {
        code: '1003',
        name: '仅现金流标志的外币往来',
        categoryId: 'asset',
        currency: 'USD',
        cashflowRequired: true,
      },
      [4, 2, 2],
    );
    value.lines[0] = { ...value.lines[0]!, accountId: account.id };
  }
  const svc = fault === '模块不符' ? book.forModule('invoice') : owner();
  const voucher = await svc.vouchers.create(value);
  await post(voucher.id, svc);
  if (fault === '本位币行')
    book.book.raw
      .prepare('UPDATE voucher_line SET currency_code=? WHERE voucher_id=? AND account_id=?')
      .run('CNY', voucher.id, bank);
  if (fault === '历史原币空值')
    book.book.raw
      .prepare('UPDATE voucher_line SET fc_amount=NULL WHERE voucher_id=? AND account_id=?')
      .run(voucher.id, bank);
  expect(await book.svc.ledger.cashflow(query)).toMatchObject({
    exchangeEffect: 0,
    cashNet: 1000,
    unallocatedCount: 1,
    unallocatedNet: 1000,
  });
});

it('w_hdjz/w_xjll：状态、币种、科目、日期和排除结转过滤保持原调用语义', async () => {
  const voucher = await owner().vouchers.create(exchange());
  expect((await book.svc.ledger.cashflow(query)).exchangeEffect).toBe(0);
  expect((await book.svc.ledger.cashflow({ ...query, includeUnposted: true })).exchangeEffect).toBe(
    1000,
  );
  await post(voucher.id);
  for (const filter of [
    { currency: 'USD' },
    { accountIds: [bank] },
    { accountCode: '1002' },
    { excludeClosingKinds: ['pnl'] },
  ])
    expect((await book.svc.ledger.cashflow({ ...query, ...filter })).exchangeEffect).toBe(1000);
  for (const filter of [
    { currency: 'CNY' },
    { accountIds: [expense] },
    { periodFrom: 202602, periodTo: 202602 },
    { excludeClosing: true },
    { excludeClosingKinds: ['exchange'] },
  ])
    expect((await book.svc.ledger.cashflow({ ...query, ...filter })).exchangeEffect).toBe(0);
});

it('w_hdjz/w_xjll：作废的待审核汇兑凭证在含未过账查询中也不计入', async () => {
  const voucher = await owner().vouchers.create(exchange());
  await owner().vouchers.setVoided(voucher.id, true);
  expect(await book.svc.ledger.cashflow({ ...query, includeUnposted: true })).toMatchObject({
    exchangeEffect: 0,
    cashNet: 0,
    unallocatedCount: 0,
    rows: [],
  });
});

it('w_hdjz/w_xjll：同凭证的汇率影响不参与内部转移配平，过滤对方行仍完整核对真实内部收付', async () => {
  const cf = (await book.svc.dimensions.getByCode('cashflow', 'CF01'))!;
  await book.svc.dimensions.update(
    cf.id,
    { code: cf.code, name: cf.name, attrs: { cashflowDirection: 'internal' } },
    { expectedRevision: cf.revision! },
  );
  const a = (await book.svc.accounts.require('100201')).id;
  const b = (await book.svc.accounts.require('1001')).id;
  const value = exchange();
  value.lines.push(
    {
      summary: '真实内部转入',
      accountId: a,
      debit: 100,
      credit: 0,
      dimensions: { cashflow: cf.id },
      cashflowDirection: 'internal',
    },
    {
      summary: '真实内部转出',
      accountId: b,
      debit: 0,
      credit: 100,
      dimensions: { cashflow: cf.id },
      cashflowDirection: 'internal',
    },
  );
  const voucher = await owner().vouchers.create(value);
  await post(voucher.id);
  // 模拟历史将汇兑错误标为内部转移；结构化来源和零原币变动仍将它单列。
  book.book.raw
    .prepare(
      "UPDATE voucher_line SET cashflow_direction='internal',dim_cashflow=? WHERE voucher_id=? AND account_id=?",
    )
    .run(cf.id, voucher.id, bank);
  expect(await book.svc.ledger.cashflow(query)).toMatchObject({
    exchangeEffect: 1000,
    internalNet: 0,
    internalUnbalancedVouchers: [],
  });
  expect(await book.svc.ledger.cashflow({ ...query, accountIds: [a] })).toMatchObject({
    exchangeEffect: 0,
    internalNet: 100,
    internalUnbalancedVouchers: [],
  });
  expect(await book.svc.ledger.cashflow({ ...query, currency: 'USD' })).toMatchObject({
    exchangeEffect: 1000,
    internalNet: 0,
    internalUnbalancedVouchers: [],
  });
  book.book.raw
    .prepare('UPDATE voucher_line SET cashflow_direction=NULL WHERE voucher_id=? AND account_id=?')
    .run(voucher.id, b);
  expect(
    (await book.svc.ledger.cashflow({ ...query, accountIds: [a] })).internalUnbalancedVouchers,
  ).toEqual([voucher.id]);
});
