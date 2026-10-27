import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTestApp, createTestBook, voucherInputFromSpec, type TestApp } from '@caiwu/testkit';
import { runMigrations } from '@caiwu/db';
import { Decimal } from '@caiwu/core';
import server from '../server';
import { migrations, type InventoryTables } from '../server/migrations';
import { inventoryService } from '../server/service';
import type { DocumentInput } from '../shared';

let app: TestApp;
let warehouseId: number;
let cash: number;
let cost: number;
const api = () => app.call(server);
const documentInput = (
  kind: 'receipt' | 'issue',
  number: string,
  date = '2026-01-10',
): DocumentInput => ({
  requestKey: randomUUID(),
  kind,
  number,
  warehouseId,
  date,
  category: kind === 'receipt' ? '采购' : '销售',
  accountId: cash,
  costAccountId: kind === 'issue' ? cost : null,
  lines: [{ productCode: 'P1', quantity: kind === 'receipt' ? '5' : '3', unitPrice: '3.33' }],
});
async function opening() {
  await api().saveOpening({
    warehouseId,
    revision: 0,
    rows: [{ productCode: 'P1', quantity: '10', unitPrice: '2.55' }],
  });
}
// Costing is not loaded. Fixtures publish a controlled result through the real
// test book transaction, so tests do not depend on another worker's page/API.
async function seedCost(documentId: number, cents = 843) {
  await app.svc.tx(async (t) => {
    const db = t.db.withTables<InventoryTables>();
    await db
      .updateTable('inventory_document')
      .set({
        calculation_status: 'calculated',
        calculation_batch: 'test-cost',
        calculation_period: 202601,
      })
      .where('id', '=', documentId)
      .execute();
    await db
      .updateTable('inventory_line')
      .set({
        calculation_status: 'calculated',
        calculation_batch: 'test-cost',
        calculation_period: 202601,
        outbound_cost_cents: cents,
        unit_cost: new Decimal(cents).div(300).toFixed(),
      })
      .where('document_id', '=', documentId)
      .execute();
  });
}
beforeEach(async () => {
  app = await createTestApp({ modules: [server], product: 'chengben' });
  warehouseId = await api().saveWarehouse({ code: '01', name: '成本测试仓' });
  await api().saveProduct({ code: 'P1', name: '测试产品', receiptPrice: '9', issuePrice: '20' });
  cash = (await app.svc.accounts.require('1001')).id;
  cost = (await app.svc.accounts.require('6401')).id;
});
afterEach(async () => app.close());

it('w_ck_kc_hz/w_cb_sl_hzyeb/w_ck_tz1：真实成本与默认估价分开，跨期结余逐分守恒', async () => {
  await opening();
  await api().saveDocument(documentInput('receipt', 'R1'));
  const issue = await api().saveDocument(documentInput('issue', 'S1', '2026-01-15'));
  await seedCost(issue.id);
  const stock = (await api().stock({ warehouseId }))[0]!;
  expect(stock).toMatchObject({
    opening: '10',
    received: '5',
    issued: '3',
    balance: '12',
    openingCents: 2550,
    receiptCents: 1665,
    issueCostCents: 843,
    balanceCents: 3372,
    costStatus: '账面金额完整',
    estimatedReceiptCents: 10800,
  });
  const ledger = await api().ledger({ warehouseId, productCode: 'P1' });
  expect(ledger.map((r) => r.balanceCents)).toEqual([2550, 4215, 3372]);
  const february = (await api().stock({ warehouseId, from: '2026-02-01', to: '2026-02-28' }))[0]!;
  expect(february).toMatchObject({
    opening: '12',
    openingCents: 3372,
    issueCostCents: 0,
    balanceCents: 3372,
  });
  expect(
    (
      await api().ledger({ warehouseId, productCode: 'P1', from: '2026-02-01', to: '2026-02-28' })
    )[0],
  ).toMatchObject({ amountCents: 3372, balanceCents: 3372 });
});

