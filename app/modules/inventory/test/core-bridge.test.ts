import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import {
  defineManifest,
  CostingCommitSchema,
  type CostingCommitInput,
  type InventoryCostingCapability,
  type InventoryService,
} from '@caiwu/core';
import { createCoreServices, loadServiceUser, type CoreServices } from '@caiwu/core/server';
import { defineMigrations } from '@caiwu/db';
import { defineServerModule, moduleKit } from '@caiwu/server-kit';
import { createTestApp, voucherInputFromSpec, type TestApp } from '@caiwu/testkit';
import server from '../server';
import type { InventoryTables } from '../server/migrations';

// 合成调用方仅用 core API；不依赖真实 costing 页面或复制库存算法。
let escapedService: CoreServices | undefined;
let escapedReader: InventoryService | undefined;
let escapedWriter: InventoryCostingCapability | undefined;
const manifest = defineManifest({
  id: 'costing',
  name: '合成成本调用方',
  products: ['chengben'],
  permissions: [
    { id: 'costing.view', name: '查看' },
    { id: 'costing.calculate', name: '核算' },
    { id: 'costing.voucher', name: '凭证' },
  ],
  sources: ['receipt', 'revenue', 'cost'].map((type) => ({
    type,
    name: type,
    path: '/test?id={id}',
  })),
});
const m = moduleKit(manifest);
type CallerTables = { costing_bridge_batch: { id: string; inventory_batch_id: string | null } };
async function makeVoucher(
  t: CoreServices,
  documentId: number,
  purpose: 'cost' | 'revenue' = 'cost',
) {
  const amount = purpose === 'cost' ? 1000 : 5000;
  return t.vouchers.create({
    ...(await voucherInputFromSpec(t, {
      date: '2026-01-10',
      lines:
        purpose === 'cost'
          ? [
              { account: '6401', debit: amount },
              { account: '1405', credit: amount, quantity: '-5' },
            ]
          : [
              { account: '1001', debit: amount },
              { account: '6001', credit: amount },
            ],
    })),
    source: { type: purpose, id: String(documentId) },
  });
}
const costing = defineServerModule(manifest, {
  migrations: defineMigrations([
    {
      id: '0001_bridge_test',
      sql: 'CREATE TABLE costing_bridge_batch (id TEXT PRIMARY KEY, inventory_batch_id TEXT)',
    },
  ]),
  router: m.router({
    snapshot: m.procedure
      .input(z.number())
      .query(({ ctx, input }) => ctx.svc.inventory.snapshot(input)),
    remember: m.procedure.query(async ({ ctx }) => {
      escapedService = ctx.svc;
      escapedReader = ctx.svc.inventory;
      return escapedReader.snapshot(202601);
    }),
    reuse: m.procedure.query(() => escapedReader!.snapshot(202601)),
    publish: m.procedure
      .meta({ permission: 'costing.calculate' })
      .input(
        z.object({
          payload: CostingCommitSchema,
          fail: z.boolean().default(false),
          voucher: z.boolean().default(false),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.svc.tx((t) =>
          t.inventory.with(async (inv) => {
            const db = t.db.withTables<CallerTables>();
            // 调用方必须先写真实批次，避免只验证库存工厂自己的事务。
            await db
              .insertInto('costing_bridge_batch')
              .values({ id: input.payload.requestKey, inventory_batch_id: null })
              .execute();
            const batch = await inv.commitCosting(input.payload);
            await db
              .updateTable('costing_bridge_batch')
              .set({ inventory_batch_id: batch.batchId })
              .where('id', '=', input.payload.requestKey)
              .execute();
            if (input.voucher) {
              const documentId = input.payload.lines[0]!.documentId;
              const d = (await inv.snapshot(202601)).documents.find((d) => d.id === documentId)!;
              const v = await makeVoucher(t, documentId);
              await inv.lockVoucherSource({
                bookId: input.payload.bookId,
                documentId,
                purpose: 'cost',
                expectedRevision: d.revision,
                voucherId: v.id,
              });
            }
            escapedWriter = inv;
            await t.log.write({ action: 'costing.bridge.publish', summary: '合成成本发布' });
            if (input.fail) throw new Error('调用方保存后故意失败');
            return batch;
          }),
        ),
      ),
  }),
});
let app: TestApp;
let warehouseId: number, productId: number, issueId: number;
const api = () => app.call(server);
const svc = () => app.svcFor('costing');
async function input(): Promise<CostingCommitInput> {
  const snapshot = await app.call(costing).snapshot(202601);
  return {
    bookId: snapshot.bookId,
    period: snapshot.period,
    requestKey: randomUUID(),
    fingerprint: snapshot.fingerprint,
    expectedStockRevision: snapshot.stockRevision,
    expectedOpeningRevision: snapshot.openingRevision,
    previousBatchId: snapshot.previousBatchId,
    lines: [
      {
        lineId: snapshot.movements.find((l) => l.documentId === issueId)!.id,
        documentId: issueId,
        costCents: 1000,
        unitCost: '2',
      },
    ],
    balances: [{ warehouseId, productId, quantity: '15', amountCents: 3000 }],
    countAdjustments: [],
  };
}
async function setup(testApp: TestApp) {
  const inventory = testApp.call(server);
  const warehouseId = await inventory.saveWarehouse({ code: '01', name: '合成测试仓' });
  const productId = (await inventory.saveProduct({ code: 'P1', name: '合成产品' })).id;
  await inventory.saveOpening({
    warehouseId,
    revision: 0,
    rows: [{ productCode: 'P1', quantity: '10', unitPrice: '1' }],
  });
  const accountId = (await testApp.svc.accounts.require('1001')).id;
  await inventory.saveDocument({
    requestKey: randomUUID(),
    kind: 'receipt',
    warehouseId,
    number: 'R1',
    date: '2026-01-10',
    category: '采购',
    accountId,
    lines: [{ productCode: 'P1', quantity: '10', unitPrice: '3' }],
  });
  const issueId = (
    await inventory.saveDocument({
      requestKey: randomUUID(),
      kind: 'issue',
      warehouseId,
      number: 'S1',
      date: '2026-01-10',
      category: '销售',
      accountId,
      costAccountId: (await testApp.svc.accounts.require('6401')).id,
      lines: [{ productCode: 'P1', quantity: '5', unitPrice: '10' }],
    })
  ).id;
  return { warehouseId, productId, issueId };
}
beforeEach(async () => {
  escapedService = undefined;
  escapedReader = undefined;
  escapedWriter = undefined;
  app = await createTestApp({ modules: [server, costing] });
  ({ warehouseId, productId, issueId } = await setup(app));
});
afterEach(async () => app.close());

it('w_cb_hz：通过请求/core/testkit桥发布10×1+10×3−5，正式成本1000分、余15/3000分', async () => {
  const payload = await input();
  const result = await app.call(costing).publish({ payload });
  expect((await api().stock({ warehouseId }))[0]).toMatchObject({
    balance: '15',
    issueCostCents: 1000,
    balanceCents: 3000,
  });
  const snapshot = await svc().inventory.snapshot(202602);
  expect(snapshot.batches).toEqual([
    expect.objectContaining({
      id: result.batchId,
      actor_id: 1,
      module_id: 'costing',
      status: 'calculated',
    }),
  ]);
  expect(snapshot.periodOpening).toEqual([
    { warehouseId, productId, quantity: '15', amountCents: 3000, sourceBatchId: result.batchId },
  ]);
  expect(
    await app.svc.db
      .withTables<CallerTables>()
      .selectFrom('costing_bridge_batch')
      .selectAll()
      .execute(),
  ).toEqual([{ id: payload.requestKey, inventory_batch_id: result.batchId }]);
});

it('w_cb_fgz：完整正式链可逐月发布并从末月逆序取消，月初保持正式出处', async () => {
  const january = await app.call(costing).publish({ payload: await input() });
  const snapshot = await svc().inventory.snapshot(202602);
  const payload: CostingCommitInput = {
    bookId: snapshot.bookId,
    period: snapshot.period,
    requestKey: randomUUID(),
    fingerprint: snapshot.fingerprint,
    expectedStockRevision: snapshot.stockRevision,
    expectedOpeningRevision: snapshot.openingRevision,
    previousBatchId: snapshot.previousBatchId,
    lines: [],
    balances: [{ warehouseId, productId, quantity: '15', amountCents: 3000 }],
    countAdjustments: [],
  };
  const february = await svc().tx((t) => t.inventory.with((inv) => inv.commitCosting(payload)));
  expect((await svc().inventory.snapshot(202603)).periodOpening).toEqual([
    { warehouseId, productId, quantity: '15', amountCents: 3000, sourceBatchId: february.batchId },
  ]);
  await svc().tx((t) =>
    t.inventory.with((inv) =>
      inv.cancelCosting({ bookId: app.book.id, batchId: february.batchId, expectedRevision: 1 }),
    ),
  );
  expect((await svc().inventory.snapshot(202602)).previousBatchId).toBe(january.batchId);
  await svc().tx((t) =>
    t.inventory.with((inv) =>
      inv.cancelCosting({ bookId: app.book.id, batchId: january.batchId, expectedRevision: 1 }),
    ),
  );
  expect((await svc().inventory.snapshot(202601)).control).toMatchObject({
    costBatch: null,
    costPeriod: null,
    openingLocked: false,
  });
});

it('w_cb_pdk：盘点到14后正式结存14/2800，下一期月初原样承接', async () => {
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
    rows: [{ productCode: 'P1', actual: '14' }],
  });
  const payload = await input();
  payload.balances[0] = { warehouseId, productId, quantity: '14', amountCents: 2800 };
  payload.countAdjustments = [
    {
      warehouseId,
      productId,
      countId: count.id,
      quantity: '-1',
      amountCents: -200,
      zeroQuantityAdjustmentCents: 0,
    },
  ];
  await app.call(costing).publish({ payload });
  expect((await api().stock({ warehouseId }))[0]).toMatchObject({
    balance: '14',
    issueCostCents: 1000,
    balanceCents: 2800,
  });
  expect((await svc().inventory.snapshot(202602)).periodOpening[0]).toMatchObject({
    quantity: '14',
    amountCents: 2800,
  });
});

