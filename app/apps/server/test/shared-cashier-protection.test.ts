import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, expect, it, vi } from 'vitest';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import type { AuthedContext, AppRuntime } from '@caiwu/server-kit';
import cashier from '../../../modules/cashier/server';
import backup from '../../../modules/backup/server';
import { backupService, waitForJobs } from '../../../modules/backup/server/service';
import {
  cashierResetProtection,
  withCashierResetProtection,
} from '../src/cashier-reset-protection';
import { createServer, type CaiwuServer } from '../src/server';

const apps: TestApp[] = [];
const servers: CaiwuServer[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) await server.fastify.close();
  for (const app of apps.splice(0)) await app.close();
});

async function fixture(withBackup = true) {
  const app = await createTestApp({
    modules: [withCashierResetProtection(cashier), ...(withBackup ? [backup] : [])],
  });
  apps.push(app);
  const api = app.call(cashier);
  await api.enable({ period: 202601 });
  const account = await api.saveAccount({
    data: {
      name: '合成出纳银行',
      coreAccountId: (await app.svc.accounts.require('100201')).id,
      currency: 'CNY',
      opening: 20000,
    },
  });
  const document = {
    accountId: account.id,
    period: 202601,
    date: '2026-01-12',
    summary: '待保护的合成收款',
    direction: 'receipt' as const,
    amount: 5000,
    dimensions: { cashflow: (await app.svc.dimensions.getByCode('cashflow', 'CF01'))!.id },
    requestKey: randomUUID(),
  };
  await api.createDocument(document);
  const request = {
    period: 202602,
    snapshot: (await api.resetPreview()).snapshot,
    bookName: app.book.name,
    confirmation: '清空出纳数据' as const,
    confirmed: true as const,
    requestKey: randomUUID(),
  };
  return { app, api, document, request, raw: app.runtime.bookStore.open(app.book.id).raw };
}

async function context(app: TestApp): Promise<AuthedContext & { app: AppRuntime }> {
  const token = await app.login();
  return {
    app: app.runtime,
    session: app.runtime.sessions.get(token)!,
    book: app.runtime.bookStore.open(app.book.id),
    user: (await loadServiceUser(app.svc.db, 1))!,
    svc: app.svcFor('cashier'),
    moduleId: 'cashier',
  };
}
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
async function snapshot(app: TestApp, id: string) {
  const record = (await app.call(backup).list()).find((row) => row.id === id)!;
  const file = path.join(
    app.runtime.dataDir,
    'backups',
    app.book.id,
    record.directory,
    `${id}.caiwubak`,
  );
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 8).toString()).toBe('CAIWUBK1');
  expect(digest(bytes)).toBe(record.digest);
  const headerLength = bytes.readUInt32BE(8);
  const content = bytes.subarray(12 + headerLength);
  expect(digest(content)).toBe(record.metadata!.sha256);
  expect(record.metadata!.book.id).toBe(app.book.id);
  const extracted = path.join(app.runtime.dataDir, `synthetic-verified-${id}.caiwu`);
  writeFileSync(extracted, content, { flag: 'wx' });
  return { record, raw: new Database(extracted, { readonly: true, fileMustExist: true }) };
}

