import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import server from '../server';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
});
afterEach(async () => {
  await app.close();
});

describe('w_grant / w_xt_kgzb 事务及破坏性维护保护', () => {
  it('w_grant 授权和管理员标志与日志同事务，失败不改变旧授权或撤销会话', async () => {
    const token = await app.addUser('rollback', {
      password: 'synthetic123',
      permissions: ['system-admin.password'],
    });
    const user = (await app.svc.users.list()).find((u) => u.code === 'rollback')!;
    const before = await app.call(server).users.permissions({ id: user.id });
    const logs = await app.svc.log.list();
    const raw = app.runtime.bookStore.open(app.book.id).raw;
    raw.exec(
      "CREATE TEMP TRIGGER system_admin_grant_failure BEFORE INSERT ON operation_log BEGIN SELECT RAISE(ABORT, '合成授权日志失败'); END",
    );
    try {
      await expect(
        app.call(server).users.setPermissions({
          id: user.id,
          isAdmin: true,
          permissions: ['system-admin.check'],
          confirmCode: user.code,
        }),
      ).rejects.toThrow('合成授权日志失败');
      expect(await app.call(server).users.permissions({ id: user.id })).toEqual(before);
      expect((await app.core(token).auth.me()).user.isAdmin).toBe(false);
      expect(await app.svc.log.list()).toEqual(logs);
    } finally {
      raw.exec('DROP TRIGGER system_admin_grant_failure');
    }
  });

  it('w_xt_kgzb_2 / _3 缺受管票据的删除/覆盖先拒绝；确认文字不能代替初始化计划', async () => {
    const [voucher] = await seedVouchers(app.svcFor('system-admin'), [
      {
        date: '2026-01-10',
        status: 'posted',
        lines: [
          { account: '1001', debit: 12345 },
          { account: '6001', credit: 12345 },
        ],
      },
    ]);
    const source = await app.svcFor('system-admin').vouchers.create({
      date: '2026-01-11',
      voucherTypeId: 1,
      source: { type: 'synthetic', id: 'protected' },
      lines: [
        { accountId: (await app.svc.accounts.require('1001')).id, summary: '合成来源', debit: 100 },
        {
          accountId: (await app.svc.accounts.require('6001')).id,
          summary: '合成来源',
          credit: 100,
        },
      ],
    });
    const cash = await app.svc.accounts.require('1001');
    await app.svc.opening.upsert({ year: 2026, accountId: cash.id, balance: 0 });
    const snapshot = async () => ({
      book: await app.svc.book.info(),
      accounts: await app.svc.accounts.list(),
      vouchers: await app.svc.vouchers.list({}),
      posted: await app.svc.vouchers.get(voucher!.id),
      source: await app.svc.vouchers.get(source.id),
      opening: await app.svc.opening.list(2026),
      periods: await app.svc.periods.list(),
      logs: await app.svc.log.list(),
      users: await app.svc.users.list(),
    });
    const before = await snapshot();
    let prepared = false;
    for (const kind of ['delete', 'replace'] as const)
      await expect(
        app.runtime.bookStore.maintain(app.book.id, {
          kind,
          prepare: async () => {
            prepared = true;
          },
        }),
      ).rejects.toMatchObject({ data: { code: 'DESTRUCTIVE_MAINTENANCE_UNAVAILABLE' } });
    expect(prepared).toBe(false);
    for (const confirmBookName of [app.book.name, 'wrong'])
      await expect(
        app.call(server).reset.execute({
          planId: '00000000-0000-4000-8000-000000000000',
          confirmBookName,
          confirmed: true,
          confirmation: '重新初始化',
          password: 'admin',
        }),
      ).rejects.toMatchObject({ cause: { data: { code: 'RESET_PLAN_EXPIRED' } } });
    await expect(app.call(server).reset.adjustStartDate()).rejects.toMatchObject({
      cause: { data: { code: 'RESET_UNAVAILABLE' } },
    });
    expect((await app.call(server).reset.preflight()).executable).toBe(true);
    expect(await snapshot()).toEqual(before);
    expect((await app.core().auth.me()).book.id).toBe(app.book.id);
    await expect(app.svc.vouchers.delete(source.id)).rejects.toMatchObject({
      data: { code: 'VOUCHER_FROM_SOURCE' },
    });
    await expect(app.svc.vouchers.delete(voucher!.id)).rejects.toMatchObject({
      data: { code: 'VOUCHER_LOCKED' },
    });
  });
});