it('w_ck_tz1/w_cb_sl_hzyeb：任一未核算出库使后续结余留空，后来入库不恢复虚假成本', async () => {
  await opening();
  const issue = await api().saveDocument(documentInput('issue', 'S1'));
  await api().saveDocument(documentInput('receipt', 'R1', '2026-01-20'));
  const db = app.svc.db.withTables<InventoryTables>();
  // A numeric stale cost on an uncalculated record must not be used.
  await db
    .updateTable('inventory_line')
    .set({ outbound_cost_cents: 99 })
    .where('document_id', '=', issue.id)
    .execute();
  expect((await api().stock({ warehouseId }))[0]).toMatchObject({
    issueCostCents: null,
    balanceCents: null,
    costStatus: '待成本核算',
  });
  expect((await api().stock({ warehouseId, from: '2026-02-01' }))[0]).toMatchObject({
    openingCents: null,
    receiptCents: 0,
    balanceCents: null,
  });
  expect(
    (await api().ledger({ warehouseId, productCode: 'P1' })).map((r) => r.balanceCents),
  ).toEqual([2550, null, null]);
  await seedCost(issue.id);
  await db
    .updateTable('inventory_line')
    .set({ outbound_cost_cents: null })
    .where('document_id', '=', issue.id)
    .execute();
  expect((await api().sales({ warehouseId }))[0]).toMatchObject({
    costCents: null,
    unitCost: null,
    costStatus: '待成本核算',
  });
});

it('w_ck_xsmxz1/w_cb_hzsj_ck：已核算零成本与未核算不同，销售不混入领用', async () => {
  await opening();
  const sale = await api().saveDocument(documentInput('issue', 'S0'));
  await seedCost(sale.id, 0);
  await api().saveDocument({ ...documentInput('issue', 'L1'), category: '领用' });
  const sales = await api().sales({ warehouseId });
  expect(sales).toHaveLength(1);
  expect(sales[0]).toMatchObject({
    number: 'S0',
    revenueCents: 999,
    costCents: 0,
    unitCost: '0',
    costStatus: '已核算',
  });
  expect(
    (
      await api().summary({
        filter: { warehouseId, kind: 'issue' },
        group: 'product',
        detail: false,
        valuation: 'cost',
      })
    )[0],
  ).toMatchObject({ amountCents: null, costStatus: '待成本核算' });
});

it('w_ck_kc_hz/w_ck_xsmxz1：头行核算批次或期间不一致不得读出旧成本', async () => {
  await opening();
  const issue = await api().saveDocument(documentInput('issue', 'S1'));
  await seedCost(issue.id);
  const db = app.svc.db.withTables<InventoryTables>();
  await db
    .updateTable('inventory_line')
    .set({ calculation_batch: 'stale-batch' })
    .where('document_id', '=', issue.id)
    .execute();
  expect((await api().stock({ warehouseId }))[0]!.balanceCents).toBeNull();
  expect((await api().sales({ warehouseId }))[0]!.costCents).toBeNull();
  await db
    .updateTable('inventory_line')
    .set({ calculation_batch: 'test-cost', calculation_period: 202602 })
    .where('document_id', '=', issue.id)
    .execute();
  expect((await api().ledger({ warehouseId, productCode: 'P1' })).at(-1)!.amountCents).toBeNull();
});

