import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestBook, seedVouchers, type TestBook } from '@caiwu/testkit';
import { EntryFilterSchema } from '../src';
let book: TestBook;
beforeEach(async () => {
  book = await createTestBook();
});
afterEach(async () => book?.close());
const range = { periodFrom: 202601, periodTo: 202601 };
async function fixture() {
  const accounts = [];
  for (const [code, quantityUnit] of [
    ['140301', '千克'],
    ['140302', '件'],
  ] as const)
    accounts.push(
      await book.svc.accounts.create(
        {
          code,
          name: `材料${quantityUnit}`,
          quantityUnit,
          dimensions: [{ type: 'department', required: false }],
        },
        [4, 2, 2],
      ),
    );
  const department = (await book.svc.dimensions.getByCode('department', '01'))!.id;
  for (const [index, account, dims] of [
    [1, '140302', {}],
    [2, '140301', { department: '01' }],
    [3, '140301', {}],
  ] as const)
    await seedVouchers(book.svc, [
      {
        date: `2026-01-0${index}`,
        status: 'posted',
        lines: [
          { account, debit: index * 100, quantity: String(index), dims },
          { account: '4001', credit: index * 100 },
        ],
      },
    ]);
  for (const [index, account] of accounts.entries()) {
    await book.svc.opening.upsert({
      year: 2026,
      accountId: account.id,
      balance: 10 + index,
      quantity: '1',
    });
    await book.svc.opening.upsert({
      year: 2026,
      accountId: account.id,
      dimensions: { department },
      balance: 20 + index,
      quantity: '2',
    });
  }
  return { accounts, department };
}
it('w_zw_fhslye_1：精确空辅助和数量单位在limit之前相交，父科目钻取不混单位', async () => {
  await fixture();
  const rows = await book.svc.ledger.entries({
    ...range,
    accountCode: '1403',
    quantityUnit: '千克',
    dimensions: { department: null },
    limit: 1,
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    accountCode: '140301',
    debit: 300,
    quantity: '3',
    dimensions: { department: null },
  });
  expect(
    (await book.svc.ledger.entries({ ...range, accountCode: '1403', quantityUnit: '千克' })).map(
      (r) => r.debit,
    ),
  ).toEqual([200, 300]);
  expect(
    (await book.svc.ledger.entries({ ...range, accountCode: '1403', quantityUnit: '件' })).map(
      (r) => r.debit,
    ),
  ).toEqual([100]);
});
it('w_zw_fhye_1：null同时约束期初、本期和累计，省略维度仍取全部', async () => {
  const { accounts, department } = await fixture();
  const common = { ...range, accountCodes: ['140301'], rollup: false, quantityUnit: '千克' };
  const empty = await book.svc.ledger.balances({ ...common, dimensions: { department: null } });
  expect(empty).toHaveLength(1);
  expect(empty[0]).toMatchObject({
    accountId: accounts[0]!.id,
    opening: 10,
    debit: 300,
    closing: 310,
    ytdDebit: 300,
    qtyOpening: '1',
    qtyDebit: '3',
    qtyClosing: '4',
  });
  expect(
    (await book.svc.ledger.balances({ ...common, dimensions: { department } }))[0],
  ).toMatchObject({ opening: 20, debit: 200, closing: 220 });
  expect((await book.svc.ledger.balances(common))[0]).toMatchObject({
    opening: 30,
    debit: 500,
    closing: 530,
  });
  expect(
    (await book.svc.ledger.balances({ ...common, dimensions: { cashflow: null } }))[0],
  ).toMatchObject({ opening: 30, debit: 500 });
  const cashflow = (await book.svc.dimensions.getByCode('cashflow', 'CF01'))!.id;
  expect(await book.svc.ledger.balances({ ...common, dimensions: { cashflow } })).toEqual([]);
});
it('w_zc_slz：空科目ID集合不扩大到全账；空单位和伪辅助ID明确拒绝', async () => {
  await fixture();
  expect(await book.svc.ledger.entries({ ...range, accountIds: [] })).toEqual([]);
  expect(() => EntryFilterSchema.parse({ ...range, quantityUnit: '' })).toThrow();
  expect(() => EntryFilterSchema.parse({ ...range, dimensions: { department: 0 } })).toThrow();
});

it('w_zc_slz：有限SQL分页返回全匹配数，过滤在截页前执行并稳定到达末页', async () => {
  const { department } = await fixture();
  const query = { ...range, accountCode: '1403', quantityUnit: '千克', pageSize: 1, limit: 1 };
  const first = await book.svc.ledger.entriesPage(query);
  expect(first).toMatchObject({ rowCount: 2, offset: 0, pageSize: 1, hasMore: true });
  expect(first.rows[0]!.debit).toBe(200);
  const last = await book.svc.ledger.entriesPage({ ...query, offset: 1 });
  expect(last).toMatchObject({ rowCount: 2, offset: 1, hasMore: false });
  expect(last.rows[0]!.debit).toBe(300);
  const empty = await book.svc.ledger.entriesPage({ ...query, offset: 2 });
  expect(empty).toMatchObject({ rowCount: 2, rows: [], hasMore: false });
  expect(
    await book.svc.ledger.entriesPage({ ...query, dimensions: { department: null } }),
  ).toMatchObject({ rowCount: 1, hasMore: false, rows: [expect.objectContaining({ debit: 300 })] });
  expect(await book.svc.ledger.entriesPage({ ...query, dimensions: { department } })).toMatchObject(
    { rowCount: 1, hasMore: false, rows: [expect.objectContaining({ debit: 200 })] },
  );
  expect(await book.svc.ledger.entriesPage({ ...query, accountIds: [] })).toMatchObject({
    rowCount: 0,
    rows: [],
    hasMore: false,
  });
  expect(await book.svc.ledger.entries(query)).toHaveLength(1);
});
it('w_zc_slz：新完整明细分页拒绝缺失期间，保留旧entries期间及limit契约', async () => {
  await expect(book.svc.ledger.entriesPage({ ...range, periodTo: 202701 })).rejects.toMatchObject({
    data: { code: 'LEDGER_PERIOD_MISSING' },
  });
  await expect(book.svc.ledger.entriesPage({ ...range, periodFrom: 202512 })).rejects.toMatchObject(
    { data: { code: 'PERIOD_BEFORE_START' } },
  );
  await expect(book.svc.ledger.entriesPage({ ...range, periodFrom: 202602 })).rejects.toMatchObject(
    { data: { code: 'PERIOD_RANGE_INVALID' } },
  );
  await expect(book.svc.ledger.entriesPage({ ...range, pageSize: 5001 })).rejects.toThrow();
  expect(await book.svc.ledger.entries({ periodFrom: 202701, periodTo: 202701 })).toEqual([]);
});
