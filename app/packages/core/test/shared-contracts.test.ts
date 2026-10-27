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
  expect(await book.svc.accounts.provenance(created.id)).toMatchObject({
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

it('w_pz_pzedit/w_pz_bhzl：自动显式号只接受当前预测号；重排取消/过期/日志失败均不写', async () => {
  book = await createTestBook();
  const input = await voucherInputFromSpec(book.svc, base);
  await expect(book.svc.vouchers.create({ ...input, number: 7 })).rejects.toThrow(/自动编号/);
  const first = await book.svc.vouchers.create({ ...input, number: 1 });
  expect(first.number).toBe(1);
  const second = await book.svc.vouchers.create(input);
  expect(second.number).toBe(2);
  await expect(
    book.svc.vouchers.update(
      first.id,
      { ...input, number: 7 },
      { expectedRevision: first.revision },
    ),
  ).rejects.toThrow(/自动编号/);
  await expect(
    book.svc.vouchers.update(
      first.id,
      { ...input, number: 3 },
      { expectedRevision: first.revision },
    ),
  ).rejects.toThrow(/普通保存不能改号/);
  expect((await book.svc.vouchers.get(first.id))!.number).toBe(1);
  const updates = [
    { id: first.id, number: 2 },
    { id: second.id, number: 1 },
  ];
  const plan = await book.svc.vouchers.previewNumbers(updates);
  await expect(book.svc.vouchers.setNumbers(updates)).rejects.toThrow(/确认/);
  await expect(book.svc.vouchers.setNumbers(updates, { plan, confirmed: false })).rejects.toThrow(
    /确认/,
  );
  await expect(
    book.svc.vouchers.setNumbers(updates, { plan: { ...plan, expiresAt: 0 }, confirmed: true }),
  ).rejects.toThrow(/重新预览/);
  book.book.raw.exec(
    "CREATE TRIGGER fail_renumber_log BEFORE INSERT ON operation_log WHEN NEW.action='voucher.renumber' BEGIN SELECT RAISE(ABORT,'重排日志失败'); END",
  );
  await expect(book.svc.vouchers.setNumbers(updates, { plan, confirmed: true })).rejects.toThrow(
    /重排日志失败/,
  );
  expect((await book.svc.vouchers.get(first.id))!.number).toBe(1);
  expect((await book.svc.vouchers.get(second.id))!.number).toBe(2);
  book.book.raw.exec('DROP TRIGGER fail_renumber_log');
  await book.svc.vouchers.setNumbers(updates, { plan, confirmed: true });
  expect((await book.svc.vouchers.get(first.id))!.number).toBe(2);
  expect((await book.svc.vouchers.get(second.id))!.number).toBe(1);
});

it('w_zc_zc/w_xjll：比较期间同快照取数，现金流缺期间和启用前不可补零', async () => {
  book = await createTestBook();
  await seedVouchers(book.svc, [{ ...base, status: 'posted' }]);
  const compared = await book.svc.ledger.compare({
    current: { periodFrom: 202601, periodTo: 202601, accountCodes: ['1001'] },
    comparison: { periodFrom: 202602, periodTo: 202602, accountCodes: ['1001'] },
  });
  expect(compared.current[0]).toMatchObject({ debit: 123, closing: 123 });
  expect(compared.comparison[0]).toMatchObject({ opening: 123, debit: 0, closing: 123 });
  await expect(book.svc.ledger.cashflow({ periodFrom: 202512, periodTo: 202601 })).rejects.toThrow(
    /早于启用/,
  );
  await book.svc.db.deleteFrom('period').where('period', '=', 202602).execute();
  await expect(
    book.svc.ledger.cashflow({ periodFrom: 202601, periodTo: 202602 }),
  ).rejects.toMatchObject({
    data: { code: 'LEDGER_PERIOD_MISSING', details: { missingPeriods: [202602] } },
  });
  await expect(
    book.svc.ledger.compare({
      current: { periodFrom: 202601, periodTo: 202601 },
      comparison: { periodFrom: 202602, periodTo: 202602 },
    }),
  ).rejects.toThrow(/2026年02月/);
});

it('w_pz_pzedit/w_xjll：非现金科目不能替内部转移凑平；不同单位数量不混加', async () => {
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
      lines: input.lines.map((line) => ({
        ...line,
        dimensions: { cashflow: cf.id },
        cashflowDirection: 'internal',
      })),
    }),
  ).rejects.toThrow(/非现金银行科目/);
  const scheme = parseCodeScheme('4-2-2');
  const kg = await book.svc.accounts.create(
    { code: '140301', name: '千克产品', quantityUnit: '千克' },
    scheme,
  );
  const box = await book.svc.accounts.create(
    { code: '140302', name: '箱产品', quantityUnit: '箱' },
    scheme,
  );
  const v = await book.svc.vouchers.create({
    voucherTypeId: input.voucherTypeId,
    date: '2026-01-10',
    lines: [
      {
        summary: '千克调增',
        accountId: kg.id,
        debit: 0,
        credit: 0,
        entrySide: 'debit',
        quantity: '2',
      },
      {
        summary: '箱数调减',
        accountId: box.id,
        debit: 0,
        credit: 0,
        entrySide: 'credit',
        quantity: '3',
      },
    ],
  });
  await book.svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
  await book.svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
  await expect(
    book.svc.ledger.balances({ periodFrom: 202601, periodTo: 202601, accountCodes: ['1403'] }),
  ).rejects.toThrow(/不能混加数量/);
  const byKg = await book.svc.ledger.quantityBalances({
    periodFrom: 202601,
    periodTo: 202601,
    accountCodes: ['1403'],
    quantityUnit: '千克',
  });
  const byBox = await book.svc.ledger.quantityBalances({
    periodFrom: 202601,
    periodTo: 202601,
    accountCodes: ['1403'],
    quantityUnit: '箱',
  });
  expect(byKg.find((row) => row.accountCode === '1403')).toMatchObject({
    quantityUnit: '千克',
    qtyClosing: '2',
  });
  expect(byBox.find((row) => row.accountCode === '1403')).toMatchObject({
    quantityUnit: '箱',
    qtyClosing: '-3',
  });
});

