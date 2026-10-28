import {
  mapTemplateScheme,
  parseCodeScheme,
  parseTemplate,
  type AccountingTemplate,
  type TemplateAccount,
} from '@caiwu/core';
import { infrastructureSources as sources } from './sources';

/** The host supplies this read-only base; there is deliberately no books import. */
export const enterpriseInfrastructurePreset = {
  id: 'enterprise-infrastructure-cas',
  version: '1.0.0',
  baseTemplateId: 'books-enterprise-cas-2006',
  baseVersion: '2006.18+2026.2',
  nativeCodeScheme: '4-2-2',
  supportedCodeSchemes: ['4-2-2', '4-3-3'],
  originalEntry: 'a12.acd',
  name: '企业基本建设常用明细（企业准则基表补充）',
  scope:
    '执行企业会计准则的企业自有基本建设、更新改造等工程；不是施工承包收入模板，不适用于政府双体系。基表的适用范围及后续准则仍由基表决定。',
  overrides: [{ code: '1604', dimensions: [{ type: 'project', required: true }] }],
  append: [
    { code: '160401', name: '建筑工程' },
    { code: '160402', name: '安装工程' },
    { code: '160403', name: '在安装设备' },
    { code: '160404', name: '待摊支出' },
  ],
  numbering:
    '01—04为应用预设明细后缀；国管局原文存在同名同号分类，只在其系统范围强制。本预设不扩大该文件效力。映射4-3-3时160401成为1604001。',
  sources: [sources.enterprise2006, sources.enterpriseDetails],
} as const;

const requiredBaseRows = [
  ['1002', '银行存款', 'asset', 'debit'],
  ['1601', '固定资产', 'asset', 'debit'],
  ['1604', '在建工程', 'asset', 'debit'],
  ['1605', '工程物资', 'asset', 'debit'],
] as const;

/**
 * Compose before registry registration, then let the existing BookStore create it.
 * Reject a changed base instead of guessing at parent semantics or dropping rows.
 */
export function buildEnterpriseInfrastructureTemplate(
  base: unknown,
  codeScheme = '4-2-2',
): AccountingTemplate {
  const template = parseTemplate(base);
  const preset = enterpriseInfrastructurePreset;
  if (
    template.id !== preset.baseTemplateId ||
    template.version !== preset.baseVersion ||
    template.regime !== 'enterprise' ||
    template.codeScheme !== preset.nativeCodeScheme ||
    template.status !== 'current'
  )
    throw new Error(
      `企业基建预设要求只读基表 ${preset.baseTemplateId}@${preset.baseVersion}，原生级次4-2-2`,
    );
  if (!(preset.supportedCodeSchemes as readonly string[]).includes(codeScheme))
    throw new Error('企业基建预设仅支持4-2-2或4-3-3级次');
  for (const [code, name, category, direction] of requiredBaseRows) {
    const account = template.accounts.find((a) => a.code === code);
    if (
      !account ||
      account.name !== name ||
      account.category !== category ||
      (account.direction ?? template.categories.find((c) => c.id === category)?.direction) !==
        direction ||
      account.isContra ||
      account.disabled ||
      account.currency ||
      account.quantityUnit
    )
      throw new Error(`企业基表父科目 ${code} ${name} 的名称、类别、方向或核算属性不匹配`);
  }
  if (template.accounts.some((a) => a.code.length > 4 && a.code.startsWith('1604')))
    throw new Error('企业基表已有在建工程明细，不能覆盖或重复追加基建预设');
  const parent = template.accounts.find((a) => a.code === '1604')!;
  const projectDimensions = [
    ...parent.dimensions.filter((d) => d.type !== 'project'),
    { type: 'project' as const, required: true },
  ];
  const appended: TemplateAccount[] = preset.append.map((row) => ({
    ...row,
    category: parent.category,
    direction: 'debit',
    balanceNature: 'debit',
    closingRule: 'none',
    isContra: false,
    dimensions: projectDimensions,
    source: `${sources.enterpriseDetails.title}；PDF物理第4页第33项、第23页1604说明；名称取原文，明细后缀及必填项目为本应用预设；非全国统一强制编号；${sources.enterpriseDetails.file}`,
    sourceVersion: `${preset.id}@${preset.version}`,
    needsReview: false,
  }));
  const merged = parseTemplate({
    ...template,
    id: preset.id,
    version: `${preset.baseVersion}+infrastructure.${preset.version}`,
    name: preset.name,
    order: 31,
    description: `${preset.scope}；基于${preset.baseTemplateId}@${preset.baseVersion}，新增四项在建工程明细并要求项目辅助。项目应建到单项/单位工程层级后使用末级档案。仅用于新建账套；无自动成本分摊、资本化判断、完工转固或法定报表。`,
    accounts: [
      ...template.accounts.map((a) =>
        a.code === '1604'
          ? {
              ...a,
              dimensions: projectDimensions,
              source: `${a.source ?? ''}；应用基建预设：按项目辅助核算；${sources.enterpriseDetails.file}`,
            }
          : a,
      ),
      ...appended,
    ].sort((a, b) => a.code.localeCompare(b.code)),
    sources: [...template.sources, ...preset.sources],
  });
  return mapTemplateScheme(merged, parseCodeScheme(codeScheme));
}
