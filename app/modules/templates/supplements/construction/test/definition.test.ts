import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mapTemplateScheme, parseCodeScheme, parseTemplate, templateProblems } from '@caiwu/core';
import {
  buildConstructionTemplates,
  constructionCasPreset,
  constructionPresets,
  constructionSystem2003Preset,
  materializeConstructionTemplate,
  supplement,
} from '../index';
import enterprise from './fixtures/enterprise-2026.json';
import small from './fixtures/small-business-2013.json';

const bases = [enterprise, small];
const constructionTemplates = buildConstructionTemplates(bases);
const find = (id: string) => constructionTemplates.find((item) => item.id === id)!;

it('w_xt_kgzb_a2：两套完整模板由只读基表+行业preset合成，历史包不冒充建账模板', () => {
  const generated = buildConstructionTemplates(bases);
  expect(generated.map((template) => [template.id, template.accounts.length])).toEqual([
    ['construction-cas-revenue-2017', 251],
    ['construction-small-business-2013', 71],
  ]);
  expect(constructionPresets.map((preset) => preset.integration)).toEqual([
    'ready',
    'ready',
    'missing-statutory-base',
  ]);
  for (const template of generated) {
    expect(template.status).toBe('current');
    expect(template.devOnly).toBe(false);
    expect(template.reports).toEqual([]);
    expect(templateProblems(template)).toEqual([]);
    expect(template.accounts.every((row) => row.source && row.sourceVersion)).toBe(true);
    expect(template.accounts.filter((row) => row.needsReview).map((row) => row.code)).toEqual(
      template.regime === 'small-business' ? ['1702'] : [],
    );
  }
  expect(() =>
    materializeConstructionTemplate(enterprise, constructionSystem2003Preset.id),
  ).toThrow(/缺完整.*2001/);
});

it('w_xt_kgzb_a2：统一接入口只输出两套差量，覆盖带来源且省略维度不等于清空', () => {
  expect(supplement.templates).toBeUndefined();
  expect(supplement.presets?.map((preset) => preset.id)).toEqual([
    'construction-cas-revenue-2017',
    'construction-small-business-2013',
  ]);
  const enterprisePreset = supplement.presets![0]!;
  const smallPreset = supplement.presets![1]!;
  expect(enterprisePreset.baseTemplateId).toBe('books-enterprise-cas-2006');
  expect(enterprisePreset.baseTemplateVersion).toBe('2006.18+2026.2');
  expect(enterprisePreset.additionalAccounts).toHaveLength(3);
  expect(smallPreset.additionalAccounts).toHaveLength(5);
  for (const preset of supplement.presets!)
    for (const override of preset.accountOverrides!) {
      expect(override.code).toMatch(/^\d+$/);
      expect(override.source?.trim()).toBeTruthy();
    }
  expect(enterprisePreset.accountOverrides?.find((row) => row.code === '5401')).not.toHaveProperty(
    'dimensions',
  );
  expect(smallPreset.accountOverrides?.find((row) => row.code === '4403')).not.toHaveProperty(
    'dimensions',
  );
});

it('w_xt_kgzb_a2：新收入准则只增设合同结算法定名称，软件编号明确、合同成本不结转本年利润', () => {
  const template = find('construction-cas-revenue-2017');
  // 来自财会〔2019〕6号附件2第22/24项，独立列出，不能从被测preset生成。
  const expected = [
    ['1472', '合同履约成本', 'asset', 'debit', false, 'debit'],
    ['1474', '合同履约成本减值准备', 'asset', 'credit', true, 'credit'],
    ['1483', '合同资产', 'asset', 'debit', false, 'debit'],
    ['1484', '合同资产减值准备', 'asset', 'credit', true, 'credit'],
    ['2204', '合同负债', 'liability', 'credit', false, 'credit'],
    ['1490', '合同结算', 'asset', 'debit', false, 'both'],
    ['149001', '价款结算', 'asset', 'credit', false, 'both'],
    ['149002', '收入结转', 'asset', 'debit', false, 'both'],
  ];
  for (const [code, name, category, direction, isContra, balanceNature] of expected) {
    expect(template.accounts.find((row) => row.code === code)).toMatchObject({
      name,
      category,
      direction,
      isContra,
      balanceNature,
      closingRule: 'none',
      dimensions: [{ type: 'project', required: true }],
    });
  }
  for (const code of ['5401', '5402'])
    expect(template.accounts.find((row) => row.code === code)?.disabled).toBe(true);
  expect(template.accounts.find((row) => row.code === '5403')?.disabled).not.toBe(true);
  expect(template.accounts.filter((row) => row.code.startsWith('1490'))).toHaveLength(3);
  expect(template.accounts.find((row) => row.code === '1490')?.source).toContain('原文未指定编号');
  expect(template.description).toContain('2021年1月1日');
  expect(template.description).toContain('不采用2026年9月科目征求意见稿');
});

