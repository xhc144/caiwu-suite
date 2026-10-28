import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import { defineManifest } from '@caiwu/core';
import { defineMigrations } from '@caiwu/db';
import { defineServerModule, moduleKit } from '@caiwu/server-kit';
import backupServer from '../server';
import { backupService, waitForJobs } from '../server/service';
import {
  directory,
  fileError,
  hashFile,
  MAGIC,
  packagePath,
  probeDirectory,
  validatePackage,
  writePackage,
} from '../server/files';
import { DEFAULT_SETTINGS, TRANSFER_LIMIT } from '../shared';
import { AutomaticBackupController } from '../server/controller';

const fixtureManifest = defineManifest({
  id: 'backup-fixture',
  name: '测试快照范围',
  products: 'all',
  permissions: [],
  menu: [],
});
const fixture = defineServerModule(fixtureManifest, {
  router: moduleKit(fixtureManifest).router({}),
  migrations: defineMigrations([
    {
      id: '0001_fixture',
      sql: 'CREATE TABLE backup_fixture_report(id INTEGER PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE backup_fixture_print(id INTEGER PRIMARY KEY, body TEXT NOT NULL);',
    },
  ]),
});
const modules = [backupServer, fixture];
let app: TestApp;
let api: ReturnType<typeof caller>;
const caller = (a: TestApp, token?: string) => a.call(backupServer, token);
const extra: TestApp[] = [];
beforeEach(async () => {
  app = await createTestApp({ modules });
  api = caller(app);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await waitForJobs(app.runtime);
  for (const a of extra.splice(0)) {
    await waitForJobs(a.runtime);
    await a.close();
  }
  await app.close();
});
async function create(name = '完整备份') {
  const item = await api.create({ name, requestId: randomUUID() });
  await waitForJobs(app.runtime);
  const row = (await api.list()).find((r) => r.id === item.id)!;
  expect(row.status, row.reason).toBe('valid');
  return row;
}
async function localService(a = app) {
  const token = await a.login();
  const session = a.runtime.sessions.get(token)!;
  const book = a.runtime.bookStore.open(a.book.id);
  const user = (await loadServiceUser(book.db, session.userId))!;
  return backupService({
    app: a.runtime,
    session,
    book,
    user,
    svc: createCoreServices({
      db: book.db,
      user,
      moduleId: 'backup',
      now: a.runtime.now,
      modules: a.runtime.modules.lookup,
    }),
    moduleId: 'backup',
  });
}
async function managedFile(id: string) {
  const row = (await api.list()).find((r) => r.id === id)!;
  return packagePath(await directory(app.runtime.dataDir, app.book.id, row.directory), id);
}
async function code(p: Promise<unknown>) {
  return p.then(
    () => null,
    (e: unknown) =>
      (e as { cause?: { data?: { code: string } }; data?: { code: string } }).cause?.data?.code ??
      (e as { data?: { code: string } }).data?.code,
  );
}
async function mutatePackage(
  bytes: Buffer,
  change: (metadata: Record<string, unknown>, sqlite: Buffer) => void,
) {
  const offset = 12 + bytes.readUInt32BE(8);
  const meta = JSON.parse(bytes.subarray(12, offset).toString()) as Record<string, unknown>;
  const sqlite = Buffer.from(bytes.subarray(offset));
  change(meta, sqlite);
  const json = Buffer.from(JSON.stringify(meta));
  const header = Buffer.alloc(12);
  MAGIC.copy(header);
  header.writeUInt32BE(json.length, 8);
  return Buffer.concat([header, json, sqlite]);
}
async function uploadBytes(bytes: Buffer) {
  return api.upload({ name: '导入测试', base64: bytes.toString('base64') });
}

