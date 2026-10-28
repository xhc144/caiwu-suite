import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineManifest, parseTemplate } from '@caiwu/core';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import { createRuntime, defineServerModule, moduleKit } from '@caiwu/server-kit';
import { createTestApp, voucherInputFromSpec } from '@caiwu/testkit';
import manifest from '../manifest';
import {
  parseSupplementTemplates,
  resolveTemplatePresets,
  type TemplatePresetInput,
} from '../preset';
import { presetLifecycle } from '../server/preset-lifecycle';

// 只有合成基表与合成来源，不复制其它模块的企业科目或原始安装资源。
const base = parseTemplate({
  schemaVersion: 1,
  id: 'synthetic-base',
  version: '2026.1',
  name: '合成基础制度',
  regime: 'synthetic',
  codeScheme: '4-2-2',
  categories: [
    { id: 'asset', name: '资产', direction: 'debit' },
    { id: 'equity', name: '权益', direction: 'credit' },
    { id: 'revenue', name: '收入', direction: 'credit', isPnl: true },
  ],
  accounts: [
    {
      code: '1001',
      name: '现金',
      category: 'asset',
      direction: 'debit',
      cash: true,
      source: '合成基表现金',
    },
    {
      code: '1002',
      name: '银行存款',
      category: 'asset',
      direction: 'debit',
      bank: true,
      source: '合成基表银行',
      sourceVersion: '合成原文2026',
    },
    { code: '3001', name: '资本', category: 'equity', direction: 'credit', source: '合成基表权益' },
    {
      code: '4001',
      name: '收入',
      category: 'revenue',
      direction: 'credit',
      source: '合成基表收入',
    },
  ],
  voucherTypes: [{ code: '记', name: '记账凭证' }],
  sources: [{ title: '合成基础原文' }],
});
const preset: TemplatePresetInput = {
  id: 'synthetic-industry',
  version: '1.0.0',
  name: '合成行业选择',
  description: '仅用于测试行业增量和真实建账，不是实际会计制度',
  baseTemplateId: base.id,
  baseTemplateVersion: base.version,
  sources: [{ title: '合成行业原文' }],
  accountOverrides: [{ code: '4001', name: '行业收入', source: '合成行业修改依据' }],
  additionalAccounts: [
    {
      code: '1409',
      name: '合成行业资产',
      category: 'asset',
      direction: 'debit',
      source: '合成行业资产原文',
      partner: true,
      dimensions: [{ type: 'partner', required: true }],
    },
    {
      code: '400101',
      name: '普通业务',
      category: 'revenue',
      direction: 'credit',
      source: '合成行业收入原文',
    },
  ],
};
const getBase = (id: string) => {
  if (id !== base.id) throw new Error(`不存在合成基表：${id}`);
  return base;
};
const baseManifest = defineManifest({ id: 'preset-base', name: '合成基表提供方', products: 'all' });
const baseModule = defineServerModule(baseManifest, {
  router: moduleKit(baseManifest).router({}),
  templates: [base],
});
const moduleWith = (presets: TemplatePresetInput[]) =>
  defineServerModule(manifest, {
    router: moduleKit(manifest).router({}),
    lifecycle: presetLifecycle(presets),
  });

it('w_xt_kgzb_a2：行业选择保留基表版本与来源，新增和覆盖不改变基表', () => {
  const before = structuredClone(base);
  const [result] = resolveTemplatePresets([preset], getBase);
  expect(result!.accounts).toHaveLength(6);
  expect(result).toMatchObject({ id: preset.id, regime: base.regime, codeScheme: base.codeScheme });
  expect(result!.accounts.find((a) => a.code === '1002')).toMatchObject({
    sourceVersion: '合成原文2026',
    bank: true,
  });
  expect(result!.accounts.find((a) => a.code === '1409')).toMatchObject({
    sourceVersion: 'synthetic-industry@1.0.0',
  });
  expect(result!.accounts.find((a) => a.code === '4001')).toMatchObject({
    name: '行业收入',
    source: '合成基表收入；行业设置：合成行业修改依据',
    sourceVersion: 'synthetic-base@2026.1；synthetic-industry@1.0.0',
  });
  expect(result!.sources).toContainEqual({
    title: '基础制度：合成基础制度',
    note: 'synthetic-base@2026.1；行业方案在此版本上应用，不改写已有账套。',
  });
  expect(base).toEqual(before);
});

