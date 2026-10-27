import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineManifest, type BookInfo } from '@caiwu/core';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import { defineMigrations } from '@caiwu/db';
import { defineServerModule, moduleKit } from '@caiwu/server-kit';
import { createTestApp, seedVouchers, voucherInputFromSpec, type TestApp } from '@caiwu/testkit';
import booksServer from '../server';
import { booksService, type FileHooks } from '../server/service';

// 仅本测试注册来源模块；不依赖其它业务模块的页面、路由或完成进度。
const manifest = defineManifest({
  id: 'books-probe',
  name: '复制来源夹具',
  products: 'all',
  sources: [{ type: 'document', name: '合成来源单据', path: '/documents?id={id}' }],
});
const probe = defineServerModule(manifest, {
  router: moduleKit(manifest).router({}),
  migrations: defineMigrations([
    {
      id: '0001_document',
      sql: 'CREATE TABLE books_probe_document (id TEXT PRIMARY KEY, amount INTEGER NOT NULL)',
    },
  ]),
});

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [booksServer, probe], seed: false });
});
afterEach(async () => app.close());
const input = (overrides = {}) => ({
  targetId: app.book.id,
  userCode: 'admin',
  password: 'admin',
  requestId: randomUUID(),
  name: '业务完整副本',
  confirmed: true as const,
  ...overrides,
});
async function services(book: BookInfo) {
  const opened = app.runtime.bookStore.open(book.id);
  return createCoreServices({
    ...app.svc.ctx,
    db: opened.db,
    user: (await loadServiceUser(opened.db, 1))!,
    moduleId: null,
  });
}
async function withHooks(hooks: FileHooks) {
  const token = await app.login();
  return booksService(app.runtime, app.svcFor('books'), app.runtime.sessions.get(token)!, hooks);
}

