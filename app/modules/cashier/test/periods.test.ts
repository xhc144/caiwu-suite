import { randomUUID } from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import fc from 'fast-check';
import { sql } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import type { DocumentInput } from '../shared';
import type { CashierTables } from '../server/migrations';
import cashierServer from '../server';
import { periodService } from '../server/periods';

let app: TestApp;
const call = (a: TestApp, token?: string) => a.call(cashierServer, token);
let api: ReturnType<typeof call>;
let accountId: number;
let input: DocumentInput;
beforeEach(async () => {
  app = await createTestApp({ modules: [cashierServer] });
  api = call(app);
  await api.enable({ period: 202601 });
  accountId = (
    await api.saveAccount({
      data: {
        name: '期间银行',
        coreAccountId: (await app.svc.accounts.require('100201')).id,
        currency: 'CNY',
        opening: 100000,
      },
    })
  ).id;
  input = {
    accountId,
    period: 202601,
    date: '2026-01-10',
    summary: '期间收款',
    amount: 12345,
    direction: 'receipt',
    oppositeAccountId: (await app.svc.accounts.require('6603')).id,
    dimensions: { cashflow: (await app.svc.dimensions.getByCode('cashflow', 'CF01'))!.id },
  };
});
afterEach(async () => app.close());
const create = (overrides: Partial<DocumentInput> = {}) =>
  api.createDocument({ ...input, ...overrides, requestKey: randomUUID() });
async function close() {
  const p = await api.periods();
  return api.closePeriod({ period: p.current, snapshot: p.snapshot, confirmed: true });
}
async function reopen() {
  const p = await api.periods();
  return api.reopenPeriod({ period: p.lastClosed!, snapshot: p.snapshot, confirmed: true });
}
const db = () => app.svc.db.withTables<CashierTables>();

it('w_cn_fz/fjz 真实月结收付结余、来源业务锁和逐月恢复，总账期间与凭证不变', async () => {
  const d = await create();
  await create({ direction: 'payment', amount: 345 });
  const before = await api.documents({});
  const p = await api.periods();
  expect(p.rows[0]).toMatchObject({
    opening: 100000,
    receipt: 12345,
    payment: 345,
    closing: 112000,
  });
  await close();
  expect((await api.periods()).current).toBe(202602);
  expect((await db().selectFrom('cashier_month_balance').selectAll().execute())[0]).toMatchObject({
    period: 202601,
    opening: 100000,
    receipt: 12345,
    payment: 345,
    closing: 112000,
  });
  expect((await app.svc.periods.require(202601)).status).toBe('open');
  await expect(create()).rejects.toThrow('已经结账');
  await expect(api.updateDocument({ id: d.id, revision: 1, data: input })).rejects.toThrow(
    '已经结账',
  );
  await expect(api.removeDocument({ id: d.id, revision: 1, confirmed: true })).rejects.toThrow(
    '已经结账',
  );
  await reopen();
  expect((await api.periods()).current).toBe(202601);
  expect(await api.documents({})).toEqual(before);
  expect(await db().selectFrom('cashier_month_balance').selectAll().execute()).toEqual([]);
  await api.updateDocument({ id: d.id, revision: 1, data: { ...input, amount: 100 } });
  expect((await api.documents({}))[0]!.amount).toBe(100);
});

it('w_cn_fz/fjz 跳月、重复结账、越过启用期间、漏确认和过期预览均拒绝', async () => {
  const p = await api.periods();
  await expect(
    api.closePeriod({ period: 202602, snapshot: p.snapshot, confirmed: true }),
  ).rejects.toThrow('只能结账');
  await expect(
    api.reopenPeriod({ period: 202512, snapshot: p.snapshot, confirmed: true }),
  ).rejects.toThrow('只能逐月');
  await expect(
    api.closePeriod({ period: 202601, snapshot: p.snapshot, confirmed: false as true }),
  ).rejects.toThrow();
  await create();
  await expect(
    api.closePeriod({ period: 202601, snapshot: p.snapshot, confirmed: true }),
  ).rejects.toThrow('已变化');
  const ready = await api.periods();
  const request = { period: ready.current, snapshot: ready.snapshot, confirmed: true as const };
  const results = await Promise.allSettled([api.closePeriod(request), api.closePeriod(request)]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await db().selectFrom('cashier_month_balance').selectAll().execute()).toHaveLength(1);
  await close();
  const last = await api.periods();
  await expect(
    api.reopenPeriod({ period: 202601, snapshot: last.snapshot, confirmed: true }),
  ).rejects.toThrow('只能逐月');
});

