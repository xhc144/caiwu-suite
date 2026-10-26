import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, voucherInputFromSpec, type TestApp } from '@caiwu/testkit';
import type { CoreServices } from '@caiwu/core/server';
import server from '../server';
import { inventoryCosting, withInventoryCosting } from '../server/costing';
import type { CostingCommitInput } from '../costing-contract';
import type { InventoryTables } from '../server/migrations';
let app: TestApp;
let warehouseId: number, productId: number, receiptId: number, issueId: number;
const api = () => app.call(server);
const svc = () => app.svcFor('inventory');
const transaction = <T>(run: (t: CoreServices) => Promise<T>) =>
  svc().tx((t) => withInventoryCosting(t, () => run(t)));
async function input(period = 202601): Promise<CostingCommitInput> {
  const s = await inventoryCosting(svc()).snapshot(period);
  return {
    bookId: app.book.id,
    period,
    requestKey: randomUUID(),
    expectedStockRevision: s.stockRevision,
    expectedOpeningRevision: s.openingRevision,
    previousBatchId: s.previousBatchId,
    fingerprint: s.fingerprint,
    lines:
      period === 202601
        ? [
            {
              lineId: s.movements.find((l) => l.documentId === issueId)!.id,
              documentId: issueId,
              costCents: 1000,
              unitCost: '2',
            },
          ]
        : [],
    balances: [{ warehouseId, productId, quantity: '15', amountCents: 3000 }],
    countAdjustments: [],
  };
}
const commit = (v: CostingCommitInput) => transaction((t) => inventoryCosting(t).commitCosting(v));
const cancel = (batchId: string, expectedRevision = 1) =>
  transaction((t) =>
    inventoryCosting(t).cancelCosting({ bookId: app.book.id, batchId, expectedRevision }),
  );
async function voucher(
  t: CoreServices,
  documentId: number,
  purpose: 'receipt' | 'revenue' | 'cost',
  amount: number,
) {
  const debit = purpose === 'cost' ? '6401' : purpose === 'receipt' ? '1405' : '1001';
  const credit = purpose === 'cost' ? '1405' : purpose === 'receipt' ? '1001' : '6001';
  return t.vouchers.create({
    ...(await voucherInputFromSpec(t, {
      date: '2026-01-10',
      lines: [
        { account: debit, debit: amount, ...(purpose === 'receipt' ? { quantity: '10' } : {}) },
        { account: credit, credit: amount, ...(purpose === 'cost' ? { quantity: '-5' } : {}) },
      ],
    })),
    source: { type: purpose, id: String(documentId) },
  });
}

async function link(documentId: number, purpose: 'receipt' | 'revenue' | 'cost', amount: number) {
  const d = await api().document({ id: documentId });
  return transaction(async (t) => {
    const v = await voucher(t, documentId, purpose, amount);
    return inventoryCosting(t).lockVoucherSource({
      bookId: app.book.id,
      documentId,
      purpose,
      expectedRevision: d.revision,
      voucherId: v.id,
    });
  });
}
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
  warehouseId = await api().saveWarehouse({ code: '01', name: '正式核算仓' });
  productId = (await api().saveProduct({ code: 'P1', name: '产品' })).id;
  await api().saveOpening({
    warehouseId,
    revision: 0,
    rows: [{ productCode: 'P1', quantity: '10', unitPrice: '1' }],
  });
  const cash = (await app.svc.accounts.require('1001')).id,
    cost = (await app.svc.accounts.require('6401')).id;
  receiptId = (
    await api().saveDocument({
      requestKey: randomUUID(),
      kind: 'receipt',
      warehouseId,
      number: 'R1',
      date: '2026-01-10',
      category: '采购',
      accountId: cash,
      lines: [{ productCode: 'P1', quantity: '10', unitPrice: '3' }],
    })
  ).id;
  issueId = (
    await api().saveDocument({
      requestKey: randomUUID(),
      kind: 'issue',
      warehouseId,
      number: 'S1',
      date: '2026-01-10',
      category: '销售',
      accountId: cash,
      costAccountId: cost,
      lines: [{ productCode: 'P1', quantity: '5', unitPrice: '10' }],
    })
  ).id;
});
afterEach(async () => app.close());

