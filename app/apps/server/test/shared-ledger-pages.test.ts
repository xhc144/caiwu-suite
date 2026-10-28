import { afterEach, expect, it } from 'vitest';
import {
  createTestApp,
  seedVouchers,
  voucherInputFromSpec,
  type TestApp,
  type VoucherSpec,
} from '@caiwu/testkit';

let app: TestApp;
afterEach(async () => app?.close());

it('账簿只读分页：认证、空辅助与单位在SQL截页前生效，完整条数不随旧limit改变', async () => {
  app = await createTestApp();
  for (const [code, unit] of [
    ['1491', '千克'],
    ['1492', '件'],
  ] as const)
    await app.svc.accounts.create(
      {
        code,
        name: `合成分页材料${unit}`,
        categoryId: 'asset',
        quantityUnit: unit,
        dimensions: [{ type: 'department', required: false }],
      },
      [4, 2, 2],
    );
  await seedVouchers(app.svc, [
    {
      date: '2026-01-01',
      status: 'posted',
      lines: [
        { account: '1492', debit: 100, quantity: '1' },
        { account: '4001', credit: 100 },
      ],
    },
    {
      date: '2026-01-02',
      status: 'posted',
      lines: [
        { account: '1491', debit: 200, quantity: '2', dims: { department: '01' } },
        { account: '4001', credit: 200 },
      ],
    },
    {
      date: '2026-01-03',
      status: 'posted',
      lines: [
        { account: '1491', debit: 300, quantity: '3' },
        { account: '4001', credit: 300 },
      ],
    },
    {
      date: '2026-01-04',
      status: 'posted',
      lines: [
        { account: '1491', debit: 400, quantity: '4' },
        { account: '4001', credit: 400 },
      ],
    },
  ]);
  const filter = {
    periodFrom: 202601,
    periodTo: 202601,
    quantityUnit: '千克',
    dimensions: { department: null },
    pageSize: 1,
    limit: 1,
  };
  await expect(app.core(null).ledger.entriesPage(filter)).rejects.toThrow('登录已失效');
  const first = await app.core().ledger.entriesPage(filter);
  expect(first).toMatchObject({ rowCount: 2, offset: 0, pageSize: 1, hasMore: true });
  expect(first.rows).toHaveLength(1);
  expect(first.rows[0]).toMatchObject({
    debit: 300,
    quantity: '3',
    dimensions: { department: null },
  });
  const last = await app.core().ledger.entriesPage({ ...filter, offset: 1 });
  expect(last).toMatchObject({ rowCount: 2, hasMore: false });
  expect(last.rows[0]!.debit).toBe(400);
  await expect(app.core().ledger.entriesPage({ ...filter, pageSize: 5001 })).rejects.toThrow();
  await expect(app.core().ledger.entriesPage({ ...filter, periodTo: 202701 })).rejects.toThrow(
    '缺少',
  );
});

it('现金流只读分页：完整合计、项目与逐凭证诊断均可通过已认证接口分页', async () => {
  app = await createTestApp();
  const specs: VoucherSpec[] = [
    {
      date: '2026-01-01',
      status: 'posted',
      lines: [
        { account: '1001', debit: 100, dims: { cashflow: 'CF01' } },
        {
          account: '100201',
          credit: 100,
          dims: { cashflow: 'CF01' },
        },
      ],
    },
    {
      date: '2026-01-02',
      status: 'posted',
      lines: [
        { account: '1001', debit: 20, dims: { cashflow: 'CF01' } },
        { account: '100201', credit: 20, dims: { cashflow: 'CF01' } },
      ],
    },
    {
      date: '2026-01-03',
      status: 'posted',
      lines: [
        { account: '1001', debit: 7 },
        { account: '4001', credit: 7 },
      ],
    },
  ];
  const vouchers = [];
  for (const spec of specs) {
    const input = await voucherInputFromSpec(app.svc, spec);
    const voucher = await app.svc.vouchers.create({
      ...input,
      lines: input.lines.map((line) => ({
        ...line,
        cashflowDirection: line.dimensions.cashflow ? 'internal' : null,
      })),
    });
    await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
    await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'posted' });
    vouchers.push(voucher);
  }
  const [transfer, unmatched] = vouchers;
  // 合法保存并过账后，模拟历史导入数据中内部转移一侧方向缺失的异常。
  app.runtime.bookStore
    .open(app.book.id)
    .raw.prepare(
      'UPDATE voucher_line SET cashflow_direction=NULL WHERE voucher_id=? AND account_id=?',
    )
    .run(unmatched!.id, (await app.svc.accounts.require('100201')).id);
  const filter = {
    periodFrom: 202601,
    periodTo: 202601,
    accountCode: '1001',
    pageSize: 1,
    limit: 1,
  };
  const page = await app.core().ledger.cashflowPage(filter);
  expect(page).toMatchObject({
    rowCount: 3,
    hasMore: true,
    totals: { cashNet: 127, internalNet: 120, unallocatedNet: 7 },
    internalUnbalancedVoucherCount: 1,
  });
  const groups = await app.core().ledger.cashflowGroups(filter);
  expect(groups).toMatchObject({ groupCount: 2, hasMore: true });
  expect(groups.groups[0]).toMatchObject({ cashflowId: null, cashNet: 7 });
  const diagnostic = await app.core().ledger.cashflowDiagnostics(filter);
  expect(diagnostic).toMatchObject({
    voucherCount: 1,
    voucherIds: [unmatched!.id],
    hasMore: false,
  });
  expect(diagnostic.voucherIds).not.toContain(transfer!.id);
  await expect(app.core(null).ledger.cashflowPage(filter)).rejects.toThrow('登录已失效');
  await expect(app.core(null).ledger.cashflowGroups(filter)).rejects.toThrow('登录已失效');
  await expect(app.core(null).ledger.cashflowDiagnostics(filter)).rejects.toThrow('登录已失效');
});