it('w_cb_hz/w_cb_pz：调用方先写成本批次，再写库存/来源凭证/日志，后抛错全部回滚', async () => {
  const before = await svc().inventory.snapshot(202601);
  const logs = await app.svc.db.selectFrom('operation_log').selectAll().execute();
  await expect(
    app.call(costing).publish({ payload: await input(), voucher: true, fail: true }),
  ).rejects.toThrow(/故意失败/);
  expect(await svc().inventory.snapshot(202601)).toEqual(before);
  expect(
    await app.svc.db
      .withTables<CallerTables>()
      .selectFrom('costing_bridge_batch')
      .selectAll()
      .execute(),
  ).toEqual([]);
  expect((await app.svc.vouchers.list()).total).toBe(0);
  expect(await app.svc.db.selectFrom('operation_log').selectAll().execute()).toEqual(logs);
  expect((await api().document({ id: issueId })).revision).toBe(1);
});

it('共享桥：错账套/用户/模块和过期指纹拒绝，失败不遗留调用方批次', async () => {
  const payload = await input();
  const clerk = await app.addUser('cost-clerk', {
    permissions: ['costing.view', 'costing.calculate'],
  });
  await expect(app.call(costing, clerk).publish({ payload })).rejects.toThrow(
    /上下文|变化|重新试算/,
  );
  await expect(
    app.call(costing).publish({ payload: { ...payload, bookId: randomUUID() } }),
  ).rejects.toThrow(/账套/);
  await expect(app.svcFor('cashier').inventory.snapshot(202601)).rejects.toThrow(/库存或成本/);
  const inventorySnapshot = await app.svcFor('inventory').inventory.snapshot(202601);
  await expect(
    app
      .call(costing)
      .publish({ payload: { ...payload, fingerprint: inventorySnapshot.fingerprint } }),
  ).rejects.toThrow(/变化|上下文/);
  await api().saveProduct({ code: 'P2', name: '版本变化' });
  await expect(app.call(costing).publish({ payload })).rejects.toThrow(/变化|重新试算/);
  expect(
    await app.svc.db
      .withTables<CallerTables>()
      .selectFrom('costing_bridge_batch')
      .selectAll()
      .execute(),
  ).toEqual([]);
});

