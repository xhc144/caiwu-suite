import { randomUUID } from 'node:crypto';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import { serverModules } from '../../../.generated/server-modules';
import server from '../server';

// 使用真实自动登记的库存服务造前置，不导入其它模块代码，不依赖其它页面。
export const inventoryModule = serverModules.find((m) => m.manifest.id === 'inventory')!;
type Document = { id: number; revision: number; number: string; lines: { id: number }[] };
type InventoryFixtures = {
  saveWarehouse(input: { code: string; name: string }): Promise<number>;
  saveProduct(input: {
    code: string;
    name: string;
    inventoryAccountId: number;
    salesAccountId: number;
    allocationFactor?: string;
    unit?: string;
  }): Promise<number>;
  saveOpening(input: {
    warehouseId: number;
    revision: number;
    rows: { productCode: string; quantity: string; unitPrice: string }[];
  }): Promise<unknown>;
  saveDocument(input: {
    requestKey: string;
    kind: 'receipt' | 'issue';
    warehouseId: number;
    number: string;
    date: string;
    category: '采购' | '销售' | '领用';
    accountId: number;
    costAccountId: number;
    taxRate: string;
    lines: { productCode: string; quantity: string; unitPrice: string }[];
  }): Promise<Document>;
  generateCount(input: {
    warehouseId: number;
    period: number;
    revision: number;
    confirmed: boolean;
  }): Promise<{ revision: number }>;
  saveCount(input: {
    warehouseId: number;
    period: number;
    revision: number;
    rows: { productCode: string; actual: string }[];
  }): Promise<unknown>;
};
export async function setup() {
  const app = await createTestApp({ modules: [inventoryModule, server], product: 'chengben' });
  const inventory = app.call(inventoryModule) as unknown as InventoryFixtures;
  const warehouseId = await inventory.saveWarehouse({ code: '01', name: '一仓' });
  const ids = {
    cash: (await app.svc.accounts.require('1001')).id,
    stock: (await app.svc.accounts.require('1405')).id,
    sales: (await app.svc.accounts.require('6001')).id,
    cost: (await app.svc.accounts.require('6401')).id,
    inputTax: (await app.svc.accounts.require('22210101')).id,
    outputTax: (await app.svc.accounts.require('22210102')).id,
  };
  await inventory.saveProduct({
    code: 'P1',
    name: '试算产品',
    inventoryAccountId: ids.stock,
    salesAccountId: ids.sales,
  });
  const opening = (quantity = '10', unitPrice = '1') =>
    inventory.saveOpening({
      warehouseId,
      revision: 0,
      rows: [{ productCode: 'P1', quantity, unitPrice }],
    });
  const document = (
    kind: 'receipt' | 'issue',
    quantity: string,
    unitPrice: string,
    options: {
      date?: string;
      category?: '采购' | '销售' | '领用';
      warehouseId?: number;
      taxRate?: string;
    } = {},
  ) =>
    inventory.saveDocument({
      requestKey: randomUUID(),
      kind,
      warehouseId: options.warehouseId ?? warehouseId,
      number: randomUUID(),
      date: options.date ?? '2026-01-10',
      category: options.category ?? (kind === 'receipt' ? '采购' : '销售'),
      accountId: ids.cash,
      costAccountId: ids.cost,
      taxRate: options.taxRate ?? '0',
      lines: [{ productCode: 'P1', quantity, unitPrice }],
    });
  return { app, inventory, api: app.call(server), warehouseId, ids, opening, document };
}
export function caller(app: TestApp, token?: string) {
  return app.call(server, token);
}
