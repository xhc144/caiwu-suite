import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';
let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [server], startMonth: 6 });
});
afterEach(async () => {
  await app.close();
});
describe('w_login 独立操作日期', () => {
  it('登录会话各自保留日期，不改变系统时间、期间及其他会话', async () => {
    const first = app.call(server);
    const second = app.call(server, await app.login());
    const original = await second.operationDate.get();
    const periods = await app.svc.periods.list();
    expect(await first.operationDate.set({ date: '2026-06-13' })).toMatchObject({
      date: '2026-06-13',
      startDate: '2026-06-01',
    });
    expect((await first.operationDate.get()).date).toBe('2026-06-13');
    expect(await second.operationDate.get()).toEqual(original);
    expect(await app.svc.periods.list()).toEqual(periods);
  });
  it('非法日历或早于开账日期拒绝，日志失败保留旧日期', async () => {
    const api = app.call(server);
    await api.operationDate.set({ date: '2026-06-20' });
    await expect(api.operationDate.set({ date: '2026-05-31' })).rejects.toThrow('早于');
    await expect(api.operationDate.set({ date: '2026-02-30' })).rejects.toThrow();
    const raw = app.runtime.bookStore.open(app.book.id).raw;
    raw.exec(
      "CREATE TEMP TRIGGER system_admin_date_failure BEFORE INSERT ON operation_log BEGIN SELECT RAISE(ABORT, '合成日期日志失败'); END",
    );
    try {
      await expect(api.operationDate.set({ date: '2026-07-01' })).rejects.toThrow(
        '合成日期日志失败',
      );
    } finally {
      raw.exec('DROP TRIGGER system_admin_date_failure');
    }
    expect((await api.operationDate.get()).date).toBe('2026-06-20');
  });
  it('普通已登录用户可设置自己的日期，撤销会话后不可读取', async () => {
    const token = await app.addUser('clerk');
    const api = app.call(server, token);
    await api.operationDate.set({ date: '2026-08-01' });
    expect((await api.operationDate.get()).date).toBe('2026-08-01');
    await app.core(token).auth.logout();
    await expect(api.operationDate.get()).rejects.toThrow('登录已失效');
  });
});