it('w_xt_kgzb_a2：仅改名称和来源必须保留基表的必填往来配置', () => {
  const configured = parseTemplate({
    ...base,
    accounts: base.accounts.map((a) =>
      a.code === '4001'
        ? { ...a, partner: true, dimensions: [{ type: 'partner', required: true }] }
        : a,
    ),
  });
  const [result] = resolveTemplatePresets(
    [{ ...preset, additionalAccounts: [] }],
    () => configured,
  );
  expect(result!.accounts.find((a) => a.code === '4001')).toMatchObject({
    name: '行业收入',
    partner: true,
    dimensions: [{ type: 'partner', required: true }],
  });
});

const invalidCases: [string, TemplatePresetInput, RegExp][] = [
  ['版本不符', { ...preset, baseTemplateVersion: '2027.1' }, /实际为/],
  ['重复新增', { ...preset, additionalAccounts: [{ ...base.accounts[0]! }] }, /已有科目重复/],
  [
    '不存在的覆盖',
    { ...preset, accountOverrides: [{ code: '9999', name: '不存在', source: '合成依据' }] },
    /不存在/,
  ],
  [
    '重复覆盖',
    { ...preset, accountOverrides: [...preset.accountOverrides!, ...preset.accountOverrides!] },
    /重复修改/,
  ],
  ['新增类别重复', { ...preset, additionalCategories: [base.categories[0]!] }, /类别重复/],
  [
    '无依据新增',
    { ...preset, additionalAccounts: [{ ...base.accounts[0]!, code: '9999', source: '' }] },
    /缺少原文依据/,
  ],
  [
    '缺失父级',
    { ...preset, additionalAccounts: [{ ...base.accounts[0]!, code: '999901' }] },
    /上级科目/,
  ],
];

describe.each(invalidCases)('w_xt_kgzb_a2：%s', (_label, input, message) => {
  it('拒绝不合法行业选择', () =>
    expect(() => resolveTemplatePresets([input], getBase)).toThrow(message));
});

it('w_xt_kgzb_a2：重复编号、循环、未知基表及未支持的双体系字段拒绝', () => {
  expect(() => resolveTemplatePresets([preset, preset], getBase)).toThrow(/编号重复/);
  expect(() => resolveTemplatePresets([{ ...preset, baseTemplateId: preset.id }], getBase)).toThrow(
    /循环引用/,
  );
  expect(() => resolveTemplatePresets([{ ...preset, baseTemplateId: 'missing' }], getBase)).toThrow(
    /不存在合成基表/,
  );
  const unsupported = {
    ...preset,
    additionalAccounts: [{ ...base.accounts[0]!, code: '9999', ledgerSystem: 'budget' }],
  };
  expect(() => resolveTemplatePresets([unsupported], getBase)).toThrow(/ledgerSystem/);
  expect(() =>
    parseSupplementTemplates([{ ...base, accounts: unsupported.additionalAccounts }]),
  ).toThrow(/ledgerSystem/);
  expect(parseSupplementTemplates([base])).toEqual([base]);
});

it('w_xt_kgzb_a3：多级行业方案与级次映射按依赖解析，不要求注册顺序', () => {
  const next = {
    ...preset,
    id: 'synthetic-next',
    baseTemplateId: preset.id,
    baseTemplateVersion: preset.version,
    codeScheme: '4-3-3',
    additionalAccounts: [],
    accountOverrides: [],
  };
  const [result] = resolveTemplatePresets([next, preset], getBase);
  expect(result!.accounts.find((a) => a.code === '4001001')?.name).toBe('普通业务');
  expect(result!.accounts).toHaveLength(6);
});

