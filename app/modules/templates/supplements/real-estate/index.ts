import {
  mapTemplateScheme,
  parseCodeScheme,
  parseTemplate,
  type AccountingTemplate,
  type TemplateAccount,
} from '@caiwu/core';
import type { TemplatePresetInput, TemplateSupplement } from '../../preset';
import { realEstateSources } from './sources';

export { historicalRealEstateAvailability, realEstateSources } from './sources';

const industryVersion = '1.0.0';
const project = [{ type: 'project', required: true }] as const;
const partnerProject = [
  { type: 'project', required: true },
  { type: 'partner', required: true },
] as const;

/** 名称依据正式成本制度，数字后缀由本应用分配，非财政部统一明细编码。 */
const costItems = [
  ['01', '土地征用及拆迁补偿费'],
  ['02', '前期工程费'],
  ['03', '建筑安装工程费'],
  ['04', '基础设施建设费'],
  ['05', '公共配套设施费'],
  ['06', '开发间接费'],
  ['07', '借款费用'],
] as const;

const costSource = `${realEstateSources.cost.url}；财会〔2013〕17号第十三条（PDF第4页）及第二十六条（PDF第7—8页）；末级project为按开发项目/期数兼顾产品类型核算的应用映射`;
const chartSource = `${realEstateSources.chart.url}；财会〔2006〕18号附录`;

const overrides = [
  {
    code: '1405',
    baseName: '库存商品',
    name: '库存商品',
    category: 'asset',
    direction: 'debit',
    dimensions: project,
    locator:
      '沿用只读基表1405库存商品及借方余额；按财会〔2013〕17号第十三条通过project区分开发对象，未据无法读取的原附件改名',
  },
  {
    code: '5001',
    baseName: '生产成本',
    name: '生产成本',
    category: 'cost',
    direction: 'debit',
    dimensions: project,
    locator:
      '沿用只读基表5001生产成本及借方余额；财会〔2013〕17号第十三、第二十六条七项成本的父级应用映射，未宣称官方统一房地产编码或改名',
  },
  {
    code: '1122',
    baseName: '应收账款',
    name: '应收账款',
    category: 'asset',
    direction: 'debit',
    dimensions: partnerProject,
    locator: '1122第二项按债务人明细（PDF第12页）；project为应用的开发对象追踪要求',
  },
  {
    code: '1123',
    baseName: '预付账款',
    name: '预付账款',
    category: 'asset',
    direction: 'debit',
    dimensions: partnerProject,
    locator: '1123第二项按供货单位明细（PDF第14页）；project为应用的开发对象追踪要求',
  },
  {
    code: '2202',
    baseName: '应付账款',
    name: '应付账款',
    category: 'liability',
    direction: 'credit',
    dimensions: partnerProject,
    locator: '2202第二项按债权人明细（PDF第77页）；project为应用的开发对象追踪要求',
  },
  {
    code: '2204',
    baseName: '合同负债',
    name: '合同负债',
    category: 'liability',
    direction: 'credit',
    dimensions: partnerProject,
    locator:
      '财会〔2017〕22号第四十一条；沿用基表正式收入准则增补及其软件分配编号2204，partner/project为应用追踪要求，不能代替逐合同明细',
  },
  {
    code: '6001',
    baseName: '主营业务收入',
    name: '主营业务收入',
    category: 'pnl',
    direction: 'credit',
    dimensions: project,
    locator:
      '6001第二项按业务种类明细；财会〔2017〕22号收入确认及列报；project为应用的开发对象追踪要求',
  },
  {
    code: '6401',
    baseName: '主营业务成本',
    name: '主营业务成本',
    category: 'pnl',
    direction: 'debit',
    dimensions: project,
    locator: '1405第三（四）及6401第二项；project为应用的开发对象追踪要求',
  },
] as const;

export const realEstatePreset = {
  id: 'real-estate-enterprise',
  version: industryVersion,
  name: '房地产开发企业（企业会计准则行业预设）',
  originalTemplate: 'a13.acd',
  baseTemplateId: 'books-enterprise-cas-2006',
  baseVersion: '2006.18+2026.2',
  nativeCodeScheme: '4-2-2',
  supportedCodeSchemes: ['4-2-2', '4-3-3'],
  scope:
    '执行企业会计准则及2014年起成本核算制度的房地产开发企业；不是独立的新房地产会计制度，也不适用于政府会计主体。',
  overrides,
  append: costItems.map(
    ([suffix, name]) =>
      ({
        code: `5001${suffix}`,
        name,
        category: 'cost',
        direction: 'debit',
        dimensions: project.map((dimension) => ({ ...dimension })),
        source: `${costSource}；明细编号5001${suffix}由应用分配${suffix === '07' ? '；仅归集符合资本化条件的借款费用，非资本化部分仍按基表财务费用核算' : ''}`,
        sourceVersion: `房地产开发预设${industryVersion}；财会〔2013〕17号`,
        balanceNature: 'debit',
        closingRule: 'none',
        isContra: false,
        needsReview: false,
      }) satisfies TemplateAccount,
  ),
} as const;