describe('w_tzjl_2 / w_tzjl_kl 真实业务副本', () => {
  it('保留整数期初、各状态凭证、来源单据和锁、权限及期间；副本后续写入与来源隔离', async () => {
    const cash = await app.svc.accounts.require('1001');
    const capital = await app.svc.accounts.require('4001');
    await app.svc.tx(async (svc) => {
      await svc.opening.upsert({ year: 2026, accountId: cash.id, balance: 8_007 });
      await svc.opening.upsert({ year: 2026, accountId: capital.id, balance: -8_007 });
    });
    await seedVouchers(app.svc, [
      {
        date: '2026-01-08',
        status: 'posted',
        lines: [
          { account: '1001', debit: 12_345 },
          { account: '6001', credit: 12_345 },
        ],
      },
      {
        date: '2026-01-09',
        status: 'audited',
        lines: [
          { account: '1001', debit: 1_003 },
          { account: '6001', credit: 1_003 },
        ],
      },
      {
        date: '2026-01-10',
        status: 'draft',
        lines: [{ account: '1001', debit: 2_009 }],
      },
    ]);
    const source = app.svcFor(manifest.id);
    const voucherInput = await voucherInputFromSpec(source, {
      date: '2026-01-11',
      lines: [
        { account: '1001', debit: 3_017 },
        { account: '6001', credit: 3_017 },
      ],
    });
    const db = source.db.withTables<{ books_probe_document: { id: string; amount: number } }>();
    await db.insertInto('books_probe_document').values({ id: 'doc-1', amount: 3_017 }).execute();
    const linked = await source.vouchers.create({
      ...voucherInput,
      source: { type: 'document', id: 'doc-1' },
    });
    await app.svc.users.create({
      code: 'viewer',
      name: '只读',
      password: 'viewer-pw',
      permissions: ['books.view'],
    });
    await app.svc.periods.setStatus(202602, 'closed');
    const query = { periodFrom: 202601, periodTo: 202601 };
    const before = {
      vouchers: await app.svc.vouchers.list(),
      balances: await app.svc.ledger.balances(query),
      opening: await app.svc.opening.list(2026),
      log: await app.svc.log.list(),
    };
    const copied = await app.call(booksServer).copy(input());
    const dst = await services(copied);
    expect(await dst.vouchers.list()).toEqual(before.vouchers);
    expect(await dst.opening.list(2026)).toEqual(before.opening);
    expect(await dst.periods.list()).toEqual(await app.svc.periods.list());
    expect(await dst.ledger.balances(query)).toEqual(before.balances);
    expect((await dst.ledger.balances(query)).find((b) => b.accountCode === '1001')).toMatchObject({
      opening: 8_007,
      debit: 12_345,
      closing: 20_352,
    });
    expect(
      (await dst.ledger.balances({ ...query, includeUnposted: true })).find(
        (b) => b.accountCode === '1001',
      )?.debit,
    ).toBe(16_365);
    for (const row of await dst.ledger.balances(query))
      for (const value of [row.opening, row.debit, row.credit, row.closing])
        expect(Number.isSafeInteger(value)).toBe(true);
    expect(await dst.vouchers.get(linked.id)).toEqual(await source.vouchers.get(linked.id));
    expect(
      await dst.db
        .withTables<{ books_probe_document: { id: string; amount: number } }>()
        .selectFrom('books_probe_document')
        .selectAll()
        .execute(),
    ).toEqual([{ id: 'doc-1', amount: 3_017 }]);
    await expect(
      dst.vouchers.update(linked.id, voucherInput, { expectedRevision: linked.revision }),
    ).rejects.toMatchObject({
      data: { code: 'VOUCHER_FROM_SOURCE' },
    });
    await expect(dst.vouchers.delete(linked.id)).rejects.toMatchObject({
      data: { code: 'VOUCHER_FROM_SOURCE' },
    });
    const viewer = await app
      .core(null)
      .auth.login({ bookId: copied.id, userCode: 'viewer', password: 'viewer-pw' });
    expect(viewer.user.permissions).toEqual(['books.view']);
    await expect(app.call(booksServer, viewer.token).copy(input())).rejects.toThrow(/权限/);
    const info = await app
      .call(
        booksServer,
        (
          await app
            .core(null)
            .auth.login({ bookId: copied.id, userCode: 'admin', password: 'admin' })
        ).token,
      )
      .update({ name: '副本独立改名', orgName: '副本单位' });
    expect(info.id).toBe(copied.id);
    expect(await app.svc.vouchers.list()).toEqual(before.vouchers);
    expect(await app.svc.ledger.balances(query)).toEqual(before.balances);
    expect(await app.svc.log.list()).toEqual(before.log);
    expect((await app.svc.book.info()).name).toBe(app.book.name);
  });

  it.each(['password', 'disabled', 'permission'] as const)(
    '备份前提交%s变更：按实际快照重验身份/权限，不发布副本或泄漏文件',
    async (change) => {
      const copier = await app.svc.users.create({
        code: 'copier',
        name: '复制员',
        password: 'pw',
        permissions: ['books.copy'],
      });
      const before = readdirSync(app.runtime.bookStore.booksDir).sort();
      const service = await withHooks({
        snapshot: async (raw, file) => {
          if (change === 'password') await app.svc.users.setPassword(copier.id, 'new-pw');
          if (change === 'disabled')
            await app.svc.db
              .updateTable('app_user')
              .set({ disabled: 1 })
              .where('id', '=', copier.id)
              .execute();
          if (change === 'permission') await app.svc.users.setPermissions(copier.id, []);
          await raw.backup(file);
        },
      });
      await expect(service.copy(input({ userCode: 'copier', password: 'pw' }))).rejects.toThrow(
        change === 'permission' ? /权限/ : /已失效或密码已改变/,
      );
      expect(readdirSync(app.runtime.bookStore.booksDir).sort()).toEqual(before);
      expect((await app.core().auth.me()).book.id).toBe(app.book.id);
    },
  );

  it('复制返回的信息和操作日志来自实际快照，保留备份前提交的单位改名', async () => {
    const service = await withHooks({
      snapshot: async (raw, file) => {
        await app.call(booksServer).update({ name: '快照来源名称', orgName: '快照单位' });
        await raw.backup(file);
      },
    });
    const copied = await service.copy(input());
    expect(copied.orgName).toBe('快照单位');
    const dst = await services(copied);
    expect(await dst.book.info()).toEqual(copied);
    expect((await dst.log.list()).find((row) => row.action === 'books.copy')?.summary).toBe(
      '从「快照来源名称」复制为「业务完整副本」',
    );
  });

  it('删除预览的在线备份包含整数凭证和来源锁字段，拒绝删除后原账套仍可读写', async () => {
    const other = await app.core(null).books.create({
      name: '当前操作账套',
      orgName: '合成单位',
      templateId: 'demo-enterprise',
      product: 'chengben',
      startYear: 2026,
      startMonth: 1,
      adminPassword: 'admin',
    });
    const source = app.svcFor(manifest.id);
    const v = await source.vouchers.create({
      ...(await voucherInputFromSpec(source, {
        date: '2026-01-05',
        lines: [
          { account: '1001', debit: 10_001 },
          { account: '6001', credit: 10_001 },
        ],
      })),
      source: { type: 'document', id: 'backup-1' },
    });
    const session = await app
      .core(null)
      .auth.login({ bookId: other.id, userCode: 'admin', password: 'admin' });
    const api = app.call(booksServer, session.token);
    const p = await api.prepareDelete({
      targetId: app.book.id,
      userCode: 'admin',
      password: 'admin',
    });
    const backup = new Database(path.join(app.runtime.dataDir, 'books-backups', p.backupId), {
      readonly: true,
      fileMustExist: true,
    });
    try {
      expect(backup.pragma('quick_check', { simple: true })).toBe('ok');
      expect(backup.pragma('foreign_key_check')).toEqual([]);
      expect(
        backup
          .prepare(
            'SELECT debit_total, credit_total, source_module, source_type, source_id FROM voucher WHERE id=?',
          )
          .get(v.id),
      ).toEqual({
        debit_total: 10_001,
        credit_total: 10_001,
        source_module: manifest.id,
        source_type: 'document',
        source_id: 'backup-1',
      });
      await expect(
        api.remove({
          targetId: app.book.id,
          userCode: 'admin',
          password: 'admin',
          ticket: p.ticket,
          confirmName: app.book.name,
        }),
      ).rejects.toThrow(/删除执行暂不可用/);
      expect(await source.vouchers.get(v.id)).toEqual(v);
      await source.settings.set('after-delete-denied', true);
      expect(await source.settings.get('after-delete-denied', false)).toBe(true);
    } finally {
      backup.close();
    }
  });
});
