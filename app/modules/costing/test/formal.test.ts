import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from '@caiwu/db';
import { voucherInputFromSpec } from '@caiwu/testkit';
import type { CalculationResult } from '../shared';
import { costingService } from '../server/service';
import { readInventory } from '../server/inventory-read';
import type { CostingTables } from '../server/migrations';
import { caller, setup } from './fixtures';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => {
  await t.app.close();
});
const january = { period: 202601 };
const input = (r: CalculationResult, requestKey = randomUUID()) => ({
  period: r.period,
  adjustZeroQuantity: r.adjustZeroQuantity,
  fingerprint: r.fingerprint,
  requestKey,
  confirmed: true,
});
const snapshot = (period = 202601) => readInventory(t.app.svcFor('costing'), period);
async function seed() {
  await t.opening();
  const receipt = await t.document('receipt', '10', '3');
  const issue = await t.document('issue', '5', '10');
  return { receipt, issue };
}
async function publish(period = 202601) {
  return t.api.commit(input(await t.api.preview({ period })));
}
async function state() {
  return {
    inventory: await snapshot(),
    batches: await t.app.svc.db
      .withTables<CostingTables>()
      .selectFrom('costing_batch')
      .selectAll()
      .execute(),
    worksheets: await t.api.worksheets(),
    vouchers: await t.app.svc.vouchers.list(),
    logs: await t.app.svc.db.selectFrom('operation_log').selectAll().orderBy('id').execute(),
  };
}
async function count(actual: string) {
  const r = await t.inventory.generateCount({
    warehouseId: t.warehouseId,
    period: 202601,
    revision: 0,
    confirmed: false,
  });
  await t.inventory.saveCount({
    warehouseId: t.warehouseId,
    period: 202601,
    revision: r.revision,
    rows: [{ productCode: 'P1', actual }],
  });
}
async function link(documentId: number, purpose: 'cost' | 'revenue', revision?: number) {
  const svc = t.app.svcFor('costing');
  return svc.tx((tx) =>
    tx.inventory.with(async (inv) => {
      const source = (await inv.snapshot(202601)).documents.find((d) => d.id === documentId)!;
      const voucher = await tx.vouchers.create({
        ...(await voucherInputFromSpec(tx, {
          date: '2026-01-10',
          lines:
            purpose === 'cost'
              ? [
                  { account: '6401', debit: 1000 },
                  { account: '1405', credit: 1000, quantity: '-5' },
                ]
              : [
                  { account: '1001', debit: 5000 },
                  { account: '6001', credit: 5000 },
                ],
        })),
        source: { type: purpose, id: String(documentId) },
      });
      const locked = await inv.lockVoucherSource({
        bookId: t.app.book.id,
        documentId,
        purpose,
        expectedRevision: revision ?? source.revision,
        voucherId: voucher.id,
      });
      return { ...locked, voucherId: voucher.id };
    }),
  );
}

