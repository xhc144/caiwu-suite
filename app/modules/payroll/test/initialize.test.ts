import { afterEach, beforeEach, expect, it } from 'vitest';
import { sql } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import payroll from '../server';
import { DEFAULT_FIELDS } from '../shared';
import {
  capturePayrollState,
  previewPayrollRestore,
  restorePayrollBackup,
} from '../server/transfer';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [payroll], product: 'minfei' });
});
afterEach(async () => app.close());
async function setup() {
  const api = app.call(payroll);
  const department = (await api.departments())[0]!;
  const employee = await api.saveEmployee({
    code: 'INI001',
    name: '合成初始化人员',
    departmentId: department.id,
    startDate: '2026-01-01',
  });
  const category = await api.saveCategory({
    name: '合成初始化工资',
    fields: [
      ...DEFAULT_FIELDS,
      {
        ...DEFAULT_FIELDS[0]!,
        key: 'hours',
        name: '合成工时',
        kind: 'quantity',
        role: 'memo',
        unit: '小时',
      },
    ],
  });
  await api.confirmTax();
  const saved = await api.saveBatch({
    period: 202601,
    categoryId: category.id,
    categoryRevision: category.revision,
    rows: [
      {
        employeeId: employee.id,
        values: { base: 1_000_000 },
        quantities: { hours: '160.123456' },
        tax: { confirmed: true },
      },
    ],
  });
  const batch = await api.calculate({ id: saved.id, revision: saved.revision });
  const svc = app.svcFor('payroll');
  return { api, employee, category, batch, svc };
}
const options = {
  startPeriod: 202602,
  preserveData: false,
  keepArchives: false,
  password: 'admin',
};

it('w_xt_kgzb_gz 全清前真实回装备份，清后可恢复全部工资/数量/设置，不碰其他模块及核心档案', async () => {
  const { api, batch, svc } = await setup();
  const source = await capturePayrollState(svc);
  const accounts = await app.svc.accounts.list(),
    departments = await app.svc.dimensions.items('department');
  await app.svcFor('masterdata').settings.set('synthetic-preserved', { value: '其它模块数据' });
  const ordinary = await app.svc.vouchers.create({
    date: '2026-01-31',
    voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
    lines: [
      {
        accountId: (await app.svc.accounts.require('1001')).id,
        summary: '合成其他业务现金',
        debit: 12345,
      },
      {
        accountId: (await app.svc.accounts.require('2211')).id,
        summary: '合成其他业务应付',
        credit: 12345,
      },
    ],
  });
  const plan = await api.previewInitialization(options);
  expect(plan.counts).toMatchObject({
    categories: 1,
    employees: 1,
    batches: 1,
    rows: 1,
    quantities: 1,
  });
  expect(plan.retained).toEqual({ categories: 0, employees: 0, batches: 0, rows: 0 });
  const result = await api.applyInitialization({
    ...options,
    hash: plan.hash,
    expiresAt: plan.expiresAt,
    confirmed: true,
    confirmation: '初始化工资',
  });
  expect(result.backup.id).toBeGreaterThan(0);
  const cleared = await capturePayrollState(svc);
  expect(cleared.batches).toEqual([]);
  expect(cleared.employees).toEqual([]);
  expect(cleared.quantities).toEqual([]);
  expect(await svc.settings.get('initializedStartPeriod', 0)).toBe(202602);
  expect(await app.svc.accounts.list()).toEqual(accounts);
  expect(await app.svc.vouchers.get(ordinary.id)).toEqual(ordinary);
  expect(await app.svc.dimensions.items('department')).toEqual(departments);
  expect(await app.svcFor('masterdata').settings.get('synthetic-preserved', null)).toEqual({
    value: '其它模块数据',
  });
  const recovery = await previewPayrollRestore(svc, result.backup.id);
  expect(recovery.after).toEqual({ employees: 1, batches: 1 });
  await restorePayrollBackup(svc, {
    id: recovery.id,
    hash: recovery.hash,
    expiresAt: recovery.expiresAt,
    confirmed: true,
    targetName: recovery.targetName,
  });
  expect(await capturePayrollState(svc)).toEqual(source);
  expect(await api.batch({ id: batch.id })).toEqual(batch);
  expect(await app.svc.accounts.list()).toEqual(accounts);
});