it('w_cn_fz/fjz 分开授权，只有查看权限无法关月或反结账；不支持删除覆盖账套', async () => {
  const viewer = call(app, await app.addUser('viewer', { permissions: ['cashier.view'] }));
  const p = await viewer.periods();
  await expect(
    viewer.closePeriod({ period: p.current, snapshot: p.snapshot, confirmed: true }),
  ).rejects.toThrow('权限');
  await close();
  const q = await viewer.periods();
  await expect(
    viewer.reopenPeriod({ period: q.lastClosed!, snapshot: q.snapshot, confirmed: true }),
  ).rejects.toThrow('权限');
  const closer = call(
    app,
    await app.addUser('closer', { permissions: ['cashier.view', 'cashier.period.close'] }),
  );
  await expect(
    closer.reopenPeriod({ period: q.lastClosed!, snapshot: q.snapshot, confirmed: true }),
  ).rejects.toThrow('权限');
  expect((await api.periods()).current).toBe(202602);
  await expect(app.runtime.bookStore.maintain(app.book.id, { kind: 'replace' })).rejects.toThrow(
    '暂不支持删除或覆盖',
  );
  expect((await api.periods()).current).toBe(202602);
});

it('w_cn_fz/fjz 写日志失败时期间、余额快照与反结账全部回滚', async () => {
  await create();
  await sql`CREATE TRIGGER cashier_test_close_failure BEFORE INSERT ON operation_log WHEN NEW.action = 'cashier.period.close' BEGIN SELECT RAISE(FAIL, '合成结账失败'); END`.execute(
    app.svc.db,
  );
  await expect(close()).rejects.toThrow('合成结账失败');
  expect((await api.periods()).current).toBe(202601);
  expect(await db().selectFrom('cashier_period').selectAll().execute()).toEqual([]);
  expect(await db().selectFrom('cashier_month_balance').selectAll().execute()).toEqual([]);
  await sql`DROP TRIGGER cashier_test_close_failure`.execute(app.svc.db);
  await close();
  await sql`CREATE TRIGGER cashier_test_reopen_failure BEFORE INSERT ON operation_log WHEN NEW.action = 'cashier.period.reopen' BEGIN SELECT RAISE(FAIL, '合成反结账失败'); END`.execute(
    app.svc.db,
  );
  await expect(reopen()).rejects.toThrow('合成反结账失败');
  expect((await api.periods()).current).toBe(202602);
  expect(await db().selectFrom('cashier_month_balance').selectAll().execute()).toHaveLength(1);
});

it('w_cn_lr_qc_nf 十二月原子建立下一年独立期初，默认账户不重复；反结账只清衍生年初', async () => {
  await create();
  await app.svc.periods.ensureYear(2027);
  await expect(create({ period: 202701, date: '2027-01-01' })).rejects.toThrow('期初尚未建立');
  for (let i = 0; i < 12; i++) await close();
  expect((await api.periods()).current).toBe(202701);
  expect(await api.accounts({})).toHaveLength(1);
  expect((await api.accounts({ year: 2027 }))[0]).toMatchObject({
    opening: 112345,
    period: 202701,
  });
  expect(await app.svc.opening.list(2027)).toEqual([]);
  const docs = await api.documents({});
  await reopen();
  expect((await api.periods()).current).toBe(202612);
  await expect(api.accounts({ year: 2027 })).rejects.toThrow('尚未');
  expect(await db().selectFrom('cashier_opening').selectAll().execute()).toEqual([
    { account_id: accountId, period: 202601, balance: 100000 },
  ]);
  expect(await api.documents({})).toEqual(docs);
  await close();
  expect((await api.accounts({ year: 2027 }))[0]!.opening).toBe(112345);
});

it('w_cn_fjz 后续年度已有单据或软删除历史，禁止跨年反结账并保留全部业务', async () => {
  await app.svc.periods.ensureYear(2027);
  for (let i = 0; i < 12; i++) await close();
  const d = await create({ period: 202701, date: '2027-01-01' });
  await expect(reopen()).rejects.toThrow('业务历史');
  await api.removeDocument({ id: d.id, revision: 1, confirmed: true });
  await expect(reopen()).rejects.toThrow('业务历史');
  expect((await api.accounts({ year: 2027 }))[0]!.opening).toBe(100000);
  expect((await api.periods()).current).toBe(202701);
});

