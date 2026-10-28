import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { sql } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';
import type { InventoryTables } from '../server/migrations';
let app: TestApp;
const caller = (a: TestApp) => a.call(server);
let api: ReturnType<typeof caller>, warehouseId: number, cash: number;
beforeEach(async () => {
  app = await createTestApp({ modules: [server], product: 'chengben' });
  api = caller(app);
  warehouseId = await api.saveWarehouse({ code: '01', name: '盘点仓' });
  await api.saveProduct({ code: 'P1', name: '原有产品' });
  cash = (await app.svc.accounts.require('1001')).id;
  await api.saveOpening({
    warehouseId,
    revision: 0,
    rows: [{ productCode: 'P1', quantity: '10', unitPrice: '2' }],
  });
});
afterEach(async () => app.close());
it('w_cb_pdk_1：增删产品仅调整明确集合，保留行原快照和实盘，新增按当前月末来源取值', async () => {
  const key = { warehouseId, period: 202601 },
    generated = await api.generateCount({ ...key, revision: 0, confirmed: false });
  const saved = await api.saveCount({
    ...key,
    revision: generated.revision,
    rows: [{ productCode: 'P1', actual: '9' }],
  });
  await api.saveProduct({ code: 'P2', name: '新增产品' });
  await api.saveDocument({
    requestKey: randomUUID(),
    warehouseId,
    kind: 'receipt',
    number: 'R1',
    date: '2026-01-10',
    category: '采购',
    accountId: cash,
    lines: [
      { productCode: 'P1', quantity: '2', unitPrice: '2' },
      { productCode: 'P2', quantity: '5', unitPrice: '3' },
    ],
  });
  const changed = await api.replaceCountProducts({
    ...key,
    revision: saved.revision,
    productCodes: ['P1', 'P2'],
    confirmed: true,
  });
  expect(changed.rows[0]).toMatchObject({
    productCode: 'P1',
    book: '10',
    actual: '9',
    bookCents: 2000,
  });
  expect(changed.rows[1]).toMatchObject({
    productCode: 'P2',
    book: '5',
    actual: '5',
    bookCents: 1500,
  });
  const removed = await api.replaceCountProducts({
    ...key,
    revision: changed.revision,
    productCodes: ['P2'],
    confirmed: true,
  });
  expect(removed.rows.map((r) => r.productCode)).toEqual(['P2']);
  const restored = await api.replaceCountProducts({
    ...key,
    revision: removed.revision,
    productCodes: ['P1', 'P2'],
    confirmed: true,
  });
  expect(restored.rows[0]).toMatchObject({
    productCode: 'P1',
    book: '12',
    actual: '12',
    bookCents: 2400,
  });
  expect((await api.stock({ warehouseId })).find((r) => r.productCode === 'P1')?.balance).toBe(
    '12',
  );
});
it('w_cb_pdk_1：确认、版本、重复、未知、停用和正式核算保护；中途写入故障整批回滚', async () => {
  const key = { warehouseId, period: 202601 },
    generated = await api.generateCount({ ...key, revision: 0, confirmed: false });
  await api.saveProduct({ code: 'P2', name: '新产品' });
  await api.saveProduct({ code: 'P3', name: '停用产品', disabled: true });
  const payload = { ...key, revision: generated.revision, productCodes: ['P2'], confirmed: true };
  await expect(api.replaceCountProducts({ ...payload, confirmed: false })).rejects.toThrow(/确认/);
  await expect(api.replaceCountProducts({ ...payload, revision: 0 })).rejects.toThrow(/版本|修改/);
  await expect(
    api.replaceCountProducts({ ...payload, productCodes: ['P2', 'P2'] }),
  ).rejects.toThrow(/重复/);
  await expect(api.replaceCountProducts({ ...payload, productCodes: ['UNKNOWN'] })).rejects.toThrow(
    /产品 UNKNOWN 不存在/,
  );
  await expect(api.replaceCountProducts({ ...payload, productCodes: ['P3'] })).rejects.toThrow(
    /停用/,
  );
  await sql
    .raw(
      "CREATE TEMP TRIGGER inventory_count_products_fail BEFORE INSERT ON inventory_count_line BEGIN SELECT RAISE(ABORT,'盘点写入故障'); END",
    )
    .execute(app.svc.db);
  await expect(api.replaceCountProducts(payload)).rejects.toThrow(/盘点写入故障/);
  expect(await api.count(key)).toEqual(generated);
  await sql.raw('DROP TRIGGER inventory_count_products_fail').execute(app.svc.db);
  await app.svc.db
    .withTables<InventoryTables>()
    .updateTable('inventory_count')
    .set({ calculation_status: 'calculated', calculation_batch: '合成测试批次' })
    .where('id', '=', generated.id!)
    .execute();
  await expect(api.replaceCountProducts(payload)).rejects.toThrow(/已核算/);
});
