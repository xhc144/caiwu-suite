import { afterEach, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTestBook, seedVouchers, voucherInputFromSpec, type TestBook } from '@caiwu/testkit';
import { parseCodeScheme, normalizeRows } from '../src';
import { createCoreServices } from '../src/server';

let book: TestBook;
afterEach(async () => book?.close());
const base = {
  date: '2026-01-10',
  lines: [
    { account: '1001', debit: 123 },
    { account: '6001', credit: 123 },
  ],
};

it('w_pz_pzedit：首中尾空行忽略，半行按原行号报错，不耗编号', async () => {
  book = await createTestBook();
  const input = await voucherInputFromSpec(book.svc, base);
  const blank = { summary: '', debit: 0, credit: 0 };
  const v = await book.svc.vouchers.create({
    ...input,
    lines: [blank, input.lines[0]!, blank, input.lines[1]!, blank],
  });
  expect(v.lines.map((l) => l.lineNo)).toEqual([2, 4]);
  await expect(
    book.svc.vouchers.create({
      ...input,
      lines: [blank, input.lines[0]!, { summary: '仅摘要' }, input.lines[1]!],
    }),
  ).rejects.toMatchObject({
    data: { details: { problems: expect.arrayContaining([{ line: 3, message: '没有选择科目' }]) } },
  });
  await expect(book.svc.vouchers.create({ ...input, lines: [blank, blank] })).rejects.toThrow(
    /两行/,
  );
  expect((await book.svc.vouchers.create(input)).number).toBe(2);
  expect(
    normalizeRows([
      { id: 'ui-1', summary: '' },
      { id: 'ui-2', quantity: '0.001' },
    ]).rowNumbers,
  ).toEqual([2]);
});

it('w_pz_pzedit/w_zw_jz：零本币外币与数量保存、修改、转正式、过账/反过账后完整保留', async () => {
  book = await createTestBook();
  const quantity = (await book.svc.accounts.require('1403')).id;
  const foreign = (await book.svc.accounts.require('100202')).id;
  const voucherTypeId = (await book.svc.reference.voucherTypes())[0]!.id;
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 100000 }), async (value) => {
      const input = {
        voucherTypeId,
        date: '2026-01-10',
        lines: [
          {
            summary: '数量调整',
            accountId: quantity,
            debit: 0,
            credit: 0,
            entrySide: 'debit' as const,
            quantity: String(value),
          },
          {
            summary: '外币调整',
            accountId: foreign,
            debit: 0,
            credit: 0,
            entrySide: 'credit' as const,
            currency: 'USD',
            exchangeRate: '7.1',
            fcAmount: value,
          },
        ],
      };
      const draft = await book.svc.vouchers.create({ ...input, draft: true });
      const v = await book.svc.vouchers.update(draft.id, input, {
        expectedRevision: draft.revision,
      });
      expect(v.debitTotal).toBe(0);
      expect(v.number).not.toBeNull();
      await book.svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
      await book.svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
      const balance = await book.svc.ledger.balances({
        periodFrom: 202601,
        periodTo: 202601,
        accountCodes: ['100202'],
        currency: 'USD',
        rollup: false,
      });
      expect(balance[0]!.fcCredit).toBe(value);
      expect(balance[0]!.fcClosing).toBe(-value);
      const quantities = await book.svc.ledger.quantityBalances({
        periodFrom: 202601,
        periodTo: 202601,
        quantityUnit: '千克',
        rollup: false,
      });
      expect(quantities.find((r) => r.accountId === quantity)!.qtyClosing).toBe(String(value));
      const saved = (await book.svc.vouchers.get(v.id))!;
      expect(saved.lines[0]).toMatchObject({ entrySide: 'debit', quantity: String(value) });
      expect(saved.lines[1]).toMatchObject({
        entrySide: 'credit',
        fcAmount: value,
        exchangeRate: '7.1',
      });
      await book.svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
      await book.svc.vouchers.changeStatus({ ids: [v.id], to: 'pending' });
      await book.svc.vouchers.delete(v.id);
    }),
    { numRuns: 8 },
  );
});

