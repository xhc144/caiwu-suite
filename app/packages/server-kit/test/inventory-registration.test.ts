import { expect, it } from 'vitest';
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
