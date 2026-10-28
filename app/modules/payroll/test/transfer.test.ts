import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { sql } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import payroll from '../server';
import { DEFAULT_FIELDS } from '../shared';
import { capturePayrollState, backupPayrollModule } from '../server/transfer';
import type { PayrollTransferEnvelope } from '../shared-transfer';

let source: TestApp, target: TestApp;
beforeEach(async () => {
  source = await createTestApp({ modules: [payroll], product: 'minfei' });
  target = await createTestApp({ modules: [payroll], product: 'minfei' });
});
afterEach(async () => {
  await source.close();
  await target.close();
});
async function seed(app: TestApp, prefix: string, amount = 1000000) {
  const api = app.call(payroll),
    svc = app.svcFor('payroll'),
    department = (await api.departments())[0]!;
  const employee = await api.saveEmployee({
    code: `${prefix}001`,
    name: `合成${prefix}工资人员`,
    departmentId: department.id,
    startDate: '2026-01-01',
  });
  const category = await api.saveCategory({
    name: `合成${prefix}工资类别`,
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
  const fields = await api.saveHrFields({
    revision: 0,
    fields: [
      { key: 'contract', name: '合成合同号', kind: 'text', required: false, disabled: false },
    ],
  });
  await api.saveHrProfile({
    employeeId: employee.id,
    employeeRevision: employee.revision,
    fieldsRevision: fields.revision,
    employmentSpells: [{ startDate: '2026-01-01', endDate: null }],
    basicValues: { contract: `C-${prefix}` },
  });
  await api.confirmTax();
  const saved = await api.saveBatch({
    period: 202601,
    categoryId: category.id,
    categoryRevision: category.revision,
    rows: [
      {
        employeeId: employee.id,
        values: { base: amount, bonus: 12345 },
        quantities: { hours: '160.123456' },
        tax: { confirmed: true },
      },
    ],
  });
  const batch = await api.calculate({ id: saved.id, revision: saved.revision });
  return { api, svc, employee, category, batch, department };
}
const rewrite = (file: string, edit: (envelope: PayrollTransferEnvelope) => void) => {
  const envelope = JSON.parse(
    gunzipSync(Buffer.from(file, 'base64')).toString(),
  ) as PayrollTransferEnvelope;
  edit(envelope);
  const { sha256: _old, ...content } = envelope;
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value !== null && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, canonical(item)]),
          )
        : value;
  envelope.sha256 = createHash('sha256')
    .update(JSON.stringify(canonical(content)))
    .digest('hex');
  return gzipSync(JSON.stringify(envelope)).toString('base64');
};
it('w_xt_kmwh_copy 真实双账套专用文件映射、快照及人事资料完整转入，保护副本回装核验后可准确恢复目标', async () => {
  const from = await seed(source, '来源'),
    to = await seed(target, '目标', 2000000);
  const before = await capturePayrollState(to.svc),
    accounts = await target.svc.accounts.list();
  const extraDepartment = await target.svc.dimensions.create({
    type: 'department',
    code: '99',
    name: '合成目标映射部门',
  });
  await target.svcFor('masterdata').settings.set('other-module', '合成保留');
  const exported = await from.api.exportTransfer();
  const input = {
    file: exported.base64,
    mappings: [{ kind: 'department' as const, sourceCode: from.department.code, targetCode: '99' }],
  };
  const inspection = await to.api.inspectTransfer(input);
  expect(inspection.counts).toEqual({ categories: 1, employees: 1, batches: 1 });
  const plan = await to.api.previewTransfer(input);
  await expect(
    to.api.applyTransfer({
      ...input,
      hash: plan.hash,
      expiresAt: plan.expiresAt,
      confirmed: false,
      targetName: plan.targetName,
    }),
  ).rejects.toThrow('须明确确认');
  expect(await capturePayrollState(to.svc)).toEqual(before);
  const result = await to.api.applyTransfer({
    ...input,
    hash: plan.hash,
    expiresAt: plan.expiresAt,
    confirmed: true,
    targetName: plan.targetName,
  });
  const categories = await to.api.categories(),
    employees = await to.api.employees(),
    batches = await to.api.batches({});
  expect(categories[0]!.id).not.toBe(from.category.id);
  expect(employees[0]!.id).not.toBe(from.employee.id);
  expect(batches[0]!.id).not.toBe(from.batch.id);
  expect(employees[0]).toMatchObject({
    code: from.employee.code,
    departmentId: extraDepartment.id,
  });
  const imported = await to.api.batch({ id: batches[0]!.id });
  expect(imported.category.revision).toBe(categories[0]!.revision);
  expect(imported.snapshots[0]).toMatchObject({
    gross: from.batch.snapshots[0]!.gross,
    taxAmount: from.batch.snapshots[0]!.taxAmount,
    net: from.batch.snapshots[0]!.net,
    employeeId: employees[0]!.id,
    calculatedQuantities: { hours: '160.123456' },
  });
  expect(imported.snapshots[0]!.employee.departmentId).toBe(extraDepartment.id);
  expect((await to.api.hrProfile({ id: employees[0]!.id })).basicValues).toEqual({
    contract: 'C-来源',
  });
  expect(await to.api.transferOrigin({ id: imported.id })).toMatchObject({
    source_book_name: (await source.svc.book.info()).name,
    source_batch_id: from.batch.id,
  });
  expect(await target.svc.accounts.list()).toEqual(accounts);
  expect(await target.svcFor('masterdata').settings.get('other-module', null)).toBe('合成保留');
  const edited = await to.api.saveBatch({
    ...imported,
    categoryRevision: imported.category.revision,
    rows: imported.rows.map((r) => ({ ...r, values: { ...r.values, bonus: 13000 } })),
  });
  expect(edited.rows[0]!.values.bonus).toBe(13000);
  expect(edited.calculated).toBe(false);
  const recovery = await to.api.previewTransferRestore({ id: result.backup.id });
  await to.api.applyTransferRestore({
    id: result.backup.id,
    hash: recovery.hash,
    expiresAt: recovery.expiresAt,
    targetName: recovery.targetName,
    confirmed: true,
  });
  expect(await capturePayrollState(to.svc)).toEqual(before);
  expect(await to.api.batch({ id: to.batch.id })).toEqual(to.batch);
});
it('w_xt_kmwh_copy 缺少任一档案映射、摘要改变、目标并发或名称错误均拒绝覆盖', async () => {
  const from = await seed(source, '来源'),
    to = await seed(target, '目标');
  const exported = await from.api.exportTransfer(),
    input = { file: exported.base64, mappings: [] };
  const missing = {
    ...input,
    mappings: [
      { kind: 'department' as const, sourceCode: from.department.code, targetCode: '不存在' },
    ],
  };
  expect((await to.api.inspectTransfer(missing)).references.some((r) => !r.found)).toBe(true);
  await expect(to.api.previewTransfer(missing)).rejects.toThrow('尚未匹配');
  await expect(
    to.api.inspectTransfer({
      ...input,
      mappings: [{ kind: 'department', sourceCode: '不存在的来源编码', targetCode: '01' }],
    }),
  ).rejects.toThrow('来源档案不在工资文件');
  const plan = await to.api.previewTransfer(input);
  await expect(
    to.api.applyTransfer({
      ...input,
      hash: plan.hash,
      expiresAt: plan.expiresAt,
      confirmed: true,
      targetName: '错误目标',
    }),
  ).rejects.toThrow('目标名称');
  await to.api.saveEmployee({
    ...to.employee,
    revision: (await to.api.employees())[0]!.revision,
    name: '合成并发改名',
  });
  const before = await capturePayrollState(to.svc);
  await expect(
    to.api.applyTransfer({
      ...input,
      hash: plan.hash,
      expiresAt: plan.expiresAt,
      confirmed: true,
      targetName: plan.targetName,
    }),
  ).rejects.toThrow('预览');
  expect(await capturePayrollState(to.svc)).toEqual(before);
  const envelope = JSON.parse(
    gunzipSync(Buffer.from(input.file, 'base64')).toString(),
  ) as PayrollTransferEnvelope;
  envelope.source.name = '篡改';
  await expect(
    to.api.inspectTransfer({
      ...input,
      file: gzipSync(JSON.stringify(envelope)).toString('base64'),
    }),
  ).rejects.toThrow('摘要不一致');
});
it('w_xt_kmwh_copy 转入中途真实数据库失败完全回滚，故障清除后同计划重试成功且只留下成功备份', async () => {
  const from = await seed(source, '来源'),
    to = await seed(target, '目标'),
    before = await capturePayrollState(to.svc),
    input = { file: (await from.api.exportTransfer()).base64, mappings: [] };
  const plan = await to.api.previewTransfer(input);
  await sql`CREATE TRIGGER payroll_transfer_failure BEFORE INSERT ON payroll_employee WHEN NEW.code='来源001' BEGIN SELECT RAISE(ABORT,'synthetic payroll transfer failure'); END`.execute(
    to.svc.db,
  );
  await expect(
    to.api.applyTransfer({
      ...input,
      hash: plan.hash,
      expiresAt: plan.expiresAt,
      confirmed: true,
      targetName: plan.targetName,
    }),
  ).rejects.toThrow('synthetic payroll transfer failure');
  expect(await capturePayrollState(to.svc)).toEqual(before);
  expect(await to.api.transferBackups()).toEqual([]);
  await sql`DROP TRIGGER payroll_transfer_failure`.execute(to.svc.db);
  const result = await to.api.applyTransfer({
    ...input,
    hash: plan.hash,
    expiresAt: plan.expiresAt,
    confirmed: true,
    targetName: plan.targetName,
  });
  expect(result.backup.id).toBeGreaterThan(0);
  expect(await to.api.transferBackups()).toHaveLength(1);
});
it('w_xt_kmwh_copy 模块备份回装失败在任何覆盖前回滚，坏保护副本不可恢复', async () => {
  const to = await seed(target, '目标'),
    before = await capturePayrollState(to.svc);
  await sql`CREATE TRIGGER payroll_backup_failure BEFORE INSERT ON payroll_employee BEGIN SELECT RAISE(ABORT,'synthetic backup restore validation failure'); END`.execute(
    to.svc.db,
  );
  await expect(to.svc.tx((t) => backupPayrollModule(t, '合成验证失败'))).rejects.toThrow(
    'synthetic backup restore validation failure',
  );
  expect(await capturePayrollState(to.svc)).toEqual(before);
  expect(await to.api.transferBackups()).toEqual([]);
  await sql`DROP TRIGGER payroll_backup_failure`.execute(to.svc.db);
  const backup = await to.svc.tx((t) => backupPayrollModule(t, '合成验证通过'));
  await sql`UPDATE payroll_transfer_backup SET data='AAAA' WHERE id=${backup.id}`.execute(
    to.svc.db,
  );
  await expect(to.api.previewTransferRestore({ id: backup.id })).rejects.toThrow('无法读取');
  expect(await capturePayrollState(to.svc)).toEqual(before);
});
it('w_xt_kmwh_copy 账务闭期、工资来源及无完整权限均拒绝覆盖，不生成副本', async () => {
  const from = await seed(source, '来源'),
    to = await seed(target, '目标'),
    input = { file: (await from.api.exportTransfer()).base64, mappings: [] };
  await target.svc.periods.setStatus(202601, 'closed');
  await expect(to.api.previewTransfer(input)).rejects.toThrow(/结账/);
  await target.svc.periods.setStatus(202601, 'open');
  await target.svcFor('payroll').vouchers.create({
    date: '2026-01-20',
    voucherTypeId: (await target.svc.reference.voucherTypes())[0]!.id,
    source: { type: 'batch', id: '99999' },
    lines: [
      {
        accountId: (await target.svc.accounts.require('1001')).id,
        debit: 100,
        summary: '合成工资来源锁测试',
      },
      {
        accountId: (await target.svc.accounts.require('2211')).id,
        credit: 100,
        summary: '合成工资来源锁测试',
      },
    ],
  });
  await expect(to.api.previewTransfer(input)).rejects.toThrow('已有来源凭证');
  expect(await to.api.transferBackups()).toEqual([]);
  const token = await target.addUser('transfer-salary-only', {
    permissions: ['payroll.salary.edit'],
  });
  await expect(target.call(payroll, token).inspectTransfer(input)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
});
it('w_xt_kmwh_copy 非法快照金额、数量、悬空人员或错误本位币不能被合法文件摘要掩盖', async () => {
  const from = await seed(source, '来源'),
    to = await seed(target, '目标'),
    file = (await from.api.exportTransfer()).base64;
  await expect(
    to.api.inspectTransfer({
      file: rewrite(file, (e) => {
        e.state.rows[0]!.employee_id = 999999;
      }),
      mappings: [],
    }),
  ).rejects.toThrow();
  await expect(
    to.api.inspectTransfer({
      file: rewrite(file, (e) => {
        const row = JSON.parse(e.state.rows[0]!.snapshot_json!) as { net: number };
        row.net = 1;
        e.state.rows[0]!.snapshot_json = JSON.stringify(row);
      }),
      mappings: [],
    }),
  ).rejects.toThrow('实发金额');
  await expect(
    to.api.inspectTransfer({
      file: rewrite(file, (e) => {
        e.state.quantities[0]!.field_key = 'unknown_quantity';
      }),
      mappings: [],
    }),
  ).rejects.toThrow('数量对应栏目');
  await expect(
    to.api.inspectTransfer({
      file: rewrite(file, (e) => {
        const input = JSON.parse(e.state.rows[0]!.input_json) as { values: Record<string, number> };
        input.values.base = 1;
        e.state.rows[0]!.input_json = JSON.stringify(input);
      }),
      mappings: [],
    }),
  ).rejects.toThrow('历史快照输入不一致');
  await expect(
    to.api.inspectTransfer({
      file: rewrite(file, (e) => {
        const input = JSON.parse(e.state.rows[0]!.input_json) as { values: Record<string, number> };
        const snapshot = JSON.parse(e.state.rows[0]!.snapshot_json!) as {
          values: Record<string, number>;
        };
        input.values.base = 1;
        snapshot.values.base = 1;
        e.state.rows[0]!.input_json = JSON.stringify(input);
        e.state.rows[0]!.snapshot_json = JSON.stringify(snapshot);
      }),
      mappings: [],
    }),
  ).rejects.toThrow('输入金额与计算栏不一致');
  await expect(
    to.api.inspectTransfer({
      file: rewrite(file, (e) => {
        e.source.baseCurrency = 'USD';
      }),
      mappings: [],
    }),
  ).rejects.toThrow('本位币不同');
});
it('w_xt_kmwh_copy 凭证科目编码映射和独立打印设置随工资迁移，目标内部科目编号不同仍正确重绑', async () => {
  const from = await seed(source, '来源'),
    to = await seed(target, '目标');
  const sourceScheme = (await source.svc.book.info()).codeScheme,
    targetScheme = (await target.svc.book.info()).codeScheme;
  await source.svc.accounts.create(
    { code: '2241', name: '合成其他应付款', categoryId: 'liability' },
    sourceScheme,
  );
  await source.svc.accounts.create({ code: '222102', name: '合成个人所得税' }, sourceScheme);
  await target.svc.accounts.create({ code: '222102', name: '合成目标个人所得税' }, targetScheme);
  await target.svc.accounts.create(
    { code: '2241', name: '合成目标其他应付款', categoryId: 'liability' },
    targetScheme,
  );
  const account = async (app: TestApp, code: string) => (await app.svc.accounts.require(code)).id;
  const mapping = await from.api.saveMapping({
    categoryId: from.category.id,
    mapping: {
      payableAccountId: await account(source, '2211'),
      bankAccountId: await account(source, '1001'),
      taxAccountId: await account(source, '222102'),
      deductionAccountId: await account(source, '2241'),
      expenseAccountId: await account(source, '6602'),
      amountField: 'gross',
      allocationField: 'department',
      rules: [
        {
          kind: 'allocation',
          field: 'base',
          debitAccountId: await account(source, '6602'),
          creditAccountId: await account(source, '2211'),
          departmentId: from.department.id,
        },
      ],
    },
  });
  const layout = (await from.api.printLayouts({ categoryId: from.category.id })).layouts.table;
  await from.api.savePrintLayout({
    categoryId: from.category.id,
    categoryRevision: from.category.revision,
    layout: { ...layout, title: '合成来源独立工资表', footer: '合成来源页脚' },
  });
  const input = { file: (await from.api.exportTransfer()).base64, mappings: [] },
    plan = await to.api.previewTransfer(input);
  await to.api.applyTransfer({
    ...input,
    hash: plan.hash,
    expiresAt: plan.expiresAt,
    confirmed: true,
    targetName: plan.targetName,
  });
  const category = (await to.api.categories())[0]!,
    imported = await to.api.mapping({ categoryId: category.id });
  expect(imported!.taxAccountId).toBe(await account(target, '222102'));
  expect(imported!.deductionAccountId).toBe(await account(target, '2241'));
  expect(imported!.taxAccountId).not.toBe(mapping.taxAccountId);
  expect((await to.api.printLayouts({ categoryId: category.id })).layouts.table).toMatchObject({
    title: '合成来源独立工资表',
    footer: '合成来源页脚',
  });
});
it('w_xt_kmwh_copy 来源前期更正审计的批次和人员均重绑，来源操作员标识明确保留', async () => {
  const from = await seed(source, '来源'),
    to = await seed(target, '目标');
  const correction = {
    id: from.batch.id,
    revision: from.batch.revision,
    reason: '合成来源更正',
    rows: from.batch.rows.map((r) => ({ ...r, values: { ...r.values, bonus: 20000 } })),
  };
  const correctionPlan = await from.api.previewCorrection(correction);
  await from.api.applyCorrection({
    ...correction,
    hash: correctionPlan.hash,
    expiresAt: correctionPlan.expiresAt,
    confirmed: true,
  });
  const input = { file: (await from.api.exportTransfer()).base64, mappings: [] },
    plan = await to.api.previewTransfer(input);
  await to.api.applyTransfer({
    ...input,
    hash: plan.hash,
    expiresAt: plan.expiresAt,
    confirmed: true,
    targetName: plan.targetName,
  });
  const batch = (await to.api.batches({}))[0]!,
    employee = (await to.api.employees())[0]!,
    audits = await to.api.correctionHistory({ id: batch.id });
  expect(audits).toHaveLength(1);
  expect(audits[0]!.userName).toContain('来源账套');
  expect(audits[0]!.reason).toBe('导入历史：合成来源更正');
  expect(audits[0]!.before[0]!.id).toBe(batch.id);
  expect(audits[0]!.after[0]!.rows[0]!.employeeId).toBe(employee.id);
  expect(audits[0]!.after[0]!.snapshots[0]!.employee.id).toBe(employee.id);
});
