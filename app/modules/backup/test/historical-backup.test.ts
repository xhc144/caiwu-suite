import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { coreMigrations } from '@caiwu/core/server';
import { runMigrations } from '@caiwu/db';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import backupServer from '../server';
import {
  directory,
  hashFile,
  inspectSqlite,
  migrationList,
  packagePath,
  validatePackage,
  writePackage,
} from '../server/files';
import { waitForJobs } from '../server/service';
import { MetadataSchema, type BackupMetadata } from '../shared';

let app: TestApp;
let dir: string;
const otherApps: TestApp[] = [];
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const amounts = (raw: Database.Database) =>
  raw.prepare('SELECT debit_total FROM voucher ORDER BY id').all();
const migrations = (raw: Database.Database) =>
  raw
    .prepare('SELECT scope,id,checksum FROM _migration ORDER BY scope,id')
    .all() as BackupMetadata['migrations'];

beforeEach(async () => {
  app = await createTestApp({ modules: [backupServer] });
  dir = await mkdtemp(path.join(os.tmpdir(), 'backup-history-'));
  await seed(12345);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await waitForJobs(app.runtime);
  for (const other of otherApps.splice(0)) {
    await waitForJobs(other.runtime);
    await other.close();
  }
  await app.close();
  await rm(dir, { recursive: true, force: true });
});
async function seed(amount: number) {
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      lines: [
        { account: '1001', debit: amount },
        { account: '6603', credit: amount },
      ],
    },
  ]);
}

