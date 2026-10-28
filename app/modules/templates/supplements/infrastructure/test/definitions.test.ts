import { describe, expect, it } from 'vitest';
import {
  mapTemplateScheme,
  parseCodeScheme,
  parseTemplate,
  parentCodeOf,
  templateProblems,
} from '@caiwu/core';
import {
  assertInfrastructureHistoricalPeriod,
  buildEnterpriseInfrastructureTemplate,
  enterpriseInfrastructurePreset,
  infrastructureHistoricalTemplates,
  stateOwnedConstruction1996Template as old,
  stateOwnedConstruction1998Template as supplement,
} from '../index';
import { readEnterpriseBase } from './base';

// Independently transcribed from MOF 1995.45 二（一）, including the original gaps.
const expectedPrimary = `101 建筑安装工程投资
102 设备投资
103 待摊投资
104 其他投资
111 交付使用资产
121 应收生产单位投资借款
201 固定资产
202 累计折旧
203 固定资产清理
211 器材采购
212 采购保管费
213 库存设备
214 库存材料
218 材料成本差异
219 委托加工器材
231 限额存款
232 银行存款
233 现金
241 预付备料款
242 预付工程款
251 应收有偿调出器材及工程款
252 其他应收款
253 应收票据
261 拨付所属投资借款
271 待处理财产损失
281 有价证券
301 基建拨款
302 联营拨款
303 企业债券资金
304 基建投资借款
305 上级拨入投资借款
306 其他借款
311 待冲基建支出
321 上级拨入资金
331 应付器材款
332 应付工程款
341 应付工资
342 应付福利费
351 应付有偿调入器材及工程款
352 其他应付款
353 应付票据
361 应交税金
362 应交基建包干节余
363 应交基建收入
364 其他应交款
401 留成收入`
  .split('\n')
  .map((line) => ({ code: line.slice(0, 3), name: line.slice(4) }));

it('w_xt_kgzb_a2：历史原文46项完整，未冒用企业/政府当前制度名称', () => {
  expect(
    old.accounts.filter((a) => a.code.length === 3).map(({ code, name }) => ({ code, name })),
  ).toEqual(expectedPrimary);
  expect(old.accounts).toHaveLength(125);
  expect(old.status).toBe('deprecated');
  expect(old.description).toContain('1996—1997');
  expect(old.categories.map((c) => c.name)).toEqual(['资金占用', '资金来源']);
  expect(old.accounts.find((a) => a.code === '202')).toMatchObject({
    direction: 'credit',
    isContra: true,
    category: 'funds-employed',
  });
  expect(old.accounts.find((a) => a.code === '311')).toMatchObject({
    direction: 'credit',
    isContra: true,
  });
  expect(old.accounts.find((a) => a.code === '218')).toMatchObject({
    direction: 'debit',
    balanceNature: 'both',
  });
  expect(old.accounts.find((a) => a.code === '331')).toMatchObject({
    direction: 'credit',
    balanceNature: 'both',
    partner: true,
  });
  expect(old.accounts.find((a) => a.code === '30112')).toMatchObject({
    name: '本年交回结余资金',
    direction: 'debit',
  });
  expect(old.accounts.filter((a) => a.code.startsWith('103') && a.code.length === 5)).toHaveLength(
    28,
  );
  expect(old.accounts.find((a) => a.code === '10101')?.name).toBe('建设工程投资');
  expect(old.accounts.every((a) => a.source && a.sourceVersion && a.needsReview === false)).toBe(
    true,
  );
});

it('w_xt_kgzb_a2：1998逐项变更保留旧号、取消财政贴息拨款、明确软件新增号', () => {
  expect(supplement.status).toBe('deprecated');
  expect(supplement.accounts).toHaveLength(130);
  expect(supplement.accounts.find((a) => a.code === '302')?.name).toBe('项目资本');
  expect(supplement.accounts.find((a) => a.code === '303')?.name).toBe('企业债券资金');
  expect(supplement.accounts.some((a) => a.code === '30109')).toBe(false);
  expect(
    supplement.accounts
      .filter((a) => a.code.startsWith('302') && a.code.length === 5)
      .map((a) => a.name),
  ).toEqual(['国家资本', '法人资本', '个人资本']);
  for (const code of ['105', '106', '308'])
    expect(supplement.accounts.find((a) => a.code === code)?.source).toContain('软件分配编码');
  for (const year of [1998, 2000, 2018])
    expect(() => assertInfrastructureHistoricalPeriod(supplement.id, year)).not.toThrow();
  for (const year of [1997, 2019, 2026, 2000.5])
    expect(() => assertInfrastructureHistoricalPeriod(supplement.id, year)).toThrow(/年份不匹配/);
  expect(() => assertInfrastructureHistoricalPeriod(old.id, 1997)).not.toThrow();
  expect(() => assertInfrastructureHistoricalPeriod(old.id, 2026)).toThrow();
});