it('w_cn_xtcsh：真实完整保护备份校验后清空出纳，保留其他模块、总账与日志，成功重放不重复备份', async () => {
  const { app, api, request, raw } = await fixture();
  raw.exec(
    "CREATE TABLE synthetic_protection_data(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO synthetic_protection_data VALUES(1,'其他模块原始记录')",
  );
  await app.svcFor('print-settings').settings.set('synthetic.paper', '合成纸张设置');
  const [voucher] = await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '100201', debit: 777, dims: { cashflow: 'CF01' } },
        { account: '6603', credit: 777 },
      ],
    },
  ]);
  // 预览只随将被清空的数据及期间变化；其他模块内容也必须进入完整保护包。
  const before = await api.documents({});
  const receipt = await api.reset(request);
  expect(receipt.period).toBe(202602);
  const checked = await snapshot(app, receipt.backupId);
  try {
    expect(receipt.backupDigest).toBe(checked.record.digest);
    expect(checked.record.kind).toBe('pre-restore');
    expect(checked.record.status).toBe('valid');
    expect(checked.raw.prepare('SELECT summary,amount FROM cashier_document').all()).toEqual(
      before.map((row) => ({ summary: row.summary, amount: row.amount })),
    );
    expect(checked.raw.prepare('SELECT balance FROM cashier_opening').get()).toEqual({
      balance: 20000,
    });
    expect(checked.raw.prepare('SELECT value FROM synthetic_protection_data').get()).toEqual({
      value: '其他模块原始记录',
    });
    expect(checked.raw.prepare('SELECT count(*) AS n FROM voucher_line').get()).toEqual({ n: 2 });
    expect(checked.raw.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(checked.raw.pragma('foreign_key_check')).toEqual([]);
  } finally {
    checked.raw.close();
  }
  expect(await api.documents({})).toEqual([]);
  expect(await api.accounts({})).toEqual([]);
  expect(await api.status()).toEqual({ period: 202602 });
  expect(await app.svc.vouchers.get(voucher!.id)).toEqual(voucher);
  expect(await app.svcFor('print-settings').settings.get('synthetic.paper', '')).toBe(
    '合成纸张设置',
  );
  expect(raw.prepare('SELECT value FROM synthetic_protection_data').get()).toEqual({
    value: '其他模块原始记录',
  });
  expect(
    raw
      .prepare("SELECT user_id,module FROM operation_log WHERE action='cashier.reset.protection'")
      .get(),
  ).toEqual({ user_id: 1, module: 'backup' });
  expect(await api.reset(request)).toEqual(receipt);
  expect(await app.call(backup).list()).toHaveLength(1);
});

it('w_cn_xtcsh：受管目录拒绝写入时保留出纳，修复后同一请求真实重试成功，失败记录保留', async () => {
  const { app, api, request } = await fixture();
  const root = path.join(app.runtime.dataDir, 'backups');
  const target = path.join(app.runtime.dataDir, 'synthetic-backups');
  mkdirSync(target);
  symlinkSync(target, root, 'dir');
  const before = await api.documents({});
  await expect(api.reset(request)).rejects.toThrow('完整保护备份失败');
  expect(await api.documents({})).toEqual(before);
  expect(await api.accounts({})).toHaveLength(1);
  expect(await api.status()).toEqual({ period: 202601 });
  expect((await app.call(backup).list()).map((row) => row.status)).toEqual(['failed']);
  unlinkSync(root);
  const receipt = await api.reset(request);
  expect(receipt.backupId).toBeTruthy();
  expect((await app.call(backup).list()).map((row) => row.status).sort()).toEqual([
    'failed',
    'valid',
  ]);
});

it('w_cn_xtcsh：发布后受管包被改写，重新校验拒绝清空且标记无效备份', async () => {
  const { app, api, request, raw } = await fixture();
  raw.function('corrupt_synthetic_protection', (id: unknown) => {
    const file = path.join(
      app.runtime.dataDir,
      'backups',
      app.book.id,
      '手动与保护',
      `${String(id)}.caiwubak`,
    );
    const bytes = readFileSync(file);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    writeFileSync(file, bytes);
    return 1;
  });
  raw.exec(
    "CREATE TEMP TRIGGER corrupt_synthetic_protection AFTER UPDATE OF status ON backup_item WHEN NEW.status='valid' AND OLD.status='running' BEGIN SELECT corrupt_synthetic_protection(NEW.id); END",
  );
  const before = await api.documents({});
  await expect(api.reset(request)).rejects.toThrow('完整保护备份失败');
  expect(await api.documents({})).toEqual(before);
  expect(await api.accounts({})).toHaveLength(1);
  expect((await app.call(backup).list()).map((row) => row.status)).toEqual(['invalid']);
});

it('w_cn_xtcsh：有效包及登记摘要一并替换为另一账套，也不能作为当前账套的保护收据', async () => {
  const first = await fixture();
  const second = await fixture();
  const otherReceipt = await second.api.reset(second.request);
  const other = (await second.app.call(backup).list()).find(
    (row) => row.id === otherReceipt.backupId,
  )!;
  const otherFile = path.join(
    second.app.runtime.dataDir,
    'backups',
    second.app.book.id,
    other.directory,
    `${other.id}.caiwubak`,
  );
  first.raw.function('swap_synthetic_protection', (id: unknown) => {
    copyFileSync(
      otherFile,
      path.join(
        first.app.runtime.dataDir,
        'backups',
        first.app.book.id,
        '手动与保护',
        `${String(id)}.caiwubak`,
      ),
    );
    return 1;
  });
  first.raw
    .prepare(
      `CREATE TEMP TRIGGER swap_synthetic_protection AFTER UPDATE OF status ON backup_item
    WHEN NEW.status='valid' AND OLD.status='running' BEGIN
    SELECT swap_synthetic_protection(NEW.id);
    UPDATE backup_item SET digest='${other.digest}' WHERE id=NEW.id;
    END`,
    )
    .run();
  await expect(first.api.reset(first.request)).rejects.toThrow('完整保护备份失败');
  expect(await first.api.documents({})).toHaveLength(1);
  expect(await first.api.accounts({})).toHaveLength(1);
  expect(
    first.raw.prepare("SELECT count(*) AS n FROM operation_log WHERE action='cashier.reset'").get(),
  ).toEqual({ n: 0 });
});

