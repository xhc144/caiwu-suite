import { nextPeriod } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { z } from 'zod';
import {
  CancelCalculationSchema,
  CommitCalculationSchema,
  type CalculationResult,
} from '../shared';
import { calculate } from './calculation';
import { digest, readInventory, verifiedBatches } from './inventory-read';
import { fail } from './math';
import type { CostingTables } from './migrations';

export async function commitCalculation(
  svc: CoreServices,
  raw: z.input<typeof CommitCalculationSchema>,
) {
  svc.permissions.require('costing.calculate');
  const input = CommitCalculationSchema.parse(raw);
  if (!input.confirmed)
    fail('CONFIRM', '正式成本核算需要确认', '请核对试算，确认后将锁定本月库存来源');
  return svc.tx(async (t) => {
    const db = t.db.withTables<CostingTables>();
    const requestHash = digest(input);
    const repeated = await db
      .selectFrom('costing_calculation')
      .selectAll()
      .where('request_key', '=', input.requestKey)
      .executeTakeFirst();
    if (repeated) {
      const state = await t.inventory.snapshot(repeated.period);
      const batch = state.batches.find((b) => b.id === repeated.batch_id);
      if (
        repeated.request_hash !== requestHash ||
        repeated.created_by !== t.user.id ||
        batch?.status !== 'calculated'
      )
        fail('REQUEST', '核算请求已使用且内容、操作员或状态不同', '请重新试算后提交新的核算请求');
      return {
        batchId: batch.id,
        period: batch.period,
        revision: batch.revision,
        status: batch.status,
        result: JSON.parse(repeated.result_json) as CalculationResult,
      };
    }
    await t.periods.assertWritable({
      period: input.period,
      mode: 'business',
      action: '正式成本核算',
    });
    const snapshot = await readInventory(t, input.period);
    const shared = snapshot.sharedSnapshot;
    const next = shared.control.costPeriod
      ? nextPeriod(shared.control.costPeriod)
      : shared.startPeriod;
    if (input.period !== next)
      fail('SEQUENCE', '必须从启用月份按月连续核算，不能跳月或重复核算', `下一核算月份为 ${next}`);
    if (snapshot.fingerprint !== input.fingerprint)
      fail('STALE', '库存、期初或盘点数据已变化，不能提交旧试算', '请重新试算后再核算');
    const result = calculate(snapshot, input.period, input.adjustZeroQuantity);
    // 空月也建立正式批次和整月锁，才能从启用月连续承接到首次发生库存业务的月份。
    const batch = await t.inventory.with((inventory) =>
      inventory.commitCosting({
        bookId: shared.bookId,
        period: input.period,
        requestKey: input.requestKey,
        expectedStockRevision: shared.stockRevision,
        expectedOpeningRevision: shared.openingRevision,
        previousBatchId: shared.previousBatchId,
        fingerprint: shared.fingerprint,
        lines: result.lines,
        balances: result.rows.map((r) => ({
          warehouseId: r.warehouseId,
          productId: r.productId,
          quantity: r.closingQuantity,
          amountCents: r.closingCents,
        })),
        countAdjustments: result.rows.map((r) => ({
          warehouseId: r.warehouseId,
          productId: r.productId,
          countId:
            shared.counts.find(
              (c) =>
                c.period === input.period &&
                c.warehouseId === r.warehouseId &&
                c.lines.some((l) => l.productId === r.productId),
            )?.id ?? null,
          quantity: r.countDifference,
          amountCents: r.countCents,
          zeroQuantityAdjustmentCents: r.zeroQuantityAdjustmentCents,
        })),
      }),
    );
    await db
      .insertInto('costing_calculation')
      .values({
        batch_id: batch.batchId,
        request_key: input.requestKey,
        request_hash: requestHash,
        period: input.period,
        result_json: JSON.stringify(result),
        created_by: t.user.id,
        created_at: t.ctx.now().toISOString(),
      })
      .execute();
    await t.log.write({
      action: 'costing.calculate',
      summary: `正式核算 ${input.period} 月末加权库存成本`,
      targetId: batch.batchId,
    });
    return { ...batch, result };
  });
}

