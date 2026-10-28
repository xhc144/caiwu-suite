import { afterEach, beforeEach, expect, it } from 'vitest';
import { sql } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import payroll from '../server';
import { DEFAULT_FIELDS, TaxInputSchema, type Employee } from '../shared';
import { PersonnelBulkInputSchema } from '../shared-personnel';

let app: TestApp;
const caller = (a: TestApp, token?: string) => a.call(payroll, token);
let api: ReturnType<typeof caller>;
let employees: Employee[];
let departmentId: number;
beforeEach(async () => {
  app = await createTestApp({ modules: [payroll], product: 'minfei' });
  api = caller(app);
  departmentId = (await app.svc.dimensions.getByCode('department', '02'))!.id;
  employees = [];
  for (let i = 1; i <= 3; i++)
    employees.push(
      await api.saveEmployee({
        code: `H00${i}`,
        name: `合成人员${i}`,
        departmentId: (await app.svc.dimensions.getByCode('department', '01'))!.id,
        startDate: '2026-01-01',
        ...(i === 2 ? { endDate: '2026-12-31' } : {}),
      }),
    );
});
afterEach(async () => app.close());

it('w_gz_rsgl/w_gz_edit_set 人事所选范围预览、取消、确认只改基本项，编号和范围外人员保留', async () => {
  const input = {
    employeeIds: [employees[0]!.id, employees[2]!.id],
    field: 'departmentId' as const,
    value: departmentId,
  };
  const plan = await api.previewPersonnelBulk(input);
  expect(plan.preview.map((r) => r.code)).toEqual(['H001', 'H003']);
  expect(plan.preview.every((r) => r.beforeText.includes('01'))).toBe(true);
  expect(plan.preview.every((r) => r.after === departmentId && r.changed)).toBe(true);
  await expect(
    api.applyPersonnelBulk({ ...input, hash: plan.hash, confirmed: false }),
  ).rejects.toThrow('须确认');
  expect(await api.employees()).toEqual(employees);
  const saved = await api.applyPersonnelBulk({ ...input, hash: plan.hash, confirmed: true });
  expect(saved.map((e) => e.departmentId)).toEqual([
    departmentId,
    employees[1]!.departmentId,
    departmentId,
  ]);
  expect(saved.map((e) => e.code)).toEqual(['H001', 'H002', 'H003']);
  expect(saved[1]).toEqual(employees[1]);
  expect(saved[0]!.revision).toBe(employees[0]!.revision + 1);
});

it('w_gz_edit_set 人事空白项置数保留已有值，姓名及停用均按白名单修改', async () => {
  const input = {
    employeeIds: employees.map((e) => e.id),
    field: 'endDate' as const,
    value: '2026-11-30',
    onlyEmpty: true,
  };
  const plan = await api.previewPersonnelBulk(input);
  expect(plan.preview.map((r) => r.after)).toEqual(['2026-11-30', '2026-12-31', '2026-11-30']);
  const saved = await api.applyPersonnelBulk({ ...input, hash: plan.hash, confirmed: true });
  expect(saved[1]!.revision).toBe(employees[1]!.revision);
  const rename = { employeeIds: [employees[0]!.id], field: 'name' as const, value: '统一合成姓名' };
  const renamed = await api.previewPersonnelBulk(rename);
  await api.applyPersonnelBulk({ ...rename, hash: renamed.hash, confirmed: true });
  const disable = { employeeIds: [employees[0]!.id], field: 'disabled' as const, value: true };
  const disabled = await api.previewPersonnelBulk(disable);
  expect(disabled.preview[0]!.afterText).toBe('停用');
  const result = await api.applyPersonnelBulk({ ...disable, hash: disabled.hash, confirmed: true });
  expect(result[0]).toMatchObject({ name: '统一合成姓名', code: 'H001', disabled: true });
});

