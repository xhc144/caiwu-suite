import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type * as Fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import backupServer from '../server';
import { waitForJobs } from '../server/service';

const cleanupFault = vi.hoisted(() => ({ target: '' }));
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof Fs>();
  return {
    ...actual,
    rmSync: (...args: Parameters<typeof actual.rmSync>) => {
      if (String(args[0]) === cleanupFault.target)
        throw Object.assign(new Error('合成暂存清理占用'), { code: 'EPERM' });
      return actual.rmSync(...args);
    },
  };
});
let app: TestApp;
const caller = (a: TestApp) => a.call(backupServer);
let api: ReturnType<typeof caller>;
beforeEach(async () => {
  app = await createTestApp({ modules: [backupServer] });
  api = caller(app);
});
afterEach(async () => {
  cleanupFault.target = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
  await waitForJobs(app.runtime);
  await app.close();
});
function nativeStore() {
  const store = app.runtime.bookStore;
  if (
    !('cancelReplacement' in store) ||
    typeof store.cancelReplacement !== 'function' ||
    !('cleanupExpiredReplacements' in store) ||
    typeof store.cleanupExpiredReplacements !== 'function'
  )
    throw new Error('本联调需要共享提交140fde854932580e3065fa1f032ab042acd181ea的真实恢复清理接口');
  return store;
}
async function fixture() {
  const store = nativeStore();
  const spec = (amount: number) => ({
    date: '2026-01-05',
    lines: [
      { account: '1001', debit: amount },
      { account: '6603', credit: amount },
    ],
  });
  await seedVouchers(app.svc, [spec(12345)]);
  const item = await api.create({ requestId: randomUUID(), name: '真实清理联调来源' });
  await waitForJobs(app.runtime);
  await seedVouchers(app.svc, [spec(67890)]);
  const plan = await api.preview({ id: item.id, purpose: 'overwrite' });
  const stage = vi.spyOn(store, 'prepareReplacement');
  await api.prepareOverwrite({ planId: plan.id });
  const ticket = await stage.mock.results[0]!.value;
  const file = path.join(app.runtime.dataDir, 'restore-staging', `${ticket.replacementId}.sqlite`);
  expect(existsSync(file)).toBe(true);
  return { store, plan, ticket, file };
}
it('w_hf 真实共享联调：模块取消删除准备票据文件，重复取消幂等且原账保留', async () => {
  const { store, plan, ticket, file } = await fixture();
  await api.cancelPlan({ id: plan.id });
  expect(store.replacementStatus(ticket.replacementId)).toMatchObject({
    status: 'cancelled',
    stagingRetained: false,
    cleanupPending: false,
  });
  expect(existsSync(file)).toBe(false);
  store.cancelReplacement({ bookId: app.book.id, replacementId: ticket.replacementId });
  expect((await app.svc.vouchers.list({})).items).toHaveLength(2);
});
it('w_hf 真实共享联调：过期票据由共享清理移除文件，模块拒绝过期覆盖', async () => {
  const { store, plan, ticket, file } = await fixture();
  const time = Date.now();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(time + 6 * 60_000);
  expect(store.cleanupExpiredReplacements()).toEqual({ expired: 1 });
  expect(store.replacementStatus(ticket.replacementId)).toMatchObject({
    status: 'expired',
    stagingRetained: false,
    cleanupPending: false,
  });
  expect(existsSync(file)).toBe(false);
  await expect(
    api.restore({ planId: plan.id, text: plan.confirmation, password: 'admin' }),
  ).rejects.toThrow('过期');
  expect((await app.svc.vouchers.list({})).items).toHaveLength(2);
});
it('w_hf 真实共享联调：替换完成后的文件清理故障仍done，修复后取消只清暂存且不回滚成功账套', async () => {
  const { store, plan, ticket, file } = await fixture();
  cleanupFault.target = file;
  const result = await api.restore({ planId: plan.id, text: plan.confirmation, password: 'admin' });
  expect(result).toMatchObject({
    bookId: app.book.id,
    relogin: true,
    purpose: 'overwrite',
    cleanupPending: true,
  });
  expect(store.replacementStatus(ticket.replacementId)).toMatchObject({
    status: 'done',
    stagingRetained: true,
    cleanupPending: true,
  });
  const raw = store.open(app.book.id).raw;
  expect(raw.prepare('SELECT debit_total FROM voucher').all()).toEqual([{ debit_total: 12345 }]);
  expect(raw.prepare('SELECT count(*) n FROM backup_item').get()).toEqual({ n: 2 });
  cleanupFault.target = '';
  store.cancelReplacement({ bookId: app.book.id, replacementId: ticket.replacementId });
  expect(store.replacementStatus(ticket.replacementId)).toMatchObject({
    status: 'done',
    stagingRetained: false,
    cleanupPending: false,
  });
  expect(existsSync(file)).toBe(false);
  expect(raw.prepare('SELECT debit_total FROM voucher').all()).toEqual([{ debit_total: 12345 }]);
});