it('w_xt_xjwh/w_pz_pzedit：强类型现金流方向逐凭证配平，历史空方向列为未分配', async () => {
  book = await createTestBook();
  const cf = (await book.svc.dimensions.getByCode('cashflow', 'CF01'))!;
  await book.svc.dimensions.update(
    cf.id,
    { code: cf.code, name: cf.name, attrs: { cashflowDirection: 'internal' } },
    { expectedRevision: cf.revision! },
  );
  const input = await voucherInputFromSpec(book.svc, base);
  await expect(
    book.svc.vouchers.create({
      ...input,
      lines: [
        { ...input.lines[0]!, dimensions: { cashflow: cf.id }, cashflowDirection: 'internal' },
        input.lines[1]!,
      ],
    }),
  ).rejects.toThrow(/内部现金转移未配平/);
  await expect(
    book.svc.vouchers.create({
      ...input,
      lines: [
        { ...input.lines[0]!, dimensions: { cashflow: cf.id }, cashflowDirection: 'outflow' },
        input.lines[1]!,
      ],
    }),
  ).rejects.toThrow(/方向/);
  const [historical] = await seedVouchers(book.svc, [{ ...base, status: 'posted' }]);
  const summary = await book.svc.ledger.cashflow({ periodFrom: 202601, periodTo: 202601 });
  expect(summary).toMatchObject({ cashNet: 123, unallocatedNet: 123, unallocatedCount: 1 });
  expect(summary.rows[0]).toMatchObject({ voucherId: historical!.id, cashflowDirection: null });
});

it('w_xt_tz/w_pz_tjdel：账套策略跨模块共用；手工正整数唯一，混合制单人整批不变', async () => {
  book = await createTestBook();
  await book.svc.voucherPolicy.set({
    numbering: 'manual',
    renumberAfterDelete: false,
    allowModifyOthers: false,
  });
  const input = await voucherInputFromSpec(book.svc, base);
  await expect(book.svc.vouchers.create(input)).rejects.toThrow(/手工编号/);
  const first = await book.svc.vouchers.create({ ...input, number: 7 });
  await expect(book.svc.vouchers.create({ ...input, number: 7 })).rejects.toThrow(/编号为 7/);
  const clerk = await book.addUser('other');
  const second = await clerk.vouchers.create({ ...input, number: 8 });
  await expect(
    book.svc.vouchers.setNumbers([
      { id: first.id, number: 1 },
      { id: second.id, number: 2 },
    ]),
  ).rejects.toThrow(/其他操作员/);
  expect((await book.svc.vouchers.get(first.id))!.number).toBe(7);
  expect((await book.svc.vouchers.get(second.id))!.number).toBe(8);
  expect(await book.forModule('cashier').voucherPolicy.get()).toEqual(
    await book.svc.voucherPolicy.get(),
  );
});

it('w_pz_bhzl/w_pz_tjdel：重排预览过期及取消零写入，确认删除与重排同事务', async () => {
  book = await createTestBook();
  const values = await seedVouchers(book.svc, [base, base, base]);
  await book.svc.voucherPolicy.set({
    numbering: 'automatic',
    renumberAfterDelete: true,
    allowModifyOthers: true,
  });
  const plan = await book.svc.vouchers.previewDelete([values[1]!.id]);
  expect(plan.impacts).toEqual([
    { id: values[0]!.id, oldNumber: 1, number: 1 },
    { id: values[2]!.id, oldNumber: 3, number: 2 },
  ]);
  await expect(book.svc.vouchers.deleteBatch(plan, false)).rejects.toThrow(/确认/);
  expect((await book.svc.vouchers.list()).total).toBe(3);
  await book.svc.vouchers.deleteBatch(plan, true);
  expect((await book.svc.vouchers.list()).items.map((v) => v.number)).toEqual([1, 2]);
  await expect(book.svc.vouchers.deleteBatch(plan, true)).rejects.toThrow();
});