it('w_gz_edit_set 人事非法范围、类型、日期、停用部门和编号统一置数均拒绝', async () => {
  const input = {
    employeeIds: [employees[0]!.id],
    field: 'departmentId' as const,
    value: departmentId,
  };
  await expect(api.previewPersonnelBulk({ ...input, employeeIds: [] })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  await expect(
    api.previewPersonnelBulk({ ...input, employeeIds: [employees[0]!.id, employees[0]!.id] }),
  ).rejects.toThrow('重复人员');
  await expect(api.previewPersonnelBulk({ ...input, employeeIds: [99999] })).rejects.toThrow(
    '不存在',
  );
  await expect(api.previewPersonnelBulk({ ...input, value: '02' })).rejects.toThrow();
  await expect(api.previewPersonnelBulk({ ...input, field: 'name', value: '' })).rejects.toThrow();
  await expect(
    api.previewPersonnelBulk({ ...input, field: 'endDate', value: '2025-12-31' }),
  ).rejects.toThrow('早于任职');
  expect(
    PersonnelBulkInputSchema.safeParse({ ...input, field: 'code', value: '重复编号' }).success,
  ).toBe(false);
  const department = (await app.svc.dimensions.get(departmentId))!;
  await app.svc.dimensions.setDisabled(departmentId, true, {
    expectedRevision: department.revision ?? 0,
  });
  await expect(api.previewPersonnelBulk(input)).rejects.toThrow('启用的末级部门');
  expect(await api.employees()).toEqual(employees);
});

it('w_gz_edit_set 人事并发修改及部门变化使预览失效，错误计划不能写入', async () => {
  const input = { employeeIds: [employees[0]!.id], field: 'name' as const, value: '计划姓名' };
  const plan = await api.previewPersonnelBulk(input);
  const changed = await api.saveEmployee({ ...employees[0]!, name: '并发修改姓名' });
  await expect(
    api.applyPersonnelBulk({ ...input, hash: plan.hash, confirmed: true }),
  ).rejects.toThrow('预览已失效');
  expect((await api.employees())[0]).toEqual(changed);
  const next = await api.previewPersonnelBulk(input);
  await expect(
    api.applyPersonnelBulk({ ...input, hash: '0'.repeat(64), confirmed: true }),
  ).rejects.toThrow('预览已失效');
  const department = (await app.svc.dimensions.get(departmentId))!;
  await app.svc.dimensions.update(
    departmentId,
    { code: department.code, name: '变更部门名称' },
    { expectedRevision: department.revision ?? 0 },
  );
  await expect(
    api.applyPersonnelBulk({ ...input, hash: next.hash, confirmed: true }),
  ).rejects.toThrow('预览已失效');
  expect((await api.employees())[0]).toEqual(changed);
});

it('w_gz_rsgl 人事统一置数遇到保存失败时前面人员同事务回滚，原输入可重新预览重试', async () => {
  const input = {
    employeeIds: employees.map((e) => e.id),
    field: 'disabled' as const,
    value: true,
  };
  const plan = await api.previewPersonnelBulk(input);
  await sql`CREATE TRIGGER payroll_personnel_failure BEFORE UPDATE ON payroll_employee WHEN NEW.code='H002' BEGIN SELECT RAISE(ABORT,'synthetic personnel failure'); END`.execute(
    app.svc.db,
  );
  await expect(
    api.applyPersonnelBulk({ ...input, hash: plan.hash, confirmed: true }),
  ).rejects.toThrow('synthetic personnel failure');
  expect(await api.employees()).toEqual(employees);
  await sql`DROP TRIGGER payroll_personnel_failure`.execute(app.svc.db);
  const retry = await api.previewPersonnelBulk(input);
  const saved = await api.applyPersonnelBulk({ ...input, hash: retry.hash, confirmed: true });
  expect(saved.every((e) => e.disabled)).toBe(true);
});

it('w_gz_rsgl 人事批量修改任职日期沿用历史保护，后一个人失败时整批不变', async () => {
  const category = await api.saveCategory({ name: '合成工资', fields: DEFAULT_FIELDS });
  await api.confirmTax();
  const batch = await api.saveBatch({
    period: 202601,
    categoryId: category.id,
    categoryRevision: category.revision,
    rows: [
      {
        employeeId: employees[1]!.id,
        values: { base: 1000000 },
        tax: TaxInputSchema.parse({ confirmed: true }),
      },
    ],
  });
  await api.calculate({ id: batch.id, revision: batch.revision });
  const input = {
    employeeIds: employees.map((e) => e.id),
    field: 'startDate' as const,
    value: '2026-01-02',
  };
  const plan = await api.previewPersonnelBulk(input);
  await expect(
    api.applyPersonnelBulk({ ...input, hash: plan.hash, confirmed: true }),
  ).rejects.toThrow('已计算历史');
  expect(await api.employees()).toEqual(employees);
});

it('w_gz_edit_set 人事置数预览与应用均要求人事维护权限', async () => {
  const token = await app.addUser('salary_reader', {
    permissions: ['payroll.salary.view', 'payroll.hr.view'],
  });
  const reader = caller(app, token);
  const input = { employeeIds: [employees[0]!.id], field: 'name' as const, value: '越权修改' };
  await expect(reader.previewPersonnelBulk(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const plan = await api.previewPersonnelBulk(input);
  await expect(
    reader.applyPersonnelBulk({ ...input, hash: plan.hash, confirmed: true }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await api.employees()).toEqual(employees);
});
