import { afterEach, beforeEach, expect, it } from 'vitest';
import { sql } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import payroll from '../server';
import { DEFAULT_FIELDS, TaxInputSchema, type Employee, type Batch } from '../shared';
import { employmentMonths, employedInPeriod } from '../shared-hr';

let app: TestApp;
const caller = (a: TestApp, token?: string) => a.call(payroll, token);
let api: ReturnType<typeof caller>, employee: Employee;
beforeEach(async () => {
  app = await createTestApp({ modules: [payroll], product: 'minfei' });
  api = caller(app);
  employee = await api.saveEmployee({
    code: 'HR001',
    name: '合成断续任职人员',
    departmentId: (await app.svc.dimensions.getByCode('department', '01'))!.id,
    startDate: '2026-01-01',
  });
});
afterEach(async () => app.close());

it('w_gz_rsgl 多段任职按月去重，跨年及月中返聘不重复享受扣除月份', () => {
  const e = {
    startDate: '2025-12-01',
    endDate: null,
    employmentSpells: [
      { startDate: '2025-12-01', endDate: '2026-01-15' },
      { startDate: '2026-01-20', endDate: '2026-01-31' },
      { startDate: '2026-03-01', endDate: null },
    ],
  };
  expect(employmentMonths(e, 202601)).toBe(1);
  expect(employmentMonths(e, 202602)).toBe(1);
  expect(employmentMonths(e, 202603)).toBe(2);
  expect(employedInPeriod(e, 202602)).toBe(false);
  expect(employedInPeriod(e, 202603)).toBe(true);
});

it('w_gz_rsgl 自定义文字及日期资料与断续任职保存，普通修改不会丢失资料', async () => {
  const fields = await api.saveHrFields({
    revision: 0,
    fields: [
      { key: 'position', name: '岗位', kind: 'text' },
      { key: 'contract', name: '合同日期', kind: 'date' },
    ],
  });
  const initial = await api.hrProfile({ id: employee.id });
  expect(initial.fieldsRevision).toBe(fields.revision);
  const saved = await api.saveHrProfile({
    ...initial,
    employmentSpells: [
      { startDate: '2026-01-01', endDate: '2026-01-31' },
      { startDate: '2026-03-01', endDate: null },
    ],
    basicValues: { position: '测试岗位', contract: '2026-03-01' },
  });
  expect(saved.employeeRevision).toBe(employee.revision + 1);
  const current = (await api.employees())[0]!;
  await api.saveEmployee({ ...current, name: '合成改名' });
  expect((await api.hrProfile({ id: employee.id })).basicValues).toEqual(saved.basicValues);
  expect((await api.hrProfile({ id: employee.id })).employmentSpells).toEqual(
    saved.employmentSpells,
  );
  await expect(
    api.saveEmployee({ ...(await api.employees())[0]!, startDate: '2026-02-01' }),
  ).rejects.toThrow('多段任职');
});

it('w_gz_rsgl 单段人员主档日期修改同步任职记录，保留自定义资料', async () => {
  await api.saveHrFields({
    revision: 0,
    fields: [{ key: 'position', name: '岗位', kind: 'text' }],
  });
  await api.saveHrProfile({
    ...(await api.hrProfile({ id: employee.id })),
    basicValues: { position: '原岗位' },
  });
  const current = (await api.employees())[0]!;
  await api.saveEmployee({ ...current, endDate: '2026-05-31' });
  expect(await api.hrProfile({ id: employee.id })).toMatchObject({
    basicValues: { position: '原岗位' },
    employmentSpells: [{ startDate: '2026-01-01', endDate: '2026-05-31' }],
  });
});

it('w_gz_rsgl 任职记录交叠、未离职再次入职和倒置日期均拒绝且无写入', async () => {
  const profile = await api.hrProfile({ id: employee.id });
  for (const employmentSpells of [
    [{ startDate: '2026-02-01', endDate: '2026-01-31' }],
    [
      { startDate: '2026-01-01', endDate: null },
      { startDate: '2026-03-01', endDate: null },
    ],
    [
      { startDate: '2026-01-01', endDate: '2026-03-01' },
      { startDate: '2026-03-01', endDate: null },
    ],
  ])
    await expect(api.saveHrProfile({ ...profile, employmentSpells })).rejects.toThrow();
  expect(await api.hrProfile({ id: employee.id })).toEqual(profile);
});

