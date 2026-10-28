import {
  mapTemplateScheme,
  parseCodeScheme,
  parseTemplate,
  type AccountingTemplate,
} from '@caiwu/core';
import definition from './party-dues-jining-port-2021.json' with { type: 'json' };
import type { TemplateSupplement } from '../../preset';

/** 应用预置的两种编码级次；官方党费文件未规定科目编号。 */
export const PARTY_DUES_CODE_SCHEMES = ['3-2-2', '3-3-3'] as const;
export type PartyDuesCodeScheme = (typeof PARTY_DUES_CODE_SCHEMES)[number];

/** 与模板一起交给建账入口展示；不是全国党费会计制度的适用性判定。 */
export const partyDuesSupplement = {
  originalTemplate: 'a46.acd',
  originalLabel: '党费管理模板',
  templateId: 'party-dues-jining-port-2021',
  version: '1.0.0',
  kind: 'standalone-template',
  baseTemplateId: null,
  baseVersion: null,
  sourceDocument: '济航〔2021〕30号',
  effectiveFrom: '2021-04-30',
  checkedOn: '2026-10-28',
  documentContinuedValidity: 'not-confirmed',
  applicationAvailability: 'reference-not-current-default',
  scope: '济宁市港航事业发展中心及该文件所列科室、服务中心、工程项目指挥部的党费专账',
  codeAuthority: 'application-preset',
  directionAuthority: 'application-mapping',
  dimensionAuthority: 'application-mapping',
  accountingBasis: 'cash',
  accountingSystem: 'separate-party-dues-ledger',
  defaultForAllPartyOrganizations: false,
  originalAccountTableRecovered: false,
  supportedCodeSchemes: PARTY_DUES_CODE_SCHEMES,
  limitations: [
    '地方文件口径，不代表全国统一党费科目；原文未规定编码、余额方向或辅助维度。',
    '未读取原安装包，不能宣称复刻a46原始科目内容或原始编码级次。',
    '不处理行政事业单位本体的政府会计双体系、代管党费、企业党建经费或账套转换。',
    '未实现该文件要求的三张专门报表、资产卡片及党费专属年末结转流程。',
  ],
} as const;

const native = parseTemplate(definition);

/**
 * 除core的结构检查外，保护此版本已经核对的名称、方向及辅助映射。
 * 需要另设科目的单位应在建账后使用科目维护，不能静默篡改这个版本的预置。
 */
export function parsePartyDuesTemplate(input: unknown): AccountingTemplate {
  const template = parseTemplate(input);
  if (
    template.id !== native.id ||
    template.version !== native.version ||
    template.regime !== native.regime ||
    template.name !== native.name ||
    template.description !== native.description ||
    template.status !== native.status ||
    template.devOnly !== native.devOnly ||
    JSON.stringify(template.sources) !== JSON.stringify(native.sources) ||
    JSON.stringify(template.reports) !== JSON.stringify(native.reports) ||
    JSON.stringify(template.currencies) !== JSON.stringify(native.currencies) ||
    JSON.stringify(template.voucherTypes) !== JSON.stringify(native.voucherTypes) ||
    !PARTY_DUES_CODE_SCHEMES.some((scheme) => scheme === template.codeScheme)
  ) {
    throw new Error('党费预置的模板标识、版本、口径或编码级次不匹配');
  }
  const expected = mapTemplateScheme(native, parseCodeScheme(template.codeScheme));
  const rows = new Map(expected.accounts.map((account) => [account.code, account]));
  if (template.accounts.length !== rows.size)
    throw new Error('党费预置的科目数量与来源名称表不一致');
  for (const account of template.accounts) {
    const original = rows.get(account.code);
    const category = template.categories.find((item) => item.id === account.category);
    if (
      !original ||
      account.name !== original.name ||
      account.category !== original.category ||
      (account.direction ?? category?.direction) !== original.direction ||
      account.balanceNature !== original.balanceNature ||
      account.closingRule !== original.closingRule ||
      account.cash !== original.cash ||
      account.bank !== original.bank ||
      account.partner !== original.partner ||
      account.currency !== original.currency ||
      account.quantityUnit !== original.quantityUnit ||
      account.cashflow !== original.cashflow ||
      account.disabled !== original.disabled ||
      account.isContra !== original.isContra ||
      account.source !== original.source ||
      account.sourceVersion !== original.sourceVersion ||
      JSON.stringify(account.dimensions) !== JSON.stringify(original.dimensions)
    ) {
      throw new Error(`党费预置科目 ${account.code} 的名称、方向或核算配置与此版本不一致`);
    }
  }
  if (
    template.categories.length !== expected.categories.length ||
    new Set(template.categories.map((category) => category.id)).size !==
      expected.categories.length ||
    template.categories.some((category) => {
      const original = expected.categories.find((item) => item.id === category.id);
      return (
        !original ||
        category.name !== original.name ||
        category.direction !== original.direction ||
        category.isPnl !== original.isPnl
      );
    })
  ) {
    throw new Error('党费预置的类别或结转配置与此版本不一致');
  }
  return template;
}

/** 取得独立副本；只生成新账模板，不注册、不写账、不修改基表或旧账。 */
export function getPartyDuesTemplate(scheme: PartyDuesCodeScheme = '3-2-2'): AccountingTemplate {
  if (!PARTY_DUES_CODE_SCHEMES.some((supported) => supported === scheme))
    throw new Error('党费预置支持的科目级次为3-2-2或3-3-3');
  return parsePartyDuesTemplate(mapTemplateScheme(native, parseCodeScheme(scheme)));
}

/** 独立模板数组；统一集成时只注册下方supplement，不重复追加本数组。 */
export const partyDuesTemplates: readonly AccountingTemplate[] = [getPartyDuesTemplate()];

/** 统一接入契约；仅由唯一registry owner在supplement-catalog中汇总注册一次。 */
export const supplement: TemplateSupplement = { templates: partyDuesTemplates };
