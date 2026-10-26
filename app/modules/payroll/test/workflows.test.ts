import { beforeEach, afterEach, expect, it } from 'vitest';
import fc from 'fast-check';
import { sql } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import payroll from '../server';
import {
  DEFAULT_FIELDS,
  TaxInputSchema,
  type Category,
  type Employee,
  type RowInput,
} from '../shared';
import { decomposeCash } from '../server/reports';
let app: TestApp;
const call = (a: TestApp) => a.call(payroll);
let api: ReturnType<typeof call>;
let category: Category, employees: Employee[];
const salary = (id: number, amount = 1000000): RowInput => ({
  employeeId: id,
  values: { base: amount },
  tax: TaxInputSchema.parse({ confirmed: true }),
});
async function make(period = 202601) {
  return api.saveBatch({
    period,
    categoryId: category.id,
    categoryRevision: category.revision,
    rows: employees.map((e) => salary(e.id)),
  });
}
async function calc(period = 202601) {
  const b = await make(period);
  return api.calculate({ id: b.id, revision: b.revision });
}
beforeEach(async () => {
  app = await createTestApp({ modules: [payroll], product: 'minfei' });
  api = call(app);
  await api.confirmTax();
  category = await api.saveCategory({ name: '合成工资', fields: DEFAULT_FIELDS });
  employees = [];
  for (let i = 1; i <= 3; i++)
    employees.push(
      await api.saveEmployee({
        code: `T00${i}`,
        name: `合成人员${i}`,
        startDate: '2026-01-01',
        departmentId: (await app.svc.dimensions.getByCode('department', i === 3 ? '02' : '01'))!.id,
      }),
    );
});
afterEach(() => app.close());
it('w_gz_edit_set 预览已选范围、取消、空值设零保留已有值、过期预览和来源锁', async () => {
  let b = await calc();
  const input = {
    id: b.id,
    revision: b.revision,
    employeeIds: [employees[0]!.id],
    field: 'bonus',
    value: 10000,
    onlyEmpty: false,
  };
  let p = await api.previewBulk(input);
  expect(p.preview).toHaveLength(1);
  expect(p.preview[0]).toMatchObject({ code: 'T001', before: null, after: 10000 });
  await expect(api.applyBulk({ ...input, hash: p.hash, confirmed: false })).rejects.toThrow(
    '须确认',
  );
  expect(await api.batch({ id: b.id })).toEqual(b);
  await expect(api.previewBulk({ ...input, employeeIds: [] })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  await expect(api.previewBulk({ ...input, employeeIds: [999] })).rejects.toThrow('其他批次');
  await expect(
    api.previewBulk({ ...input, employeeIds: [employees[0]!.id, employees[0]!.id] }),
  ).rejects.toThrow('重复人员');
  await expect(api.previewBulk({ ...input, field: 'unknown' })).rejects.toThrow('金额录入');
  await expect(api.applyBulk({ ...input, hash: 'stale', confirmed: true })).rejects.toThrow(
    '预览已失效',
  );
  b = await api.applyBulk({ ...input, hash: p.hash, confirmed: true });
  expect(b.calculated).toBe(false);
  expect(b.previous.map((r) => r.gross)).toEqual([1000000, 1000000, 1000000]);
  expect(b.rows.map((r) => r.values.bonus)).toEqual([10000, undefined, undefined]);
  const zero = {
    ...input,
    revision: b.revision,
    employeeIds: employees.map((e) => e.id),
    value: 0,
    onlyEmpty: true,
  };
  p = await api.previewBulk(zero);
  expect(p.preview.map((r) => r.after)).toEqual([10000, 0, 0]);
  b = await api.applyBulk({ ...zero, hash: p.hash, confirmed: true });
  expect(b.rows.map((r) => r.values.bonus)).toEqual([10000, 0, 0]);
  await expect(api.applyBulk({ ...zero, hash: p.hash, confirmed: true })).rejects.toThrow(
    '其他操作修改',
  );
});
it('w_gz_edit_set Excel粘贴按编号/稳定变量，未知栏目/范围/重号/空内容拒绝，取消与事务失败不改工资', async () => {
  let b = await calc();
  const input: {
    id: number;
    revision: number;
    rows: { code: string; values: Record<string, number> }[];
  } = {
    id: b.id,
    revision: b.revision,
    rows: [
      { code: 'T001', values: { bonus: 12000 } },
      { code: 'T002', values: { base: 2000000 } },
    ],
  };
  const p = await api.previewPaste(input);
  expect(p.preview.map((r) => r.code)).toEqual(['T001', 'T002']);
  await expect(api.applyPaste({ ...input, hash: p.hash, confirmed: false })).rejects.toThrow(
    '须确认',
  );
  await expect(
    api.previewPaste({ ...input, rows: [input.rows[0]!, input.rows[0]!] }),
  ).rejects.toThrow('重复');
  await expect(
    api.previewPaste({ ...input, rows: [{ code: 'missing', values: { base: 0 } }] }),
  ).rejects.toThrow('不在本批次');
  await expect(
    api.previewPaste({ ...input, rows: [{ code: 'T001', values: { unknown_column: 0 } }] }),
  ).rejects.toThrow('不是启用');
  await expect(
    api.previewPaste({ ...input, rows: [{ code: 'T001', values: {} }] }),
  ).rejects.toThrow('没有可粘贴');
  await expect(api.applyPaste({ ...input, hash: 'wrong', confirmed: true })).rejects.toThrow(
    '预览已失效',
  );
  await sql`CREATE TRIGGER payroll_paste_failure BEFORE INSERT ON payroll_row WHEN NEW.employee_id=2 BEGIN SELECT RAISE(ABORT,'synthetic paste failure'); END`.execute(
    app.svc.db,
  );
  await expect(api.applyPaste({ ...input, hash: p.hash, confirmed: true })).rejects.toThrow(
    'synthetic paste failure',
  );
  expect(await api.batch({ id: b.id })).toEqual(b);
  await sql`DROP TRIGGER payroll_paste_failure`.execute(app.svc.db);
  b = await api.applyPaste({ ...input, hash: p.hash, confirmed: true });
  expect(b.rows[0]!.values.bonus).toBe(12000);
  expect(b.rows[2]!.values).toEqual({ base: 1000000 });
  expect(b.calculated).toBe(false);
});
it('w_gz_prt_gzb/prt_hzlm/gzgl_lshz 工资表、部门/栏目和累计汇总取快照，空选/未知栏/期间错误拒绝', async () => {
  await calc();
  await calc(202602);
  await api.saveEmployee({
    ...employees[0]!,
    name: '修改后的合成姓名',
    departmentId: employees[2]!.departmentId,
  });
  const input = {
    categoryId: category.id,
    from: 202601,
    to: 202602,
    employeeIds: employees.map((e) => e.id),
    columns: ['gross', 'taxAmount', 'net', 'base'],
    kind: 'cumulative' as const,
  };
  const report = await api.report(input);
  expect(report.rows).toHaveLength(3);
  expect(report.rows[0]!.label).toContain('合成人员1');
  expect(report.rows[0]!.values).toEqual({
    gross: 2000000,
    taxAmount: 30000,
    net: 1970000,
    base: 2000000,
  });
  const dept = await api.report({ ...input, kind: 'department' });
  expect(dept.rows).toHaveLength(2);
  expect(dept.rows[0]!.values.gross).toBe(4000000);
  const table = await api.report({
    ...input,
    kind: 'table',
    departmentId: employees[2]!.departmentId,
  });
  expect(table.rows).toHaveLength(2);
  expect(table.rows[0]!.label).toContain('T003');
  await expect(api.report({ ...input, employeeIds: [] })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  await expect(api.report({ ...input, employeeIds: [999] })).rejects.toThrow('没有选中');
  await expect(api.report({ ...input, columns: ['__sql'] })).rejects.toThrow('未知汇总');
  await expect(api.report({ ...input, columns: ['gross', 'gross'] })).rejects.toThrow(
    '汇总栏目重复',
  );
  await expect(api.report({ ...input, employeeIds: [employees[0]!.id, 999] })).rejects.toThrow(
    '未知人员',
  );
  await expect(api.report({ ...input, from: 202603 })).rejects.toThrow('结束期间');
  const hr = app.call(
    payroll,
    await app.addUser('report-hr', { permissions: ['payroll.hr.view'] }),
  );
  await expect(hr.report(input)).rejects.toThrow('权限');
});
it('w_gz_prt_pm 票面数量×面额+余款=实发，逐人分解汇总；负实发阻止，fast-check整数不变量', async () => {
  const b = await calc();
  const input = {
    categoryId: category.id,
    from: 202601,
    to: 202601,
    employeeIds: employees.map((e) => e.id),
    columns: ['net'],
    kind: 'cash' as const,
    denominations: [10000, 5000, 1000],
  };
  await expect(api.report({ ...input, columns: ['gross'] })).rejects.toThrow('必须选择实发');
  expect(() => decomposeCash(10, [1.5])).toThrow('正整数分');
  const p = await api.report(input);
  for (const r of p.rows)
    expect(r.notes.reduce((sum, n) => sum + n.unit * n.count, r.remainder)).toBe(r.values.net);
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 100000000 }), (net) => {
      const d = decomposeCash(net, [10000, 5000, 2000, 500, 100]);
      expect(d.notes.reduce((sum, n) => sum + n.unit * n.count, d.remainder)).toBe(net);
      expect(d.notes.every((n) => Number.isInteger(n.count) && n.count >= 0)).toBe(true);
      expect(d.remainder).toBeLessThan(100);
    }),
  );
  const rows = b.rows.map((r, i) =>
    i === 0 ? { ...r, values: { base: 100, deduction: 101 } } : r,
  );
  const negative = await api.saveBatch({ ...b, categoryRevision: category.revision, rows });
  await api.calculate({ id: negative.id, revision: negative.revision });
  await expect(api.report(input)).rejects.toThrow('负实发');
  await expect(api.report({ ...input, denominations: [0] })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
});
it('w_gz_prt_pm 所选工资栏目和面额逐人逐期分解，累计保留余款，查询/导出一致且不改工资', async () => {
  for (const period of [202601, 202602]) {
    const b = await api.saveBatch({
      period,
      categoryId: category.id,
      categoryRevision: category.revision,
      rows: employees.map((e, i) => ({
        ...salary(e.id, 6001),
        values: { base: 6001, bonus: 100 + i },
      })),
    });
    await api.calculate({ id: b.id, revision: b.revision });
  }
  const before = await api.batches({});
  const input = {
    categoryId: category.id,
    from: 202601,
    to: 202602,
    employeeIds: [employees[0]!.id, employees[1]!.id],
    columns: ['base', 'net'],
    kind: 'cash' as const,
    cashField: 'base',
    denominations: [10000],
  };
  const report = await api.report(input);
  expect(report.cashColumn).toEqual({ key: 'base', name: '基本工资' });
  expect(report.rows).toHaveLength(2);
  for (const r of report.rows) {
    expect(r.notes).toEqual([{ unit: 10000, count: 0 }]);
    expect(r.remainder).toBe(12002);
    expect(r.values.base).toBe(12002);
    expect(r.notes.reduce((total, n) => total + n.unit * n.count, r.remainder)).toBe(r.values.base);
  }
  expect(report.totals.base).toBe(24004);
  expect(await api.exportReport(input)).toEqual(report);
  const bonus = await api.report({
    ...input,
    columns: ['bonus'],
    cashField: 'bonus',
    denominations: [100, 1],
  });
  expect(bonus.rows[1]!.notes).toEqual([
    { unit: 100, count: 2 },
    { unit: 1, count: 2 },
  ]);
  expect(bonus.rows[1]!.values.bonus).toBe(202);
  await expect(api.report({ ...input, cashField: 'unknown' })).rejects.toThrow('未知票面工资栏目');
  await expect(api.report({ ...input, cashField: 'bonus' })).rejects.toThrow('必须选择奖金');
  for (const denominations of [[], [100, 100], [3], [0], [1.5]])
    await expect(api.report({ ...input, denominations })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  const viewer = app.call(
    payroll,
    await app.addUser('cash-viewer', { permissions: ['payroll.salary.view'] }),
  );
  expect(await viewer.report(input)).toEqual(report);
  await expect(viewer.exportReport(input)).rejects.toThrow('权限');
  expect(await api.batches({})).toEqual(before);
});
it('w_gz_prt_pm 按所选栏目检查负数，不能以其他正数栏目掩盖；拒绝后快照不变', async () => {
  const b = await api.saveBatch({
    period: 202601,
    categoryId: category.id,
    categoryRevision: category.revision,
    rows: [{ ...salary(employees[0]!.id, 10000), values: { base: 10000, bonus: -1 } }],
  });
  const calculated = await api.calculate({ id: b.id, revision: b.revision });
  const input = {
    categoryId: category.id,
    from: 202601,
    to: 202601,
    employeeIds: [employees[0]!.id],
    columns: ['net', 'bonus'],
    kind: 'cash' as const,
  };
  expect((await api.report(input)).rows[0]!.values.net).toBe(9999);
  await expect(api.report({ ...input, cashField: 'bonus' })).rejects.toThrow('负奖金');
  expect(await api.batch({ id: b.id })).toEqual(calculated);
});
it('w_gz_zhcx 字段/操作符/金额/日期白名单校验，错误不忽略条件；含有和金额条件真实筛选', async () => {
  await calc();
  const input = { categoryId: category.id, from: 202601, to: 202601 };
  expect(
    await api.querySalary({
      ...input,
      conditions: [{ field: 'name', operator: 'contains', value: '人员2' }],
    }),
  ).toHaveLength(1);
  expect(
    await api.querySalary({
      ...input,
      conditions: [{ field: 'gross', operator: 'gt', value: 1000000 }],
    }),
  ).toHaveLength(0);
  expect(
    await api.querySalary({
      ...input,
      conditions: [
        { field: 'startDate', operator: 'equals', value: '2026-01-01' },
        { field: 'code', operator: 'notContains', value: 'T001' },
      ],
    }),
  ).toHaveLength(2);
  const invalid = { ...input, conditions: [{ field: 'gross', operator: 'contains', value: '1' }] };
  await expect(api.querySalary(invalid as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(invalid.conditions).toEqual([{ field: 'gross', operator: 'contains', value: '1' }]);
  await expect(
    api.querySalary({
      ...input,
      conditions: [{ field: 'startDate', operator: 'gt', value: 'bad-date' }],
    }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  await expect(
    api.querySalary({
      ...input,
      conditions: [{ field: 'drop table', operator: 'equals', value: 1 }],
    } as never),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});
it('w_gz_jz/qxfz 工资独立结账冻结、传递/去重、最近月回退与启用边界，core期间仍开放', async () => {
  let b = await calc();
  await expect(api.close({ id: b.id, revision: b.revision, confirmed: false })).rejects.toThrow(
    '须确认',
  );
  await expect(api.reopen({ id: b.id, revision: b.revision, confirmed: true })).rejects.toThrow(
    '启用边界',
  );
  await api.saveEmployee({ ...employees[2]!, disabled: true });
  const closed = await api.close({ id: b.id, revision: b.revision, confirmed: true });
  b = closed.batch;
  expect(b.closed).toBe(true);
  expect((await app.svc.periods.get(202601))?.status).toBe('open');
  const next = await api.batch({ id: closed.nextId! });
  expect(next.period).toBe(202602);
  expect(next.rows).toHaveLength(2);
  expect(next.rows[0]!.values).toEqual({ base: 1000000 });
  expect(next.rows[0]!.tax.confirmed).toBe(false);
  expect((await api.close({ id: b.id, revision: 1, confirmed: true })).nextId).toBe(next.id);
  expect(await api.batches({})).toHaveLength(2);
  await expect(api.calculate({ id: b.id, revision: b.revision })).rejects.toThrow('已经结账');
  await expect(api.reopen({ id: b.id, revision: b.revision, confirmed: false })).rejects.toThrow(
    '须确认',
  );
  b = await api.reopen({ id: b.id, revision: b.revision, confirmed: true });
  expect(b.closed).toBe(false);
  expect(await api.batches({})).toHaveLength(1);
  expect(b.snapshots).toEqual(closed.batch.snapshots);
  await expect(api.reopen({ id: b.id, revision: b.revision, confirmed: true })).rejects.toThrow(
    '启用边界',
  );
});
it('w_gz_qxfz 下月已改/已算不自动删除，最近月限制、已审核来源仍锁定', async () => {
  let jan = await calc();
  const first = await api.close({ id: jan.id, revision: jan.revision, confirmed: true });
  jan = first.batch;
  let feb = await api.batch({ id: first.nextId! });
  feb = await api.saveBatch({
    ...feb,
    categoryRevision: category.revision,
    rows: feb.rows.map((r) => ({ ...r, tax: { ...r.tax, confirmed: true } })),
  });
  await expect(api.reopen({ id: jan.id, revision: jan.revision, confirmed: true })).rejects.toThrow(
    '下月传递批次已修改',
  );
  feb = await api.calculate({ id: feb.id, revision: feb.revision });
  const second = await api.close({ id: feb.id, revision: feb.revision, confirmed: true });
  await expect(api.reopen({ id: jan.id, revision: jan.revision, confirmed: true })).rejects.toThrow(
    '最近',
  );
  const id = async (code: string) => (await app.svc.accounts.require(code)).id;
  await app.svc.accounts.create(
    { code: '2241', name: '合成个人扣款', categoryId: 'liability' },
    (await app.svc.book.info()).codeScheme,
  );
  await app.svc.accounts.create(
    { code: '222102', name: '合成个税' },
    (await app.svc.book.info()).codeScheme,
  );
  await api.saveMapping({
    categoryId: category.id,
    mapping: {
      payableAccountId: await id('2211'),
      bankAccountId: await id('1001'),
      taxAccountId: await id('222102'),
      deductionAccountId: await id('2241'),
      expenseAccountId: await id('6602'),
      amountField: 'gross',
      allocationField: 'department',
    },
  });
  const p = await api.preview({
    id: feb.id,
    revision: second.batch.revision,
    kind: 'payment',
    date: '2026-02-28',
  });
  feb = await api.generate({
    id: feb.id,
    revision: second.batch.revision,
    kind: 'payment',
    date: '2026-02-28',
    hash: p.hash,
  });
  await app.svc.vouchers.changeStatus({ ids: [feb.vouchers[0]!.id], to: 'audited' });
  await expect(api.reopen({ id: feb.id, revision: feb.revision, confirmed: true })).rejects.toThrow(
    '已审核或过账',
  );
  expect((await api.batch({ id: feb.id })).closed).toBe(true);
});
it('w_gz_jz 下月已有数据、类别停用、未计算和过期版本阻止；中途失败不留传递批次或跨年期间', async () => {
  let b = await make();
  await expect(api.close({ id: b.id, revision: b.revision, confirmed: true })).rejects.toThrow(
    '未计算',
  );
  b = await api.calculate({ id: b.id, revision: b.revision });
  await expect(api.close({ id: b.id, revision: 0, confirmed: true })).rejects.toThrow('已修改');
  const feb = await make(202602);
  await expect(api.close({ id: b.id, revision: b.revision, confirmed: true })).rejects.toThrow(
    '下月已有工资',
  );
  await api.calculate({ id: feb.id, revision: feb.revision });
  const dec = await calc(202612);
  await sql`CREATE TRIGGER payroll_close_failure BEFORE INSERT ON payroll_period BEGIN SELECT RAISE(ABORT,'synthetic close failure'); END`.execute(
    app.svc.db,
  );
  await expect(api.close({ id: dec.id, revision: dec.revision, confirmed: true })).rejects.toThrow(
    'synthetic close failure',
  );
  expect((await api.batch({ id: dec.id })).closed).toBe(false);
  expect(await api.batches({ period: 202701 })).toHaveLength(0);
  expect((await app.svc.periods.list()).some((p) => p.period === 202701)).toBe(false);
  await sql`DROP TRIGGER payroll_close_failure`.execute(app.svc.db);
  const closed = await api.close({ id: dec.id, revision: dec.revision, confirmed: true });
  const jan = await api.batch({ id: closed.nextId! });
  expect(jan.rows[0]!.tax).toEqual(TaxInputSchema.parse({}));
});

it('w_gz_gzgl 重算前后保留上次计算快照，导出只取当前有效计算，不重复累计旧税', async () => {
  let b = await calc();
  const previous = b.snapshots;
  b = await api.saveBatch({
    ...b,
    categoryRevision: category.revision,
    rows: b.rows.map((r, i) => (i === 0 ? { ...r, values: { base: 2000000 } } : r)),
  });
  expect(b.previous).toEqual(previous);
  expect(b.snapshots).toEqual([]);
  await expect(api.exportRows({ id: b.id, employeeIds: [employees[0]!.id] })).rejects.toThrow(
    '尚未计算',
  );
  b = await api.calculate({ id: b.id, revision: b.revision });
  expect(b.snapshots[0]!.taxAmount).toBe(45000);
  expect(b.previous[0]!.taxAmount).toBe(15000);
  expect(b.snapshots[0]!.detail.alreadyWithheld).toBe(0);
  const after = b.snapshots;
  b = await api.calculate({ id: b.id, revision: b.revision });
  expect(b.snapshots).toEqual(after);
  expect(b.previous).toEqual(previous);
});

it('w_gz_edit_set/w_gz_rsgl_xg 同名两人并发交换编号后旧粘贴预览失效，重新预览只写稳定员工ID', async () => {
  const first = employees[0]!;
  const second = await api.saveEmployee({ ...employees[1]!, name: first.name });
  let b = await api.saveBatch({
    period: 202601,
    categoryId: category.id,
    categoryRevision: category.revision,
    rows: [salary(first.id, 1000000), salary(second.id, 1000000)],
  });
  b = await api.calculate({ id: b.id, revision: b.revision });
  const input = {
    id: b.id,
    revision: b.revision,
    rows: [{ code: first.code, values: { base: 10000 } }],
  };
  const preview = await api.previewPaste(input);
  expect(preview.preview[0]!.employeeId).toBe(first.id);
  const hr = app.call(
    payroll,
    await app.addUser('renumber-hr', { permissions: ['payroll.hr.view', 'payroll.hr.edit'] }),
  );
  await hr.saveEmployee({ ...first, code: 'TEMP' });
  await hr.saveEmployee({ ...second, code: first.code });
  expect((await api.batch({ id: b.id })).revision).toBe(b.revision);
  await expect(api.applyPaste({ ...input, hash: preview.hash, confirmed: true })).rejects.toThrow(
    '预览已失效',
  );
  expect(await api.batch({ id: b.id })).toEqual(b);
  const fresh = await api.previewPaste(input);
  expect(fresh.preview[0]!.employeeId).toBe(second.id);
  expect(fresh.hash).not.toBe(preview.hash);
  const saved = await api.applyPaste({ ...input, hash: fresh.hash, confirmed: true });
  expect(saved.rows.map((r) => [r.employeeId, r.values.base])).toEqual([
    [first.id, 1000000],
    [second.id, 10000],
  ]);
});
it('w_gz_edit_set 置数预览绑定选定员工版本，HR改姓名或编号后保留原工资并要求重新预览', async () => {
  const b = await calc(),
    person = employees[0]!;
  const input = {
    id: b.id,
    revision: b.revision,
    employeeIds: [person.id],
    field: 'base',
    value: 10000,
    onlyEmpty: false,
  };
  const preview = await api.previewBulk(input);
  const hr = app.call(
    payroll,
    await app.addUser('bulk-hr', { permissions: ['payroll.hr.view', 'payroll.hr.edit'] }),
  );
  await hr.saveEmployee({ ...person, code: 'RENAMED', name: '合成改名人员' });
  await expect(api.applyBulk({ ...input, hash: preview.hash, confirmed: true })).rejects.toThrow(
    '预览已失效',
  );
  expect(await api.batch({ id: b.id })).toEqual(b);
  const fresh = await api.previewBulk(input);
  expect(fresh.preview[0]).toMatchObject({
    employeeId: person.id,
    code: 'RENAMED',
    name: '合成改名人员',
  });
  expect(
    (await api.applyBulk({ ...input, hash: fresh.hash, confirmed: true })).rows[0]!.values.base,
  ).toBe(10000);
});
