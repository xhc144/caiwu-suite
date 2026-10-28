import { afterEach, expect, it } from 'vitest';
import { defineManifest } from '@caiwu/core';
import { defineMigrations } from '@caiwu/db';
import type { CoreServiceProviders } from '@caiwu/core/server';
import { defineServerModule, moduleKit } from '@caiwu/server-kit';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import { withSharedDependencies } from '../src/shared-dependencies';

const manifest = defineManifest({ id: 'fixed-assets', name: '合成资产依赖', products: 'all' });
type Provider = NonNullable<CoreServiceProviders['periodDependencies']>[number];
type Tables = {
  fixed_assets_batch: { id: number; period: number; voucher_id: number | null };
  fixed_assets_line: { id: number; batch_id: number; amount: number };
};
const assetPeriodDependencies: Provider = async (ctx, input) => {
  if (input.mode !== 'year-close') return [];
  const rows = await ctx.db
    .withTables<Tables>()
    .selectFrom('fixed_assets_batch as b')
    .innerJoin('fixed_assets_line as l', 'l.batch_id', 'b.id')
    .select('b.id')
    .distinct()
    .where('b.period', '=', input.period)
    .where('b.voucher_id', 'is', null)
    .where('l.amount', '!=', 0)
    .execute();
  return [{ category: '未制证折旧批次', count: rows.length, to: '/m/fixed-assets/depreciation' }];
};
let app: TestApp;
afterEach(async () => app?.close());
async function fixture(declared?: readonly Provider[]) {
  const module = defineServerModule(manifest, {
    router: moduleKit(manifest).router({}),
    migrations: defineMigrations([
      {
        id: '0001_synthetic_asset',
        sql: 'CREATE TABLE fixed_assets_batch(id INTEGER PRIMARY KEY,period INTEGER NOT NULL,voucher_id INTEGER); CREATE TABLE fixed_assets_line(id INTEGER PRIMARY KEY,batch_id INTEGER NOT NULL REFERENCES fixed_assets_batch(id),amount INTEGER NOT NULL)',
      },
    ]),
    providers: declared === undefined ? undefined : { periodDependencies: declared },
  });
  const wrapped = withSharedDependencies(module);
  app = await createTestApp({ modules: [wrapped] });
  return { module, wrapped, raw: app.runtime.bookStore.open(app.book.id).raw };
}
const guard = { period: 202601, mode: 'year-close' as const, action: '年结' };

it('w_zjgl：有模块声明时零折旧批次不阻断，其他期间非零批次也不误挡当前期间', async () => {
  const declared = [assetPeriodDependencies];
  const f = await fixture(declared);
  expect(f.wrapped.providers!.periodDependencies).toBe(declared);
  expect(f.module.providers!.periodDependencies).toBe(declared);
  f.raw.exec(
    'INSERT INTO fixed_assets_batch VALUES(1,202601,NULL),(2,202602,NULL); INSERT INTO fixed_assets_line VALUES(1,1,0),(2,2,100)',
  );
  expect(await app.svc.periods.dependencies(guard)).toEqual([]);
  await expect(app.svc.periods.assertWritable(guard)).resolves.toMatchObject({ period: 202601 });
  expect(f.raw.prepare('SELECT voucher_id FROM fixed_assets_batch WHERE id=1').get()).toEqual({
    voucher_id: null,
  });
});

it('w_zjgl：模块声明的目标期间非零未制证批次仍阻断，同批多行只报告一次且无宿主重复项', async () => {
  const f = await fixture([assetPeriodDependencies]);
  f.raw.exec(
    'INSERT INTO fixed_assets_batch VALUES(1,202601,NULL); INSERT INTO fixed_assets_line VALUES(1,1,100),(2,1,-100),(3,1,0)',
  );
  expect(await app.svc.periods.dependencies(guard)).toEqual([
    { category: '未制证折旧批次', count: 1, to: '/m/fixed-assets/depreciation' },
  ]);
  await expect(app.svc.periods.assertWritable(guard)).rejects.toMatchObject({
    data: { code: 'PERIOD_DEPENDENCIES' },
  });
  f.raw.exec('UPDATE fixed_assets_batch SET voucher_id=9 WHERE id=1');
  expect(await app.svc.periods.dependencies(guard)).toEqual([]);
});

it('w_zjgl：未声明provider时仍使用旧fallback，保留既有voucher_id判定语义', async () => {
  const f = await fixture();
  expect(f.wrapped.providers!.periodDependencies).toHaveLength(1);
  f.raw.exec(
    'INSERT INTO fixed_assets_batch VALUES(1,202601,NULL); INSERT INTO fixed_assets_line VALUES(1,1,0)',
  );
  expect(await app.svc.periods.dependencies(guard)).toEqual([
    { category: '未制证折旧批次', count: 1, to: '/m/fixed-assets/depreciation' },
  ]);
  await expect(app.svc.periods.assertWritable(guard)).rejects.toMatchObject({
    data: { code: 'PERIOD_DEPENDENCIES' },
  });
  f.raw.exec('UPDATE fixed_assets_batch SET voucher_id=9 WHERE id=1');
  expect(await app.svc.periods.dependencies(guard)).toEqual([]);
});

it('w_zjgl：显式空声明同样优先，宿主不擅自追加fallback', async () => {
  const declared: Provider[] = [];
  const f = await fixture(declared);
  f.raw.exec(
    'INSERT INTO fixed_assets_batch VALUES(1,202601,NULL); INSERT INTO fixed_assets_line VALUES(1,1,100)',
  );
  expect(f.wrapped.providers!.periodDependencies).toBe(declared);
  expect(await app.svc.periods.dependencies(guard)).toEqual([]);
});

it('w_zjgl：模块多项期间依赖按原声明保留，不影响其他provider挂接', async () => {
  const additional: Provider = async () => [{ category: '合成资产其他阻止项', count: 2 }];
  const declared = [assetPeriodDependencies, additional];
  const f = await fixture(declared);
  expect(f.wrapped.providers!.periodDependencies).toBe(declared);
  expect(f.wrapped.providers!.dimensionReferences).toHaveLength(1);
  expect(await app.svc.periods.dependencies(guard)).toEqual([
    { category: '合成资产其他阻止项', count: 2 },
  ]);
});
