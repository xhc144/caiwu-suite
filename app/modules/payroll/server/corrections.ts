import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { CoreServices } from '@caiwu/core/server';
import { TAX_RULE, type Batch, type RowInput, type SalaryRow } from '../shared';
import {
  CorrectionInputSchema,
  CorrectionApplySchema,
  type CorrectionInput,
} from '../shared-history';
import {
  quantityToE6,
  encodeSalaryRow,
  encodeSalaryRows,
  encodeBatches,
  decodeBatches,
} from '../quantity';
import { payrollService } from './service';
import { assertTaxConfirmed } from './historical-tax';
import { calculateSalarySnapshot, type PriorSalary } from './calculation';
import { fail, sum, validateCategory } from './engine';
import type { PayrollTables } from './migrations';
import { assertPayrollStart } from './start-period';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const beforeTarget = (a: Batch, b: Batch) =>
  a.period < b.period || (a.period === b.period && a.id < b.id);
async function correctionPlan(svc: CoreServices, input: CorrectionInput) {
  svc.permissions.require('payroll.salary.calculate');
  const s = payrollService(svc),
    target = await s.batch(input.id);
  await assertPayrollStart(svc, target.period);
  if (target.revision !== input.revision) fail('STALE', '工资批次已变化', '重新打开前期更正并预览');
  if (!target.calculated)
    fail('CORRECTION_PENDING', '前期更正须从已计算批次发起', '待计算批次请先正常编辑和计算');
  if (
    new Set(input.rows.map((r) => r.employeeId)).size !== input.rows.length ||
    input.rows.length !== target.rows.length ||
    input.rows.some((r) => !target.rows.some((o) => o.employeeId === r.employeeId))
  )
    fail(
      'CORRECTION_SCOPE',
      '前期更正须保留原批次的完整人员范围',
      '人员不增删，只更正原批次工资及扣除',
    );
  const moneyKeys = new Set(
    target.category.fields.filter((f) => f.kind === 'money' && !f.disabled).map((f) => f.key),
  );
  const quantityKeys = new Set(
    target.category.fields.filter((f) => f.kind === 'quantity' && !f.disabled).map((f) => f.key),
  );
  for (const row of input.rows) {
    const old = target.rows.find((r) => r.employeeId === row.employeeId)!;
    for (const key of new Set([...Object.keys(old.values), ...Object.keys(row.values)]))
      if (!moneyKeys.has(key) && old.values[key] !== row.values[key])
        fail('FIELDS', `栏目${key}不可更正`, '只修改历史结构内启用的金额录入栏目');
    for (const key of new Set([
      ...Object.keys(old.quantities ?? {}),
      ...Object.keys(row.quantities ?? {}),
    ]))
      if (!quantityKeys.has(key) && old.quantities?.[key] !== row.quantities?.[key])
        fail('FIELDS', `数量栏目${key}不可更正`);
  }
  const year = Math.trunc(target.period / 100),
    descriptors = await s.batches({});
  const all = await Promise.all(
    descriptors
      .filter((b) => Math.trunc(b.period / 100) === year)
      .sort((a, b) => a.period - b.period || a.id - b.id)
      .map((b) => s.batch(b.id)),
  );
  const people = new Set(input.rows.map((r) => r.employeeId));
  const affected: Batch[] = [];
  for (const b of all) {
    if (beforeTarget(b, target) || !b.rows.some((r) => people.has(r.employeeId))) continue;
    affected.push(b);
    for (const r of b.rows) people.add(r.employeeId);
    if (!b.calculated || b.snapshots.length !== b.rows.length)
      fail(
        'CORRECTION_PENDING',
        `批次${b.id}尚未完成计算`,
        '先正常计算该批次，再预览前期更正',
        `/m/payroll?id=${b.id}`,
      );
    if (b.closed || b.vouchers.length)
      fail(
        'LOCKED',
        `批次${b.id}已经结账或生成凭证，不能级联更正`,
        '先按正常流程反结账或确认撤销未审核凭证；已审核、过账来源保持锁定',
        `/m/payroll?id=${b.id}`,
      );
    await svc.periods.assertWritable({
      period: b.period,
      mode: 'business',
      action: '前期工资更正',
    });
    validateCategory(b.category);
    if (b.category.taxMode !== 'custom') await assertTaxConfirmed(svc, b.period, TAX_RULE.version);
  }
  const byId = new Map(affected.map((b) => [b.id, b]));
  const history: PriorSalary[] = [];
  const after: Batch[] = [];
  for (const b of all) {
    if (!byId.has(b.id)) {
      if (b.calculated) history.push(...b.snapshots.map((row) => ({ period: b.period, row })));
      continue;
    }
    const pending = all.find(
      (p) =>
        beforeTarget(p, b) &&
        !p.calculated &&
        p.rows.some((r) => b.rows.some((n) => n.employeeId === r.employeeId)),
    );
    if (pending)
      fail(
        'ORDER',
        `较早批次${pending.id}尚未计算`,
        '先计算较早批次，再预览前期更正',
        `/m/payroll?id=${pending.id}`,
      );
    const rows: RowInput[] =
      b.id === target.id
        ? input.rows
        : b.rows.map((row) => {
            const changed = input.rows.find((r) => r.employeeId === row.employeeId);
            const old = target.rows.find((r) => r.employeeId === row.employeeId);
            if (!changed || !old) return row;
            const tax = { ...row.tax };
            for (const key of ['openingIncome', 'openingTax'] as const)
              if (changed.tax[key] !== old.tax[key]) tax[key] = changed.tax[key];
            if (b.period === target.period)
              for (const key of [
                'special',
                'additional',
                'other',
                'relief',
                'confirmed',
              ] as const) {
                if (key === 'confirmed') tax.confirmed = changed.tax.confirmed;
                else tax[key] = changed.tax[key];
              }
            return { ...row, tax };
          });
    const snapshots = rows.map((row) =>
      calculateSalarySnapshot(
        b.category,
        b.period,
        row,
        b.snapshots.find((r) => r.employeeId === row.employeeId)!.employee,
        history,
      ),
    );
    const next = { ...b, revision: b.revision + 1, rows, snapshots, previous: b.snapshots };
    after.push(next);
    history.push(...snapshots.map((row) => ({ period: b.period, row })));
  }
  const changes = after.map((b) => {
    const old = byId.get(b.id)!;
    const amount = (rows: SalaryRow[], key: 'gross' | 'taxAmount' | 'net') =>
      sum(rows.map((r) => r[key]));
    return {
      id: b.id,
      period: b.period,
      categoryName: b.category.name,
      employeeCount: b.rows.length,
      beforeGross: amount(old.snapshots, 'gross'),
      afterGross: amount(b.snapshots, 'gross'),
      beforeTax: amount(old.snapshots, 'taxAmount'),
      afterTax: amount(b.snapshots, 'taxAmount'),
      beforeNet: amount(old.snapshots, 'net'),
      afterNet: amount(b.snapshots, 'net'),
    };
  });
  const book = await svc.book.info();
  return {
    before: affected,
    after,
    changes,
    fingerprint: digest({ input, all, bookId: book.id, userId: svc.user.id, after }),
  };
}
export async function previewCorrection(
  svc: CoreServices,
  raw: z.input<typeof CorrectionInputSchema>,
) {
  const input = CorrectionInputSchema.parse(raw);
  return svc.tx(async (t) => {
    const plan = await correctionPlan(t, input),
      expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    return {
      changes: plan.changes,
      expiresAt,
      hash: digest({ fingerprint: plan.fingerprint, expiresAt }),
    };
  });
}
export async function applyCorrection(
  svc: CoreServices,
  raw: z.input<typeof CorrectionApplySchema>,
) {
  const input = CorrectionApplySchema.parse(raw);
  if (!input.confirmed)
    fail('CONFIRM', '前期更正须确认完整级联影响', '核对每个受影响批次的工资和税额变化');
  if (
    Date.parse(input.expiresAt) <= Date.now() ||
    Date.parse(input.expiresAt) > Date.now() + 5 * 60_000
  )
    fail('PLAN_STALE', '更正预览已过期', '重新预览后确认');
  return svc.tx(async (t) => {
    const plan = await correctionPlan(t, CorrectionInputSchema.parse(input));
    if (digest({ fingerprint: plan.fingerprint, expiresAt: input.expiresAt }) !== input.hash)
      fail('PLAN_STALE', '更正预览所依据的工资或期间已变化', '重新预览，不覆盖他人修改');
    const db = t.db.withTables<PayrollTables>();
    for (const b of plan.after) {
      await db
        .updateTable('payroll_batch')
        .set({ revision: b.revision, previous_json: encodeSalaryRows(b.previous), calculated: 1 })
        .where('id', '=', b.id)
        .execute();
      await db.deleteFrom('payroll_quantity').where('batch_id', '=', b.id).execute();
      for (const row of b.rows) {
        const { quantities, ...money } = row;
        await db
          .updateTable('payroll_row')
          .set({
            input_json: JSON.stringify(money),
            snapshot_json: encodeSalaryRow(
              b.snapshots.find((r) => r.employeeId === row.employeeId)!,
            ),
          })
          .where('batch_id', '=', b.id)
          .where('employee_id', '=', row.employeeId)
          .execute();
        for (const [field, value] of Object.entries(quantities ?? {}))
          await db
            .insertInto('payroll_quantity')
            .values({
              batch_id: b.id,
              employee_id: row.employeeId,
              field_key: field,
              quantity_e6: quantityToE6(value),
            })
            .execute();
      }
    }
    const audit = await db
      .insertInto('payroll_correction')
      .values({
        batch_id: input.id,
        reason: input.reason,
        created_at: new Date().toISOString(),
        user_id: t.user.id,
        user_name: t.user.name,
        before_json: encodeBatches(plan.before),
        after_json: encodeBatches(plan.after),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await t.log.write({
      action: 'payroll.salary.correct',
      summary: `更正批次${input.id}并重算${plan.after.length}批；原因：${input.reason}`,
      targetType: 'payroll_correction',
      targetId: audit.id,
    });
    return payrollService(t).batch(input.id);
  });
}
export async function correctionHistory(svc: CoreServices, id: number) {
  const rows = await svc.db
    .withTables<PayrollTables>()
    .selectFrom('payroll_correction')
    .selectAll()
    .orderBy('id', 'desc')
    .execute();
  return rows
    .filter((r) => decodeBatches(r.before_json).some((b) => b.id === id))
    .map((r) => ({
      id: r.id,
      batchId: r.batch_id,
      reason: r.reason,
      createdAt: r.created_at,
      userName: r.user_name,
      before: decodeBatches(r.before_json),
      after: decodeBatches(r.after_json),
    }));
}
