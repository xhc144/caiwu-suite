import ExcelJS from 'exceljs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { sql } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import payroll from '../server';
import {
  DEFAULT_FIELDS,
  TaxInputSchema,
  type Batch,
  type Category,
  type Employee,
} from '../shared';
import type { ImportColumn } from '../shared-import';

let app: TestApp;
const call = (a: TestApp) => a.call(payroll);
let api: ReturnType<typeof call>;
let category: Category;
let employees: Employee[];
let batch: Batch;
const columns: ImportColumn[] = [
  { index: 1, field: '$code' },
  { index: 2, field: 'base' },
  { index: 3, field: 'hours' },
  { index: 4, field: 'bonus' },
];
async function file(rows: ExcelJS.CellValue[][], title = '工资转入') {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(title);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
}
const input = async (rows: ExcelJS.CellValue[][]) => ({
  id: batch.id,
  revision: batch.revision,
  file: await file(rows),
  columns,
});
const normalRows = () => [
  ['编号', '基本工资', '工时', 'bonus'],
  ['X001', '￥１２３．４５', '12.345678', ''],
  ['X002', 200.5, '0', '15.20'],
];
beforeEach(async () => {
  app = await createTestApp({ modules: [payroll], product: 'minfei' });
  api = call(app);
  category = await api.saveCategory({
    name: '合成Excel工资',
    fields: [
      ...DEFAULT_FIELDS,
      {
        key: 'hours',
        name: '工时',
        kind: 'quantity',
        role: 'memo',
        unit: '小时',
        visible: true,
        print: true,
        carry: true,
        disabled: false,
      },
    ],
  });
  const departmentId = (await app.svc.dimensions.getByCode('department', '01'))!.id;
  employees = [];
  for (let i = 1; i <= 3; i++)
    employees.push(
      await api.saveEmployee({
        code: `X00${i}`,
        name: `合成转入人员${i}`,
        startDate: '2026-01-01',
        departmentId,
      }),
    );
  batch = await api.saveBatch({
    period: 202601,
    categoryId: category.id,
    categoryRevision: category.revision,
    rows: [employees[0]!, employees[2]!].map((e) => ({
      employeeId: e.id,
      values: { base: 1000000, bonus: 5000 },
      quantities: { hours: '8' },
      tax: TaxInputSchema.parse({ confirmed: true }),
    })),
  });
});
afterEach(() => app.close());
it('w_gz_gzgl Excel实际xlsx转入按编号和栏目映射，预览区分新老人员，空格保留及精确数量，确认一次原子保存', async () => {
  const data = await input(normalRows());
  const inspection = await api.inspectImport(data);
  expect(inspection.sheet).toBe('工资转入');
  expect(inspection.headers.map((c) => c.field)).toEqual(['$code', 'base', 'hours', 'bonus']);
  const plan = await api.previewImport(data);
  expect(plan.addedPeople).toBe(1);
  expect(plan.preview).toHaveLength(5);
  expect(plan.preview[0]).toMatchObject({
    code: 'X001',
    before: 1000000,
    after: 12345,
    added: false,
  });
  expect(plan.preview[1]).toMatchObject({ kind: 'quantity', before: '8', after: '12.345678' });
  await expect(api.applyImport({ ...data, hash: plan.hash, confirmed: false })).rejects.toThrow(
    '须核对',
  );
  expect(await api.batch({ id: batch.id })).toEqual(batch);
  const saved = await api.applyImport({ ...data, hash: plan.hash, confirmed: true });
  expect(saved.revision).toBe(batch.revision + 1);
  expect(saved.calculated).toBe(false);
  expect(saved.rows).toHaveLength(3);
  expect(saved.rows.find((r) => r.employeeId === employees[0]!.id)).toMatchObject({
    values: { base: 12345, bonus: 5000 },
    quantities: { hours: '12.345678' },
    tax: { confirmed: true },
  });
  expect(saved.rows.find((r) => r.employeeId === employees[1]!.id)).toMatchObject({
    values: { base: 20050, bonus: 1520 },
    quantities: { hours: '0' },
    tax: { confirmed: false },
  });
  expect(saved.rows.find((r) => r.employeeId === employees[2]!.id)).toEqual(batch.rows[1]);
  const quantityRows = await app.svc.db
    .withTables<{
      payroll_quantity: {
        batch_id: number;
        employee_id: number;
        field_key: string;
        quantity_e6: number;
      };
    }>()
    .selectFrom('payroll_quantity')
    .selectAll()
    .where('batch_id', '=', batch.id)
    .orderBy('employee_id')
    .execute();
  expect(quantityRows.map((r) => r.quantity_e6)).toEqual([12345678, 0, 8000000]);
  await expect(api.applyImport({ ...data, hash: plan.hash, confirmed: true })).rejects.toThrow(
    '其他操作修改',
  );
});
it('w_gz_gzgl Excel任一非法金额/超范围/超六位数量/公式缓存均阻止整个预览，工资原值不变', async () => {
  for (const [column, value] of [
    [1, '12..34'],
    [1, '999999999999999999999'],
    [2, '0.1234567'],
    [1, { formula: '1+2', result: 3 }],
  ] as const) {
    const rows: ExcelJS.CellValue[][] = normalRows();
    rows[2]![column] = value;
    await expect(api.previewImport(await input(rows))).rejects.toThrow(/不是有效|含公式/);
    expect(await api.batch({ id: batch.id })).toEqual(batch);
  }
  await expect(
    api.inspectImport({
      id: batch.id,
      revision: batch.revision,
      file: Buffer.from('not an xlsx').toString('base64'),
    }),
  ).rejects.toThrow('标准 .xlsx');
});
it('w_gz_gzgl Excel未知人员/重复编号/重复映射/计算栏/空内容及超限工作簿明确拒绝', async () => {
  const data = await input(normalRows());
  for (const rows of [
    [
      ['编号', 'base', 'hours', 'bonus'],
      ['NOPE', '100', '', ''],
    ],
    [...normalRows(), ['X001', '100', '', '']],
    [
      ['编号', 'base', 'hours', 'bonus'],
      ['X001', '', '', ''],
    ],
  ])
    await expect(api.previewImport(await input(rows))).rejects.toThrow(/不在人事|重复|没有可转入/);
  await expect(
    api.previewImport({
      ...data,
      columns: columns.map((c) => (c.index === 3 ? { ...c, field: 'base' } : c)),
    }),
  ).rejects.toThrow('不重复');
  await expect(
    api.previewImport({
      ...data,
      columns: columns.map((c) => (c.index === 2 ? { ...c, field: 'net' } : c)),
    }),
  ).rejects.toThrow('不是启用');
  const oversized = new ExcelJS.Workbook();
  const sheet = oversized.addWorksheet('超限');
  sheet.getCell('A1').value = '编号';
  sheet.getCell('B1').value = 'base';
  sheet.getCell('A502').value = 'X001';
  await expect(
    api.inspectImport({
      id: batch.id,
      revision: batch.revision,
      file: Buffer.from(await oversized.xlsx.writeBuffer()).toString('base64'),
    }),
  ).rejects.toThrow('500行');
  expect(await api.batch({ id: batch.id })).toEqual(batch);
});
it('w_gz_gzgl Excel计划绑定人员及结构版本，文件换值或人员改名后不可复用旧确认', async () => {
  const data = await input(normalRows());
  const plan = await api.previewImport(data);
  await api.saveEmployee({ ...employees[0]!, name: '改名后的合成人员' });
  await expect(api.applyImport({ ...data, hash: plan.hash, confirmed: true })).rejects.toThrow(
    '预览已失效',
  );
  expect(await api.batch({ id: batch.id })).toEqual(batch);
  const fresh = await api.previewImport(data);
  const changed = normalRows();
  changed[1]![1] = '999';
  await expect(
    api.applyImport({ ...data, file: await file(changed), hash: fresh.hash, confirmed: true }),
  ).rejects.toThrow('预览已失效');
  await api.saveCategory({ ...category, name: '修改后的结构名' });
  await expect(api.previewImport(data)).rejects.toThrow('工资结构已更新');
});
it('w_gz_gzgl Excel写入中途失败整批回滚，原工资及日志不变，移除故障后原计划可重试', async () => {
  const data = await input(normalRows());
  const plan = await api.previewImport(data);
  await sql`CREATE TRIGGER payroll_excel_failure BEFORE INSERT ON payroll_row WHEN NEW.employee_id=2 BEGIN SELECT RAISE(ABORT,'synthetic Excel import failure'); END`.execute(
    app.svc.db,
  );
  await expect(api.applyImport({ ...data, hash: plan.hash, confirmed: true })).rejects.toThrow(
    'synthetic Excel import failure',
  );
  expect(await api.batch({ id: batch.id })).toEqual(batch);
  await sql`DROP TRIGGER payroll_excel_failure`.execute(app.svc.db);
  const saved = await api.applyImport({ ...data, hash: plan.hash, confirmed: true });
  expect(saved.rows).toHaveLength(3);
  expect(saved.rows.find((r) => r.employeeId === employees[0]!.id)!.values.base).toBe(12345);
});
it('w_gz_gzgl Excel转入仅工资维护权限可执行，闭期及凭证锁仍由真实保存规则保护', async () => {
  const data = await input(normalRows());
  const clerk = app.call(
    payroll,
    await app.addUser('excel-view', { permissions: ['payroll.salary.view'] }),
  );
  await expect(clerk.previewImport(data)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await app.svc.periods.setStatus(202601, 'closed');
  await expect(api.previewImport(data)).rejects.toThrow();
  expect((await api.batch({ id: batch.id })).rows).toEqual(batch.rows);
});
