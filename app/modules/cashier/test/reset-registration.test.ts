import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import cashierServer from '../server';
import {
  registerCashierResetProtection,
  type RuntimeResetProtection,
} from '../server/reset-protection';

const apps: TestApp[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function setup() {
  const app = await createTestApp({ modules: [cashierServer] });
  apps.push(app);
  const api = app.call(cashierServer);
  await api.enable({ period: 202601 });
  const account = await api.saveAccount({
    data: {
      name: '保护回调接线测试',
      coreAccountId: (await app.svc.accounts.require('100201')).id,
      currency: 'CNY',
      opening: 20000,
    },
  });
  await api.createDocument({
    accountId: account.id,
    period: 202601,
    date: '2026-01-12',
    summary: '回调接线测试',
    direction: 'receipt',
    amount: 5000,
    dimensions: { cashflow: (await app.svc.dimensions.getByCode('cashflow', 'CF01'))!.id },
    requestKey: randomUUID(),
  });
  const request = {
    period: 202602,
    snapshot: (await api.resetPreview()).snapshot,
    bookName: app.book.name,
    confirmation: '清空出纳数据' as const,
    confirmed: true as const,
    requestKey: randomUUID(),
  };
  return { app, api, request };
}

// 使用合成能力仅验证注册、上下文传递及账套隔离；这里不生成真实备份文件。
describe('w_cn_xtcsh 保护备份能力的运行环境注册与真实路由接线', () => {
  it('已注册环境通过路由收到可信账套、操作员和模块，另一运行环境不能借用能力', async () => {
    const first = await setup();
    const second = await setup();
    const protect = vi.fn<RuntimeResetProtection>().mockResolvedValue({
      id: '合成接线收据',
      status: 'valid',
      sha256: '1'.repeat(64),
    });
    registerCashierResetProtection(first.app.runtime, protect);
    await expect(second.api.reset(second.request)).rejects.toThrow('保护备份暂不可用');
    expect(await second.api.documents({})).toHaveLength(1);
    expect(protect).not.toHaveBeenCalled();
    const forgedExtraFields = {
      ...first.request,
      bookId: second.app.book.id,
      userId: 9999,
      moduleId: '其他模块',
      reason: '其他目的',
    };
    const result = await first.api.reset(forgedExtraFields);
    expect(protect).toHaveBeenCalledExactlyOnceWith(
      {
        requestKey: first.request.requestKey,
        bookId: first.app.book.id,
        userId: 1,
        moduleId: 'cashier',
        reason: 'cashier.reset',
      },
      expect.objectContaining({
        app: first.app.runtime,
        moduleId: 'cashier',
        session: expect.objectContaining({ bookId: first.app.book.id, userId: 1 }),
      }),
    );
    expect(result).toMatchObject({ period: 202602, backupId: '合成接线收据' });
    expect(await first.api.documents({})).toEqual([]);
    expect(await first.api.accounts({})).toEqual([]);
    expect(await first.api.reset(first.request)).toEqual(result);
    expect(protect).toHaveBeenCalledOnce();
    expect(await second.api.documents({})).toHaveLength(1);
  });

  it('已注册能力也不能绕过路由权限、强确认和备份失败保护', async () => {
    const { app, api, request } = await setup();
    const protect = vi
      .fn<RuntimeResetProtection>()
      .mockRejectedValue(new Error('合成备份能力故障'));
    registerCashierResetProtection(app.runtime, protect);
    const viewer = app.call(
      cashierServer,
      await app.addUser('reset-route-viewer', { permissions: ['cashier.view'] }),
    );
    await expect(viewer.resetPreview()).rejects.toThrow('权限');
    await expect(viewer.reset(request)).rejects.toThrow('权限');
    await expect(api.reset({ ...request, confirmed: false as true })).rejects.toThrow();
    expect(protect).not.toHaveBeenCalled();
    await expect(api.reset(request)).rejects.toThrow('完整保护备份失败');
    expect(protect).toHaveBeenCalledOnce();
    expect(await api.accounts({})).toHaveLength(1);
    expect(await api.documents({})).toHaveLength(1);
    expect(await api.status()).toEqual({ period: 202601 });
  });
});