it('w_cb_pdk_1：数量与金额都固定于生成时，实盘只折算不影响库存，清差恢复账面', async () => {
  await opening();
  await api().saveDocument(documentInput('receipt', 'R1'));
  const issue = await api().saveDocument(documentInput('issue', 'S1'));
  await seedCost(issue.id);
  const key = { warehouseId, period: 202601 };
  const count = await api().generateCount({ ...key, revision: 0, confirmed: false });
  expect(count.rows[0]).toMatchObject({
    book: '12',
    bookCents: 3372,
    actualCents: 3372,
    differenceCents: 0,
  });
  await api().saveDocument(documentInput('receipt', 'LATER', '2026-01-25'));
  const saved = await api().saveCount({
    ...key,
    revision: count.revision,
    rows: [{ productCode: 'P1', actual: '11' }],
  });
  expect(saved.rows[0]).toMatchObject({
    book: '12',
    actual: '11',
    difference: '-1',
    bookCents: 3372,
    actualCents: 3091,
    differenceCents: -281,
  });
  expect((await api().stock({ warehouseId }))[0]).toMatchObject({
    balance: '17',
    balanceCents: 5037,
  });
  await expect(
    api().resetCount({ ...key, revision: saved.revision, confirmed: false }),
  ).rejects.toThrow(/确认/);
  const reset = await api().resetCount({ ...key, revision: saved.revision, confirmed: true });
  expect(reset.rows[0]).toMatchObject({
    actual: '12',
    bookCents: 3372,
    actualCents: 3372,
    differenceCents: 0,
  });
});

it('w_cb_pdk_1：未核算与零数量盘点不得推测金额，未知产品后整批回滚', async () => {
  const key = { warehouseId, period: 202601 };
  const empty = await api().generateCount({ ...key, revision: 0, confirmed: false });
  expect(empty.rows[0]).toMatchObject({ book: '0', bookCents: 0, actualCents: 0 });
  const saved = await api().saveCount({
    ...key,
    revision: empty.revision,
    rows: [{ productCode: 'P1', actual: '1' }],
  });
  expect(saved.rows[0]).toMatchObject({
    actualCents: null,
    differenceCents: null,
    amountStatus: '零账面数量，无法确定单价',
  });
  const db = app.svc.db.withTables<InventoryTables>();
  await db
    .updateTable('inventory_count_line')
    .set({ book_cents: 100 })
    .where('count_id', '=', empty.id!)
    .execute();
  await api().saveCount({
    ...key,
    revision: saved.revision,
    rows: [{ productCode: 'P1', actual: '0' }],
  });
  expect((await api().count(key)).rows[0]).toMatchObject({
    book: '0',
    bookCents: 100,
    actualCents: null,
    differenceCents: null,
  });
  await opening();
  await api().saveDocument(documentInput('issue', 'S1'));
  const regenerated = await api().generateCount({
    ...key,
    revision: (await api().count(key)).revision,
    confirmed: true,
  });
  expect(regenerated.rows[0]).toMatchObject({
    book: '7',
    bookCents: null,
    actualCents: null,
    differenceCents: null,
  });
  await api().saveProduct({ code: 'P2', name: '第二产品' });
  const full = await api().generateCount({
    ...key,
    revision: regenerated.revision,
    confirmed: true,
  });
  await expect(
    api().saveCount({
      ...key,
      revision: full.revision,
      rows: [
        { productCode: 'P1', actual: '6' },
        { productCode: 'UNKNOWN', actual: '1' },
      ],
    }),
  ).rejects.toThrow(/第 2 行/);
  expect((await api().count(key)).rows[0]).toMatchObject({ actual: '7', bookCents: null });
  expect((await api().count(key)).revision).toBe(full.revision);
});

it('w_cb_pdk_1：实盘折算按整数分四舍五入，负差额和负实盘不丢精度', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: -1000, max: 1000 }), async (actual) => {
      const db = app.svc.db.withTables<InventoryTables>();
      const old = await api().count({ warehouseId, period: 202601 });
      const count = await api().generateCount({
        warehouseId,
        period: 202601,
        revision: old.revision,
        confirmed: !!old.id,
      });
      // Controlled snapshot: 3 units, 100 cents. The expected rational value is
      // independent of displayed/rounded unit price (0.33).
      await db
        .updateTable('inventory_count_line')
        .set({ book_e6: 3_000_000, book_cents: 100 })
        .where('count_id', '=', count.id!)
        .execute();
      const r = await api().saveCount({
        warehouseId,
        period: 202601,
        revision: count.revision,
        rows: [{ productCode: 'P1', actual: String(actual) }],
      });
      const expected = new Decimal(actual)
        .mul(100)
        .div(3)
        .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
        .toNumber();
      expect(r.rows[0]!.actualCents).toBe(expected);
      expect(r.rows[0]!.differenceCents).toBe(expected - 100);
      expect(Number.isSafeInteger(r.rows[0]!.actualCents)).toBe(true);
    }),
    { numRuns: 20 },
  );
});

