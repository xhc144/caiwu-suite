import { describe, expect, it } from 'vitest';
import {
  AccountingTemplateSchema,
  DIMENSION_TYPE_IDS,
  levelOfCode,
  parentCodeOf,
  parseCodeScheme,
  parseTemplate,
  templateProblems,
} from '@caiwu/core';
import { TemplateRegistry } from '@caiwu/core/server';
import { ModuleRegistry, listProcedures } from '@caiwu/server-kit';
import templatesServer from '../server';
import { expectedAccounts, expectedTemplates } from './expected-accounts';

const templates = templatesServer.templates.map((raw) => parseTemplate(raw));

describe.each(expectedTemplates)('w_xt_kgzb_a2 行业选择：$id', (expected) => {
  const template = templates.find((t) => t.id === expected.id)!;

  it('schema、编码级次、父链、类别、币种及凭证类型自洽', () => {
    expect(AccountingTemplateSchema.safeParse(template).success).toBe(true);
    expect(templateProblems(template)).toEqual([]);
    expect(template.regime).toBe(expected.regime);
    expect(template.codeScheme).toBe(`${expected.width}-2-2`);
    const scheme = parseCodeScheme(template.codeScheme);
    const codes = new Set(template.accounts.map((a) => a.code));
    expect(codes.size).toBe(template.accounts.length);
    for (const a of template.accounts) {
      expect(levelOfCode(a.code, scheme)).toBe(1);
      expect(parentCodeOf(a.code, scheme)).toBeNull();
      expect(template.categories.some((c) => c.id === a.category)).toBe(true);
      if (a.currency) {
        expect(['CNY', ...template.currencies.map((c) => c.code)]).toContain(a.currency);
      }
      for (const dim of a.dimensions) expect(DIMENSION_TYPE_IDS).toContain(dim.type);
    }
    expect(template.currencies).toEqual([]);
    expect(template.reports).toEqual([]);
    expect(template.voucherTypes.length).toBeGreaterThan(0);
    expect(new Set(template.voucherTypes.map((v) => v.code)).size).toBe(
      template.voucherTypes.length,
    );
    // 级次是参数；一级宽度不变时，4-3-3 / 3-3-3 不需要复制模板。
    expect(templateProblems(template, parseCodeScheme(`${expected.width}-3-3`))).toEqual([]);
  });

  it('逐项匹配独立原文期望表、余额方向及损益属性（含备抵例外）', () => {
    expect(
      template.accounts.map((a) => ({
        code: a.code,
        name: a.name,
        categoryId: a.category,
        direction: a.direction,
      })),
    ).toEqual(expectedAccounts(expected));
    expect(template.categories).toEqual(expected.categories);
    expect(template.accounts.filter((a) => a.cash).map((a) => a.code)).toEqual([
      expected.width === 4 ? '1001' : '101',
    ]);
    expect(template.accounts.filter((a) => a.bank).map((a) => a.code)).toEqual([
      expected.width === 4 ? '1002' : '102',
    ]);
    for (const code of expected.creditAssets) {
      expect(template.accounts.find((a) => a.code === code)).toMatchObject({
        category: 'asset',
        direction: 'credit',
      });
    }
  });

  it('逐科目来源非空，所有未核项明确待核且不使用旧 schema 字段', () => {
    expect(template.sources.length).toBeGreaterThan(0);
    for (const source of template.sources) {
      expect(source.title.length).toBeGreaterThan(0);
      expect(source.file).toMatch(/\.pdf$/);
      expect(source.note?.length).toBeGreaterThan(0);
    }
    for (const a of template.accounts) {
      expect(a.source).toContain(a.code);
      expect(a.source).toContain(a.name);
      expect(a.source).toContain('.pdf');
      expect(a.source).toMatch(/PDF第\d+/);
      expect(a.needsReview).toBe(expected.reviewCodes.includes(a.code));
      expect(a.source?.includes('待核')).toBe(a.needsReview);
    }
    const raw = templatesServer.templates.find((t) => (t as { id: string }).id === expected.id) as {
      accounts: Record<string, unknown>[];
    };
    const fields = new Set([
      'code',
      'name',
      'category',
      'direction',
      'cash',
      'bank',
      'cashflow',
      'partner',
      'currency',
      'quantityUnit',
      'dimensions',
      'disabled',
      'source',
      'needsReview',
    ]);
    for (const a of raw.accounts) {
      expect(Object.keys(a).every((key) => fields.has(key))).toBe(true);
    }
    if (expected.reviewCodes.length) expect(template.description).toContain('待核');
  });

  it('w_xt_kgzb_1 信息确认：拒绝不兼容的一级编码宽度', () => {
    const wrongScheme = parseCodeScheme(expected.width === 4 ? '3-2-2' : '4-2-2');
    expect(templateProblems(template, wrongScheme).length).toBeGreaterThan(0);
    expect(() => parseTemplate(template, wrongScheme)).toThrow(/编码长度不符合级次/);
  });
});

