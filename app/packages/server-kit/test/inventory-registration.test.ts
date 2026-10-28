import { expect, it } from 'vitest';
import { createTestApp } from '@caiwu/testkit';
import { defineManifest } from '@caiwu/core';
import type { InventoryProviderFactory } from '@caiwu/core/server';
import { ModuleRegistry, defineServerModule, moduleKit } from '../src';

const inventory = defineManifest({ id: 'inventory', name: '库存', products: 'all' });
const other = defineManifest({ id: 'other', name: '其它', products: 'all' });
const provider: InventoryProviderFactory = () => {
  throw new Error('注册时不应绑定或调用工厂');
};

it('登记只保存工厂，各registry独立；未登记不退回全局provider', () => {
  const mod = defineServerModule(inventory, {
    router: moduleKit(inventory).router({}),
    providers: { inventory: provider },
  });
  const a = new ModuleRegistry([mod]);
  const b = new ModuleRegistry([]);
  expect(a.providers.inventory).toBe(provider);
  expect(b.providers.inventory).toBeUndefined();
  expect(Object.isFrozen(a.providers)).toBe(true);
});

it('禁止其它模块冒充库存provider', () => {
  const mod = defineServerModule(other, {
    router: moduleKit(other).router({}),
    providers: { inventory: provider },
  });
  expect(() => new ModuleRegistry([mod])).toThrow(/只有库存模块/);
});

it('库存模块登记的可选发票方法经真实runtime连接原始invoice svc，旧成本with不被调用', async () => {
  const contexts: { moduleId: string | null; transaction: boolean }[] = [];
  const plan = {
    fingerprint: 'f'.repeat(64),
    expiresAt: Date.now() + 60_000,
    stockRevision: 0,
    shortages: [],
  };
  const mod = defineServerModule(inventory, {
    router: moduleKit(inventory).router({}),
    providers: {
      inventory: (svc) => ({
        snapshot: async () => {
          throw new Error('不应读取旧库存快照');
        },
        with: async () => {
          throw new Error('不应进入旧成本with');
        },
        previewInvoiceIssue: async () => {
          contexts.push({ moduleId: svc.moduleId, transaction: svc.db.isTransaction });
          return plan;
        },
        saveInvoiceIssue: async () => {
          contexts.push({ moduleId: svc.moduleId, transaction: svc.db.isTransaction });
          return { id: 1, revision: 1 };
        },
      }),
    },
  });
  const app = await createTestApp({ modules: [mod] });
  try {
    const svc = app.svcFor('invoice');
    const input = {
      invoiceId: 1,
      invoiceRevision: 1,
      requestKey: 'synthetic-register',
      redLetter: false,
      warehouseId: 1,
      date: '2026-01-10',
      number: '合成单号',
      settlementAccountId: 1,
      costAccountId: 2,
      newProducts: [],
      lines: [
        {
          productCode: 'P1',
          quantity: '1',
          unitPrice: '1',
          taxRate: '0',
          netCents: 100,
          taxCents: 0,
          totalCents: 100,
        },
      ],
    };
    expect(await svc.inventory.previewInvoiceIssue(input)).toBe(plan);
    expect(
      await svc.tx((t) =>
        t.inventory.with((i) =>
          i.saveInvoiceIssue({
            input,
            plan,
            newProductsConfirmed: false,
            negativeStockConfirmed: false,
            replacementConfirmed: false,
          }),
        ),
      ),
    ).toEqual({ id: 1, revision: 1 });
    expect(contexts).toEqual([
      { moduleId: 'invoice', transaction: false },
      { moduleId: 'invoice', transaction: true },
    ]);
  } finally {
    await app.close();
  }
});