it('w_cb_qc/w_ck_rk1/w_ck_ck1：成本快照只读、截止包含整月、保留稳定产品和移动ID与版本', async () => {
  await opening();
  const r = await api().saveDocument(documentInput('receipt', 'JAN', '2026-01-31'));
  await api().saveDocument(documentInput('receipt', 'FEB', '2026-02-01'));
  const before = await api().costingSnapshot({ period: 202601 });
  expect(before).toMatchObject({
    version: 1,
    bookId: app.book.id,
    startPeriod: 202601,
    cutoffDate: '2026-01-31',
  });
  expect(before.documents.map((d) => d.number)).toEqual(['JAN']);
  expect(before.opening[0]).toMatchObject({ warehouseId, quantity: '10', amountCents: 2550 });
  expect(before.movements[0]).toMatchObject({
    id: r.lines[0]!.id,
    documentId: r.id,
    productId: before.products[0]!.id,
    quantity: '5',
    netCents: 1665,
  });
  expect(await api().costingSnapshot({ period: 202601 })).toEqual(before);
  const audited = await api().audit({ id: r.id, revision: r.revision, to: true });
  const afterAudit = await api().costingSnapshot({ period: 202601 });
  expect(afterAudit.stockRevision).toBeGreaterThan(before.stockRevision);
  expect(afterAudit.documents[0]).toMatchObject({ revision: audited.revision, auditedBy: 1 });
  await api().saveWarehouse({ id: warehouseId, revision: 1, code: '01', name: '改名仓库' });
  expect((await api().costingSnapshot({ period: 202601 })).stockRevision).toBeGreaterThan(
    afterAudit.stockRevision,
  );
  const beforeCount = await api().costingSnapshot({ period: 202601 });
  const count = await api().generateCount({
    warehouseId,
    period: 202601,
    revision: 0,
    confirmed: false,
  });
  const afterCount = await api().costingSnapshot({ period: 202601 });
  expect(afterCount.stockRevision).toBeGreaterThan(beforeCount.stockRevision);
  expect(afterCount.counts[0]).toMatchObject({
    id: count.id,
    warehouseId,
    period: 202601,
    revision: 1,
  });
  expect(afterCount.counts[0]!.lines[0]).toMatchObject({
    bookQuantity: '15',
    actualQuantity: '15',
    bookCents: 4215,
  });
  await expect(api().costingSnapshot({ period: 202613 })).rejects.toThrow();
  await expect(api().costingSnapshot({ period: 202512 })).rejects.toThrow();
});

it('w_ck_kc/w_cb_pdk_1：新读取接口权限与账套隔离；查看者不能写实盘', async () => {
  await opening();
  const viewer = app.call(server, await app.addUser('view', { permissions: ['inventory.view'] }));
  expect((await viewer.costingSnapshot({ period: 202601 })).opening).toHaveLength(1);
  await expect(
    viewer.generateCount({ warehouseId, period: 202601, revision: 0, confirmed: false }),
  ).rejects.toThrow(/权限/);
  const none = app.call(server, await app.addUser('none'));
  await expect(none.costingSnapshot({ period: 202601 })).rejects.toThrow(/权限/);
  const other = await createTestApp({ modules: [server] });
  try {
    const empty = await other.call(server).costingSnapshot({ period: 202601 });
    expect(empty.bookId).not.toBe(app.book.id);
    expect(empty.opening).toEqual([]);
    expect(empty.products).toEqual([]);
  } finally {
    await other.close();
  }
});