it('民非56项与原PDF集合一致，净资产不作为损益，限定与非限定分别保留', () => {
  const nonprofit = templates[0]!;
  expect(expectedAccounts(expectedTemplates[0]!)).toHaveLength(56);
  expect(nonprofit.accounts).toHaveLength(56);
  expect(nonprofit.categories.find((c) => c.id === 'net-assets')?.isPnl).toBe(false);
  for (const code of ['3101', '3102', '3201']) {
    expect(nonprofit.accounts.find((a) => a.code === code)?.category).toBe('net-assets');
  }
  expect(nonprofit.accounts.find((a) => a.code === '3101')?.name).toBe('非限定性净资产');
  expect(nonprofit.accounts.find((a) => a.code === '3102')?.name).toBe('限定性净资产');
});

it('工会适用范围独立：县级以上45项、基层主要表24项；不混入表外科目', () => {
  const union = templates.find((t) => t.id === 'trade-union-2022')!;
  const grassroots = templates.find((t) => t.id === 'grassroots-trade-union-2022')!;
  expect(union.accounts).toHaveLength(45);
  expect(grassroots.accounts).toHaveLength(24);
  for (const code of ['401', '405', '501']) {
    expect(grassroots.accounts.some((a) => a.code === code)).toBe(true);
    expect(union.accounts.some((a) => a.code === code)).toBe(false);
  }
  for (const code of ['111', '132', '201', '331', '341', '411', '502', '521']) {
    expect(union.accounts.some((a) => a.code === code)).toBe(true);
    expect(grassroots.accounts.some((a) => a.code === code)).toBe(false);
  }
});

it('正式模式注册五套模板，无菜单、写接口或迁移；全局重复ID拒绝', () => {
  const modules = new ModuleRegistry([templatesServer]);
  const registry = new TemplateRegistry({ devMode: false });
  for (const entry of modules.templates()) registry.register(entry.source, entry.templates);
  expect(registry.list().map((t) => t.id)).toEqual(expectedTemplates.map((t) => t.id));
  for (const expected of expectedTemplates) {
    expect(registry.get(expected.id).devOnly).toBe(false);
  }
  expect(templatesServer.manifest.products).toBe('all');
  expect(templatesServer.manifest.menu).toEqual([]);
  expect(templatesServer.manifest.permissions).toEqual([]);
  expect(templatesServer.migrations).toEqual([]);
  expect(listProcedures(templatesServer.router)).toEqual([]);
  expect(() => registry.register('another-provider', [templates[0]])).toThrow(
    /nonprofit-2026 重复：templates 和 another-provider/,
  );
});

it('w_xt_kgzb_3 一键初始：损坏模板被拒绝，不能用未知类别/币种/父链或重复项建账', () => {
  const base = templates[0]!;
  const first = base.accounts[0]!;
  const bad = [
    { ...base, accounts: [...base.accounts, first] },
    { ...base, accounts: [{ ...first, category: 'missing' }] },
    { ...base, accounts: [{ ...first, currency: 'USD' }] },
    { ...base, accounts: [{ ...first, code: '199901' }] },
    { ...base, voucherTypes: [...base.voucherTypes, base.voucherTypes[0]!] },
    { ...base, accounts: [{ ...first, dimensions: [{ type: 'restricted', required: true }] }] },
  ];
  for (const raw of bad) {
    const registry = new TemplateRegistry({ devMode: false });
    expect(() => registry.register('broken', [raw])).toThrow(/会计制度模板不合法/);
    expect(registry.list()).toEqual([]);
  }
});