describe('w_cb_hz 正式发布：真实库存能力、成本批次和日志的同事务闭环', () => {
  it('w_cb_hz：无商品发布空月后才建商品并正式核算首购', async () => {
    const empty = await setup({ withProduct: false });
    const read = (period: number) => empty.app.svcFor('costing').inventory.snapshot(period);
    try {
      const januarySource = await read(202601);
      expect(januarySource.products).toEqual([]);
      expect(januarySource.opening).toEqual([]);
      expect(januarySource.documents).toEqual([]);
      expect(januarySource.counts).toEqual([]);
      const zero = await empty.api.preview({ period: 202601 });
      expect(zero.rows).toEqual([]);
      expect(zero.lines).toEqual([]);
      const januaryBatch = await empty.api.commit(input(zero));
      expect((await read(202601)).products).toEqual([]);
      const februaryOpening = await read(202602);
      expect(februaryOpening.periodOpeningReady).toBe(true);
      expect(februaryOpening.periodOpening).toEqual([]);
      await empty.inventory.saveProduct({
        code: 'P1',
        name: '空月后新增产品',
        inventoryAccountId: empty.ids.stock,
        salesAccountId: empty.ids.sales,
      });
      await empty.document('receipt', '10', '3', { date: '2026-02-10' });
      const februaryPreview = await empty.api.preview({ period: 202602 });
      expect(februaryPreview.rows).toHaveLength(1);
      expect(februaryPreview.rows[0]).toMatchObject({
        openingQuantity: '0',
        openingCents: 0,
        receivedQuantity: '10',
        receivedCents: 3000,
        closingQuantity: '10',
        closingCents: 3000,
      });
      const februaryBatch = await empty.api.commit(input(februaryPreview));
      const official = await read(202602);
      expect(official.products).toHaveLength(1);
      expect(official.control.costBatch).toBe(februaryBatch.inventoryBatchId);
      expect(official.batches).toEqual([
        expect.objectContaining({ id: januaryBatch.inventoryBatchId, period: 202601 }),
        expect.objectContaining({
          id: februaryBatch.inventoryBatchId,
          period: 202602,
          previous_batch_id: januaryBatch.inventoryBatchId,
        }),
      ]);
      const stock = await empty.inventory.stock({ warehouseId: empty.warehouseId });
      expect(stock[0]).toMatchObject({ balance: '10', balanceCents: 3000 });
    } finally {
      await empty.app.close();
    }
  });

  it('w_cb_hz：空启用月正式发布后承接首笔业务', async () => {
    // 没有任何期初、单据或盘点；档案存在不构成库存期初。
    const preview = await t.api.preview(january);
    expect(preview.rows).toEqual([]);
    expect(preview.lines).toEqual([]);
    const payload = input(preview);
    const before = await state();
    await expect(t.api.commit({ ...payload, confirmed: false })).rejects.toThrow(/明确确认/);
    expect(await state()).toEqual(before);
    const januaryBatch = await t.api.commit(payload);
    const committed = await state();
    expect(committed.batches).toHaveLength(1);
    expect(JSON.parse(committed.batches[0]!.commit_json)).toMatchObject({
      lines: [],
      balances: [],
      countAdjustments: [],
    });
    expect(committed.inventory.control).toMatchObject({
      costPeriod: 202601,
      costBatch: januaryBatch.inventoryBatchId,
      openingLocked: true,
    });
    expect(committed.inventory.opening).toEqual([]);
    const februaryOpening = await snapshot(202602);
    expect(februaryOpening.periodOpeningReady).toBe(true);
    expect(februaryOpening.periodOpening).toEqual([]);
    expect(await t.api.commit(payload)).toEqual(januaryBatch);
    expect(await state()).toEqual(committed);
    await expect(t.api.commit(input(await t.api.preview(january)))).rejects.toThrow(/逐月/);
    await t.document('receipt', '10', '3', { date: '2026-02-10' });
    const february = await publish(202602);
    expect((await t.api.batches())[0]!.result.rows[0]).toMatchObject({
      openingQuantity: '0',
      openingCents: 0,
      receivedQuantity: '10',
      receivedCents: 3000,
      closingQuantity: '10',
      closingCents: 3000,
    });
    const both = await state();
    await expect(
      t.api.cancelCalculation({
        id: januaryBatch.id,
        revision: januaryBatch.revision,
        confirmed: true,
      }),
    ).rejects.toThrow(/最后/);
    expect(await state()).toEqual(both);
    await t.api.cancelCalculation({
      id: february.id,
      revision: february.revision,
      confirmed: true,
    });
    await t.api.cancelCalculation({
      id: januaryBatch.id,
      revision: januaryBatch.revision,
      confirmed: true,
    });
    expect((await snapshot()).control.costBatch).toBeNull();
  });

  it('w_cb_fgz：空月确认、版本、权限、结账、幂等与回滚', async () => {
    const payload = input(await t.api.preview(january));
    const before = await state();
    await expect(
      t.app.svcFor('costing').tx(async (tx) => {
        await costingService(tx).commit(payload);
        throw new Error('空月发布后失败');
      }),
    ).rejects.toThrow('空月发布后失败');
    expect(await state()).toEqual(before);
    const batch = await t.api.commit(payload);
    const cancel = { id: batch.id, revision: batch.revision, confirmed: true };
    await expect(t.api.cancelCalculation({ ...cancel, confirmed: false })).rejects.toThrow(/确认/);
    await expect(t.api.cancelCalculation({ ...cancel, revision: 999 })).rejects.toThrow(/版本/);
    const viewer = caller(
      t.app,
      await t.app.addUser('empty-viewer', {
        permissions: ['costing.view'],
      }),
    );
    await expect(viewer.cancelCalculation(cancel)).rejects.toThrow(/权限/);
    await t.app.svc.periods.setStatus(202601, 'closed');
    const closed = await state();
    await expect(t.api.cancelCalculation(cancel)).rejects.toThrow(/已经结账/);
    expect(await state()).toEqual(closed);
    await t.app.svc.periods.setStatus(202601, 'open');
    const active = await state();
    await expect(
      t.app.svcFor('costing').tx(async (tx) => {
        await costingService(tx).cancelCalculation(cancel);
        throw new Error('空月撤销后失败');
      }),
    ).rejects.toThrow('空月撤销后失败');
    expect(await state()).toEqual(active);
    const cancelled = await t.api.cancelCalculation(cancel);
    expect(await t.api.cancelCalculation(cancel)).toEqual(cancelled);
    expect((await snapshot(202602)).periodOpeningReady).toBe(false);
    await expect(t.api.commit(payload)).rejects.toThrow(/请求号/);
    const republished = await publish();
    expect(republished.inventoryBatchId).not.toBe(batch.inventoryBatchId);
    expect((await t.api.batches()).filter((b) => b.status === 'calculated')).toHaveLength(1);
  });

  it('w_cb_hz：黄金成本1000分与结存3000分', async () => {
    const { issue } = await seed();
    const before = await snapshot();
    const preview = await t.api.preview(january);
    const submitted = input(preview);
    const r = await t.api.commit(submitted);
    expect(r).toMatchObject({ status: 'calculated', period: 202601, revision: 1 });
    const official = await snapshot();
    expect(official.control).toMatchObject({
      costPeriod: 202601,
      costBatch: r.inventoryBatchId,
      openingLocked: true,
    });
    expect(official.documents.find((d) => d.id === issue.id)).toMatchObject({
      calculationStatus: 'calculated',
      calculationBatch: r.inventoryBatchId,
    });
    expect(official.movements.find((l) => l.documentId === issue.id)).toMatchObject({
      outboundCostCents: 1000,
      unitCost: '2.000000000000',
    });
    expect(official.batches).toEqual([
      expect.objectContaining({ id: r.inventoryBatchId, actor_id: 1, module_id: 'costing' }),
    ]);
    expect((await t.inventory.stock({ warehouseId: t.warehouseId }))[0]).toMatchObject({
      balance: '15',
      issueCostCents: 1000,
      balanceCents: 3000,
    });
    const local = (await state()).batches[0]!;
    expect(JSON.parse(local.snapshot_json)).toEqual(before);
    expect(JSON.parse(local.commit_json)).toMatchObject({
      fingerprint: before.fingerprint,
      expectedStockRevision: before.stockRevision,
      expectedOpeningRevision: before.openingRevision,
      previousBatchId: before.previousBatchId,
    });
    expect((await snapshot(202602)).periodOpening).toEqual([
      expect.objectContaining({
        quantity: '15',
        amountCents: 3000,
        sourceBatchId: r.inventoryBatchId,
      }),
    ]);
    expect(await t.api.worksheets()).toEqual([]);
    expect((await t.app.svc.vouchers.list()).total).toBe(0);
    expect((await t.api.profit({ from: '2026-01-01', to: '2026-01-31' })).totals).toMatchObject({
      costCents: 1000,
      grossProfitCents: 4000,
    });
    await expect(t.document('receipt', '1', '1')).rejects.toThrow(/核算|锁定/);
    await expect(t.opening()).rejects.toThrow(/核算|期初/);
    await expect(count('14')).rejects.toThrow(/核算|锁定/);
  });

  it('w_cb_pdk：盘点14及撤销恢复金额', async () => {
    await seed();
    await count('14');
    const before = await snapshot();
    const preview = await t.api.preview(january);
    expect(preview.rows[0]).toMatchObject({
      issuedCents: 1000,
      countDifference: '-1',
      countCents: -200,
      closingQuantity: '14',
      closingCents: 2800,
    });
    const r = await t.api.commit(input(preview));
    expect((await t.inventory.stock({ warehouseId: t.warehouseId }))[0]).toMatchObject({
      balance: '14',
      balanceCents: 2800,
    });
    expect(
      (await t.inventory.count({ warehouseId: t.warehouseId, period: 202601 })).rows[0],
    ).toMatchObject({
      bookCents: 3000,
      actualCents: 2800,
      differenceCents: -200,
    });
    await t.api.cancelCalculation({ id: r.id, revision: r.revision, confirmed: true });
    expect((await snapshot()).counts[0]!.lines).toEqual(before.counts[0]!.lines);
    expect((await t.api.batches())[0]).toMatchObject({ status: 'cancelled', revision: 2 });
  });

  it('w_cb_pdk：半分尾差与零数量调整', async () => {
    await t.opening('1', '0.01');
    await t.document('receipt', '1', '0');
    await t.document('issue', '1', '10');
    await count('0');
    const before = await state();
    await expect(t.api.preview(january)).rejects.toThrow(/数量为零/);
    expect(await state()).toEqual(before);
    const preview = await t.api.preview({ ...january, adjustZeroQuantity: true });
    expect(preview.rows[0]).toMatchObject({
      issuedCents: 1,
      countCents: -1,
      zeroQuantityAdjustmentCents: 1,
      closingQuantity: '0',
      closingCents: 0,
    });
    await t.api.commit(input(preview));
    expect((await t.inventory.stock({ warehouseId: t.warehouseId }))[0]).toMatchObject({
      balance: '0',
      balanceCents: 0,
    });
  });

  it('w_cb_hz：发布后异常全部回滚', async () => {
    await seed();
    const payload = input(await t.api.preview(january));
    const before = await state();
    await expect(
      t.app.svcFor('costing').tx(async (tx) => {
        await costingService(tx).commit(payload);
        throw new Error('调用方后续失败');
      }),
    ).rejects.toThrow('调用方后续失败');
    expect(await state()).toEqual(before);
    expect((await t.inventory.stock({ warehouseId: t.warehouseId }))[0]!.issueCostCents).toBeNull();
    await t.api.commit(payload);
    expect(await t.api.batches()).toHaveLength(1);
  });

  it('w_cb_hz：旧指纹、操作员、权限、确认与结账保护', async () => {
    await seed();
    const old = input(await t.api.preview(january));
    await t.document('receipt', '1', '2');
    const before = await state();
    await expect(t.api.commit(old)).rejects.toThrow(/旧试算/);
    expect(await state()).toEqual(before);
    const payload = input(await t.api.preview(january));
    await expect(t.api.commit({ ...payload, confirmed: false })).rejects.toThrow(/明确确认/);
    const viewer = caller(t.app, await t.app.addUser('viewer', { permissions: ['costing.view'] }));
    await expect(viewer.commit(payload)).rejects.toThrow(/权限/);
    await expect(viewer.cancelCalculation({ id: 1, revision: 1, confirmed: true })).rejects.toThrow(
      /权限/,
    );
    const operator = caller(
      t.app,
      await t.app.addUser('operator', { permissions: ['costing.view', 'costing.calculate'] }),
    );
    await expect(operator.commit(payload)).rejects.toThrow(/旧试算/);
    await t.app.svc.periods.setStatus(202601, 'closed');
    const closed = await state();
    await expect(t.api.commit(payload)).rejects.toThrow(/已经结账/);
    expect(await state()).toEqual(closed);
  });

  it('w_cb_hz：相同请求幂等与重放保护', async () => {
    await seed();
    const payload = input(await t.api.preview(january));
    const [a, b] = await Promise.all([t.api.commit(payload), t.api.commit(payload)]);
    expect(a).toEqual(b);
    const before = await state();
    expect(await t.api.commit(payload)).toEqual(a);
    expect(await state()).toEqual(before);
    await expect(t.api.commit({ ...payload, adjustZeroQuantity: true })).rejects.toThrow(/请求号/);
    await t.api.cancelCalculation({ id: a.id, revision: a.revision, confirmed: true });
    await expect(t.api.commit(payload)).rejects.toThrow(/请求号/);
    expect(await t.api.batches()).toHaveLength(1);
  });

  it('w_cb_hz：不同请求并发同月仅发布一次', async () => {
    await seed();
    const preview = await t.api.preview(january);
    const results = await Promise.allSettled([
      t.api.commit(input(preview)),
      t.api.commit(input(preview)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await t.api.batches()).toHaveLength(1);
    expect((await snapshot()).batches).toHaveLength(1);
  });
});

describe('w_cb_fgz 正式撤销和历史成本链', () => {
  it('w_cb_fgz：连续月份及末月逆序撤销', async () => {
    await seed();
    const future = await snapshot(202602);
    expect(future.periodOpeningReady).toBe(false);
    await expect(t.api.preview({ period: 202602 })).rejects.toThrow(/期初尚未就绪/);
    await expect(
      t.api.commit({
        period: 202602,
        fingerprint: future.fingerprint,
        requestKey: randomUUID(),
        confirmed: true,
      }),
    ).rejects.toThrow(/逐月/);
    const januaryBatch = await publish();
    await t.document('issue', '2', '20', { date: '2026-02-10' });
    const februaryPreview = await t.api.preview({ period: 202602 });
    expect(februaryPreview.rows[0]).toMatchObject({
      openingQuantity: '15',
      openingCents: 3000,
      issuedCents: 400,
      closingCents: 2600,
    });
    const february = await t.api.commit(input(februaryPreview));
    // 即使最新锚点已在2月，1月仍由完整previous_batch_id链证明。
    expect((await t.api.profit({ from: '2026-01-01', to: '2026-02-28' })).totals).toMatchObject({
      costCents: 1400,
      unknownHistoryLines: 0,
    });
    await expect(
      t.api.cancelCalculation({ id: januaryBatch.id, revision: 1, confirmed: true }),
    ).rejects.toThrow(/最后/);
    await expect(
      t.api.cancelCalculation({ id: february.id, revision: 999, confirmed: true }),
    ).rejects.toThrow(/版本/);
    await expect(
      t.api.cancelCalculation({ id: february.id, revision: 1, confirmed: false }),
    ).rejects.toThrow(/确认/);
    const cancelled = await t.api.cancelCalculation({
      id: february.id,
      revision: 1,
      confirmed: true,
    });
    expect(
      await t.api.cancelCalculation({ id: february.id, revision: 1, confirmed: true }),
    ).toEqual(cancelled);
    await t.api.cancelCalculation({ id: januaryBatch.id, revision: 1, confirmed: true });
    expect((await t.api.context()).latestBatchId).toBeNull();
    const republished = await publish();
    expect(republished.inventoryBatchId).not.toBe(januaryBatch.inventoryBatchId);
    expect((await t.api.batches()).filter((b) => b.status === 'calculated')).toHaveLength(1);
  });

  it('w_cb_hz/w_cb_fgz：末两期承接正常仍核对三个月全链，重复发布也不能绕过断链', async () => {
    await seed();
    const januaryInput = input(await t.api.preview(january));
    const januaryBatch = await t.api.commit(januaryInput);
    await t.document('issue', '2', '20', { date: '2026-02-10' });
    const february = await publish(202602);
    const marchIssue = await t.document('issue', '1', '20', { date: '2026-03-10' });
    const march = await publish(202603);
    const ready = await snapshot(202604);
    expect(ready.periodOpeningReady).toBe(true);
    expect(ready.periodOpening).toEqual([
      expect.objectContaining({
        quantity: '12',
        amountCents: 2400,
        sourceBatchId: march.inventoryBatchId,
      }),
    ]);
    expect(ready.batches).toEqual([
      expect.objectContaining({
        id: januaryBatch.inventoryBatchId,
        period: 202601,
        previous_batch_id: null,
      }),
      expect.objectContaining({
        id: february.inventoryBatchId,
        period: 202602,
        previous_batch_id: januaryBatch.inventoryBatchId,
      }),
      expect.objectContaining({
        id: march.inventoryBatchId,
        period: 202603,
        previous_batch_id: february.inventoryBatchId,
      }),
    ]);
    expect((await t.api.profit({ from: '2026-01-01', to: '2026-03-31' })).totals).toMatchObject({
      costCents: 1600,
      unknownHistoryLines: 0,
    });
    const active = await state();
    expect(await t.api.commit(januaryInput)).toEqual(januaryBatch);
    expect(await state()).toEqual(active);
    // 仅破坏合成测试的更早历史；3月→2月仍正确，不能只验证最近的相邻期。
    await sql`UPDATE inventory_costing_batch SET previous_batch_id=NULL WHERE id=${february.inventoryBatchId}`.execute(
      t.app.svc.db,
    );
    const broken = await snapshot(202604);
    expect(broken.control).toEqual(ready.control);
    expect(broken.periodOpeningReady).toBe(true);
    expect(broken.previousBatchId).toBe(march.inventoryBatchId);
    expect(broken.batches.find((b) => b.id === march.inventoryBatchId)).toMatchObject({
      period: 202603,
      previous_batch_id: february.inventoryBatchId,
    });
    const before = await state();
    await expect(t.api.commit(januaryInput)).rejects.toThrow(/批次链/);
    await expect(t.api.preview({ period: 202604 })).rejects.toThrow(/批次链/);
    await expect(
      t.api.commit({
        period: 202604,
        fingerprint: broken.fingerprint,
        requestKey: randomUUID(),
        confirmed: true,
      }),
    ).rejects.toThrow(/批次链/);
    await expect(
      t.api.cancelCalculation({ id: march.id, revision: march.revision, confirmed: true }),
    ).rejects.toThrow(/批次链/);
    await expect(
      t.api.previewVoucher({ documentId: marchIssue.id, purpose: 'cost' }),
    ).rejects.toThrow(/历史成本未知/);
    expect((await t.api.profit({ from: '2026-01-01', to: '2026-03-31' })).totals).toMatchObject({
      costCents: null,
      grossProfitCents: null,
      unknownHistoryLines: 3,
    });
    expect(await state()).toEqual(before);
    // 恢复合成前置后仍须从3月、2月、1月依次撤销，原业务单据保留。
    await sql`UPDATE inventory_costing_batch SET previous_batch_id=${januaryBatch.inventoryBatchId} WHERE id=${february.inventoryBatchId}`.execute(
      t.app.svc.db,
    );
    expect((await t.api.preview({ period: 202604 })).rows[0]).toMatchObject({
      openingQuantity: '12',
      openingCents: 2400,
      closingCents: 2400,
    });
    for (const batch of [march, february, januaryBatch]) {
      await t.api.cancelCalculation({ id: batch.id, revision: batch.revision, confirmed: true });
    }
    expect((await snapshot()).control).toMatchObject({
      costBatch: null,
      costPeriod: null,
      openingLocked: false,
    });
    expect((await snapshot(202604)).periodOpeningReady).toBe(false);
    expect((await t.api.batches()).map((b) => b.status)).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
    ]);
    expect((await t.app.svc.vouchers.list()).total).toBe(0);
  });

  it('w_cb_hz：相邻月存在但正式链断裂时拒绝', async () => {
    const { issue } = await seed();
    await publish();
    const february = await publish(202602);
    // 仅测试前置破坏库存链；生产代码从不读取或修改库存私有表。
    await sql`UPDATE inventory_costing_batch SET previous_batch_id=NULL WHERE id=${february.inventoryBatchId}`.execute(
      t.app.svc.db,
    );
    const future = await snapshot(202603);
    expect(future.periodOpeningReady).toBe(true);
    const before = await state();
    await expect(t.api.preview({ period: 202603 })).rejects.toThrow(/批次链/);
    await expect(
      t.api.commit({
        period: 202603,
        fingerprint: future.fingerprint,
        requestKey: randomUUID(),
        confirmed: true,
      }),
    ).rejects.toThrow(/批次链/);
    const report = await t.api.profit({ from: '2026-01-01', to: '2026-01-31' });
    expect(report.totals).toMatchObject({
      costCents: null,
      grossProfitCents: null,
      unknownHistoryLines: 1,
    });
    await expect(t.api.previewVoucher({ documentId: issue.id, purpose: 'cost' })).rejects.toThrow(
      /历史成本未知/,
    );
    await expect(
      t.api.cancelCalculation({ id: february.id, revision: 1, confirmed: true }),
    ).rejects.toThrow(/批次链/);
    expect(await state()).toEqual(before);
  });

  it('w_cb_hz：正式期初缺项拒绝补零', async () => {
    await seed();
    const januaryBatch = await publish();
    await t.document('receipt', '10', '5', { date: '2026-02-10' });
    await sql`DELETE FROM inventory_costing_balance WHERE batch_id=${januaryBatch.inventoryBatchId}`.execute(
      t.app.svc.db,
    );
    const missing = await snapshot(202602);
    expect(missing.periodOpeningReady).toBe(true);
    expect(missing.periodOpening).toEqual([]);
    const before = await state();
    await expect(t.api.preview({ period: 202602 })).rejects.toThrow(/正式期初缺少/);
    await expect(
      t.api.commit({
        period: 202602,
        fingerprint: missing.fingerprint,
        requestKey: randomUUID(),
        confirmed: true,
      }),
    ).rejects.toThrow(/正式期初缺少/);
    expect(await state()).toEqual(before);
  });

  it.each(['audited', 'posted'] as const)('w_cb_fgz：已%s来源拒绝撤销', async (status) => {
    const { issue } = await seed();
    const batch = await publish();
    const revenue = await link(issue.id, 'revenue');
    const cost = await link(issue.id, 'cost', revenue.revision);
    expect(cost.revision).toBe(revenue.revision + 1);
    await t.app.svc.vouchers.changeStatus({ ids: [revenue.voucherId], to: 'audited' });
    if (status === 'posted')
      await t.app.svc.vouchers.changeStatus({ ids: [revenue.voucherId], to: 'posted' });
    const before = await state();
    await expect(
      t.api.cancelCalculation({ id: batch.id, revision: 1, confirmed: true }),
    ).rejects.toThrow(/审核|过账/);
    expect(await state()).toEqual(before);
    expect((await t.app.svc.vouchers.get(cost.voucherId))!.status).toBe('pending');
  });

  it('w_cb_fgz：撤销成本凭证仅删除一次且保持原子', async () => {
    const { issue } = await seed();
    const batch = await publish();
    const revenue = await link(issue.id, 'revenue');
    const cost = await link(issue.id, 'cost', revenue.revision);
    const before = await state();
    await expect(
      t.app.svcFor('costing').tx(async (tx) => {
        await costingService(tx).cancelCalculation({ id: batch.id, revision: 1, confirmed: true });
        throw new Error('撤销后续失败');
      }),
    ).rejects.toThrow('撤销后续失败');
    expect(await state()).toEqual(before);
    await t.api.cancelCalculation({ id: batch.id, revision: 1, confirmed: true });
    expect(await t.app.svc.vouchers.get(cost.voucherId)).toBeNull();
    expect(await t.app.svc.vouchers.get(revenue.voucherId)).toMatchObject({ status: 'pending' });
    expect((await snapshot()).voucherSources.map((v) => v.purpose)).toEqual(['revenue']);
    expect((await snapshot()).control.costBatch).toBeNull();
    await t.document('receipt', '1', '1');
  });

  it('w_cb_fgz：结账、账套隔离及模块身份保护', async () => {
    await seed();
    const batch = await publish();
    await t.app.svc.periods.setStatus(202601, 'closed');
    const before = await state();
    await expect(
      t.api.cancelCalculation({ id: batch.id, revision: 1, confirmed: true }),
    ).rejects.toThrow(/已经结账/);
    await expect(
      t.api.cancelCalculation({ id: 999, revision: 1, confirmed: true }),
    ).rejects.toThrow(/不存在/);
    expect(await state()).toEqual(before);
    const other = await setup();
    try {
      await expect(
        other.api.cancelCalculation({ id: batch.id, revision: 1, confirmed: true }),
      ).rejects.toThrow(/不存在/);
      expect(await other.api.batches()).toEqual([]);
      await expect(
        costingService(other.app.svcFor('inventory')).commit({
          period: 202601,
          fingerprint: (await other.api.preview(january)).fingerprint,
          requestKey: randomUUID(),
          confirmed: true,
        }),
      ).rejects.toThrow(/成本核算模块/);
    } finally {
      await other.app.close();
    }
  });
});
