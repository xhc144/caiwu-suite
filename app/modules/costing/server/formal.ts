import { createHash } from 'node:crypto';
import { nextPeriod, type CostingCommitInput, type InventorySnapshot } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { Selectable } from '@caiwu/db';
import type { z } from 'zod';
import {
  CancelCalculationSchema,
  CommitCalculationSchema,
  type CalculationResult,
} from '../shared';
import { calculate } from './calculation';
import { assertHistory } from './inventory-read';
import { fail } from './math';
import type { CostingTables } from './migrations';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Batch = Selectable<CostingTables['costing_batch']>;
const response = (row: Batch) => ({
  id: row.id,
  inventoryBatchId: row.inventory_batch_id,
  period: row.period,
  revision: row.revision,
  status: row.status,
});
function requireOwner(svc: CoreServices) {
  svc.permissions.require('costing.calculate');
  if (svc.moduleId !== 'costing') fail('OWNER', '正式成本操作必须从成本核算模块发起');
}
function inTransaction<T>(svc: CoreServices, run: (t: CoreServices) => Promise<T>): Promise<T> {
  return svc.db.isTransaction ? run(svc) : svc.tx(run);
}
async function assertSnapshotContext(t: CoreServices, snapshot: InventorySnapshot) {
  if (
    snapshot.version !== 1 ||
    snapshot.bookId !== (await t.book.info()).id ||
    snapshot.actorId !== t.user.id ||
    snapshot.moduleId !== 'costing'
  )
    fail('SNAPSHOT_CONTEXT', '库存快照与当前账套、操作员或成本模块不一致', '请重新登录并试算');
}

export async function commitCalculation(
  svc: CoreServices,
  raw: z.input<typeof CommitCalculationSchema>,
) {
  requireOwner(svc);
  const input = CommitCalculationSchema.parse(raw);
  if (!input.confirmed)
    fail('CONFIRM', '正式发布需要明确确认', '请核对试算结果，再确认锁定本月库存');
  const hash = digest(input);
  // 外层 with 和内部每个库存操作均被等待，能力对象不离开回调。
  return inTransaction(svc, (t) =>
    t.inventory.with(async (inv) => {
      const db = t.db.withTables<CostingTables>();
      const repeated = await db
        .selectFrom('costing_batch')
        .selectAll()
        .where('request_key', '=', input.requestKey)
        .executeTakeFirst();
      if (repeated) {
        if (
          repeated.request_hash !== hash ||
          repeated.created_by !== t.user.id ||
          repeated.module_id !== t.moduleId ||
          repeated.status !== 'calculated'
        )
          fail('REQUEST', '核算请求号已使用且内容、操作员或状态不同', '请重新试算后发起新请求');
        const saved = JSON.parse(repeated.commit_json) as CostingCommitInput;
        // 库存端也复核幂等记录与当前有效链，不能只凭本模块一行记录返回成功。
        const official = await inv.commitCosting(saved);
        if (
          official.batchId !== repeated.inventory_batch_id ||
          official.revision !== repeated.revision
        )
          fail('BATCH_LINK', '成本批次与库存正式记录不一致', '请核对正式批次后重试');
        return response(repeated);
      }
      await t.periods.assertOpen(input.period, '正式成本核算');
      const snapshot = await inv.snapshot(input.period);
      await assertSnapshotContext(t, snapshot);
      if (snapshot.fingerprint !== input.fingerprint)
        fail('STALE', '来源数据或操作员已变化，不能发布旧试算', '请重新试算并核对结果后再次确认');
      assertHistory(snapshot);
      const expectedPeriod =
        snapshot.control.costPeriod === null
          ? snapshot.startPeriod
          : nextPeriod(snapshot.control.costPeriod);
      const wrongPeriod = input.period !== expectedPeriod;
      const wrongPrevious = snapshot.previousBatchId !== snapshot.control.costBatch;
      if (wrongPeriod || wrongPrevious)
        fail(
          'SEQUENCE',
          '必须从启用月份逐月连续正式核算，不能跳月或重复发布',
          `请先核算 ${expectedPeriod}`,
        );
      const result = calculate(snapshot, input.period, input.adjustZeroQuantity);
      // 启用月可以没有业务；仍保存真实空月批次和月锁，让下一月连续承接。
      // 空数组原样交给库存桥，不补造期初、结存或来源明细。
      const commit: CostingCommitInput = {
        bookId: snapshot.bookId,
        period: input.period,
        requestKey: input.requestKey,
        expectedStockRevision: snapshot.stockRevision,
        expectedOpeningRevision: snapshot.openingRevision,
        previousBatchId: snapshot.previousBatchId,
        fingerprint: snapshot.fingerprint,
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
            snapshot.counts.find(
              (c) =>
                c.period === input.period &&
                c.warehouseId === r.warehouseId &&
                c.lines.some((l) => l.productId === r.productId),
            )?.id ?? null,
          quantity: r.countDifference,
          amountCents: r.countCents,
          zeroQuantityAdjustmentCents: r.zeroQuantityAdjustmentCents,
        })),
      };
      const official = await inv.commitCosting(commit);
      const row = await db
        .insertInto('costing_batch')
        .values({
          period: official.period,
          request_key: input.requestKey,
          request_hash: hash,
          inventory_batch_id: official.batchId,
          status: official.status,
          revision: official.revision,
          fingerprint: snapshot.fingerprint,
          adjust_zero_quantity: Number(input.adjustZeroQuantity),
          // 保留桥返回的版本、指纹及 periodOpening 原文，不补历史、不伪造期初。
          snapshot_json: JSON.stringify(snapshot),
          commit_json: JSON.stringify(commit),
          result_json: JSON.stringify(result),
          created_by: t.user.id,
          module_id: 'costing',
          created_at: t.ctx.now().toISOString(),
          cancelled_at: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await t.log.write({
        action: 'costing.calculate.commit',
        summary: `正式发布 ${input.period} 月末加权成本并锁定本月库存`,
        targetType: 'costing_batch',
        targetId: row.id,
      });
      return response(row);
    }),
  );
}