it('w_pz_bhzl/w_pz_tjdel/w_gz_bmwh：确认计划绑定运行实例、账套及期限，客户端不能改期续用', async () => {
  book = await createTestBook();
  const [a, b] = await seedVouchers(book.svc, [base, base]);
  const updates = [
    { id: a!.id, number: 2 },
    { id: b!.id, number: 1 },
  ];
  const numbers = await book.svc.vouchers.previewNumbers(updates);
  const otherRuntime = createCoreServices({ ...book.svc.ctx, providers: {} });
  await expect(
    otherRuntime.vouchers.setNumbers(updates, { plan: numbers, confirmed: true }),
  ).rejects.toThrow(/重新预览/);
  await expect(
    book.svc.vouchers.setNumbers(updates, {
      plan: { ...numbers, expiresAt: numbers.expiresAt - 1 },
      confirmed: true,
    }),
  ).rejects.toThrow(/重新预览/);
  const deletion = await book.svc.vouchers.previewDelete([a!.id]);
  await expect(
    book.svc.vouchers.deleteBatch({ ...deletion, expiresAt: deletion.expiresAt - 1 }, true),
  ).rejects.toThrow(/重新预览/);
  await expect(otherRuntime.vouchers.deleteBatch(deletion, true)).rejects.toThrow(/重新预览/);
  const department = await book.svc.dimensions.create({
    type: 'department',
    code: '99',
    name: '待删部门',
  });
  const plan = await book.svc.dimensions.previewDelete(department.id);
  await expect(otherRuntime.dimensions.delete(plan, true)).rejects.toThrow(/重新预览/);
  await expect(
    book.svc.dimensions.delete({ ...plan, expiresAt: plan.expiresAt - 1 }, true),
  ).rejects.toThrow(/重新预览/);
  expect((await book.svc.vouchers.get(a!.id))!.number).toBe(1);
  expect((await book.svc.vouchers.get(b!.id))!.number).toBe(2);
  expect(await book.svc.dimensions.get(department.id)).toBeTruthy();
  await book.svc.dimensions.delete(plan, true);
  expect(await book.svc.dimensions.get(department.id)).toBeNull();
});