it('w_xt_kgzb_a2：小企业依附录1411和4401/4403，不能混入企业准则合同毛利及工程结算', () => {
  const template = find('construction-small-business-2013');
  const expected = [
    ['141101', '在库', 'asset', 'debit', false, 'none'],
    ['141102', '在用', 'asset', 'debit', false, 'none'],
    ['141103', '摊销', 'asset', 'credit', true, 'none'],
    ['440101', '合同成本', 'cost', 'debit', false, 'none'],
    ['440102', '间接费用', 'cost', 'debit', false, 'clearing'],
    ['4403', '机械作业', 'cost', 'debit', undefined, 'clearing'],
  ];
  for (const [code, name, category, direction, isContra, closingRule] of expected) {
    const actual = template.accounts.find((row) => row.code === code)!;
    expect(actual).toMatchObject({ name, category, direction, closingRule });
    if (isContra !== undefined) expect(actual.isContra).toBe(isContra);
  }
  expect(template.accounts.find((row) => row.code === '440101')?.dimensions).toEqual([
    { type: 'project', required: true },
  ]);
  expect(
    template.accounts.some((row) => ['合同毛利', '工程结算', '合同结算'].includes(row.name)),
  ).toBe(false);
  expect(template.accounts.find((row) => row.code === '440102')?.dimensions).toEqual([
    { type: 'project', required: true },
  ]);
  expect(template.description).toContain('小企业准则不能与企业准则新收入模型混用');
});

describe.each(constructionTemplates)('w_xt_kgzb_a3：$name', (template) => {
  it.each(['4-2-2', '4-3-3'])('逐段映射到%s仍保留父链、备抵及辅助', (codeScheme) => {
    const mapped = mapTemplateScheme(template, parseCodeScheme(codeScheme));
    expect(templateProblems(mapped)).toEqual([]);
    expect(mapped.accounts).toHaveLength(template.accounts.length);
    for (const [index, account] of mapped.accounts.entries()) {
      const original = template.accounts[index]!;
      expect({ ...account, code: original.code, sourceVersion: original.sourceVersion }).toEqual(
        original,
      );
    }
    const isEnterprise = template.regime === 'enterprise';
    const code = isEnterprise
      ? codeScheme === '4-2-2'
        ? '149001'
        : '1490001'
      : codeScheme === '4-2-2'
        ? '440101'
        : '4401001';
    expect(mapped.accounts.some((row) => row.code === code)).toBe(true);
  });
});

