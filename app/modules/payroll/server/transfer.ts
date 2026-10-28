import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { DIMENSION_TYPES, zCents, zPeriod, BusinessError } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { Generated } from '@caiwu/db';
import {
  PayrollModuleStateSchema,
  PayrollTransferEnvelopeSchema,
  PayrollTransferInputSchema,
  type PayrollModuleState,
  type PayrollTransferEnvelope,
  type PayrollTransferInput,
} from '../shared-transfer';
import {
  CategorySchema,
  EmployeeSchema,
  RowInputSchema,
  QuantitySchema,
  type SalaryRow,
  type Batch,
  type Category,
} from '../shared';
import { EmploymentSpellSchema, HrFieldsSchema } from '../shared-hr';
import { VoucherMappingSchema } from '../shared-voucher';
import { PayrollPrintLayoutSchema } from '../shared-print';
import {
  decodeSalaryRow,
  decodeSalaryRows,
  encodeSalaryRow,
  encodeSalaryRows,
  decodeBatches,
  encodeBatches,
  quantityFromE6,
  quantityToE6,
} from '../quantity';
import { fail, validateCategory, sum } from './engine';
import type { PayrollTables } from './migrations';

type TransferTables = PayrollTables & {
  payroll_hr_profile: { employee_id: number; employment_json: string; values_json: string };
  payroll_transfer_backup: {
    id: Generated<number>;
    created_at: string;
    hash: string;
    data: string;
    reason: string;
  };
  payroll_transfer_origin: PayrollModuleState['origins'][number];
};
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
const digest = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const pack = (value: unknown) =>
  gzipSync(Buffer.from(JSON.stringify(value)), { level: 6 }).toString('base64');
