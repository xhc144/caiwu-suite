import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  levelOfCode,
  parentCodeOf,
  parseCodeScheme,
  parseTemplate,
  templateProblems,
} from '@caiwu/core';
import { TemplateRegistry } from '@caiwu/core/server';
import {
  PAWN_BASE_TEMPLATE_ID,
  PAWN_BASE_VERSION,
  PAWN_CODE_SCHEMES,
  PAWN_TEMPLATE_ID,
  buildPawnTemplate,
  pawnPreset,
  pawnApplicability,
  pawnSources,
  type PawnCodeScheme,
} from '..';
import { getPawnBaseTemplate } from './base-fixture';
import { TemplatePresetSchema, resolveTemplatePresets } from '../../../preset';

const pawnTemplates = [buildPawnTemplate(getPawnBaseTemplate())];

it('统一supplement契约：真实preset解析器合成与独立核对结果相同，省略维度不清空', () => {
  const base = getPawnBaseTemplate();
  expect(TemplatePresetSchema.safeParse(pawnPreset).success).toBe(true);
  const actual = resolveTemplatePresets([pawnPreset], (id) => {
    expect(id).toBe(PAWN_BASE_TEMPLATE_ID);
    return base;
  });
  expect(actual).toEqual([buildPawnTemplate(base)]);
  const original = base.accounts.find((a) => a.code === '1303')!;
  original.dimensions = [{ type: 'department', required: false }];
  expect(pawnPreset.accountOverrides.find((a) => a.code === '1303')).not.toHaveProperty(
    'dimensions',
  );
  const preserved = resolveTemplatePresets([pawnPreset], () => base)[0]!;
  expect(preserved.accounts.find((a) => a.code === '1303')?.dimensions).toEqual(
    original.dimensions,
  );
});

