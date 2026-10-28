import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import fc from 'fast-check';
import { sql } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import type { DocumentInput } from '../shared';
import type { ReversalInput } from '../reversal';
import type { InventoryTables } from '../server/migrations';
import server from '../server';

let app: TestApp;
let warehouseId: number, cash: number, cost: number;
const caller = () => app.call(server);
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
  warehouseId = await caller().saveWarehouse({ code: '01', name: '反冲测试仓' });
  cash = (await app.svc.accounts.require('1001')).id;
  cost = (await app.svc.accounts.require('6401')).id;
  await caller().saveProduct({ code: 'P1', name: '产品一' });
  await caller().saveOpening({
    warehouseId,
    revision: 0,
    rows: [{ productCode: 'P1', quantity: '10', unitPrice: '2' }],
  });
});
afterEach(async () => {
  await app.close();
});
const document = (
  kind: 'receipt' | 'issue' = 'receipt',
  number = 'R1',
  quantity = '3',
): DocumentInput => ({
  kind,
  number,
  warehouseId,
  date: '2026-01-10',
  requestKey: randomUUID(),
  category: kind === 'receipt' ? '采购' : '销售',
  accountId: cash,
  costAccountId: kind === 'issue' ? cost : null,
  taxRate: '13',
  lines: [
    { productCode: 'P1', quantity, unitPrice: '3.33', priceIncludesTax: true, note: '原说明' },
  ],
});
const reversal = (d: { id: number; revision: number }, number = 'FC1'): ReversalInput => ({
  id: d.id,
  revision: d.revision,
  requestKey: randomUUID(),
  number,
  date: '2026-01-11',
  accountId: cost,
  confirmed: true,
});
const balance = async () => (await caller().stock({ warehouseId, productCode: 'P1' }))[0]!.balance;

it('w_ck_rk/w_cb_ck_copy：入库反冲全头行保留价税口径，原单保留且库存恢复', async () => {
  const d = await caller().saveDocument(document());
  const v = reversal(d);
  const preview = await caller().previewReversal(v);
  expect(preview).toMatchObject({
    kind: 'issue',
    netCents: d.lines[0]!.net_cents,
    taxCents: d.lines[0]!.tax_cents,
    grossCents: 999,
  });
  expect(await balance()).toBe('13');
  const saved = await caller().reverseDocument(v);
  expect(saved).toMatchObject({
    kind: 'issue',
    source_id: d.id,
    category: '其他出库',
    tax_rate: '13',
  });
  expect(saved.lines[0]).toMatchObject({
    quantity: '3',
    unitPrice: '3.33',
    priceIncludesTax: true,
    note: '原说明',
    gross_cents: 999,
  });
  expect(await balance()).toBe('10');
  expect((await caller().document({ id: d.id })).reversal).toMatchObject({
    reversal_document_id: saved.id,
  });
});

it('w_ck_ck：出库反冲逐行确认退回入库单价，不自动把售价作为库存成本', async () => {
  const d = await caller().saveDocument(document('issue', 'S1'));
  await expect(caller().previewReversal(reversal(d))).rejects.toThrow(/逐行确认入库单价/);
  expect(await balance()).toBe('7');
  const r = await caller().reverseDocument({ ...reversal(d), unitPrices: ['2'] });
  expect(r).toMatchObject({ kind: 'receipt', tax_rate: '0', category: '其他入库' });
  expect(r.lines[0]).toMatchObject({ net_cents: 600, tax_cents: 0, quantity: '3' });
  expect(await balance()).toBe('10');
});

it('w_ck_rk：并发重复保存只反冲一次，改内容或再次反冲拒绝', async () => {
  const d = await caller().saveDocument(document());
  const v = reversal(d);
  const [a, b] = await Promise.all([caller().reverseDocument(v), caller().reverseDocument(v)]);
  expect(a.id).toBe(b.id);
  expect(await caller().documents({})).toHaveLength(2);
  await expect(caller().reverseDocument({ ...v, number: 'FC2' })).rejects.toThrow(/不同内容/);
  const source = await caller().document({ id: d.id });
  await expect(caller().reverseDocument(reversal(source, 'FC3'))).rejects.toThrow(/反冲关联/);
  expect(await balance()).toBe('10');
});

