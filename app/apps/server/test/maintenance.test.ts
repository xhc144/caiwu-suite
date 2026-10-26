import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setImmediate } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BusinessError, defineManifest } from '@caiwu/core';
import { authenticateUser } from '@caiwu/core/server';
import { createRuntime, defineServerModule, moduleKit, type RuntimeHooks } from '@caiwu/server-kit';
import { createServer, type CaiwuServer } from '../src';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const dirs: string[] = [];
const servers: CaiwuServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    await s.runtime.lifecycle.stop();
    await s.fastify.close();
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const mf = defineManifest({
  id: 'maintenance-probe',
  name: '维护探针',
  products: 'all',
  permissions: [
    { id: 'maintenance-probe.write', name: '写入' },
    { id: 'maintenance-probe.maintain', name: '维护' },
  ],
});
const kit = moduleKit(mf);
const headers = { host: '127.0.0.1', 'x-caiwu-token': 'test-startup-token' };
const input = {
  name: '并发测试',
  orgName: '合成单位',
  templateId: 'demo-enterprise',
  product: 'qingsong',
  startYear: 2026,
  startMonth: 1,
  adminPassword: 'test-password',
};

async function fixture(hooks?: RuntimeHooks, timeoutMs?: number) {
  const entered = deferred(),
    begin = deferred(),
    transaction = deferred(),
    release = deferred();
  const targetEntered = deferred(),
    targetRelease = deferred();
  const backgroundRelease = deferred();
  let backgroundTask!: Promise<void>;
  let count = 0,
    callbacks = 0;
  const mod = defineServerModule(mf, {
    lifecycle: hooks,
    router: kit.router({
      background: kit.procedure
        .meta({ permission: 'maintenance-probe.write' })
        .mutation(({ ctx }) => {
          // 与后台备份相同：响应先返回，整个作业须在请求结束前取得独立租约。
          backgroundTask = ctx.app.bookStore.withBook(ctx.book.id, async () => {
            await backgroundRelease.promise;
            await ctx.svc.settings.set('background', 'done');
          });
          return { ok: true };
        }),
      target: kit.procedure
        .meta({ permission: 'maintenance-probe.write' })
        .input(z.object({ bookId: z.string() }))
        .mutation(async ({ ctx, input }) => {
          const target = ctx.app.bookStore.open(input.bookId);
          targetEntered.resolve();
          await targetRelease.promise;
          target.raw.prepare('UPDATE book_info SET name = ?').run('跨账套晚提交');
          return { ok: true };
        }),
      write: kit.procedure
        .meta({ permission: 'maintenance-probe.write' })
        .input(z.object({ key: z.string() }))
        .mutation(async ({ ctx, input }) => {
          if (++count === 2) entered.resolve();
          await begin.promise;
          await ctx.svc.tx(async (svc) => {
            await svc.settings.set(input.key, input.key);
            if (input.key === 'first') {
              transaction.resolve();
              await release.promise;
            }
          });
          return { ok: true };
        }),
      maintain: kit.procedure
        .meta({ permission: 'maintenance-probe.maintain' })
        .input(
          z.object({
            password: z.string(),
            fail: z.boolean().default(false),
            kind: z.enum(['reconnect', 'delete', 'replace']).default('reconnect'),
          }),
        )
        .mutation(({ ctx, input }) =>
          ctx.app.lifecycle.maintainBook({
            token: ctx.session.token,
            bookId: ctx.book.id,
            permission: 'maintenance-probe.maintain',
            authorize: async (svc) => {
              if (!(await authenticateUser(svc.db, svc.user.code, input.password)))
                throw new BusinessError({ code: 'CONFIRM_FAILED', message: '密码复核失败' });
            },
            plan: {
              kind: input.kind,
              prepare: async () => {
                callbacks++;
                if (input.fail)
                  throw new BusinessError({ code: 'PREPARE_FAILED', message: '备份失败' });
                return '已重连';
              },
            },
          }),
        ),
    }),
  });
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-maintenance-http-'));
  dirs.push(dataDir);
  const s = await createServer({
    dataDir,
    token: 'test-startup-token',
    modules: [mod],
    devMode: true,
    lifecycleTimeoutMs: timeoutMs,
  });
  servers.push(s);
  const post = (method: string, payload: unknown, token?: string) =>
    s.fastify.inject({
      method: 'POST',
      url: `/trpc/${method}`,
      headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      payload,
    });
  const created = await post('core.books.create', input);
  expect(created.statusCode).toBe(200);
  const bookId = created.json().result.data.id as string;
  const login = async () =>
    (await post('core.auth.login', { bookId, userCode: 'admin', password: 'test-password' })).json()
      .result.data.token as string;
  const token = await login();
  const me = (auth = token) =>
    s.fastify.inject({
      url: '/trpc/core.auth.me',
      headers: { ...headers, authorization: `Bearer ${auth}` },
    });
  return {
    s,
    dataDir,
    bookId,
    token,
    login,
    post,
    me,
    entered,
    begin,
    transaction,
    release,
    targetEntered,
    targetRelease,
    backgroundRelease,
    background: () => backgroundTask,
    callbacks: () => callbacks,
  };
}