it('w_gz_rsgl 基本资料未知栏目、必填空白及无效日期拒绝，栏目使用后只能停用', async () => {
  const fields = await api.saveHrFields({
    revision: 0,
    fields: [{ key: 'contract', name: '合同日期', kind: 'date', required: true }],
  });
  const profile = await api.hrProfile({ id: employee.id });
  const invalidValues: Record<string, string>[] = [
    {},
    { contract: '2026-02-30' },
    { contract: '2026-02-01', unknown: 'x' },
  ];
  for (const basicValues of invalidValues)
    await expect(api.saveHrProfile({ ...profile, basicValues })).rejects.toThrow();
  expect(await api.hrProfile({ id: employee.id })).toEqual(profile);
  await api.saveHrProfile({ ...profile, basicValues: { contract: '2026-02-01' } });
  await expect(api.saveHrFields({ revision: fields.revision, fields: [] })).rejects.toThrow(
    '已有内容',
  );
  await expect(
    api.saveHrFields({
      revision: fields.revision,
      fields: [{ ...fields.fields[0]!, kind: 'text' }],
    }),
  ).rejects.toThrow('已有内容');
  expect(
    (
      await api.saveHrFields({
        revision: fields.revision,
        fields: [{ ...fields.fields[0]!, disabled: true }],
      })
    ).fields[0]!.disabled,
  ).toBe(true);
});

it('w_gz_rsgl 人员或栏目并发变更使基本资料版本失效，旧输入不能覆盖', async () => {
  const profile = await api.hrProfile({ id: employee.id });
  await api.saveEmployee({ ...employee, name: '并发改名' });
  await expect(api.saveHrProfile(profile)).rejects.toThrow('已经变化');
  const next = await api.hrProfile({ id: employee.id });
  await api.saveHrFields({ revision: 0, fields: [{ key: 'position', name: '岗位' }] });
  await expect(api.saveHrProfile(next)).rejects.toThrow('已经变化');
});

async function calculatedJanuary() {
  const category = await api.saveCategory({ name: '合成人事工资', fields: DEFAULT_FIELDS });
  const batch = await api.saveBatch({
    period: 202601,
    categoryId: category.id,
    categoryRevision: category.revision,
    rows: [
      {
        employeeId: employee.id,
        values: { base: 1000000 },
        tax: TaxInputSchema.parse({ confirmed: true }),
      },
    ],
  });
  await api.confirmTax();
  return api.calculate({ id: batch.id, revision: batch.revision });
}

it('w_gz_rsgl 已计算历史任职月数受保护，后续离职及返聘不改变旧工资快照', async () => {
  const batch = await calculatedJanuary(),
    profile = await api.hrProfile({ id: employee.id });
  await expect(
    api.saveHrProfile({
      ...profile,
      employmentSpells: [{ startDate: '2026-02-01', endDate: null }],
    }),
  ).rejects.toThrow('已计算历史');
  await api.saveHrProfile({
    ...profile,
    employmentSpells: [
      { startDate: '2026-01-01', endDate: '2026-01-31' },
      { startDate: '2026-03-01', endDate: null },
    ],
  });
  expect(await api.batch({ id: batch.id })).toEqual(batch);
});

it('w_gz_rsgl 返聘工资按断续任职月数累计计税，人事自定义资料不进入工资查询快照', async () => {
  await api.saveHrFields({ revision: 0, fields: [{ key: 'hr_note', name: '人事备注' }] });
  await api.saveHrProfile({
    ...(await api.hrProfile({ id: employee.id })),
    employmentSpells: [
      { startDate: '2026-01-01', endDate: '2026-01-31' },
      { startDate: '2026-03-01', endDate: null },
    ],
    basicValues: { hr_note: '仅人事可见的合成资料' },
  });
  const january = await calculatedJanuary();
  const march = await api.saveBatch({
    period: 202603,
    categoryId: january.categoryId,
    categoryRevision: january.category.revision,
    rows: [
      {
        employeeId: employee.id,
        values: { base: 1000000 },
        tax: TaxInputSchema.parse({ confirmed: true }),
      },
    ],
  });
  const result = await api.calculate({ id: march.id, revision: march.revision });
  expect(result.snapshots[0]!.detail.months).toBe(2);
  expect(result.snapshots[0]!.detail.expense).toBe(1000000);
  expect(result.snapshots[0]!.taxAmount).toBe(15000);
  const reader = caller(
    app,
    await app.addUser('salary_reader', { permissions: ['payroll.salary.view'] }),
  );
  const visible = await reader.batch({ id: result.id });
  expect(JSON.stringify(visible)).not.toContain('仅人事可见的合成资料');
  expect(JSON.stringify(visible)).not.toContain('hr_note');
});

