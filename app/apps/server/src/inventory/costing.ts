import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Decimal, nextPeriod, periodEndDate, periodOfDate, sumCents } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { sql, isInDatabaseTransaction, type Selectable } from '@caiwu/db';
import {
  CostingCancelSchema,
  CostingCommitSchema,
  VoucherSourceSchema,
  type CostingCancelInput,
  type CostingCommitInput,
  type VoucherSourceInput,
} from '@caiwu/core';
import { readCostingSnapshot } from './costing-snapshot';
import { e6, fail, quantity } from '../../../../modules/inventory/server/service';
import type { InventoryTables } from './migrations';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = (w: number, p: number) => `${w}:${p}`;
const integer = (n: number) => {
  if (!Number.isSafeInteger(n)) fail('COST_RANGE', '核算金额或数量超出安全整数范围');
  return BigInt(n);
};
const safe = (n: bigint) => {
  const value = Number(n);
  integer(value);
  return value;
};
const rounded = (n: bigint, d: bigint) => {
  if (d <= 0n) fail('COST_BASIS', '没有可用库存数量，不能确定成本');
  return (n < 0n ? -1n : 1n) * ((2n * (n < 0n ? -n : n) + d) / (2n * d));
};
type Before = {
  control: InventoryTables['inventory_control'];
  documents: Selectable<InventoryTables['inventory_document']>[];
  lines: Selectable<InventoryTables['inventory_line']>[];
  opening: Selectable<InventoryTables['inventory_opening']>[];
  counts: Selectable<InventoryTables['inventory_count']>[];
  countLines: Selectable<InventoryTables['inventory_count_line']>[];
};
type Binding = { svc: CoreServices; active: boolean };
const bindings = new AsyncLocalStorage<Binding>();
export async function withInventoryCosting<T>(
  svc: CoreServices,
  run: (inventory: ReturnType<typeof inventoryCosting>) => Promise<T>,
): Promise<T> {
  if (!svc.db.isTransaction || !isInDatabaseTransaction())
    fail('TRANSACTION_REQUIRED', '写库存核算必须在 svc.tx 回调内执行');
  const binding: Binding = { svc, active: true };
  return bindings.run(binding, async () => {
    try {
      return await run(inventoryCosting(svc));
    } finally {
      binding.active = false;
    }
  });
}

/** Bind this factory again to the svc passed into svc.tx. No global book, actor,
 * connection, or module is captured. Writers refuse a nontransactional svc. */