it('w_cb_hz：真实原子发布、完整成本/期初/盘点元数据、正式结存和整月新增修改撤审锁', async () => {
  const v = await input();
  const batch = await commit(v);
  expect(await commit(v)).toEqual(batch);
  expect((await api().stock({ warehouseId }))[0]).toMatchObject({
    balance: '15',
    issueCostCents: 1000,
    balanceCents: 3000,
  });
  expect(await api().document({ id: issueId })).toMatchObject({
    calculation_status: 'calculated',
    calculation_batch: batch.batchId,
    calculation_period: 202601,
    calculation_cutoff_date: '2026-01-31',
    revision: 2,
  });
  const s = await inventoryCosting(svc()).snapshot(202602);
  expect(s.previousBatchId).toBe(batch.batchId);
  expect(s.periodOpening).toEqual([
    { warehouseId, productId, quantity: '15', amountCents: 3000, sourceBatchId: batch.batchId },
  ]);
  const doc = await api().copyDocument({ id: receiptId });
  await expect(api().saveDocument({ ...doc, number: 'BLOCKED' })).rejects.toThrow(/锁定|截止|核算/);
  await expect(
    api().saveDocument({ ...doc, id: receiptId, revision: 2, number: 'R1', date: '2026-02-01' }),
  ).rejects.toThrow(/锁定|截止|核算/);
  await expect(api().removeDocument({ id: issueId, revision: 2, confirmed: true })).rejects.toThrow(
    /锁定|截止|核算/,
  );
  await expect(api().audit({ id: issueId, revision: 2, to: false })).rejects.toThrow(
    /锁定|截止|核算/,
  );
  await expect(
    api().saveOpening({ warehouseId, revision: 1, confirmReplace: true, rows: [] }),
  ).rejects.toThrow(/锁定/);
  await expect(
    api().generateCount({ warehouseId, period: 202601, revision: 0, confirmed: false }),
  ).rejects.toThrow(/锁定|截止|核算/);
  await expect(commit({ ...v, requestKey: randomUUID() })).rejects.toThrow(/变化|连续|重复/);
});

it('w_cb_hz：事务外、跨账套、actor/module指纹和读取后版本变化全部拒绝', async () => {
  const v = await input();
  await expect(inventoryCosting(svc()).commitCosting(v)).rejects.toThrow(/svc.tx/);
  await expect(commit({ ...v, bookId: randomUUID() })).rejects.toThrow(/账套/);
  await expect(
    app
      .svcFor('costing')
      .tx((t) => withInventoryCosting(t, (inventory) => inventory.commitCosting(v))),
  ).rejects.toThrow(/变化/);
  await api().saveWarehouse({ id: warehouseId, revision: 1, code: '01', name: '改名' });
  await expect(commit(v)).rejects.toThrow(/变化/);
  expect((await api().document({ id: issueId })).calculation_status).toBe('uncalculated');
});

it('w_cb_hz：来源用途锁或盘点改动使旧快照指纹失效，重新快照可提交', async () => {
  const stale = await input();
  await link(issueId, 'revenue', 5000);
  await expect(commit(stale)).rejects.toThrow(/变化/);
  expect((await commit(await input())).status).toBe('calculated');
});

it.each([
  'missing',
  'wrong-document',
  'wrong-cost',
  'wrong-unit',
  'wrong-balance',
  'duplicate-balance',
] as const)('w_cb_hz：%s错误方案没有半写入', async (kind) => {
  const v = await input();
  if (kind === 'missing') v.lines = [];
  if (kind === 'wrong-document') v.lines[0]!.documentId = receiptId;
  if (kind === 'wrong-cost') v.lines[0]!.costCents = 999;
  if (kind === 'wrong-unit') v.lines[0]!.unitCost = '1.99';
  if (kind === 'wrong-balance') v.balances[0]!.amountCents = 2999;
  if (kind === 'duplicate-balance') v.balances.push(v.balances[0]!);
  await expect(commit(v)).rejects.toThrow();
  expect((await inventoryCosting(svc()).snapshot(202601)).batches).toEqual([]);
  expect((await api().document({ id: issueId })).calculation_status).toBe('uncalculated');
});