it('w_xt_kgzb_3：既有启动钩子登记行业方案，两级次建账、对象验证、过账和旧账隔离', async () => {
  const app = await createTestApp({
    modules: [baseModule, moduleWith([preset])],
    templateId: base.id,
    seed: false,
  });
  try {
    const original = await app.core().accounts.list();
    expect((await app.core().books.templates()).some((t) => t.id === preset.id)).toBe(true);
    for (const codeScheme of ['4-2-2', '4-3-3']) {
      const book = await app.core().books.create({
        name: `合成行业${codeScheme}`,
        orgName: '合成单位',
        templateId: preset.id,
        product: 'chengben',
        startYear: 2026,
        startMonth: 1,
        adminPassword: 'admin',
        codeScheme,
      });
      const { token } = await app
        .core(null)
        .auth.login({ bookId: book.id, userCode: 'admin', password: 'admin' });
      const rows = await app.core(token).accounts.list();
      expect(rows).toHaveLength(6);
      const income = codeScheme === '4-2-2' ? '400101' : '4001001';
      expect(rows.find((a) => a.code === '4001')).toMatchObject({
        isLeaf: false,
        name: '行业收入',
      });
      expect(rows.find((a) => a.code === income)).toMatchObject({
        isLeaf: true,
        parentId: rows.find((a) => a.code === '4001')!.id,
      });
      const opened = app.runtime.bookStore.open(book.id);
      const svc = createCoreServices({
        db: opened.db,
        user: (await loadServiceUser(opened.db, 1))!,
        moduleId: null,
        modules: app.runtime.modules.lookup,
        now: app.runtime.now,
      });
      const missing = await voucherInputFromSpec(svc, {
        date: '2026-01-05',
        lines: [
          { account: '1409', debit: 12345 },
          { account: '1002', credit: 12345 },
        ],
      });
      await expect(svc.vouchers.create(missing)).rejects.toMatchObject({
        data: { code: 'VOUCHER_INVALID' },
      });
      expect((await svc.vouchers.list({})).total).toBe(0);
      const partner = await svc.dimensions.create({
        type: 'partner',
        code: 'TEST',
        name: '合成往来单位',
      });
      const saved = await svc.vouchers.create({
        ...missing,
        lines: missing.lines.map((line, i) =>
          i === 0 ? { ...line, dimensions: { partner: partner.id } } : line,
        ),
      });
      await svc.vouchers.changeStatus({ ids: [saved.id], to: 'audited' });
      await svc.vouchers.changeStatus({ ids: [saved.id], to: 'posted' });
      expect(
        (
          await svc.ledger.balances({
            periodFrom: 202601,
            periodTo: 202601,
            accountCodes: ['1409'],
          })
        )[0]?.closing,
      ).toBe(12345);
      expect((await svc.ledger.trialBalance(202601, 202601)).balanced).toBe(true);
      await app.runtime.bookStore.close(book.id);
      expect(await app.core(token).accounts.list()).toEqual(rows);
      expect(await app.core().accounts.list()).toEqual(original);
    }
  } finally {
    await app.close();
  }
});

it('w_xt_kgzb_a2：整批解析失败不会先登记合法的前半批', async () => {
  const app = await createTestApp({ modules: [baseModule], templateId: base.id, seed: false });
  try {
    const hook = presetLifecycle([
      preset,
      { ...preset, id: 'broken-preset', baseTemplateVersion: 'wrong' },
    ]);
    await expect(
      hook.start!({ app: app.runtime, signal: new AbortController().signal }),
    ).rejects.toThrow(/实际为/);
    expect(() => app.runtime.templates.get(preset.id)).toThrow(/不存在/);
    expect(await app.core().accounts.list()).toHaveLength(4);
  } finally {
    await app.close();
  }
});

it('w_xt_kgzb_a2：与静态制度编号碰撞时拒绝，不能登记前半批或覆盖原制度', async () => {
  const app = await createTestApp({ modules: [baseModule], templateId: base.id, seed: false });
  try {
    app.runtime.templates.register('fixture-static', [{ ...base, id: 'occupied' }]);
    const hook = presetLifecycle([preset, { ...preset, id: 'occupied' }]);
    await expect(
      hook.start!({ app: app.runtime, signal: new AbortController().signal }),
    ).rejects.toThrow(/已经登记/);
    expect(() => app.runtime.templates.get(preset.id)).toThrow(/不存在/);
    expect(app.runtime.templates.get('occupied').accounts).toEqual(base.accounts);
  } finally {
    await app.close();
  }
});

it('w_xt_kgzb_a2：生产模式隐藏的演示编号仍受保护，后半批碰撞不留下前半批', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-preset-hidden-'));
  const runtime = createRuntime({ dataDir, modules: [baseModule], devMode: false });
  try {
    expect(runtime.templates.list().some((t) => t.id === 'demo-enterprise')).toBe(false);
    const hook = presetLifecycle([preset, { ...preset, id: 'demo-enterprise' }]);
    await expect(
      hook.start!({ app: runtime, signal: new AbortController().signal }),
    ).rejects.toThrow(/已经登记/);
    expect(() => runtime.templates.get(preset.id)).toThrow(/不存在/);
    expect(runtime.templates.get(base.id)).toEqual(base);
  } finally {
    await runtime.bookStore.dispose();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
