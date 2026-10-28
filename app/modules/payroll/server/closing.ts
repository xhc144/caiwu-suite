import type { CoreServices } from '@caiwu/core/server';
import { employedInPeriod } from '../shared-hr';
import { TaxInputSchema, type RowInput } from '../shared';
import { fail } from './engine';
import { payrollService } from './service';
import type { PayrollTables } from './migrations';
import { assertReopenPeriodOpen } from './reopen-period';
import { assertPayrollStart } from './start-period';
export async function closePayroll(
  svc: CoreServices,
  id: number,
  revision: number,
  confirmed: boolean,
) {
  if (!confirmed) fail('CONFIRM', '工资结账须确认', '结账将冻结本期，并按传递栏目建立下月');
  return svc.tx(async (t) => {
    const s = payrollService(t),
      db = t.db.withTables<PayrollTables>(),
      b = await s.batch(id);
    await assertPayrollStart(t, b.period);
    if (b.closed)
      return {
        batch: b,
        nextId:
          (
            await db
              .selectFrom('payroll_period')
              .select('next_batch_id')
              .where('batch_id', '=', id)
              .executeTakeFirst()
          )?.next_batch_id ?? null,
      };
    if (b.revision !== revision) fail('STALE', '工资批次已修改', '刷新后重新确认结账');
    if (!b.calculated) fail('NOT_CALCULATED', '未计算工资不能结账', '先计算并核对工资');
    await t.periods.assertOpen(b.period, '工资结账');
    const next = b.period % 100 === 12 ? (Math.trunc(b.period / 100) + 1) * 100 + 1 : b.period + 1;
    await assertPayrollStart(t, next);
    const nextExists = await db
      .selectFrom('payroll_batch')
      .select('id')
      .where('period', '=', next)
      .where('category_id', '=', b.categoryId)
      .executeTakeFirst();
    if (nextExists)
      fail(
        'NEXT_EXISTS',
        '下月已有工资数据，不能覆盖传递',
        '保留现有下月数据；首版不支持合并传递',
        `/m/payroll?id=${nextExists.id}`,
      );
    const category = await s.category(b.categoryId);
    if (category.disabled) fail('CATEGORY_DISABLED', '工资类别已停用，不能建立下月');
    const people = await s.employees(),
      rows: RowInput[] = [];
    for (const r of b.snapshots) {
      const e = people.find((e) => e.id === r.employeeId)!;
      if (e.disabled || !employedInPeriod(e, next)) continue;
      const values: Record<string, number> = {};
      const quantities: Record<string, string> = {};
      for (const f of category.fields)
        if (f.carry && !f.disabled && f.kind === 'money')
          values[f.key] = r.calculatedValues[f.key] ?? 0;
        else if (
          f.carry &&
          !f.disabled &&
          f.kind === 'quantity' &&
          r.calculatedQuantities?.[f.key] !== undefined
        )
          quantities[f.key] = r.calculatedQuantities[f.key]!;
      const tax =
        next % 100 === 1 ? TaxInputSchema.parse({}) : { ...r.tax, exempt: 0, confirmed: false };
      rows.push({
        employeeId: r.employeeId,
        values,
        tax,
        ...(Object.keys(quantities).length ? { quantities } : {}),
      });
    }
    let nextId: number | null = null;
    if (rows.length) {
      await t.periods.ensureYear(Math.trunc(next / 100));
      nextId = (
        await s.saveBatch({
          period: next,
          categoryId: b.categoryId,
          categoryRevision: category.revision,
          rows,
        })
      ).id;
    }
    await db
      .updateTable('payroll_batch')
      .set({ closed: 1, revision: b.revision + 1 })
      .where('id', '=', id)
      .execute();
    await db
      .insertInto('payroll_period')
      .values({
        period: b.period,
        category_id: b.categoryId,
        batch_id: id,
        closed: 1,
        next_batch_id: nextId,
      })
      .onConflict((oc) =>
        oc.columns(['period', 'category_id']).doUpdateSet({ closed: 1, next_batch_id: nextId }),
      )
      .execute();
    await t.log.write({
      action: 'payroll.close',
      summary: `工资 ${b.period} 类别 ${b.categoryId} 结账，传递 ${rows.length} 人`,
      targetType: 'payroll_batch',
      targetId: id,
    });
    return { batch: await s.batch(id), nextId };
  });
}
export async function reopenPayroll(
  svc: CoreServices,
  id: number,
  revision: number,
  confirmed: boolean,
) {
  if (!confirmed)
    fail('CONFIRM', '反结账须确认', '反结账仅允许最近已结月份；未修改的传递批次将回退');
  return svc.tx(async (t) => {
    const s = payrollService(t),
      db = t.db.withTables<PayrollTables>(),
      b = await s.batch(id),
      book = await t.book.info();
    await assertPayrollStart(t, b.period);
    if (!b.closed || b.period < book.startPeriod)
      fail('REOPEN_START', '已到工资启用边界，没有可反结账的该月', '只选择本模块最近的已结月份');
    if (b.revision !== revision) fail('STALE', '工资批次已修改', '刷新后重试');
    const latest = await db
      .selectFrom('payroll_period')
      .selectAll()
      .where('category_id', '=', b.categoryId)
      .where('closed', '=', 1)
      .orderBy('period', 'desc')
      .executeTakeFirst();
    if (latest?.batch_id !== id)
      fail('REOPEN_LATEST', '只能反结账最近的工资月份', '先处理最近已结月份');
    if (b.vouchers.some((v) => v.status === 'audited' || v.status === 'posted'))
      fail(
        'LOCKED',
        '该工资来源凭证已审核或过账，不能反结账',
        '保留真实记账金额；先按账务权限处理凭证',
        `/m/voucher-entry/edit?id=${b.vouchers.find((v) => v.status === 'audited' || v.status === 'posted')!.id}`,
      );
    await assertReopenPeriodOpen(t, b.period);
    if (latest.next_batch_id) {
      const next = await s.batch(latest.next_batch_id);
      if (next.revision !== 1 || next.calculated || next.closed || next.vouchers.length)
        fail(
          'NEXT_CHANGED',
          '下月传递批次已修改或计算，不能自动回退',
          '先核对下月数据；首版不删除已修改的工资',
          `/m/payroll?id=${next.id}`,
        );
      await db
        .updateTable('payroll_period')
        .set({ next_batch_id: null })
        .where('batch_id', '=', id)
        .execute();
      await db.deleteFrom('payroll_row').where('batch_id', '=', next.id).execute();
      await db.deleteFrom('payroll_batch').where('id', '=', next.id).execute();
    }
    await db.updateTable('payroll_period').set({ closed: 0 }).where('batch_id', '=', id).execute();
    await db
      .updateTable('payroll_batch')
      .set({ closed: 0, revision: b.revision + 1 })
      .where('id', '=', id)
      .execute();
    await t.log.write({
      action: 'payroll.reopen',
      summary: `工资 ${b.period} 类别 ${b.categoryId} 反结账`,
      targetType: 'payroll_batch',
      targetId: id,
    });
    return s.batch(id);
  });
}