it('共享桥：snapshot需要costing.view，核算权限不能替代查看权限', async () => {
  const token = await app.addUser('calculate-only', { permissions: ['costing.calculate'] });
  await expect(app.call(costing, token).snapshot(202601)).rejects.toThrow(/权限/);
});

it('共享桥：读写能力在with/tx回调结束后拒绝，另一事务不可借用，外层svc不可混用', async () => {
  const payload = await input();
  let writer: InventoryCostingCapability | undefined;
  let transactionService: CoreServices | undefined;
  await svc().tx((t) =>
    t.inventory.with(async (inv) => {
      writer = inv;
      transactionService = t;
    }),
  );
  await expect(writer!.snapshot(202601)).rejects.toThrow(/事务|作用域/);
  await expect(writer!.commitCosting(payload)).rejects.toThrow(/事务|作用域/);
  await expect(transactionService!.inventory.snapshot(202601)).rejects.toThrow(/事务|作用域/);
  await expect(transactionService!.tx((t) => t.inventory.snapshot(202601))).rejects.toThrow(/事务/);
  await svc().tx(async (t) => {
    await expect(writer!.snapshot(202601)).rejects.toThrow(/事务|作用域/);
    await expect(transactionService!.tx((s) => s.inventory.snapshot(202601))).rejects.toThrow(
      /事务/,
    );
    await expect(svc().inventory.snapshot(202601)).rejects.toThrow(/事务外/);
    await t.inventory.with(async (outer) => {
      await t.inventory.with(async () => {
        await expect(outer.snapshot(202601)).rejects.toThrow(/作用域/);
        await expect(outer.commitCosting(payload)).rejects.toThrow(/作用域/);
      });
      expect((await outer.snapshot(202601)).period).toBe(202601);
    });
    await t.inventory.with(async (inv) => {
      writer = inv;
    });
    await expect(writer!.snapshot(202601)).rejects.toThrow(/作用域/);
    await expect(writer!.commitCosting(payload)).rejects.toThrow(/作用域/);
  });
  await expect(svc().inventory.with(async () => undefined)).rejects.toThrow(/svc.tx/);
});