describe('真实 HTTP 请求维护门', () => {
  it('后台作业显式持有 withBook 租约，HTTP 返回后仍可完成；维护等待作业最终写入', async () => {
    const f = await fixture();
    expect((await f.post('m.maintenance-probe.background', {}, f.token)).statusCode).toBe(200);
    let prepared = false;
    const maintaining = f.s.runtime.bookStore.maintain(f.bookId, {
      kind: 'reconnect',
      prepare: async () => {
        prepared = true;
      },
    });
    try {
      expect(prepared).toBe(false);
      expect((await f.me()).json().error.data.business.code).toBe('BOOK_MAINTENANCE');
    } finally {
      f.backgroundRelease.resolve();
      await Promise.all([f.background(), maintaining]);
    }
    expect(prepared).toBe(true);
    const book = f.s.runtime.bookStore.open(f.bookId);
    expect(
      book.raw
        .prepare(
          "SELECT value FROM book_setting WHERE scope='maintenance-probe' AND key='background'",
        )
        .get(),
    ).toEqual({ value: '"done"' });
  });

  it('请求额外 open 的另一账套也排空，包含 await 后的原生写入', async () => {
    const f = await fixture();
    const other = (await f.post('core.books.create', { ...input, name: '另一账套' })).json().result
      .data.id as string;
    const writing = f.post('m.maintenance-probe.target', { bookId: other }, f.token).then((r) => r);
    await f.targetEntered.promise;
    let name: unknown;
    const maintaining = f.s.runtime.bookStore.maintain(other, {
      kind: 'reconnect',
      prepare: async (book) => {
        name = book.raw.prepare('SELECT name FROM book_info').get();
      },
    });
    expect(name).toBeUndefined();
    expect(() => f.s.runtime.bookStore.open(other)).toThrow(/正在维护/);
    f.targetRelease.resolve();
    expect((await writing).statusCode).toBe(200);
    await maintaining;
    expect(name).toEqual({ name: '跨账套晚提交' });
    expect((await f.me()).statusCode).toBe(200);
  });
  it('两个并发写请求排空，关门后新请求/登录均拒绝；最终在线快照含全部提交', async () => {
    const f = await fixture();
    const first = f.post('m.maintenance-probe.write', { key: 'first' }, f.token).then((r) => r);
    const second = f.post('m.maintenance-probe.write', { key: 'second' }, f.token).then((r) => r);
    await f.entered.promise;
    f.begin.resolve();
    await f.transaction.promise;
    let snapshots = 0;
    const snapshot = path.join(f.dataDir, 'final.sqlite');
    const maintain = f.s.runtime.bookStore.maintain(f.bookId, {
      kind: 'reconnect',
      prepare: async (b) => {
        snapshots++;
        await b.raw.backup(snapshot);
      },
    });
    expect(snapshots).toBe(0);
    expect((await f.me()).json().error.data.business.code).toBe('BOOK_MAINTENANCE');
    const denied = await f.post('core.auth.login', {
      bookId: f.bookId,
      userCode: 'admin',
      password: 'test-password',
    });
    expect(denied.json().error.data.business.code).toBe('BOOK_MAINTENANCE');
    f.release.resolve();
    expect((await first).statusCode).toBe(200);
    expect((await second).statusCode).toBe(200);
    await maintain;
    expect(snapshots).toBe(1);
    const raw = new Database(snapshot, { readonly: true });
    try {
      expect(
        raw
          .prepare("SELECT key FROM book_setting WHERE scope='maintenance-probe' ORDER BY key")
          .all(),
      ).toEqual([{ key: 'first' }, { key: 'second' }]);
    } finally {
      raw.close();
    }
  });

  it('维护沿用认证与权限，复核失败不撤销会话；成功及执行失败均重新登录', async () => {
    const f = await fixture();
    const method = 'm.maintenance-probe.maintain';
    expect((await f.post(method, { password: 'test-password' })).statusCode).toBe(401);
    const wrong = await f.post(method, { password: 'wrong' }, f.token);
    expect(wrong.json().error.data.business.code).toBe('CONFIRM_FAILED');
    expect((await f.me()).statusCode).toBe(200);
    expect(f.callbacks()).toBe(0);
    const blocked = await f.post(method, { password: 'test-password', kind: 'delete' }, f.token);
    expect(blocked.json().error.data.business.code).toBe('DESTRUCTIVE_MAINTENANCE_UNAVAILABLE');
    expect((await f.me()).statusCode).toBe(200);
    expect(f.callbacks()).toBe(0);
    expect(
      (await f.post(method, { password: 'test-password', fail: true }, f.token)).json().error.data
        .business.code,
    ).toBe('PREPARE_FAILED');
    expect((await f.me()).statusCode).toBe(401);
    const renewed = await f.login();
    expect((await f.me(renewed)).json().result.data.book.name).toBe('并发测试');
    expect((await f.post(method, { password: 'test-password' }, renewed)).statusCode).toBe(200);
    expect((await f.me(renewed)).statusCode).toBe(401);
    expect((await f.me(await f.login())).statusCode).toBe(200);
  });

  it('共享维护 helper 自身验证权限，不能靠直接调用绕过模块权限', async () => {
    const f = await fixture();
    const admin = (await authenticateUser(
      f.s.runtime.bookStore.open(f.bookId).db,
      'admin',
      'test-password',
    ))!;
    const { createCoreServices } = await import('@caiwu/core/server');
    const svc = createCoreServices({
      db: f.s.runtime.bookStore.open(f.bookId).db,
      user: admin,
      moduleId: null,
      now: f.s.runtime.now,
      modules: f.s.runtime.modules.lookup,
    });
    const clerk = await svc.users.create({
      code: 'clerk',
      name: '无权用户',
      password: '',
      isAdmin: false,
    });
    const token = f.s.runtime.sessions.create(f.bookId, clerk.id).token;
    await expect(
      f.s.runtime.lifecycle.maintainBook({
        token,
        bookId: f.bookId,
        permission: 'maintenance-probe.maintain',
        authorize: async () => {},
        plan: { kind: 'reconnect' },
      }),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    expect((await f.me()).statusCode).toBe(200);
  });
});

describe('可等待的运行时 hook', () => {
  it('start 失败清理已进入的模块后才释放目录；不返回可用 server', async () => {
    const order: string[] = [];
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-start-fail-'));
    dirs.push(dataDir);
    const mod = defineServerModule(mf, {
      router: kit.router({}),
      lifecycle: {
        start: async () => {
          order.push('start');
          throw new Error('启动备份失败');
        },
        stop: async () => {
          order.push('stop');
        },
      },
    });
    await expect(createServer({ dataDir, token: 'start-test', modules: [mod] })).rejects.toThrow(
      '启动备份失败',
    );
    expect(order).toEqual(['start', 'stop']);
    const next = await createServer({ dataDir, token: 'start-test', modules: [] });
    servers.push(next);
    expect(next.runtime.lifecycle.state).toBe('ready');
  });

  it('start hook 超时不进入 ready，不提前释放目录；任务真实结束后可清理', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-start-timeout-'));
    dirs.push(dataDir);
    const finish = deferred();
    const mod = defineServerModule(mf, {
      router: kit.router({}),
      lifecycle: { start: async () => finish.promise },
    });
    const runtime = createRuntime({ dataDir, modules: [mod], lifecycleTimeoutMs: 20 });
    await expect(runtime.lifecycle.start()).rejects.toMatchObject({
      data: { code: 'LIFECYCLE_TIMEOUT' },
    });
    expect(runtime.lifecycle.state).toBe('failed');
    await expect(createServer({ dataDir, token: 'start-test', modules: [] })).rejects.toMatchObject(
      { data: { code: 'DATA_DIR_IN_USE' } },
    );
    finish.resolve();
    await setImmediate();
    expect(runtime.lifecycle.state).toBe('failed');
    await runtime.lifecycle.stop();
  });

  it('startup 完成后才可服务，stop 和 beforeBookClose 真正等待并保留目录占用', async () => {
    const order: string[] = [],
      stopping = deferred(),
      finish = deferred();
    const f = await fixture({
      start: async ({ app }) => {
        order.push('start');
        expect(app.lifecycle.state).toBe('starting');
      },
      stop: async ({ app }) => {
        order.push('stop');
        stopping.resolve();
        await finish.promise;
        await app.lifecycle.withSystemBook(
          mf.id,
          (await app.bookStore.list())[0]!.id,
          async (svc) => {
            await svc.settings.set('exit', 'waited');
          },
        );
      },
      beforeBookClose: async ({ book }) => {
        order.push('beforeClose');
        expect(book.raw.open).toBe(true);
      },
    });
    const stop = f.s.runtime.lifecycle.stop();
    await stopping.promise;
    expect(f.s.runtime.bookStore.open(f.bookId).raw.open).toBe(true);
    expect((await f.me()).json().error.data.business.code).toBe('RUNTIME_UNAVAILABLE');
    finish.resolve();
    await stop;
    expect(order).toEqual(['start', 'stop', 'beforeClose']);
    expect(f.s.runtime.lifecycle.state).toBe('stopped');
    const raw = new Database(path.join(f.dataDir, 'books', `${f.bookId}.caiwu`), {
      readonly: true,
    });
    try {
      expect(
        raw
          .prepare("SELECT value FROM book_setting WHERE scope='maintenance-probe' AND key='exit'")
          .get(),
      ).toEqual({ value: '"waited"' });
    } finally {
      raw.close();
    }
  });

  it('stop hook 失败不关闭连接、不释放目录；明确重试后才成功', async () => {
    let fail = true;
    const f = await fixture({
      stop: async () => {
        if (fail) throw new Error('退出备份失败');
      },
    });
    await expect(f.s.runtime.lifecycle.stop()).rejects.toThrow('退出备份失败');
    expect(f.s.runtime.lifecycle.state).toBe('failed');
    expect((await f.s.fastify.inject({ url: '/healthz', headers })).statusCode).toBe(503);
    expect(f.s.runtime.bookStore.open(f.bookId).raw.open).toBe(true);
    await expect(
      createServer({ dataDir: f.dataDir, token: 'second', modules: [] }),
    ).rejects.toMatchObject({ data: { code: 'DATA_DIR_IN_USE' } });
    fail = false;
    await f.s.runtime.lifecycle.stop();
    expect(f.s.runtime.lifecycle.state).toBe('stopped');
  });

  it('不合作的 stop hook 超时保留占用，晚结束不虚报成功，之后可安全重试', async () => {
    const finish = deferred();
    let first = true;
    const f = await fixture(
      {
        stop: async () => {
          if (first) {
            first = false;
            await finish.promise;
          }
        },
      },
      25,
    );
    await expect(f.s.runtime.lifecycle.stop()).rejects.toMatchObject({
      data: { code: 'LIFECYCLE_TIMEOUT' },
    });
    expect(f.s.runtime.lifecycle.state).toBe('failed');
    await expect(
      createServer({ dataDir: f.dataDir, token: 'second', modules: [] }),
    ).rejects.toMatchObject({ data: { code: 'DATA_DIR_IN_USE' } });
    finish.resolve();
    await setImmediate();
    expect(f.s.runtime.lifecycle.state).toBe('failed');
    await f.s.runtime.lifecycle.stop();
  });
});

