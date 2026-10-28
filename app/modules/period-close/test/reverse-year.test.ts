import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import periodCloseServer from '../server';
import { call, errorData, rule, snapshot, zeroOpening } from './helpers';
let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [periodCloseServer] });
  await zeroOpening(app);
  for (let month = 1; month <= 12; month++)
    await call(app).close({ period: 202600 + month, confirmed: true });
  await call(app).yearEnd({ year: 2026, confirmed: true });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});
it('w_zw_qxfz：后年度未结束的逐项结转须先停止，清理已结束记录前备份并保留原年度', async () => {
  const api = call(app);
  await api.saveRule({ data: await rule(app) });
  const batch = await api.startTransferBatch({ period: 202701, ruleIds: [1], confirmed: true });
  const before = snapshot(app);
  expect((await errorData(api.reverseYearPreview({ year: 2026 }))).code).toBe(
    'PERIOD_CLOSE_TARGET_BATCH_ACTIVE',
  );
  expect(snapshot(app)).toBe(before);
  await api.decideTransferBatch({
    id: batch.id,
    revision: batch.revision,
    decision: 'stop',
    confirmed: true,
  });
  const plan = await api.reverseYearPreview({ year: 2026 });
  expect(plan.batches).toEqual([{ id: batch.id, period: 202701 }]);
  expect(plan.impact).toContain('在线备份');
  const backup = await api.backupReverseYear({ year: 2026 });
  const raw = new Database(path.join(app.runtime.dataDir, backup.relativePath), { readonly: true });
  try {
    expect(raw.prepare('SELECT id FROM period_close_batch').all()).toEqual([{ id: batch.id }]);
  } finally {
    raw.close();
  }
  await api.reverseYear({
    year: 2026,
    backupId: backup.backupId,
    confirmed: true,
    confirmText: plan.confirmationText,
  });
  expect(
    await app.svc.db
      .withTables<{ period_close_batch: { id: string } }>()
      .selectFrom('period_close_batch')
      .selectAll()
      .execute(),
  ).toEqual([]);
  expect((await app.svc.periods.require(202612)).status).toBe('closed');
  expect(await app.svc.opening.list(2026)).toHaveLength(1);
});