it('w_xt_kgzb_gz 保留原工资数据及档案完整保留累计来源，新启用期间限制新录入', async () => {
  const { api, category, employee, batch, svc } = await setup();
  const retain = { ...options, preserveData: true };
  const source = await capturePayrollState(svc);
  const plan = await api.previewInitialization(retain);
  expect(plan.retained).toEqual({ categories: 1, employees: 1, batches: 1, rows: 1 });
  await api.applyInitialization({
    ...retain,
    hash: plan.hash,
    expiresAt: plan.expiresAt,
    confirmed: true,
    confirmation: '初始化工资',
  });
  const retained = await capturePayrollState(svc);
  expect(retained.batches).toEqual(source.batches);
  expect(retained.rows).toEqual(source.rows);
  expect(retained.quantities).toEqual(source.quantities);
  expect(await api.batch({ id: batch.id })).toEqual(batch);
  await expect(api.saveBatch({ ...batch, categoryRevision: category.revision })).rejects.toThrow(
    '早于启用期间',
  );
  await expect(api.calculate({ id: batch.id, revision: batch.revision })).rejects.toThrow(
    '早于启用期间',
  );
  await expect(
    api.previewCorrection({
      id: batch.id,
      revision: batch.revision,
      reason: '合成边界更正',
      rows: batch.rows,
    }),
  ).rejects.toThrow('早于启用期间');
  await expect(
    api.close({ id: batch.id, revision: batch.revision, confirmed: true }),
  ).rejects.toThrow('早于启用期间');
  await expect(
    api.preview({ id: batch.id, revision: batch.revision, kind: 'allocation', date: '2026-01-31' }),
  ).rejects.toThrow('早于启用期间');
  expect(await api.batch({ id: batch.id })).toEqual(batch);
  const fresh = await api.saveBatch({
    period: 202602,
    categoryId: category.id,
    categoryRevision: category.revision,
    rows: [{ employeeId: employee.id, values: { base: 1_000_000 }, tax: { confirmed: true } }],
  });
  expect(fresh.period).toBe(202602);
  const calculated = await api.calculate({ id: fresh.id, revision: fresh.revision });
  expect(calculated.snapshots[0]!.detail.income).toBe(2_000_000);
  expect(calculated.snapshots[0]!.detail.allocatedTax).toBe(batch.snapshots[0]!.taxAmount);
  expect(await api.batch({ id: batch.id })).toEqual(batch);
});

it('w_xt_kgzb_gz 仅保留档案时删除工资并保留人事资料、结构及设置', async () => {
  const { api, svc } = await setup();
  const before = await capturePayrollState(svc);
  const keep = { ...options, keepArchives: true };
  const plan = await api.previewInitialization(keep);
  await api.applyInitialization({
    ...keep,
    hash: plan.hash,
    expiresAt: plan.expiresAt,
    confirmed: true,
    confirmation: '初始化工资',
  });
  const after = await capturePayrollState(svc);
  expect(after.employees).toEqual(before.employees);
  expect(after.categories).toEqual(before.categories);
  expect(after.profiles).toEqual(before.profiles);
  expect(after.rows).toEqual([]);
  expect(after.batches).toEqual([]);
  expect(after.quantities).toEqual([]);
});

it('w_xt_kgzb_gz 完整管理员密码、显式确认、预览有效期及版本均复核，拒绝不清数据不留副本', async () => {
  const { api, employee, svc } = await setup();
  await app.svc.users.setPassword(1, 'CompleteAdminPassword123!');
  const correct = { ...options, password: 'CompleteAdminPassword123!' };
  for (const password of ['admin', 'Complete', 'COMPLETE'])
    await expect(api.previewInitialization({ ...options, password })).rejects.toThrow('密码不正确');
  const plan = await api.previewInitialization(correct);
  await expect(
    api.applyInitialization({
      ...correct,
      hash: plan.hash,
      expiresAt: plan.expiresAt,
      confirmed: false,
      confirmation: '初始化工资',
    }),
  ).rejects.toThrow('须明确确认');
  await expect(
    api.applyInitialization({
      ...correct,
      hash: plan.hash,
      expiresAt: 0,
      confirmed: true,
      confirmation: '初始化工资',
    }),
  ).rejects.toThrow('已过期');
  const changed = await api.saveEmployee({ ...employee, name: '合成并发更新人员' });
  const before = await capturePayrollState(svc);
  await expect(
    api.applyInitialization({
      ...correct,
      hash: plan.hash,
      expiresAt: plan.expiresAt,
      confirmed: true,
      confirmation: '初始化工资',
    }),
  ).rejects.toThrow('已变化');
  expect((await api.employees())[0]?.name).toBe(changed.name);
  expect(await capturePayrollState(svc)).toEqual(before);
  const backups = await sql<{
    count: number;
  }>`SELECT count(*) AS count FROM payroll_transfer_backup`.execute(svc.db);
  expect(backups.rows[0]?.count).toBe(0);
  const token = await app.addUser('initialize-clerk', { permissions: ['payroll.initialize'] });
  await expect(app.call(payroll, token).previewInitialization(correct)).rejects.toThrow(
    '仅限当前账套管理员',
  );
});

