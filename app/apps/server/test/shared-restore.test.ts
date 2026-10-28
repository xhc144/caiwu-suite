import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  linkSync,
  unlinkSync,
} from 'node:fs';
import Database from 'better-sqlite3';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
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
afterEach(async () => {
  vi.restoreAllMocks();
  await app?.close();
});
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
    confirmation: { bookId: app.book.id, bookName: app.book.name, password: 'admin' },
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
      confirmation: { bookId: app.book.id, bookName: app.book.name, password: 'admin' },
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
      confirmation: { bookId: app.book.id, bookName: app.book.name, password: 'admin' },
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
      confirmation: { bookId: app.book.id, bookName: app.book.name, password: 'admin' },
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
    confirmation: { bookId: app.book.id, bookName: app.book.name, password: 'admin' },
    authorize: async () => {},
    plan: { kind: 'replace', replacementId: finalTicket.replacementId },
  });
  expect(app.runtime.bookStore.replacementStatus(finalTicket.replacementId).status).toBe('done');
});

it.each([
  '保护备份写入',
  '保护备份完整性',
  '保护备份校验后变化',
  '检查点占用',
  '替换复制',
  '连接重开',
  '重开校验',
] as const)('w_hf：%s故障保留当前核心/模块数据，恢复原连接后可合法重试', async (phase) => {
  app = await createTestApp({ modules: [module] });
  await app.svc.settings.set('value', '备份中的旧值');
  const bytes = app.runtime.bookStore.open(app.book.id).raw.serialize();
  await app.svc.settings.set('value', '当前应保护值');
  await app.svc.db
    .withTables<{ restore_test_data: { id: number; value: string } }>()
    .updateTable('restore_test_data')
    .set({ value: '当前模块与打印值' })
    .execute();
  const token = await app.login();
  const ticket = await stage(bytes);
  const store = app.runtime.bookStore;
  const current = store.open(app.book.id);
  if (phase === '保护备份写入')
    vi.spyOn(current.raw, 'backup').mockImplementationOnce(async () => {
      throw new Error(phase);
    });
  if (phase === '保护备份完整性') {
    const original = current.raw.backup.bind(current.raw);
    vi.spyOn(current.raw, 'backup').mockImplementationOnce(async (file, options) => {
      const result = await original(file, options);
      writeFileSync(file, '损坏的保护备份');
      return result;
    });
  }
  if (phase === '保护备份校验后变化') {
    const original = current.raw.pragma.bind(current.raw);
    vi.spyOn(current.raw, 'pragma').mockImplementation((query, options) => {
      if (query === 'wal_checkpoint(TRUNCATE)') {
        const directory = path.join(app.runtime.dataDir, 'core-protection', app.book.id);
        const file = readdirSync(directory).find((name) => name.endsWith('.caiwu'))!;
        writeFileSync(path.join(directory, file), '校验后损坏');
      }
      return original(query, options);
    });
  }
  if (phase === '检查点占用') {
    const original = current.raw.pragma.bind(current.raw);
    vi.spyOn(current.raw, 'pragma').mockImplementation((query, options) =>
      query === 'wal_checkpoint(TRUNCATE)' ? [{ busy: 1 }] : original(query, options),
    );
  }
  if (phase === '替换复制') {
    const original = Database.prototype.backup;
    let injected = false;
    vi.spyOn(Database.prototype, 'backup').mockImplementation(async function (
      this: Database.Database,
      file,
      options,
    ) {
      if (!injected && file === store.pathOf(app.book.id)) {
        injected = true;
        throw new Error(phase);
      }
      return original.call(this, file, options);
    });
  }
  if (phase === '连接重开') {
    const original = store.open.bind(store);
    let injected = false;
    vi.spyOn(store, 'open').mockImplementation((id) => {
      if (!injected && !current.raw.open) {
        injected = true;
        throw new Error(phase);
      }
      return original(id);
    });
  }
  await expect(
    app.runtime.lifecycle.maintainBook({
      token,
      bookId: app.book.id,
      permission: 'restore-test.replace',
      confirmation: { bookId: app.book.id, bookName: app.book.name, password: 'admin' },
      authorize: async () => {},
      plan: {
        kind: 'replace',
        replacementId: ticket.replacementId,
        validate: async () => {
          if (phase === '重开校验') throw new Error(phase);
        },
      },
    }),
  ).rejects.toThrow();
  vi.restoreAllMocks();
  expect(await fresh().settings.get('value', '')).toBe('当前应保护值');
  expect(store.open(app.book.id).raw.prepare('SELECT value FROM restore_test_data').get()).toEqual({
    value: '当前模块与打印值',
  });
  expect(store.open(app.book.id).raw.pragma('integrity_check', { simple: true })).toBe('ok');
  const relogin = await app.login();
  expect(await app.core(relogin).auth.me()).toBeTruthy();
  const retry = await stage(bytes);
  await app.runtime.lifecycle.maintainBook({
    token: relogin,
    bookId: app.book.id,
    permission: 'restore-test.replace',
    confirmation: { bookId: app.book.id, bookName: app.book.name, password: 'admin' },
    authorize: async () => {},
    plan: { kind: 'replace', replacementId: retry.replacementId },
  });
  expect(await fresh().settings.get('value', '')).toBe('备份中的旧值');
});