it('w_zw_qxfz：备份后新增并停止逐项结转也使备份版本失效，保留新记录', async () => {
  const api = call(app);
  await api.saveRule({ data: await rule(app) });
  const backup = await api.backupReverseYear({ year: 2026 });
  const batch = await api.startTransferBatch({ period: 202701, ruleIds: [1], confirmed: true });
  await api.decideTransferBatch({
    id: batch.id,
    revision: batch.revision,
    decision: 'stop',
    confirmed: true,
  });
  const before = snapshot(app);
  expect(
    (
      await errorData(
        api.reverseYear({
          year: 2026,
          backupId: backup.backupId,
          confirmed: true,
          confirmText: '撤销2026年年结',
        }),
      )
    ).code,
  ).toBe('PERIOD_CLOSE_BACKUP_STALE');
  expect(snapshot(app)).toBe(before);
});
it('w_zw_qxfz：先列影响，在线备份成功后才可文字确认，取消完全不改库', async () => {
  const api = call(app);
  const originalOpening = await app.svc.opening.list(2026);
  const before = snapshot(app);
  const plan = await api.reverseYearPreview({ year: 2026 });
  expect(plan).toMatchObject({
    sourceYear: 2026,
    targetYear: 2027,
    periods: Array.from({ length: 12 }, (_, i) => 202701 + i),
  });
  expect(plan.rows).toHaveLength(1);
  const backup = await api.backupReverseYear({ year: 2026 });
  expect(snapshot(app)).toBe(before);
  const file = path.join(app.runtime.dataDir, backup.relativePath);
  const raw = new Database(file, { readonly: true });
  try {
    expect(raw.pragma('quick_check', { simple: true })).toBe('ok');
    expect(raw.prepare('SELECT count(*) n FROM opening_balance WHERE year=2027').get()).toEqual({
      n: 1,
    });
  } finally {
    raw.close();
  }
  expect(JSON.parse(await readFile(file.replace(/\.caiwu$/, '.json'), 'utf8'))).toMatchObject({
    bookId: app.book.id,
    sourceYear: 2026,
    targetYear: 2027,
  });
  await expect(
    api.reverseYear({
      year: 2026,
      backupId: backup.backupId,
      confirmed: false,
      confirmText: plan.confirmationText,
    }),
  ).rejects.toThrow();
  expect(snapshot(app)).toBe(before);
  await expect(
    api.reverseYear({
      year: 2026,
      backupId: backup.backupId,
      confirmed: true,
      confirmText: '取消',
    }),
  ).rejects.toThrow();
  expect(snapshot(app)).toBe(before);
  await api.reverseYear({
    year: 2026,
    backupId: backup.backupId,
    confirmed: true,
    confirmText: plan.confirmationText,
  });
  expect(await app.svc.opening.list(2027)).toEqual([]);
  expect((await app.svc.periods.years()).map((y) => [y.year, y.status])).toEqual([[2026, 'open']]);
  expect(await app.svc.opening.list(2026)).toEqual(originalOpening);
  expect((await app.svc.periods.require(202612)).status).toBe('closed');
  await api.reopen({ from: 202612, to: 202612, confirmed: true });
  expect((await app.svc.periods.require(202612)).status).toBe('open');
  expect((await app.svc.log.list()).some((l) => l.action === 'period-close.reverse-year')).toBe(
    true,
  );
});
it('w_zw_qxfz：在线备份失败完全不改库，不退化为复制带WAL主文件', async () => {
  const raw = app.runtime.bookStore.open(app.book.id).raw;
  vi.spyOn(raw, 'backup').mockRejectedValueOnce(new Error('磁盘写入失败'));
  const before = snapshot(app);
  expect((await errorData(call(app).backupReverseYear({ year: 2026 }))).code).toBe(
    'PERIOD_CLOSE_BACKUP_FAILED',
  );
  expect(snapshot(app)).toBe(before);
});
it('w_zw_qxfz：备份缺失/损坏、非受管路径或备份后数据变化全部阻止', async () => {
  const api = call(app);
  const before = snapshot(app);
  expect(
    (
      await errorData(
        api.reverseYear({
          year: 2026,
          backupId: '/tmp/任意路径',
          confirmed: true,
          confirmText: '撤销2026年年结',
        }),
      )
    ).code,
  ).toBe('PERIOD_CLOSE_BACKUP_REQUIRED');
  expect(snapshot(app)).toBe(before);
  const backup = await api.backupReverseYear({ year: 2026 });
  await rm(path.join(app.runtime.dataDir, backup.relativePath));
  expect(
    (
      await errorData(
        api.reverseYear({
          year: 2026,
          backupId: backup.backupId,
          confirmed: true,
          confirmText: '撤销2026年年结',
        }),
      )
    ).code,
  ).toBe('PERIOD_CLOSE_BACKUP_INVALID');
  expect(snapshot(app)).toBe(before);
  const second = await api.backupReverseYear({ year: 2026 });
  await app.svc.reference.summaries();
  await app.svc.db
    .updateTable('exchange_rate')
    .set({ rate: '7.2' })
    .where('currency_code', '=', 'USD')
    .execute();
  const changed = snapshot(app);
  expect(
    (
      await errorData(
        api.reverseYear({
          year: 2026,
          backupId: second.backupId,
          confirmed: true,
          confirmText: '撤销2026年年结',
        }),
      )
    ).code,
  ).toBe('PERIOD_CLOSE_BACKUP_STALE');
  expect(snapshot(app)).toBe(changed);
});
it('w_zw_qxfz：后年度有效/作废/草稿业务都阻止，不强删；手工改过期初也阻止', async () => {
  const api = call(app);
  const [v] = await seedVouchers(app.svc, [
    {
      date: '2027-01-05',
      lines: [
        { account: '1001', debit: 1 },
        { account: '4001', credit: 1 },
      ],
    },
  ]);
  for (const voided of [false, true]) {
    await app.svc.vouchers.setVoided(v!.id, voided);
    const before = snapshot(app);
    expect((await errorData(api.reverseYearPreview({ year: 2026 }))).code).toBe(
      'PERIOD_CLOSE_TARGET_HAS_BUSINESS',
    );
    expect(snapshot(app)).toBe(before);
  }
  await app.svc.vouchers.delete(v!.id);
  const [draft] = await seedVouchers(app.svc, [{ date: '2027-01-05', status: 'draft', lines: [] }]);
  expect((await errorData(api.reverseYearPreview({ year: 2026 }))).code).toBe(
    'PERIOD_CLOSE_TARGET_HAS_BUSINESS',
  );
  await app.svc.vouchers.delete(draft!.id);
  await app.svc.opening.upsert({
    year: 2027,
    accountId: (await app.svc.accounts.require('1001')).id,
    balance: 1,
  });
  const before = snapshot(app);
  expect((await errorData(api.reverseYearPreview({ year: 2026 }))).code).toBe(
    'PERIOD_CLOSE_SNAPSHOT_CHANGED',
  );
  expect(snapshot(app)).toBe(before);
});
it('w_zw_qxfz：缺失后年度期初/期间或未知年度关联时不猜测删除', async () => {
  const api = call(app);
  await app.svc.db.deleteFrom('period').where('period', '=', 202712).execute();
  let before = snapshot(app);
  expect((await errorData(api.reverseYearPreview({ year: 2026 }))).code).toBe(
    'PERIOD_CLOSE_TARGET_PERIOD_CLOSED',
  );
  expect(snapshot(app)).toBe(before);
  await app.svc.periods.ensureYear(2027, { openingStored: true });
  await app.svc.opening.remove((await app.svc.opening.list(2027))[0]!.id);
  before = snapshot(app);
  expect((await errorData(api.reverseYearPreview({ year: 2026 }))).code).toBe(
    'PERIOD_CLOSE_SNAPSHOT_CHANGED',
  );
  expect(snapshot(app)).toBe(before);
});
it('w_zw_qxfz：逆年结中途失败全部回滚，在线备份仍保留', async () => {
  const api = call(app);
  const backup = await api.backupReverseYear({ year: 2026 });
  app.runtime.bookStore
    .open(app.book.id)
    .raw.exec(
      "CREATE TRIGGER period_close_test_reverse_fail BEFORE DELETE ON fiscal_year WHEN OLD.year=2027 BEGIN SELECT RAISE(ABORT,'测试逆年结后半失败'); END",
    );
  // 测试触发器仅注入失败，不修改任何凭证事实。
  const before = snapshot(app);
  expect(
    (
      await errorData(
        api.reverseYear({
          year: 2026,
          backupId: backup.backupId,
          confirmed: true,
          confirmText: '撤销2026年年结',
        }),
      )
    ).code,
  ).toBe('PERIOD_CLOSE_REVERSE_DEPENDENCIES');
  expect(snapshot(app)).toBe(before);
  expect(
    (await readFile(path.join(app.runtime.dataDir, backup.relativePath))).length,
  ).toBeGreaterThan(0);
});

