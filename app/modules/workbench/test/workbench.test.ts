import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineManifest } from '@caiwu/core';
import { sql } from '@caiwu/db';
import { defineServerModule, moduleKit } from '@caiwu/server-kit';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import workbench from '../server';

const voucherManifest = defineManifest({
  id: 'voucher-book',
  name: '测试凭证查询',
  products: 'all',
  permissions: [{ id: 'voucher-book.view', name: '查看凭证' }],
  menu: [{ group: 'voucher', title: '凭证查询', path: '/', permission: 'voucher-book.view' }],
});
const voucherModule = defineServerModule(voucherManifest, {
  router: moduleKit(voucherManifest).router({}),
});
const masterManifest = defineManifest({
  id: 'masterdata',
  name: '测试基础档案',
  products: 'all',
  permissions: [
    { id: 'masterdata.accounts.view', name: '查看科目' },
    { id: 'masterdata.partners.view', name: '查看客供' },
    { id: 'masterdata.summaries.view', name: '查看摘要' },
  ],
  menu: [
    {
      group: 'master',
      title: '科目维护',
      path: '/accounts',
      permission: 'masterdata.accounts.view',
    },
    { group: 'master', title: '客供', path: '/dimensions', permission: 'masterdata.partners.view' },
    { group: 'master', title: '摘要', path: '/summaries', permission: 'masterdata.summaries.view' },
  ],
});
const masterModule = defineServerModule(masterManifest, {
  router: moduleKit(masterManifest).router({}),
});
const sourceManifest = defineManifest({
  id: 'pay-source',
  name: '测试来源',
  products: ['chengben'],
  permissions: [{ id: 'pay-source.view', name: '查看来源' }],
  menu: [{ group: 'payroll', title: '来源', path: '/documents', permission: 'pay-source.view' }],
  sources: [{ type: 'doc', name: '来源单', path: '/documents?id={id}' }],
});
const sourceModule = defineServerModule(sourceManifest, {
  router: moduleKit(sourceManifest).router({}),
});
let app: TestApp;
const specs = (status: 'draft' | 'pending' | 'audited' | 'posted', date = '2026-01-10') => ({
  date,
  status,
  summary: '工作台凭证摘要',
  lines: [
    { account: '1001', debit: 10000 },
    { account: '6001', credit: 10000 },
  ],
});
beforeEach(async () => {
  app = await createTestApp({ modules: [workbench, voucherModule, masterModule, sourceModule] });
});
afterEach(async () => app.close());