// 真正启动两个独立 Node/Fastify 进程，绝不共享内存锁对象。
function childServer(dataDir: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CAIWU_DATA_DIR: dataDir,
      CAIWU_TOKEN: 'child-test-token',
      CAIWU_PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  const ready = new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (b: Buffer) => {
      output += b.toString();
      if (output.includes('CAIWU_READY')) resolve();
    });
    child.stderr.on('data', (b: Buffer) => {
      output += b.toString();
    });
    child.once('exit', () => {
      if (!output.includes('CAIWU_READY')) reject(new Error(output));
    });
    child.once('error', reject);
  });
  return { child, ready, exited, output: () => output };
}

it('第二个 server 进程同 dataDir 被拒；正常退出释放；崩溃残留不自动清锁', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-process-'));
  dirs.push(dir);
  const first = childServer(dir);
  try {
    await first.ready;
    const second = childServer(dir);
    await expect(second.ready).rejects.toThrow(/数据目录已被占用/);
    expect(await second.exited).toBe(1);
  } finally {
    first.child.send({ type: 'CAIWU_SHUTDOWN' });
    expect(await first.exited).toBe(0);
  }
  const third = childServer(dir);
  await third.ready;
  third.child.kill('SIGKILL');
  await third.exited;
  const fourth = childServer(dir);
  await expect(fourth.ready).rejects.toThrow(/未确认的运行锁/);
  expect(await fourth.exited).toBe(1);
});