async function cancellationState(t: CoreServices) {
  const period = (await t.periods.current())?.period ?? (await t.book.info()).startPeriod;
  let snapshot = await t.inventory.snapshot(period);
  const batchId = snapshot.control.costBatch;
  if (!batchId || !snapshot.control.costPeriod)
    fail('INITIAL_PERIOD', '已到初始开账日期，没有可以取消的成本核算');
  snapshot = await t.inventory.snapshot(snapshot.control.costPeriod);
  const batch = snapshot.batches.find((b) => b.id === batchId && b.status === 'calculated');
  if (!batch || verifiedBatches(snapshot).get(batchId) !== batch.period)
    fail('HISTORY', '正式成本批次与库存控制记录不一致', '请核实正式核算记录后再操作');
  if (batch.module_id !== 'costing')
    fail('OWNER', '最后一次核算来自仓库功能', '请从原核算入口取消该批次');
  await t.periods.assertWritable({
    period: batch.period,
    mode: 'business',
    action: '取消成本核算',
  });
  const countVoucher = await t.db
    .withTables<CostingTables>()
    .selectFrom('costing_count_voucher')
    .select('count_id')
    .where('batch_id', '=', batch.id)
    .executeTakeFirst();
  if (countVoucher)
    fail(
      'COUNT_VOUCHER',
      '本月已有盘点凭证，请先删除盘点凭证再取消核算',
      '在“出入库与盘点凭证”中选择本月盘点表，预览编号影响后删除；已审核或过账时须先撤销相应状态',
    );
  const documents = snapshot.documents.filter((d) => d.calculationBatch === batch.id);
  const ids = new Set(documents.map((d) => d.id));
  const links = snapshot.voucherSources.filter((s) => ids.has(s.document_id));
  for (const voucherId of new Set([
    ...links.map((s) => s.voucher_id),
    ...documents.flatMap((d) => (d.voucherId ? [d.voucherId] : [])),
  ])) {
    const voucher = await t.vouchers.get(voucherId);
    if (!voucher || voucher.status === 'audited' || voucher.status === 'posted')
      fail(
        'VOUCHER_LOCK',
        '关联凭证缺失、已审核或过账，不能取消成本核算',
        '请先核实凭证，必要时反过账并取消审核',
      );
  }
  const costIds = links.filter((s) => s.purpose === 'cost').map((s) => s.voucher_id);
  return { snapshot, batch, costIds };
}

export async function previewCancelCalculation(svc: CoreServices) {
  svc.permissions.require('costing.calculate');
  return svc.tx(async (t) => {
    const { snapshot, batch, costIds } = await cancellationState(t);
    return {
      batchId: batch.id,
      period: batch.period,
      revision: batch.revision,
      fingerprint: snapshot.fingerprint,
      voucherDeletion: costIds.length ? await t.vouchers.previewDelete(costIds) : null,
    };
  });
}

export async function cancelCalculation(
  svc: CoreServices,
  raw?: z.input<typeof CancelCalculationSchema>,
) {
  svc.permissions.require('costing.calculate');
  return svc.tx(async (t) => {
    const { snapshot, batch, costIds } = await cancellationState(t);
    if (!raw)
      fail('CONFIRM', '请先预览取消最后月份核算的影响', '核对将删除的成本凭证和编号变化后确认');
    const input = CancelCalculationSchema.parse(raw);
    if (!input.confirmed) fail('CONFIRM', '取消成本核算需要确认', '请先核对影响后确认');
    if (
      input.batchId !== batch.id ||
      input.revision !== batch.revision ||
      input.fingerprint !== snapshot.fingerprint
    )
      fail('STALE', '最后批次或来源数据已变化，不能取消旧版本', '请重新预览取消影响');
    if (costIds.length) {
      if (!input.voucherDeletion?.confirmed)
        fail('CONFIRM', '取消核算将删除成本凭证，请先预览并确认编号影响');
      const current = await t.vouchers.previewDelete(costIds, input.voucherDeletion.plan.expiresAt);
      if (
        JSON.stringify(current.ids) !==
          JSON.stringify([...input.voucherDeletion.plan.ids].sort((a, b) => a - b)) ||
        current.fingerprint !== input.voucherDeletion.plan.fingerprint
      )
        fail('STALE', '成本凭证或编号已变化，请重新预览取消影响');
    }
    const result = await t.inventory.with((inventory) =>
      inventory.cancelCosting({
        bookId: snapshot.bookId,
        batchId: batch.id,
        expectedRevision: batch.revision,
        ...(input.voucherDeletion ? { voucherDeletion: input.voucherDeletion } : {}),
      }),
    );
    await t.log.write({
      action: 'costing.calculate.cancel',
      summary: `取消 ${batch.period} 最后月份成本核算`,
      targetId: batch.id,
    });
    return result;
  });
}
