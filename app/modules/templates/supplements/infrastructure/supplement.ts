import type { TemplatePresetInput, TemplateSupplement } from '../../preset';
import { enterpriseInfrastructurePreset } from './enterprise';
import { infrastructureHistoricalTemplates } from './historical';
import { infrastructureSources } from './sources';

/** Declarative equivalent of the independent builder; the catalog supplies the base. */
export const infrastructureTemplatePreset: TemplatePresetInput = {
  id: enterpriseInfrastructurePreset.id,
  version: `${enterpriseInfrastructurePreset.baseVersion}+infrastructure.${enterpriseInfrastructurePreset.version}`,
  name: enterpriseInfrastructurePreset.name,
  description: `${enterpriseInfrastructurePreset.scope}；新增四项在建工程明细并要求项目辅助。仅用于新建账套；明细后缀为应用预设，不宣称全国统一强制编号。无自动成本分摊、资本化判断、完工转固或法定报表。`,
  baseTemplateId: enterpriseInfrastructurePreset.baseTemplateId,
  baseTemplateVersion: enterpriseInfrastructurePreset.baseVersion,
  order: 31,
  codeScheme: enterpriseInfrastructurePreset.nativeCodeScheme,
  additionalAccounts: enterpriseInfrastructurePreset.append.map((row) => ({
    ...row,
    category: 'asset',
    direction: 'debit',
    balanceNature: 'debit',
    closingRule: 'none',
    isContra: false,
    dimensions: [{ type: 'project', required: true }],
    source: `${infrastructureSources.enterpriseDetails.title}；PDF物理第4页第33项、第23页1604说明；名称取原文，明细后缀及必填项目为本应用预设；非全国统一强制编号；${infrastructureSources.enterpriseDetails.file}`,
    sourceVersion: `${enterpriseInfrastructurePreset.id}@${enterpriseInfrastructurePreset.version}`,
    needsReview: false,
  })),
  accountOverrides: [
    {
      code: '1604',
      source: `${infrastructureSources.enterpriseDetails.title}；PDF物理第4、23页，按具体工程项目辅助核算；应用映射；${infrastructureSources.enterpriseDetails.file}`,
      dimensions: [{ type: 'project', required: true }],
    },
  ],
  sources: [...enterpriseInfrastructurePreset.sources],
};

/** Government reference is deliberately excluded from both registrable arrays. */
export const supplement: TemplateSupplement = {
  templates: [...infrastructureHistoricalTemplates],
  presets: [infrastructureTemplatePreset],
};
