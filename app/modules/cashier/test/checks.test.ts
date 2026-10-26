import { beforeEach, afterEach, expect, it } from 'vitest';
import { sql } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import cashierServer from '../server';

let app: TestApp;
const call = (a: TestApp, token?: string) => a.call(cashierServer, token);
let api: ReturnType<typeof call>;
let accountId: number;
beforeEach(async () => {
  app = await createTestApp({ modules: [cashierServer] });
  api = call(app);
  await api.enable({ period: 202601 });
  accountId = (
    await api.saveAccount({
      data: {
        name: '支票银行',
        coreAccountId: (await app.svc.accounts.require('100201')).id,
        currency: 'CNY',
        opening: 0,
      },
    })
  ).id;
});
afterEach(async () => app.close());
const receive = (number = 'CH-001') =>
  api.receiveCheck({ accountId, number, receivedDate: '2026-01-02' });
const issue = (id: number, revision = 1) =>
  api.issueCheck({
    id,
    revision,
    date: '2026-01-05',
    payee: '合成供应商',
    amount: 10001,
    confirmed: true,
  });

it('支票管理 真实领用→签发→兑付，保留金额/票面/日志，禁止重兑和兑付后作废', async () => {
  const c = await receive();
  await issue(c.id);
  await api.finishCheck({
    id: c.id,
    revision: 2,
    date: '2026-01-06',
    state: 'cleared',
    confirmed: true,
  });
  expect((await api.checks({}))[0]).toMatchObject({
    account_id: accountId,
    number: 'CH-001',
    payee: '合成供应商',
    amount: 10001,
    received_date: '2026-01-02',
    issued_date: '2026-01-05',
    finished_date: '2026-01-06',
    state: 'cleared',
    revision: 3,
  });
  await expect(
    api.finishCheck({
      id: c.id,
      revision: 3,
      date: '2026-01-07',
      state: 'voided',
      confirmed: true,
    }),
  ).rejects.toThrow('不能再次');
  await expect(
    api.finishCheck({
      id: c.id,
      revision: 3,
      date: '2026-01-07',
      state: 'cleared',
      confirmed: true,
    }),
  ).rejects.toThrow('不能再次');
  expect(await api.documents({})).toEqual([]);
  expect(await app.svc.vouchers.list({})).toEqual({ items: [], total: 0 });
  expect(
    (await app.svc.log.list())
      .filter((x) => x.action.startsWith('cashier.check.'))
      .map((x) => x.action)
      .sort(),
  ).toEqual(['cashier.check.cleared', 'cashier.check.issue', 'cashier.check.receive']);
});
it('支票管理 已领用可作废；未签发不能兑付；作废后不能签发', async () => {
  const c = await receive();
  await expect(
    api.finishCheck({
      id: c.id,
      revision: 1,
      date: '2026-01-06',
      state: 'cleared',
      confirmed: true,
    }),
  ).rejects.toThrow('未签发');
  await api.finishCheck({
    id: c.id,
    revision: 1,
    date: '2026-01-06',
    state: 'voided',
    confirmed: true,
  });
  await expect(issue(c.id, 2)).rejects.toThrow('只有已领用');
  expect((await api.checks({ state: 'voided' }))[0]!.amount).toBeNull();
});
it('支票管理 同银行票号规范化唯一，现金账户拒绝，使用后账户初值锁定', async () => {
  await receive(' ch-001 ');
  await expect(receive('CH-001')).rejects.toThrow('不能重复');
  const cash = (
    await api.saveAccount({
      data: {
        name: '现金',
        coreAccountId: (await app.svc.accounts.require('1001')).id,
        currency: 'CNY',
        opening: 0,
      },
    })
  ).id;
  await expect(
    api.receiveCheck({ accountId: cash, number: 'CH-001', receivedDate: '2026-01-02' }),
  ).rejects.toThrow('银行末级');
  await expect(
    api.saveAccount({
      edit: { id: accountId, revision: 1 },
      data: {
        name: '银行',
        coreAccountId: (await app.svc.accounts.require('100201')).id,
        currency: 'CNY',
        opening: 1,
      },
    }),
  ).rejects.toThrow('已使用');
  expect(await api.checks({})).toHaveLength(1);
});
it('支票管理 只有整数正金额；签发/兑付日期顺序、强确认和过期revision阻止', async () => {
  const c = await receive();
  const data = {
    id: c.id,
    revision: 1,
    date: '2026-01-05',
    payee: '单位',
    amount: 1,
    confirmed: true as const,
  };
  for (const amount of [0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1])
    await expect(api.issueCheck({ ...data, amount })).rejects.toThrow();
  await expect(api.issueCheck({ ...data, date: '2026-01-01' })).rejects.toThrow('早于领用');
  await expect(api.issueCheck({ ...data, confirmed: false as true })).rejects.toThrow();
  await issue(c.id);
  await expect(issue(c.id)).rejects.toThrow('已经变化');
  await expect(
    api.finishCheck({
      id: c.id,
      revision: 2,
      date: '2026-01-04',
      state: 'cleared',
      confirmed: true,
    }),
  ).rejects.toThrow('早于签发');
  expect((await api.checks({}))[0]!.state).toBe('issued');
});
it('支票管理 已关月领用/签发/兑付不能回填；跨月兑付合法', async () => {
  const c = await receive();
  await issue(c.id);
  const p = await api.periods();
  await api.closePeriod({ period: p.current, snapshot: p.snapshot, confirmed: true });
  await expect(receive('CH-002')).rejects.toThrow('已经结账');
  await expect(
    api.finishCheck({
      id: c.id,
      revision: 2,
      date: '2026-01-06',
      state: 'cleared',
      confirmed: true,
    }),
  ).rejects.toThrow('已经结账');
  await api.finishCheck({
    id: c.id,
    revision: 2,
    date: '2026-02-06',
    state: 'cleared',
    confirmed: true,
  });
  expect((await api.checks({}))[0]!.state).toBe('cleared');
});
it('支票管理 领用/签发与兑付权限独立，写日志失败回滚状态和金额', async () => {
  const viewer = call(app, await app.addUser('viewer', { permissions: ['cashier.view'] }));
  await expect(
    viewer.receiveCheck({ accountId, number: 'X', receivedDate: '2026-01-01' }),
  ).rejects.toThrow('权限');
  const c = await receive();
  const issuer = call(
    app,
    await app.addUser('issuer', { permissions: ['cashier.view', 'cashier.check.edit'] }),
  );
  await issuer.issueCheck({
    id: c.id,
    revision: 1,
    date: '2026-01-05',
    payee: '单位',
    amount: 1,
    confirmed: true,
  });
  await expect(
    issuer.finishCheck({
      id: c.id,
      revision: 2,
      date: '2026-01-06',
      state: 'cleared',
      confirmed: true,
    }),
  ).rejects.toThrow('权限');
  await sql`CREATE TRIGGER cashier_check_failure BEFORE INSERT ON operation_log WHEN NEW.action = 'cashier.check.cleared' BEGIN SELECT RAISE(FAIL, '合成兑付失败'); END`.execute(
    app.svc.db,
  );
  await expect(
    api.finishCheck({
      id: c.id,
      revision: 2,
      date: '2026-01-06',
      state: 'cleared',
      confirmed: true,
    }),
  ).rejects.toThrow('合成兑付失败');
  expect((await api.checks({}))[0]).toMatchObject({
    state: 'issued',
    amount: 1,
    revision: 2,
    finished_date: null,
  });
});
