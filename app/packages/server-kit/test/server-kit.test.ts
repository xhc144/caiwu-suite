import type { TRPCError } from '@trpc/server';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineMigrations } from '@caiwu/db';
import { BusinessError, defineManifest } from '@caiwu/core';
import { ModuleRegistry, defineServerModule, moduleKit } from '../src';
import { createTestApp, voucherInputFromSpec, type TestApp } from '@caiwu/testkit';

const manifest = defineManifest({
  id: 'probe',
  name: '探针模块',
  products: 'all',
  permissions: [{ id: 'probe.write', name: '写入' }],
  sources: [{ type: 'doc', name: '探针单据', path: '/docs?id={id}' }],
});
const m = moduleKit(manifest);
const probeRouter = m.router({
  whoami: m.procedure.query(({ ctx }) => ({ moduleId: ctx.moduleId, user: ctx.user.code })),
  count: m.procedure.query(async ({ ctx }) => {
    const db = ctx.svc.db.withTables<{ probe_item: { id: number; name: string } }>();
    return (await db.selectFrom('probe_item').selectAll().execute()).length;
  }),
  add: m.procedure
    .meta({ permission: 'probe.write' })
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = ctx.svc.db.withTables<{ probe_item: { id: number; name: string } }>();
      await db.insertInto('probe_item').values({ id: Date.now(), name: input.name }).execute();
      return { ok: true };
    }),
  makeVoucher: m.procedure.meta({ permission: 'probe.write' }).mutation(async ({ ctx }) => {
    const input = await voucherInputFromSpec(ctx.svc, {
      date: '2026-01-03',
      lines: [
        { account: '1001', debit: 100 },
        { account: '6001', credit: 100 },
      ],
    });
    return ctx.svc.vouchers.create({ ...input, source: { type: 'doc', id: '7' } });
  }),
  fail: m.procedure.query(() => {
    throw new BusinessError({ code: 'PROBE_FAIL', message: '探针故意失败', hint: '别担心' });
  }),
});
const probe = defineServerModule(manifest, {
  router: probeRouter,
  migrations: defineMigrations([
    {
      id: '0001_init',
      sql: 'CREATE TABLE probe_item (id INTEGER PRIMARY KEY, name TEXT NOT NULL)',
    },
  ]),
});

let app: TestApp;
afterEach(async () => app?.close());

async function caught(p: Promise<unknown>) {
  return p.then(
    () => {
      throw new Error('应该失败');
    },
    (e: unknown) => e as TRPCError,
  );
}

describe('模块接口', () => {
  it('ctx 绑定模块身份；模块的表由迁移建好', async () => {
    app = await createTestApp({ modules: [probe] });
    const api = app.call(probe);
    expect(await api.whoami()).toEqual({ moduleId: 'probe', user: 'admin' });
    await api.add({ name: 'a' });
    expect(await api.count()).toBe(1);
    const v = await api.makeVoucher();
    expect(v.source).toEqual({ module: 'probe', type: 'doc', id: '7' });
  });

  it('按 meta.permission 检查权限', async () => {
    app = await createTestApp({ modules: [probe] });
    const clerk = await app.addUser('clerk');
    const err = await caught(app.call(probe, clerk).add({ name: 'x' }));
    expect(err.code).toBe('FORBIDDEN');
    expect(err.message).toBe('你没有「探针模块·写入」权限');
    const writer = await app.addUser('writer', { permissions: ['probe.write'] });
    await expect(app.call(probe, writer).add({ name: 'y' })).resolves.toEqual({ ok: true });
  });

  it('业务错误原样带出，未登录返回 UNAUTHORIZED', async () => {
    app = await createTestApp({ modules: [probe] });
    const err = await caught(app.call(probe).fail());
    expect(err.code).toBe('BAD_REQUEST');
    expect((err.cause as BusinessError).data).toMatchObject({ code: 'PROBE_FAIL', hint: '别担心' });
    const anon = await caught(app.call(probe, null).whoami());
    expect(anon.code).toBe('UNAUTHORIZED');
  });
});

describe('登录', () => {
  it('密码错误', async () => {
    app = await createTestApp();
    const err = await caught(
      app.core(null).auth.login({ bookId: app.book.id, userCode: 'admin', password: 'x' }),
    );
    expect((err.cause as BusinessError).data.code).toBe('LOGIN_FAILED');
  });

  it('me 返回当前用户、账套、当前期间；登出后令牌失效', async () => {
    app = await createTestApp();
    const token = await app.login();
    const me = await app.core(token).auth.me();
    expect(me.user).toMatchObject({ code: 'admin', isAdmin: true });
    expect(me.book.name).toBe('测试账套');
    expect(me.currentPeriod?.period).toBe(202601);
    await app.core(token).auth.logout();
    expect((await caught(app.core(token).auth.me())).code).toBe('UNAUTHORIZED');
  });

  it('核心只读接口', async () => {
    app = await createTestApp();
    const core = app.core();
    expect((await core.accounts.list()).length).toBeGreaterThan(20);
    expect((await core.dimensions.items({ type: 'department' })).map((d) => d.name)).toEqual([
      '行政部',
      '销售部',
    ]);
    expect((await core.books.list()).map((b) => b.name)).toEqual(['测试账套']);
    expect((await core.books.templates()).map((t) => t.id)).toContain('demo-enterprise');
  });
});

describe('模块登记检查', () => {
  const base = { name: 'x', products: 'all' as const };

  it('修改数据的接口必须声明权限', () => {
    const mf = defineManifest({ id: 'bad', ...base });
    const k = moduleKit(mf);
    const mod = defineServerModule(mf, {
      router: k.router({ save: k.procedure.mutation(() => 1) }),
    });
    expect(() => new ModuleRegistry([mod])).toThrow(/必须声明权限/);
  });

  it('权限点必须在 manifest 里声明', () => {
    const mf = defineManifest({ id: 'bad', ...base });
    const k = moduleKit(mf);
    const mod = defineServerModule(mf, {
      router: k.router({ save: k.procedure.meta({ permission: 'bad.x' }).mutation(() => 1) }),
    });
    expect(() => new ModuleRegistry([mod])).toThrow(/没有在 manifest.permissions 里声明/);
  });

  it('表名必须带模块前缀；id 必须和目录名一致；依赖必须存在', () => {
    const mf = defineManifest({ id: 'my-mod', ...base });
    const k = moduleKit(mf);
    const bad = defineServerModule(mf, {
      router: k.router({}),
      migrations: defineMigrations([{ id: '0001_init', sql: 'CREATE TABLE things (id INTEGER)' }]),
    });
    expect(() => new ModuleRegistry([bad])).toThrow(/必须以 "my_mod_" 开头/);
    const ok = defineServerModule(mf, { router: k.router({}) });
    expect(() => new ModuleRegistry([ok], { expectedIds: { 0: 'other' } })).toThrow(
      /必须和目录名一致/,
    );
    const dep = defineManifest({ id: 'needs', ...base, dependsOn: ['missing'] });
    expect(() => new ModuleRegistry([defineServerModule(dep, { router: k.router({}) })])).toThrow(
      /不存在/,
    );
  });
});