/** 从 0001..0003 的已发布 SQL 直接建库，再填业务行；从未打开旧库作自动升级。 */
async function oldPackage(
  change?: (raw: Database.Database) => void,
  changeMetadata?: (metadata: BackupMetadata) => void,
) {
  const source = app.runtime.bookStore.open(app.book.id).raw;
  const file = path.join(dir, `${randomUUID()}.sqlite`);
  const raw = new Database(file);
  let applied: BackupMetadata['migrations'];
  try {
    const historicalCore = coreMigrations.filter((m) => m.id <= '0003_account_closing_rule');
    expect(historicalCore.map((m) => m.id)).toEqual([
      '0001_core',
      '0002_shared_semantics',
      '0003_account_closing_rule',
    ]);
    runMigrations(raw, [
      { scope: 'core', migrations: historicalCore },
      ...app.runtime.modules.migrationSets(),
    ]);
    const tables = raw
      .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name <> '_migration'")
      .all() as { name: string }[];
    raw.transaction(() => {
      for (const { name } of tables) {
        const rows = source.prepare(`SELECT * FROM ${quote(name)}`).all() as Record<
          string,
          string | number | null
        >[];
        if (!rows.length) continue;
        const columns = Object.keys(rows[0]!);
        const insert = raw.prepare(
          `INSERT INTO ${quote(name)} (${columns.map(quote).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
        );
        for (const row of rows) insert.run(...columns.map((column) => row[column]));
      }
    })();
    expect(
      raw.prepare("SELECT name FROM sqlite_schema WHERE name='voucher_line_account_voucher'").get(),
    ).toBeUndefined();
    expect(amounts(raw)).toEqual([{ debit_total: 12345 }]);
    change?.(raw);
    applied = migrations(raw);
  } finally {
    raw.close();
  }
  const bytes = await readFile(file);
  const metadata = MetadataSchema.parse({
    format: 'caiwu-sqlite-backup',
    version: 1,
    appVersion: app.runtime.version,
    createdAt: app.runtime.now().toISOString(),
    type: 'manual',
    length: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    book: inspectSqlite(app.runtime.bookStore.pathOf(app.book.id), app.runtime).book,
    migrations: applied,
  });
  changeMetadata?.(metadata);
  const output = path.join(dir, `${randomUUID()}.caiwubak`);
  await writePackage(file, output, metadata);
  return { file: output, bytes: await readFile(output), metadata };
}
async function upload(fixture: Awaited<ReturnType<typeof oldPackage>>) {
  return app
    .call(backupServer)
    .upload({ name: '旧版0003完整备份', base64: fixture.bytes.toString('base64') });
}
function assertCurrent(raw: Database.Database) {
  expect(migrations(raw)).toEqual(migrationList(app.runtime));
  expect(
    raw.prepare("SELECT sql FROM sqlite_schema WHERE name='voucher_line_account_voucher'").get(),
  ).toEqual({
    sql: 'CREATE INDEX voucher_line_account_voucher ON voucher_line(account_id, voucher_id)',
  });
  expect(raw.pragma('integrity_check', { simple: true })).toBe('ok');
  expect(raw.pragma('foreign_key_check')).toEqual([]);
}

it('w_hf / w_tzjl_get：真实0003包在新0004程序校验、预览和新副本恢复，原包和源账均保留', async () => {
  const fixture = await oldPackage();
  const originalRevision = app.runtime.bookStore.revision(app.book.id);
  const checked = await validatePackage(fixture.file, app.runtime, true);
  try {
    expect(checked.metadata).toEqual(fixture.metadata);
    expect(checked.content).toEqual(fixture.bytes);
    expect(checked.digest).toBe(createHash('sha256').update(fixture.bytes).digest('hex'));
    const stagedBytes = await readFile(checked.snapshot);
    expect(stagedBytes.length).toBe(checked.snapshotLength);
    expect(createHash('sha256').update(stagedBytes).digest('hex')).toBe(checked.snapshotSha256);
    expect(checked.snapshotSha256).not.toBe(fixture.metadata.sha256);
    const staged = new Database(checked.snapshot, { readonly: true });
    try {
      assertCurrent(staged);
      expect(amounts(staged)).toEqual([{ debit_total: 12345 }]);
      expect(staged.prepare('SELECT book_id FROM book_info').get()).toEqual({
        book_id: app.book.id,
      });
    } finally {
      staged.close();
    }
  } finally {
    await rm(checked.snapshot);
  }
  expect(app.runtime.bookStore.revision(app.book.id)).toBe(originalRevision);
  const item = await upload(fixture);
  const api = app.call(backupServer);
  expect(await api.verify({ id: item.id })).toEqual(fixture.metadata);
  const p = await api.preview({ id: item.id, purpose: 'copy', name: '旧版恢复副本' });
  expect(p.metadata).toEqual(fixture.metadata);
  const result = await api.restore({ planId: p.id, text: p.confirmation, password: 'admin' });
  expect(result.bookId).not.toBe(app.book.id);
  const restored = app.runtime.bookStore.open(result.bookId).raw;
  assertCurrent(restored);
  expect(amounts(restored)).toEqual([{ debit_total: 12345 }]);
  expect(restored.prepare('SELECT book_id,name FROM book_info').get()).toEqual({
    book_id: result.bookId,
    name: '旧版恢复副本',
  });
  expect(amounts(app.runtime.bookStore.open(app.book.id).raw)).toEqual([{ debit_total: 12345 }]);
  const fresh = app.call(backupServer, await app.login());
  expect(Buffer.from((await fresh.download({ id: item.id })).base64, 'base64')).toEqual(
    fixture.bytes,
  );
  expect(await readFile(fixture.file)).toEqual(fixture.bytes);
  expect(
    (await readdir(path.join(app.runtime.dataDir, 'backups', app.book.id, '上传'))).filter((n) =>
      n.endsWith('.checking'),
    ),
  ).toEqual([]);
});

it('w_hf：真实0003包覆盖恢复保留目标身份、旧包和完整保护，升级摘要绑定受管暂存', async () => {
  const fixture = await oldPackage();
  const item = await upload(fixture);
  await seed(67890);
  const api = app.call(backupServer);
  const p = await api.preview({ id: item.id, purpose: 'overwrite' });
  const stage = vi.spyOn(app.runtime.bookStore, 'prepareReplacement');
  const protection = await api.prepareOverwrite({ planId: p.id });
  const input = stage.mock.calls[0]![0];
  expect(input.sourceBookId).toBe(fixture.metadata.book.id);
  expect(input.length).toBe(input.bytes.length);
  expect(input.sha256).toBe(createHash('sha256').update(input.bytes).digest('hex'));
  expect(input.sha256).not.toBe(fixture.metadata.sha256);
  const result = await api.restore({ planId: p.id, text: p.confirmation, password: 'admin' });
  expect(result).toMatchObject({ bookId: app.book.id, name: app.book.name, purpose: 'overwrite' });
  const restored = app.runtime.bookStore.open(app.book.id).raw;
  assertCurrent(restored);
  expect(amounts(restored)).toEqual([{ debit_total: 12345 }]);
  const fresh = app.call(backupServer, await app.login());
  expect(await fresh.verify({ id: item.id })).toEqual(fixture.metadata);
  expect(Buffer.from((await fresh.download({ id: item.id })).base64, 'base64')).toEqual(
    fixture.bytes,
  );
  const row = (await fresh.list()).find((r) => r.id === protection.protectionId)!;
  const checked = await validatePackage(
    packagePath(await directory(app.runtime.dataDir, app.book.id, row.directory), row.id),
    app.runtime,
  );
  const before = new Database(checked.snapshot, { readonly: true });
  try {
    expect(amounts(before)).toEqual([{ debit_total: 12345 }, { debit_total: 67890 }]);
    assertCurrent(before);
  } finally {
    before.close();
    await rm(checked.snapshot);
  }
  expect(
    (await readdir(path.join(app.runtime.dataDir, 'core-protection', app.book.id))).filter((n) =>
      n.endsWith('.caiwu'),
    ),
  ).toHaveLength(1);
  expect(await readFile(fixture.file)).toEqual(fixture.bytes);
});

it('w_hf：另一账套的真实0003包先核源身份再覆盖目标，源账、目标编号及完整保护均保留', async () => {
  const fixture = await oldPackage();
  const target = await createTestApp({ modules: [backupServer] });
  otherApps.push(target);
  await seedVouchers(target.svc, [
    {
      date: '2026-01-05',
      lines: [
        { account: '1001', debit: 98765 },
        { account: '6603', credit: 98765 },
      ],
    },
  ]);
  const api = target.call(backupServer);
  const item = await api.upload({
    name: '另一账套旧版包',
    base64: fixture.bytes.toString('base64'),
  });
  const p = await api.preview({ id: item.id, purpose: 'overwrite' });
  const stage = vi.spyOn(target.runtime.bookStore, 'prepareReplacement');
  const protection = await api.prepareOverwrite({ planId: p.id });
  expect(stage.mock.calls[0]![0]).toMatchObject({
    sourceBookId: app.book.id,
    bookId: target.book.id,
  });
  await api.restore({ planId: p.id, text: p.confirmation, password: 'admin' });
  const restored = target.runtime.bookStore.open(target.book.id).raw;
  assertCurrent(restored);
  expect(restored.prepare('SELECT book_id FROM book_info').get()).toEqual({
    book_id: target.book.id,
  });
  expect(amounts(restored)).toEqual([{ debit_total: 12345 }]);
  expect(amounts(app.runtime.bookStore.open(app.book.id).raw)).toEqual([{ debit_total: 12345 }]);
  const fresh = target.call(backupServer, await target.login());
  expect((await fresh.verify({ id: item.id })).book.id).toBe(app.book.id);
  const row = (await fresh.list()).find((r) => r.id === protection.protectionId)!;
  const checked = await validatePackage(
    packagePath(await directory(target.runtime.dataDir, target.book.id, row.directory), row.id),
    target.runtime,
  );
  const before = new Database(checked.snapshot, { readonly: true });
  try {
    expect(amounts(before)).toEqual([{ debit_total: 98765 }]);
    expect(checked.metadata.book.id).toBe(target.book.id);
  } finally {
    before.close();
    await rm(checked.snapshot);
  }
});

it.each([
  [
    '未来迁移',
    (raw: Database.Database) =>
      raw
        .prepare('INSERT INTO _migration VALUES (?,?,?,?)')
        .run('core', '0005_future', 'a'.repeat(64), new Date().toISOString()),
    '迁移版本',
  ],
  [
    '未知模块',
    (raw: Database.Database) =>
      raw
        .prepare('INSERT INTO _migration VALUES (?,?,?,?)')
        .run('unknown', '0001_unknown', 'a'.repeat(64), new Date().toISOString()),
    '迁移版本',
  ],
  [
    '已发布checksum被改',
    (raw: Database.Database) =>
      raw
        .prepare(
          "UPDATE _migration SET checksum=? WHERE scope='core' AND id='0002_shared_semantics'",
        )
        .run('f'.repeat(64)),
    '迁移版本',
  ],
  [
    '迁移断档',
    (raw: Database.Database) =>
      raw.prepare("DELETE FROM _migration WHERE scope='core' AND id='0002_shared_semantics'").run(),
    '迁移版本',
  ],
  [
    '缺少整个模块',
    (raw: Database.Database) => raw.prepare("DELETE FROM _migration WHERE scope='backup'").run(),
    '迁移版本',
  ],
  [
    '缺少整个core',
    (raw: Database.Database) => raw.prepare("DELETE FROM _migration WHERE scope='core'").run(),
    '迁移版本',
  ],
  [
    '伪称更早版本',
    (raw: Database.Database) =>
      raw
        .prepare("DELETE FROM _migration WHERE scope='core' AND id='0003_account_closing_rule'")
        .run(),
    '表结构',
  ],
  [
    '缺少历史索引',
    (raw: Database.Database) => raw.exec('DROP INDEX voucher_line_period'),
    '表结构',
  ],
  [
    '未知表',
    (raw: Database.Database) => raw.exec('CREATE TABLE unknown_data(id INTEGER)'),
    '表结构',
  ],
  [
    '仿内部表名',
    (raw: Database.Database) => raw.exec('CREATE TABLE sqlitex_unknown(id INTEGER)'),
    '表结构',
  ],
  [
    '假冒新索引',
    (raw: Database.Database) =>
      raw.exec('CREATE INDEX voucher_line_account_voucher ON voucher_line(account_id)'),
    '表结构',
  ],
  [
    '冒充当前但缺少索引',
    (raw: Database.Database) => {
      const m = migrationList(app.runtime).find((m) => m.id === '0004_voucher_line_query_index')!;
      raw
        .prepare('INSERT INTO _migration VALUES (?,?,?,?)')
        .run(m.scope, m.id, m.checksum, new Date().toISOString());
    },
    '表结构',
  ],
  ['缺少核心表', (raw: Database.Database) => raw.exec('DROP TABLE voucher_line'), '核心表'],
  [
    '关联数据损坏',
    (raw: Database.Database) =>
      raw.exec('PRAGMA foreign_keys=OFF; UPDATE voucher_line SET account_id=999999'),
    '关联数据不完整',
  ],
  [
    '篡改表约束',
    (raw: Database.Database) =>
      raw.exec(
        'ALTER TABLE book_info RENAME TO old_book_info; CREATE TABLE book_info AS SELECT * FROM old_book_info; DROP TABLE old_book_info;',
      ),
    '表结构',
  ],
] as const)(
  'w_hf：旧包%s即使重算包摘要和迁移元数据仍拒绝，目标不变且临时文件清理',
  async (_label, change, message) => {
    const fixture = await oldPackage(change);
    const revision = app.runtime.bookStore.revision(app.book.id);
    await expect(validatePackage(fixture.file, app.runtime)).rejects.toThrow(message);
    await expect(upload(fixture)).rejects.toThrow(message);
    expect(app.runtime.bookStore.revision(app.book.id)).toBe(revision);
    expect(amounts(app.runtime.bookStore.open(app.book.id).raw)).toEqual([{ debit_total: 12345 }]);
    expect(await app.call(backupServer).list()).toEqual([]);
    expect((await readdir(dir)).filter((n) => n.includes('.checking'))).toEqual([]);
    expect(await readFile(fixture.file)).toEqual(fixture.bytes);
  },
);

it.each([
  [
    '未来应用版本',
    (m: BackupMetadata) => {
      m.appVersion = '999.0.0';
    },
    '更新或无法识别',
  ],
  [
    '源身份不符',
    (m: BackupMetadata) => {
      m.book.id = randomUUID();
    },
    '元数据与 SQLite',
  ],
  [
    '原摘要不符',
    (m: BackupMetadata) => {
      m.sha256 = 'f'.repeat(64);
    },
    '摘要不符',
  ],
  [
    '迁移清单与包不符',
    (m: BackupMetadata) => {
      m.migrations = migrationList(app.runtime);
    },
    '迁移版本不一致',
  ],
] as const)('w_hf：旧包%s在升级前拒绝且目标不变', async (_label, change, message) => {
  const fixture = await oldPackage(undefined, change);
  const revision = app.runtime.bookStore.revision(app.book.id);
  await expect(upload(fixture)).rejects.toThrow(message);
  expect(app.runtime.bookStore.revision(app.book.id)).toBe(revision);
  expect(await readFile(fixture.file)).toEqual(fixture.bytes);
});

it('w_hf：旧包准备后升级副本被改拒绝覆盖，目标和已经生成的完整保护备份均保留', async () => {
  const fixture = await oldPackage();
  const item = await upload(fixture);
  await seed(67890);
  const api = app.call(backupServer);
  const p = await api.preview({ id: item.id, purpose: 'overwrite' });
  const prepare = app.runtime.bookStore.prepareReplacement.bind(app.runtime.bookStore);
  vi.spyOn(app.runtime.bookStore, 'prepareReplacement').mockImplementationOnce((input) => {
    const bytes = Uint8Array.from(input.bytes);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    return prepare({ ...input, bytes });
  });
  await expect(api.prepareOverwrite({ planId: p.id })).rejects.toThrow('摘要不符');
  expect(amounts(app.runtime.bookStore.open(app.book.id).raw)).toEqual([
    { debit_total: 12345 },
    { debit_total: 67890 },
  ]);
  const protection = (await api.list()).find((row) => row.kind === 'pre-restore')!;
  expect(protection.status).toBe('valid');
  expect((await api.verify({ id: protection.id })).type).toBe('pre-restore');
  expect(await hashFile(fixture.file)).toBe(
    createHash('sha256').update(fixture.bytes).digest('hex'),
  );
});
