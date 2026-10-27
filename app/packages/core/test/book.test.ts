import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defineMigrations } from '@caiwu/db';
import { parseCodeScheme } from '../src';
import {
  BookStore,
  TemplateRegistry,
  builtinTemplates,
  createCoreServices,
  loadServiceUser,
  authenticateUser,
} from '../src/server';
import { createTestBook, seedVouchers, type TestBook } from '@caiwu/testkit';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeStore(migrationSets = () => [] as never[]) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-store-'));
  dirs.push(dataDir);
  const templates = new TemplateRegistry({ devMode: true });
  templates.register('core', builtinTemplates);
  return new BookStore({ dataDir, templates, migrationSets });
}

const input = {
  name: '甲公司',
  orgName: '甲有限公司',
  templateId: 'demo-enterprise',
  product: 'qingsong' as const,
  startYear: 2026,
  startMonth: 3,
  adminPassword: 'secret',
};

describe('账套', () => {
  it('新建：科目、期间、管理员都建好，列表里能看到，不留临时文件', async () => {
    const store = makeStore();
    const info = await store.create(input);
    expect(info).toMatchObject({
      name: '甲公司',
      startPeriod: 202603,
      product: 'qingsong',
      codeScheme: [4, 2, 2],
    });
    const list = await store.list();
    expect(list.map((b) => b.id)).toEqual([info.id]);
    expect(readdirSync(store.booksDir).filter((f) => f.includes('creating'))).toEqual([]);
    const book = store.open(info.id);
    const admin = await authenticateUser(book.db, 'admin', 'secret');
    expect(admin?.isAdmin).toBe(true);
    expect(await authenticateUser(book.db, 'admin', 'wrong')).toBeNull();
    const svc = createCoreServices({
      db: book.db,
      user: admin!,
      moduleId: null,
      now: () => new Date(),
      modules: { manifest: () => undefined, permissionName: () => undefined },
    });
    const periods = await svc.periods.list();
    expect(periods.map((p) => p.period)).toEqual([
      202603, 202604, 202605, 202606, 202607, 202608, 202609, 202610, 202611, 202612,
    ]);
    const vat = await svc.accounts.require('22210101');
    expect(vat).toMatchObject({
      level: 3,
      fullName: '应交税费/应交增值税/进项税额',
      direction: 'debit',
      pinyin: 'jxse',
    });
    expect((await svc.accounts.require('2221')).isLeaf).toBe(false);
    expect((await svc.accounts.require('1122')).dimensions).toEqual([
      { type: 'partner', required: true, defaultItemId: null },
    ]);
    await store.closeAll();
  });

  it('模板与科目级次不匹配时拒绝', async () => {
    const store = makeStore();
    await expect(store.create({ ...input, codeScheme: '3-2-2' })).rejects.toThrow(
      /无法映射|编码超出/,
    );
    expect(readdirSync(store.booksDir)).toEqual([]);
  });

  it('打开时执行新增模块的迁移', async () => {
    let sets: { scope: string; migrations: ReturnType<typeof defineMigrations> }[] = [];
    const store = makeStore(() => sets as never[]);
    const info = await store.create(input);
    await store.closeAll();
    sets = [
      {
        scope: 'later',
        migrations: defineMigrations([
          { id: '0001_init', sql: 'CREATE TABLE later_x (id INTEGER)' },
        ]),
      },
    ];
    const book = store.open(info.id);
    expect(
      book.raw.prepare("SELECT name FROM sqlite_master WHERE name = 'later_x'").get(),
    ).toBeTruthy();
    await store.closeAll();
    expect(book.raw.open).toBe(false);
  });

  it('非法账套 id 不会拼出越界路径', () => {
    const store = makeStore();
    expect(() => store.pathOf('../../etc/passwd')).toThrow(/不合法/);
  });
});