describe.each(PAWN_CODE_SCHEMES)('w_xt_kgzb_a2 / w_xt_kgzb_1 典当预设 %s', (scheme) => {
  const template = buildPawnTemplate(getPawnBaseTemplate(), scheme);
  const s = parseCodeScheme(scheme);
  const code = (native: string) =>
    native.slice(0, 4) +
    (native.length > 4 ? native.slice(4, 6).padStart(s[1]!, '0') : '') +
    (native.length > 6 ? native.slice(6, 8).padStart(s[2]!, '0') : '');

  it('268科目合法、两种级次父链与来源完整，一级编号保持不变', () => {
    expect(template.id).toBe(PAWN_TEMPLATE_ID);
    expect(template.codeScheme).toBe(scheme);
    expect(template.accounts).toHaveLength(268);
    expect(templateProblems(template)).toEqual([]);
    expect(new Set(template.accounts.map((a) => a.code)).size).toBe(268);
    for (const account of template.accounts) {
      expect(account.source).toBeTruthy();
      expect(account.sourceVersion).toBeTruthy();
      expect(account.needsReview).toBe(false);
      expect(levelOfCode(account.code, s)).not.toBeNull();
      const parent = parentCodeOf(account.code, s);
      if (parent) expect(template.accounts.some((a) => a.code === parent)).toBe(true);
    }
    expect(parentCodeOf(code('13030102'), s)).toBe(code('130301'));
    expect(parentCodeOf(code('130301'), s)).toBe('1303');
  });

  it('独立核对典当分户、备抵方向、双向利息调整和损益结转', () => {
    const required = [
      ['130301', '动产质押贷款', 'asset', 'debit'],
      ['130302', '财产权利质押贷款', 'asset', 'debit'],
      ['130303', '房地产抵押贷款', 'asset', 'debit'],
      ['13030101', '本金', 'asset', 'debit'],
      ['13030102', '利息调整', 'asset', 'debit'],
      ['13030103', '已减值', 'asset', 'debit'],
      ['130401', '动产质押贷款', 'asset', 'credit'],
      ['130402', '财产权利质押贷款', 'asset', 'credit'],
      ['130403', '房地产抵押贷款', 'asset', 'credit'],
      ['1409', '绝当物品', 'asset', 'debit'],
      ['147101', '绝当物品', 'asset', 'credit'],
      ['601101', '动产质押贷款利息收入', 'pnl', 'credit'],
      ['601102', '财产权利质押贷款利息收入', 'pnl', 'credit'],
      ['601103', '房地产抵押贷款利息收入', 'pnl', 'credit'],
      ['6021', '手续费及佣金收入', 'pnl', 'credit'],
      ['6051', '其他业务收入', 'pnl', 'credit'],
      ['6402', '其他业务成本', 'pnl', 'debit'],
      ['6421', '手续费及佣金支出', 'pnl', 'debit'],
      ['6702', '信用减值损失', 'pnl', 'debit'],
    ] as const;
    for (const [native, name, category, direction] of required) {
      expect(template.accounts.find((a) => a.code === code(native))).toMatchObject({
        name,
        category,
        direction,
      });
    }
    for (const native of ['13030102', '13030202', '13030302']) {
      expect(template.accounts.find((a) => a.code === code(native))).toMatchObject({
        balanceNature: 'both',
        isContra: false,
        closingRule: 'none',
      });
    }
    for (const native of ['130401', '130402', '130403', '147101'])
      expect(template.accounts.find((a) => a.code === code(native))).toMatchObject({
        isContra: true,
        balanceNature: 'credit',
      });
    for (const native of ['601101', '601102', '601103', '6021', '6421', '6702'])
      expect(template.accounts.find((a) => a.code === code(native))).toMatchObject({
        closingRule: 'profit',
        balanceNature: 'no-closing-balance',
      });
  });

  it('当户/当票使用已有辅助；不预置虚构档案、金额或数量单位', () => {
    const loan = template.accounts.find((a) => a.code === code('13030101'))!;
    expect(loan.partner).toBe(true);
    expect(loan.dimensions).toEqual([
      { type: 'partner', required: true },
      { type: 'project', required: true },
    ]);
    expect(template.accounts.find((a) => a.code === '1409')?.dimensions).toEqual([
      { type: 'project', required: true },
    ]);
    expect(template.accounts.find((a) => a.code === '1409')?.quantityUnit).toBeUndefined();
    expect(template.reports).toEqual([]);
    for (const old of ['1501', '1502', '1503'])
      expect(template.accounts.find((a) => a.code === old)?.disabled).toBe(true);
    for (const current of ['1101', '1513', '1515', '1516'])
      expect(template.accounts.find((a) => a.code === current)?.disabled).not.toBe(true);
  });
});

it('w_xt_kgzb_3：只读基表固定版本，追加20项，覆盖不改父科目名称/类别/方向', () => {
  const base = getPawnBaseTemplate();
  const before = structuredClone(base);
  const result = buildPawnTemplate(base);
  expect(base).toEqual(before);
  expect(base.id).toBe(PAWN_BASE_TEMPLATE_ID);
  expect(base.version).toBe(PAWN_BASE_VERSION);
  expect(base.accounts).toHaveLength(248);
  expect(pawnPreset.additionalAccounts).toHaveLength(20);
  const overrides = new Set(pawnPreset.accountOverrides.map((a) => a.code));
  for (const account of base.accounts) {
    const merged = result.accounts.find((a) => a.code === account.code)!;
    expect([merged.name, merged.category, merged.direction]).toEqual([
      account.name,
      account.category,
      account.direction,
    ]);
    if (!overrides.has(account.code)) expect(merged).toEqual(account);
  }
  result.accounts[0]!.name = '外部修改不污染快照';
  expect(getPawnBaseTemplate()).toEqual(before);
});