it('w_pz_pzedit：零本币非零数量按最终六位存储值校验，舍入到零不得正式保存或转正式', async () => {
  book = await createTestBook();
  const accountId = (await book.svc.accounts.require('1403')).id;
  const input = {
    voucherTypeId: (await book.svc.reference.voucherTypes())[0]!.id,
    date: '2026-01-10',
    lines: [
      {
        accountId,
        summary: '借方数量',
        debit: 0,
        credit: 0,
        entrySide: 'debit' as const,
        quantity: '0.0000001',
      },
      {
        accountId,
        summary: '贷方数量',
        debit: 0,
        credit: 0,
        entrySide: 'credit' as const,
        quantity: '1',
      },
    ],
  };
  for (const quantity of ['0.0000001', '-0.0000001', '0.00000049', '-0.00000049']) {
    input.lines[0]!.quantity = quantity;
    await expect(book.svc.vouchers.create(input)).rejects.toThrow(/本币、外币和数量均为 0/);
  }
  const draft = await book.svc.vouchers.create({ ...input, draft: true });
  await expect(
    book.svc.vouchers.update(draft.id, input, { expectedRevision: draft.revision }),
  ).rejects.toThrow(/本币、外币和数量均为 0/);
  expect((await book.svc.vouchers.get(draft.id))!.status).toBe('draft');
  expect((await book.svc.vouchers.list()).total).toBe(1);
  for (const quantity of ['0.0000005', '-0.0000005', '0.000001', '-0.000001']) {
    input.lines[0]!.quantity = quantity;
    const v = await book.svc.vouchers.create(input);
    expect(v.lines[0]!.quantity).toBe(quantity.startsWith('-') ? '-0.000001' : '0.000001');
    expect(
      book.book.raw
        .prepare('SELECT quantity_e6 FROM voucher_line WHERE voucher_id=? AND line_no=1')
        .get(v.id),
    ).toEqual({ quantity_e6: quantity.startsWith('-') ? -1 : 1 });
  }
});

it('w_pzedit_fc：零本币原币/数量冲销必须保留借贷侧并反号，过账后原币和数量净额归零', async () => {
  book = await createTestBook();
  const original = await book.svc.vouchers.create({
    voucherTypeId: 1,
    date: '2026-01-10',
    lines: [
      {
        summary: '原币调整',
        accountId: (await book.svc.accounts.require('100202')).id,
        debit: 0,
        credit: 0,
        currency: 'USD',
        exchangeRate: '7.1',
        fcAmount: 100,
        entrySide: 'debit',
      },
      {
        summary: '数量调整',
        accountId: (await book.svc.accounts.require('1403')).id,
        debit: 0,
        credit: 0,
        quantity: '2',
        entrySide: 'credit',
      },
    ],
  });
  await book.svc.vouchers.changeStatus({ ids: [original.id], to: 'audited' });
  await book.svc.vouchers.changeStatus({ ids: [original.id], to: 'posted' });
  const reversed = {
    voucherTypeId: 1,
    date: '2026-01-11',
    reversalOfId: original.id,
    lines: original.lines.map((line) => ({
      ...line,
      debit: -line.debit,
      credit: -line.credit,
      fcAmount: line.fcAmount == null ? null : -line.fcAmount,
      quantity: line.quantity == null ? null : String(-Number(line.quantity)),
    })),
  };
  for (const index of [0, 1]) {
    const tampered = structuredClone(reversed);
    tampered.lines[index]!.entrySide =
      tampered.lines[index]!.entrySide === 'debit' ? 'credit' : 'debit';
    await expect(book.svc.vouchers.create(tampered)).rejects.toThrow(/借贷方向/);
  }
  expect((await book.svc.vouchers.list()).total).toBe(1);
  const reversal = await book.svc.vouchers.create(reversed);
  await book.svc.vouchers.changeStatus({ ids: [reversal.id], to: 'audited' });
  await book.svc.vouchers.changeStatus({ ids: [reversal.id], to: 'posted' });
  const query = { periodFrom: 202601, periodTo: 202601, includeZero: true, rollup: false };
  expect(
    (await book.svc.ledger.balances({ ...query, currency: 'USD', accountCodes: ['100202'] }))[0],
  ).toMatchObject({ fcClosing: 0, fcDebit: 0, fcCredit: 0 });
  expect(
    (
      await book.svc.ledger.quantityBalances({
        ...query,
        quantityUnit: '千克',
        accountCodes: ['1403'],
      })
    )[0],
  ).toMatchObject({ qtyClosing: '0', qtyDebit: '0', qtyCredit: '0' });
});

