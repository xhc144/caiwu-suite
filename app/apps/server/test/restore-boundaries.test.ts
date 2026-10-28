import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { defineManifest } from '@caiwu/core';
import { defineMigrations, openDatabase, withTransaction } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import { coreRouter, createRuntime, defineServerModule, moduleKit, t } from '@caiwu/server-kit';

const manifest = defineManifest({
  id: 'restore-boundary',
  name: '合成恢复边界',
  products: 'all',
  permissions: [{ id: 'restore-boundary.restore', name: '恢复' }],
});
const module = defineServerModule(manifest, {
  router: moduleKit(manifest).router({}),
  migrations: defineMigrations([
    {
      id: '0001_data',
      sql: "CREATE TABLE restore_boundary_data(id INTEGER PRIMARY KEY,value TEXT NOT NULL); INSERT INTO restore_boundary_data VALUES(1,'备份业务值')",
    },
  ]),
});
let app: TestApp;
afterEach(async () => {
  vi.restoreAllMocks();
  await app?.close();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const store = () => app.runtime.bookStore;
const current = () => store().open(app.book.id);
const readValue = (raw = current().raw) =>
  raw.prepare('SELECT value FROM restore_boundary_data WHERE id=1').pluck().get();
const setValue = (value: string) =>
  current().raw.prepare('UPDATE restore_boundary_data SET value=? WHERE id=1').run(value);
const protectionDir = () => path.join(app.runtime.dataDir, 'core-protection', app.book.id);
const protections = () =>
  existsSync(protectionDir())
    ? readdirSync(protectionDir()).filter((file) => file.endsWith('.caiwu'))
    : [];
const marker = () => path.join(app.runtime.dataDir, '.caiwu-runtime.lock', 'maintenance.json');
const stage = (bytes: Uint8Array, sourceBookId?: string, expiresAt = Date.now() + 60_000) =>
  store().prepareReplacement({
    bookId: app.book.id,
    sourceBookId,
    bytes,
    length: bytes.byteLength,
    sha256: hash(bytes),
    expectedRevision: store().revision(app.book.id),
    expiresAt,
  });
function checkProtection(expected: string) {
  const files = protections();
  expect(files).toHaveLength(1);
  const file = path.join(protectionDir(), files[0]!);
  const bytes = readFileSync(file);
  expect(JSON.parse(readFileSync(`${file}.json`, 'utf8'))).toMatchObject({
    bookId: app.book.id,
    length: bytes.length,
    sha256: hash(bytes),
  });
  const backup = new Database(file, { readonly: true, fileMustExist: true });
  try {
    expect(readValue(backup)).toBe(expected);
    expect(backup.prepare('SELECT book_id FROM book_info WHERE id=1').pluck().get()).toBe(
      app.book.id,
    );
    expect(backup.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(backup.pragma('foreign_key_check')).toEqual([]);
  } finally {
    backup.close();
  }
}

it('w_hf：源身份必须与已校验元数据一致；其他源只有显式绑定后才能覆盖目标，保护副本保存当前业务值', async () => {
  app = await createTestApp({ modules: [module] });
  const sourceBookId = randomUUID();
  const sourceFile = path.join(app.runtime.dataDir, 'synthetic-source.sqlite');
  await current().raw.backup(sourceFile);
  const source = new Database(sourceFile, { fileMustExist: true });
  let bytes: Buffer;
  try {
    source
      .prepare('UPDATE book_info SET book_id=?,name=? WHERE id=1')
      .run(sourceBookId, '合成来源');
    bytes = source.serialize();
  } finally {
    source.close();
  }
  setValue('目标当前业务值');
  const revision = store().revision(app.book.id);
  for (const expectedSource of [undefined, randomUUID()])
    await expect(stage(bytes, expectedSource)).rejects.toMatchObject({
      data: { code: 'RESTORE_BOOK_MISMATCH' },
    });
  expect(store().revision(app.book.id)).toBe(revision);
  expect(protections()).toEqual([]);
  expect(readdirSync(path.join(app.runtime.dataDir, 'restore-staging'))).toEqual([]);
  const ticket = await stage(bytes, sourceBookId);
  await store().maintain(app.book.id, { kind: 'replace', replacementId: ticket.replacementId });
  expect(readValue()).toBe('备份业务值');
  expect(current().raw.prepare('SELECT book_id,name FROM book_info WHERE id=1').get()).toEqual({
    book_id: app.book.id,
    name: '合成来源',
  });
  checkProtection('目标当前业务值');
  expect(existsSync(marker())).toBe(false);
});

it('w_hf：路径目标、确认目标与文件内身份必须一致，错误身份在撤销会话及备份之前拒绝', async () => {
  app = await createTestApp({ modules: [module] });
  const token = await app.login();
  const bytes = current().raw.serialize();
  const ticket = await stage(bytes);
  const wrongId = randomUUID();
  current().raw.prepare('UPDATE book_info SET book_id=? WHERE id=1').run(wrongId);
  try {
    await expect(stage(bytes)).rejects.toMatchObject({
      data: { code: 'RESTORE_BOOK_MISMATCH' },
    });
    await expect(
      app.runtime.lifecycle.maintainBook({
        token,
        bookId: app.book.id,
        permission: 'restore-boundary.restore',
        confirmation: { bookId: wrongId, bookName: app.book.name, password: 'admin' },
        authorize: async () => {},
        plan: { kind: 'replace', replacementId: ticket.replacementId },
      }),
    ).rejects.toThrow(/准确输入账套名称/);
    expect(app.runtime.sessions.get(token)).toBeTruthy();
    expect(protections()).toEqual([]);
    expect(existsSync(marker())).toBe(false);
  } finally {
    current().raw.prepare('UPDATE book_info SET book_id=? WHERE id=1').run(app.book.id);
  }
});

it.each([NaN, Infinity, -Infinity])(
  'w_hf：非有限期限 %s 不得生成永久有效恢复票据',
  async (expiresAt) => {
    app = await createTestApp({ modules: [module] });
    const revision = store().revision(app.book.id);
    await expect(stage(current().raw.serialize(), undefined, expiresAt)).rejects.toMatchObject({
      data: { code: 'RESTORE_PLAN_EXPIRED' },
    });
    expect(store().revision(app.book.id)).toBe(revision);
  },
);

it('w_hf：额外连接的原生事务拒绝覆盖且不关闭任何句柄，显式提交后重新确认才执行并保护晚提交', async () => {
  app = await createTestApp({ modules: [module] });
  const bytes = current().raw.serialize();
  const ticket = await stage(bytes);
  const cached = current();
  const extra = openDatabase(cached.file);
  try {
    extra.raw.exec("BEGIN IMMEDIATE; UPDATE restore_boundary_data SET value='原生晚提交'");
    await expect(
      store().maintain(app.book.id, { kind: 'replace', replacementId: ticket.replacementId }),
    ).rejects.toMatchObject({ data: { code: 'BOOK_RAW_TRANSACTION_ACTIVE' } });
    expect(extra.raw.inTransaction).toBe(true);
    expect(extra.raw.open).toBe(true);
    expect(cached.raw.open).toBe(true);
    expect(protections()).toEqual([]);
    expect(store().replacementStatus(ticket.replacementId).status).toBe('prepared');
    extra.raw.exec('COMMIT');
    const confirmed = await stage(bytes);
    await store().maintain(app.book.id, {
      kind: 'replace',
      replacementId: confirmed.replacementId,
    });
    expect(extra.raw.open).toBe(false);
    expect(cached.raw.open).toBe(false);
    expect(readValue()).toBe('备份业务值');
    checkProtection('原生晚提交');
    expect(existsSync(marker())).toBe(false);
  } finally {
    if (extra.raw.open && extra.raw.inTransaction) extra.raw.exec('ROLLBACK');
    if (extra.raw.open) await extra.close();
  }
});

it('w_hf：覆盖排空在途事务并拒绝新访问；晚提交令旧计划失效，重新确认后的保护副本包含晚提交', async () => {
  app = await createTestApp({ modules: [module] });
  const bytes = current().raw.serialize();
  const ticket = await stage(bytes);
  const entered = deferred(),
    release = deferred();
  const writing = store().withBook(app.book.id, (book) =>
    withTransaction(book.db, async (trx) => {
      await trx
        .withTables<{ restore_boundary_data: { id: number; value: string } }>()
        .updateTable('restore_boundary_data')
        .set({ value: '排空后的晚提交' })
        .execute();
      entered.resolve();
      await release.promise;
    }),
  );
  await entered.promise;
  const restoring = store().maintain(app.book.id, {
    kind: 'replace',
    replacementId: ticket.replacementId,
  });
  const rejected = expect(restoring).rejects.toMatchObject({
    data: { code: 'RESTORE_TARGET_CHANGED' },
  });
  try {
    expect(() => current()).toThrow(/正在维护/);
    await expect(store().withBook(app.book.id, async () => {})).rejects.toThrow(/正在维护/);
    expect(protections()).toEqual([]);
  } finally {
    release.resolve();
    await writing;
    await rejected;
  }
  expect(readValue()).toBe('排空后的晚提交');
  expect(existsSync(marker())).toBe(false);
  const confirmed = await stage(bytes);
  await store().maintain(app.book.id, { kind: 'replace', replacementId: confirmed.replacementId });
  checkProtection('排空后的晚提交');
  expect(readValue()).toBe('备份业务值');
});

it('w_hf：未知 SQLite 活动读快照使检查点拒绝，目标和保护副本都保留已提交数据', async () => {
  app = await createTestApp({ modules: [module] });
  const cached = current();
  const bytes = cached.raw.serialize();
  const external = new Database(cached.file, { readonly: true, fileMustExist: true });
  try {
    external.exec('BEGIN');
    expect(readValue(external)).toBe('备份业务值');
    setValue('外部快照后的已提交值');
    const ticket = await stage(bytes);
    cached.raw.pragma('busy_timeout = 0');
    await expect(
      store().maintain(app.book.id, { kind: 'replace', replacementId: ticket.replacementId }),
    ).rejects.toMatchObject({ data: { code: 'RESTORE_SQLITE_BUSY' } });
    expect(readValue()).toBe('外部快照后的已提交值');
    expect(readValue(external)).toBe('备份业务值');
    expect(cached.raw.open).toBe(true);
    expect(existsSync(marker())).toBe(false);
    checkProtection('外部快照后的已提交值');
  } finally {
    external.exec('ROLLBACK');
    external.close();
    cached.raw.pragma('busy_timeout = 5000');
  }
});

it('w_hf：受管暂存校验后被篡改时零覆盖、零保护备份，当前业务值不变', async () => {
  app = await createTestApp({ modules: [module] });
  const bytes = current().raw.serialize();
  setValue('不能丢失的当前值');
  const ticket = await stage(bytes);
  const revision = store().revision(app.book.id);
  writeFileSync(
    path.join(app.runtime.dataDir, 'restore-staging', `${ticket.replacementId}.sqlite`),
    '篡改暂存',
  );
  await expect(
    store().maintain(app.book.id, { kind: 'replace', replacementId: ticket.replacementId }),
  ).rejects.toMatchObject({ data: { code: 'RESTORE_DIGEST' } });
  expect(store().revision(app.book.id)).toBe(revision);
  expect(protections()).toEqual([]);
  expect(existsSync(marker())).toBe(false);
});

it.each(['摘要', 'SQLite格式', '外键', '迁移版本'] as const)(
  'w_hf：%s校验失败保留当前账套全部数据，不留下可执行暂存',
  async (fault) => {
    app = await createTestApp({ modules: [module] });
    setValue('校验失败必须保留的值');
    const revision = store().revision(app.book.id);
    let bytes = current().raw.serialize();
    if (fault === 'SQLite格式') bytes = Buffer.from('合成的非SQLite文件');
    if (fault === '外键' || fault === '迁移版本') {
      const file = path.join(app.runtime.dataDir, 'synthetic-invalid.sqlite');
      await current().raw.backup(file);
      const source = new Database(file, { fileMustExist: true });
      try {
        if (fault === '外键') {
          source.pragma('foreign_keys = OFF');
          source.exec('UPDATE account SET parent_id=999999 WHERE parent_id IS NOT NULL');
          expect(source.pragma('foreign_key_check')).not.toEqual([]);
        } else source.exec("UPDATE _migration SET checksum='合成错误校验值' WHERE scope='core'");
        bytes = source.serialize();
      } finally {
        source.close();
      }
    }
    const preparing = store().prepareReplacement({
      bookId: app.book.id,
      bytes,
      length: bytes.length,
      sha256: fault === '摘要' ? '0'.repeat(64) : hash(bytes),
      expectedRevision: revision,
      expiresAt: Date.now() + 60_000,
    });
    await expect(preparing).rejects.toThrow();
    expect(store().revision(app.book.id)).toBe(revision);
    expect(readValue()).toBe('校验失败必须保留的值');
    const directory = path.join(app.runtime.dataDir, 'restore-staging');
    if (existsSync(directory)) expect(readdirSync(directory)).toEqual([]);
    expect(protections()).toEqual([]);
    expect(existsSync(marker())).toBe(false);
  },
);

it('w_hf：保护副本即使SQLite完整但账套身份错误也须阻止覆盖，原账数据保留', async () => {
  app = await createTestApp({ modules: [module] });
  const bytes = current().raw.serialize();
  setValue('身份错误保护副本不能替代的值');
  const ticket = await stage(bytes);
  const original = current().raw.backup.bind(current().raw);
  vi.spyOn(current().raw, 'backup').mockImplementationOnce(async (file, options) => {
    const result = await original(file, options);
    const source = new Database(file, { fileMustExist: true });
    try {
      source.prepare('UPDATE book_info SET book_id=? WHERE id=1').run(randomUUID());
      expect(source.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      source.close();
    }
    return result;
  });
  await expect(
    store().maintain(app.book.id, { kind: 'replace', replacementId: ticket.replacementId }),
  ).rejects.toMatchObject({ data: { code: 'RESTORE_BOOK_MISMATCH' } });
  expect(readValue()).toBe('身份错误保护副本不能替代的值');
  expect(store().replacementStatus(ticket.replacementId).status).toBe('failed');
  expect(existsSync(marker())).toBe(false);
});

it('w_hf：保护备份目录创建失败不遗留 applying 状态或维护门', async () => {
  app = await createTestApp({ modules: [module] });
  const ticket = await stage(current().raw.serialize());
  writeFileSync(path.join(app.runtime.dataDir, 'core-protection'), '合成路径故障');
  await expect(
    store().maintain(app.book.id, { kind: 'replace', replacementId: ticket.replacementId }),
  ).rejects.toThrow();
  expect(store().replacementStatus(ticket.replacementId)).toMatchObject({
    status: 'failed',
    protectionId: null,
  });
  expect(readValue()).toBe('备份业务值');
  expect(existsSync(marker())).toBe(false);
});

it('w_hf：重开后的验证钩子若改变目标身份仍须回滚，不能把错误账套报告为成功', async () => {
  app = await createTestApp({ modules: [module] });
  const bytes = current().raw.serialize();
  setValue('应回滚的当前值');
  const ticket = await stage(bytes);
  await expect(
    store().maintain(app.book.id, {
      kind: 'replace',
      replacementId: ticket.replacementId,
      validate: async (book) => {
        book.raw.prepare('UPDATE book_info SET book_id=? WHERE id=1').run(randomUUID());
      },
    }),
  ).rejects.toMatchObject({ data: { code: 'RESTORE_BOOK_MISMATCH' } });
  expect(readValue()).toBe('应回滚的当前值');
  expect(current().raw.prepare('SELECT book_id FROM book_info WHERE id=1').pluck().get()).toBe(
    app.book.id,
  );
  expect(store().replacementStatus(ticket.replacementId).status).toBe('failed');
  checkProtection('应回滚的当前值');
  expect(existsSync(marker())).toBe(false);
});

it('w_hf：并发及完成后的同票据请求不能再次覆盖，也不能再创建保护备份', async () => {
  app = await createTestApp({ modules: [module] });
  const bytes = current().raw.serialize();
  setValue('唯一保护值');
  const ticket = await stage(bytes);
  const entered = deferred(),
    release = deferred();
  const restoring = store().maintain(app.book.id, {
    kind: 'replace',
    replacementId: ticket.replacementId,
    validate: async () => {
      entered.resolve();
      await release.promise;
    },
  });
  await entered.promise;
  try {
    await expect(
      store().maintain(app.book.id, { kind: 'replace', replacementId: ticket.replacementId }),
    ).rejects.toMatchObject({ data: { code: 'BOOK_MAINTENANCE' } });
    expect(store().replacementStatus(ticket.replacementId).status).toBe('applying');
    expect(existsSync(marker())).toBe(true);
  } finally {
    release.resolve();
    await restoring;
  }
  setValue('成功后的新修改');
  await expect(
    store().maintain(app.book.id, { kind: 'replace', replacementId: ticket.replacementId }),
  ).rejects.toMatchObject({ data: { code: 'RESTORE_PLAN_EXPIRED' } });
  expect(readValue()).toBe('成功后的新修改');
  checkProtection('唯一保护值');
  expect(existsSync(marker())).toBe(false);
});

it.each([false, true])(
  'w_hf：正常重启不重放旧票据（此前已覆盖=%s），数据与保护副本持久保留，旧会话失效',
  async (applied) => {
    app = await createTestApp({ modules: [module] });
    const bytes = current().raw.serialize();
    setValue('重启前当前值');
    const token = await app.login();
    const ticket = await stage(bytes);
    if (applied)
      await store().maintain(app.book.id, { kind: 'replace', replacementId: ticket.replacementId });
    await app.runtime.lifecycle.stop();
    const restarted = createRuntime({
      dataDir: app.runtime.dataDir,
      modules: [module],
      devMode: true,
    });
    try {
      await restarted.lifecycle.start();
      expect(restarted.sessions.get(token)).toBeNull();
      expect(() => restarted.bookStore.replacementStatus(ticket.replacementId)).toThrow(/不存在/);
      await expect(
        restarted.bookStore.maintain(app.book.id, {
          kind: 'replace',
          replacementId: ticket.replacementId,
        }),
      ).rejects.toThrow(/不存在、已使用或过期/);
      expect(readValue(restarted.bookStore.open(app.book.id).raw)).toBe(
        applied ? '备份业务值' : '重启前当前值',
      );
      const api = t.createCallerFactory(t.router({ core: coreRouter }))({
        app: restarted,
        token: null,
      }).core;
      expect(
        await api.auth.login({ bookId: app.book.id, userCode: 'admin', password: 'admin' }),
      ).toMatchObject({
        book: { id: app.book.id },
        token: expect.any(String),
      });
      if (applied) checkProtection('重启前当前值');
      else expect(protections()).toEqual([]);
      expect(existsSync(marker())).toBe(false);
    } finally {
      await restarted.lifecycle.stop();
    }
  },
);
