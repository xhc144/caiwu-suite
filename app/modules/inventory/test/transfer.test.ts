import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import { sql } from '@caiwu/db';
import server from '../server';
import { inventoryTransfer, type TransferTables } from '../server/transfer';
import { e6 } from '../server/service';
import { TransferSchema, type TransferInput } from '../transfer';

let app: TestApp;
let sourceWarehouseId: number, targetWarehouseId: number, clearingAccountId: number;
const transfer = () => inventoryTransfer(app.svcFor('inventory'));
const api = () => app.call(server);
const input = (number = 'DB1', quantity = '3'): TransferInput => ({
  requestKey: randomUUID(),
  number,
  sourceWarehouseId,
  targetWarehouseId,
  date: '2026-01-10',
  clearingAccountId,
  summary: '仓间移动',
  lines: [{ productCode: 'P1', quantity, unitPrice: '2.55' }],
});
const identity = (r: Awaited<ReturnType<ReturnType<typeof inventoryTransfer>['get']>>) => ({
  id: r.id,
  revision: r.revision,
  issueRevision: r.issue.revision,
  receiptRevision: r.receipt.revision,
});
const stock = async (warehouseId: number) =>
  (await api().stock({ warehouseId, productCode: 'P1' }))[0]!.balance;

beforeEach(async () => {
  app = await createTestApp({ modules: [server], product: 'chengben' });
  sourceWarehouseId = await api().saveWarehouse({ code: '01', name: '原料仓' });
  targetWarehouseId = await api().saveWarehouse({ code: '02', name: '成品仓' });
  clearingAccountId = (await app.svc.accounts.require('1001')).id;
  await api().saveProduct({ code: 'P1', name: '测试产品', unit: '件' });
  await api().saveOpening({
    warehouseId: sourceWarehouseId,
    revision: 0,
    rows: [{ productCode: 'P1', quantity: '10', unitPrice: '2.55' }],
  });
});
afterEach(async () => {
  await app.close();
});

