import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import periodCloseServer from '../server';
import { call, errorData, snapshot, zeroOpening } from './helpers';
import { seedPostedMonths } from './posted-months';
import { tables } from '../server/transfers';

let app: TestApp;
let seeded: Awaited<ReturnType<typeof seedPostedMonths>>;
const range = { from: 202601, to: 202602 };
beforeEach(async () => {
  app = await createTestApp({ modules: [periodCloseServer] });
  await zeroOpening(app);
  seeded = await seedPostedMonths(app);
});
afterEach(async () => app.close());

async function financialState() {
  return {
    vouchers: await Promise.all(
      (await app.svc.vouchers.list()).items.map((v) => app.svc.vouchers.get(v.id)),
    ),
    opening: await app.svc.opening.list(2026),
    balances: await app.svc.ledger.balances({ periodFrom: range.from, periodTo: range.to }),
    runs: await tables(app.svc)
      .selectFrom('period_close_run')
      .selectAll()
      .orderBy('period')
      .execute(),
  };
}

it('w_zw_fz P1：两月结转均异人审核过账，核验前月不受后月run阻止并可连续结账', async () => {
  const api = call(app);
  for (const period of [range.from, range.to]) {
    const check = await api.check({ period });
    // 后月的顺序项须等待前月关闭，其余实际业务检查已全部通过。
    expect(check.items.filter((i) => i.id !== 'sequence').every((i) => i.pass)).toBe(true);
    expect(check.generated).toHaveLength(1);
    expect(check.generated[0]!.voucher).toMatchObject({
      status: 'posted',
      auditedBy: { id: seeded.reviewerId },
    });
    expect(check.generated[0]!.voucher!.createdBy.id).not.toBe(seeded.reviewerId);
  }
  const before = snapshot(app);
  const finances = await financialState();
  expect(finances.runs.map((r) => r.period)).toEqual([202601, 202602]);
  const preview = await api.closeRangePreview(range);
  expect(preview.allPassed).toBe(true);
  expect(preview.items.map((i) => i.ready)).toEqual([true, true]);
  expect(snapshot(app)).toBe(before);
  await api.closeRange({ ...range, confirmed: true, previewToken: preview.previewToken });
  expect(
    (await app.svc.periods.list()).filter((p) => p.status === 'closed').map((p) => p.period),
  ).toEqual([202601, 202602]);
  expect(await financialState()).toEqual(finances);
  await api.reopen({ ...range, confirmed: true });
  expect(await financialState()).toEqual(finances);
});

it('w_zw_fz P1：两月已有真实结转时第二个月失败，前月结账和日志仍整体回滚', async () => {
  const api = call(app);
  const preview = await api.closeRangePreview(range);
  app.runtime.bookStore
    .open(app.book.id)
    .raw.exec(
      "CREATE TRIGGER period_close_test_posted_months_fail BEFORE UPDATE ON period WHEN NEW.period=202602 AND NEW.status='closed' BEGIN SELECT RAISE(ABORT,'两月结转结账故障'); END",
    );
  const before = snapshot(app);
  await expect(
    api.closeRange({ ...range, confirmed: true, previewToken: preview.previewToken }),
  ).rejects.toThrow('两月结转结账故障');
  expect(snapshot(app)).toBe(before);
});

it('w_zw_ydjz/fgz P1：只读核验不放宽前月预览生成、反过账和删除的后月依赖保护', async () => {
  const api = call(app);
  const before = snapshot(app);
  for (const action of [
    () => api.preview({ period: range.from, ruleIds: [seeded.ruleId] }),
    () =>
      api.generate({
        period: range.from,
        ruleIds: [seeded.ruleId],
        confirmed: true,
        previewToken: 'old',
      }),
    () => api.unpost({ from: range.from, to: range.from, confirmed: true }),
    () => api.deleteGenerated({ period: range.from, ruleId: seeded.ruleId, confirmed: true }),
  ]) {
    expect((await errorData(action())).code).toBe('PERIOD_CLOSE_LATER_TRANSFER');
    expect(snapshot(app)).toBe(before);
  }
});

it('w_zw_fz P1：只读核验仍拒绝过期基数，不因已有后月run跳过快照验证', async () => {
  for (const [code, balance] of [
    ['4001', 1],
    ['4103', -1],
  ] as const)
    await app.svc.opening.upsert({
      year: 2026,
      accountId: (await app.svc.accounts.require(code)).id,
      balance,
    });
  const before = snapshot(app);
  expect((await errorData(call(app).closeRangePreview(range))).code).toBe(
    'PERIOD_CLOSE_STALE_TRANSFER',
  );
  expect(snapshot(app)).toBe(before);
});

it('w_zw_fz P1：只读核验仍拒绝无法核实的来源关联，保留两月数据', async () => {
  await tables(app.svc)
    .updateTable('period_close_run')
    .set({ voucher_id: seeded.originals[0]! })
    .where('period', '=', range.from)
    .execute();
  const before = snapshot(app);
  expect((await errorData(call(app).closeRangePreview(range))).code).toBe(
    'PERIOD_CLOSE_SOURCE_MISMATCH',
  );
  expect(snapshot(app)).toBe(before);
});