describe.each(infrastructureHistoricalTemplates)('w_xt_kgzb_a3：$id 两种级次', (template) => {
  it('3-2-2与3-3-3均保留完整父链、方向、辅助及来源', () => {
    for (const scheme of ['3-2-2', '3-3-3']) {
      const mapped = mapTemplateScheme(template, parseCodeScheme(scheme));
      expect(templateProblems(mapped)).toEqual([]);
      expect(new Set(mapped.accounts.map((a) => a.code)).size).toBe(mapped.accounts.length);
      const codes = new Set(mapped.accounts.map((a) => a.code));
      for (const [i, account] of mapped.accounts.entries()) {
        const parent = parentCodeOf(account.code, parseCodeScheme(scheme));
        if (parent) expect(codes.has(parent)).toBe(true);
        expect(account.direction).toBe(template.accounts[i]!.direction);
        expect(account.dimensions).toEqual(template.accounts[i]!.dimensions);
      }
      expect(mapped.accounts.find((a) => a.name === '勘察设计费')?.code).toBe(
        scheme === '3-2-2' ? '10303' : '103003',
      );
    }
  });
});

it('w_xt_kgzb_a3：重复编码、非法级次、缺父科目全部拒绝', () => {
  expect(() => parseTemplate({ ...old, accounts: [...old.accounts, old.accounts[0]] })).toThrow(
    /重复/,
  );
  expect(() =>
    parseTemplate({ ...old, accounts: [...old.accounts, { ...old.accounts[0], code: '1010' }] }),
  ).toThrow(/编码长度/);
  expect(() =>
    parseTemplate({ ...old, accounts: old.accounts.filter((a) => a.code !== '103') }),
  ).toThrow(/上级科目/);
  expect(() => mapTemplateScheme(old, parseCodeScheme('4-2-2'))).toThrow(/一级科目/);
});

it('w_xt_kgzb_a2：企业预设与只读完整基表合成，不改写基表或继承非法父科目', () => {
  const base = readEnterpriseBase();
  const snapshot = structuredClone(base);
  for (const scheme of ['4-2-2', '4-3-3']) {
    const t = buildEnterpriseInfrastructureTemplate(base, scheme);
    expect(templateProblems(t)).toEqual([]);
    expect(t.accounts).toHaveLength(base.accounts.length + 4);
    expect(
      t.accounts.filter((a) => a.code.startsWith('1604') && a.code.length > 4).map((a) => a.name),
    ).toEqual(['建筑工程', '安装工程', '在安装设备', '待摊支出']);
    expect(t.accounts.find((a) => a.name === '建筑工程')?.code).toBe(
      scheme === '4-2-2' ? '160401' : '1604001',
    );
    expect(t.accounts.find((a) => a.code === '1604')?.dimensions).toContainEqual({
      type: 'project',
      required: true,
    });
  }
  expect(base).toEqual(snapshot);
  expect(enterpriseInfrastructurePreset.baseVersion).toBe('2006.18+2026.2');
  for (const patch of [{ version: 'changed' }, { id: 'other' }, { status: 'deprecated' }])
    expect(() => buildEnterpriseInfrastructureTemplate({ ...base, ...patch })).toThrow(/只读基表/);
  for (const patch of [{ direction: 'credit' }, { name: '工程施工' }, { category: 'cost' }])
    expect(() =>
      buildEnterpriseInfrastructureTemplate({
        ...base,
        accounts: base.accounts.map((a) => (a.code === '1604' ? { ...a, ...patch } : a)),
      }),
    ).toThrow(/父科目/);
  expect(() =>
    buildEnterpriseInfrastructureTemplate({
      ...base,
      accounts: [
        ...base.accounts,
        { ...base.accounts.find((a) => a.code === '1604'), code: '160401', name: '已有明细' },
      ],
    }),
  ).toThrow(/已有在建工程明细/);
});
