import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import backupServer from './isolated-server';
import { waitForJobs } from '../server/service';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
let app: TestApp;
let http: ReturnType<typeof createHTTPServer>;
const releases: (() => void)[] = [];
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  vi.restoreAllMocks();
  if (http)
    await new Promise<void>((resolve, reject) => http.close((e) => (e ? reject(e) : resolve())));
  if (app) {
    await waitForJobs(app.runtime);
    await app.close();
  }
});
async function fixture() {
  app = await createTestApp({ modules: [backupServer] });
  http = createHTTPServer({
    router: app.router,
    createContext: ({ req }) => ({
      app: app.runtime,
      token: req.headers.authorization?.slice('Bearer '.length) ?? null,
    }),
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('HTTP 监听失败');
  const base = `http://127.0.0.1:${address.port}`;
  const call = async (method: string, input: unknown, token?: string) => {
    const response = await fetch(`${base}/${method}`, {
      method: input === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: input === undefined ? undefined : JSON.stringify(input),
    });
    return {
      status: response.status,
      body: (await response.json()) as {
        result?: { data: { id: string; status: string } };
        error?: { data: { business: { code: string } } };
      },
    };
  };
  const token = await app.login();
  const raw = app.runtime.bookStore.open(app.book.id).raw;
  const real = raw.backup.bind(raw);
  const entered = deferred(),
    finish = deferred();
  releases.push(finish.resolve);
  vi.spyOn(raw, 'backup').mockImplementation(async (...args) => {
    entered.resolve();
    await finish.promise;
    return real(...args);
  });
  return { call, token, raw, real, entered, finish };
}
function finalRows(raw: Database.Database) {
  return {
    item: raw.prepare('SELECT status, reason FROM backup_item').get(),
    logs: raw
      .prepare(
        "SELECT action, user_id, user_name, module FROM operation_log WHERE action LIKE 'backup.%' ORDER BY id",
      )
      .all(),
  };
}

it('w_bf：真实 HTTP 返回后继续备份，维护等待最终状态与原操作员日志，并拒绝新请求', async () => {
  const f = await fixture();
  const actor = await app.addUser('backup-clerk', { permissions: ['backup.create'] });
  const userId = app.runtime.sessions.get(actor)!.userId;
  const created = await f.call(
    'm.backup.create',
    { requestId: randomUUID(), name: '异步租约' },
    actor,
  );
  expect(created.status).toBe(200);
  expect(created.body.result?.data.status).toBe('running');
  await f.entered.promise;
  app.runtime.sessions.delete(actor);
  let prepared = false;
  const maintaining = app.runtime.bookStore.maintain(app.book.id, {
    kind: 'reconnect',
    prepare: async (book) => {
      prepared = true;
      expect(finalRows(book.raw)).toMatchObject({
        item: { status: 'valid', reason: '' },
        logs: [
          {
            action: 'backup.manual.start',
            user_id: userId,
            user_name: 'backup-clerk',
            module: 'backup',
          },
          {
            action: 'backup.complete',
            user_id: userId,
            user_name: 'backup-clerk',
            module: 'backup',
          },
        ],
      });
    },
  });
  try {
    await setImmediate();
    expect(prepared).toBe(false);
    expect(f.raw.open).toBe(true);
    const denied = await f.call('m.backup.list', undefined, f.token);
    expect(denied.body.error?.data.business.code).toBe('BOOK_MAINTENANCE');
  } finally {
    f.finish.resolve();
    await Promise.all([waitForJobs(app.runtime), maintaining]);
  }
  expect(prepared).toBe(true);
});

it.each(['close', 'shutdown'] as const)(
  'w_bf：%s 等待 HTTP 后台作业和最终日志再关闭真实句柄',
  async (kind) => {
    const f = await fixture();
    expect(
      (await f.call('m.backup.create', { requestId: randomUUID(), name: '关闭等待' }, f.token))
        .status,
    ).toBe(200);
    await f.entered.promise;
    const file = app.runtime.bookStore.pathOf(app.book.id);
    let closed = false;
    const closing = (
      kind === 'close' ? app.runtime.bookStore.close(app.book.id) : app.runtime.lifecycle.stop()
    ).then(() => {
      closed = true;
    });
    try {
      await setImmediate();
      expect(closed).toBe(false);
      expect(f.raw.open).toBe(true);
    } finally {
      f.finish.resolve();
      await closing;
    }
    expect(f.raw.open).toBe(false);
    const reader = new Database(file, { readonly: true, fileMustExist: true });
    try {
      expect(finalRows(reader)).toMatchObject({
        item: { status: 'valid', reason: '' },
        logs: [{ action: 'backup.manual.start' }, { action: 'backup.complete' }],
      });
    } finally {
      reader.close();
    }
  },
);

it('w_bf：HTTP 后的磁盘错误保存 failed 与失败日志，维护不能先关闭句柄', async () => {
  const f = await fixture();
  vi.mocked(f.raw.backup).mockImplementation(async () => {
    f.entered.resolve();
    await f.finish.promise;
    throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  });
  expect(
    (await f.call('m.backup.create', { requestId: randomUUID(), name: '异步失败' }, f.token))
      .status,
  ).toBe(200);
  await f.entered.promise;
  const maintaining = app.runtime.bookStore.maintain(app.book.id, {
    kind: 'reconnect',
    prepare: async (book) => {
      expect(finalRows(book.raw)).toMatchObject({
        item: { status: 'failed', reason: '磁盘空间不足' },
        logs: [{ action: 'backup.manual.start' }, { action: 'backup.failed' }],
      });
    },
  });
  f.finish.resolve();
  await Promise.all([waitForJobs(app.runtime), maintaining]);
});

it('w_bf：HTTP 后取消作业落 cancelled 与失败日志；关闭等待真实清理完成', async () => {
  const f = await fixture();
  const created = await f.call(
    'm.backup.create',
    { requestId: randomUUID(), name: '异步取消' },
    f.token,
  );
  await f.entered.promise;
  expect(
    (await f.call('m.backup.cancel', { id: created.body.result!.data.id }, f.token)).status,
  ).toBe(200);
  f.finish.resolve();
  await waitForJobs(app.runtime);
  expect(finalRows(f.raw)).toMatchObject({
    item: { status: 'cancelled' },
    logs: [{ action: 'backup.manual.start' }, { action: 'backup.failed' }],
  });
  await app.runtime.bookStore.close(app.book.id);
  expect(f.raw.open).toBe(false);
});

it('w_bf：无 create 权限的真实 HTTP 请求不能取得后台系统权限或新建备份', async () => {
  const f = await fixture();
  const viewer = await app.addUser('backup-viewer', { permissions: ['backup.view'] });
  const denied = await f.call(
    'm.backup.create',
    { requestId: randomUUID(), name: '禁止越权' },
    viewer,
  );
  expect(denied.body.error?.data.business.code).toBe('FORBIDDEN');
  expect(f.raw.prepare('SELECT count(*) AS n FROM backup_item').get()).toEqual({ n: 0 });
  expect(f.raw.backup).not.toHaveBeenCalled();
});

it('w_bf：超时信号只请求取消，真实清理结束后才返回中止，随后可安全退出', async () => {
  const f = await fixture();
  await f.call('m.backup.create', { requestId: randomUUID(), name: '等待取消' }, f.token);
  await f.entered.promise;
  const controller = new AbortController();
  let settled = false;
  const waiting = waitForJobs(app.runtime, app.book.id, controller.signal).finally(() => {
    settled = true;
  });
  const rejected = expect(waiting).rejects.toThrow('测试关闭超时');
  controller.abort(new Error('测试关闭超时'));
  await setImmediate();
  expect(settled).toBe(false);
  expect(f.raw.open).toBe(true);
  f.finish.resolve();
  await rejected;
  expect(finalRows(f.raw)).toMatchObject({
    item: { status: 'cancelled' },
    logs: [{ action: 'backup.manual.start' }, { action: 'backup.failed' }],
  });
  await app.runtime.lifecycle.stop();
  expect(f.raw.open).toBe(false);
});

it('w_bf：另一账套不能读取或取消该作业，关闭另一账套不会等待本账套备份', async () => {
  const f = await fixture();
  const created = await f.call(
    'm.backup.create',
    { requestId: randomUUID(), name: '本账套备份' },
    f.token,
  );
  await f.entered.promise;
  const other = await app.core(null).books.create({
    name: '隔离账套',
    orgName: '合成单位',
    templateId: 'demo-enterprise',
    product: 'chengben',
    startYear: 2026,
    startMonth: 1,
    adminPassword: 'admin',
  });
  const token = (
    await app.core(null).auth.login({ bookId: other.id, userCode: 'admin', password: 'admin' })
  ).token;
  expect((await f.call('m.backup.list', undefined, token)).body.result?.data).toEqual([]);
  const denied = await f.call('m.backup.cancel', { id: created.body.result!.data.id }, token);
  expect(denied.body.error?.data.business.code).toBe('BACKUP_NOT_FOUND');
  await app.runtime.bookStore.close(other.id);
  expect(f.raw.open).toBe(true);
  f.finish.resolve();
  await waitForJobs(app.runtime);
  expect(finalRows(f.raw).item).toMatchObject({ status: 'valid' });
});

it('w_bf：完成日志保存失败不能假报成功，failed 状态和失败日志持租约写入后才允许维护', async () => {
  const f = await fixture();
  vi.mocked(f.raw.backup).mockImplementation(async (...args) => {
    f.entered.resolve();
    await f.finish.promise;
    const result = await f.real(...args);
    // 快照已完成后才注入源账套故障，确保实际走到最终日志写入。
    f.raw.exec(
      "CREATE TRIGGER backup_fixture_log_failure BEFORE INSERT ON operation_log WHEN NEW.action = 'backup.complete' BEGIN SELECT RAISE(FAIL, '合成完成日志失败'); END;",
    );
    return result;
  });
  await f.call('m.backup.create', { requestId: randomUUID(), name: '日志失败' }, f.token);
  await f.entered.promise;
  const maintaining = app.runtime.bookStore.maintain(app.book.id, {
    kind: 'reconnect',
    prepare: async (book) => {
      expect(finalRows(book.raw)).toMatchObject({
        item: { status: 'failed', reason: '文件读写或 SQLite 校验失败' },
        logs: [{ action: 'backup.manual.start' }, { action: 'backup.failed' }],
      });
    },
  });
  f.finish.resolve();
  await Promise.all([waitForJobs(app.runtime), maintaining]);
});