it('w_xt_kgzb_a3：拒绝重复编码、断父链、非法级次与错误基表方向，不在合成时修改基表', () => {
  const original = structuredClone(bases);
  const wrongDirection = structuredClone(enterprise);
  wrongDirection.accounts.find((row) => row.code === '1474')!.direction = 'debit';
  expect(() => materializeConstructionTemplate(wrongDirection, constructionCasPreset.id)).toThrow(
    /方向不一致/,
  );
  const duplicate = structuredClone(enterprise);
  duplicate.accounts.push(duplicate.accounts[0]!);
  expect(() => materializeConstructionTemplate(duplicate, constructionCasPreset.id)).toThrow(
    /重复/,
  );
  const collision = parseTemplate(enterprise);
  collision.accounts.push({ code: '1490', name: '已占编号', category: 'asset', dimensions: [] });
  expect(() => materializeConstructionTemplate(collision, constructionCasPreset.id)).toThrow(
    /重复/,
  );
  const withoutParent = structuredClone(small);
  withoutParent.accounts = withoutParent.accounts.filter((row) => row.code !== '1411');
  expect(() =>
    materializeConstructionTemplate(withoutParent, 'construction-small-business-2013'),
  ).toThrow(/缺失/);
  const broken = structuredClone(find('construction-small-business-2013'));
  broken.accounts = broken.accounts.filter((row) => row.code !== '4401');
  expect(() => parseTemplate(broken)).toThrow(/上级科目 4401 不存在/);
  const illegal = structuredClone(broken);
  illegal.accounts.push({ code: '99999', name: '非法长度', category: 'asset', dimensions: [] });
  expect(() => parseTemplate(illegal)).toThrow(/编码长度不符合级次/);
  expect(() =>
    materializeConstructionTemplate(enterprise, constructionCasPreset.id, { codeScheme: '3-2-2' }),
  ).toThrow(/一级科目编码/);
  expect(() => buildConstructionTemplates([enterprise, enterprise])).toThrow(/重复提供/);
  expect(() => buildConstructionTemplates([small])).toThrow(/未提供/);
  expect(bases).toEqual(original);
});

it('w_xt_kgzb_1：拒绝版本/制度混搭及不合法生效日，不把日期不支持当历史还原完成', () => {
  expect(() => materializeConstructionTemplate(small, constructionCasPreset.id)).toThrow(/要求/);
  expect(() =>
    materializeConstructionTemplate(
      { ...enterprise, version: '2006.18+2026.3' },
      constructionCasPreset.id,
    ),
  ).toThrow(/要求/);
  for (const startDate of ['2020-12-31', '2026-02-30', 'bad'])
    expect(() =>
      materializeConstructionTemplate(enterprise, constructionCasPreset.id, { startDate }),
    ).toThrow(/启用日期/);
  expect(
    materializeConstructionTemplate(enterprise, constructionCasPreset.id, {
      startDate: '2026-01-01',
    }).id,
  ).toBe(constructionCasPreset.id);
});

it('w_xt_kgzb_a3：随机重复编码与截短科目编码一定拒绝（fast-check）', () => {
  const template = find('construction-small-business-2013');
  fc.assert(
    fc.property(fc.integer({ min: 0, max: template.accounts.length - 1 }), (index) => {
      const copy = structuredClone(template);
      copy.accounts.push(copy.accounts[index]!);
      expect(() => parseTemplate(copy)).toThrow(/重复/);
      const invalid = structuredClone(template);
      invalid.accounts[index]!.code += '9';
      expect(() => parseTemplate(invalid)).toThrow(/编码长度不符合级次/);
    }),
    { numRuns: 25 },
  );
});

it('w_xt_kgzb_a2：历史2003法定增设编号保留，清理两向、累计摊销不添加法定禁止的明细', () => {
  const additions = constructionSystem2003Preset.additions;
  const primary = additions.filter((row) => row.code.length === 4);
  expect(primary.map((row) => [row.code, row.name, row.direction])).toEqual([
    ['1233', '周转材料', 'debit'],
    ['1506', '临时设施', 'debit'],
    ['1507', '临时设施摊销', 'credit'],
    ['1702', '临时设施清理', 'debit'],
    ['2123', '工程结算', 'credit'],
    ['4104', '工程施工', 'debit'],
    ['4110', '机械作业', 'debit'],
  ]);
  expect(additions.find((row) => row.code === '1507')?.dimensions).toEqual([]);
  expect(additions.some((row) => row.code.startsWith('1507') && row.code.length > 4)).toBe(false);
  expect(additions.find((row) => row.code === '1702')?.balanceNature).toBe('both');
  expect(additions.find((row) => row.code === '128101')).toMatchObject({
    isContra: true,
    direction: 'credit',
    dimensions: [{ type: 'project', required: true }],
  });
  expect(
    additions
      .filter((row) => row.code.startsWith('410401') && row.code.length === 8)
      .map((row) => row.name),
  ).toEqual(['人工费', '材料费', '机械使用费', '其他直接费', '间接费用']);
  expect(constructionSystem2003Preset.description).toContain('不表示2003办法被2015通知废止');
  expect(constructionSystem2003Preset.description).toContain('不能认定已精确还原原版a08');
});
