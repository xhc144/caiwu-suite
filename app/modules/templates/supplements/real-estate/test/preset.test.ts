import { describe, expect, it } from 'vitest';
import {
  mapTemplateScheme,
  parentCodeOf,
  parseCodeScheme,
  parseTemplate,
  templateProblems,
} from '@caiwu/core';
import {
  buildRealEstateTemplate,
  historicalRealEstateAvailability,
  realEstatePreset,
  realEstateTemplatePreset,
  realEstateSources,
  supplement,
} from '../index';
import { readOnlyEnterpriseBase } from './base-fixture';

// 独立转录财会〔2013〕17号第二十六条，不从被测描述生成期望。
const expectedCostItems = [
  ['01', '土地征用及拆迁补偿费'],
  ['02', '前期工程费'],
  ['03', '建筑安装工程费'],
  ['04', '基础设施建设费'],
  ['05', '公共配套设施费'],
  ['06', '开发间接费'],
  ['07', '借款费用'],
] as const;

it('统一supplement只导出七项追加与八项带来源/显式维度的覆盖，不复制企业基表', () => {
  expect(supplement.templates).toBeUndefined();
  expect(supplement.presets).toEqual([realEstateTemplatePreset]);
  expect(realEstateTemplatePreset).toMatchObject({
    id: 'real-estate-enterprise',
    version: '1.0.0+base.2006.18+2026.2',
    baseTemplateId: 'books-enterprise-cas-2006',
    baseTemplateVersion: '2006.18+2026.2',
    codeScheme: '4-2-2',
  });
  expect(realEstateTemplatePreset.additionalAccounts).toEqual(realEstatePreset.append);
  expect(realEstateTemplatePreset.accountOverrides).toHaveLength(8);
  for (const override of realEstateTemplatePreset.accountOverrides ?? []) {
    expect(override.source).toContain('基表=books-enterprise-cas-2006@2006.18+2026.2');
    expect(override.dimensions).toEqual(
      ['1122', '1123', '2202', '2204'].includes(override.code)
        ? [
            { type: 'project', required: true },
            { type: 'partner', required: true },
          ]
        : [{ type: 'project', required: true }],
    );
    expect(Object.keys(override).sort()).toEqual(['code', 'dimensions', 'partner', 'source']);
  }
  expect(realEstateTemplatePreset.sources).toHaveLength(3);
});

describe.each(['4-2-2', '4-3-3'])('w_xt_kgzb_a2/a3 房地产预设：%s', (scheme) => {
  it('与只读基表合成完整合法科目表，逐段映射七个成本明细和原增值税父链', () => {
    const base = readOnlyEnterpriseBase();
    const frozen = JSON.stringify(base);
    const template = buildRealEstateTemplate(base, scheme);
    expect(base.accounts).toHaveLength(248);
    expect(template.accounts).toHaveLength(255);
    expect(template.accounts.filter((account) => account.code.length === 4)).toHaveLength(203);
    expect(templateProblems(template)).toEqual([]);
    expect(template.id).toBe('real-estate-enterprise');
    expect(template.version).toBe('1.0.0+base.2006.18+2026.2');
    expect(template.status).toBe('current');
    expect(template.devOnly).toBe(false);
    expect(template.reports).toEqual([]);
    const width = scheme === '4-2-2' ? 2 : 3;
    const costs = template.accounts.filter(
      (account) => account.code.startsWith('5001') && account.code !== '5001',
    );
    expect(
      costs.map(({ code, name, category, direction, isContra, balanceNature, closingRule }) => [
        code,
        name,
        category,
        direction,
        isContra,
        balanceNature,
        closingRule,
      ]),
    ).toEqual(
      expectedCostItems.map(([suffix, name]) => [
        `5001${suffix.padStart(width, '0')}`,
        name,
        'cost',
        'debit',
        false,
        'debit',
        'none',
      ]),
    );
    for (const cost of costs) {
      expect(parentCodeOf(cost.code, parseCodeScheme(scheme))).toBe('5001');
      expect(cost.dimensions).toEqual([{ type: 'project', required: true }]);
      expect(cost.source).toContain(realEstateSources.cost.url);
      expect(cost.source).toContain('第二十六条');
      expect(cost.source).toContain('应用分配');
      expect(cost.needsReview).toBe(false);
    }
    expect(costs.at(-1)?.source).toContain('仅归集符合资本化条件');
    for (const account of template.accounts) {
      const parent = parentCodeOf(account.code, parseCodeScheme(scheme));
      if (parent)
        expect(template.accounts.some((candidate) => candidate.code === parent)).toBe(true);
    }
    const expectedBase = mapTemplateScheme(base, parseCodeScheme(scheme));
    const changed = new Set(['1405', '5001', '1122', '1123', '2202', '2204', '6001', '6401']);
    for (const account of expectedBase.accounts) {
      if (!changed.has(account.code))
        expect(template.accounts.find((candidate) => candidate.code === account.code)).toEqual(
          account,
        );
    }
    expect(template.accounts.find((account) => account.code === '1405')?.name).toBe('库存商品');
    expect(template.accounts.find((account) => account.code === '5001')?.name).toBe('生产成本');
    expect(template.accounts.find((account) => account.code === '5101')?.name).toBe('制造费用');
    expect(JSON.stringify(base)).toBe(frozen);
  });
});