it('w_hf：目标名称、管理员密码及计划期限必须准确，错误确认不撤销会话、不覆盖', async () => {
  app = await createTestApp({ modules: [module] });
  await app.svc.settings.set('value', '原账保留');
  const bytes = app.runtime.bookStore.open(app.book.id).raw.serialize();
  const token = await app.login();
  const ticket = await stage(bytes);
  for (const confirmation of [
    { bookId: app.book.id, bookName: '错误名称', password: 'admin' },
    { bookId: app.book.id, bookName: app.book.name, password: '错误密码' },
    { bookId: '另一个账套', bookName: app.book.name, password: 'admin' },
  ]) {
    await expect(
      app.runtime.lifecycle.maintainBook({
        token,
        bookId: app.book.id,
        permission: 'restore-test.replace',
        confirmation,
        authorize: async () => {},
        plan: { kind: 'replace', replacementId: ticket.replacementId },
      }),
    ).rejects.toThrow(/准确输入账套名称/);
    expect(app.runtime.sessions.get(token)).toBeTruthy();
    expect(await fresh().settings.get('value', '')).toBe('原账保留');
  }
  await expect(
    app.runtime.bookStore.prepareReplacement({
      bookId: app.book.id,
      bytes,
      length: bytes.length,
      sha256: hash(bytes),
      expectedRevision: app.runtime.bookStore.revision(app.book.id),
      expiresAt: Date.now() - 1,
    }),
  ).rejects.toThrow(/过期/);
});

it.each([
  [
    'trigger',
    "CREATE TRIGGER unsupported AFTER UPDATE ON book_info BEGIN UPDATE book_info SET name='异常' WHERE id=1; END",
  ],
  ['view', 'CREATE VIEW unsupported AS SELECT * FROM book_info'],
] as const)('w_hf：%s 与既有备份安全检查一致，拒绝通过共享恢复旁路引入', async (kind, sql) => {
  app = await createTestApp({ modules: [module] });
  const raw = app.runtime.bookStore.open(app.book.id).raw;
  raw.exec(sql);
  const bytes = raw.serialize();
  raw.exec(`DROP ${kind} unsupported`);
  await expect(stage(bytes)).rejects.toThrow(/未支持的触发器、视图或虚拟表/);
  expect(raw.pragma('integrity_check', { simple: true })).toBe('ok');
  expect(await fresh().book.info()).toMatchObject({ name: app.book.name });
});