it('w_pz_pzedit：并发自动编号唯一；晚阶段日志失败不耗号、不留半张', async () => {
  book = await createTestBook();
  const input = await voucherInputFromSpec(book.svc, base);
  const values = await Promise.all(
    Array.from({ length: 8 }, () => book.svc.vouchers.create(input)),
  );
  expect(values.map((v) => v.number).sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  book.book.raw.exec(
    "CREATE TRIGGER fail_log BEFORE INSERT ON operation_log WHEN NEW.action='voucher.create' BEGIN SELECT RAISE(ABORT,'日志失败'); END",
  );
  await expect(book.svc.vouchers.create(input)).rejects.toThrow(/日志失败/);
  expect((await book.svc.vouchers.list()).total).toBe(8);
  book.book.raw.exec('DROP TRIGGER fail_log');
  expect((await book.svc.vouchers.create(input)).number).toBe(9);
});

it('w_xt_bmwh/w_gz_bmwh/w_zc_sydw：下级、期初、凭证和已登记模块引用均阻止删除', async () => {
  book = await createTestBook({
    providers: {
      dimensionReferences: [
        async (_ctx, id) => [
          { category: '工资人员', count: id === 1 ? 2 : 0, to: '/m/payroll/employees' },
        ],
      ],
    },
  });
  const dept = (await book.svc.dimensions.getByCode('department', '01'))!;
  const child = await book.svc.dimensions.create({
    type: 'department',
    code: '0101',
    name: '下级',
    parentId: dept.id,
  });
  const plan = await book.svc.dimensions.previewDelete(dept.id);
  expect(plan.references.some((r) => r.category === '下级档案')).toBe(true);
  await expect(book.svc.dimensions.delete(plan, true)).rejects.toThrow(/下级档案/);
  await expect(
    book.svc.dimensions.update(
      dept.id,
      { code: dept.code, name: dept.name, parentId: child.id },
      { expectedRevision: dept.revision! },
    ),
  ).rejects.toThrow(/自身或下级/);
  const childPlan = await book.svc.dimensions.previewDelete(child.id);
  await expect(book.svc.dimensions.delete(childPlan, false)).rejects.toThrow(/确认/);
  await book.svc.dimensions.delete(childPlan, true);
  expect((await book.svc.dimensions.get(dept.id))!.isLeaf).toBe(true);
  const disabled = await book.svc.dimensions.setDisabled(dept.id, true, {
    expectedRevision: dept.revision!,
  });
  const input = await voucherInputFromSpec(book.svc, {
    date: '2026-01-10',
    lines: [
      { account: '6602', debit: 123, dims: { department: '01' } },
      { account: '1001', credit: 123 },
    ],
  });
  await expect(book.svc.vouchers.create(input)).rejects.toThrow(/已停用/);
  expect(disabled.id).toBe(dept.id);
});

it('w_zw_jz/w_zw_fz/w_xt_ye：启用边界、年结、期初锁及旧新期间在写事务内复核', async () => {
  book = await createTestBook();
  await book.svc.periods.assertWritable({ period: 202601 });
  await book.forModule('opening').settings.set('lock.2026', true);
  await expect(
    book.svc.periods.assertWritable({ period: 202601, mode: 'opening' }),
  ).rejects.toThrow(/期初已锁定/);
  await book.svc.periods.setStatus(202601, 'closed');
  await expect(
    book.svc.periods.assertWritable({ period: 202602, oldPeriod: 202601 }),
  ).rejects.toThrow(/2026年1月|2026 年 1 月|已经结账/);
  await book.svc.db
    .updateTable('fiscal_year')
    .set({ status: 'closed' })
    .where('year', '=', 2026)
    .execute();
  await expect(book.svc.periods.assertOpen(202602)).rejects.toThrow(/年结/);
  await book.svc.periods.assertWritable({ period: 202612, mode: 'year-reopen' });
});

it('w_xt_kgzb：4-2-2与4-3-3确定性建账，备抵/余额性质和来源版本持久化', async () => {
  book = await createTestBook({ codeScheme: '4-3-3' });
  const child = await book.svc.accounts.require('2221001001');
  expect(child.fullName).toContain('应交增值税/进项税额');
  expect((await book.svc.accounts.require('2221001')).id).toBe(child.parentId);
  const created = await book.svc.accounts.create(
    {
      code: '1609',
      name: '备抵试验',
      categoryId: 'asset',
      direction: 'credit',
      isContra: true,
      balanceNature: 'both',
      source: '合成来源',
      sourceVersion: 'v2',
    },
    parseCodeScheme('4-3-3'),
  );
  expect(await book.svc.accounts.get(created.id)).toMatchObject({
    isContra: true,
    balanceNature: 'both',
    source: '合成来源',
    sourceVersion: 'v2',
  });
  const source = createCoreServices(book.svc.ctx);
  expect(await source.accounts.get(child.id)).toMatchObject({ sourceVersion: '1' });
});

it('w_bb_proc：排除损益结转仅影响发生额，余额保留完整结转；辅助借贷余额分别汇总', async () => {
  book = await createTestBook();
  await seedVouchers(book.svc, [{ ...base, status: 'posted' }]);
  const input = await voucherInputFromSpec(book.svc, {
    date: '2026-01-31',
    lines: [
      { account: '6001', debit: 123 },
      { account: '4103', credit: 123 },
    ],
  });
  const closing = await book
    .forModule('period-close')
    .vouchers.create({ ...input, closingKind: 'pnl' });
  await book.svc.vouchers.changeStatus({ ids: [closing.id], to: 'audited' });
  await book.svc.vouchers.changeStatus({ ids: [closing.id], to: 'posted' });
  const rows = await book.svc.ledger.balances({
    periodFrom: 202601,
    periodTo: 202601,
    excludeClosingKinds: ['pnl'],
    includeZero: true,
  });
  expect(rows.find((r) => r.accountCode === '6001')).toMatchObject({
    debit: 0,
    credit: 123,
    closing: 0,
  });
  const sides = await book.svc.ledger.balanceSides({ periodFrom: 202601, periodTo: 202601 });
  expect(sides.find((r) => r.accountCode === '1001')).toMatchObject({
    closingDebit: 123,
    closingCredit: 0,
  });
});