describe('w_bf 完整在线备份', () => {
  it('w_bf：WAL 中的凭证、多个模块表及元数据全部进入一致快照；可携带到另一数据目录', async () => {
    const raw = app.runtime.bookStore.open(app.book.id).raw;
    raw.pragma('wal_autocheckpoint=0');
    raw.prepare('INSERT INTO backup_fixture_report VALUES (?,?)').run(1, '完整报表');
    raw.prepare('INSERT INTO backup_fixture_print VALUES (?,?)').run(1, '打印格式');
    await seedVouchers(app.svc, [
      {
        date: '2026-01-05',
        lines: [
          { account: '1001', debit: 500 },
          { account: '6603', credit: 500 },
        ],
      },
    ]);
    const row = await create();
    expect(row.metadata?.book.id).toBe(app.book.id);
    expect(row.metadata?.book.currentPeriod).toBe(202601);
    expect(row.metadata?.migrations.some((m) => m.scope === 'backup-fixture')).toBe(true);
    const checked = await validatePackage(await managedFile(row.id), app.runtime);
    const snapshot = new Database(checked.snapshot, { readonly: true });
    expect(snapshot.prepare('SELECT count(*) AS n FROM voucher_line').get()).toEqual({ n: 2 });
    expect(snapshot.prepare('SELECT * FROM backup_fixture_report').get()).toEqual({
      id: 1,
      body: '完整报表',
    });
    expect(snapshot.prepare('SELECT * FROM backup_fixture_print').get()).toEqual({
      id: 1,
      body: '打印格式',
    });
    snapshot.close();
    await rm(checked.snapshot);
    const portable = await api.download({ id: row.id });
    expect(portable.base64).not.toContain(app.runtime.dataDir);
    const other = await createTestApp({ modules });
    extra.push(other);
    const imported = await caller(other).upload({ name: '换机备份', base64: portable.base64 });
    expect(imported.status).toBe('valid');
    expect(JSON.parse(imported.metadata!).book.id).toBe(app.book.id);
  });
  it('w_bf / f_system_backup：活动连接继续提交原子写入，快照没有半次业务事务', async () => {
    const raw = app.runtime.bookStore.open(app.book.id).raw;
    raw.exec(
      'CREATE TABLE backup_fixture_pair(id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, padding TEXT); INSERT INTO backup_fixture_pair VALUES(1,0,hex(zeroblob(2000000))),(2,0,hex(zeroblob(2000000)));',
    );
    const writer = new Database(app.runtime.bookStore.pathOf(app.book.id));
    writer.pragma('journal_mode=WAL');
    let writes = 0;
    const timer = setInterval(() => {
      if (writes < 5)
        writer.transaction(() => {
          writer.prepare('UPDATE backup_fixture_pair SET revision=?').run(++writes);
        })();
    }, 0);
    let row;
    try {
      row = await create();
    } finally {
      clearInterval(timer);
      writer.close();
    }
    expect(writes).toBeGreaterThan(0);
    const checked = await validatePackage(await managedFile(row.id), app.runtime);
    const snap = new Database(checked.snapshot, { readonly: true });
    const pairs = snap.prepare('SELECT revision FROM backup_fixture_pair').all();
    expect(pairs[0]).toEqual(pairs[1]);
    snap.close();
    await rm(checked.snapshot);
  });
  it('w_bf / w_ini_bf：空名和路径名被拒绝；同名不会覆盖；重试幂等', async () => {
    await expect(api.create({ name: ' ', requestId: randomUUID() })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    for (const name of ['../活动账套', '/tmp/x', 'a\\b'])
      await expect(api.create({ name, requestId: randomUUID() })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    const id = randomUUID();
    const first = await api.create({ name: '同名', requestId: id });
    await waitForJobs(app.runtime);
    expect((await api.create({ name: '同名', requestId: id })).id).toBe(first.id);
    const second = await create('同名');
    expect(second.id).not.toBe(first.id);
    expect((await api.list()).filter((r) => r.status === 'valid')).toHaveLength(2);
  });
  it('w_bf：取消清理半成品；中断记录显示失败，不假报成功', async () => {
    const item = await api.create({ name: '取消测试', requestId: randomUUID() });
    await api.cancel({ id: item.id });
    await waitForJobs(app.runtime);
    const row = (await api.list())[0]!;
    expect(row.status).toBe('cancelled');
    expect(await readdir(path.dirname(await managedFile(item.id)))).toEqual([]);
    app.runtime.bookStore
      .open(app.book.id)
      .raw.prepare("UPDATE backup_item SET status='running'")
      .run();
    expect((await api.list())[0]).toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('中断'),
    });
  });
  it('w_bf / f_system_backup：目录不可写、空间不足和 SQLite 备份失败均不发布成功', async () => {
    const raw = app.runtime.bookStore.open(app.book.id).raw;
    const spy = vi
      .spyOn(raw, 'backup')
      .mockRejectedValueOnce(Object.assign(new Error('disk full'), { code: 'ENOSPC' }));
    const row = await api.create({ name: '空间失败', requestId: randomUUID() });
    await waitForJobs(app.runtime);
    expect((await api.list()).find((r) => r.id === row.id)).toMatchObject({
      status: 'failed',
      reason: '磁盘空间不足',
    });
    spy.mockRestore();
    const dir = await directory(app.runtime.dataDir, app.book.id, '空间检查');
    await expect(probeDirectory(dir, Number.MAX_SAFE_INTEGER)).rejects.toThrow('磁盘空间不足');
    expect(fileError({ code: 'EACCES' }).message).toContain('不可写');
    await writeFile(
      path.join(app.runtime.dataDir, 'backups', app.book.id, '坏目录'),
      'not directory',
    );
    await expect(api.saveSettings({ ...DEFAULT_SETTINGS, directory: '坏目录' })).rejects.toThrow(
      '符号链接或普通文件',
    );
  });
});