it('w_zw_qxfz：不能仅凭核心凭证为空就删除其他来源模块可能使用的后年度期初', async () => {
  const { defineManifest } = await import('@caiwu/core');
  const { defineServerModule, moduleKit } = await import('@caiwu/server-kit');
  const manifest = defineManifest({
    id: 'period-dependency-test',
    name: '测试业务来源',
    products: 'all',
    sources: [{ type: 'test', name: '测试单据', path: '/?id={id}' }],
  });
  const m = moduleKit(manifest);
  const other = defineServerModule(manifest, { router: m.router({}) });
  const independent = await createTestApp({ modules: [periodCloseServer, other] });
  try {
    await zeroOpening(independent);
    const api = call(independent);
    for (let month = 1; month <= 12; month++)
      await api.close({ period: 202600 + month, confirmed: true });
    await api.yearEnd({ year: 2026, confirmed: true });
    const before = snapshot(independent);
    expect((await errorData(api.reverseYearPreview({ year: 2026 }))).code).toBe(
      'PERIOD_CLOSE_MODULE_DEPENDENCIES_UNKNOWN',
    );
    expect((await errorData(api.backupReverseYear({ year: 2026 }))).code).toBe(
      'PERIOD_CLOSE_MODULE_DEPENDENCIES_UNKNOWN',
    );
    expect(snapshot(independent)).toBe(before);
  } finally {
    await independent.close();
  }
});
