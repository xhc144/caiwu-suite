import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '@caiwu/db';
import { coreMigrations } from '@caiwu/core/server';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import voucherBook from '../../../modules/voucher-book/server';
import { filteredQuery } from '../../../modules/voucher-book/server/service';

let app: TestApp;
afterEach(async () => app?.close());

it('综合查询：旧账套新增科目与凭证联合索引，组合筛选总数与整页ID不变且避免反复扫科目', async () => {
  app = await createTestApp({ modules: [voucherBook] });
  await seedVouchers(
    app.svc,
    Array.from({ length: 120 }, (_, i) => ({
      date: '2026-01-03',
      status: 'posted',
      lines: [
        { account: '1001', summary: i % 3 === 0 ? '目标收款' : '其他收款', debit: i + 1 },
        { account: '4001', summary: '平衡', credit: i + 1 },
      ],
    })),
  );
  const raw = app.runtime.bookStore.open(app.book.id).raw;
  // 仅临时合成账套回到前一迁移版本，再按真实迁移入口升级。
  raw.exec('DROP INDEX voucher_line_account_voucher');
  raw
    .prepare("DELETE FROM _migration WHERE scope='core' AND id='0004_voucher_line_query_index'")
    .run();
  const previous = raw.prepare('SELECT scope,id,checksum FROM _migration ORDER BY scope,id').all();
  const query = await filteredQuery(app.svc, {
    periodFrom: 202601,
    periodTo: 202601,
    statuses: ['posted'],
    accountCode: '1001',
    summaryContains: '目标',
    conditions: [{ field: 'amount', operator: 'gte', value: '10' }],
  });
  const count = query.select((eb) => eb.fn.countAll<number>().as('n')).compile();
  const page = query
    .select('v.id')
    .orderBy('v.period')
    .orderBy('v.voucher_type_id')
    .orderBy('v.number')
    .orderBy('v.id')
    .limit(20)
    .offset(5)
    .compile();
  const before = {
    count: raw.prepare(count.sql).get(...count.parameters),
    ids: raw.prepare(page.sql).all(...page.parameters),
    lines: raw
      .prepare('SELECT count(*) AS n,sum(debit) AS debit,sum(credit) AS credit FROM voucher_line')
      .get(),
  };
  expect(before.count).toEqual({ n: 37 });
  const upgraded = runMigrations(raw, [{ scope: 'core', migrations: coreMigrations }]);
  expect(upgraded.applied).toEqual([{ scope: 'core', id: '0004_voucher_line_query_index' }]);
  expect(
    raw
      .prepare(
        "SELECT scope,id,checksum FROM _migration WHERE NOT (scope='core' AND id='0004_voucher_line_query_index') ORDER BY scope,id",
      )
      .all(),
  ).toEqual(previous);
  expect(raw.prepare(count.sql).get(...count.parameters)).toEqual(before.count);
  expect(raw.prepare(page.sql).all(...page.parameters)).toEqual(before.ids);
  expect(
    raw
      .prepare('SELECT count(*) AS n,sum(debit) AS debit,sum(credit) AS credit FROM voucher_line')
      .get(),
  ).toEqual(before.lines);
  for (const compiled of [count, page]) {
    const plan = raw.prepare(`EXPLAIN QUERY PLAN ${compiled.sql}`).all(...compiled.parameters) as {
      detail: string;
    }[];
    expect(
      plan.some((row) =>
        /COVERING INDEX voucher_line_account_voucher \(account_id=\? AND voucher_id=\?\)/.test(
          row.detail,
        ),
      ),
    ).toBe(true);
  }
  expect(runMigrations(raw, [{ scope: 'core', migrations: coreMigrations }]).applied).toEqual([]);
  expect(raw.pragma('foreign_key_check')).toEqual([]);
});

it('完整恢复：旧版无查询索引的合成快照在受管暂存升级，当前账套与原迁移校验不变', async () => {
  app = await createTestApp({ modules: [voucherBook] });
  await seedVouchers(app.svc, [
    {
      date: '2026-01-03',
      status: 'posted',
      lines: [
        { account: '1001', debit: 123 },
        { account: '4001', credit: 123 },
      ],
    },
  ]);
  const raw = app.runtime.bookStore.open(app.book.id).raw;
  raw.exec('DROP INDEX voucher_line_account_voucher');
  raw
    .prepare("DELETE FROM _migration WHERE scope='core' AND id='0004_voucher_line_query_index'")
    .run();
  const old = raw.serialize();
  runMigrations(raw, [{ scope: 'core', migrations: coreMigrations }]);
  const before = app.runtime.bookStore.revision(app.book.id);
  const ticket = await app.runtime.bookStore.prepareReplacement({
    bookId: app.book.id,
    bytes: old,
    length: old.length,
    sha256: createHash('sha256').update(old).digest('hex'),
    expectedRevision: before,
    expiresAt: Date.now() + 60000,
  });
  expect(app.runtime.bookStore.revision(app.book.id)).toBe(before);
  const staged = new Database(
    path.join(app.runtime.dataDir, 'restore-staging', `${ticket.replacementId}.sqlite`),
    { readonly: true, fileMustExist: true },
  );
  try {
    expect(
      staged
        .prepare("SELECT name FROM sqlite_schema WHERE name='voucher_line_account_voucher'")
        .get(),
    ).toEqual({ name: 'voucher_line_account_voucher' });
    expect(
      staged
        .prepare('SELECT count(*) AS n,sum(debit) AS debit,sum(credit) AS credit FROM voucher_line')
        .get(),
    ).toEqual({ n: 2, debit: 123, credit: 123 });
    expect(staged.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(staged.pragma('foreign_key_check')).toEqual([]);
  } finally {
    staged.close();
  }
  expect(
    app.runtime.bookStore.cancelReplacement({
      bookId: app.book.id,
      replacementId: ticket.replacementId,
    }).status,
  ).toBe('cancelled');
});