it('w_cb_hz/w_cb_pdk_1：正式盘亏写调整移动，下一期取正式结存，撤销恢复快照金额与库存', async () => {
  const key = { warehouseId, period: 202601 };
  const count = await api().generateCount({ ...key, revision: 0, confirmed: false });
  await api().saveCount({
    ...key,
    revision: count.revision,
    rows: [{ productCode: 'P1', actual: '14' }],
  });
  const v = await input();
  v.balances[0] = { warehouseId, productId, quantity: '14', amountCents: 2800 };
  v.countAdjustments = [
    {
      warehouseId,
      productId,
      countId: count.id,
      quantity: '-1',
      amountCents: -200,
      zeroQuantityAdjustmentCents: 0,
    },
  ];
  const batch = await commit(v);
  expect((await api().stock({ warehouseId }))[0]).toMatchObject({
    balance: '14',
    balanceCents: 2800,
    adjustmentQuantity: '-1',
    adjustmentCents: -200,
  });
  expect((await api().ledger({ warehouseId, productCode: 'P1' })).at(-1)).toMatchObject({
    kind: 'adjustment',
    balance: '14',
    balanceCents: 2800,
    amountCents: -200,
  });
  expect((await api().count(key)).rows[0]).toMatchObject({
    book: '15',
    actual: '14',
    bookCents: 3000,
    actualCents: 2800,
    differenceCents: -200,
  });
  expect((await inventoryCosting(svc()).snapshot(202602)).periodOpening[0]).toMatchObject({
    quantity: '14',
    amountCents: 2800,
  });
  await cancel(batch.batchId);
  expect((await api().stock({ warehouseId }))[0]).toMatchObject({
    balance: '15',
    balanceCents: null,
    adjustmentQuantity: '0',
  });
  expect((await api().count(key)).rows[0]).toMatchObject({ bookCents: null, actual: '14' });
  const history = (await inventoryCosting(svc()).snapshot(202601)).batches;
  expect(history[0]).toMatchObject({ status: 'cancelled', revision: 2 });
});

it('w_cb_hz：盘点漏项/旧账面与负库存禁止正式发布', async () => {
  const c = await api().generateCount({
    warehouseId,
    period: 202601,
    revision: 0,
    confirmed: false,
  });
  await api().saveCount({
    warehouseId,
    period: 202601,
    revision: c.revision,
    rows: [{ productCode: 'P1', actual: '14' }],
  });
  const v = await input();
  v.balances[0] = { warehouseId, productId, quantity: '14', amountCents: 2800 };
  await expect(commit(v)).rejects.toThrow(/调整漏项/);
  v.countAdjustments = [
    {
      warehouseId,
      productId,
      countId: c.id,
      quantity: '-1',
      amountCents: -200,
      zeroQuantityAdjustmentCents: 0,
    },
  ];
  await app.svc.db
    .withTables<InventoryTables>()
    .updateTable('inventory_count_line')
    .set({ book_e6: 14_000_000 })
    .where('count_id', '=', c.id!)
    .execute();
  const fresh = await input();
  fresh.balances = v.balances;
  fresh.countAdjustments = v.countAdjustments;
  await expect(commit(fresh)).rejects.toThrow(/盘点账面/);
});

it('w_cb_fgz：仅末正式批次可撤销，跨月结存有正式出处，撤销版本不可倒退', async () => {
  const january = await commit(await input());
  const feb = await input(202602);
  feb.balances = [{ warehouseId, productId, quantity: '15', amountCents: 3000 }];
  const february = await commit(feb);
  await expect(cancel(january.batchId)).rejects.toThrow(/后续月份/);
  await cancel(february.batchId);
  const rev = (await api().document({ id: issueId })).revision;
  await cancel(january.batchId);
  expect((await api().document({ id: issueId })).revision).toBeGreaterThan(rev);
  await expect(cancel(january.batchId)).rejects.toThrow(/撤销|版本/);
  const s = await inventoryCosting(svc()).snapshot(202601);
  expect(s.control).toMatchObject({ costPeriod: null, costBatch: null, openingLocked: false });
});

it('w_cb_hz/w_cb_fgz：调用方后续失败使核算、结存、月锁、日志和本模块批次标志全部回滚', async () => {
  const v = await input();
  await expect(
    transaction(async (t) => {
      await inventoryCosting(t).commitCosting(v);
      await t.settings.set('atomic-costing', 'created');
      throw new Error('后续批次保存失败');
    }),
  ).rejects.toThrow(/后续/);
  expect((await inventoryCosting(svc()).snapshot(202601)).batches).toEqual([]);
  expect(await svc().settings.get('atomic-costing', null)).toBeNull();
  const b = await commit(v);
  await expect(
    transaction(async (t) => {
      await inventoryCosting(t).cancelCosting({
        bookId: app.book.id,
        batchId: b.batchId,
        expectedRevision: 1,
      });
      throw new Error('撤销后失败');
    }),
  ).rejects.toThrow(/撤销后/);
  expect((await api().document({ id: issueId })).calculation_status).toBe('calculated');
  expect((await inventoryCosting(svc()).snapshot(202601)).batches[0]!.status).toBe('calculated');
});

