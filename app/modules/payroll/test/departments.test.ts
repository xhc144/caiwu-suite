import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import payroll from '../server';
import { DEFAULT_FIELDS } from '../shared';

let app: TestApp;
const caller = (a: TestApp) => a.call(payroll);
let api: ReturnType<typeof caller>;
beforeEach(async () => {
  app = await createTestApp({ modules: [payroll], product: 'minfei' });
  api = caller(app);
});
afterEach(() => app.close());

it('w_gz_bmwh 修改编码名称保留稳定ID与人事关联，重复编码和过期修改均不覆盖', async () => {
  const department = await api.createDepartment({ code: 'HR01', name: '合成部门' });
  const person = await api.saveEmployee({
    code: 'HR001',
    name: '合成员工',
    departmentId: department.id,
    startDate: '2026-01-01',
  });
  const updated = await api.updateDepartment({
    id: department.id,
    revision: department.revision ?? 0,
    code: 'HR02',
    name: '合成部门新名',
  });
  expect(updated.id).toBe(department.id);
  expect((await api.employees()).find((e) => e.id === person.id)?.departmentName).toBe(
    '合成部门新名',
  );
  await expect(
    api.updateDepartment({
      id: department.id,
      revision: department.revision ?? 0,
      code: 'HR03',
      name: '过期内容',
    }),
  ).rejects.toThrow('档案已变化');
  await expect(
    api.updateDepartment({
      id: department.id,
      revision: updated.revision ?? 0,
      code: '01',
      name: '冲突内容',
    }),
  ).rejects.toThrow('已存在');
  expect(await app.svc.dimensions.get(department.id)).toEqual(updated);
});

it('w_gz_bmwh 停用须确认，停用保留人事及历史，禁止新增工资与调入，启用后可录入', async () => {
  const department = await api.createDepartment({ code: 'HR01', name: '合成部门' });
  const person = await api.saveEmployee({
    code: 'HR001',
    name: '合成员工',
    departmentId: department.id,
    startDate: '2026-01-01',
  });
  const category = await api.saveCategory({ name: '合成工资', fields: DEFAULT_FIELDS });
  const input = {
    period: 202601,
    categoryId: category.id,
    categoryRevision: category.revision,
    rows: [{ employeeId: person.id, values: { base: 100000 } }],
  };
  const batch = await api.saveBatch(input);
  const status = {
    id: department.id,
    revision: department.revision ?? 0,
    disabled: true,
    confirmed: true,
  };
  await expect(api.setDepartmentDisabled({ ...status, confirmed: false })).rejects.toThrow(
    '须确认',
  );
  expect((await app.svc.dimensions.get(department.id))?.disabled).toBe(false);
  const stopped = await api.setDepartmentDisabled(status);
  expect((await api.batch({ id: batch.id })).rows).toEqual(batch.rows);
  await expect(api.saveBatch({ ...input, id: batch.id, revision: batch.revision })).rejects.toThrow(
    '部门已停用',
  );
  await expect(api.saveEmployee({ ...person, id: undefined, code: 'HR002' })).rejects.toThrow(
    '启用的末级部门',
  );
  // 同一停用部门中仍能停用员工，不要求改写历史部门。
  expect((await api.saveEmployee({ ...person, disabled: true })).disabled).toBe(true);
  await api.setDepartmentDisabled({
    id: stopped.id,
    revision: stopped.revision ?? 0,
    disabled: false,
    confirmed: true,
  });
  await api.saveEmployee({ ...person, revision: person.revision + 1, disabled: false });
  expect((await api.saveBatch({ ...input, id: batch.id, revision: batch.revision })).rows).toEqual(
    batch.rows,
  );
});

it('w_gz_bmwh 已使用部门不能删除，空部门确认后删除，确认计划过期不误删', async () => {
  const used = await api.createDepartment({ code: 'HR01', name: '使用中' });
  await api.saveEmployee({
    code: 'HR001',
    name: '合成员工',
    departmentId: used.id,
    startDate: '2026-01-01',
  });
  const blocked = await api.previewDepartmentDelete({ id: used.id });
  expect(blocked.references).toContainEqual({
    category: '工资人事档案',
    count: 1,
    to: '/m/payroll/employees',
  });
  await expect(api.deleteDepartment({ ...blocked, confirmed: true })).rejects.toThrow(
    '工资人事档案',
  );
  const empty = await api.createDepartment({ code: 'HR02', name: '未使用' });
  const plan = await api.previewDepartmentDelete({ id: empty.id });
  await expect(api.deleteDepartment({ ...plan, confirmed: false })).rejects.toThrow('确认');
  await api.updateDepartment({
    id: empty.id,
    revision: empty.revision ?? 0,
    code: 'HR02',
    name: '更新后的部门',
  });
  await expect(api.deleteDepartment({ ...plan, confirmed: true })).rejects.toThrow();
  const fresh = await api.previewDepartmentDelete({ id: empty.id });
  await api.deleteDepartment({ ...fresh, confirmed: true });
  expect(await app.svc.dimensions.get(empty.id)).toBeNull();
});