describe('w_hf / w_tzjl_get 校验和确认', () => {
  it('w_hf：拒绝旧格式、缺元数据、未来版本、半成品、长度和摘要不符及假 SQLite header', async () => {
    const row = await create();
    const bytes = Buffer.from((await api.download({ id: row.id })).base64, 'base64');
    await expect(uploadBytes(Buffer.from('SQL Anywhere .bak'))).rejects.toThrow('SQL Anywhere');
    for (const [change, message] of [
      [
        (m: Record<string, unknown>) => {
          m.version = 99;
        },
        '版本不兼容',
      ],
      [
        (m: Record<string, unknown>) => {
          delete m.book;
        },
        '缺少必要元数据',
      ],
      [
        (m: Record<string, unknown>) => {
          m.length = 1;
        },
        '长度不符',
      ],
      [
        (m: Record<string, unknown>) => {
          m.sha256 = '0'.repeat(64);
        },
        '摘要不符',
      ],
      [
        (_m: Record<string, unknown>, b: Buffer) => {
          b[0] = 0;
        },
        '不是 SQLite',
      ],
      [
        (m: Record<string, unknown>) => {
          (m.book as { name: string }).name = '伪造账套';
        },
        '元数据与 SQLite',
      ],
    ] as const)
      await expect(uploadBytes(await mutatePackage(bytes, change))).rejects.toThrow(message);
    await expect(uploadBytes(bytes.subarray(0, bytes.length - 100))).rejects.toThrow('长度不符');
    expect((await api.list()).filter((r) => r.status === 'valid')).toHaveLength(1);
  });
  it('w_hf：摘要正确但数据库损坏、缺核心表或迁移不兼容仍被拒绝；预览不迁移文件', async () => {
    const row = await create();
    const bytes = Buffer.from((await api.download({ id: row.id })).base64, 'base64');
    const checked = await validatePackage(await managedFile(row.id), app.runtime);
    const raw = new Database(checked.snapshot);
    raw.exec('DROP TABLE voucher_line');
    raw.close();
    let metadata = {
      ...checked.metadata,
      length: (await readFile(checked.snapshot)).length,
      sha256: await hashFile(checked.snapshot),
    };
    let output = path.join(path.dirname(checked.snapshot), `${randomUUID()}.bad`);
    await writePackage(checked.snapshot, output, metadata);
    await expect(uploadBytes(await readFile(output))).rejects.toThrow('核心表');
    await rm(output);
    await rm(checked.snapshot);
    await expect(
      uploadBytes(
        await mutatePackage(bytes, (m, b) => {
          b[100] = 255;
          m.sha256 = createHash('sha256').update(b).digest('hex');
        }),
      ),
    ).rejects.toThrow(/SQLite|校验/);
    const check2 = await validatePackage(await managedFile(row.id), app.runtime);
    const raw2 = new Database(check2.snapshot);
    raw2.prepare("UPDATE _migration SET checksum=? WHERE scope='core'").run('f'.repeat(64));
    raw2.close();
    metadata = { ...check2.metadata, sha256: await hashFile(check2.snapshot) };
    output = path.join(path.dirname(check2.snapshot), `${randomUUID()}.bad`);
    await writePackage(check2.snapshot, output, metadata);
    await expect(uploadBytes(await readFile(output))).rejects.toThrow('迁移版本');
    await rm(output);
    await rm(check2.snapshot);
    const before = await hashFile(await managedFile(row.id));
    await api.preview({ id: row.id, purpose: 'copy' });
    expect(await hashFile(await managedFile(row.id))).toBe(before);
  });
  it('w_hf：symlink 与 ../ 无法跳出受管目录，备份 ID 不能传任意文件路径', async () => {
    const row = await create();
    await expect(api.download({ id: '../active.caiwu' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    const file = await managedFile(row.id);
    await rm(file);
    await symlink(app.runtime.bookStore.pathOf(app.book.id), file);
    await expect(api.download({ id: row.id })).rejects.toThrow('符号链接');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'backup-escape-'));
    try {
      await symlink(dir, path.join(app.runtime.dataDir, 'backups', app.book.id, '逃逸'));
      await expect(api.saveSettings({ ...DEFAULT_SETTINGS, directory: '逃逸' })).rejects.toThrow(
        '符号链接',
      );
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('w_hf：恢复、校验、导出、删除及配置权限彼此独立，恢复还要管理员', async () => {
    const row = await create();
    const viewer = caller(app, await app.addUser('view', { permissions: ['backup.view'] }));
    expect(await viewer.list()).toHaveLength(1);
    const viewerResults = await Promise.all(
      [
        viewer.create({ name: '无权', requestId: randomUUID() }),
        viewer.verify({ id: row.id }),
        viewer.download({ id: row.id }),
        viewer.prune({ id: row.id, text: `删除备份 ${row.id}`, password: 'admin' }),
        viewer.preview({ id: row.id, purpose: 'copy' }),
        viewer.saveSettings(DEFAULT_SETTINGS),
      ].map(code),
    );
    expect(viewerResults).toEqual(Array(6).fill('FORBIDDEN'));
    const restorer = caller(
      app,
      await app.addUser('restore', { permissions: ['backup.restore', 'backup.verify'] }),
    );
    expect(await code(restorer.preview({ id: row.id, purpose: 'copy' }))).toBe('BACKUP_ADMIN');
    const exporter = caller(app, await app.addUser('export', { permissions: ['backup.export'] }));
    expect((await exporter.download({ id: row.id })).base64.length).toBeGreaterThan(100);
  });
  it('w_hf：跨账套不能下载、恢复、删除或取消其他账套备份', async () => {
    const row = await create();
    const second = await app.runtime.bookStore.create({
      name: '其他账套',
      orgName: '另一单位',
      templateId: 'demo-enterprise',
      product: 'chengben',
      startYear: 2026,
      startMonth: 1,
      adminPassword: 'admin',
    });
    const token = (
      await app.core().auth.login({ bookId: second.id, userCode: 'admin', password: 'admin' })
    ).token;
    const other = caller(app, token);
    const otherResults = await Promise.all(
      [
        other.download({ id: row.id }),
        other.verify({ id: row.id }),
        other.prune({ id: row.id, text: `删除备份 ${row.id}`, password: 'admin' }),
        other.preview({ id: row.id, purpose: 'copy' }),
        other.cancel({ id: row.id }),
      ].map(code),
    );
    expect(otherResults).toEqual(Array(5).fill('BACKUP_NOT_FOUND'));
  });
  it('w_hf：密码、指定文字、过期和取消由 API 拒绝；失败不改变原财务数据', async () => {
    const row = await create();
    let plan = await api.preview({ id: row.id, purpose: 'copy' });
    const before = await app.svc.accounts.list();
    expect(
      await code(api.restore({ planId: plan.id, text: plan.confirmation, password: '错误' })),
    ).toBe('BACKUP_CREDENTIAL');
    expect(await code(api.restore({ planId: plan.id, text: '随意', password: 'admin' }))).toBe(
      'BACKUP_CONFIRM',
    );
    app.runtime.now = () => new Date(Date.now() + 20 * 60_000);
    expect(
      await code(api.restore({ planId: plan.id, text: plan.confirmation, password: 'admin' })),
    ).toBe('BACKUP_EXPIRED');
    app.runtime.now = () => new Date();
    await api.cancelPlan({ id: plan.id });
    expect(
      await code(api.restore({ planId: plan.id, text: plan.confirmation, password: 'admin' })),
    ).toBe('BACKUP_EXPIRED');
    plan = await api.preview({ id: row.id, purpose: 'copy' });
    expect(plan.status).toBe('ready');
    expect(await app.svc.accounts.list()).toEqual(before);
    expect(await app.runtime.bookStore.list()).toHaveLength(1);
  });
  it('w_hf：覆盖先做完整保护备份和受管暂存，修改目标后确认失效', async () => {
    const row = await create();
    const plan = await api.preview({ id: row.id, purpose: 'overwrite' });
    expect(
      await code(api.restore({ planId: plan.id, text: plan.confirmation, password: 'admin' })),
    ).toBe('BACKUP_PROTECTION');
    const preparations = await Promise.all([
      api.prepareOverwrite({ planId: plan.id }),
      api.prepareOverwrite({ planId: plan.id }),
    ]);
    const protection = preparations[0];
    expect(preparations[1].protectionId).toBe(protection.protectionId);
    expect((await api.prepareOverwrite({ planId: plan.id })).protectionId).toBe(
      protection.protectionId,
    );
    expect(protection.available).toBe(true);
    expect(Date.parse(protection.expiresAt)).toBeGreaterThan(Date.now());
    expect((await api.list()).find((r) => r.id === protection.protectionId)?.kind).toBe(
      'pre-restore',
    );
    await app.svcFor('backup').settings.set('revision', 'changed');
    expect(
      await code(api.restore({ planId: plan.id, text: plan.confirmation, password: 'admin' })),
    ).toBe('BACKUP_TARGET_CHANGED');
    expect(
      await code(
        api.prune({
          id: protection.protectionId,
          text: `删除备份 ${protection.protectionId}`,
          password: 'admin',
        }),
      ),
    ).toBe('BACKUP_PROTECTED');
    expect(app.runtime.bookStore.open(app.book.id).raw.open).toBe(true);
  });
  it('w_hf：保护备份失败阻止覆盖，不提供跳过；新副本发布失败保留原账套', async () => {
    const row = await create();
    const overwrite = await api.preview({ id: row.id, purpose: 'overwrite' });
    const raw = app.runtime.bookStore.open(app.book.id).raw;
    vi.spyOn(raw, 'backup').mockRejectedValueOnce(new Error('interrupted'));
    expect(await code(api.prepareOverwrite({ planId: overwrite.id }))).toBe('BACKUP_PROTECTION');
    expect((await api.list()).some((r) => r.kind === 'pre-restore' && r.status === 'failed')).toBe(
      true,
    );
    const plan = await api.preview({ id: row.id, purpose: 'copy' });
    const target = app.runtime.bookStore.pathOf(plan.target_id);
    await writeFile(target, '不相关文件');
    await expect(
      api.restore({ planId: plan.id, text: plan.confirmation, password: 'admin' }),
    ).rejects.toThrow();
    expect(await readFile(target, 'utf8')).toBe('不相关文件');
    expect((await app.svc.book.info()).id).toBe(app.book.id);
  });
  it('w_tzjl_get：安全新副本恢复后新 ID/名称一致、旧 token 失效，重登并重试不重复建套', async () => {
    await api.saveSettings({ ...DEFAULT_SETTINGS, intervalMinutes: 15 });
    const row = await create();
    await api.saveSettings({ ...DEFAULT_SETTINGS, intervalMinutes: 120 });
    const plan = await api.preview({ id: row.id, purpose: 'copy', name: '安全新副本' });
    const token = await app.login();
    const result = await caller(app, token).restore({
      planId: plan.id,
      text: plan.confirmation,
      password: 'admin',
    });
    expect(result.bookId).not.toBe(app.book.id);
    expect(app.runtime.sessions.get(token)).toBeNull();
    expect(await code(caller(app, token).list())).toBe('UNAUTHORIZED');
    const logged = await app
      .core()
      .auth.login({ bookId: result.bookId, userCode: 'admin', password: 'admin' });
    const restored = caller(app, logged.token);
    expect((await restored.overview()).config.intervalMinutes).toBe(15);
    expect((await restored.overview()).book).toMatchObject({
      id: result.bookId,
      name: '安全新副本',
    });
    expect(await restored.list()).toEqual([]);
    const original = caller(app, await app.login());
    expect((await original.overview()).config.intervalMinutes).toBe(120);
    expect(
      await original.restore({ planId: plan.id, text: plan.confirmation, password: 'admin' }),
    ).toMatchObject({ bookId: result.bookId });
    expect(await app.runtime.bookStore.list()).toHaveLength(2);
  });
  it('w_tzjl_get_all：合法项独立导入、重复包和计划复用，坏包失败不污染其他项', async () => {
    const row = await create();
    const portable = await api.download({ id: row.id });
    const plan = await api.preview({ id: row.id, purpose: 'copy' });
    expect((await api.upload({ name: '重复文件', base64: portable.base64 })).id).toBe(row.id);
    expect((await api.preview({ id: row.id, purpose: 'copy' })).target_id).toBe(plan.target_id);
    await expect(uploadBytes(Buffer.from('坏包'))).rejects.toThrow();
    expect((await api.list()).filter((r) => r.status === 'valid')).toHaveLength(1);
    await api.cancelPlan({ id: plan.id });
    const again = await api.preview({ id: row.id, purpose: 'copy' });
    expect(again.target_id).not.toBe(plan.target_id);
  });
  it('w_tzjl_get_all：HTTP 上限以内逐包发送，超 32 MiB 明确拒绝', async () => {
    expect(Math.ceil(TRANSFER_LIMIT / 3) * 4 + 1000).toBeLessThan(50 * 1024 * 1024);
    await expect(
      api.upload({ name: '过大', base64: 'a'.repeat(Math.ceil(TRANSFER_LIMIT / 3) * 4 + 4) }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('w_autobak 控制器与保留规则', () => {
  it('w_autobak：默认开启；空目录、路径、无效间隔/份数被拒绝，失败保留旧配置', async () => {
    expect((await api.overview()).config.enabled).toBe(true);
    expect((await api.overview()).runtimeStatus).toContain('已启用自动备份');
    expect((await api.overview()).nextAt).toBeNull();
    for (const patch of [
      { directory: '' },
      { directory: '../x' },
      { intervalMinutes: 0 },
      { keep: 0 },
      { keep: 101 },
    ])
      await expect(api.saveSettings({ ...DEFAULT_SETTINGS, ...patch })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    expect((await api.overview()).config).toEqual(DEFAULT_SETTINGS);
  });
  it('w_autobak：新备份成功校验后，只轮替当前账套受管自动文件，不删手动、保护或未知文件', async () => {
    const svc = await localService();
    await api.saveSettings({ ...DEFAULT_SETTINGS, keep: 1 });
    const manual = await create();
    const protection = await svc.create(
      { name: '保护', requestId: randomUUID() },
      'pre-restore',
      true,
    );
    const first = await svc.create({ name: '自动1', requestId: randomUUID() }, 'automatic', true);
    const dir = await directory(app.runtime.dataDir, app.book.id, DEFAULT_SETTINGS.directory);
    const unknown = path.join(dir, 'unknown.caiwubak');
    await writeFile(unknown, '未知文件');
    app.runtime.now = () => new Date(Date.now() + 60_000);
    const second = await svc.create({ name: '自动2', requestId: randomUUID() }, 'automatic', true);
    expect(second.status).toBe('valid');
    const rows = await api.list();
    expect(rows.find((r) => r.id === first.id)?.status).toBe('pruned');
    expect(rows.find((r) => r.id === second.id)?.status).toBe('valid');
    expect(rows.find((r) => r.id === manual.id)?.status).toBe('valid');
    expect(rows.find((r) => r.id === protection.id)?.status).toBe('valid');
    expect(await readFile(unknown, 'utf8')).toBe('未知文件');
    vi.spyOn(app.runtime.bookStore.open(app.book.id).raw, 'backup').mockRejectedValueOnce(
      new Error('failed'),
    );
    await svc.create({ name: '失败自动', requestId: randomUUID() }, 'automatic', true);
    expect((await api.list()).find((r) => r.id === second.id)?.status).toBe('valid');
  });
  it('w_autobak：损坏文件不删除，最后一份有效自动备份保留', async () => {
    const svc = await localService();
    await api.saveSettings({ ...DEFAULT_SETTINGS, keep: 1 });
    const first = await svc.create({ name: '自动1', requestId: randomUUID() }, 'automatic', true);
    const file = await managedFile(first.id);
    await rm(file);
    await symlink(app.runtime.bookStore.pathOf(app.book.id), file);
    const next = await svc.create({ name: '自动2', requestId: randomUUID() }, 'automatic', true);
    expect(next.status).toBe('valid');
    expect(
      (await api.list()).filter((r) => r.kind === 'automatic' && r.status === 'valid'),
    ).toHaveLength(1);
    expect((await api.list()).find((r) => r.id === first.id)?.status).toBe('invalid');
  });
  it('w_autobak：时钟可控、定时不重入、退出等待运行中的备份并返回失败提示', async () => {
    let tick = Date.now();
    const timers = new Map<number, () => void>();
    let sequence = 0;
    let release: () => void = () => {};
    let calls = 0;
    const controller = new AutomaticBackupController({
      now: () => tick,
      set: (fn) => {
        timers.set(++sequence, fn);
        return sequence;
      },
      clear: (id) => {
        timers.delete(id as number);
      },
    });
    await controller.attach('book', {
      settings: async () => ({ ...DEFAULT_SETTINGS, onStart: false }),
      backup: async () => {
        calls++;
        if (calls === 1)
          await new Promise<void>((r) => {
            release = r;
          });
        return calls === 1
          ? { status: 'valid', reason: '' }
          : { status: 'failed', reason: '退出时磁盘空间不足' };
      },
    });
    expect(controller.status('book').nextAt).not.toBeNull();
    const running = controller.run('book');
    const duplicate = controller.run('book');
    await Promise.resolve();
    expect(calls).toBe(1);
    let shutdownDone = false;
    const shutdown = controller.shutdown().then((r) => {
      shutdownDone = true;
      return r;
    });
    expect(shutdownDone).toBe(false);
    tick += 60_000;
    release();
    await Promise.all([running, duplicate]);
    expect(await shutdown).toEqual([{ bookId: 'book', reason: '退出时磁盘空间不足' }]);
    expect(timers.size).toBe(0);
    expect(controller.status('book').attached).toBe(false);
  });
});

describe('w_bf / w_hf 竞争与安全补充', () => {
  it('w_bf：并发重复请求只生成一份，其他并发任务明确阻止', async () => {
    const requestId = randomUUID();
    const results = await Promise.all([
      api.create({ requestId, name: '并发备份' }),
      api.create({ requestId, name: '并发备份' }),
    ]);
    expect(results[0].id).toBe(results[1].id);
    await waitForJobs(app.runtime);
    expect((await api.list()).filter((r) => r.status === 'valid')).toHaveLength(1);
    const raw = app.runtime.bookStore.open(app.book.id).raw;
    const real = raw.backup.bind(raw);
    let release: () => void = () => {};
    let startedResolve: () => void = () => {};
    const started = new Promise<void>((r) => {
      startedResolve = r;
    });
    vi.spyOn(raw, 'backup').mockImplementation(async (...args) => {
      startedResolve();
      await new Promise<void>((r) => {
        release = r;
      });
      return real(...args);
    });
    await api.create({ requestId: randomUUID(), name: '阻塞中的备份' });
    await started;
    expect(await code(api.create({ requestId: randomUUID(), name: '并发第二份' }))).toBe(
      'BACKUP_BUSY',
    );
    release();
    await waitForJobs(app.runtime);
  });
  it('w_hf：未来应用版本以及带触发器的文件拒绝，校验不会执行输入 SQL', async () => {
    const row = await create();
    const bytes = Buffer.from((await api.download({ id: row.id })).base64, 'base64');
    await expect(
      uploadBytes(
        await mutatePackage(bytes, (m) => {
          m.appVersion = '999.0.0';
        }),
      ),
    ).rejects.toThrow('应用版本');
    const checked = await validatePackage(await managedFile(row.id), app.runtime);
    const raw = new Database(checked.snapshot);
    raw.exec('CREATE TRIGGER malicious AFTER UPDATE ON book_info BEGIN DELETE FROM account; END;');
    raw.close();
    const metadata = { ...checked.metadata, sha256: await hashFile(checked.snapshot) };
    const output = path.join(path.dirname(checked.snapshot), `${randomUUID()}.trigger`);
    await writePackage(checked.snapshot, output, metadata);
    await expect(uploadBytes(await readFile(output))).rejects.toThrow('触发器');
    await rm(output);
    await rm(checked.snapshot);
    expect((await app.svc.accounts.list()).length).toBeGreaterThan(0);
  });
  it('w_hf：删除 API 强制复核密码和目标文字，拒绝替换后的未知文件', async () => {
    const row = await create();
    expect(await code(api.prune({ id: row.id, text: `删除备份 ${row.id}`, password: 'bad' }))).toBe(
      'BACKUP_CREDENTIAL',
    );
    expect(await code(api.prune({ id: row.id, text: '删除', password: 'admin' }))).toBe(
      'BACKUP_CONFIRM',
    );
    await writeFile(await managedFile(row.id), '外部替换后的未知文件');
    expect(
      await code(api.prune({ id: row.id, text: `删除备份 ${row.id}`, password: 'admin' })),
    ).toBe('BACKUP_CHANGED');
    expect(await readFile(await managedFile(row.id), 'utf8')).toBe('外部替换后的未知文件');
    const good = await create('可删除备份');
    await api.prune({ id: good.id, text: `删除备份 ${good.id}`, password: 'admin' });
    expect((await api.list()).find((r) => r.id === good.id)?.status).toBe('pruned');
  });
  it('w_hf：新副本目标为 symlink 时拒绝，不读取或覆盖链接目标', async () => {
    const row = await create();
    const plan = await api.preview({ id: row.id, purpose: 'copy' });
    const source = app.runtime.bookStore.pathOf(app.book.id);
    const target = app.runtime.bookStore.pathOf(plan.target_id);
    await symlink(source, target);
    try {
      expect(
        await code(api.restore({ planId: plan.id, text: plan.confirmation, password: 'admin' })),
      ).toBe('BACKUP_COLLISION');
      expect((await app.svc.book.info()).id).toBe(app.book.id);
    } finally {
      // 仅移除测试创建的链接；共享关闭保护会拒绝残留链接，不能靠放宽保护清理夹具。
      await rm(target);
    }
  });
  it('w_hf：过期后重新预览可续期，目标新 ID 保持一致', async () => {
    const row = await create();
    const first = await api.preview({ id: row.id, purpose: 'copy' });
    app.runtime.now = () => new Date(Date.now() + 20 * 60_000);
    const next = await api.preview({ id: row.id, purpose: 'copy' });
    expect(next.target_id).toBe(first.target_id);
    expect(next.expires_at > first.expires_at).toBe(true);
  });
});