it('w_ck_ck1/w_cb_pz：同单收入/成本双凭证唯一，锁住所有编辑撤审，审核后不能释放或撤销', async () => {
  const revenue = await link(issueId, 'revenue', 5000);
  const batch = await commit(await input());
  const cost = await link(issueId, 'cost', 1000);
  const d = await api().document({ id: issueId });
  expect(d.voucherSources.map((s) => s.purpose).sort()).toEqual(['cost', 'revenue']);
  await expect(
    api().saveDocument({
      ...(await api().copyDocument({ id: issueId })),
      id: issueId,
      revision: d.revision,
      number: 'S1',
    }),
  ).rejects.toThrow(/锁定|核算|凭证/);
  await expect(api().audit({ id: issueId, revision: d.revision, to: false })).rejects.toThrow(
    /锁定|核算|凭证/,
  );
  const before = (await app.svc.vouchers.list({})).total;
  await expect(link(issueId, 'cost', 1000)).rejects.toThrow(/已有凭证/);
  expect((await app.svc.vouchers.list({})).total).toBe(before);
  await app.svc.vouchers.changeStatus({ ids: [cost.voucherId], to: 'audited' });
  await expect(
    transaction((t) =>
      inventoryCosting(t).releaseVoucherSource({
        bookId: app.book.id,
        documentId: issueId,
        purpose: 'cost',
        expectedRevision: d.revision,
        voucherId: cost.voucherId,
      }),
    ),
  ).rejects.toThrow(/审核|过账/);
  await expect(cancel(batch.batchId)).rejects.toThrow(/审核|过账/);
  await app.svc.vouchers.changeStatus({ ids: [cost.voucherId], to: 'pending' });
  await cancel(batch.batchId);
  await expect(app.svc.vouchers.get(cost.voucherId)).resolves.toBeNull();
  const remaining = await api().document({ id: issueId });
  expect(remaining.voucherSources.map((s) => s.purpose)).toEqual(['revenue']);
  await expect(
    api().audit({ id: issueId, revision: remaining.revision, to: true }),
  ).rejects.toThrow(/凭证/);
  await transaction((t) =>
    inventoryCosting(t).releaseVoucherSource({
      bookId: app.book.id,
      documentId: issueId,
      purpose: 'revenue',
      expectedRevision: remaining.revision,
      voucherId: revenue.voucherId,
    }),
  );
  expect((await api().document({ id: issueId })).voucherSources).toEqual([]);
});

it('w_ck_ck1/w_cb_pz：用途、金额、账套、来源错误不能关联；关联失败回滚core刚创建凭证', async () => {
  await expect(link(receiptId, 'revenue', 3000)).rejects.toThrow(/类别/);
  await expect(link(issueId, 'cost', 1000)).rejects.toThrow(/正式成本/);
  await expect(link(issueId, 'revenue', 4999)).rejects.toThrow(/金额/);
  expect((await app.svc.vouchers.list({})).total).toBe(0);
  const linked = await link(receiptId, 'receipt', 3000);
  const d = await api().document({ id: receiptId });
  await expect(
    api().removeDocument({ id: receiptId, revision: d.revision, confirmed: true }),
  ).rejects.toThrow(/来源凭证/);
  await expect(
    transaction((t) =>
      inventoryCosting(t).releaseVoucherSource({
        bookId: randomUUID(),
        documentId: receiptId,
        purpose: 'receipt',
        expectedRevision: d.revision,
        voucherId: linked.voucherId,
      }),
    ),
  ).rejects.toThrow(/账套/);
  await expect(
    transaction(async (t) => {
      await inventoryCosting(t).releaseVoucherSource({
        bookId: app.book.id,
        documentId: receiptId,
        purpose: 'receipt',
        expectedRevision: d.revision,
        voucherId: linked.voucherId,
      });
      throw new Error('删除后失败');
    }),
  ).rejects.toThrow(/删除后/);
  expect((await api().document({ id: receiptId })).voucherSources).toHaveLength(1);
  expect(await app.svc.vouchers.get(linked.voucherId)).not.toBeNull();
});