it('w_xt_kgzb_3：基表版本、方向、重复编码和非法父链错误在注册前拒绝', () => {
  const base = getPawnBaseTemplate();
  const changed = (code: string, fields: object) => ({
    ...base,
    accounts: base.accounts.map((a) => (a.code === code ? { ...a, ...fields } : a)),
  });
  expect(() => buildPawnTemplate({ ...base, version: 'future' })).toThrow(/基表版本/);
  expect(() => buildPawnTemplate(changed('1304', { direction: 'debit' }))).toThrow(/方向不一致/);
  expect(() => buildPawnTemplate(changed('1303', { name: '抵债资产' }))).toThrow(/名称/);
  expect(() => buildPawnTemplate(changed('1002', { direction: 'credit' }))).toThrow(/方向不一致/);
  expect(() =>
    buildPawnTemplate({
      ...base,
      categories: base.categories.map((c) => ({ ...c, isPnl: false })),
    }),
  ).toThrow(/类别及损益性质不一致/);
  expect(() =>
    buildPawnTemplate({ ...base, accounts: base.accounts.filter((a) => a.code !== '1012') }),
  ).toThrow(/完整248项/);
  expect(() =>
    buildPawnTemplate({ ...base, accounts: [...base.accounts, base.accounts[0]] }),
  ).toThrow(/重复/);
  expect(() =>
    buildPawnTemplate({
      ...base,
      accounts: [...base.accounts, { code: '1409', name: '占位', category: 'asset' }],
    }),
  ).toThrow(/1409.*重复/);
  expect(() =>
    parseTemplate({
      ...pawnTemplates[0],
      accounts: [...base.accounts, { code: '13990101', name: '孤儿', category: 'asset' }],
    }),
  ).toThrow(/上级科目/);
  expect(() => buildPawnTemplate(base, '3-2-2' as PawnCodeScheme)).toThrow(/仅支持/);
});

it('只有完整合成模板可注册，不把企业基表快照重复注册；再次注册同ID拒绝', () => {
  const registry = new TemplateRegistry({ devMode: false });
  registry.register('templates', pawnTemplates);
  expect(registry.list()).toMatchObject([
    { id: PAWN_TEMPLATE_ID, status: 'current', accountCount: 268 },
  ]);
  expect(() => registry.get(PAWN_BASE_TEMPLATE_ID)).toThrow(/不存在/);
  expect(() => registry.register('another', pawnTemplates)).toThrow(/重复/);
});

it('制度生效边界与原文来源明确，2009分类及2026征求意见稿不冒充现行默认', () => {
  expect(pawnApplicability.effectiveFrom).toBe('2021-01-01');
  expect(pawnApplicability.originalTemplate).toEqual({
    file: 'a33.acd',
    name: '典当行模版',
    displayOrder: '23',
  });
  expect(pawnSources.transition.note).toContain('未声称已下载');
  expect(pawnSources.financialInstruments.implementation).toContain('2021-01-01');
  expect(pawnSources.revenue.note).toContain('不能');
  expect(pawnTemplates[0]!.description).toContain('当物备查簿');
  for (const source of pawnTemplates[0]!.sources.filter((s) => s.file))
    expect(new URL(source.file!).hostname).toMatch(/(?:^|\.)(?:gov\.cn)$/);
});

it('级次映射属性：任一行业新增科目映射后仍有同名父链且方向/辅助不丢失', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...PAWN_CODE_SCHEMES),
      fc.integer({ min: 0, max: 19 }),
      (scheme, index) => {
        const original = pawnPreset.additionalAccounts[index]!;
        const t = buildPawnTemplate(getPawnBaseTemplate(), scheme);
        const segments = [
          original.code.slice(0, 4),
          original.code.slice(4, 6),
          original.code.slice(6, 8),
        ];
        const widths = scheme === '4-2-2' ? [4, 2, 2] : [4, 3, 3];
        const expectedCode = segments
          .filter(Boolean)
          .map((value, i) => value.padStart(widths[i]!, '0'))
          .join('');
        const current = t.accounts.find((a) => a.code === expectedCode);
        expect(current).toBeTruthy();
        expect(current!.direction).toBe(original.direction);
        expect(current!.dimensions).toEqual(original.dimensions ?? []);
        expect(current!.name).toBe(original.name);
        expect(templateProblems(t)).toEqual([]);
      },
    ),
    { numRuns: 30 },
  );
});