/** 交由唯一集成 owner 接入 supplement-catalog；只包含本行业增量。 */
export const realEstateTemplatePreset: TemplatePresetInput = {
  id: realEstatePreset.id,
  version: `${industryVersion}+base.${realEstatePreset.baseVersion}`,
  name: realEstatePreset.name,
  description: `${realEstatePreset.scope}基表 ${realEstatePreset.baseTemplateId}@${realEstatePreset.baseVersion}；追加七项开发成本并要求项目辅助，往来要求客户/供应商。明细后缀为应用编号。只用于新账，未自动分摊成本、判断完工/收入确认、税款或生成法定报表。`,
  baseTemplateId: realEstatePreset.baseTemplateId,
  baseTemplateVersion: realEstatePreset.baseVersion,
  order: 32,
  codeScheme: realEstatePreset.nativeCodeScheme,
  additionalAccounts: realEstatePreset.append.map((account) => structuredClone(account)),
  accountOverrides: realEstatePreset.overrides.map((override) => ({
    code: override.code,
    dimensions: override.dimensions.map((dimension) => ({ ...dimension })),
    partner: override.dimensions.some((dimension) => dimension.type === 'partner'),
    source: `${chartSource}；${override.locator}；${costSource}；基表=${realEstatePreset.baseTemplateId}@${realEstatePreset.baseVersion}`,
  })),
  sources: [
    {
      title: realEstateSources.cost.title,
      file: realEstateSources.cost.url,
      note: `${realEstateSources.cost.scope}；2014-01-01起，七项成本后缀由本应用分配。`,
    },
    {
      title: realEstateSources.chart.title,
      file: realEstateSources.chart.url,
      note: realEstateSources.chart.retrieval,
    },
    {
      title: realEstateSources.revenue.title,
      file: realEstateSources.revenue.url,
      note: realEstateSources.revenue.scope,
    },
  ],
};

export const supplement: TemplateSupplement = { presets: [realEstateTemplatePreset] };

/**
 * 宿主把已登记的原生企业基表传入；本模块不 import books，也不注册全局模板。
 * 返回可直接交给 defineServerModule({ templates }) 的完整 AccountingTemplate。
 */
export function buildRealEstateTemplate(
  baseInput: unknown,
  codeScheme: string = realEstatePreset.nativeCodeScheme,
): AccountingTemplate {
  const base = parseTemplate(baseInput);
  if (
    base.id !== realEstatePreset.baseTemplateId ||
    base.version !== realEstatePreset.baseVersion ||
    base.codeScheme !== realEstatePreset.nativeCodeScheme ||
    base.regime !== 'enterprise' ||
    base.status !== 'current' ||
    base.devOnly
  ) {
    throw new Error(
      `房地产开发预设要求原生基表 ${realEstatePreset.baseTemplateId}@${realEstatePreset.baseVersion}（4-2-2），请由模板集成方复核版本后接入`,
    );
  }
  if (!(realEstatePreset.supportedCodeSchemes as readonly string[]).includes(codeScheme)) {
    throw new Error('房地产开发预设仅核对了4-2-2和4-3-3两种级次');
  }
  const accounts = new Map(base.accounts.map((account) => [account.code, account]));
  for (const override of realEstatePreset.overrides) {
    const account = accounts.get(override.code);
    if (
      !account ||
      account.name !== override.baseName ||
      account.category !== override.category ||
      (account.direction ??
        base.categories.find((category) => category.id === account.category)?.direction) !==
        override.direction ||
      base.accounts.some(
        (candidate) => candidate.code !== account.code && candidate.code.startsWith(account.code),
      )
    ) {
      throw new Error(
        `房地产开发预设基表 ${override.code} ${override.baseName} 的名称、方向、类别或父链与已核版本不一致`,
      );
    }
    accounts.set(account.code, {
      ...account,
      name: override.name,
      dimensions: override.dimensions.map((dimension) => ({ ...dimension })),
      partner: override.dimensions.some((dimension) => dimension.type === 'partner'),
      source: `${account.source ?? ''}；房地产开发预设：${chartSource}；${override.locator}；${costSource}；基表=${base.id}@${base.version}`,
      sourceVersion: `房地产开发预设${industryVersion}；基表=${base.id}@${base.version}`,
      needsReview: false,
    });
  }
  for (const account of realEstatePreset.append) {
    if (accounts.has(account.code)) throw new Error(`房地产开发预设追加科目 ${account.code} 重复`);
    accounts.set(account.code, structuredClone(account));
  }
  const template = parseTemplate({
    ...base,
    id: realEstatePreset.id,
    version: `${industryVersion}+base.${base.version}`,
    name: realEstatePreset.name,
    order: 32,
    description: `${realEstatePreset.scope}基表 ${base.id}@${base.version}；追加七项开发成本并要求项目辅助，往来要求客户/供应商。明细后缀为应用编号。只用于新账，未自动分摊成本、判断完工/收入确认、税款或生成法定报表。`,
    accounts: [...accounts.values()].sort((a, b) => a.code.localeCompare(b.code)),
    sources: [
      ...base.sources,
      {
        title: realEstateSources.cost.title,
        file: realEstateSources.cost.url,
        note: `${realEstateSources.cost.scope}；2014-01-01起，七项成本后缀由本应用分配。`,
      },
      {
        title: realEstateSources.chart.title,
        file: realEstateSources.chart.url,
        note: realEstateSources.chart.retrieval,
      },
      {
        title: realEstateSources.revenue.title,
        file: realEstateSources.revenue.url,
        note: realEstateSources.revenue.scope,
      },
    ],
    reports: [],
  });
  return mapTemplateScheme(template, parseCodeScheme(codeScheme));
}
