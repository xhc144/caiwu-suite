import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import { createCoreServices } from '@caiwu/core/server';
import { defineManifest } from '@caiwu/core';
import { defineServerModule, moduleKit } from '@caiwu/server-kit';
import { defineMigrations } from '@caiwu/db';

const manifest = defineManifest({
  id: 'restore-test',
  name: '恢复合成夹具',
  products: 'all',
  permissions: [{ id: 'restore-test.replace', name: '恢复' }],
});
const module = defineServerModule(manifest, {
  router: moduleKit(manifest).router({}),
  migrations: defineMigrations([
    {
      id: '0001_data',
      sql: "CREATE TABLE restore_test_data(id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO restore_test_data VALUES(1,'原模块报表打印数据')",
    },
  ]),
});
let app: TestApp;
afterEach(async () => app?.close());
const fresh = () =>
  createCoreServices({ ...app.svc.ctx, db: app.runtime.bookStore.open(app.book.id).db });
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
async function stage(bytes: Uint8Array) {
  return app.runtime.bookStore.prepareReplacement({
    bookId: app.book.id,
    bytes,
    length: bytes.byteLength,
    sha256: hash(bytes),
    expectedRevision: app.runtime.bookStore.revision(app.book.id),
    expiresAt: Date.now() + 60000,
  });
}

it('w_hf：备份→改账→保护备份→替换→旧会话撤销→重登核值，核心与模块数据全部恢复', async () => {
  app = await createTestApp({ modules: [module] });
  await app.svc.settings.set('value', '备份值');
  const bytes = app.runtime.bookStore.open(app.book.id).raw.serialize();
  await app.svc.settings.set('value', '修改值');
  await app.svc.db
    .withTables<{ restore_test_data: { id: number; value: string } }>()
    .updateTable('restore_test_data')
    .set({ value: '修改后的数据' })
    .execute();
  const ticket = await stage(bytes);
  const token = await app.login();
  // 登录日志属于真实目标变化，因此在确认前重新绑定最终目标版本。
  const finalTicket = await stage(bytes);
  await app.runtime.lifecycle.maintainBook({
    token,
    bookId: app.book.id,
    permission: 'restore-test.replace',
    authorize: async (svc) => {
      expect(svc.user.isAdmin).toBe(true);
    },
    plan: { kind: 'replace', replacementId: finalTicket.replacementId },
  });
  expect(app.runtime.sessions.get(token)).toBeNull();
  expect(app.runtime.bookStore.replacementStatus(finalTicket.replacementId)).toMatchObject({
    status: 'done',
    relogin: true,
  });
  const newToken = await app.login();
  expect(await app.core(newToken).auth.me()).toBeTruthy();
  expect(await fresh().settings.get('value', '')).toBe('备份值');
  const restored = app.runtime.bookStore.open(app.book.id).raw;
  expect(restored.prepare('SELECT value FROM restore_test_data').get()).toEqual({
    value: '原模块报表打印数据',
  });
  const directory = path.join(app.runtime.dataDir, 'core-protection', app.book.id);
  const file = readdirSync(directory).find((name) => name.endsWith('.caiwu'))!;
  const backup = readFileSync(path.join(directory, file));
  const metadata = JSON.parse(readFileSync(path.join(directory, `${file}.json`), 'utf8')) as {
    length: number;
    sha256: string;
  };
  expect(metadata).toMatchObject({ length: backup.length, sha256: hash(backup) });
  expect(app.runtime.bookStore.replacementStatus(ticket.replacementId).status).toBe('prepared');
});

it('w_hf：替换后校验失败按保护备份回滚，原账可重登读取，保护备份保留', async () => {
  app = await createTestApp({ modules: [module] });
  await app.svc.settings.set('value', '旧快照');
  const bytes = app.runtime.bookStore.open(app.book.id).raw.serialize();
  await app.svc.settings.set('value', '需要保护的当前账');
  const token = await app.login();
  const ticket = await stage(bytes);
  await expect(
    app.runtime.lifecycle.maintainBook({
      token,
      bookId: app.book.id,
      permission: 'restore-test.replace',
      authorize: async () => {},
      plan: {
        kind: 'replace',
        replacementId: ticket.replacementId,
        validate: async () => {
          throw new Error('重开后故障');
        },
      },
    }),
  ).rejects.toThrow('重开后故障');
  expect(app.runtime.bookStore.replacementStatus(ticket.replacementId)).toMatchObject({
    status: 'failed',
    relogin: false,
    protectionId: expect.any(String),
  });
  const newToken = await app.login();
  expect(await app.core(newToken).auth.me()).toBeTruthy();
  expect(await fresh().settings.get('value', '')).toBe('需要保护的当前账');
});

it('w_hf：长度/摘要错误、目标revision变化、非管理员均零覆盖；失败仍能合法重试', async () => {
  app = await createTestApp({ modules: [module] });
  const bytes = app.runtime.bookStore.open(app.book.id).raw.serialize();
  await expect(
    app.runtime.bookStore.prepareReplacement({
      bookId: app.book.id,
      bytes,
      length: bytes.length + 1,
      sha256: hash(bytes),
      expectedRevision: app.runtime.bookStore.revision(app.book.id),
      expiresAt: Date.now() + 60000,
    }),
  ).rejects.toThrow(/长度或摘要/);
  const token = await app.login();
  const ticket = await stage(bytes);
  await app.svc.settings.set('value', '新修改');
  await expect(
    app.runtime.lifecycle.maintainBook({
      token,
      bookId: app.book.id,
      permission: 'restore-test.replace',
      authorize: async () => {},
      plan: { kind: 'replace', replacementId: ticket.replacementId },
    }),
  ).rejects.toThrow(/目标账套已变化/);
  expect(await fresh().settings.get('value', '')).toBe('新修改');
  const clerk = await app.addUser('clerk', { permissions: ['restore-test.replace'] });
  const freshTicket = await stage(bytes);
  await expect(
    app.runtime.lifecycle.maintainBook({
      token: clerk,
      bookId: app.book.id,
      permission: 'restore-test.replace',
      authorize: async () => {},
      plan: { kind: 'replace', replacementId: freshTicket.replacementId },
    }),
  ).rejects.toThrow(/管理员/);
  const admin = await app.login();
  const finalTicket = await stage(bytes);
  await app.runtime.lifecycle.maintainBook({
    token: admin,
    bookId: app.book.id,
    permission: 'restore-test.replace',
    authorize: async () => {},
    plan: { kind: 'replace', replacementId: finalTicket.replacementId },
  });
  expect(app.runtime.bookStore.replacementStatus(finalTicket.replacementId).status).toBe('done');
});