describe('w_main1 工作台', () => {
  it('按实际状态计数，排除草稿和作废，切期间并读取真实结账状态', async () => {
    const vouchers = await seedVouchers(app.svc, [
      specs('pending'),
      specs('audited'),
      specs('posted'),
      specs('draft'),
      specs('pending'),
      specs('pending', '2026-02-10'),
    ]);
    await app.svc.vouchers.setVoided(vouchers[4]!.id, true);
    const api = app.call(workbench);
    expect((await api.overview({})).counts).toEqual({ pending: 1, audited: 1, posted: 1 });
    expect((await api.overview({ period: 202602 })).counts).toEqual({
      pending: 1,
      audited: 0,
      posted: 0,
    });
    await app.svc.periods.setStatus(202601, 'closed');
    const overview = await api.overview({ period: 202601 });
    expect(overview.selected?.status).toBe('closed');
    expect(overview.current?.period).toBe(202602);
    expect((await api.overview({})).selected?.period).toBe(202602);
  });
  it('超过500张时仍统计全量，并与core total核对', async () => {
    await seedVouchers(
      app.svc,
      Array.from({ length: 502 }, () => specs('pending')),
    );
    const core = await app.svc.vouchers.list({
      periodFrom: 202601,
      periodTo: 202601,
      statuses: ['pending'],
    });
    expect(core.items).toHaveLength(500);
    expect((await app.call(workbench).overview({})).counts?.pending).toBe(core.total);
    expect(core.total).toBe(502);
  });
  it('w_main1 无权用户直调统计/搜索/产品切换被拒，MANAGER不授予身份', async () => {
    const token = await app.addUser('MANAGER');
    const caller = app.call(workbench, token);
    await expect(caller.overview({})).rejects.toThrow(/权限/);
    await expect(caller.search({ term: '1001' })).rejects.toThrow(/权限/);
    await expect(
      caller.switchProduct({ product: 'qingsong', expectedProduct: 'chengben', confirmed: true }),
    ).rejects.toThrow(/权限/);
    const searchOnly = app.call(
      workbench,
      await app.addUser('searcher', {
        permissions: ['workbench.search', 'workbench.overview.view'],
      }),
    );
    const result = await searchOnly.search({ term: '1001' });
    expect(result.results).toEqual([]);
    expect(result.denied).toEqual(expect.arrayContaining(['科目', '凭证', '摘要', '往来单位']));
    await expect(searchOnly.overview({})).rejects.toThrow(/凭证查询权限/);
  });
  it('只检索已加载且产品/读取授权匹配的实体和凭证来源', async () => {
    await seedVouchers(app.svc, [specs('pending')]);
    const cash = await app.svc.accounts.require('1001');
    const income = await app.svc.accounts.require('6001');
    const type = (await app.svc.reference.voucherTypes())[0]!;
    await app.svcFor('pay-source').vouchers.create({
      date: '2026-01-10',
      voucherTypeId: type.id,
      source: { type: 'doc', id: '1' },
      lines: [
        { summary: '隐藏来源', accountId: cash.id, debit: 100 },
        { summary: '隐藏来源', accountId: income.id, credit: 100 },
      ],
    });
    const token = await app.addUser('viewer', {
      permissions: [
        'workbench.search',
        'workbench.overview.view',
        'voucher-book.view',
        'masterdata.accounts.view',
      ],
    });
    const api = app.call(workbench, token);
    expect((await api.overview({})).counts?.pending).toBe(1);
    expect((await api.search({ term: '隐藏来源' })).results).toEqual([]);
    expect((await api.search({ term: 'kcxj' })).results[0]).toMatchObject({
      category: '科目',
      title: '1001 库存现金',
    });
    await app.svc.users.setPermissions(2, [
      'workbench.search',
      'workbench.overview.view',
      'voucher-book.view',
      'pay-source.view',
    ]);
    expect((await api.overview({})).counts?.pending).toBe(2);
    await app
      .call(workbench)
      .switchProduct({ product: 'qingsong', expectedProduct: 'chengben', confirmed: true });
    expect((await api.overview({})).counts?.pending).toBe(1);
    expect((await api.search({ term: '隐藏来源' })).results).toEqual([]);
  });
  it('未知/未加载来源对普通用户不授予权限，管理员可独立核对', async () => {
    const only = await createTestApp({ modules: [workbench] });
    try {
      const api = only.call(
        workbench,
        await only.addUser('viewer', {
          permissions: [
            'workbench.search',
            'workbench.overview.view',
            'voucher-book.view',
            'masterdata.accounts.view',
          ],
        }),
      );
      expect((await api.search({ term: '1001' })).results).toEqual([]);
      await expect(api.overview({})).rejects.toThrow(/凭证查询权限/);
      expect((await only.call(workbench).search({ term: '1001' })).results[0]?.category).toBe(
        '科目',
      );
    } finally {
      await only.close();
    }
  });
  it('编码、中文与拼音检索；字面注入字符不扩大结果；上限和类型凭证号', async () => {
    await seedVouchers(app.svc, [specs('pending')]);
    const api = app.call(workbench);
    for (const term of ['1001', '库存现金', 'kcxj'])
      expect(
        (await api.search({ term })).results.some(
          (r) => r.category === '科目' && r.title.startsWith('1001'),
        ),
      ).toBe(true);
    expect((await api.search({ term: '工作台凭证摘要' })).results[0]).toMatchObject({
      category: '凭证',
    });
    expect((await api.search({ term: '0001' })).results[0]?.to).toMatch(
      /id=1&type=1&period=202601/,
    );
    expect((await api.search({ term: 'C001' })).results[0]?.category).toBe('往来单位');
    expect((await api.search({ term: "%' OR 1=1 --" })).results).toEqual([]);
    await expect(api.search({ term: 'a'.repeat(65) })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(api.search({ term: 'a', limit: 31 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect((await api.search({ term: '1', limit: 3 })).results.length).toBeLessThanOrEqual(3);
  });
  it('同号不同类型凭证保留独立身份，摘要/客供拼音可以定位', async () => {
    await seedVouchers(app.svc, [specs('pending')]);
    await app.svc.db
      .insertInto('voucher_type')
      .values({ code: '收', name: '收款凭证', rule: null, disabled: 0, sort: 1 })
      .execute();
    await seedVouchers(app.svc, [{ ...specs('pending'), type: '收' }]);
    const api = app.call(workbench);
    const results = (await api.search({ term: '0001' })).results.filter(
      (r) => r.category === '凭证',
    );
    expect(results.map((r) => r.title).sort()).toEqual(['收-0001', '记-0001']);
    expect(new Set(results.map((r) => r.key)).size).toBe(2);
    expect(
      new Set(results.map((r) => new URL(r.to, 'http://local').searchParams.get('type'))).size,
    ).toBe(2);
    expect((await api.search({ term: 'tqbyj' })).results[0]).toMatchObject({
      category: '摘要',
      title: '提取备用金',
    });
    const partner = (await app.svc.dimensions.items('partner'))[0]!;
    expect(
      (await api.search({ term: partner.pinyin })).results.some(
        (r) => r.category === '往来单位' && r.title.includes(partner.code),
      ),
    ).toBe(true);
  });
  it('产品切换保存、日志和重登；失败与日志写入失败均保留原产品', async () => {
    const api = app.call(workbench);
    const originalAccounts = await app.svc.accounts.list();
    await expect(
      api.switchProduct({ product: 'qingsong', expectedProduct: 'minfei', confirmed: true }),
    ).rejects.toThrow(/已被其他窗口修改/);
    expect((await app.svc.book.info()).product).toBe('chengben');
    await sql`CREATE TEMP TRIGGER workbench_fail_log BEFORE INSERT ON operation_log BEGIN SELECT RAISE(ABORT,'test log unavailable'); END`.execute(
      app.svc.db,
    );
    await expect(
      api.switchProduct({ product: 'qingsong', expectedProduct: 'chengben', confirmed: true }),
    ).rejects.toThrow();
    expect((await app.svc.book.info()).product).toBe('chengben');
    await sql`DROP TRIGGER workbench_fail_log`.execute(app.svc.db);
    await api.switchProduct({ product: 'qingsong', expectedProduct: 'chengben', confirmed: true });
    const token = await app.login();
    expect((await app.core(token).auth.me()).book.product).toBe('qingsong');
    expect((await app.svc.log.list()).some((r) => r.action === 'workbench.product.switch')).toBe(
      true,
    );
    expect(await app.svc.accounts.list()).toEqual(originalAccounts);
  });
  it('改密后拒绝并撤销已发令牌，不依赖系统管理模块', async () => {
    const token = await app.login();
    const api = app.call(workbench, token);
    expect(await api.session()).toEqual({ valid: true });
    await app.svc.users.setPassword(1, 'new-password');
    await expect(api.session()).rejects.toThrow(/重新登录/);
    await expect(app.core(token).auth.me()).rejects.toThrow(/登录已失效/);
    const fresh = await app.login('admin', 'new-password');
    expect(await app.call(workbench, fresh).session()).toEqual({ valid: true });
  });
  it('个人偏好按用户、账套隔离，不保存搜索内容', async () => {
    const api = app.call(workbench);
    await api.savePreferences({ favorites: ['/m/workbench/help', '/m/fake'], guided: true });
    expect(await api.preferences()).toEqual({ favorites: ['/m/workbench/help'], guided: true });
    const another = app.call(
      workbench,
      await app.addUser('other', { permissions: ['workbench.settings'] }),
    );
    expect(await another.preferences()).toEqual({ favorites: [], guided: false });
    const otherBook = await createTestApp({ modules: [workbench] });
    try {
      expect(await otherBook.call(workbench).preferences()).toEqual({
        favorites: [],
        guided: false,
      });
    } finally {
      await otherBook.close();
    }
  });
});
