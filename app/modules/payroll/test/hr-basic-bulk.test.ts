import { beforeEach, afterEach, it, expect } from 'vitest';
import { sql } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import payroll from '../server';
import type { Employee } from '../shared';

let app: TestApp;
const caller = (a: TestApp, token?: string) => a.call(payroll, token);
let api: ReturnType<typeof caller>, people: Employee[];
beforeEach(async () => {
  app = await createTestApp({ modules: [payroll], product: 'minfei' });
  api = caller(app);
  people = [];
  const departmentId = (await app.svc.dimensions.getByCode('department', '01'))!.id;
  await api.saveHrFields({
    revision: 0,
    fields: [
      { key: 'position', name: '岗位', kind: 'text' },
      { key: 'contract', name: '合同日期', kind: 'date' },
    ],
  });
  for (let i = 1; i <= 3; i++)
    people.push(
      await api.saveEmployee({
        code: `B00${i}`,
        name: `合成基本项${i}`,
        departmentId,
        startDate: '2026-01-01',
      }),
    );
  await api.saveHrProfile({
    ...(await api.hrProfile({ id: people[0]!.id })),
    basicValues: { position: '已有岗位', contract: '2026-01-01' },
  });
});
afterEach(async () => app.close());
const profiles = () => Promise.all(people.map((e) => api.hrProfile({ id: e.id })));

it('w_gz_edit_set 自定义基本项所选范围预览取消确认，空白补值保留已有和范围外内容', async () => {
  const before = await profiles();
  const input = {
    employeeIds: people.slice(0, 2).map((e) => e.id),
    field: 'position',
    value: '统一岗位',
    onlyEmpty: true,
  };
  const plan = await api.previewHrBasicBulk(input);
  expect(plan.preview.map((r) => [r.before, r.after, r.changed])).toEqual([
    ['已有岗位', '已有岗位', false],
    ['', '统一岗位', true],
  ]);
  await expect(
    api.applyHrBasicBulk({ ...input, hash: plan.hash, confirmed: false }),
  ).rejects.toThrow('须确认预览');
  expect(await profiles()).toEqual(before);
  expect(await api.applyHrBasicBulk({ ...input, hash: plan.hash, confirmed: true })).toEqual({
    changed: 1,
  });
  const after = await profiles();
  expect(after[0]).toEqual(before[0]);
  expect(after[1]!.basicValues).toEqual({ position: '统一岗位' });
  expect(after[2]).toEqual(before[2]);
});

it('w_gz_edit_set 人员或栏目变更使自定义资料预览失效，不覆盖期间编辑的新资料', async () => {
  const input = { employeeIds: [people[0]!.id], field: 'position', value: '旧预览岗位' };
  const plan = await api.previewHrBasicBulk(input);
  const current = await api.hrProfile({ id: people[0]!.id });
  await api.saveHrProfile({
    ...current,
    basicValues: { ...current.basicValues, position: '新编辑岗位' },
  });
  await expect(
    api.applyHrBasicBulk({ ...input, hash: plan.hash, confirmed: true }),
  ).rejects.toThrow('预览已失效');
  expect((await api.hrProfile({ id: people[0]!.id })).basicValues.position).toBe('新编辑岗位');
  const next = await api.previewHrBasicBulk(input),
    schema = await api.hrFields();
  await api.saveHrFields({
    ...schema,
    fields: schema.fields.map((f) => (f.key === 'position' ? { ...f, name: '岗位名称' } : f)),
  });
  await expect(
    api.applyHrBasicBulk({ ...input, hash: next.hash, confirmed: true }),
  ).rejects.toThrow('预览已失效');
  expect((await api.hrProfile({ id: people[0]!.id })).basicValues.position).toBe('新编辑岗位');
});

it('w_gz_edit_set 自定义资料保存失败时前面人员同事务回滚，预览和输入可重试', async () => {
  const before = await profiles(),
    input = {
      employeeIds: people.slice(0, 2).map((e) => e.id),
      field: 'position',
      value: '整批新岗位',
    };
  const plan = await api.previewHrBasicBulk(input);
  await sql`CREATE TRIGGER payroll_hr_bulk_failure BEFORE INSERT ON payroll_hr_profile WHEN NEW.employee_id=(SELECT id FROM payroll_employee WHERE code='B002') BEGIN SELECT RAISE(ABORT,'synthetic hr bulk failure'); END`.execute(
    app.svc.db,
  );
  await expect(
    api.applyHrBasicBulk({ ...input, hash: plan.hash, confirmed: true }),
  ).rejects.toThrow('基本资料保存失败，本次修改没有写入');
  expect(await profiles()).toEqual(before);
  await sql`DROP TRIGGER payroll_hr_bulk_failure`.execute(app.svc.db);
  const retry = await api.previewHrBasicBulk(input);
  expect(await api.applyHrBasicBulk({ ...input, hash: retry.hash, confirmed: true })).toEqual({
    changed: 2,
  });
  const after = await profiles();
  expect(after.slice(0, 2).map((p) => p.basicValues.position)).toEqual([
    '整批新岗位',
    '整批新岗位',
  ]);
  expect(after[0]!.basicValues.contract).toBe('2026-01-01');
  expect(after[2]).toEqual(before[2]);
});

it('w_gz_edit_set 自定义资料禁止未知和停用栏目、重复范围及无效日期', async () => {
  const before = await profiles();
  const input = { employeeIds: [people[0]!.id], field: 'contract', value: '2026-02-30' };
  await expect(api.previewHrBasicBulk(input)).rejects.toThrow('日期无效');
  await expect(api.previewHrBasicBulk({ ...input, field: 'unknown' })).rejects.toThrow(
    '不存在或已停用',
  );
  await expect(
    api.previewHrBasicBulk({ ...input, employeeIds: [people[0]!.id, people[0]!.id] }),
  ).rejects.toThrow('重复人员');
  const schema = await api.hrFields();
  await api.saveHrFields({
    ...schema,
    fields: schema.fields.map((f) => (f.key === 'contract' ? { ...f, disabled: true } : f)),
  });
  await expect(api.previewHrBasicBulk({ ...input, value: '2026-02-01' })).rejects.toThrow(
    '不存在或已停用',
  );
  expect((await profiles()).map((p) => p.basicValues)).toEqual(before.map((p) => p.basicValues));
});

it('w_gz_edit_set 自定义资料预览及应用同时要求人事读取和维护权限，工资权限不能读取', async () => {
  const input = { employeeIds: [people[0]!.id], field: 'position', value: '越权改名' };
  const editOnly = caller(
    app,
    await app.addUser('edit_only', { permissions: ['payroll.hr.edit'] }),
  );
  const salaryOnly = caller(
    app,
    await app.addUser('salary_only', { permissions: ['payroll.salary.view'] }),
  );
  const plan = await api.previewHrBasicBulk(input);
  for (const limited of [editOnly, salaryOnly]) {
    await expect(limited.previewHrBasicBulk(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      limited.applyHrBasicBulk({ ...input, hash: plan.hash, confirmed: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  }
  expect((await api.hrProfile({ id: people[0]!.id })).basicValues.position).toBe('已有岗位');
});
