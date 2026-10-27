import { AsyncResource } from 'node:async_hooks';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { afterEach, expect, it, vi } from 'vitest';
import { createRuntime, coreRouter, type AppRuntime } from '@caiwu/server-kit';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import { seedVouchers } from '@caiwu/testkit';
import backupServer from '../server';
import { DEFAULT_SETTINGS } from '../shared';
import { automaticStatus, startAutomaticBackups, stopAutomaticBackups } from '../server/automatic';
import { directory, packagePath, validatePackage } from '../server/files';
import type { Clock } from '../server/controller';

let app: AppRuntime;
let dataDir: string;
const releases: (() => void)[] = [];
afterEach(async () => {
  releases.splice(0).forEach((r) => r());
  vi.restoreAllMocks();
  // 失败退出须保留目录租约；测试清理只在独立用例结束后执行。
  if (app) await app.bookStore.dispose();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});
function fakeClock() {
  let time = Date.now();
  let sequence = 0;
  const timers = new Map<number, { fn: () => void; at: number }>();
  const clock: Clock = {
    now: () => time,
    set: (fn, ms) => {
      timers.set(++sequence, { fn: AsyncResource.bind(fn), at: time + ms });
      return sequence;
    },
    clear: (id) => {
      timers.delete(id as number);
    },
  };
  return {
    clock,
    timers,
    advance(ms: number) {
      time += ms;
      for (const [id, timer] of [...timers])
        if (timer.at <= time) {
          timers.delete(id);
          timer.fn();
        }
    },
  };
}
async function fixture(controlled = false) {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'backup-runtime-'));
  const time = fakeClock();
  const module = controlled
    ? {
        ...backupServer,
        lifecycle: {
          ...backupServer.lifecycle,
          start: ({ app, signal }: { app: AppRuntime; signal: AbortSignal }) =>
            startAutomaticBackups(app, signal, time.clock),
        },
      }
    : backupServer;
  app = createRuntime({ dataDir, modules: [module], devMode: true });
  const info = await app.bookStore.create({
    name: '自动备份集成',
    orgName: '合成单位',
    product: 'chengben',
    templateId: 'demo-enterprise',
    startYear: 2026,
    startMonth: 1,
    adminPassword: 'admin',
  });
  const book = app.bookStore.open(info.id);
  const svc = createCoreServices({
    db: book.db,
    user: (await loadServiceUser(book.db, 1))!,
    moduleId: 'backup',
    now: app.now,
    modules: app.modules.lookup,
  });
  const rows = () =>
    book.raw.prepare("SELECT * FROM backup_item WHERE kind='automatic' ORDER BY rowid").all() as {
      id: string;
      status: string;
      directory: string;
    }[];
  return { ...time, book, svc, rows, id: info.id };
}
async function settle(check: () => boolean) {
  await expect.poll(check, { interval: 10, timeout: 3000 }).toBe(true);
}
it('w_autobak：真实 start/stop 默认自动备份；快照包含整数分凭证，系统日志及退出校验完成后才关闭', async () => {
  const f = await fixture();
  await seedVouchers(f.svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '1001', debit: 12345 },
        { account: '6603', credit: 12345 },
      ],
    },
  ]);
  await app.lifecycle.start();
  await settle(
    () =>
      f.rows().length === 1 &&
      !automaticStatus(app, f.id).automaticRunning &&
      automaticStatus(app, f.id).nextAt !== null,
  );
  expect(f.rows()).toHaveLength(1);
  expect(f.rows()[0]?.status).toBe('valid');
  expect(automaticStatus(app, f.id)).toMatchObject({
    automaticFailure: null,
    runtimeStatus: '启动 / 正常退出 / 定时自动备份已接入',
  });
  expect(automaticStatus(app, f.id).nextAt).not.toBeNull();
  const row = f.rows()[0]!;
  const checked = await validatePackage(
    packagePath(await directory(dataDir, f.id, row.directory), row.id),
    app,
  );
  const snapshot = new Database(checked.snapshot, { readonly: true });
  try {
    expect(snapshot.prepare('SELECT debit,credit FROM voucher_line ORDER BY id').all()).toEqual([
      { debit: 12345, credit: 0 },
      { debit: 0, credit: 12345 },
    ]);
  } finally {
    snapshot.close();
    await rm(checked.snapshot);
  }
  expect(
    f.book.raw
      .prepare("SELECT user_id,user_name,module FROM operation_log WHERE action='backup.complete'")
      .get(),
  ).toEqual({ user_id: 0, user_name: '系统', module: 'backup' });
  const file = f.book.file;
  await app.lifecycle.stop();
  expect(f.book.raw.open).toBe(false);
  const reader = new Database(file, { readonly: true });
  try {
    expect(reader.prepare("SELECT status FROM backup_item WHERE kind='automatic'").all()).toEqual([
      { status: 'valid' },
      { status: 'valid' },
    ]);
  } finally {
    reader.close();
  }
});
it('w_autobak：真实定时持系统租约，reconnect 等待快照与日志完成；配置停用撤销后续调度', async () => {
  const f = await fixture(true);
  await f.svc.settings.set('automatic', {
    ...DEFAULT_SETTINGS,
    onStart: false,
    onExit: false,
    intervalMinutes: 5,
  });
  await app.lifecycle.start();
  await settle(() => automaticStatus(app, f.id).nextAt !== null);
  let entered!: () => void, finish!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    finish = resolve;
  });
  releases.push(finish);
  const real = f.book.raw.backup.bind(f.book.raw);
  vi.spyOn(f.book.raw, 'backup').mockImplementation(async (...args) => {
    entered();
    await blocked;
    return real(...args);
  });
  f.advance(5 * 60_000);
  await started;
  expect(automaticStatus(app, f.id).automaticRunning).toBe(true);
  const activeLogin = await coreRouter
    .createCaller({ app, token: null })
    .auth.login({ bookId: f.id, userCode: 'admin', password: 'admin' });
  const activeRows = await backupServer.router
    .createCaller({ app, token: activeLogin.token })
    .list();
  expect(activeRows).toMatchObject([{ status: 'running' }]);
  let maintained = false;
  const maintenance = app.bookStore.maintain(f.id, {
    kind: 'reconnect',
    prepare: async (book) => {
      expect(book.raw.prepare('SELECT status FROM backup_item').all()).toEqual([
        { status: 'valid' },
      ]);
      expect(
        book.raw
          .prepare("SELECT count(*) n FROM operation_log WHERE action='backup.retention'")
          .get(),
      ).toEqual({ n: 1 });
      // 在独占维护尚未退出时，运行结束后的定时设置读取会被共享层拒绝。
      await settle(() => automaticStatus(app, f.id).automaticFailure?.includes('维护') === true);
      maintained = true;
    },
  });
  await setImmediate();
  expect(maintained).toBe(false);
  finish();
  await maintenance;
  expect(maintained).toBe(true);
  f.advance(60_000);
  await settle(() => automaticStatus(app, f.id).nextAt !== null);
  f.advance(5 * 60_000);
  await settle(() => !automaticStatus(app, f.id).automaticRunning);
  expect(app.bookStore.open(f.id).raw.prepare('SELECT status FROM backup_item').all()).toEqual([
    { status: 'valid' },
    { status: 'valid' },
  ]);
  expect(automaticStatus(app, f.id).automaticFailure).toBeNull();
  const login = await coreRouter
    .createCaller({ app, token: null })
    .auth.login({ bookId: f.id, userCode: 'admin', password: 'admin' });
  await backupServer.router
    .createCaller({ app, token: login.token })
    .saveSettings({ ...DEFAULT_SETTINGS, enabled: false });
  expect(automaticStatus(app, f.id).nextAt).toBeNull();
  f.advance(10 * 60_000);
  await settle(() => !automaticStatus(app, f.id).automaticRunning);
  const raw = app.bookStore.open(f.id).raw;
  expect(raw.prepare('SELECT count(*) n FROM backup_item').get()).toEqual({ n: 2 });
  await app.lifecycle.stop();
});
it('w_autobak：退出备份遇到磁盘满会保存失败并拒绝退出，账套与租约保留', async () => {
  const f = await fixture();
  await f.svc.settings.set('automatic', { ...DEFAULT_SETTINGS, onStart: false });
  await app.lifecycle.start();
  await settle(() => automaticStatus(app, f.id).nextAt !== null);
  vi.spyOn(f.book.raw, 'backup').mockRejectedValueOnce(
    Object.assign(new Error('disk full'), { code: 'ENOSPC' }),
  );
  await expect(app.lifecycle.stop()).rejects.toMatchObject({
    data: { code: 'BACKUP_AUTOMATIC_EXIT' },
  });
  expect(app.lifecycle.state).toBe('failed');
  expect(f.book.raw.open).toBe(true);
  expect(f.rows()).toMatchObject([{ status: 'failed' }]);
  expect(
    f.book.raw.prepare("SELECT summary FROM operation_log WHERE action='backup.failed'").get(),
  ).toEqual({ summary: '磁盘空间不足' });
  expect(await readdir(await directory(dataDir, f.id, DEFAULT_SETTINGS.directory))).toEqual([]);
});
it('w_autobak：服务启动后的新账套无需打开备份页面，一分钟扫描后执行首次备份', async () => {
  const f = await fixture(true);
  await f.svc.settings.set('automatic', { ...DEFAULT_SETTINGS, enabled: false });
  await app.lifecycle.start();
  await settle(() => f.timers.size > 0);
  const fresh = await app.bookStore.create({
    name: '新建合成账套',
    orgName: '单位',
    product: 'chengben',
    templateId: 'demo-enterprise',
    startYear: 2026,
    startMonth: 1,
    adminPassword: 'admin',
  });
  f.advance(60_000);
  await settle(() => automaticStatus(app, fresh.id).nextAt !== null);
  expect(app.bookStore.open(fresh.id).raw.prepare('SELECT status FROM backup_item').all()).toEqual([
    { status: 'valid' },
  ]);
  await app.lifecycle.stop();
});

