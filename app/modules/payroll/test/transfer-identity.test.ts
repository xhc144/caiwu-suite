import { gzipSync } from 'node:zlib';
import { sql } from '@caiwu/db';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import payroll from '../server';
import { DEFAULT_FIELDS } from '../shared';
import { capturePayrollState } from '../server/transfer';
let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [payroll], product: 'minfei' });
});
afterEach(() => app.close());
async function initializedBackup() {
  const api = app.call(payroll),
    department = await api.createDepartment({ code: 'ZZIDENTITY', name: '合成原始部门' });
  await api.saveEmployee({
    code: 'IDENTITY1',
    name: '合成备份身份人员',
    departmentId: department.id,
    startDate: '2026-01-01',
  });
  await api.saveCategory({ name: '合成身份工资', fields: DEFAULT_FIELDS });
  const portable = await api.exportTransfer();
  const options = {
    startPeriod: 202601,
    preserveData: false,
    keepArchives: false,
    password: 'admin',
  };
  const plan = await api.previewInitialization(options);
  const initialized = await api.applyInitialization({
    ...options,
    hash: plan.hash,
    expiresAt: plan.expiresAt,
    confirmed: true,
    confirmation: '初始化工资',
  });
  return { api, department, backup: initialized.backup, file: portable.base64 };
}
it.each(['partner', 'department'] as const)(
  'w_xt_kmwh_copy 已删除部门ID被%s复用时恢复明确拒绝，不能把工资人员绑到新档案',
  async (type) => {
    const { api, department, backup } = await initializedBackup(),
      svc = app.svcFor('payroll');
    const plan = await app.svc.dimensions.previewDelete(department.id);
    await app.svc.dimensions.delete(plan, true);
    const replacement = await app.svc.dimensions.create({
      type,
      code: 'REUSED-ID',
      name: '合成复用编号档案',
    });
    expect(replacement.id).toBe(department.id);
    const before = await capturePayrollState(svc);
    await expect(api.previewTransferRestore({ id: backup.id })).rejects.toThrow(/身份|编码|档案/);
    expect(await capturePayrollState(svc)).toEqual(before);
    expect(await api.employees()).toEqual([]);
    expect(await api.transferBackups()).toHaveLength(1);
  },
);
it('w_xt_kmwh_copy 覆盖计划改写期限不能沿用旧hash', async () => {
  const { api, file } = await initializedBackup(),
    svc = app.svcFor('payroll');
  const input = { file, mappings: [] },
    plan = await api.previewTransfer(input),
    before = await capturePayrollState(svc);
  await expect(
    api.applyTransfer({
      ...input,
      hash: plan.hash,
      expiresAt: new Date(Date.parse(plan.expiresAt) - 1000).toISOString(),
      targetName: plan.targetName,
      confirmed: true,
    }),
  ).rejects.toThrow('预览');
  expect(await capturePayrollState(svc)).toEqual(before);
});

it('w_xt_kmwh_copy 恢复确认事务再次核对部门身份，预览后替换档案不得回装或新增副本', async () => {
  const { api, department, backup } = await initializedBackup(),
    svc = app.svcFor('payroll'),
    plan = await api.previewTransferRestore({ id: backup.id });
  await app.svc.dimensions.delete(await app.svc.dimensions.previewDelete(department.id), true);
  await app.svc.dimensions.create({
    type: 'partner',
    code: 'REUSED-AFTER-PREVIEW',
    name: '合成预览后替换',
  });
  const before = await capturePayrollState(svc);
  await expect(api.applyTransferRestore({ ...plan, confirmed: true })).rejects.toThrow(/身份|编码/);
  expect(await capturePayrollState(svc)).toEqual(before);
  expect(await api.transferBackups()).toHaveLength(1);
});
it('w_xt_kmwh_copy 旧无身份保护副本明确拒绝并保留当前数据', async () => {
  const { api, backup } = await initializedBackup(),
    svc = app.svcFor('payroll'),
    before = await capturePayrollState(svc);
  await sql`UPDATE payroll_transfer_backup SET data=${gzipSync(JSON.stringify(before)).toString('base64')} WHERE id=${backup.id}`.execute(
    svc.db,
  );
  await expect(api.previewTransferRestore({ id: backup.id })).rejects.toThrow(
    '缺少可核验的档案身份',
  );
  expect(await capturePayrollState(svc)).toEqual(before);
});
it('w_xt_kmwh_copy 恢复计划期限和操作员绑定，改时间或换操作员均拒绝旧hash', async () => {
  const { api, backup } = await initializedBackup(),
    svc = app.svcFor('payroll'),
    plan = await api.previewTransferRestore({ id: backup.id }),
    before = await capturePayrollState(svc);
  await expect(
    api.applyTransferRestore({
      ...plan,
      expiresAt: new Date(Date.parse(plan.expiresAt) - 1000).toISOString(),
      confirmed: true,
    }),
  ).rejects.toThrow('预览');
  const token = await app.addUser('restore-peer', {
    permissions: [
      'payroll.salary.edit',
      'payroll.hr.edit',
      'payroll.voucher',
      'payroll.tax.configure',
    ],
  });
  await expect(
    app.call(payroll, token).applyTransferRestore({ ...plan, confirmed: true }),
  ).rejects.toThrow('预览');
  expect(await capturePayrollState(svc)).toEqual(before);
});
it('w_xt_kmwh_copy 已过期覆盖计划不能通过改成新期限续期', async () => {
  const { api, file } = await initializedBackup(),
    svc = app.svcFor('payroll'),
    input = { file, mappings: [] },
    plan = await api.previewTransfer(input),
    before = await capturePayrollState(svc);
  const future = Date.parse(plan.expiresAt) + 60000,
    clock = vi.spyOn(Date, 'now').mockReturnValue(future);
  try {
    await expect(
      api.applyTransfer({
        ...input,
        hash: plan.hash,
        expiresAt: new Date(future + 300000).toISOString(),
        targetName: plan.targetName,
        confirmed: true,
      }),
    ).rejects.toThrow('预览');
  } finally {
    clock.mockRestore();
  }
  expect(await capturePayrollState(svc)).toEqual(before);
});