function unpack(file: string, maxLength = 700000): unknown {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(file) || file.length > maxLength)
    fail('TRANSFER_FILE', '工资转入文件格式或大小无效');
  try {
    return JSON.parse(
      gunzipSync(Buffer.from(file, 'base64'), { maxOutputLength: 24 * 1024 * 1024 }).toString(
        'utf8',
      ),
    ) as unknown;
  } catch {
    fail('TRANSFER_FILE', '无法读取工资转入文件', '请选择本系统导出的工资文件');
  }
}
export async function capturePayrollState(svc: CoreServices): Promise<PayrollModuleState> {
  const db = svc.db.withTables<TransferTables>();
  return PayrollModuleStateSchema.parse({
    categories: await db.selectFrom('payroll_category').selectAll().orderBy('id').execute(),
    employees: await db.selectFrom('payroll_employee').selectAll().orderBy('id').execute(),
    batches: await db.selectFrom('payroll_batch').selectAll().orderBy('id').execute(),
    rows: await db
      .selectFrom('payroll_row')
      .selectAll()
      .orderBy('batch_id')
      .orderBy('employee_id')
      .execute(),
    quantities: await db
      .selectFrom('payroll_quantity')
      .selectAll()
      .orderBy('batch_id')
      .orderBy('employee_id')
      .orderBy('field_key')
      .execute(),
    periods: await db
      .selectFrom('payroll_period')
      .selectAll()
      .orderBy('period')
      .orderBy('category_id')
      .execute(),
    profiles: await db
      .selectFrom('payroll_hr_profile')
      .selectAll()
      .orderBy('employee_id')
      .execute(),
    corrections: await db.selectFrom('payroll_correction').selectAll().orderBy('id').execute(),
    origins: await db
      .selectFrom('payroll_transfer_origin')
      .selectAll()
      .orderBy('batch_id')
      .execute(),
    settings: await db
      .selectFrom('book_setting')
      .select(['key', 'value', 'updated_at'])
      .where('scope', '=', 'payroll')
      .orderBy('key')
      .execute(),
  });
}
export async function assertPayrollReplaceable(svc: CoreServices) {
  const db = svc.db.withTables<TransferTables>();
  const link = await db.selectFrom('payroll_voucher').select('voucher_id').executeTakeFirst();
  const source = await db
    .selectFrom('voucher')
    .select('id')
    .where('source_module', '=', 'payroll')
    .executeTakeFirst();
  if (link || source)
    fail(
      'TRANSFER_SOURCE',
      '当前工资已有来源凭证，不能覆盖或清空',
      '先在工资来源处撤销全部未审核凭证；已审核或过账凭证须保留',
    );
  const frozenBatch = await db
    .selectFrom('payroll_batch')
    .select('id')
    .where('closed', '=', 1)
    .executeTakeFirst();
  const frozenPeriod = await db
    .selectFrom('payroll_period')
    .select('period')
    .where('closed', '=', 1)
    .executeTakeFirst();
  if (frozenBatch || frozenPeriod)
    fail(
      'TRANSFER_CLOSED',
      '工资存在已结账月份，不能覆盖或清空',
      '先按最近期间反结账，核对工资后再操作',
    );
  const batches = await db.selectFrom('payroll_batch').select('period').distinct().execute();
  for (const batch of batches) await svc.periods.assertOpen(batch.period, '替换工资模块数据');
}
/** 只清理工资模块自己的业务数据及设置；保护备份保留。调用者须在事务内先检查并备份。 */
export async function clearPayrollModule(svc: CoreServices) {
  const db = svc.db.withTables<TransferTables>();
  await db.deleteFrom('payroll_transfer_origin').execute();
  await db.deleteFrom('payroll_correction').execute();
  await db.deleteFrom('payroll_period').execute();
  await db.deleteFrom('payroll_quantity').execute();
  await db.deleteFrom('payroll_row').execute();
  await db.deleteFrom('payroll_hr_profile').execute();
  await db.deleteFrom('payroll_batch').execute();
  await db.deleteFrom('payroll_employee').execute();
  await db.deleteFrom('payroll_category').execute();
  await db.deleteFrom('book_setting').where('scope', '=', 'payroll').execute();
}
async function replaceState(svc: CoreServices, state: PayrollModuleState) {
  const db = svc.db.withTables<TransferTables>();
  await clearPayrollModule(svc);
  for (const row of state.categories) await db.insertInto('payroll_category').values(row).execute();
  for (const row of state.employees) await db.insertInto('payroll_employee').values(row).execute();
  for (const row of state.batches) await db.insertInto('payroll_batch').values(row).execute();
  for (const row of state.rows) await db.insertInto('payroll_row').values(row).execute();
  for (const row of state.quantities) await db.insertInto('payroll_quantity').values(row).execute();
  for (const row of state.periods) await db.insertInto('payroll_period').values(row).execute();
  for (const row of state.profiles) await db.insertInto('payroll_hr_profile').values(row).execute();
  for (const row of state.corrections)
    await db.insertInto('payroll_correction').values(row).execute();
  for (const row of state.origins)
    await db.insertInto('payroll_transfer_origin').values(row).execute();
  for (const row of state.settings)
    await db
      .insertInto('book_setting')
      .values({ ...row, scope: 'payroll' })
      .execute();
}
/** 真实回装备份并重读所有工资表，摘要一致后才允许后续覆盖。必须由外层事务调用。 */
export async function backupPayrollModule(svc: CoreServices, reason: string) {
  await assertPayrollReplaceable(svc);
  const state = await capturePayrollState(svc),
    createdAt = new Date().toISOString();
  validateState(state);
  const payload = PayrollBackupSchema.parse({
    format: 'payroll-backup-v2',
    bookId: (await svc.book.info()).id,
    state,
    references: await payrollExternalReferences(svc, state),
  });
  const hash = digest(payload),
    data = pack(payload);
  const restored = PayrollBackupSchema.parse(unpack(data, 32 * 1024 * 1024));
  if (digest(restored) !== hash) fail('TRANSFER_BACKUP', '工资保护副本校验失败，数据尚未覆盖');
  await verifyBackupReferences(svc, restored.references);
  const saved = await svc.db
    .withTables<TransferTables>()
    .insertInto('payroll_transfer_backup')
    .values({ created_at: createdAt, hash, data, reason })
    .returning('id')
    .executeTakeFirstOrThrow();
  await replaceState(svc, restored.state);
  if (digest(await capturePayrollState(svc)) !== digest(state))
    fail('TRANSFER_BACKUP', '工资保护副本回装核验失败，操作已回滚');
  return { id: saved.id, hash, createdAt };
}
function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    fail('TRANSFER_DATA', '工资文件含损坏的资料');
  }
}
const integerValues = z.record(z.string(), zCents);
function validateSnapshot(snapshot: SalaryRow) {
  RowInputSchema.parse(snapshot);
  EmployeeSchema.parse(snapshot.employee);
  integerValues.parse(snapshot.calculatedValues);
  for (const value of Object.values(snapshot.calculatedQuantities ?? {}))
    QuantitySchema.parse(value);
  for (const key of ['gross', 'deductions', 'taxAmount', 'net'] as const)
    zCents.parse(snapshot[key]);
  if (snapshot.net !== sum([snapshot.gross, -snapshot.deductions, -snapshot.taxAmount]))
    fail('TRANSFER_DATA', '历史工资实发金额与组成不一致');
  if (snapshot.detail.currentTax !== snapshot.taxAmount)
    fail('TRANSFER_DATA', '历史工资税额与计税明细不一致');
  if (snapshot.employee.id !== snapshot.employeeId) fail('TRANSFER_DATA', '历史工资人员关联无效');
  for (const [key, value] of Object.entries(snapshot.detail)) {
    if (key === 'version' || key === 'rate') {
      if (typeof value !== 'string') fail('TRANSFER_DATA', '历史计税参数格式无效');
    } else zCents.parse(value);
  }
}
function validateSnapshotAmounts(snapshot: SalaryRow, category: Category) {
  for (const field of category.fields.filter((f) => f.kind === 'money'))
    if (
      (snapshot.calculatedValues[field.key] ?? 0) !==
      (field.disabled ? 0 : (snapshot.values[field.key] ?? 0))
    )
      fail('TRANSFER_DATA', '历史快照输入金额与计算栏不一致');
  const quantity = (values: Record<string, string> = {}) =>
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, quantityToE6(value)]));
  if (digest(quantity(snapshot.quantities)) !== digest(quantity(snapshot.calculatedQuantities)))
    fail('TRANSFER_DATA', '历史快照数量与计算数量不一致');
  for (const [role, key] of [
    ['earning', 'gross'],
    ['deduction', 'deductions'],
  ] as const)
    if (
      snapshot[key] !==
      sum(
        category.fields
          .filter((f) => !f.disabled && f.role === role)
          .map((f) => snapshot.calculatedValues[f.key] ?? 0),
      )
    )
      fail('TRANSFER_DATA', '历史快照应发或扣款与栏目金额不一致');
}
function validateState(state: PayrollModuleState) {
  const unique = <T>(rows: T[], key: (row: T) => string | number) => {
    if (new Set(rows.map(key)).size !== rows.length) fail('TRANSFER_DATA', '工资文件包含重复记录');
  };
  unique(state.categories, (r) => r.id);
  unique(state.categories, (r) => r.name);
  unique(state.employees, (r) => r.id);
  unique(state.employees, (r) => r.code);
  unique(state.batches, (r) => r.id);
  unique(state.batches, (r) => `${r.period}.${r.category_id}`);
  unique(state.rows, (r) => `${r.batch_id}.${r.employee_id}`);
  unique(state.quantities, (r) => `${r.batch_id}.${r.employee_id}.${r.field_key}`);
  unique(state.periods, (r) => `${r.period}.${r.category_id}`);
  unique(state.profiles, (r) => r.employee_id);
  unique(state.settings, (r) => r.key);
  const categoryIds = new Set(state.categories.map((r) => r.id)),
    employeeIds = new Set(state.employees.map((r) => r.id)),
    batchIds = new Set(state.batches.map((r) => r.id));
  for (const row of state.categories) {
    const category = CategorySchema.parse(parseJson(row.data));
    validateCategory(category);
    if (category.name !== row.name) fail('TRANSFER_DATA', '工资类别名称不一致');
  }
  for (const row of state.employees) {
    const employee = EmployeeSchema.parse(parseJson(row.data));
    if (employee.code !== row.code || employee.departmentId !== row.department_id)
      fail('TRANSFER_DATA', '人员资料关联不一致');
  }
  for (const row of state.batches) {
    if (!categoryIds.has(row.category_id)) fail('TRANSFER_DATA', '工资批次类别缺失');
    validateCategory(CategorySchema.parse(parseJson(row.category_json)));
    const previous = decodeSalaryRows(row.previous_json);
    previous.forEach(validateSnapshot);
    const rows = state.rows.filter((r) => r.batch_id === row.id);
    if (!rows.length || rows.length > 500) fail('TRANSFER_DATA', '历史工资批次人员数量无效');
    if (row.calculated && rows.some((r) => !r.snapshot_json))
      fail('TRANSFER_DATA', '已计算工资缺少快照');
    if (row.closed && !row.calculated) fail('TRANSFER_DATA', '已结账工资尚未计算');
  }
  for (const row of state.rows) {
    if (!batchIds.has(row.batch_id) || !employeeIds.has(row.employee_id))
      fail('TRANSFER_DATA', '工资人员或批次缺失');
    const input = RowInputSchema.parse(parseJson(row.input_json));
    if (input.employeeId !== row.employee_id) fail('TRANSFER_DATA', '工资输入人员不一致');
    if (row.snapshot_json) {
      const snapshot = decodeSalaryRow(row.snapshot_json);
      validateSnapshot(snapshot);
      if (snapshot.employeeId !== row.employee_id) fail('TRANSFER_DATA', '工资快照人员不一致');
      const batch = state.batches.find((b) => b.id === row.batch_id)!;
      if (batch.calculated) {
        const frozenCategory = CategorySchema.parse(parseJson(batch.category_json));
        for (const quantity of state.quantities.filter(
          (q) => q.batch_id === row.batch_id && q.employee_id === row.employee_id,
        ))
          if (
            !frozenCategory.fields.some(
              (f) => f.key === quantity.field_key && f.kind === 'quantity',
            )
          )
            fail('TRANSFER_DATA', '工资数量对应栏目无效');
        const quantities = {
          ...(input.quantities ?? {}),
          ...Object.fromEntries(
            state.quantities
              .filter((q) => q.batch_id === row.batch_id && q.employee_id === row.employee_id)
              .map((q) => [q.field_key, quantityFromE6(q.quantity_e6)]),
          ),
        };
        const normalized = (value: ReturnType<typeof RowInputSchema.parse>) => ({
          employeeId: value.employeeId,
          values: value.values,
          tax: value.tax,
          quantities: Object.fromEntries(
            Object.entries(value.quantities ?? {}).map(([key, quantity]) => [
              key,
              quantityToE6(quantity),
            ]),
          ),
        });
        if (
          digest(normalized({ ...input, quantities })) !==
          digest(normalized(RowInputSchema.parse(snapshot)))
        )
          fail('TRANSFER_DATA', '工资输入与历史快照输入不一致');
        validateSnapshotAmounts(
          snapshot,
          CategorySchema.parse(parseJson(batch.category_json)) as Category,
        );
      }
    }
  }
  for (const row of state.quantities) {
    QuantitySchema.parse(quantityFromE6(row.quantity_e6));
    if (!state.rows.some((r) => r.batch_id === row.batch_id && r.employee_id === row.employee_id))
      fail('TRANSFER_DATA', '工资数量缺少对应人员');
    const batch = state.batches.find((b) => b.id === row.batch_id);
    if (
      !batch ||
      !CategorySchema.parse(parseJson(batch.category_json)).fields.some(
        (f) => f.key === row.field_key && f.kind === 'quantity',
      )
    )
      fail('TRANSFER_DATA', '工资数量对应栏目无效');
  }
  for (const row of state.periods)
    if (
      !batchIds.has(row.batch_id) ||
      !categoryIds.has(row.category_id) ||
      (row.next_batch_id !== null && !batchIds.has(row.next_batch_id))
    )
      fail('TRANSFER_DATA', '结账传递关联缺失');
  for (const row of state.profiles) {
    if (!employeeIds.has(row.employee_id)) fail('TRANSFER_DATA', '基本资料人员缺失');
    z.array(EmploymentSpellSchema).min(1).max(30).parse(parseJson(row.employment_json));
    z.record(z.string(), z.string()).parse(parseJson(row.values_json));
  }
  for (const row of state.corrections) {
    if (!batchIds.has(row.batch_id)) fail('TRANSFER_DATA', '历史更正批次缺失');
    for (const batch of [...decodeBatches(row.before_json), ...decodeBatches(row.after_json)])
      batch.snapshots.forEach(validateSnapshot);
  }
  for (const setting of state.settings) {
    const value = parseJson(setting.value);
    if (/^mapping\.\d+$/.test(setting.key)) VoucherMappingSchema.parse(value);
    else if (/^print-layout\.\d+\.(table|slips|summary)$/.test(setting.key))
      PayrollPrintLayoutSchema.parse(value);
    else if (setting.key === 'hr.fields') HrFieldsSchema.parse(value);
    else if (setting.key === 'initializedStartPeriod') zPeriod.parse(value);
    else if (setting.key !== 'taxVersion' && !setting.key.startsWith('historicalTax.'))
      fail('TRANSFER_DATA', `工资文件包含不支持的设置 ${setting.key}`);
  }
}
async function payrollExternalReferences(svc: CoreServices, state: PayrollModuleState) {
  const accountIds = new Set<number>(),
    dimensionIds = new Set<number>();
  const expectedTypes = new Map<number, string>();
  const expectDimension = (id: number, type: string) => {
    if (expectedTypes.has(id) && expectedTypes.get(id) !== type)
      fail('TRANSFER_REFERENCE', '工资辅助档案类型关联不一致');
    expectedTypes.set(id, type);
    dimensionIds.add(id);
  };
  for (const employee of state.employees) expectDimension(employee.department_id, 'department');
  for (const row of state.rows)
    if (row.snapshot_json)
      expectDimension(decodeSalaryRow(row.snapshot_json).employee.departmentId, 'department');
  for (const batch of state.batches)
    for (const snapshot of decodeSalaryRows(batch.previous_json))
      expectDimension(snapshot.employee.departmentId, 'department');
  for (const audit of state.corrections)
    for (const batch of [...decodeBatches(audit.before_json), ...decodeBatches(audit.after_json)])
      for (const snapshot of [...batch.snapshots, ...batch.previous])
        expectDimension(snapshot.employee.departmentId, 'department');
  for (const setting of state.settings.filter((s) => s.key.startsWith('mapping.'))) {
    const mapping = VoucherMappingSchema.parse(parseJson(setting.value));
    for (const id of [
      mapping.payableAccountId,
      mapping.bankAccountId,
      mapping.taxAccountId,
      mapping.deductionAccountId,
      mapping.expenseAccountId,
    ])
      accountIds.add(id);
    for (const rule of mapping.rules) {
      accountIds.add(rule.debitAccountId);
      accountIds.add(rule.creditAccountId);
      if (rule.departmentId) expectDimension(rule.departmentId, 'department');
    }
    for (const auxiliary of mapping.auxiliaries) {
      accountIds.add(auxiliary.accountId);
      for (const [type, id] of Object.entries(auxiliary.values))
        if (id != null) expectDimension(id, type);
    }
  }
  const accounts = await Promise.all(
    [...accountIds]
      .sort((a, b) => a - b)
      .map(async (id) => {
        const account = await svc.accounts.require(id);
        return { id, code: account.code, name: account.name };
      }),
  );
  const dimensions = await Promise.all(
    [...dimensionIds]
      .sort((a, b) => a - b)
      .map(async (id) => {
        const item = await svc.dimensions.get(id);
        if (
          !item ||
          item.typeId !== expectedTypes.get(id) ||
          !DIMENSION_TYPES.some((d) => d.id === item.typeId)
        )
          fail('TRANSFER_REFERENCE', '工资使用的辅助档案已缺失');
        return {
          id,
          code: item.code,
          name: item.name,
          type: item.typeId as PayrollTransferEnvelope['references']['dimensions'][number]['type'],
        };
      }),
  );
  return { accounts, dimensions };
}
const PayrollBackupSchema = z.object({
  format: z.literal('payroll-backup-v2'),
  bookId: z.string(),
  state: PayrollModuleStateSchema,
  references: PayrollTransferEnvelopeSchema.shape.references,
});
async function verifyBackupReferences(
  svc: CoreServices,
  references: PayrollTransferEnvelope['references'],
) {
  for (const reference of references.accounts) {
    const current = await svc.accounts.get(reference.id);
    if (
      !current ||
      !current.isLeaf ||
      current.disabled ||
      current.code !== reference.code ||
      current.name !== reference.name
    )
      fail(
        'TRANSFER_REFERENCE_IDENTITY',
        '保护副本中的科目身份已变化，不能按旧编号恢复',
        '请使用工资专用文件按科目编码映射转入；不要继续直接恢复',
      );
  }
  for (const reference of references.dimensions) {
    const current = await svc.dimensions.get(reference.id);
    if (
      !current ||
      !current.isLeaf ||
      current.disabled ||
      current.typeId !== reference.type ||
      current.code !== reference.code ||
      current.name !== reference.name
    )
      fail(
        'TRANSFER_REFERENCE_IDENTITY',
        '保护副本中的辅助档案身份或编码已变化，不能按旧编号恢复',
        '请使用工资专用文件按部门及辅助档案编码映射转入',
      );
  }
}
export async function exportPayrollTransfer(svc: CoreServices) {
  return svc.tx((t) => exportPayrollTransferSnapshot(t));
}
async function exportPayrollTransferSnapshot(svc: CoreServices) {
  await svc.permissions.require('payroll.hr.view');
  const state = await capturePayrollState(svc);
  validateState(state);
  const references = await payrollExternalReferences(svc, state);
  const book = await svc.book.info();
  const data = {
    format: 'caiwu-payroll-v1' as const,
    exportedAt: new Date().toISOString(),
    source: {
      id: book.id,
      name: book.name,
      startPeriod: book.startPeriod,
      baseCurrency: book.baseCurrency,
    },
    state,
    references,
    sourceVoucherCount: (
      await svc.db
        .withTables<PayrollTables>()
        .selectFrom('payroll_voucher')
        .select('voucher_id')
        .execute()
    ).length,
  };
  const envelope = PayrollTransferEnvelopeSchema.parse({ ...data, sha256: digest(data) });
  const base64 = pack(envelope);
  if (base64.length > 700000)
    fail('TRANSFER_SIZE', '工资转出文件超过当前转入大小限制', '按年度保留独立账套后分别转入');
  return {
    fileName: `工资-${book.name}-${new Date().toISOString().slice(0, 10)}.caiwu-payroll`,
    base64,
    counts: {
      categories: state.categories.length,
      employees: state.employees.length,
      batches: state.batches.length,
    },
  };
}
function readEnvelope(file: string) {
  let envelope: PayrollTransferEnvelope;
  try {
    envelope = PayrollTransferEnvelopeSchema.parse(unpack(file));
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    fail('TRANSFER_DATA', '工资文件格式或资料校验失败', '重新从来源账套导出完整工资文件');
  }
  const { sha256, ...content } = envelope;
  if (digest(content) !== sha256)
    fail('TRANSFER_CHECKSUM', '工资文件摘要不一致', '重新从来源账套导出，不能手工修改文件');
  try {
    validateState(envelope.state);
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    fail('TRANSFER_DATA', '工资文件中的输入或历史快照无效', '重新从来源账套导出完整工资文件');
  }
  const accounts = envelope.references.accounts,
    dimensions = envelope.references.dimensions;
  if (
    new Set(accounts.map((r) => r.id)).size !== accounts.length ||
    new Set(accounts.map((r) => r.code)).size !== accounts.length ||
    new Set(dimensions.map((r) => r.id)).size !== dimensions.length ||
    new Set(dimensions.map((r) => `${r.type}.${r.code}`)).size !== dimensions.length
  )
    fail('TRANSFER_REFERENCE', '工资文件的档案编码重复或不明确');
  const departmentIds = new Set(dimensions.filter((r) => r.type === 'department').map((r) => r.id));
  if (envelope.state.employees.some((r) => !departmentIds.has(r.department_id)))
    fail('TRANSFER_REFERENCE', '工资人员的部门编码映射缺失或类型不符');
  return envelope;
}
async function referenceMapping(
  svc: CoreServices,
  envelope: PayrollTransferEnvelope,
  input: PayrollTransferInput,
) {
  const seen = new Set<string>();
  for (const mapping of input.mappings) {
    const present =
      mapping.kind === 'account'
        ? envelope.references.accounts.some((r) => r.code === mapping.sourceCode)
        : envelope.references.dimensions.some(
            (r) => r.type === mapping.kind && r.code === mapping.sourceCode,
          );
    if (!present)
      fail(
        'TRANSFER_MAPPING',
        '编码映射的来源档案不在工资文件中',
        '重新核对来源编码，不能忽略未知映射',
      );
    const key = `${mapping.kind}:${mapping.sourceCode}`;
    if (seen.has(key)) fail('TRANSFER_MAPPING', '档案编码映射重复');
    seen.add(key);
  }
  const dimensionMap = new Map<number, number>(),
    accountMap = new Map<number, number>();
  const preview: {
    kind: string;
    sourceCode: string;
    sourceName: string;
    targetCode: string;
    targetName: string;
    found: boolean;
  }[] = [];
  const targetCode = (kind: string, code: string) =>
    input.mappings.find((m) => m.kind === kind && m.sourceCode === code)?.targetCode ?? code;
  for (const reference of envelope.references.accounts) {
    const code = targetCode('account', reference.code),
      target = await svc.accounts.getByCode(code);
    const found = !!target && target.isLeaf && !target.disabled;
    preview.push({
      kind: 'account',
      sourceCode: reference.code,
      sourceName: reference.name,
      targetCode: code,
      targetName: target?.name ?? '未找到启用末级科目',
      found,
    });
    if (found) accountMap.set(reference.id, target!.id);
  }
  for (const reference of envelope.references.dimensions) {
    const code = targetCode(reference.type, reference.code),
      target = await svc.dimensions.getByCode(reference.type, code);
    const found = !!target && target.isLeaf && !target.disabled;
    preview.push({
      kind: reference.type,
      sourceCode: reference.code,
      sourceName: reference.name,
      targetCode: code,
      targetName: target?.name ?? '未找到启用末级档案',
      found,
    });
    if (found) dimensionMap.set(reference.id, target!.id);
  }
  return { preview, dimensionMap, accountMap };
}
async function requireTransferPermissions(svc: CoreServices) {
  for (const permission of [
    'payroll.salary.edit',
    'payroll.hr.edit',
    'payroll.voucher',
    'payroll.tax.configure',
  ])
    await svc.permissions.require(permission);
}
export async function inspectPayrollTransfer(svc: CoreServices, raw: PayrollTransferInput) {
  await requireTransferPermissions(svc);
  const input = PayrollTransferInputSchema.parse(raw),
    envelope = readEnvelope(input.file);
  const target = await svc.book.info();
  if (envelope.source.baseCurrency !== target.baseCurrency)
    fail('TRANSFER_CURRENCY', '来源和目标账套本位币不同，不能转入工资');
  const mapping = await referenceMapping(svc, envelope, input);
  return {
    source: envelope.source,
    exportedAt: envelope.exportedAt,
    sourceVoucherCount: envelope.sourceVoucherCount,
    counts: {
      categories: envelope.state.categories.length,
      employees: envelope.state.employees.length,
      batches: envelope.state.batches.length,
    },
    references: mapping.preview,
  };
}
function mappedId(map: Map<number, number>, id: number, kind: string) {
  const result = map.get(id);
  if (result === undefined)
    fail('TRANSFER_REFERENCE', `${kind}缺少编码映射`, '补齐所有部门、科目及辅助档案后重新预览');
  return result;
}
function mapModuleState(
  svc: CoreServices,
  envelope: PayrollTransferEnvelope,
  current: PayrollModuleState,
  dimensions: Map<number, number>,
  accounts: Map<number, number>,
  minimumPeriod: number,
): PayrollModuleState {
  const source = envelope.state;
  const idMap = (rows: { id: number }[], old: { id: number }[]) =>
    new Map(rows.map((r, i) => [r.id, Math.max(0, ...old.map((x) => x.id)) + i + 1]));
  const categories = idMap(source.categories, current.categories),
    employees = idMap(source.employees, current.employees),
    batches = idMap(source.batches, current.batches);
  const categoryId = (id: number) => mappedId(categories, id, '工资类别'),
    employeeId = (id: number) => mappedId(employees, id, '人员'),
    batchId = (id: number) => mappedId(batches, id, '工资批次'),
    dimensionId = (id: number) => mappedId(dimensions, id, '辅助档案'),
    accountId = (id: number) => mappedId(accounts, id, '科目');
  const category = (raw: unknown) => {
    const value = CategorySchema.parse(raw);
    return {
      ...value,
      revision: value.revision + 1,
      ...(value.id ? { id: categoryId(value.id) } : {}),
    };
  };
  const snapshot = (row: SalaryRow): SalaryRow => ({
    ...row,
    employeeId: employeeId(row.employeeId),
    employee: {
      ...row.employee,
      id: employeeId(row.employee.id),
      departmentId: dimensionId(row.employee.departmentId),
    },
  });
  const batchAudit = (row: Batch): Batch => ({
    ...row,
    id: batchId(row.id),
    categoryId: categoryId(row.categoryId),
    category: {
      ...row.category,
      id: categoryId(row.category.id),
      revision: row.category.revision + 1,
    },
    rows: row.rows.map((r) => ({ ...r, employeeId: employeeId(r.employeeId) })),
    snapshots: row.snapshots.map(snapshot),
    previous: row.previous.map(snapshot),
    vouchers: [],
  });
  const now = new Date().toISOString();
  const result: PayrollModuleState = {
    categories: source.categories.map((r) => ({
      ...r,
      id: categoryId(r.id),
      revision: r.revision + 1,
      data: JSON.stringify({
        ...category(parseJson(r.data)),
        id: categoryId(r.id),
        revision: r.revision + 1,
      }),
    })),
    employees: source.employees.map((r) => {
      const value = EmployeeSchema.parse(parseJson(r.data));
      return {
        ...r,
        id: employeeId(r.id),
        revision: r.revision + 1,
        department_id: dimensionId(r.department_id),
        data: JSON.stringify({
          ...value,
          id: employeeId(r.id),
          revision: r.revision + 1,
          departmentId: dimensionId(r.department_id),
        }),
      };
    }),
    batches: source.batches.map((r) => ({
      ...r,
      id: batchId(r.id),
      category_id: categoryId(r.category_id),
      revision: r.revision + 1,
      category_json: JSON.stringify({
        ...category(parseJson(r.category_json)),
        id: categoryId(r.category_id),
      }),
      previous_json: encodeSalaryRows(decodeSalaryRows(r.previous_json).map(snapshot)),
    })),
    rows: source.rows.map((r) => ({
      ...r,
      batch_id: batchId(r.batch_id),
      employee_id: employeeId(r.employee_id),
      input_json: JSON.stringify({
        ...RowInputSchema.parse(parseJson(r.input_json)),
        employeeId: employeeId(r.employee_id),
      }),
      snapshot_json: r.snapshot_json
        ? encodeSalaryRow(snapshot(decodeSalaryRow(r.snapshot_json)))
        : null,
    })),
    quantities: source.quantities.map((r) => ({
      ...r,
      batch_id: batchId(r.batch_id),
      employee_id: employeeId(r.employee_id),
    })),
    periods: source.periods.map((r) => ({
      ...r,
      batch_id: batchId(r.batch_id),
      category_id: categoryId(r.category_id),
      next_batch_id: r.next_batch_id === null ? null : batchId(r.next_batch_id),
    })),
    profiles: source.profiles.map((r) => ({ ...r, employee_id: employeeId(r.employee_id) })),
    corrections: source.corrections.map((r, i) => ({
      ...r,
      id: Math.max(0, ...current.corrections.map((c) => c.id)) + i + 1,
      batch_id: batchId(r.batch_id),
      user_id: svc.user.id,
      user_name: `来源账套：${r.user_name}`,
      reason: `导入历史：${r.reason}`,
      before_json: encodeBatches(decodeBatches(r.before_json).map(batchAudit)),
      after_json: encodeBatches(decodeBatches(r.after_json).map(batchAudit)),
    })),
    origins: source.batches.map((r) => ({
      batch_id: batchId(r.id),
      source_book_id: envelope.source.id,
      source_book_name: envelope.source.name,
      source_batch_id: r.id,
      imported_at: now,
      data: JSON.stringify({
        exportedAt: envelope.exportedAt,
        sourceSha256: envelope.sha256,
        priorOrigin: source.origins.find((o) => o.batch_id === r.id) ?? null,
        sourceVouchersExcluded: true,
        taxRecalculated: false,
      }),
    })),
    settings: source.settings.map((r) => {
      if (r.key.startsWith('mapping.')) {
        const mapping = VoucherMappingSchema.parse(parseJson(r.value));
        const value = {
          ...mapping,
          revision: mapping.revision + 1,
          payableAccountId: accountId(mapping.payableAccountId),
          bankAccountId: accountId(mapping.bankAccountId),
          taxAccountId: accountId(mapping.taxAccountId),
          deductionAccountId: accountId(mapping.deductionAccountId),
          expenseAccountId: accountId(mapping.expenseAccountId),
          rules: mapping.rules.map((rule) => ({
            ...rule,
            debitAccountId: accountId(rule.debitAccountId),
            creditAccountId: accountId(rule.creditAccountId),
            ...(rule.departmentId ? { departmentId: dimensionId(rule.departmentId) } : {}),
          })),
          auxiliaries: mapping.auxiliaries.map((a) => ({
            ...a,
            accountId: accountId(a.accountId),
            ...(a.employeeId ? { employeeId: employeeId(a.employeeId) } : {}),
            values: Object.fromEntries(
              Object.entries(a.values).map(([key, id]) => [
                key,
                id === null ? null : dimensionId(id),
              ]),
            ),
          })),
        };
        return {
          ...r,
          key: `mapping.${categoryId(Number(r.key.split('.')[1]))}`,
          value: JSON.stringify(value),
          updated_at: now,
        };
      }
      if (r.key.startsWith('print-layout.')) {
        const parts = r.key.split('.');
        return {
          ...r,
          key: `print-layout.${categoryId(Number(parts[1]))}.${parts[2]}`,
          updated_at: now,
        };
      }
      if (r.key === 'initializedStartPeriod')
        return {
          ...r,
          value: JSON.stringify(Math.max(zPeriod.parse(parseJson(r.value)), minimumPeriod)),
          updated_at: now,
        };
      return { ...r, updated_at: now };
    }),
  };
  validateState(result);
  return result;
}
export async function previewPayrollTransfer(
  svc: CoreServices,
  raw: PayrollTransferInput,
  boundExpiry?: string,
) {
  await requireTransferPermissions(svc);
  const input = PayrollTransferInputSchema.parse(raw),
    envelope = readEnvelope(input.file);
  await assertPayrollReplaceable(svc);
  const target = await svc.book.info();
  if (envelope.source.baseCurrency !== target.baseCurrency)
    fail('TRANSFER_CURRENCY', '来源和目标账套本位币不同，不能转入工资');
  if (!envelope.state.categories.length) fail('TRANSFER_EMPTY', '来源工资文件没有工资类别');
  for (const batch of envelope.state.batches) {
    if (batch.period < target.startPeriod)
      fail(
        'TRANSFER_PERIOD',
        '来源工资早于目标账套启用期间',
        '请选择启用期间不晚于来源工资的目标账套',
      );
    await svc.periods.assertOpen(batch.period, '转入工资');
  }
  const mapping = await referenceMapping(svc, envelope, input);
  if (mapping.preview.some((r) => !r.found))
    fail(
      'TRANSFER_MAPPING',
      '部分科目或辅助档案尚未匹配',
      '补齐预览中的全部编码映射，不能跳过缺失资料',
    );
  const current = await capturePayrollState(svc),
    next = mapModuleState(
      svc,
      envelope,
      current,
      mapping.dimensionMap,
      mapping.accountMap,
      target.startPeriod,
    );
  const expiresAt = boundExpiry ?? new Date(Date.now() + 5 * 60 * 1000).toISOString();
  return {
    hash: digest({
      input,
      current,
      targetId: target.id,
      userId: svc.user.id,
      expiresAt,
      references: mapping.preview,
      planned: {
        ...next,
        settings: next.settings.map(({ updated_at: _updatedAt, ...row }) => row),
        origins: next.origins.map(({ imported_at: _importedAt, ...row }) => row),
      },
    }),
    expiresAt,
    targetName: target.name,
    source: envelope.source,
    sourceVoucherCount: envelope.sourceVoucherCount,
    references: mapping.preview,
    before: {
      categories: current.categories.length,
      employees: current.employees.length,
      batches: current.batches.length,
      rows: current.rows.length,
    },
    after: {
      categories: next.categories.length,
      employees: next.employees.length,
      batches: next.batches.length,
      rows: next.rows.length,
    },
    next,
  };
}
export async function applyPayrollTransfer(
  svc: CoreServices,
  input: PayrollTransferInput,
  expected: { hash: string; expiresAt: string; confirmed: boolean; targetName: string },
) {
  if (!expected.confirmed)
    fail('CONFIRM', '跨账套工资转入须明确确认覆盖', '先核对目标账套及新增、覆盖数量');
  if (
    !Number.isFinite(Date.parse(expected.expiresAt)) ||
    Date.parse(expected.expiresAt) < Date.now() ||
    Date.parse(expected.expiresAt) > Date.now() + 5 * 60 * 1000
  )
    fail('PLAN_STALE', '工资转入预览已过期', '重新预览后确认');
  return svc.tx(async (t) => {
    const plan = await previewPayrollTransfer(t, input, expected.expiresAt),
      target = await t.book.info();
    if (expected.targetName !== target.name || expected.hash !== plan.hash)
      fail('PLAN_STALE', '工资转入预览或目标名称已变化', '重新预览并输入目标账套名称');
    const backup = await backupPayrollModule(t, `跨账套工资转入前：${plan.source.name}`);
    await replaceState(t, plan.next);
    await t.log.write({
      action: 'payroll.transfer.import',
      summary: `从 ${plan.source.name} 转入${plan.after.batches}个工资批次，保护副本${backup.id}`,
      detail: { backupId: backup.id, sourceBookId: plan.source.id },
    });
    return { backup, counts: plan.after };
  });
}
export async function payrollTransferBackups(svc: CoreServices) {
  return svc.db
    .withTables<TransferTables>()
    .selectFrom('payroll_transfer_backup')
    .select(['id', 'created_at', 'reason', 'hash'])
    .orderBy('id', 'desc')
    .execute();
}
async function loadBackup(svc: CoreServices, id: number) {
  const row = await svc.db
    .withTables<TransferTables>()
    .selectFrom('payroll_transfer_backup')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) fail('TRANSFER_BACKUP', '工资模块保护副本不存在');
  const parsed = PayrollBackupSchema.safeParse(unpack(row.data, 32 * 1024 * 1024));
  if (!parsed.success)
    fail(
      'TRANSFER_BACKUP_IDENTITY',
      '旧工资保护副本缺少可核验的档案身份，不能直接恢复',
      '请使用工资专用文件通过编码映射转入',
    );
  const payload = parsed.data;
  if (digest(payload) !== row.hash) fail('TRANSFER_BACKUP', '工资模块保护副本摘要不一致，不能恢复');
  if (payload.bookId !== (await svc.book.info()).id)
    fail(
      'TRANSFER_BACKUP_IDENTITY',
      '工资保护副本不属于当前账套',
      '请使用工资专用文件通过编码映射转入',
    );
  await verifyBackupReferences(svc, payload.references);
  validateState(payload.state);
  return { row, state: payload.state };
}
export async function previewPayrollRestore(svc: CoreServices, id: number, boundExpiry?: string) {
  await requireTransferPermissions(svc);
  await assertPayrollReplaceable(svc);
  const { row, state } = await loadBackup(svc, id),
    current = await capturePayrollState(svc),
    target = await svc.book.info();
  for (const batch of state.batches)
    await svc.periods.assertOpen(batch.period, '恢复工资模块保护副本');
  for (const employee of state.employees)
    if (!(await svc.dimensions.get(employee.department_id)))
      fail('TRANSFER_REFERENCE', '保护副本中的部门已不存在', '先恢复部门档案后重试');
  const expiresAt = boundExpiry ?? new Date(Date.now() + 5 * 60 * 1000).toISOString();
  return {
    id,
    expiresAt,
    createdAt: row.created_at,
    reason: row.reason,
    targetName: target.name,
    hash: digest({
      id,
      backup: row.hash,
      current,
      targetId: target.id,
      userId: svc.user.id,
      expiresAt,
    }),
    before: { employees: current.employees.length, batches: current.batches.length },
    after: { employees: state.employees.length, batches: state.batches.length },
  };
}
export async function restorePayrollBackup(
  svc: CoreServices,
  input: { id: number; hash: string; expiresAt: string; confirmed: boolean; targetName: string },
) {
  if (!input.confirmed) fail('CONFIRM', '恢复工资模块保护副本须明确确认');
  if (
    !Number.isFinite(Date.parse(input.expiresAt)) ||
    Date.parse(input.expiresAt) < Date.now() ||
    Date.parse(input.expiresAt) > Date.now() + 5 * 60 * 1000
  )
    fail('PLAN_STALE', '工资模块恢复预览已过期', '重新预览后确认');
  return svc.tx(async (t) => {
    const plan = await previewPayrollRestore(t, input.id, input.expiresAt);
    if (plan.hash !== input.hash || plan.targetName !== input.targetName)
      fail('PLAN_STALE', '工资模块恢复预览已失效', '重新预览后输入目标账套名称');
    const { state } = await loadBackup(t, input.id);
    const backup = await backupPayrollModule(t, `恢复工资模块副本${input.id}之前`);
    await replaceState(t, state);
    if (digest(await capturePayrollState(t)) !== digest(state))
      fail('TRANSFER_BACKUP', '工资模块恢复后的摘要不符，操作已回滚');
    await t.log.write({
      action: 'payroll.transfer.restore',
      summary: `恢复工资模块副本${input.id}，保留恢复前副本${backup.id}`,
    });
    return { restored: true, backup };
  });
}
export async function payrollTransferOrigin(svc: CoreServices, id: number) {
  return (
    (await svc.db
      .withTables<TransferTables>()
      .selectFrom('payroll_transfer_origin')
      .select(['source_book_name', 'source_batch_id', 'imported_at', 'data'])
      .where('batch_id', '=', id)
      .executeTakeFirst()) ?? null
  );
}
export { replaceState as restorePayrollModuleSnapshot };