export function inventoryCosting(svc: CoreServices) {
  const binding = bindings.getStore();
  const db = svc.db.withTables<InventoryTables>();
  const permission = (kind: 'read' | 'cost' | 'voucher') => {
    if (svc.moduleId !== 'inventory' && svc.moduleId !== 'costing')
      fail('COST_OWNER', '库存核算只能由库存或成本模块调用');
    svc.permissions.require(
      svc.moduleId === 'costing'
        ? kind === 'read'
          ? 'costing.view'
          : kind === 'cost'
            ? 'costing.calculate'
            : 'costing.voucher'
        : kind === 'read'
          ? 'inventory.view'
          : kind === 'cost'
            ? 'inventory.costing'
            : 'inventory.voucher',
    );
    if (
      kind !== 'read' &&
      (!svc.db.isTransaction ||
        !isInDatabaseTransaction() ||
        !binding?.active ||
        binding.svc !== svc ||
        bindings.getStore() !== binding)
    )
      fail(
        'TRANSACTION_REQUIRED',
        '正式核算和来源凭证操作必须在同一个 svc.tx / withInventoryCosting 作用域内执行',
        '在 svc.tx 回调中用回调 svc 调用 withInventoryCosting；禁止保存或复用退出作用域后的服务',
      );
  };
  const checkBook = async (bookId: string) => {
    if ((await svc.book.info()).id !== bookId) fail('COST_BOOK', '请求账套与当前绑定账套不一致');
  };
  const bump = () =>
    db
      .updateTable('inventory_control')
      .set({ stock_revision: sql`stock_revision+1` })
      .where('id', '=', 1)
      .execute();
  const document = async (id: number, revision: number) => {
    const d = await db
      .selectFrom('inventory_document')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!d) fail('NOT_FOUND', '来源单据已不存在');
    if (d.revision !== revision) fail('REVISION', '来源单据版本已变化，请重新读取');
    return d;
  };
  const self = {
    async snapshot(period: number) {
      permission('read');
      return svc.tx(async (t) => {
        const data = await readCostingSnapshot(t, period);
        const tdb = t.db.withTables<InventoryTables>();
        const control = await tdb
          .selectFrom('inventory_control')
          .selectAll()
          .where('id', '=', 1)
          .executeTakeFirstOrThrow();
        const periodState = await t.periods.require(period);
        const batches = await tdb
          .selectFrom('inventory_costing_batch')
          .select([
            'id',
            'period',
            'status',
            'revision',
            'previous_batch_id',
            'actor_id',
            'module_id',
          ])
          .orderBy('period')
          .orderBy('created_at')
          .execute();
        const previousBatch =
          [...batches].reverse().find((b) => b.status === 'calculated' && b.period < period) ??
          null;
        const balances = previousBatch
          ? await tdb
              .selectFrom('inventory_costing_balance')
              .selectAll()
              .where('batch_id', '=', previousBatch.id)
              .orderBy('warehouse_id')
              .orderBy('product_id')
              .execute()
          : [];
        const voucherSources = await tdb
          .selectFrom('inventory_voucher_source as s')
          .innerJoin('inventory_document as d', 'd.id', 's.document_id')
          .selectAll('s')
          .where('d.date', '<=', data.cutoffDate)
          .orderBy('document_id')
          .orderBy('purpose')
          .execute();
        const periodOpeningReady =
          period === data.startPeriod ||
          (previousBatch != null && nextPeriod(previousBatch.period) === period);
        const value = {
          ...data,
          actorId: t.user.id,
          moduleId: t.moduleId,
          openingRevision: control.opening_revision,
          periodState: periodState.status,
          previousBatchId: previousBatch?.id ?? null,
          periodOpeningReady,
          batches,
          voucherSources,
          periodOpening: !periodOpeningReady
            ? []
            : previousBatch
              ? balances.map((b) => ({
                  warehouseId: b.warehouse_id,
                  productId: b.product_id,
                  quantity: quantity(b.quantity_e6),
                  amountCents: b.amount_cents,
                  sourceBatchId: previousBatch.id,
                }))
              : data.opening.map((o) => ({
                  warehouseId: o.warehouseId,
                  productId: o.productId,
                  quantity: o.quantity,
                  amountCents: o.amountCents,
                  sourceBatchId: null,
                })),
        };
        return { ...value, fingerprint: digest(value) };
      });
    },
    async commitCosting(raw: CostingCommitInput) {
      permission('cost');
      const input = CostingCommitSchema.parse(raw);
      await checkBook(input.bookId);
      const payloadHash = digest(input);
      const repeated = await db
        .selectFrom('inventory_costing_batch')
        .selectAll()
        .where('request_key', '=', input.requestKey)
        .executeTakeFirst();
      if (repeated) {
        if (
          repeated.payload_hash !== payloadHash ||
          repeated.actor_id !== svc.user.id ||
          repeated.module_id !== svc.moduleId ||
          repeated.status !== 'calculated'
        )
          fail('COST_REQUEST', '核算请求号已使用且内容、操作员或状态不同');
        return {
          batchId: repeated.id,
          revision: repeated.revision,
          period: repeated.period,
          status: repeated.status,
        };
      }
      await svc.periods.assertOpen(input.period, '正式成本核算');
      const current = await self.snapshot(input.period);
      if (
        current.fingerprint !== input.fingerprint ||
        current.stockRevision !== input.expectedStockRevision ||
        current.openingRevision !== input.expectedOpeningRevision ||
        current.previousBatchId !== input.previousBatchId
      )
        fail('COST_STALE', '库存、期初、盘点或操作员上下文已变化，请重新试算');
      const previous = current.batches.filter((b) => b.status === 'calculated').at(-1);
      if (
        input.period !== (previous ? nextPeriod(previous.period) : current.startPeriod) ||
        (current.control.costBatch ?? null) !== (previous?.id ?? null) ||
        current.control.costPeriod !== (previous?.period ?? null) ||
        current.control.costCutoffDate !== (previous ? periodEndDate(previous.period) : null)
      )
        fail('COST_SEQUENCE', '必须从启用月份按月连续核算，不能跳月或重复核算');
      const monthDocuments = current.documents.filter((d) => d.period === input.period);
      const completeDocuments = await db
        .selectFrom('inventory_document')
        .select('id')
        .where('period', '=', input.period)
        .execute();
      if (completeDocuments.length !== monthDocuments.length)
        fail('COST_STATE', '本月单据日期与期间不一致，不能遗漏来源后核算');
      if (
        monthDocuments.some(
          (d) =>
            d.date > current.cutoffDate ||
            periodOfDate(d.date) !== d.period ||
            d.calculationStatus !== 'uncalculated' ||
            d.calculationBatch,
        )
      )
        fail('COST_STATE', '本月存在日期或核算状态不一致的来源单据');
      const docMap = new Map(monthDocuments.map((d) => [d.id, d]));
      const monthLines = current.movements.filter((l) => docMap.has(l.documentId));
      for (const l of monthLines)
        if (
          e6(l.quantity) <= 0 ||
          integer(l.netCents) < 0n ||
          integer(l.taxCents) < 0n ||
          integer(l.grossCents) !== integer(l.netCents) + integer(l.taxCents)
        )
          fail('COST_STATE', '来源明细数量或价税金额不合法');
      if (monthLines.some((l) => l.calculationStatus !== 'uncalculated' || l.calculationBatch))
        fail('COST_STATE', '本月存在已参与核算的单据明细');
      const counts = current.counts.filter((c) => c.period === input.period);
      if (counts.some((c) => c.calculationStatus !== 'uncalculated' || c.calculationBatch))
        fail('COST_STATE', '本月盘点已经参与核算');
      const pools = new Map<
        string,
        {
          warehouseId: number;
          productId: number;
          openingQ: bigint;
          openingA: bigint;
          receivedQ: bigint;
          receivedA: bigint;
          issuedQ: bigint;
          issuedA: bigint;
          countId: number | null;
          actualQ: bigint | null;
        }
      >();
      const pool = (w: number, p: number) => {
        const k = key(w, p);
        let r = pools.get(k);
        if (!r) {
          r = {
            warehouseId: w,
            productId: p,
            openingQ: 0n,
            openingA: 0n,
            receivedQ: 0n,
            receivedA: 0n,
            issuedQ: 0n,
            issuedA: 0n,
            countId: null,
            actualQ: null,
          };
          pools.set(k, r);
        }
        return r;
      };
      for (const o of current.periodOpening) {
        const r = pool(o.warehouseId, o.productId);
        r.openingQ = integer(e6(o.quantity));
        r.openingA = integer(o.amountCents);
      }
      for (const c of counts)
        for (const l of c.lines) {
          const r = pool(c.warehouseId, l.productId);
          r.countId = c.id;
          r.actualQ = integer(e6(l.actualQuantity));
          if (r.actualQ < 0n) fail('COST_NEGATIVE', '实盘数量为负，不能正式核算');
        }
      for (const l of monthLines)
        if (docMap.get(l.documentId)!.kind === 'receipt') {
          const r = pool(docMap.get(l.documentId)!.warehouseId, l.productId);
          r.receivedQ += integer(e6(l.quantity));
          r.receivedA += integer(l.netCents);
        }
      const requestedLines = new Map(input.lines.map((l) => [l.lineId, l]));
      if (
        requestedLines.size !== input.lines.length ||
        input.lines.length !==
          monthLines.filter((l) => docMap.get(l.documentId)!.kind === 'issue').length
      )
        fail('COST_LINES', '必须且只能提交本月完整出库明细集合，不得重复或漏行');
      for (const l of monthLines)
        if (docMap.get(l.documentId)!.kind === 'issue') {
          const r = pool(docMap.get(l.documentId)!.warehouseId, l.productId),
            given = requestedLines.get(l.id);
          if (!given || given.documentId !== l.documentId)
            fail('COST_LINES', '出库明细与来源单据不一致');
          const availableQ = r.openingQ + r.receivedQ,
            availableA = r.openingA + r.receivedA;
          r.issuedQ += integer(e6(l.quantity));
          if (r.issuedQ > availableQ || availableA < 0n)
            fail('COST_NEGATIVE', '本月可用数量或金额不足，不能正式核算负库存');
          const cumulative = rounded(availableA * r.issuedQ, availableQ);
          const expected = safe(cumulative - r.issuedA);
          const expectedUnit = new Decimal(availableA.toString())
            .mul(10000)
            .div(availableQ.toString())
            .toDecimalPlaces(12);
          if (given.costCents !== expected || !new Decimal(given.unitCost).eq(expectedUnit))
            fail('COST_ALLOCATION', '出库成本或单位成本不符合本月加权分配，不能发布');
          r.issuedA = cumulative;
        }
      const requestedBalances = new Map(
        input.balances.map((b) => [key(b.warehouseId, b.productId), b]),
      );
      const requestedAdjustments = new Map(
        input.countAdjustments.map((a) => [key(a.warehouseId, a.productId), a]),
      );
      if (
        requestedBalances.size !== input.balances.length ||
        requestedBalances.size !== pools.size ||
        requestedAdjustments.size !== input.countAdjustments.length
      )
        fail('COST_BALANCES', '结存或调整集合有重复、漏项');
      for (const [k, r] of pools) {
        const b = requestedBalances.get(k),
          a = requestedAdjustments.get(k);
        const bookQ = r.openingQ + r.receivedQ - r.issuedQ,
          actualQ = r.actualQ ?? bookQ;
        const countQ = actualQ - bookQ,
          availableQ = r.openingQ + r.receivedQ,
          availableA = r.openingA + r.receivedA;
        const countA = countQ === 0n ? 0n : rounded(availableA * countQ, availableQ);
        const beforeZero = availableA - r.issuedA + countA;
        const zeroA = actualQ === 0n ? -beforeZero : 0n;
        if (
          r.openingQ < 0n ||
          r.openingA < 0n ||
          actualQ < 0n ||
          (beforeZero < 0n && actualQ !== 0n)
        )
          fail('COST_NEGATIVE', '核算结存不能为负');
        if (r.countId) {
          const c = counts.find((c) => c.id === r.countId)!;
          if (integer(e6(c.lines.find((l) => l.productId === r.productId)!.bookQuantity)) !== bookQ)
            fail('COST_COUNT_STALE', '盘点账面数量已变化，请重生成并核对实盘');
        }
        if (
          !b ||
          integer(e6(b.quantity)) !== actualQ ||
          integer(b.amountCents) !== beforeZero + zeroA
        )
          fail('COST_BALANCES', '期初、入出库、实盘调整与结存不守恒');
        if (a) {
          if (
            a.countId !== r.countId ||
            integer(e6(a.quantity)) !== countQ ||
            integer(a.amountCents) !== countA ||
            integer(a.zeroQuantityAdjustmentCents) !== zeroA
          )
            fail('COST_ADJUSTMENT', '盘点或零数量调整与来源不一致');
        } else if (countQ !== 0n || countA !== 0n || zeroA !== 0n)
          fail('COST_ADJUSTMENT', '盘点或零数量调整漏项');
      }
      if ([...requestedAdjustments.keys()].some((k) => !pools.has(k)))
        fail('COST_ADJUSTMENT', '调整包含本月不存在的产品库存');
      const control = await db
        .selectFrom('inventory_control')
        .selectAll()
        .where('id', '=', 1)
        .executeTakeFirstOrThrow();
      const documents = await db
        .selectFrom('inventory_document')
        .selectAll()
        .where('period', '=', input.period)
        .execute();
      const lines = await db
        .selectFrom('inventory_line as l')
        .innerJoin('inventory_document as d', 'd.id', 'l.document_id')
        .selectAll('l')
        .where('d.period', '=', input.period)
        .execute();
      const before: Before = {
        control,
        documents,
        lines,
        opening:
          input.period === current.startPeriod
            ? await db.selectFrom('inventory_opening').selectAll().execute()
            : [],
        countLines: await db
          .selectFrom('inventory_count_line as l')
          .innerJoin('inventory_count as c', 'c.id', 'l.count_id')
          .selectAll('l')
          .where('c.period', '=', input.period)
          .execute(),
        counts: await db
          .selectFrom('inventory_count')
          .selectAll()
          .where('period', '=', input.period)
          .execute(),
      };
      const batchId = randomUUID();
      await db
        .insertInto('inventory_costing_batch')
        .values({
          id: batchId,
          request_key: input.requestKey,
          payload_hash: payloadHash,
          period: input.period,
          previous_batch_id: input.previousBatchId,
          status: 'calculated',
          revision: 1,
          fingerprint: input.fingerprint,
          actor_id: svc.user.id,
          module_id: svc.moduleId!,
          before_json: JSON.stringify(before),
          created_at: svc.ctx.now().toISOString(),
          cancelled_at: null,
        })
        .execute();
      for (const b of input.balances)
        await db
          .insertInto('inventory_costing_balance')
          .values({
            batch_id: batchId,
            warehouse_id: b.warehouseId,
            product_id: b.productId,
            quantity_e6: e6(b.quantity),
            amount_cents: b.amountCents,
          })
          .execute();
      for (const a of input.countAdjustments)
        await db
          .insertInto('inventory_costing_adjustment')
          .values({
            batch_id: batchId,
            warehouse_id: a.warehouseId,
            product_id: a.productId,
            count_id: a.countId,
            quantity_e6: e6(a.quantity),
            amount_cents: a.amountCents,
            zero_cents: a.zeroQuantityAdjustmentCents,
          })
          .execute();
      const metadata = {
        calculation_status: 'calculated',
        calculation_batch: batchId,
        calculation_period: input.period,
      };
      await db
        .updateTable('inventory_document')
        .set({
          ...metadata,
          calculation_cutoff_date: periodEndDate(input.period),
          revision: sql`revision+1`,
        })
        .where('period', '=', input.period)
        .execute();
      for (const l of lines) {
        const cost = requestedLines.get(l.id);
        await db
          .updateTable('inventory_line')
          .set({
            ...metadata,
            outbound_cost_cents: cost?.costCents ?? null,
            unit_cost: cost?.unitCost ?? null,
          })
          .where('id', '=', l.id)
          .execute();
      }
      await db
        .updateTable('inventory_count')
        .set({
          calculation_status: 'calculated',
          calculation_batch: batchId,
          revision: sql`revision+1`,
        })
        .where('period', '=', input.period)
        .execute();
      for (const r of pools.values())
        if (r.countId)
          await db
            .updateTable('inventory_count_line')
            .set({ book_cents: safe(r.openingA + r.receivedA - r.issuedA) })
            .where('count_id', '=', r.countId)
            .where('product_id', '=', r.productId)
            .execute();
      if (input.period === current.startPeriod)
        await db.updateTable('inventory_opening').set(metadata).execute();
      await db
        .insertInto('inventory_costing_month_lock')
        .values({ period: input.period, batch_id: batchId })
        .execute();
      await db
        .updateTable('inventory_control')
        .set({
          cost_period: input.period,
          cost_cutoff_date: periodEndDate(input.period),
          cost_batch: batchId,
          opening_locked: 1,
        })
        .where('id', '=', 1)
        .execute();
      await bump();
      await svc.log.write({
        action: 'inventory.costing.commit',
        summary: `正式成本核算 ${input.period}`,
        targetId: batchId,
      });
      return { batchId, revision: 1, period: input.period, status: 'calculated' as const };
    },
    async cancelCosting(raw: CostingCancelInput) {
      permission('cost');
      const input = CostingCancelSchema.parse(raw);
      await checkBook(input.bookId);
      const batch = await db
        .selectFrom('inventory_costing_batch')
        .selectAll()
        .where('id', '=', input.batchId)
        .executeTakeFirst();
      if (!batch || batch.status !== 'calculated' || batch.revision !== input.expectedRevision)
        fail('COST_REVISION', '正式批次不存在、已撤销或版本已变化');
      if (batch.module_id !== svc.moduleId) fail('COST_OWNER', '只能由原核算模块撤销正式批次');
      const latest = await db
        .selectFrom('inventory_costing_batch')
        .select('id')
        .where('status', '=', 'calculated')
        .orderBy('period', 'desc')
        .executeTakeFirst();
      if (latest?.id !== batch.id) fail('COST_LATER', '后续月份已有正式核算，只能从最后月份撤销');
      await svc.periods.assertOpen(batch.period, '取消成本核算');
      const docs = await db
        .selectFrom('inventory_document')
        .selectAll()
        .where('calculation_batch', '=', batch.id)
        .execute();
      const ids = docs.map((d) => d.id);
      const links = ids.length
        ? await db
            .selectFrom('inventory_voucher_source')
            .selectAll()
            .where('document_id', 'in', ids)
            .execute()
        : [];
      for (const id of new Set([
        ...links.map((s) => s.voucher_id),
        ...docs.flatMap((d) => (d.voucher_id == null ? [] : [d.voucher_id])),
      ])) {
        const v = await svc.vouchers.get(id);
        if (!v || v.status === 'audited' || v.status === 'posted')
          fail('COST_VOUCHER_LOCK', '关联凭证缺失、已审核或过账，不能取消成本核算');
      }
      const costLinks = links.filter((l) => l.purpose === 'cost');
      const deferredDeletion =
        costLinks.length && (await svc.voucherPolicy.get()).renumberAfterDelete
          ? new Set<number>()
          : undefined;
      if (
        deferredDeletion &&
        (!input.voucherDeletion?.confirmed ||
          JSON.stringify([...input.voucherDeletion.plan.ids].sort((a, b) => a - b)) !==
            JSON.stringify(costLinks.map((link) => link.voucher_id).sort((a, b) => a - b)))
      )
        fail(
          'VOUCHER_DELETE_CONFIRM',
          '取消成本核算将删除并重排关联凭证，请先预览全部成本凭证的编号影响并明确确认',
        );
      for (const link of costLinks) {
        const d = docs.find((d) => d.id === link.document_id)!;
        await self.releaseVoucherSource(
          {
            bookId: input.bookId,
            documentId: d.id,
            purpose: 'cost',
            expectedRevision: (
              await db
                .selectFrom('inventory_document')
                .select('revision')
                .where('id', '=', d.id)
                .executeTakeFirstOrThrow()
            ).revision,
            voucherId: link.voucher_id,
          },
          deferredDeletion,
        );
      }
      if (deferredDeletion) await svc.vouchers.deleteBatch(input.voucherDeletion!.plan, true);
      const before = JSON.parse(batch.before_json) as Before;
      for (const d of before.documents)
        await db
          .updateTable('inventory_document')
          .set({
            calculation_status: d.calculation_status,
            calculation_batch: d.calculation_batch,
            calculation_period: d.calculation_period,
            calculation_cutoff_date: d.calculation_cutoff_date,
            revision: sql`revision+1`,
          })
          .where('id', '=', d.id)
          .execute();
      for (const l of before.lines)
        await db
          .updateTable('inventory_line')
          .set({
            calculation_status: l.calculation_status,
            calculation_batch: l.calculation_batch,
            calculation_period: l.calculation_period,
            outbound_cost_cents: l.outbound_cost_cents,
            unit_cost: l.unit_cost,
          })
          .where('id', '=', l.id)
          .execute();
      for (const c of before.counts)
        await db
          .updateTable('inventory_count')
          .set({
            calculation_status: c.calculation_status,
            calculation_batch: c.calculation_batch,
            revision: sql`revision+1`,
          })
          .where('id', '=', c.id)
          .execute();
      for (const l of before.countLines)
        await db
          .updateTable('inventory_count_line')
          .set({ book_cents: l.book_cents })
          .where('id', '=', l.id)
          .execute();
      for (const o of before.opening)
        await db
          .updateTable('inventory_opening')
          .set({
            calculation_status: o.calculation_status,
            calculation_batch: o.calculation_batch,
            calculation_period: o.calculation_period,
          })
          .where('id', '=', o.id)
          .execute();
      await db
        .deleteFrom('inventory_costing_month_lock')
        .where('batch_id', '=', batch.id)
        .execute();
      await db
        .updateTable('inventory_costing_batch')
        .set({
          status: 'cancelled',
          revision: batch.revision + 1,
          cancelled_at: svc.ctx.now().toISOString(),
        })
        .where('id', '=', batch.id)
        .execute();
      await db
        .updateTable('inventory_control')
        .set({
          cost_period: before.control.cost_period,
          cost_cutoff_date: before.control.cost_cutoff_date,
          cost_batch: before.control.cost_batch,
          opening_locked: before.control.opening_locked,
        })
        .where('id', '=', 1)
        .execute();
      await bump();
      await svc.log.write({
        action: 'inventory.costing.cancel',
        summary: `取消成本核算 ${batch.period}`,
        targetId: batch.id,
      });
      return {
        batchId: batch.id,
        revision: batch.revision + 1,
        period: batch.period,
        status: 'cancelled' as const,
      };
    },
    async lockVoucherSource(raw: VoucherSourceInput) {
      permission('voucher');
      const input = VoucherSourceSchema.parse(raw);
      await checkBook(input.bookId);
      const d = await document(input.documentId, input.expectedRevision);
      await svc.periods.assertOpen(d.period, '关联来源凭证');
      if (
        (input.purpose === 'receipt' && d.kind !== 'receipt') ||
        (input.purpose === 'revenue' && (d.kind !== 'issue' || d.category !== '销售')) ||
        (input.purpose === 'cost' && d.kind !== 'issue')
      )
        fail('VOUCHER_PURPOSE', '来源单据类别不支持该凭证用途');
      if (d.voucher_id != null) fail('VOUCHER_LEGACY', '来源单据已有旧版单凭证关联，不能覆盖');
      const v = await svc.vouchers.get(input.voucherId);
      if (
        !v ||
        v.status !== 'pending' ||
        v.voided ||
        v.period !== d.period ||
        v.source?.module !== svc.moduleId ||
        v.source.type !== input.purpose ||
        v.source.id !== String(d.id)
      )
        fail('VOUCHER_SOURCE', '凭证必须为当前模块、当前单据和用途生成的未审核正式凭证');
      const lines = await db
        .selectFrom('inventory_line')
        .selectAll()
        .where('document_id', '=', d.id)
        .execute();
      if (
        input.purpose === 'cost' &&
        (d.calculation_status !== 'calculated' ||
          !d.calculation_batch ||
          d.calculation_period !== d.period ||
          !d.calculation_cutoff_date ||
          d.calculation_cutoff_date < d.date ||
          lines.some(
            (l) =>
              l.calculation_status !== 'calculated' ||
              l.calculation_batch !== d.calculation_batch ||
              l.calculation_period !== d.period ||
              l.outbound_cost_cents == null,
          ))
      )
        fail('VOUCHER_COST', '尚无完整正式成本，不能关联成本凭证');
      if (input.purpose === 'cost') {
        const batch = await db
          .selectFrom('inventory_costing_batch')
          .select('id')
          .where('id', '=', d.calculation_batch!)
          .where('status', '=', 'calculated')
          .where('period', '=', d.period)
          .executeTakeFirst();
        if (!batch) fail('VOUCHER_COST', '成本没有有效正式批次，不能关联成本凭证');
      }
      const expected =
        input.purpose === 'cost'
          ? sumCents(lines.map((l) => l.outbound_cost_cents))
          : sumCents(lines.map((l) => l.gross_cents));
      if (v.debitTotal !== expected || v.creditTotal !== expected)
        fail('VOUCHER_AMOUNT', '凭证金额与来源用途金额不一致');
      const old = await db
        .selectFrom('inventory_voucher_source')
        .selectAll()
        .where('document_id', '=', d.id)
        .where('purpose', '=', input.purpose)
        .executeTakeFirst();
      if (old) fail('VOUCHER_DUPLICATE', '该来源用途已有凭证，不能重复生成');
      await db
        .insertInto('inventory_voucher_source')
        .values({
          document_id: d.id,
          purpose: input.purpose,
          voucher_id: v.id,
          owner_module: svc.moduleId!,
          actor_id: svc.user.id,
        })
        .execute();
      await db
        .updateTable('inventory_document')
        .set({ revision: sql`revision+1` })
        .where('id', '=', d.id)
        .execute();
      await bump();
      await svc.log.write({
        action: 'inventory.voucher.lock',
        summary: `关联${input.purpose === 'receipt' ? '入库' : input.purpose === 'revenue' ? '收入' : '成本'}凭证 ${d.number}`,
        targetId: d.id,
      });
      return {
        documentId: d.id,
        revision: d.revision + 1,
        voucherId: v.id,
        purpose: input.purpose,
      };
    },
    async releaseVoucherSource(raw: VoucherSourceInput, deferredDeletion?: Set<number>) {
      permission('voucher');
      const input = VoucherSourceSchema.parse(raw);
      await checkBook(input.bookId);
      const d = await document(input.documentId, input.expectedRevision);
      await svc.periods.assertOpen(d.period, '删除来源凭证');
      const link = await db
        .selectFrom('inventory_voucher_source')
        .selectAll()
        .where('document_id', '=', d.id)
        .where('purpose', '=', input.purpose)
        .executeTakeFirst();
      if (!link || link.voucher_id !== input.voucherId || link.owner_module !== svc.moduleId)
        fail('VOUCHER_SOURCE', '来源用途关联不存在或属于其他模块');
      const v = await svc.vouchers.get(link.voucher_id);
      if (
        !v ||
        v.status !== 'pending' ||
        v.voided ||
        v.source?.module !== svc.moduleId ||
        v.source.type !== input.purpose ||
        v.source.id !== String(d.id)
      )
        fail('VOUCHER_LOCKED', '关联凭证已审核、过账、作废或来源不一致，不能释放');
      const renumber = (await svc.voucherPolicy.get()).renumberAfterDelete;
      if (
        !deferredDeletion &&
        renumber &&
        (!input.voucherDeletion?.confirmed ||
          input.voucherDeletion.plan.ids.length !== 1 ||
          input.voucherDeletion.plan.ids[0] !== v.id)
      )
        fail(
          'VOUCHER_DELETE_CONFIRM',
          '释放来源将删除并重排凭证，请先预览该凭证的编号影响并明确确认',
        );
      await db
        .deleteFrom('inventory_voucher_source')
        .where('document_id', '=', d.id)
        .where('purpose', '=', input.purpose)
        .execute();
      if (deferredDeletion) deferredDeletion.add(v.id);
      else if (renumber) await svc.vouchers.deleteBatch(input.voucherDeletion!.plan, true);
      else await svc.vouchers.delete(v.id, { expectedRevision: v.revision });
      await db
        .updateTable('inventory_document')
        .set({ revision: sql`revision+1` })
        .where('id', '=', d.id)
        .execute();
      await bump();
      await svc.log.write({
        action: 'inventory.voucher.release',
        summary: `删除来源凭证 ${d.number}`,
        targetId: d.id,
      });
      return { documentId: d.id, revision: d.revision + 1, purpose: input.purpose };
    },
  };
  return self;
}
