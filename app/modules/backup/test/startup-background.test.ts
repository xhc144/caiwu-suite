import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createRuntime, coreRouter, type AppRuntime } from '@caiwu/server-kit';
import backupServer from '../server';
import * as files from '../server/files';
import { automaticStatus } from '../server/automatic';
import { DEFAULT_SETTINGS } from '../shared';

let app: AppRuntime;
let dataDir: string;
const releases: (() => void)[] = [];
afterEach(async () => {
  releases.splice(0).forEach((release) => release());
  vi.restoreAllMocks();
  if (app) await app.bookStore.dispose();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});
function gate() {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  return { entered, enter, blocked, release };
}
async function fixture() {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'backup-startup-'));
  // 缩小测试预算以使旧实现真实触发同一 RuntimeLifecycle 启动超时；生产默认值不变。
  app = createRuntime({ dataDir, modules: [backupServer], devMode: true, lifecycleTimeoutMs: 500 });
  const info = await app.bookStore.create({
    name: 'A慢盘启动',
    orgName: '合成单位',
    product: 'chengben',
    templateId: 'demo-enterprise',
    startYear: 2026,
    startMonth: 1,
    adminPassword: 'admin',
  });
  return app.bookStore.open(info.id);
}

it.each(['sqlite', 'validation', 'rotation'] as const)(
  'w_autobak：%s 真作业门控不占启动预算；服务可登录设置，租约和关闭等待覆盖整个后台作业',
  async (stage) => {
    const book = await fixture();
    const peer =
      stage === 'sqlite'
        ? await app.bookStore.create({
            name: 'Z排队账套',
            orgName: '合成单位',
            product: 'chengben',
            templateId: 'demo-enterprise',
            startYear: 2026,
            startMonth: 1,
            adminPassword: 'admin',
          })
        : null;
    const block = gate();
    if (stage === 'sqlite') {
      const real = book.raw.backup.bind(book.raw);
      vi.spyOn(book.raw, 'backup').mockImplementation(async (...args) => {
        block.enter();
        await block.blocked;
        return real(...args);
      });
    } else {
      const real = files.validatePackage;
      let gated = false;
      vi.spyOn(files, 'validatePackage').mockImplementation(async (...args) => {
        const checked = await real(...args);
        const matches =
          stage === 'validation' ? args[0].endsWith('.partial') : args[0].endsWith('.caiwubak');
        if (!gated && matches) {
          gated = true;
          block.enter();
          await block.blocked;
        }
        return checked;
      });
    }
    // 门未释放，启动必须已完成；旧实现会在上面的真实公共预算耗尽后失败。
    await app.lifecycle.start();
    await block.entered;
    expect(app.lifecycle.state).toBe('ready');
    expect(automaticStatus(app, book.id).automaticRunning).toBe(true);
    const login = await coreRouter
      .createCaller({ app, token: null })
      .auth.login({ bookId: book.id, userCode: 'admin', password: 'admin' });
    const api = backupServer.router.createCaller({ app, token: login.token });
    expect((await api.overview()).config.enabled).toBe(true);
    if (peer) {
      const other = await coreRouter
        .createCaller({ app, token: null })
        .auth.login({ bookId: peer.id, userCode: 'admin', password: 'admin' });
      expect(
        (await backupServer.router.createCaller({ app, token: other.token }).overview()).book.id,
      ).toBe(peer.id);
    }
    // 服务在启动备份尚未结束时可保存设置；不靠默认禁用备份取得可用性。
    await api.saveSettings({ ...DEFAULT_SETTINGS, onExit: false });
    const current = await api.list();
    expect(current).toHaveLength(1);
    expect(current[0]?.status).toBe(stage === 'rotation' ? 'valid' : 'running');
    if (stage === 'rotation') expect(current[0]?.retention_note).toBe('');
    let closed = false;
    const closing = (
      stage === 'validation' ? app.lifecycle.stop() : app.bookStore.close(book.id)
    ).then(() => {
      closed = true;
    });
    await setImmediate();
    expect(closed).toBe(false);
    expect(book.raw.open).toBe(true);
    block.release();
    await closing;
    expect(closed).toBe(true);
    expect(book.raw.open).toBe(false);
    if (stage !== 'validation') {
      const reopened = app.bookStore.open(book.id);
      expect(
        reopened.raw.prepare('SELECT status,retention_note FROM backup_item').get(),
      ).toMatchObject({ status: 'valid', retention_note: expect.stringContaining('保留最新') });
      expect(
        reopened.raw
          .prepare("SELECT count(*) n FROM operation_log WHERE action='backup.retention'")
          .get(),
      ).toEqual({ n: 1 });
      await app.lifecycle.stop();
    }
  },
);

it('w_autobak：后台启动失败可见且服务仍可用；修复后可建保护备份，覆盖拒绝仍生效', async () => {
  const book = await fixture();
  const backup = vi
    .spyOn(book.raw, 'backup')
    .mockRejectedValueOnce(Object.assign(new Error('disk full'), { code: 'ENOSPC' }));
  await app.lifecycle.start();
  await expect.poll(() => automaticStatus(app, book.id).automaticFailure).toBe('磁盘空间不足');
  expect(app.lifecycle.state).toBe('ready');
  const login = await coreRouter
    .createCaller({ app, token: null })
    .auth.login({ bookId: book.id, userCode: 'admin', password: 'admin' });
  const api = backupServer.router.createCaller({ app, token: login.token });
  expect((await api.overview()).lastFailure?.reason).toBe('磁盘空间不足');
  await api.saveSettings({ ...DEFAULT_SETTINGS, onExit: false });
  backup.mockRestore();
  const created = await api.create({ name: '恢复保护测试源', requestId: crypto.randomUUID() });
  await expect
    .poll(async () => (await api.list()).find((row) => row.id === created.id)?.status)
    .toBe('valid');
  const plan = await api.preview({ id: created.id, purpose: 'overwrite' });
  const protection = await api.prepareOverwrite({ planId: plan.id });
  expect(protection.available).toBe(false);
  expect((await api.list()).find((row) => row.id === protection.protectionId)).toMatchObject({
    kind: 'pre-restore',
    status: 'valid',
  });
  await expect(
    api.restore({ planId: plan.id, text: plan.confirmation, password: 'admin' }),
  ).rejects.toMatchObject({ cause: { data: { code: 'BACKUP_MAINTENANCE_REQUIRED' } } });
  expect(book.raw.open).toBe(true);
  await app.lifecycle.stop();
});
