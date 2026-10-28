import { createHash } from 'node:crypto';
import type { CoreServices } from '@caiwu/core/server';
import type { z } from 'zod';
import { ClosingInputSchema, ClosingApplySchema } from '../shared-closing';
import { TaxInputSchema, type Batch, type RowInput } from '../shared';
import { employedInPeriod } from '../shared-hr';
import { payrollService } from './service';
import { fail } from './engine';
import type { PayrollTables } from './migrations';
import { assertReopenPeriodOpen } from './reopen-period';
import { assertPayrollStart } from './start-period';

type Input = z.input<typeof ClosingInputSchema>;
type Apply = z.input<typeof ClosingApplySchema>;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const expiry = () => Date.now() + 300000;
function requireExpiry(expiresAt: number) {
  if (expiresAt < Date.now() || expiresAt > Date.now() + 300000)
    fail('PLAN_EXPIRED', '结账预览已过期', '重新预览完整影响后再确认');
}
const info = (batch: Batch) => ({
  id: batch.id,
  period: batch.period,
  revision: batch.revision,
  calculated: batch.calculated,
  closed: batch.closed,
  people: batch.rows.length,
});

async function closeMergePlan(svc: CoreServices, raw: Input, expiresAt: number) {
  requireExpiry(expiresAt);
  const input = ClosingInputSchema.parse(raw),
    service = payrollService(svc),
    db = svc.db.withTables<PayrollTables>();
  const source = await service.batch(input.id);
  await assertPayrollStart(svc, source.period);
  if (source.revision !== input.revision) fail('STALE', '本期工资已经变化', '刷新后重新预览');
  if (source.closed || !source.calculated)
    fail('NOT_CALCULATED', '合并传递须选择尚未结账的已计算工资', '保存并计算本期工资，再预览结账');
  await svc.periods.assertOpen(source.period, '工资合并结账');
  const nextPeriod =
    source.period % 100 === 12
      ? (Math.trunc(source.period / 100) + 1) * 100 + 1
      : source.period + 1;
  const targetId = await db
    .selectFrom('payroll_batch')
    .select('id')
    .where('category_id', '=', source.categoryId)
    .where('period', '=', nextPeriod)
    .executeTakeFirst();
  if (!targetId)
    fail('NEXT_MISSING', '下月尚无工资批次', '使用“工资结账”建立下月；已有下月时再用合并传递');
  const target = await service.batch(targetId.id),
    category = await service.category(source.categoryId);
  await assertPayrollStart(svc, target.period);
  if (category.disabled) fail('CATEGORY_DISABLED', '工资类别已经停用', '先启用类别再结账');
  if (target.closed || target.vouchers.length)
    fail(
      'LOCKED',
      '下月工资已结账或已生成凭证，不能合并传递',
      '保留下月来源金额，先按权限处理下月',
    );
  if (target.category.revision !== category.revision)
    fail('STALE', '下月工资结构与当前结构不同', '先核对并保存下月工资，再重新预览');
  await svc.periods.assertOpen(target.period, '工资合并传递');
  const people = await service.employees(),
    nextRows: RowInput[] = target.rows.map((row) => ({
      ...row,
      values: { ...row.values },
      ...(row.quantities ? { quantities: { ...row.quantities } } : {}),
      tax: { ...row.tax },
    }));
  type Change = {
    key: string;
    code: string;
    name: string;
    field: string;
    kind: 'money' | 'quantity' | 'person';
    unit: string;
    before: number | string | null;
    after: number | string;
  };
  const changes: Change[] = [],
    excluded: { code: string; name: string; reason: string }[] = [];
  for (const snapshot of source.snapshots) {
    const employee = people.find((person) => person.id === snapshot.employeeId);
    if (!employee || employee.disabled || !employedInPeriod(employee, nextPeriod)) {
      excluded.push({
        code: snapshot.employee.code,
        name: snapshot.employee.name,
        reason: !employee ? '人员已移除' : employee.disabled ? '人员已停用' : '下月无任职记录',
      });
      continue;
    }
    let row = nextRows.find((candidate) => candidate.employeeId === snapshot.employeeId);
    if (!row) {
      row = {
        employeeId: snapshot.employeeId,
        values: {},
        tax:
          nextPeriod % 100 === 1
            ? TaxInputSchema.parse({})
            : { ...snapshot.tax, exempt: 0, confirmed: false },
      };
      nextRows.push(row);
      changes.push({
        key: `${employee.id}.person`,
        code: employee.code,
        name: employee.name,
        field: '人员',
        kind: 'person',
        unit: '',
        before: null,
        after: '新增下月人员，累计扣除需重新确认',
      });
    }
    for (const field of category.fields.filter((field) => field.carry && !field.disabled)) {
      const before = field.kind === 'money' ? row.values[field.key] : row.quantities?.[field.key];
      if (before !== undefined) continue; // 显式零值也保留。
      if (field.kind === 'money') {
        const after = snapshot.calculatedValues[field.key] ?? 0;
        row.values[field.key] = after;
        changes.push({
          key: `${employee.id}.${field.key}`,
          code: employee.code,
          name: employee.name,
          field: field.name,
          kind: 'money',
          unit: '元',
          before: null,
          after,
        });
      } else if (field.kind === 'quantity') {
        const after = snapshot.calculatedQuantities?.[field.key];
        if (after === undefined) continue;
        row.quantities = { ...row.quantities, [field.key]: after };
        changes.push({
          key: `${employee.id}.${field.key}`,
          code: employee.code,
          name: employee.name,
          field: field.name,
          kind: 'quantity',
          unit: field.unit ?? '',
          before: null,
          after,
        });
      }
    }
  }
  if (changes.length) await service.assertMutable(target.id, target.revision);
  const publicPlan = {
    source: info(source),
    target: info(target),
    categoryName: category.name,
    changes,
    excluded,
    afterPeople: nextRows.length,
    willRecalculate: changes.length > 0 && target.calculated,
    expiresAt,
  };
  return {
    ...publicPlan,
    hash: hash({ publicPlan, source, target, category, people, nextRows }),
    nextRows,
    sourceBatch: source,
    targetBatch: target,
    category,
  };
}
export async function previewCloseMerge(svc: CoreServices, raw: Input) {
  const {
    nextRows: _rows,
    sourceBatch: _source,
    targetBatch: _target,
    category: _category,
    ...plan
  } = await closeMergePlan(svc, raw, expiry());
  return plan;
}
export async function applyCloseMerge(svc: CoreServices, raw: Apply) {
  const input = ClosingApplySchema.parse(raw);
  if (!input.confirmed)
    fail('CONFIRM', '合并结账须确认完整预览', '核对本期冻结及下月补值范围，取消不会修改数据');
  requireExpiry(input.expiresAt);
  return svc.tx(async (transaction) => {
    const plan = await closeMergePlan(transaction, input, input.expiresAt);
    if (plan.hash !== input.hash)
      fail('PLAN_STALE', '合并结账预览已经失效', '本期、下月、结构或人事资料发生变化，请重新预览');
    const service = payrollService(transaction),
      db = transaction.db.withTables<PayrollTables>();
    if (plan.changes.length)
      await service.saveBatch({
        ...plan.targetBatch,
        categoryRevision: plan.category.revision,
        rows: plan.nextRows,
      });
    await db
      .updateTable('payroll_batch')
      .set({ closed: 1, revision: plan.source.revision + 1 })
      .where('id', '=', input.id)
      .execute();
    await db
      .insertInto('payroll_period')
      .values({
        period: plan.source.period,
        category_id: plan.sourceBatch.categoryId,
        batch_id: input.id,
        closed: 1,
        next_batch_id: plan.target.id,
      })
      .onConflict((conflict) =>
        conflict
          .columns(['period', 'category_id'])
          .doUpdateSet({ closed: 1, next_batch_id: plan.target.id }),
      )
      .execute();
    await transaction.log.write({
      action: 'payroll.close.merge',
      summary: `工资 ${plan.source.period} 合并结账，下月保留已有值并补入 ${plan.changes.length} 项`,
      targetType: 'payroll_batch',
      targetId: input.id,
    });
    return {
      batch: await service.batch(input.id),
      nextId: plan.target.id,
      next: await service.batch(plan.target.id),
    };
  });
}