it('w_pzedit_fc：历史NULL借贷侧以原本币栏合法回退，冲销不丢原币或数量', async () => {
  book = await createTestBook();
  const original = await book.svc.vouchers.create({
    voucherTypeId: 1,
    date: '2026-01-10',
    lines: [
      {
        summary: '旧数量',
        accountId: (await book.svc.accounts.require('1403')).id,
        debit: 100,
        credit: 0,
        quantity: '2',
      },
      {
        summary: '旧外币',
        accountId: (await book.svc.accounts.require('100202')).id,
        debit: 0,
        credit: 100,
        currency: 'USD',
        exchangeRate: '10',
        fcAmount: 10,
      },
    ],
  });
  book.book.raw
    .prepare('UPDATE voucher_line SET entry_side=NULL WHERE voucher_id=?')
    .run(original.id);
  const history = (await book.svc.vouchers.get(original.id))!;
  expect(history.lines.every((line) => line.entrySide === null)).toBe(true);
  const reversal = await book.svc.vouchers.create({
    voucherTypeId: 1,
    date: '2026-01-11',
    reversalOfId: original.id,
    lines: history.lines.map((line) => ({
      ...line,
      debit: -line.debit,
      credit: -line.credit,
      fcAmount: line.fcAmount == null ? null : -line.fcAmount,
      quantity: line.quantity == null ? null : String(-Number(line.quantity)),
    })),
  });
  for (const id of [original.id, reversal.id]) {
    await book.svc.vouchers.changeStatus({ ids: [id], to: 'audited' });
    await book.svc.vouchers.changeStatus({ ids: [id], to: 'posted' });
  }
  const query = { periodFrom: 202601, periodTo: 202601, includeZero: true, rollup: false };
  expect(
    (await book.svc.ledger.balances({ ...query, currency: 'USD', accountCodes: ['100202'] }))[0]!
      .fcClosing,
  ).toBe(0);
  expect(
    (
      await book.svc.ledger.quantityBalances({
        ...query,
        quantityUnit: '千克',
        accountCodes: ['1403'],
      })
    )[0]!.qtyClosing,
  ).toBe('0');
});

it('w_xt_xjwh：科目/ID/币种/辅助过滤只影响局部流量，内部转移是否配平按完整凭证同快照诊断', async () => {
  book = await createTestBook();
  const cf = (await book.svc.dimensions.getByCode('cashflow', 'CF01'))!;
  await book.svc.dimensions.update(
    cf.id,
    { code: cf.code, name: cf.name, attrs: { cashflowDirection: 'internal' } },
    { expectedRevision: cf.revision! },
  );
  const a = await book.svc.accounts.create(
    {
      code: '1003',
      name: '内部转出',
      categoryId: 'asset',
      isCash: true,
      currency: 'USD',
      cashflowRequired: true,
      dimensions: [{ type: 'project', required: false }],
    },
    [4, 2, 2],
  );
  const b = await book.svc.accounts.create(
    { code: '1004', name: '内部转入', categoryId: 'asset', isBank: true, cashflowRequired: true },
    [4, 2, 2],
  );
  const project = (await book.svc.dimensions.getByCode('project', 'XM01'))!.id;
  const v = await book.svc.vouchers.create({
    voucherTypeId: 1,
    date: '2026-01-10',
    lines: [
      {
        summary: '内部借',
        accountId: a.id,
        debit: 100,
        credit: 0,
        currency: 'USD',
        exchangeRate: '10',
        fcAmount: 10,
        dimensions: { cashflow: cf.id, project },
        cashflowDirection: 'internal',
      },
      {
        summary: '内部贷',
        accountId: b.id,
        debit: 0,
        credit: 100,
        dimensions: { cashflow: cf.id },
        cashflowDirection: 'internal',
      },
    ],
  });
  await book.svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
  await book.svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
  const query = { periodFrom: 202601, periodTo: 202601 };
  for (const filter of [
    { accountCode: '1003' },
    { accountIds: [a.id] },
    { currency: 'USD' },
    { dimensions: { project } },
  ]) {
    const filtered = await book.svc.ledger.cashflow({ ...query, ...filter });
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.internalNet).toBe(100);
    expect(filtered.internalUnbalancedVouchers).toEqual([]);
  }
  expect((await book.svc.ledger.cashflow(query)).internalNet).toBe(0);
  // A historical corrupt direction must still be reported under the same filter.
  book.book.raw
    .prepare('UPDATE voucher_line SET cashflow_direction=NULL WHERE voucher_id=? AND account_id=?')
    .run(v.id, b.id);
  expect(
    (await book.svc.ledger.cashflow({ ...query, accountIds: [a.id] })).internalUnbalancedVouchers,
  ).toEqual([v.id]);
});