it('w_ck_rk1/w_ck_ck1：反冲关联禁止改单及删除原单，删除未审核反冲单后解除', async () => {
  const d = await caller().saveDocument(document());
  const r = await caller().reverseDocument(reversal(d));
  const source = await caller().document({ id: d.id });
  await expect(
    caller().saveDocument({ ...document(), id: source.id, revision: source.revision }),
  ).rejects.toThrow(/反冲关联/);
  await expect(
    caller().removeDocument({ id: source.id, revision: source.revision, confirmed: true }),
  ).rejects.toThrow(/删除原单/);
  await expect(
    caller().saveDocument({ ...document('issue', 'FC1'), id: r.id, revision: r.revision }),
  ).rejects.toThrow(/反冲关联/);
  await caller().removeDocument({ id: r.id, revision: r.revision, confirmed: true });
  expect(await balance()).toBe('13');
  const restored = await caller().document({ id: d.id });
  expect(restored.reversal).toBeUndefined();
  await caller().reverseDocument(reversal(restored, 'FC2'));
  expect(await balance()).toBe('10');
});

it('w_ck_rk：关联写失败回滚新单、数量、版本和日志，保留原单', async () => {
  const d = await caller().saveDocument(document());
  const before = await caller().context();
  const logs = await app.svc.log.list();
  await sql`CREATE TEMP TRIGGER reject_reversal BEFORE INSERT ON inventory_reversal BEGIN SELECT RAISE(ABORT,'反冲写入失败'); END`.execute(
    app.svc.db,
  );
  await expect(caller().reverseDocument(reversal(d))).rejects.toThrow(/反冲写入失败/);
  expect(await caller().documents({})).toHaveLength(1);
  expect(await balance()).toBe('13');
  expect((await caller().context()).control.stock_revision).toBe(before.control.stock_revision);
  expect(await app.svc.log.list()).toEqual(logs);
  expect((await caller().document({ id: d.id })).revision).toBe(d.revision);
});

it('w_ck_rk：反冲日期、来源版本、期间和明确确认都在服务端检查', async () => {
  const d = await caller().saveDocument(document());
  await expect(caller().reverseDocument({ ...reversal(d), confirmed: false })).rejects.toThrow(
    /确认/,
  );
  await expect(caller().reverseDocument({ ...reversal(d), date: '2026-01-01' })).rejects.toThrow(
    /不能早于/,
  );
  await expect(caller().reverseDocument({ ...reversal(d), revision: 99 })).rejects.toThrow(
    /已被修改/,
  );
  await app.svc.periods.setStatus(202601, 'closed');
  await expect(caller().reverseDocument(reversal(d))).rejects.toThrow(/结账/);
  expect(await balance()).toBe('13');
  const r = await caller().reverseDocument({ ...reversal(d), date: '2026-02-10' });
  expect(r.period).toBe(202602);
});

it('w_ck_rk：反冲出库负库存须授权及当前预览确认，陈旧确认无效', async () => {
  const d = await caller().saveDocument(document());
  await caller().saveDocument(document('issue', 'S1', '12'));
  const v = reversal(d);
  const p = await caller().previewReversal(v);
  expect(p.shortages[0]).toMatchObject({ current: '1', requested: '3' });
  await expect(caller().reverseDocument(v)).rejects.toThrow(/尚未确认/);
  await caller().saveProduct({ code: 'P2', name: '变更版本' });
  await expect(
    caller().reverseDocument({ ...v, negativeConfirmation: p.confirmation }),
  ).rejects.toThrow(/版本已变化/);
  const fresh = await caller().previewReversal(v);
  await caller().reverseDocument({ ...v, negativeConfirmation: fresh.confirmation });
  expect(await balance()).toBe('-2');
});

it('w_ck_ck：服务端修改权限不可通过反冲接口绕过', async () => {
  const d = await caller().saveDocument(document());
  const reader = app.call(server, await app.addUser('reader', { permissions: ['inventory.view'] }));
  await expect(reader.reverseDocument(reversal(d))).rejects.toThrow(/权限/);
  await expect(app.call(server, null).reverseDocument(reversal(d))).rejects.toThrow();
  expect(await balance()).toBe('13');
});

it('w_ck_rk/w_ck_ck：任意合法数量的原单与反冲数量守恒', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 5000 }), async (q) => {
      const n = randomUUID();
      const d = await caller().saveDocument(document('receipt', n, String(q)));
      await caller().reverseDocument(reversal(d, `FC-${n}`));
      expect(await balance()).toBe('10');
    }),
    { numRuns: 15 },
  );
  const db = app.svc.db.withTables<InventoryTables>();
  expect(await db.selectFrom('inventory_reversal').selectAll().execute()).toHaveLength(15);
});