it('w_cn_xtcsh：初始化请求编号与旧手工备份碰撞时仍创建新完整快照', async () => {
  const { app, api, document, request } = await fixture();
  const ctx = await context(app);
  const user = (await loadServiceUser(ctx.book.db, ctx.user.id))!;
  const svc = createCoreServices({ ...ctx.svc.ctx, user, moduleId: 'backup' });
  const previous = await backupService({ ...ctx, svc, user, moduleId: 'backup' }).create(
    { requestId: request.requestKey, name: '较早的手工备份' },
    'manual',
    true,
  );
  await waitForJobs(app.runtime);
  await api.createDocument({
    ...document,
    summary: '手工备份后新增的收款',
    requestKey: randomUUID(),
  });
  const receipt = await api.reset({ ...request, snapshot: (await api.resetPreview()).snapshot });
  expect(receipt.backupId).not.toBe(previous.id);
  const checked = await snapshot(app, receipt.backupId);
  try {
    expect(checked.raw.prepare('SELECT count(*) AS n FROM cashier_document').get()).toEqual({
      n: 2,
    });
  } finally {
    checked.raw.close();
  }
  expect((await app.call(backup).list()).map((row) => row.kind).sort()).toEqual([
    'manual',
    'pre-restore',
  ]);
});

it('w_cn_xtcsh：删除事务日志失败全部回滚，重试必须重新备份新增业务，旧保护包保留', async () => {
  const { app, api, request, raw, document } = await fixture();
  raw.exec(
    "CREATE TEMP TRIGGER fail_synthetic_reset BEFORE INSERT ON operation_log WHEN NEW.action='cashier.reset' BEGIN SELECT RAISE(ABORT,'synthetic reset log failure'); END",
  );
  await expect(api.reset(request)).rejects.toThrow('synthetic reset log failure');
  expect(await api.documents({})).toHaveLength(1);
  expect(await api.accounts({})).toHaveLength(1);
  expect(await api.status()).toEqual({ period: 202601 });
  const [oldBackup] = await app.call(backup).list();
  expect(oldBackup!.status).toBe('valid');
  raw.exec('DROP TRIGGER fail_synthetic_reset');
  await api.createDocument({
    ...document,
    summary: '备份失败后新增的合成收款',
    requestKey: randomUUID(),
  });
  const receipt = await api.reset({ ...request, snapshot: (await api.resetPreview()).snapshot });
  expect(receipt.backupId).not.toBe(oldBackup!.id);
  const checked = await snapshot(app, receipt.backupId);
  try {
    expect(checked.raw.prepare('SELECT count(*) AS n FROM cashier_document').get()).toEqual({
      n: 2,
    });
  } finally {
    checked.raw.close();
  }
  expect((await app.call(backup).list()).filter((row) => row.status === 'valid')).toHaveLength(2);
});

it.each(['业务变化', '管理员停用', '登录撤销'] as const)(
  'w_cn_xtcsh：完整备份等待期间%s，数据保留且已完成保护包不删除',
  async (change) => {
    const { app, api, request, raw } = await fixture();
    const nativeBackup = Database.prototype.backup;
    vi.spyOn(Database.prototype, 'backup').mockImplementationOnce(async function (
      this: Database.Database,
      ...args
    ) {
      const result = await nativeBackup.apply(this, args);
      if (change === '业务变化')
        raw
          .prepare("UPDATE cashier_document SET summary='备份期间的新修改',revision=revision+1")
          .run();
      if (change === '管理员停用') raw.prepare('UPDATE app_user SET disabled=1 WHERE id=1').run();
      if (change === '登录撤销') app.runtime.sessions.deleteForBook(app.book.id);
      return result;
    });
    await expect(api.reset(request)).rejects.toThrow(
      change === '业务变化' ? '预览后出纳数据或账套期间已变化' : '完整保护备份失败',
    );
    expect(raw.prepare('SELECT count(*) AS n FROM cashier_document').get()).toEqual({ n: 1 });
    expect(raw.prepare('SELECT count(*) AS n FROM cashier_account').get()).toEqual({ n: 1 });
    expect(raw.prepare("SELECT status FROM backup_item WHERE kind='pre-restore'").get()).toEqual({
      status: 'valid',
    });
  },
);