it('共享桥：请求结束后的reader/service/writer在普通调用和新请求中全部拒绝', async () => {
  await app.call(costing).remember();
  await expect(escapedReader!.snapshot(202601)).rejects.toThrow(/请求作用域/);
  await expect(escapedService!.inventory.snapshot(202601)).rejects.toThrow(/请求作用域/);
  await expect(app.call(costing).reuse()).rejects.toThrow(/请求作用域/);
  const payload = await input();
  await app.call(costing).publish({ payload });
  await expect(escapedWriter!.snapshot(202601)).rejects.toThrow(/请求作用域/);
  await expect(
    escapedWriter!.cancelCosting({ bookId: app.book.id, batchId: 'expired', expectedRevision: 1 }),
  ).rejects.toThrow(/请求作用域/);
});

it('w_cb_pz/w_cb_fgz：revenue/cost双用途续用revision；release只删一次；已审核来源不能取消或释放', async () => {
  const batch = await app.call(costing).publish({ payload: await input() });
  const linked = await svc().tx((t) =>
    t.inventory.with(async (inv) => {
      const d = (await inv.snapshot(202601)).documents.find((d) => d.id === issueId)!;
      const revenue = await makeVoucher(t, issueId, 'revenue');
      const r = await inv.lockVoucherSource({
        bookId: app.book.id,
        documentId: issueId,
        purpose: 'revenue',
        expectedRevision: d.revision,
        voucherId: revenue.id,
      });
      const cost = await makeVoucher(t, issueId);
      const c = await inv.lockVoucherSource({
        bookId: app.book.id,
        documentId: issueId,
        purpose: 'cost',
        expectedRevision: r.revision,
        voucherId: cost.id,
      });
      const release = await inv.releaseVoucherSource({
        bookId: app.book.id,
        documentId: issueId,
        purpose: 'revenue',
        expectedRevision: c.revision,
        voucherId: revenue.id,
      });
      expect(await t.vouchers.get(revenue.id)).toBeNull();
      return { ...release, voucherId: cost.id };
    }),
  );
  await app.svc.vouchers.changeStatus({ ids: [linked.voucherId], to: 'audited' });
  await expect(
    svc().tx((t) =>
      t.inventory.with((inv) =>
        inv.releaseVoucherSource({
          ...linked,
          bookId: app.book.id,
          purpose: 'cost',
          expectedRevision: linked.revision,
        }),
      ),
    ),
  ).rejects.toThrow(/审核/);
  await expect(
    svc().tx((t) =>
      t.inventory.with((inv) =>
        inv.cancelCosting({ bookId: app.book.id, batchId: batch.batchId, expectedRevision: 1 }),
      ),
    ),
  ).rejects.toThrow(/审核/);
  expect((await svc().inventory.snapshot(202601)).batches[0]!.status).toBe('calculated');
  expect((await app.svc.vouchers.get(linked.voucherId))!.status).toBe('audited');
});