it('w_gz_bmwh 拒绝无维护权限与其它辅助类型冒充部门', async () => {
  const person = (await app.svc.dimensions.getByCode('person', 'P01'))!;
  await expect(
    api.updateDepartment({
      id: person.id,
      revision: person.revision ?? 0,
      code: 'P02',
      name: '误改',
    }),
  ).rejects.toThrow('部门不存在');
  const clerk = app.call(
    payroll,
    await app.addUser('gzread', { permissions: ['payroll.hr.view'] }),
  );
  const department = (await api.departments())[0]!;
  await expect(
    clerk.updateDepartment({
      id: department.id,
      revision: department.revision ?? 0,
      code: department.code,
      name: '越权',
    }),
  ).rejects.toThrow();
  await expect(
    clerk.setDepartmentDisabled({
      id: department.id,
      revision: department.revision ?? 0,
      disabled: true,
      confirmed: true,
    }),
  ).rejects.toThrow();
  expect((await api.departments()).find((d) => d.id === department.id)?.name).toBe(department.name);
});

it('w_gz_bmwh 人员调出后仍检查旧计算快照、重算前快照及部门凭证映射引用', async () => {
  const department = await api.createDepartment({ code: 'OLD', name: '合成旧部门' });
  const target = await api.createDepartment({ code: 'NEW', name: '合成新部门' });
  const employee = await api.saveEmployee({
    code: 'MOVE01',
    name: '合成调动人员',
    departmentId: department.id,
    startDate: '2026-01-01',
  });
  const category = await api.saveCategory({ name: '合成调动工资', fields: DEFAULT_FIELDS });
  await api.confirmTax();
  const input = {
    period: 202601,
    categoryId: category.id,
    categoryRevision: category.revision,
    rows: [{ employeeId: employee.id, values: { base: 1000000 }, tax: { confirmed: true } }],
  };
  const saved = await api.saveBatch(input);
  const calculated = await api.calculate({ id: saved.id, revision: saved.revision });
  await api.saveEmployee({ ...employee, departmentId: target.id });
  const current = await api.previewDepartmentDelete({ id: department.id });
  expect(current.references).toContainEqual({
    category: '已计算工资部门快照',
    count: 1,
    to: '/m/payroll',
  });
  // 编辑工资清除当前快照，但重算前的已保存快照仍保留旧部门。
  await api.saveBatch({ ...input, id: saved.id, revision: calculated.revision });
  const previous = await api.previewDepartmentDelete({ id: department.id });
  expect(previous.references).toContainEqual({
    category: '已计算工资部门快照',
    count: 1,
    to: '/m/payroll',
  });
  const accounts = await app.svc.accounts.list();
  const account = (code: string) => accounts.find((a) => a.code === code)!.id;
  await api.saveMapping({
    categoryId: category.id,
    mapping: {
      payableAccountId: account('2211'),
      bankAccountId: account('1001'),
      taxAccountId: account('1001'),
      deductionAccountId: account('1001'),
      expenseAccountId: account('6602'),
      amountField: 'gross',
      allocationField: 'department',
      rules: [
        {
          kind: 'allocation',
          field: 'base',
          departmentId: department.id,
          debitAccountId: account('6602'),
          creditAccountId: account('2211'),
        },
      ],
    },
  });
  const mapping = await api.previewDepartmentDelete({ id: department.id });
  expect(mapping.references).toContainEqual({
    category: '工资凭证辅助核算映射',
    count: 1,
    to: '/m/payroll',
  });
  await expect(api.deleteDepartment({ ...mapping, confirmed: true })).rejects.toThrow(
    '工资凭证辅助核算映射',
  );
  expect(await app.svc.dimensions.get(department.id)).not.toBeNull();
});