it.each([false, true])(
  'w_hf：替换后validate与保护回拷IOERR双故障（路径同时异常=%s）持续隔离读写和登录，修复后验证保护副本才解封',
  async (pathFault) => {
    app = await createTestApp({ modules: [module] });
    const store = app.runtime.bookStore;
    await app.svc.settings.set('value', '被拒收替换账');
    const bytes = store.open(app.book.id).raw.serialize();
    await app.svc.settings.set('value', '原账保护内容');
    const token = await app.login();
    const ticket = await stage(bytes);
    const target = store.pathOf(app.book.id);
    const faultLink = `${target}.fault-link`;
    let linked = false;
    const backup = Database.prototype.backup;
    const spy = vi.spyOn(Database.prototype, 'backup').mockImplementation(async function (
      this: Database.Database,
      file,
      options,
    ) {
      if (this.name.includes('core-protection')) {
        if (pathFault && !linked) {
          linkSync(target, faultLink);
          linked = true;
        }
        throw new Error('SQLITE_IOERR: 保护回拷失败');
      }
      return backup.call(this, file, options);
    });
    try {
      await expect(
        app.runtime.lifecycle.maintainBook({
          token,
          bookId: app.book.id,
          permission: 'restore-test.replace',
          confirmation: { bookId: app.book.id, bookName: app.book.name, password: 'admin' },
          authorize: async () => {},
          plan: {
            kind: 'replace',
            replacementId: ticket.replacementId,
            validate: async () => {
              throw new Error('替换后validate拒收');
            },
          },
        }),
      ).rejects.toThrow(/已隔离/);
      if (existsSync(faultLink)) unlinkSync(faultLink);
      expect(
        existsSync(path.join(app.runtime.dataDir, '.caiwu-runtime.lock', 'maintenance.json')),
      ).toBe(true);
      expect(existsSync(store.pathOf(app.book.id) + '.quarantine.json')).toBe(true);
      expect(() => store.open(app.book.id)).toThrow(/正在维护/);
      await expect(
        store.withBook(app.book.id, async (book) => {
          await book.db.updateTable('book_info').set({ name: '不应提交' }).execute();
        }),
      ).rejects.toThrow(/正在维护/);
      await expect(app.login()).rejects.toThrow(/正在维护/);
      await expect(app.svc.settings.set('value', '不得提交')).rejects.toThrow();
      const protection = path.join(app.runtime.dataDir, 'core-protection', app.book.id);
      const before = readdirSync(protection).map((name) => [
        name,
        hash(readFileSync(path.join(protection, name))),
      ]);
      await expect(
        store.recoverQuarantined({
          bookId: app.book.id,
          bookName: app.book.name,
          adminCode: 'admin',
          password: '错误',
        }),
      ).rejects.toThrow(/管理员账号密码/);
      await expect(
        store.recoverQuarantined({
          bookId: app.book.id,
          bookName: app.book.name,
          adminCode: 'admin',
          password: 'admin',
        }),
      ).rejects.toThrow(/IOERR/);
      expect(() => store.open(app.book.id)).toThrow(/正在维护/);
      spy.mockRestore();
      await store.recoverQuarantined({
        bookId: app.book.id,
        bookName: app.book.name,
        adminCode: 'admin',
        password: 'admin',
      });
      expect(await fresh().settings.get('value', '')).toBe('原账保护内容');
      expect(await app.login()).toBeTruthy();
      expect(
        existsSync(path.join(app.runtime.dataDir, '.caiwu-runtime.lock', 'maintenance.json')),
      ).toBe(false);
      expect(existsSync(store.pathOf(app.book.id) + '.quarantine.json')).toBe(false);
      expect(
        readdirSync(protection).map((name) => [
          name,
          hash(readFileSync(path.join(protection, name))),
        ]),
      ).toEqual(before);
    } finally {
      spy.mockRestore();
      if (existsSync(faultLink)) unlinkSync(faultLink);
      if (existsSync(store.pathOf(app.book.id) + '.quarantine.json'))
        await store.recoverQuarantined({
          bookId: app.book.id,
          bookName: app.book.name,
          adminCode: 'admin',
          password: 'admin',
        });
    }
  },
);