function auxiliary(dataDir: string, bookId: string) {
  const code = `
    import { createRuntime } from '@caiwu/server-kit';
    const app = createRuntime({ dataDir: process.env.CAIWU_DATA_DIR, modules: [] });
    const book = app.bookStore.open(process.env.CAIWU_TEST_BOOK);
    book.raw.exec("BEGIN IMMEDIATE; UPDATE book_info SET name = '辅助进程晚提交'");
    console.log('AUX_READY');
    process.stdin.once('data', async () => {
      book.raw.exec('COMMIT');
      await app.bookStore.closeAll();
      process.exit(0);
    });
  `;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
    cwd: process.cwd(),
    env: { ...process.env, CAIWU_DATA_DIR: dataDir, CAIWU_TEST_BOOK: bookId },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  const ready = new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (b: Buffer) => {
      output += b.toString();
      if (output.includes('AUX_READY')) resolve();
    });
    child.stderr.on('data', (b: Buffer) => {
      output += b.toString();
    });
    child.once('exit', () => {
      if (!output.includes('AUX_READY')) reject(new Error(output));
    });
    child.once('error', reject);
  });
  return { child, ready, exited };
}

it('辅助进程写事务存活时维护明确拒绝；正常提交并关闭后才能维护，晚提交不丢失', async () => {
  const f = await fixture();
  const aux = auxiliary(f.dataDir, f.bookId);
  try {
    await aux.ready;
    let called = false;
    await expect(
      f.s.runtime.bookStore.maintain(f.bookId, {
        kind: 'reconnect',
        prepare: async () => {
          called = true;
        },
      }),
    ).rejects.toMatchObject({ data: { code: 'DATA_DIR_HAS_PARTICIPANTS' } });
    expect(called).toBe(false);
    expect((await f.me()).statusCode).toBe(200);
    aux.child.stdin.write('finish');
    expect(await aux.exited).toBe(0);
    let row: unknown;
    await f.s.runtime.bookStore.maintain(f.bookId, {
      kind: 'reconnect',
      prepare: async (book) => {
        row = book.raw.prepare('SELECT name FROM book_info').get();
      },
    });
    expect(row).toEqual({ name: '辅助进程晚提交' });
  } finally {
    if (aux.child.exitCode === null) {
      aux.child.kill('SIGKILL');
      await aux.exited;
    }
  }
});

it('维护持有持久门期间，新的辅助进程不能加入或打开账套', async () => {
  const f = await fixture();
  const entered = deferred(),
    finish = deferred();
  const maintenance = f.s.runtime.bookStore.maintain(f.bookId, {
    kind: 'reconnect',
    prepare: async () => {
      entered.resolve();
      await finish.promise;
    },
  });
  await entered.promise;
  try {
    const aux = auxiliary(f.dataDir, f.bookId);
    await expect(aux.ready).rejects.toThrow(/已被占用/);
    expect(await aux.exited).toBe(1);
  } finally {
    finish.resolve();
    await maintenance;
  }
});