it('w_xt_kgzb_gz 工资已结账、账务闭期及任一未审核工资来源凭证都阻止清空', async () => {
  const { api, category, batch, svc } = await setup();
  const source = await capturePayrollState(svc);
  await app.svc.periods.setStatus(202601, 'closed');
  await expect(api.previewInitialization(options)).rejects.toThrow('结账');
  expect(await capturePayrollState(svc)).toEqual(source);
  await app.svc.periods.setStatus(202601, 'open');
  const account = async (code: string) => (await app.svc.accounts.require(code)).id;
  await api.saveMapping({
    categoryId: category.id,
    mapping: {
      payableAccountId: await account('2211'),
      bankAccountId: await account('1001'),
      taxAccountId: await account('1001'),
      deductionAccountId: await account('1001'),
      expenseAccountId: await account('6602'),
      amountField: 'gross',
      allocationField: 'department',
    },
  });
  const input = {
    id: batch.id,
    revision: batch.revision,
    kind: 'allocation' as const,
    date: '2026-01-31',
  };
  const plan = await api.preview(input);
  const generated = await api.generate({ ...input, hash: plan.hash });
  await expect(api.previewInitialization(options)).rejects.toThrow('已有来源凭证');
  expect(await api.batch({ id: batch.id })).toEqual(generated);
});

it('w_xt_kgzb_gz 模块冻结也阻止初始化，不因账务期间开放而绕过', async () => {
  const { api, batch, svc } = await setup();
  await api.close({ id: batch.id, revision: batch.revision, confirmed: true });
  const state = await capturePayrollState(svc);
  await expect(api.previewInitialization(options)).rejects.toThrow('已结账月份');
  expect(await capturePayrollState(svc)).toEqual(state);
});

it('w_xt_kgzb_gz 备份后清空中途失败则工资、设置和保护副本一起回滚', async () => {
  const { api, svc } = await setup();
  const before = await capturePayrollState(svc);
  const plan = await api.previewInitialization(options);
  await sql`CREATE TRIGGER payroll_initialize_test_failure BEFORE INSERT ON book_setting WHEN NEW.scope='payroll' AND NEW.key='initializedStartPeriod' BEGIN SELECT RAISE(ABORT,'synthetic initialize failure'); END`.execute(
    svc.db,
  );
  await expect(
    api.applyInitialization({
      ...options,
      hash: plan.hash,
      expiresAt: plan.expiresAt,
      confirmed: true,
      confirmation: '初始化工资',
    }),
  ).rejects.toThrow('synthetic initialize failure');
  expect(await capturePayrollState(svc)).toEqual(before);
  const backups = await sql<{
    count: number;
  }>`SELECT count(*) AS count FROM payroll_transfer_backup`.execute(svc.db);
  expect(backups.rows[0]?.count).toBe(0);
});

it('w_xt_kgzb_gz 旧数据存在未登记链接的工资来源凭证也不能清空', async () => {
  const { api, batch, svc } = await setup();
  const before = await capturePayrollState(svc);
  const source = await svc.vouchers.create({
    date: '2026-01-31',
    voucherTypeId: (await svc.reference.voucherTypes())[0]!.id,
    source: { type: 'batch', id: String(batch.id) },
    lines: [
      {
        accountId: (await app.svc.accounts.require('1001')).id,
        summary: '合成旧来源现金',
        debit: 12345,
      },
      {
        accountId: (await app.svc.accounts.require('2211')).id,
        summary: '合成旧来源应付',
        credit: 12345,
      },
    ],
  });
  await expect(api.previewInitialization(options)).rejects.toThrow('已有来源凭证');
  expect(await capturePayrollState(svc)).toEqual(before);
  expect(await svc.vouchers.get(source.id)).toEqual(source);
});
