import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';

let app: TestApp;
const caller = (a: TestApp) => a.call(server);
let api: ReturnType<typeof caller>, warehouseId: number, cash: number, cost: number;
beforeEach(async () => {
  app = await createTestApp({ modules: [server], product: 'chengben' });
  api = caller(app);
  warehouseId = await api.saveWarehouse({ code: '01', name: '合成报表仓' });
  for (const code of ['P1', 'P2', 'P3']) await api.saveProduct({ code, name: `产品${code}` });
  cash = (await app.svc.accounts.require('1001')).id;
  cost = (await app.svc.accounts.require('6401')).id;
});
afterEach(async () => app.close());
it('w_cb_tyzs：文本、科目批量设置按明确集合原子保存，使用后存货科目保护及零系数确认保留', async () => {
  const products = await api.products({});
  const selected = products.slice(0, 2).map((p) => ({ id: p.id, revision: p.revision }));
  const preview = await api.bulk({
    products: selected,
    field: 'specification',
    value: '批改规格',
    confirmed: false,
  });
  expect(preview.map((c) => c.after.specification)).toEqual(['批改规格', '批改规格']);
  expect((await api.products({}))[0]?.specification).toBe('');
  await api.bulk({
    products: selected,
    field: 'specification',
    value: '批改规格',
    confirmed: true,
  });
  expect((await api.products({})).map((p) => p.specification)).toEqual([
    '批改规格',
    '批改规格',
    '',
  ]);
  const p = (await api.products({}))[0]!;
  await api.bulk({
    products: [{ id: p.id, revision: p.revision }],
    field: 'inventoryAccountCode',
    value: '1001',
    confirmed: true,
  });
  await api.saveOpening({
    warehouseId,
    revision: 0,
    rows: [{ productCode: 'P1', quantity: '1', unitPrice: '1' }],
  });
  const fresh = (await api.products({}))[0]!;
  await expect(
    api.bulk({
      products: [{ id: fresh.id, revision: fresh.revision }],
      field: 'inventoryAccountCode',
      value: '6401',
      confirmed: true,
    }),
  ).rejects.toThrow(/存货科目/);
  await expect(
    api.bulk({
      products: [{ id: fresh.id, revision: fresh.revision }],
      field: 'allocationFactor',
      value: '0',
      confirmed: true,
    }),
  ).rejects.toThrow(/为零/);
  const zero = await api.bulk({
    products: [{ id: fresh.id, revision: fresh.revision }],
    field: 'allocationFactor',
    value: '0',
    confirmZeroFactor: true,
    confirmed: true,
  });
  expect(zero[0]?.after.allocationFactor).toBe('1');
  expect((await api.products({}))[0]?.allocationFactor).toBe('1');
  await expect(
    api.bulk({
      products: [selected[0]!, selected[0]!],
      field: 'unit',
      value: '箱',
      confirmed: false,
    }),
  ).rejects.toThrow(/重复产品/);
});
it('w_cb_tzxx：精度只保存显示偏好，不舍入原始数量和单价，默认税率范围及权限验证', async () => {
  expect((await api.context()).settings).toMatchObject({
    quantityDigits: 6,
    priceDigits: 6,
    ordinaryTaxRate: '0',
    specialTaxRate: '0',
  });
  await api.saveSettings({
    numberRule: 'daily',
    autoRefresh: true,
    quantityDigits: 2,
    priceDigits: 3,
    ordinaryTaxRate: '3',
    specialTaxRate: '13',
  });
  const r = await api.saveDocument({
    requestKey: randomUUID(),
    kind: 'receipt',
    warehouseId,
    number: 'R1',
    date: '2026-01-10',
    category: '采购',
    accountId: cash,
    invoiceKind: 'special',
    taxRate: '13',
    lines: [{ productCode: 'P1', quantity: '1.234567', unitPrice: '3.123456' }],
  });
  expect(r).toMatchObject({ invoice_kind: 'special', tax_rate: '13' });
  expect(r.lines[0]).toMatchObject({ quantity: '1.234567', unitPrice: '3.123456' });
  const prefs = (await api.context()).settings;
  expect(prefs).toMatchObject({
    quantityDigits: 2,
    priceDigits: 3,
    ordinaryTaxRate: '3',
    specialTaxRate: '13',
  });
  await expect(api.saveSettings({ ...prefs, specialTaxRate: '100.000001' })).rejects.toThrow(
    /税率/,
  );
  await expect(api.saveSettings({ ...prefs, quantityDigits: 7 })).rejects.toThrow();
  const viewer = app.call(server, await app.addUser('viewer', { permissions: ['inventory.view'] }));
  await expect(viewer.saveSettings(prefs)).rejects.toThrow(/权限/);
  expect((await api.document({ id: r.id })).lines[0]?.quantity).toBe('1.234567');
});
it('w_ck_kc/w_ck_kc_hz/w_cb_hzsj_rk：产品范围两端包含、错序拒绝、隐藏期末零量包含有发生项', async () => {
  const receipt = {
    requestKey: randomUUID(),
    kind: 'receipt' as const,
    warehouseId,
    number: 'R1',
    date: '2026-01-10',
    category: '采购' as const,
    accountId: cash,
    lines: [
      { productCode: 'P1', quantity: '2', unitPrice: '3' },
      { productCode: 'P2', quantity: '1', unitPrice: '4' },
    ],
  };
  await api.saveDocument(receipt);
  await api.saveDocument({
    ...receipt,
    requestKey: randomUUID(),
    kind: 'issue',
    number: 'S1',
    category: '销售',
    costAccountId: cost,
    lines: [{ productCode: 'P1', quantity: '2', unitPrice: '5' }],
  });
  const rows = await api.stock({ warehouseId, productFrom: 'P1', productTo: 'P2' });
  expect(rows.map((r) => r.productCode)).toEqual(['P1', 'P2']);
  expect((await api.stock({ warehouseId, hideZero: true })).map((r) => r.productCode)).toEqual([
    'P2',
  ]);
  expect(
    (await api.documents({ productFrom: 'P2', productTo: 'P3' })).map((r) => r.number),
  ).toEqual(['R1']);
  expect(await api.sales({ productFrom: 'P2', productTo: 'P3' })).toEqual([]);
  expect(
    (
      await api.summary({
        filter: { kind: 'receipt', productFrom: 'P2', productTo: 'P2' },
        group: 'product',
        detail: false,
        valuation: 'document',
      })
    )[0],
  ).toMatchObject({ quantity: '1', amountCents: 400 });
  await expect(api.stock({ productFrom: 'P3', productTo: 'P1' })).rejects.toThrow(/截止产品/);
  expect(
    (
      await api.ledgers({
        filter: { warehouseId, productFrom: 'P1', productTo: 'P3' },
        hideInactive: false,
      })
    ).map((b) => b.productCode),
  ).toEqual(['P1', 'P2', 'P3']);
  expect(
    (
      await api.ledgers({
        filter: { warehouseId, productFrom: 'P1', productTo: 'P3' },
        hideInactive: true,
      })
    ).map((b) => b.productCode),
  ).toEqual(['P1', 'P2']);
});