it('w_pz_tjdel：删除最高待审核号或无号草稿不触碰前方已过账来源，需移动的审核/来源行仍阻止', async () => {
  book = await createTestBook();
  const input = await voucherInputFromSpec(book.svc, base);
  const owner = book.forModule('cashier');
  const source = await owner.vouchers.create({
    ...input,
    source: { type: 'document', id: 'protected-before' },
  });
  await owner.vouchers.changeStatus({ ids: [source.id], to: 'audited' });
  await owner.vouchers.changeStatus({ ids: [source.id], to: 'posted' });
  const pending = await book.svc.vouchers.create(input);
  const draft = await book.svc.vouchers.create({ ...input, draft: true });
  await book.svc.voucherPolicy.set({
    numbering: 'automatic',
    renumberAfterDelete: true,
    allowModifyOthers: true,
  });
  const before = await book.svc.vouchers.get(source.id);
  const plan = await book.svc.vouchers.previewDelete([pending.id]);
  expect(plan.impacts).toEqual([{ id: source.id, oldNumber: 1, number: 1 }]);
  await book.svc.vouchers.deleteBatch(plan, true);
  expect(await book.svc.vouchers.get(source.id)).toEqual(before);
  const draftPlan = await book.svc.vouchers.previewDelete([draft.id]);
  expect(draftPlan.impacts).toEqual([]);
  await book.svc.vouchers.deleteBatch(draftPlan, true);
  const middle = await book.svc.vouchers.create(input);
  const locked = await book.svc.vouchers.create(input);
  await book.svc.vouchers.changeStatus({ ids: [locked.id], to: 'audited' });
  await expect(book.svc.vouchers.previewDelete([middle.id])).rejects.toThrow(/已审核或过账/);
  await book.svc.vouchers.changeStatus({ ids: [locked.id], to: 'pending' });
  await book.svc.vouchers.deleteBatch(await book.svc.vouchers.previewDelete([locked.id]), true);
  await owner.vouchers.create({ ...input, source: { type: 'document', id: 'protected-after' } });
  await expect(book.svc.vouchers.previewDelete([middle.id])).rejects.toThrow(/不能在这里/);
  expect(await book.svc.vouchers.get(source.id)).toEqual(before);
  expect(await book.svc.vouchers.get(middle.id)).toBeTruthy();
});

it('w_xt_kgzb：非法级次返回可操作业务原因、不留下账套；修复后相同请求可成功建账', async () => {
  book = await createTestBook();
  const before = await book.store.list();
  const input = {
    name: '级次失败重试',
    orgName: '合成单位',
    templateId: 'demo-enterprise',
    product: 'chengben' as const,
    startYear: 2026,
    startMonth: 1,
    adminPassword: 'admin',
    requestKey: 'scheme-failure-retry',
  };
  await expect(book.store.create({ ...input, codeScheme: '3-2-2' })).rejects.toMatchObject({
    data: { code: 'TEMPLATE_SCHEME', message: expect.stringContaining('不能使用科目级次') },
  });
  expect(await book.store.list()).toEqual(before);
  const created = await book.store.create({ ...input, codeScheme: '4-3-3' });
  expect((await book.store.list()).filter((b) => b.id === created.id)).toHaveLength(1);
  expect(
    book.store
      .open(created.id)
      .raw.prepare("SELECT count(*) AS n FROM account WHERE code='2221001001'")
      .get(),
  ).toEqual({ n: 1 });
});