async function reopenKeepPlan(svc: CoreServices, raw: Input, expiresAt: number) {
  requireExpiry(expiresAt);
  const input = ClosingInputSchema.parse(raw),
    service = payrollService(svc),
    db = svc.db.withTables<PayrollTables>(),
    source = await service.batch(input.id),
    book = await svc.book.info();
  await assertPayrollStart(svc, source.period);
  if (source.revision !== input.revision) fail('STALE', '工资已经变化', '刷新后重新预览');
  if (!source.closed || source.period < book.startPeriod)
    fail('REOPEN_START', '已到工资启用边界，没有可反结账的该月', '只选择本模块最近的已结月份');
  const latest = await db
    .selectFrom('payroll_period')
    .selectAll()
    .where('category_id', '=', source.categoryId)
    .where('closed', '=', 1)
    .orderBy('period', 'desc')
    .executeTakeFirst();
  if (latest?.batch_id !== source.id)
    fail('REOPEN_LATEST', '只能反结账最近的工资月份', '先处理最近已结月份');
  if (
    source.vouchers.some((voucher) => voucher.status === 'audited' || voucher.status === 'posted')
  )
    fail('LOCKED', '该工资来源凭证已审核或过账，不能反结账', '先按账务权限处理来源凭证');
  await assertReopenPeriodOpen(svc, source.period);
  const nextPeriod =
    source.period % 100 === 12
      ? (Math.trunc(source.period / 100) + 1) * 100 + 1
      : source.period + 1;
  const unlinkedNext = latest.next_batch_id
    ? null
    : await db
        .selectFrom('payroll_batch')
        .select('id')
        .where('category_id', '=', source.categoryId)
        .where('period', '=', nextPeriod)
        .executeTakeFirst();
  const targetId = latest.next_batch_id ?? unlinkedNext?.id;
  const target = targetId ? await service.batch(targetId) : null;
  if (target) await assertPayrollStart(svc, target.period);
  if (target && (target.closed || target.vouchers.length))
    fail('LOCKED', '下月已结账或已生成凭证，不能解除本期结账', '先核对并按权限处理下月工资');
  const retainedRows = await Promise.all(
    (target?.rows ?? []).map(async (row) => {
      const employee =
        target?.snapshots.find((snapshot) => snapshot.employeeId === row.employeeId)?.employee ??
        (await service.employee(row.employeeId));
      return {
        employeeId: row.employeeId,
        code: employee.code,
        name: employee.name,
        fields: (target?.category.fields ?? []).flatMap<{
          key: string;
          name: string;
          kind: 'money' | 'quantity';
          value: number | string;
          unit: string;
        }>((field) =>
          field.kind === 'money' && row.values[field.key] !== undefined
            ? [
                {
                  key: field.key,
                  name: field.name,
                  kind: 'money' as const,
                  value: row.values[field.key]!,
                  unit: '元',
                },
              ]
            : field.kind === 'quantity' && row.quantities?.[field.key] !== undefined
              ? [
                  {
                    key: field.key,
                    name: field.name,
                    kind: 'quantity' as const,
                    value: row.quantities[field.key]!,
                    unit: field.unit ?? '',
                  },
                ]
              : [],
        ),
      };
    }),
  );
  const publicPlan = {
    source: info(source),
    target: target ? info(target) : null,
    categoryName: source.category.name,
    retainedPeople: target?.rows.length ?? 0,
    retainedRows,
    retainedAmounts:
      target?.snapshots.map((row) => ({
        code: row.employee.code,
        name: row.employee.name,
        gross: row.gross,
        taxAmount: row.taxAmount,
        net: row.net,
      })) ?? [],
    expiresAt,
  };
  return { ...publicPlan, hash: hash({ publicPlan, source, target, latest }), sourceBatch: source };
}
export async function previewReopenKeep(svc: CoreServices, raw: Input) {
  const { sourceBatch: _source, ...plan } = await reopenKeepPlan(svc, raw, expiry());
  return plan;
}
export async function applyReopenKeep(svc: CoreServices, raw: Apply) {
  const input = ClosingApplySchema.parse(raw);
  if (!input.confirmed)
    fail(
      'CONFIRM',
      '保留下月数据反结账须明确确认',
      '本期将解除结账，下月已编辑工资与计算结果全部保留',
    );
  requireExpiry(input.expiresAt);
  return svc.tx(async (transaction) => {
    const plan = await reopenKeepPlan(transaction, input, input.expiresAt);
    if (plan.hash !== input.hash)
      fail('PLAN_STALE', '反结账预览已经失效', '本期或下月已变化，请重新预览');
    const db = transaction.db.withTables<PayrollTables>();
    await db
      .updateTable('payroll_period')
      .set({ closed: 0, next_batch_id: null })
      .where('batch_id', '=', input.id)
      .execute();
    await db
      .updateTable('payroll_batch')
      .set({ closed: 0, revision: plan.source.revision + 1 })
      .where('id', '=', input.id)
      .execute();
    await transaction.log.write({
      action: 'payroll.reopen.keep',
      summary: `工资 ${plan.source.period} 反结账，完整保留下月 ${plan.retainedPeople} 人数据`,
      targetType: 'payroll_batch',
      targetId: input.id,
    });
    return payrollService(transaction).batch(input.id);
  });
}