it('w_gz_rsgl 人员删除须确认，工资引用阻止硬删除且保留人员', async () => {
  const plan = await api.previewEmployeeDelete({ id: employee.id, revision: employee.revision });
  await expect(
    api.deleteEmployee({
      id: employee.id,
      revision: employee.revision,
      hash: plan.hash,
      confirmed: false,
    }),
  ).rejects.toThrow('须明确确认');
  const batch = await calculatedJanuary();
  const referenced = await api.previewEmployeeDelete({
    id: employee.id,
    revision: employee.revision,
  });
  expect(referenced.references.map((r) => r.id)).toEqual([batch.id]);
  expect(referenced.allowed).toBe(false);
  await expect(
    api.deleteEmployee({
      id: employee.id,
      revision: employee.revision,
      hash: plan.hash,
      confirmed: true,
    }),
  ).rejects.toThrow('预览已失效');
  await expect(
    api.deleteEmployee({
      id: employee.id,
      revision: employee.revision,
      hash: referenced.hash,
      confirmed: true,
    }),
  ).rejects.toThrow('工资批次、历史快照或凭证设置引用');
  expect((await api.employees())[0]!.id).toBe(employee.id);
});

async function twoPersonBatch() {
  const second = await api.saveEmployee({
    code: 'HR002',
    name: '保留人员',
    departmentId: employee.departmentId,
    startDate: '2026-01-01',
  });
  const category = await api.saveCategory({ name: '历史引用工资', fields: DEFAULT_FIELDS });
  await api.confirmTax();
  const saved = await api.saveBatch({
    period: 202601,
    categoryId: category.id,
    categoryRevision: category.revision,
    rows: [employee, second].map((e) => ({
      employeeId: e.id,
      values: { base: 1000000 },
      tax: TaxInputSchema.parse({ confirmed: true }),
    })),
  });
  return api.calculate({ id: saved.id, revision: saved.revision });
}
async function removeAndRecalculate(batch: Batch) {
  const saved = await api.saveBatch({
    id: batch.id,
    revision: batch.revision,
    period: batch.period,
    categoryId: batch.categoryId,
    categoryRevision: batch.category.revision,
    rows: batch.rows.filter((r) => r.employeeId !== employee.id),
  });
  return api.calculate({ id: saved.id, revision: saved.revision });
}

it('w_gz_rsgl 从工资移除人员并重算后，重算前历史快照仍阻止硬删除', async () => {
  await removeAndRecalculate(await twoPersonBatch());
  const plan = await api.previewEmployeeDelete({ id: employee.id, revision: employee.revision });
  expect(plan.references).toEqual([]);
  expect(plan.archiveReferences).toEqual([expect.stringContaining('重算前快照')]);
  expect(plan.allowed).toBe(false);
  await expect(
    api.deleteEmployee({
      id: employee.id,
      revision: employee.revision,
      hash: plan.hash,
      confirmed: true,
    }),
  ).rejects.toThrow('历史快照');
  expect((await api.employees()).some((e) => e.id === employee.id)).toBe(true);
});

it('w_gz_rsgl 重算前快照更新后，更正审计中保留的人员仍不可删除', async () => {
  const batch = await twoPersonBatch();
  const input = {
    id: batch.id,
    revision: batch.revision,
    reason: '合成历史更正',
    rows: batch.rows.map((r) =>
      r.employeeId === employee.id ? { ...r, values: { ...r.values, base: 1100000 } } : r,
    ),
  };
  const plan = await api.previewCorrection(input);
  await api.applyCorrection({
    ...input,
    hash: plan.hash,
    expiresAt: plan.expiresAt,
    confirmed: true,
  });
  const removed = await removeAndRecalculate(await api.batch({ id: batch.id }));
  await removeAndRecalculate(removed);
  const deletion = await api.previewEmployeeDelete({
    id: employee.id,
    revision: employee.revision,
  });
  expect(deletion.references).toEqual([]);
  expect(deletion.archiveReferences.some((r) => r.includes('重算前快照'))).toBe(false);
  expect(deletion.archiveReferences).toEqual([expect.stringContaining('工资更正记录')]);
  expect(deletion.allowed).toBe(false);
  await expect(
    api.deleteEmployee({
      id: employee.id,
      revision: employee.revision,
      hash: deletion.hash,
      confirmed: true,
    }),
  ).rejects.toThrow('历史快照');
});