it('w_xt_kgzb_1：错基表、版本、方向、父链及未知级次必须拒绝，不能静默覆盖', () => {
  const base = readOnlyEnterpriseBase();
  for (const patch of [
    { id: 'another-enterprise' },
    { version: '2006.18+2026.1' },
    { regime: 'government' },
    { status: 'deprecated' },
    { devOnly: true },
  ])
    expect(() => buildRealEstateTemplate({ ...base, ...patch })).toThrow(/要求原生基表/);
  for (const patch of [{ name: '开发成本' }, { direction: 'credit' }, { category: 'pnl' }]) {
    expect(() =>
      buildRealEstateTemplate({
        ...base,
        accounts: base.accounts.map((account) =>
          account.code === '5001' ? { ...account, ...patch } : account,
        ),
      }),
    ).toThrow(/名称、方向、类别或父链/);
  }
  expect(() =>
    buildRealEstateTemplate({
      ...base,
      accounts: [...base.accounts, { code: '500101', name: '原基表已有明细', category: 'cost' }],
    }),
  ).toThrow(/父链/);
  expect(() =>
    buildRealEstateTemplate({ ...base, accounts: [...base.accounts, base.accounts[0]] }),
  ).toThrow(/重复/);
  expect(() =>
    buildRealEstateTemplate({
      ...base,
      accounts: [...base.accounts, { code: '599901', name: '无父级', category: 'cost' }],
    }),
  ).toThrow(/上级科目/);
  for (const scheme of ['3-2-2', '4-1-1', '4-2', '4-3-3-3'])
    expect(() => buildRealEstateTemplate(base, scheme)).toThrow(/仅核对/);
  expect(() => buildRealEstateTemplate(mapTemplateScheme(base, parseCodeScheme('4-3-3')))).toThrow(
    /原生基表/,
  );
});

it('w_xt_kgzb_a2：历史版和2026征求意见稿不混入现行模板', () => {
  expect(historicalRealEstateAvailability).toMatchObject({
    originalTemplate: 'a14.acd',
    kind: 'blocked',
    effectiveFrom: '1993-07-01',
    repealDocumentDate: '2015-02-16',
  });
  expect(realEstatePreset).toMatchObject({
    originalTemplate: 'a13.acd',
    baseTemplateId: 'books-enterprise-cas-2006',
    baseVersion: '2006.18+2026.2',
  });
  const template = buildRealEstateTemplate(readOnlyEnterpriseBase());
  expect(template.sources.every((source) => !source.title.includes('征求意见稿'))).toBe(true);
  expect(
    template.accounts
      .filter((account) => account.dimensions.some((dimension) => dimension.type === 'partner'))
      .map((account) => account.code),
  ).toEqual(['1122', '1123', '2202', '2204']);
  expect(parseTemplate(template)).toEqual(template);
});