it('w_cn_xtcsh：宿主拒绝账套、操作员、模块或运行环境错配，不借用另一管理员身份', async () => {
  const { app, request } = await fixture();
  const other = await fixture();
  const ctx = await context(app);
  const input = {
    requestKey: request.requestKey,
    bookId: app.book.id,
    userId: 1,
    moduleId: 'cashier' as const,
    reason: 'cashier.reset' as const,
  };
  const protect = cashierResetProtection(app.runtime);
  for (const forged of [
    { ...input, bookId: other.app.book.id },
    { ...input, userId: 9999 },
    { ...input, moduleId: 'backup' as 'cashier' },
    { ...input, reason: 'other' as 'cashier.reset' },
  ])
    await expect(protect(forged, ctx)).rejects.toThrow('保护备份与当前登录账套或操作员不一致');
  await expect(protect(input, { ...ctx, app: other.app.runtime })).rejects.toThrow('不一致');
  const token = await app.addUser('reset-clerk', {
    permissions: ['cashier.reset', 'backup.create'],
  });
  const session = app.runtime.sessions.get(token)!;
  const user = (await loadServiceUser(ctx.book.db, session.userId))!;
  const svc = createCoreServices({ ...ctx.svc.ctx, user });
  await expect(
    protect({ ...input, userId: user.id }, { ...ctx, session, user, svc }),
  ).rejects.toThrow('有效管理员');
  expect(await app.call(backup).list()).toEqual([]);
  expect(await other.app.call(backup).list()).toEqual([]);
});

it('w_cn_xtcsh：未注册备份模块仍阻止初始化，不能退化为直接清空', async () => {
  const { app, api, request } = await fixture(false);
  await expect(api.reset(request)).rejects.toThrow('完整保护备份失败');
  expect(await api.documents({})).toHaveLength(1);
  expect(await api.accounts({})).toHaveLength(1);
  expect(await app.svcFor('cashier').settings.get('enabledPeriod', 0)).toBe(202601);
});

it('w_cn_xtcsh：createServer 生产组装自动注册真实备份，HTTP初始化成功并返回可校验受管包', async () => {
  const f = await fixture();
  await f.app.runtime.bookStore.closeAll();
  const server = await createServer({
    dataDir: f.app.runtime.dataDir,
    token: 'synthetic-host-token',
    modules: [cashier, backup],
    devMode: true,
  });
  servers.push(server);
  const headers = { host: 'localhost', 'x-caiwu-token': 'synthetic-host-token' };
  const login = await server.fastify.inject({
    method: 'POST',
    url: '/trpc/core.auth.login',
    headers,
    payload: { bookId: f.app.book.id, userCode: 'admin', password: 'admin' },
  });
  expect(login.statusCode).toBe(200);
  const token = login.json().result.data.token as string;
  const result = await server.fastify.inject({
    method: 'POST',
    url: '/trpc/m.cashier.reset',
    headers: { ...headers, authorization: `Bearer ${token}` },
    payload: f.request,
  });
  expect(result.statusCode, result.body).toBe(200);
  const receipt = result.json().result.data as { backupId: string; backupDigest: string };
  expect(receipt.backupDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(
    server.runtime.bookStore
      .open(f.app.book.id)
      .raw.prepare('SELECT count(*) AS n FROM cashier_document')
      .get(),
  ).toEqual({ n: 0 });
  const verify = await server.fastify.inject({
    method: 'POST',
    url: '/trpc/m.backup.verify',
    headers: { ...headers, authorization: `Bearer ${token}` },
    payload: { id: receipt.backupId },
  });
  expect(verify.statusCode, verify.body).toBe(200);
  expect(verify.json().result.data.book.id).toBe(f.app.book.id);
});