describe('w_cb_ck_copy / w_ck_rk / w_ck_ck 仓库调拨', () => {
  it('预览不改库存，双单原子保存、同数量同金额且重复请求不重复入出库', async () => {
    const v = input();
    const preview = await transfer().preview(v);
    expect(preview).toMatchObject({ shortages: [], netCents: 765, taxCents: 0, grossCents: 765 });
    expect(await api().documents({})).toEqual([]);
    const result = await transfer().save(v);
    expect(result.issue).toMatchObject({
      kind: 'issue',
      category: '其他出库',
      number: '调出-DB1',
      warehouse_id: sourceWarehouseId,
    });
    expect(result.receipt).toMatchObject({
      kind: 'receipt',
      category: '其他入库',
      number: '调入-DB1',
      warehouse_id: targetWarehouseId,
    });
    expect(result.issue.lines[0]).toMatchObject({
      quantity: '3',
      net_cents: 765,
      tax_cents: 0,
      outbound_cost_cents: null,
    });
    expect(result.receipt.lines[0]).toMatchObject({ quantity: '3', net_cents: 765, tax_cents: 0 });
    expect(await stock(sourceWarehouseId)).toBe('7');
    expect(await stock(targetWarehouseId)).toBe('3');
    expect((await transfer().save(v)).id).toBe(result.id);
    expect(await transfer().preview(v)).toMatchObject({
      shortages: [],
      netCents: 765,
      issueNumber: '调出-DB1',
      receiptNumber: '调入-DB1',
    });
    expect(await api().documents({})).toHaveLength(2);
    expect(await transfer().list({ warehouseId: sourceWarehouseId })).toHaveLength(1);
    expect(await transfer().list({ warehouseId: targetWarehouseId })).toHaveLength(1);
    await expect(transfer().save({ ...v, summary: '修改请求' })).rejects.toThrow(/请求编号/);
  });
  it('同仓、空明细、含税口径、零数量与重复号码拒绝，原库存保留', async () => {
    expect(
      TransferSchema.safeParse({ ...input(), targetWarehouseId: sourceWarehouseId }).success,
    ).toBe(false);
    for (const lines of [
      [],
      [{ productCode: 'P1', quantity: '0', unitPrice: '1' }],
      [{ productCode: 'P1', quantity: '1', unitPrice: '1', priceIncludesTax: true }],
    ])
      await expect(transfer().save({ ...input(), lines })).rejects.toThrow();
    await transfer().save(input());
    await expect(transfer().save(input())).rejects.toThrow(/调拨单号.*重复/);
    expect(await stock(sourceWarehouseId)).toBe('7');
    expect(await stock(targetWarehouseId)).toBe('3');
  });
  it('第二端真实写入失败时回滚首端、请求、配对和库存', async () => {
    const db = app.svc.db.withTables<TransferTables>();
    await sql`CREATE TRIGGER inventory_test_transfer_failure BEFORE INSERT ON inventory_document
      WHEN NEW.number='调入-ROLLBACK' BEGIN SELECT RAISE(ABORT,'synthetic transfer failure'); END`.execute(
      db,
    );
    await expect(transfer().save(input('ROLLBACK'))).rejects.toThrow(/synthetic transfer failure/);
    expect(await api().documents({})).toEqual([]);
    expect(await transfer().list({})).toEqual([]);
    expect(await db.selectFrom('inventory_request').selectAll().execute()).toEqual([]);
    expect(await stock(sourceWarehouseId)).toBe('10');
    expect(await stock(targetWarehouseId)).toBe('0');
  });
  it('负库存默认拒绝，确认绑定当时库存版本；保存成功仍守恒', async () => {
    const v = input('NEGATIVE', '11');
    const preview = await transfer().preview(v);
    expect(preview.shortages).toEqual([
      {
        productCode: 'P1',
        productName: '测试产品',
        current: '10',
        requested: '11',
        difference: '1',
      },
    ]);
    await expect(transfer().save(v)).rejects.toThrow(/尚未确认/);
    await api().saveProduct({ code: 'P2', name: '推进库存版本' });
    await expect(
      transfer().save({ ...v, negativeConfirmation: preview.confirmation }),
    ).rejects.toThrow(/版本/);
    const fresh = await transfer().preview(v);
    await transfer().save({ ...v, negativeConfirmation: fresh.confirmation });
    expect(await stock(sourceWarehouseId)).toBe('-1');
    expect(await stock(targetWarehouseId)).toBe('11');
  });
  it('不能独改单端、删除单端或审核单端；调拨审核及取消审核同时处理两端', async () => {
    let r = await transfer().save(input());
    await expect(
      api().saveDocument({ ...inputDocument(r.issue), requestKey: randomUUID(), summary: '试改' }),
    ).rejects.toThrow(/调拨/);
    await expect(
      api().removeDocument({ id: r.receipt.id, revision: r.receipt.revision, confirmed: true }),
    ).rejects.toThrow(/调拨/);
    await expect(
      api().audit({ id: r.issue.id, revision: r.issue.revision, to: true }),
    ).rejects.toThrow(/调拨/);
    const old = identity(r);
    r = await transfer().audit({ ...old, to: true });
    expect(r.issue.audited_by).not.toBeNull();
    expect(r.receipt.audited_by).not.toBeNull();
    await expect(transfer().remove({ ...identity(r), confirmed: true })).rejects.toThrow(/已审核/);
    await expect(transfer().audit({ ...old, to: false })).rejects.toThrow(/已被修改/);
    r = await transfer().audit({ ...identity(r), to: false });
    expect(r.issue.audited_by).toBeNull();
    expect(r.receipt.audited_by).toBeNull();
    await transfer().remove({ ...identity(r), confirmed: true });
    expect(await api().documents({})).toEqual([]);
    expect(await stock(sourceWarehouseId)).toBe('10');
    expect(await stock(targetWarehouseId)).toBe('0');
  });
  it('删除需确认，两端任一核算或期间锁定均拒绝且不拆对', async () => {
    const r = await transfer().save(input());
    await expect(transfer().remove({ ...identity(r), confirmed: false })).rejects.toThrow(
      /需要确认/,
    );
    await app.svc.periods.setStatus(202601, 'closed');
    await expect(transfer().save(input('CLOSED'))).rejects.toThrow(/结账/);
    await expect(transfer().remove({ ...identity(r), confirmed: true })).rejects.toThrow(/结账/);
    await app.svc.periods.setStatus(202601, 'open');
    await app.svc.db
      .withTables<TransferTables>()
      .updateTable('inventory_document')
      .set({ calculation_status: 'calculated' })
      .where('id', '=', r.receipt.id)
      .execute();
    await expect(transfer().remove({ ...identity(r), confirmed: true })).rejects.toThrow(/已核算/);
    expect(await transfer().list({})).toHaveLength(1);
    expect(await api().documents({})).toHaveLength(2);
  });
  it('调入数量已被使用时禁止删除，配对及两端完整回滚', async () => {
    const r = await transfer().save(input());
    await api().saveDocument({
      requestKey: randomUUID(),
      number: 'USED',
      warehouseId: targetWarehouseId,
      date: '2026-01-11',
      kind: 'issue',
      category: '其他出库',
      costAccountId: clearingAccountId,
      lines: [{ productCode: 'P1', quantity: '1', unitPrice: '2.55' }],
    });
    await expect(transfer().remove({ ...identity(r), confirmed: true })).rejects.toThrow(
      /已被出库使用/,
    );
    expect(await transfer().list({})).toHaveLength(1);
    expect(await api().documents({})).toHaveLength(3);
    expect(await stock(sourceWarehouseId)).toBe('7');
    expect(await stock(targetWarehouseId)).toBe('2');
  });
  it('仓库停用、未知产品及错误科目在落库前拒绝', async () => {
    await expect(transfer().save({ ...input(), clearingAccountId: 99999 })).rejects.toThrow();
    await expect(
      transfer().save({
        ...input(),
        lines: [{ productCode: 'UNKNOWN', quantity: '1', unitPrice: '1' }],
      }),
    ).rejects.toThrow(/不存在/);
    await api().saveWarehouse({
      id: targetWarehouseId,
      revision: 1,
      code: '02',
      name: '成品仓',
      disabled: true,
    });
    await expect(transfer().save(input())).rejects.toThrow(/停用/);
    expect(await api().documents({})).toEqual([]);
  });
  it('调拨接口按查看、修改、审核和负库存权限校验，失败不写入', async () => {
    const viewer = app.call(
      server,
      await app.addUser('transfer-viewer', { permissions: ['inventory.view'] }),
    );
    expect(await viewer.transfers({})).toEqual([]);
    await expect(viewer.saveTransfer(input())).rejects.toThrow(/权限/);
    await expect(viewer.previewTransfer(input())).rejects.toThrow(/权限/);
    const editor = app.call(
      server,
      await app.addUser('transfer-editor', { permissions: ['inventory.view', 'inventory.edit'] }),
    );
    const v = input('NO-NEGATIVE', '11');
    const preview = await editor.previewTransfer(v);
    await expect(
      editor.saveTransfer({ ...v, negativeConfirmation: preview.confirmation }),
    ).rejects.toThrow(/权限/);
    expect(await transfer().list({})).toEqual([]);
    const r = await editor.saveTransfer(input('EDITOR'));
    await expect(editor.auditTransfer({ ...identity(r), to: true })).rejects.toThrow(/权限/);
    const none = app.call(server, await app.addUser('transfer-none'));
    await expect(none.transfers({})).rejects.toThrow(/权限/);
    await expect(none.transfer({ id: r.id })).rejects.toThrow(/权限/);
  });
  it('两端版本都在审核和删除前复核，第二端陈旧不能使第一端先审核', async () => {
    const r = await transfer().save(input());
    await expect(
      transfer().audit({ ...identity(r), receiptRevision: r.receipt.revision + 1, to: true }),
    ).rejects.toThrow(/已被修改/);
    const refreshed = await transfer().get(r.id);
    expect(refreshed.issue.audited_by).toBeNull();
    expect(refreshed.receipt.audited_by).toBeNull();
    await expect(
      transfer().remove({ ...identity(r), issueRevision: r.issue.revision + 1, confirmed: true }),
    ).rejects.toThrow(/已被修改/);
    expect(await transfer().list({})).toHaveLength(1);
    expect(await api().documents({})).toHaveLength(2);
  });
  it('其他审核人取消调拨需专门权限，失败时两端审核与配对版本不变', async () => {
    const saved = await transfer().save(input());
    const audited = await transfer().audit({ ...identity(saved), to: true });
    const reviewer = app.call(
      server,
      await app.addUser('transfer-reviewer', {
        permissions: ['inventory.view', 'inventory.audit'],
      }),
    );
    await expect(reviewer.auditTransfer({ ...identity(audited), to: false })).rejects.toThrow(
      /权限/,
    );
    const current = await transfer().get(saved.id);
    expect(current.revision).toBe(audited.revision);
    expect(current.issue.audited_by).toBe(audited.issue.audited_by);
    expect(current.receipt.audited_by).toBe(audited.receipt.audited_by);
  });
  it('fast-check：任意六位小数数量在两仓之间守恒，删除成对恢复', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 9_000_000 }), async (value) => {
        const q = String(value / 1_000_000);
        const r = await transfer().save(input(randomUUID(), q));
        expect(e6(await stock(sourceWarehouseId)) + e6(await stock(targetWarehouseId))).toBe(
          10_000_000,
        );
        expect(r.issue.lines[0]!.quantity_e6).toBe(r.receipt.lines[0]!.quantity_e6);
        expect(r.issue.lines[0]!.net_cents).toBe(r.receipt.lines[0]!.net_cents);
        await transfer().remove({ ...identity(r), confirmed: true });
        expect(await stock(sourceWarehouseId)).toBe('10');
        expect(await stock(targetWarehouseId)).toBe('0');
      }),
      { numRuns: 10 },
    );
  });
});

function inputDocument(
  r: Awaited<ReturnType<ReturnType<typeof inventoryTransfer>['get']>>['issue'],
) {
  return {
    id: r.id,
    revision: r.revision,
    requestKey: randomUUID(),
    kind: r.kind,
    warehouseId: r.warehouse_id,
    number: r.number,
    date: r.date,
    category: '其他出库' as const,
    costAccountId: r.cost_account_id,
    accountId: r.account_id,
    taxRate: r.tax_rate,
    lines: r.lines.map((l) => ({
      productCode: l.productCode,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
    })),
  };
}