it('w_cb_hz/w_cb_fgz：核算权限独立于库存编辑和查看权限', async () => {
  const viewer = app.call(
    server,
    await app.addUser('view', { permissions: ['inventory.view', 'inventory.edit'] }),
  );
  const v = await input();
  await expect(viewer.commitCosting(v)).rejects.toThrow(/权限/);
  const batch = await commit(v);
  await expect(
    viewer.cancelCosting({ bookId: app.book.id, batchId: batch.batchId, expectedRevision: 1 }),
  ).rejects.toThrow(/权限/);
});

it('共享契约：退出事务/作用域后的能力不可复用，另一事务中也不能借用旧能力', async () => {
  const v = await input();
  let escaped: ReturnType<typeof inventoryCosting> | undefined;
  await svc().tx((t) =>
    withInventoryCosting(t, async (inventory) => {
      escaped = inventory;
    }),
  );
  await expect(escaped!.commitCosting(v)).rejects.toThrow(/作用域|svc.tx/);
  await transaction(async () => {
    await expect(escaped!.commitCosting(v)).rejects.toThrow(/作用域|svc.tx/);
  });
  expect((await inventoryCosting(svc()).snapshot(202601)).batches).toEqual([]);
});

it('共享契约：保留costing模块/actor身份，同一事务保存调用方批次与正式库存批次', async () => {
  const costSvc = app.svcFor('costing');
  const snapshot = await inventoryCosting(costSvc).snapshot(202601);
  const v = { ...(await input()), fingerprint: snapshot.fingerprint };
  const batch = await costSvc.tx((t) =>
    withInventoryCosting(t, async (inventory) => {
      const b = await inventory.commitCosting(v);
      await t.settings.set('official-test-batch', b.batchId);
      return b;
    }),
  );
  expect(await costSvc.settings.get('official-test-batch', null)).toBe(batch.batchId);
  const read = await inventoryCosting(costSvc).snapshot(202601);
  expect(read.batches[0]).toMatchObject({
    module_id: 'costing',
    actor_id: 1,
    status: 'calculated',
  });
  await expect(cancel(batch.batchId)).rejects.toThrow(/原核算模块/);
  await costSvc.tx((t) =>
    withInventoryCosting(t, (inventory) =>
      inventory.cancelCosting({ bookId: app.book.id, batchId: batch.batchId, expectedRevision: 1 }),
    ),
  );
});

it('w_cb_hz：半分尾差与零数量残值调整单列，盘亏后正式结存为零且逐分守恒', async () => {
  await api().removeDocument({ id: receiptId, revision: 1, confirmed: true });
  const issue = await api().document({ id: issueId });
  await api().saveDocument({
    ...(await api().copyDocument({ id: issueId })),
    id: issueId,
    revision: issue.revision,
    number: 'S1',
    lines: [{ productCode: 'P1', quantity: '1', unitPrice: '10' }],
  });
  await api().saveOpening({
    warehouseId,
    revision: 1,
    confirmReplace: true,
    rows: [{ productCode: 'P1', quantity: '2', unitPrice: '0.005' }],
  });
  const count = await api().generateCount({
    warehouseId,
    period: 202601,
    revision: 0,
    confirmed: false,
  });
  await api().saveCount({
    warehouseId,
    period: 202601,
    revision: count.revision,
    rows: [{ productCode: 'P1', actual: '0' }],
  });
  const v = await input();
  v.lines[0]!.costCents = 1;
  v.lines[0]!.unitCost = '0.005';
  v.balances = [{ warehouseId, productId, quantity: '0', amountCents: 0 }];
  v.countAdjustments = [
    {
      warehouseId,
      productId,
      countId: count.id,
      quantity: '-1',
      amountCents: -1,
      zeroQuantityAdjustmentCents: 1,
    },
  ];
  await commit(v);
  expect((await api().stock({ warehouseId }))[0]).toMatchObject({
    balance: '0',
    balanceCents: 0,
    issueCostCents: 1,
    adjustmentQuantity: '-1',
    adjustmentCents: 0,
  });
});

it('共享契约：没有前月正式批次时不伪造月初数，遗留不一致截止点禁止覆盖', async () => {
  const future = await inventoryCosting(svc()).snapshot(202603);
  expect(future.periodOpeningReady).toBe(false);
  expect(future.periodOpening).toEqual([]);
  await app.svc.db
    .withTables<InventoryTables>()
    .updateTable('inventory_control')
    .set({ cost_period: 202512, cost_cutoff_date: '2025-12-31' })
    .where('id', '=', 1)
    .execute();
  await expect(commit(await input())).rejects.toThrow(/连续核算/);
});