it('w_autobak：退出超时信号传到扫描中已开始的真实备份；取消清理完成前继续持有账套', async () => {
  const f = await fixture(true);
  await f.svc.settings.set('automatic', { ...DEFAULT_SETTINGS, enabled: false });
  await app.lifecycle.start();
  await settle(() => f.timers.size > 0);
  const fresh = await app.bookStore.create({
    name: '扫描取消',
    orgName: '单位',
    product: 'chengben',
    templateId: 'demo-enterprise',
    startYear: 2026,
    startMonth: 1,
    adminPassword: 'admin',
  });
  const book = app.bookStore.open(fresh.id);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => {
    enter = r;
  });
  const blocked = new Promise<void>((r) => {
    release = r;
  });
  releases.push(release);
  const real = book.raw.backup.bind(book.raw);
  vi.spyOn(book.raw, 'backup').mockImplementation(async (...args) => {
    enter();
    await blocked;
    return real(...args);
  });
  f.advance(60_000);
  await entered;
  const control = new AbortController();
  const stopping = stopAutomaticBackups(app, control.signal);
  const rejected = expect(stopping).rejects.toThrow('合成停止超时');
  control.abort(new Error('合成停止超时'));
  await setImmediate();
  expect(book.raw.open).toBe(true);
  expect(automaticStatus(app, fresh.id).automaticRunning).toBe(true);
  release();
  await rejected;
  expect(book.raw.prepare('SELECT status FROM backup_item').all()).toEqual([
    { status: 'cancelled' },
  ]);
  expect(await readdir(await directory(dataDir, fresh.id, DEFAULT_SETTINGS.directory))).toEqual([]);
});

it('w_autobak：普通缓存关闭后重新接入不重复执行启动备份，仍恢复后续定时', async () => {
  const f = await fixture(true);
  await app.lifecycle.start();
  await settle(
    () =>
      f.rows().length === 1 &&
      !automaticStatus(app, f.id).automaticRunning &&
      automaticStatus(app, f.id).nextAt !== null,
  );
  expect(f.rows()).toHaveLength(1);
  await app.bookStore.close(f.id);
  f.advance(60_000);
  await settle(() => automaticStatus(app, f.id).nextAt !== null);
  expect(app.bookStore.open(f.id).raw.prepare('SELECT count(*) n FROM backup_item').get()).toEqual({
    n: 1,
  });
  await app.lifecycle.stop();
});