it('w_gz_rsgl 无工资行但仍被人员凭证辅助映射使用的档案不可删除', async () => {
  const category = await api.saveCategory({ name: '人员映射引用', fields: DEFAULT_FIELDS });
  const accountId = async (code: string) => (await app.svc.accounts.require(code)).id;
  const expense = (
      await app.svc.accounts.create(
        {
          code: '660201',
          name: '合成人员映射费用',
          dimensions: [{ type: 'person', required: true }],
        },
        (await app.svc.book.info()).codeScheme,
      )
    ).id,
    person = (await app.svc.dimensions.getByCode('person', 'P01'))!;
  await api.saveMapping({
    categoryId: category.id,
    mapping: {
      payableAccountId: await accountId('2211'),
      bankAccountId: await accountId('1001'),
      taxAccountId: await accountId('1001'),
      deductionAccountId: await accountId('1001'),
      expenseAccountId: expense,
      amountField: 'gross',
      allocationField: 'department',
      auxiliaries: [{ accountId: expense, employeeId: employee.id, values: { person: person.id } }],
    },
  });
  const plan = await api.previewEmployeeDelete({ id: employee.id, revision: employee.revision });
  expect(plan.references).toEqual([]);
  expect(plan.archiveReferences).toEqual([expect.stringContaining('人员凭证映射')]);
  expect(plan.allowed).toBe(false);
  await expect(
    api.deleteEmployee({
      id: employee.id,
      revision: employee.revision,
      hash: plan.hash,
      confirmed: true,
    }),
  ).rejects.toThrow('凭证设置引用');
});

it('w_gz_rsgl 存入失败数据没有删除，资料清理与人员删除整笔回滚后可重试', async () => {
  const saved = await api.saveHrProfile(await api.hrProfile({ id: employee.id }));
  const plan = await api.previewEmployeeDelete({
    id: employee.id,
    revision: saved.employeeRevision,
  });
  await sql`CREATE TRIGGER payroll_employee_delete_failure BEFORE DELETE ON payroll_employee BEGIN SELECT RAISE(ABORT,'synthetic employee delete failure'); END`.execute(
    app.svc.db,
  );
  await expect(
    api.deleteEmployee({
      id: employee.id,
      revision: saved.employeeRevision,
      hash: plan.hash,
      confirmed: true,
    }),
  ).rejects.toThrow('存入失败，人员和基本资料没有删除');
  expect(await api.hrProfile({ id: employee.id })).toEqual(saved);
  expect((await api.employees())[0]!.id).toBe(employee.id);
  await sql`DROP TRIGGER payroll_employee_delete_failure`.execute(app.svc.db);
  await api.deleteEmployee({
    id: employee.id,
    revision: saved.employeeRevision,
    hash: plan.hash,
    confirmed: true,
  });
  expect(await api.employees()).toEqual([]);
  await expect(api.hrProfile({ id: employee.id })).rejects.toThrow('人员不存在');
});

it('w_gz_rsgl 另存与打印数据按所选人员输出，基本资料与任职记录完整且导出需人事读取权限', async () => {
  await api.saveHrFields({ revision: 0, fields: [{ key: 'position', name: '岗位' }] });
  await api.saveHrProfile({
    ...(await api.hrProfile({ id: employee.id })),
    basicValues: { position: '岗位一' },
  });
  const output = await api.exportPersonnel({ ids: [employee.id] });
  expect(output.rows).toHaveLength(1);
  expect(output.rows[0]!.basicValues).toEqual({ position: '岗位一' });
  expect(output.fields.map((f) => f.name)).toEqual(['岗位']);
  await expect(api.exportPersonnel({ ids: [employee.id, employee.id] })).rejects.toThrow('不重复');
  const noHr = await app.addUser('no_hr', { permissions: ['payroll.export'] });
  await expect(caller(app, noHr).exportPersonnel({ ids: [employee.id] })).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  const readOnly = await app.addUser('hr_reader', { permissions: ['payroll.hr.view'] });
  await expect(
    caller(app, readOnly).saveHrProfile(await api.hrProfile({ id: employee.id })),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
