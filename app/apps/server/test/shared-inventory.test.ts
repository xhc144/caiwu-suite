import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { createTestApp, voucherInputFromSpec, type TestApp } from '@caiwu/testkit';
import { defineManifest, type CostingCommitInput } from '@caiwu/core';
import { defineServerModule, moduleKit } from '@caiwu/server-kit';
import inventory from '../../../modules/inventory/server';
import { withInventoryProvider } from '../src/inventory';
const realInventory = withInventoryProvider(inventory);
const manifest = defineManifest({
  id: 'costing',
  name: '合成成本调用方',
  products: ['chengben'],
  permissions: [
    { id: 'costing.view', name: '查看' },
    { id: 'costing.calculate', name: '核算' },
    { id: 'costing.voucher', name: '来源凭证' },
  ],
  sources: ['receipt', 'revenue', 'cost'].map((type) => ({
    type,
    name: type,
    path: '/vouchers?id={id}',
  })),
});
const costing = defineServerModule(manifest, { router: moduleKit(manifest).router({}) });
let app: TestApp;
afterEach(async () => app?.close());
async function setup() {
  app = await createTestApp({ modules: [realInventory, costing] });
  const api = app.call(realInventory);
  const warehouseId = await api.saveWarehouse({ code: '01', name: '合成仓' });
  const productId = (await api.saveProduct({ code: 'P1', name: '合成产品' })).id;
  await api.saveOpening({
    warehouseId,
    revision: 0,
    rows: [{ productCode: 'P1', quantity: '10', unitPrice: '1' }],
  });
  const accountId = (await app.svc.accounts.require('1001')).id;
  await api.saveDocument({
    requestKey: randomUUID(),
    kind: 'receipt',
    warehouseId,
    number: 'R1',
    date: '2026-01-10',
    category: '采购',
    accountId,
    lines: [{ productCode: 'P1', quantity: '10', unitPrice: '3' }],
  });
  const issue = await api.saveDocument({
    requestKey: randomUUID(),
    kind: 'issue',
    warehouseId,
    number: 'S1',
    date: '2026-01-10',
    category: '销售',
    accountId,
    costAccountId: (await app.svc.accounts.require('6401')).id,
    lines: [{ productCode: 'P1', quantity: '5', unitPrice: '10' }],
  });
  const s = await app.svcFor('costing').inventory.snapshot(202601);
  const payload: CostingCommitInput = {
    bookId: app.book.id,
    period: 202601,
    requestKey: randomUUID(),
    expectedStockRevision: s.stockRevision,
    expectedOpeningRevision: s.openingRevision,
    previousBatchId: s.previousBatchId,
    fingerprint: s.fingerprint,
    lines: [
      {
        documentId: issue.id,
        lineId: s.movements.find((l) => l.documentId === issue.id)!.id,
        costCents: 1000,
        unitCost: '2',
      },
    ],
    balances: [{ warehouseId, productId, quantity: '15', amountCents: 3000 }],
    countAdjustments: [],
  };
  return { payload, issue, warehouseId, productId };
}
async function createCostVoucher(t: typeof app.svc, id: number) {
  return t.vouchers.create({
    ...(await voucherInputFromSpec(t, {
      date: '2026-01-10',
      lines: [
        { account: '6401', debit: 1000 },
        { account: '1405', credit: 1000, quantity: '5' },
      ],
    })),
    source: { type: 'cost', id: String(id) },
  });
}
it('w_cb_hz/w_cb_pz：库存、正式成本、来源凭证、关联和日志原子提交；异人审核后来源不可变', async () => {
  const { payload, issue } = await setup();
  const svc = app.svcFor('costing');
  const linked = await svc.tx((t) =>
    t.inventory.with(async (inv) => {
      const batch = await inv.commitCosting(payload);
      const snapshot = await inv.snapshot(202601);
      const document = snapshot.documents.find((d) => d.id === issue.id)!;
      const voucher = await createCostVoucher(t, issue.id);
      const link = await inv.lockVoucherSource({
        bookId: app.book.id,
        documentId: issue.id,
        purpose: 'cost',
        expectedRevision: document.revision,
        voucherId: voucher.id,
      });
      return { batch, voucher, link };
    }),
  );
  const snapshot = await svc.inventory.snapshot(202602);
  expect(snapshot.periodOpening[0]).toMatchObject({
    quantity: '15',
    amountCents: 3000,
    sourceBatchId: linked.batch.batchId,
  });
  expect(snapshot.movements.find((l) => l.documentId === issue.id)).toMatchObject({
    outboundCostCents: 1000,
    unitCost: '2',
  });
  const reviewerToken = await app.addUser('reviewer');
  const reviewerId = app.runtime.sessions.get(reviewerToken)!.userId;
  const { createCoreServices, loadServiceUser } = await import('@caiwu/core/server');
  const reviewer = createCoreServices({
    ...app.svc.ctx,
    user: (await loadServiceUser(app.svc.db, reviewerId))!,
  });
  await reviewer.vouchers.changeStatus({ ids: [linked.voucher.id], to: 'audited' });
  await expect(
    svc.tx((t) =>
      t.inventory.with((inv) =>
        inv.releaseVoucherSource({
          bookId: app.book.id,
          documentId: issue.id,
          purpose: 'cost',
          expectedRevision: linked.link.revision,
          voucherId: linked.voucher.id,
        }),
      ),
    ),
  ).rejects.toThrow(/审核/);
  await expect(
    svc.tx((t) =>
      t.inventory.with((inv) =>
        inv.cancelCosting({
          bookId: app.book.id,
          batchId: linked.batch.batchId,
          expectedRevision: 1,
        }),
      ),
    ),
  ).rejects.toThrow(/审核/);
  await expect(
    app
      .call(realInventory)
      .removeDocument({ id: issue.id, revision: linked.link.revision, confirmed: true }),
  ).rejects.toThrow();
  expect((await svc.inventory.snapshot(202601)).batches[0]!.status).toBe('calculated');
});
it('w_cb_hz：晚阶段失败和回调内捕获内部错误均不提交成本、凭证、来源或日志', async () => {
  const { payload, issue } = await setup();
  const svc = app.svcFor('costing');
  const before = await svc.inventory.snapshot(202601);
  const logs = await app.svc.db.selectFrom('operation_log').selectAll().execute();
  await expect(
    svc.tx((t) =>
      t.inventory.with(async (inv) => {
        await inv.commitCosting(payload);
        await createCostVoucher(t, issue.id);
        throw new Error('晚阶段故障');
      }),
    ),
  ).rejects.toThrow('晚阶段故障');
  expect(await svc.inventory.snapshot(202601)).toEqual(before);
  expect((await app.svc.vouchers.list()).total).toBe(0);
  await expect(
    svc.tx((t) =>
      t.inventory.with(async (inv) => {
        await inv.commitCosting(payload);
        await inv
          .lockVoucherSource({
            bookId: app.book.id,
            documentId: issue.id,
            purpose: 'cost',
            expectedRevision: 1,
            voucherId: 999,
          })
          .catch(() => undefined);
      }),
    ),
  ).rejects.toThrow();
  expect(await svc.inventory.snapshot(202601)).toEqual(before);
  expect(await app.svc.db.selectFrom('operation_log').selectAll().execute()).toEqual(logs);
});
it('w_cb_fgz：只能取消最后正式批次，恢复控制锚点与正式成本；来源释放负责唯一一次删除凭证', async () => {
  const { payload, issue } = await setup();
  const svc = app.svcFor('costing');
  const january = await svc.tx((t) => t.inventory.with((inv) => inv.commitCosting(payload)));
  const feb = await svc.inventory.snapshot(202602);
  const february = await svc.tx((t) =>
    t.inventory.with((inv) =>
      inv.commitCosting({
        ...payload,
        period: 202602,
        requestKey: randomUUID(),
        fingerprint: feb.fingerprint,
        expectedStockRevision: feb.stockRevision,
        previousBatchId: january.batchId,
        lines: [],
      }),
    ),
  );
  await expect(
    svc.tx((t) =>
      t.inventory.with((inv) =>
        inv.cancelCosting({ bookId: app.book.id, batchId: january.batchId, expectedRevision: 1 }),
      ),
    ),
  ).rejects.toThrow(/最后月份/);
  await svc.tx((t) =>
    t.inventory.with((inv) =>
      inv.cancelCosting({ bookId: app.book.id, batchId: february.batchId, expectedRevision: 1 }),
    ),
  );
  const linked = await svc.tx((t) =>
    t.inventory.with(async (inv) => {
      const snapshot = await inv.snapshot(202601);
      const voucher = await createCostVoucher(t, issue.id);
      return inv.lockVoucherSource({
        bookId: app.book.id,
        documentId: issue.id,
        purpose: 'cost',
        expectedRevision: snapshot.documents.find((d) => d.id === issue.id)!.revision,
        voucherId: voucher.id,
      });
    }),
  );
  await svc.tx((t) =>
    t.inventory.with((inv) =>
      inv.releaseVoucherSource({
        bookId: app.book.id,
        documentId: issue.id,
        purpose: 'cost',
        expectedRevision: linked.revision,
        voucherId: linked.voucherId,
      }),
    ),
  );
  expect(await app.svc.vouchers.get(linked.voucherId)).toBeNull();
  await svc.tx((t) =>
    t.inventory.with((inv) =>
      inv.cancelCosting({ bookId: app.book.id, batchId: january.batchId, expectedRevision: 1 }),
    ),
  );
  const restored = await svc.inventory.snapshot(202601);
  expect(restored.control).toMatchObject({ costBatch: null, costPeriod: null });
  expect(restored.movements.find((l) => l.documentId === issue.id)!.outboundCostCents).toBeNull();
});