it('w_cb_qc/w_ck_ck1：模拟核算写入事务失败不泄露半套状态；来源凭证保护仍生效', async () => {
  await opening();
  const issue = await api().saveDocument(documentInput('issue', 'S1'));
  await expect(
    app.svcFor('inventory').tx(async (t) => {
      await t.db
        .withTables<InventoryTables>()
        .updateTable('inventory_document')
        .set({ calculation_status: 'calculated' })
        .where('id', '=', issue.id)
        .execute();
      throw new Error('发布中断');
    }),
  ).rejects.toThrow('发布中断');
  expect((await api().stock({ warehouseId }))[0]!.balanceCents).toBeNull();
  const inventorySvc = app.svcFor('inventory');
  const voucher = await inventorySvc.vouchers.create({
    ...(await voucherInputFromSpec(inventorySvc, {
      date: '2026-01-10',
      lines: [
        { account: '1001', debit: 999 },
        { account: '6001', credit: 999 },
      ],
    })),
    source: { type: 'document', id: String(issue.id) },
  });
  await app.svc.db
    .withTables<InventoryTables>()
    .updateTable('inventory_document')
    .set({ voucher_id: voucher.id })
    .where('id', '=', issue.id)
    .execute();
  await expect(app.svc.vouchers.delete(voucher.id)).rejects.toThrow(/由「仓库进销存」生成/);
  await expect(
    api().removeDocument({ id: issue.id, revision: 1, confirmed: true }),
  ).rejects.toThrow(/会计凭证/);
  expect((await api().document({ id: issue.id })).voucher_id).toBe(voucher.id);
});

it('w_cb_pdk_1：新增金额列的旧账套迁移保留原实盘，未生成的历史金额不伪造', async () => {
  const legacy = await createTestBook({
    migrationSets: [{ scope: 'inventory', migrations: migrations.slice(0, 1) }],
  });
  try {
    const s = inventoryService(legacy.forModule('inventory'));
    const w = await s.saveWarehouse({ code: '01', name: '旧仓库' });
    const p = await s.saveProduct({ code: 'P1', name: '旧产品' });
    legacy.book.raw
      .prepare('INSERT INTO inventory_count(warehouse_id,period) VALUES(?,202601)')
      .run(w);
    legacy.book.raw
      .prepare(
        'INSERT INTO inventory_count_line(count_id,product_id,book_e6,actual_e6,note) VALUES(1,?,3000000,2000000,?)',
      )
      .run(p.id, '原始实盘');
    runMigrations(legacy.book.raw, [{ scope: 'inventory', migrations }]);
    expect((await s.count({ warehouseId: w, period: 202601 })).rows[0]).toMatchObject({
      book: '3',
      actual: '2',
      note: '原始实盘',
      bookCents: null,
      actualCents: null,
      differenceCents: null,
    });
  } finally {
    await legacy.close();
  }
});

it('w_cb_pdk_1：真实 SQLite 在线备份保留金额快照和实盘，后续修改不污染备份', async () => {
  await opening();
  const key = { warehouseId, period: 202601 };
  const count = await api().generateCount({ ...key, revision: 0, confirmed: false });
  const dir = mkdtempSync(path.join(os.tmpdir(), 'inventory-backup-'));
  try {
    const file = path.join(dir, 'before.caiwu');
    await app.runtime.bookStore.open(app.book.id).raw.backup(file);
    await api().saveCount({
      ...key,
      revision: count.revision,
      rows: [{ productCode: 'P1', actual: '9' }],
    });
    const backup = new Database(file, { readonly: true, fileMustExist: true });
    try {
      expect(backup.prepare('SELECT book_cents,actual_e6 FROM inventory_count_line').get()).toEqual(
        { book_cents: 2550, actual_e6: 10_000_000 },
      );
      expect(backup.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    } finally {
      backup.close();
    }
    expect((await api().count(key)).rows[0]).toMatchObject({
      actual: '9',
      bookCents: 2550,
      actualCents: 2295,
      differenceCents: -255,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