it('w_cn_fz 下一年度年初已有数据时不覆盖，并回滚十二月状态/汇总', async () => {
  for (let i = 0; i < 11; i++) await close();
  await db()
    .insertInto('cashier_opening')
    .values({ account_id: accountId, period: 202701, balance: 77 })
    .execute();
  await expect(close()).rejects.toThrow('不能覆盖');
  expect((await api.periods()).current).toBe(202612);
  expect(
    await db()
      .selectFrom('cashier_month_balance')
      .selectAll()
      .where('period', '=', 202612)
      .execute(),
  ).toEqual([]);
  expect(
    (
      await db().selectFrom('cashier_opening').selectAll().where('period', '=', 202701).execute()
    )[0]!.balance,
  ).toBe(77);
});

it('w_cn_fz/fjz 保留来源凭证审核锁，关月也不改变凭证及勾账历史', async () => {
  await create();
  const rows = await api.documents({});
  const { batchId } = await api.generate({
    documents: rows.map((d) => ({ id: d.id, revision: d.revision })),
    mode: 'individual',
    date: input.date,
    voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
    requestKey: randomUUID(),
  });
  const voucherId = (await api.documents({}))[0]!.voucherId!;
  await app.svc.vouchers.changeStatus({ ids: [voucherId], to: 'audited' });
  const before = await app.svc.vouchers.get(voucherId);
  await close();
  await expect(api.revoke({ batchId, confirmed: true })).rejects.toThrow('已经结账');
  await reopen();
  await expect(api.revoke({ batchId, confirmed: true })).rejects.toThrow('已审核或过账');
  expect(await app.svc.vouchers.get(voucherId)).toEqual(before);
  await expect(app.svc.vouchers.delete(voucherId)).rejects.toThrow();
});

it('w_cn_fz/fjz 在线备份保留结账前原始数据，不覆盖备份；账套维护中拒绝期间写入', async () => {
  await create();
  const book = app.runtime.bookStore.open(app.book.id);
  const file = path.join(path.dirname(book.file), 'cashier-before-close.sqlite');
  await book.raw.backup(file);
  await close();
  await reopen();
  const backup = new Database(file, { readonly: true });
  try {
    expect(backup.prepare('SELECT count(*) AS n FROM cashier_period').get()).toEqual({ n: 0 });
    expect(backup.prepare('SELECT amount FROM cashier_document').get()).toEqual({ amount: 12345 });
    expect(backup.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    backup.close();
  }
  const plan = await api.periods();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const maintained = app.runtime.bookStore.maintain(app.book.id, {
    kind: 'reconnect',
    prepare: async () => {
      entered.resolve();
      await release.promise;
    },
  });
  await entered.promise;
  try {
    await expect(
      api.closePeriod({ period: plan.current, snapshot: plan.snapshot, confirmed: true }),
    ).rejects.toThrow('登录已失效');
    await expect(
      periodService(app.svcFor('cashier')).close({ period: plan.current, snapshot: plan.snapshot }),
    ).rejects.toThrow(/维护|忙|暂停/);
  } finally {
    release.resolve();
    await maintained;
  }
  const token = await app.login();
  expect((await call(app, token).periods()).current).toBe(202601);
});

it('w_cn_fz/fjz fast-check 随机整数收付款月结再反结账，业务余额守恒', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.integer({ min: -1000000, max: 1000000 }).filter((n) => n !== 0),
        { minLength: 1, maxLength: 8 },
      ),
      async (amounts) => {
        for (const amount of amounts)
          await create({ direction: amount > 0 ? 'receipt' : 'payment', amount: Math.abs(amount) });
        const before = await api.documents({});
        const p = await api.periods();
        expect(p.rows[0]!.closing).toBe(100000 + before.reduce((s, d) => s + d.signed, 0));
        await close();
        await reopen();
        expect((await api.periods()).rows).toEqual(p.rows);
        expect(await api.documents({})).toEqual(before);
      },
    ),
    { numRuns: 10 },
  );
});