describe('科目与期初', () => {
  let t: TestBook;
  afterEach(async () => t?.close());

  it('新增下级科目：上级变非末级；上级已有发生额时拒绝', async () => {
    t = await createTestBook();
    const scheme = parseCodeScheme('4-2-2');
    const child = await t.svc.accounts.create({ code: '160101', name: '房屋' }, scheme);
    expect(child).toMatchObject({ level: 2, categoryId: 'asset', fullName: '固定资产/房屋' });
    expect((await t.svc.accounts.require('1601')).isLeaf).toBe(false);
    await seedVouchers(t.svc, [
      {
        date: '2026-01-02',
        lines: [
          { account: '6603', debit: 100 },
          { account: '1001', credit: 100 },
        ],
      },
    ]);
    await expect(t.svc.accounts.create({ code: '660301', name: '利息' }, scheme)).rejects.toThrow(
      /已有凭证或期初余额/,
    );
    await expect(t.svc.accounts.create({ code: '16010', name: '错' }, scheme)).rejects.toThrow(
      /不符合级次规则/,
    );
    await expect(t.svc.accounts.create({ code: '9901', name: '无上级' }, scheme)).rejects.toThrow(
      /必须指定科目类别/,
    );
  });

  it('期初只能录在末级科目，相同键覆盖', async () => {
    t = await createTestBook();
    const bank = await t.svc.accounts.require('1002');
    await expect(
      t.svc.opening.upsert({ year: 2026, accountId: bank.id, balance: 1 }),
    ).rejects.toThrow(/不是末级科目/);
    const icbc = await t.svc.accounts.require('100201');
    await t.svc.opening.upsert({ year: 2026, accountId: icbc.id, balance: 100 });
    await t.svc.opening.upsert({ year: 2026, accountId: icbc.id, balance: 200 });
    expect((await t.svc.opening.list(2026)).map((o) => o.balance)).toEqual([200]);
  });

  it('操作员权限', async () => {
    t = await createTestBook();
    const clerk = await t.addUser('lr', { permissions: ['example.memo.view'] });
    expect(clerk.permissions.has('example.memo.view')).toBe(true);
    expect(() => clerk.permissions.require('example.memo.edit')).toThrow(
      /你没有「example.memo.edit」权限/,
    );
    const reloaded = await loadServiceUser(t.book.db, clerk.user.id);
    expect([...reloaded!.permissions]).toEqual(['example.memo.view']);
  });
});

it('w_xt_tz：相同建账请求并发及进程重开后只建一套；改内容/口令拒绝且不覆盖', async () => {
  const store = makeStore();
  const request = { ...input, requestKey: 'synthetic-create-request', codeScheme: '4-3-3' };
  const results = await Promise.all(Array.from({ length: 4 }, () => store.create(request)));
  expect(new Set(results.map((result) => result.id)).size).toBe(1);
  expect(await store.list()).toHaveLength(1);
  expect(results[0]!.codeScheme).toEqual([4, 3, 3]);
  await expect(store.create({ ...request, name: '不同内容' })).rejects.toThrow(
    /内容或管理员口令不同/,
  );
  await expect(store.create({ ...request, adminPassword: '不同口令' })).rejects.toThrow(
    /内容或管理员口令不同/,
  );
  const dataDir = path.dirname(store.booksDir);
  await store.closeAll();
  const templates = new TemplateRegistry({ devMode: true });
  templates.register('core', builtinTemplates);
  const restarted = new BookStore({ dataDir, templates, migrationSets: () => [] });
  try {
    expect((await restarted.create(request)).id).toBe(results[0]!.id);
    expect(await restarted.list()).toHaveLength(1);
    const settings = await restarted
      .open(results[0]!.id)
      .db.selectFrom('book_setting')
      .select('value')
      .where('scope', '=', 'core')
      .where('key', '=', 'creationRequest')
      .executeTakeFirstOrThrow();
    expect(settings.value).not.toContain('secret');
    expect(JSON.parse(settings.value)).toMatchObject({
      requestKey: request.requestKey,
      payloadHash: expect.any(String),
    });
  } finally {
    await restarted.closeAll();
  }
});

it('w_xt_tz：建账晚阶段迁移失败不留下结果，相同请求修复后可以合法重试', async () => {
  let broken = true;
  const store = makeStore(() =>
    broken
      ? ([
          {
            scope: 'synthetic',
            migrations: defineMigrations([
              {
                id: '0001_bad',
                sql: 'CREATE TABLE broken_data(id INTEGER); INSERT INTO missing_table VALUES(1);',
              },
            ]),
          },
        ] as never[])
      : [],
  );
  const request = { ...input, requestKey: 'synthetic-create-retry' };
  await expect(store.create(request)).rejects.toThrow(/missing_table/);
  expect(await store.list()).toHaveLength(0);
  expect(readdirSync(store.booksDir).filter((file) => file.includes('creating'))).toEqual([]);
  broken = false;
  const created = await store.create(request);
  expect((await store.list()).map((row) => row.id)).toEqual([created.id]);
  await store.closeAll();
});
