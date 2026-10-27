import { randomUUID } from 'node:crypto';
import { link, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type * as Fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestApp, seedVouchers, voucherInputFromSpec, type TestApp } from '@caiwu/testkit';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import backupServer from './isolated-server';
import { defineManifest } from '@caiwu/core';
import { defineServerModule, moduleKit } from '@caiwu/server-kit';
import { waitForJobs } from '../server/service';

const fault = vi.hoisted(() => ({ target: '', code: '' }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof Fs>();
  return {
    ...actual,
    link: async (...args: Parameters<typeof actual.link>) => {
      if (args[1] === fault.target)
        throw Object.assign(new Error('合成 Windows 文件占用/权限错误'), { code: fault.code });
      return actual.link(...args);
    },
  };
});
const sourceManifest = defineManifest({
  id: 'backup-source-fixture',
  name: '合成来源单据',
  products: 'all',
  permissions: [],
  menu: [],
  sources: [{ type: 'document', name: '合成单据', path: '/document?id={id}' }],
});
const sourceModule = defineServerModule(sourceManifest, {
  router: moduleKit(sourceManifest).router({}),
});
const modules = [backupServer, sourceModule];
let app: TestApp;
const caller = (a: TestApp, token?: string) => a.call(backupServer, token);
let api: ReturnType<typeof caller>;
let cleanup: string[] = [];
beforeEach(async () => {
  app = await createTestApp({ modules });
  api = caller(app);
});
afterEach(async () => {
  fault.target = '';
  fault.code = '';
  for (const file of cleanup) await rm(file, { force: true });
  cleanup = [];
  await waitForJobs(app.runtime);
  await app.close();
});
async function plan() {
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '1001', debit: 10001 },
        { account: '6603', credit: 10001 },
      ],
    },
  ]);
  const item = await api.create({ name: '保护源', requestId: randomUUID() });
  await waitForJobs(app.runtime);
  return api.preview({ id: item.id, purpose: 'copy', name: '安全副本' });
}
it.each(['-wal', '-shm', '-journal'])(
  'w_hf：新副本目标已有 %s 时拒绝发布，原账和辅助文件全部保留',
  async (suffix) => {
    const p = await plan();
    const sidecar = app.runtime.bookStore.pathOf(p.target_id) + suffix;
    cleanup.push(sidecar);
    await writeFile(sidecar, '不属于本次恢复的辅助文件');
    await expect(
      api.restore({ planId: p.id, text: p.confirmation, password: 'admin' }),
    ).rejects.toThrow('辅助文件');
    expect(app.runtime.bookStore.exists(p.target_id)).toBe(false);
    expect(await readFile(sidecar, 'utf8')).toBe('不属于本次恢复的辅助文件');
    expect((await app.svc.vouchers.list({})).items).toHaveLength(1);
  },
);
it('w_hf：目标为硬链接时不读取认领，两个链接保留且不改原财务数据', async () => {
  const p = await plan();
  const original = path.join(app.runtime.dataDir, '无关文件.caiwu');
  const target = app.runtime.bookStore.pathOf(p.target_id);
  cleanup.push(target, original);
  await writeFile(original, '无关原文件');
  await link(original, target);
  await expect(
    api.restore({ planId: p.id, text: p.confirmation, password: 'admin' }),
  ).rejects.toThrow('禁止覆盖');
  expect(await readFile(original, 'utf8')).toBe('无关原文件');
  expect(await readFile(target, 'utf8')).toBe('无关原文件');
  expect((await app.svc.vouchers.list({})).items).toHaveLength(1);
});
it.each(['EPERM', 'EBUSY'])(
  'w_hf：模拟 Windows 发布 %s 失败清理暂存，原账整数金额不变；修复后同计划可重试',
  async (code) => {
    const p = await plan();
    fault.target = app.runtime.bookStore.pathOf(p.target_id);
    fault.code = code;
    await expect(
      api.restore({ planId: p.id, text: p.confirmation, password: 'admin' }),
    ).rejects.toThrow();
    expect(app.runtime.bookStore.exists(p.target_id)).toBe(false);
    expect(
      (await readdir(app.runtime.bookStore.booksDir)).filter((name) =>
        name.includes('.backup-import'),
      ),
    ).toEqual([]);
    const original = (await app.svc.vouchers.list({})).items;
    expect(original).toHaveLength(1);
    expect(original[0]?.debitTotal).toBe(10001);
    fault.target = '';
    const restored = await api.restore({ planId: p.id, text: p.confirmation, password: 'admin' });
    const book = app.runtime.bookStore.open(restored.bookId);
    const svc = createCoreServices({
      db: book.db,
      user: (await loadServiceUser(book.db, 1))!,
      moduleId: null,
      now: app.runtime.now,
      modules: app.runtime.modules.lookup,
    });
    expect((await svc.vouchers.list({})).items[0]?.debitTotal).toBe(10001);
    expect((await svc.vouchers.list({})).items[0]?.status).toBe('posted');
  },
);