export async function cancelCalculation(
  svc: CoreServices,
  raw: z.input<typeof CancelCalculationSchema>,
) {
  requireOwner(svc);
  const input = CancelCalculationSchema.parse(raw);
  if (!input.confirmed) fail('CONFIRM', '撤销正式核算需要明确确认', '请核对最后有效批次后确认撤销');
  return inTransaction(svc, (t) =>
    t.inventory.with(async (inv) => {
      const db = t.db.withTables<CostingTables>();
      const row = await db
        .selectFrom('costing_batch')
        .selectAll()
        .where('id', '=', input.id)
        .executeTakeFirst();
      if (!row) fail('NOT_FOUND', '正式成本批次不存在', '请刷新正式核算记录');
      const snapshot = await inv.snapshot(row.period);
      await assertSnapshotContext(t, snapshot);
      assertHistory(snapshot);
      const inventoryBatch = snapshot.batches.find((b) => b.id === row.inventory_batch_id);
      if (
        row.status === 'cancelled' &&
        input.revision + 1 === row.revision &&
        inventoryBatch?.status === 'cancelled' &&
        inventoryBatch.revision === row.revision
      )
        return response(row);
      if (row.status !== 'calculated' || row.revision !== input.revision)
        fail('REVISION', '正式批次已撤销或版本已经变化', '请刷新正式核算记录');
      if (!snapshot.control.costBatch)
        fail('INITIAL_PERIOD', '已到初始开账日期，没有可以取消的成本核算');
      if (snapshot.control.costBatch !== row.inventory_batch_id)
        fail('LATER', '只能撤销最后一个有效月份的正式核算', '请从最后核算月份依次撤销');
      if (inventoryBatch?.revision !== row.revision || inventoryBatch.status !== 'calculated')
        fail('BATCH_LINK', '成本批次与库存正式记录不一致', '请核对正式批次后重试');
      // 库存能力负责审核保护、成本凭证释放和删除、库存前态恢复；不再二次删除凭证。
      const official = await inv.cancelCosting({
        bookId: snapshot.bookId,
        batchId: row.inventory_batch_id,
        expectedRevision: row.revision,
      });
      const updated = await db
        .updateTable('costing_batch')
        .set({
          status: official.status,
          revision: official.revision,
          cancelled_at: t.ctx.now().toISOString(),
        })
        .where('id', '=', row.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await t.log.write({
        action: 'costing.calculate.cancel',
        summary: `撤销 ${row.period} 正式成本核算并恢复库存前态`,
        targetType: 'costing_batch',
        targetId: row.id,
      });
      return response(updated);
    }),
  );
}

export async function listBatches(svc: CoreServices) {
  svc.permissions.require('costing.view');
  const rows = await svc.db
    .withTables<CostingTables>()
    .selectFrom('costing_batch')
    .select([
      'id',
      'period',
      'inventory_batch_id',
      'status',
      'revision',
      'created_at',
      'cancelled_at',
      'result_json',
    ])
    .orderBy('id', 'desc')
    .execute();
  return rows.map(({ result_json, ...row }) => ({
    ...row,
    result: JSON.parse(result_json) as CalculationResult,
  }));
}