it('w_cb_fgz：无costing.voucher权限不能取消带成本凭证批次且所有状态保留', async () => {
  const batch = await app.call(costing).publish({ payload: await input(), voucher: true });
  const token = await app.addUser('cancel-only', {
    permissions: ['costing.view', 'costing.calculate'],
  });
  const session = app.runtime.sessions.get(token)!;
  const user = (await loadServiceUser(app.svc.db, session.userId))!;
  const clerk = createCoreServices({
    ...svc().ctx,
    user: { ...user, permissions: new Set(['costing.view', 'costing.calculate']) },
  });
  await expect(
    clerk.tx((t) =>
      t.inventory.with((inv) =>
        inv.cancelCosting({ bookId: app.book.id, batchId: batch.batchId, expectedRevision: 1 }),
      ),
    ),
  ).rejects.toThrow(/权限/);
  expect((await svc().inventory.snapshot(202601)).batches[0]!.status).toBe('calculated');
  expect((await app.svc.vouchers.list()).total).toBe(1);
});

it('共享桥：periodOpeningReady=false不补零，control到启用月的正式批次链缺口拒绝发布', async () => {
  const future = await svc().inventory.snapshot(202603);
  expect(future.periodOpeningReady).toBe(false);
  expect(future.periodOpening).toEqual([]);
  await app.call(costing).publish({ payload: await input() });
  const db = app.svc.db.withTables<InventoryTables>();
  await db
    .updateTable('inventory_costing_batch')
    .set({ previous_batch_id: null, period: 202602 })
    .execute();
  await db
    .updateTable('inventory_control')
    .set({ cost_period: 202602, cost_cutoff_date: '2026-02-28' })
    .execute();
  const s = await svc().inventory.snapshot(202603);
  expect(s.periodOpeningReady).toBe(true);
  const payload = {
    ...(await input()),
    period: 202603,
    fingerprint: s.fingerprint,
    previousBatchId: s.previousBatchId,
    expectedStockRevision: s.stockRevision,
    lines: [],
  };
  await expect(
    svc().tx((t) => t.inventory.with((inv) => inv.commitCosting(payload))),
  ).rejects.toThrow(/批次链/);
});

it('共享桥：两个runtime中同账套/用户/单据ID隔离；无provider明确拒绝', async () => {
  const other = await createTestApp({ modules: [server, costing] });
  const missing = await createTestApp();
  try {
    // 合成同逻辑账套ID；连接/运行环境必须仍然完全隔离。
    await other.svc.db.updateTable('book_info').set({ book_id: app.book.id }).execute();
    expect((await other.svcFor('costing').inventory.snapshot(202601)).bookId).toBe(app.book.id);
    expect(await setup(other)).toEqual({ warehouseId, productId, issueId });
    expect((await other.svcFor('costing').inventory.snapshot(202601)).movements).toHaveLength(2);
    await app.call(costing).publish({ payload: await input() });
    expect((await svc().inventory.snapshot(202601)).batches).toHaveLength(1);
    expect((await other.svcFor('costing').inventory.snapshot(202601)).batches).toEqual([]);
    let writer: InventoryCostingCapability | undefined;
    let ready: (() => void) | undefined;
    let release: (() => void) | undefined;
    const available = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = svc().tx((t) =>
      t.inventory.with(async (inv) => {
        writer = inv;
        ready!();
        await finished;
      }),
    );
    await available;
    try {
      await other.svcFor('costing').tx((t) =>
        t.inventory.with(async () => {
          await expect(writer!.snapshot(202601)).rejects.toThrow(/事务|作用域/);
        }),
      );
    } finally {
      release!();
      await first;
    }
    expect((await other.call(server).stock({ warehouseId }))[0]).toMatchObject({
      balance: '15',
      balanceCents: null,
    });
    await expect(missing.svcFor('costing').inventory.snapshot(202601)).rejects.toMatchObject({
      data: { code: 'INVENTORY_PROVIDER_MISSING' },
    });
    await expect(
      missing.svcFor('costing').tx((t) => t.inventory.with(async () => undefined)),
    ).rejects.toMatchObject({ data: { code: 'INVENTORY_PROVIDER_MISSING' } });
  } finally {
    await other.close();
    await missing.close();
  }
});