it('w_tzjl_get：换机恢复保留已审核来源锁和权限；失败事务不进入快照，源机器计划/备份引用及会话不复制', async () => {
  const input = await voucherInputFromSpec(app.svc, {
    date: '2026-01-05',
    lines: [
      { account: '1001', debit: 23456 },
      { account: '6603', credit: 23456 },
    ],
  });
  await expect(
    app.svc.tx(async (svc) => {
      await svc.vouchers.create(input);
      throw new Error('合成事务回滚');
    }),
  ).rejects.toThrow('合成事务回滚');
  expect((await app.svc.vouchers.list({})).items).toEqual([]);
  const owner = app.svcFor(sourceManifest.id);
  const voucher = await owner.vouchers.create({
    ...input,
    source: { type: 'document', id: 'synthetic-001' },
  });
  await owner.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
  const restricted = await app.addUser('backup-reader', { permissions: ['backup.view'] });
  const restrictedId = app.runtime.sessions.get(restricted)!.userId;
  const item = await api.create({ name: '换机带来源锁', requestId: randomUUID() });
  await waitForJobs(app.runtime);
  const portable = await api.download({ id: item.id });
  const machine = await createTestApp({ modules });
  try {
    const imported = await caller(machine).upload({ name: '换机包', base64: portable.base64 });
    const preview = await caller(machine).preview({
      id: imported.id,
      purpose: 'copy',
      name: '换机新副本',
    });
    expect(preview.metadata.book.id).toBe(app.book.id);
    const restored = await caller(machine).restore({
      planId: preview.id,
      text: preview.confirmation,
      password: 'admin',
    });
    const book = machine.runtime.bookStore.open(restored.bookId);
    const admin = (await loadServiceUser(book.db, 1))!;
    const service = (moduleId: string | null) =>
      createCoreServices({
        db: book.db,
        user: admin,
        moduleId,
        now: machine.runtime.now,
        modules: machine.runtime.modules.lookup,
      });
    expect((await service(null).vouchers.list({})).items).toHaveLength(1);
    expect(await service(null).vouchers.get(voucher.id)).toMatchObject({
      status: 'audited',
      debitTotal: 23456,
      source: { module: sourceManifest.id, type: 'document', id: 'synthetic-001' },
    });
    await expect(service(null).vouchers.delete(voucher.id)).rejects.toMatchObject({
      data: { code: 'VOUCHER_FROM_SOURCE' },
    });
    await expect(service(sourceManifest.id).vouchers.delete(voucher.id)).rejects.toThrow('审核');
    expect([...(await loadServiceUser(book.db, restrictedId))!.permissions]).toEqual([
      'backup.view',
    ]);
    expect(machine.runtime.sessions.get(restricted)).toBeNull();
    expect(book.raw.prepare('SELECT count(*) n FROM backup_item').get()).toEqual({ n: 0 });
    expect(book.raw.prepare('SELECT count(*) n FROM backup_plan').get()).toEqual({ n: 0 });
    expect((await app.svc.vouchers.get(voucher.id))?.debitTotal).toBe(23456);
  } finally {
    await machine.close();
  }
});
