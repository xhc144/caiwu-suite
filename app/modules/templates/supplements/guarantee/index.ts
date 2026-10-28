import {
  mapTemplateScheme,
  parseCodeScheme,
  parseTemplate,
  type AccountingTemplate,
} from '@caiwu/core';
import { baseTemplateId, baseVersion, guaranteePresets, type GuaranteePresetId } from './presets';

export {
  baseTemplateId,
  baseVersion,
  guaranteePresets,
  guaranteeApplicability,
  supplement,
} from './presets';
export type { GuaranteePresetId } from './presets';
export { guaranteeSources } from './sources';

export const guaranteeBaseReference = Object.freeze({
  id: baseTemplateId,
  version: baseVersion,
  codeScheme: '4-2-2',
  accountCount: 248,
  note: '只读引用已注册的企业基表；生产注册使用supplement，不复制基表、不跨模块读取文件。',
});

/** 仅供独立验证的合成器；生产入口统一使用templates owner的resolveTemplatePresets。 */
export function composeGuaranteePreset(
  presetId: GuaranteePresetId,
  baseInput: unknown,
  scheme: '4-2-2' | '4-3-3' = '4-2-2',
): AccountingTemplate {
  const preset = guaranteePresets.find((item) => item.id === presetId);
  if (!preset) throw new Error(`融资担保/小贷行业预设 ${presetId} 不存在`);
  const base = parseTemplate(structuredClone(baseInput));
  if (base.id !== baseTemplateId || base.version !== baseVersion || base.codeScheme !== '4-2-2')
    throw new Error(
      `行业预设需要原生基表 ${baseTemplateId}@${baseVersion}（4-2-2），请先合成再映射级次`,
    );
  if (base.devOnly || base.status !== 'current' || base.accounts.length !== 248)
    throw new Error('行业预设需要完整、正式的248项企业基表');
  for (const [code, name, direction, isContra] of [
    ['1303', '贷款', 'debit', false],
    ['1304', '贷款损失准备', 'credit', true],
    ['2801', '预计负债', 'credit', false],
    ['6601', '销售费用', 'debit', false],
  ] as const) {
    const account = base.accounts.find((item) => item.code === code);
    if (
      !account ||
      account.name !== name ||
      account.direction !== direction ||
      account.isContra !== isContra
    )
      throw new Error(`行业预设父科目 ${code} 名称、方向或备抵属性与基表版本不符`);
  }
  const accounts = new Map(base.accounts.map((account) => [account.code, account]));
  const changed = new Set<string>();
  for (const override of preset.accountOverrides ?? []) {
    const original = accounts.get(override.code);
    if (!original || changed.has(override.code) || !override.source.trim())
      throw new Error(`行业预设覆盖科目 ${override.code} 不存在、重复或没有依据`);
    changed.add(override.code);
    const fields = Object.fromEntries(
      Object.entries(override).filter(([, value]) => value !== undefined),
    );
    accounts.set(override.code, {
      ...original,
      ...structuredClone(fields),
      source: `${original.source ?? ''}；行业设置：${override.source}`,
      sourceVersion: `${base.id}@${base.version}；${preset.id}@${preset.version}`,
    });
  }
  for (const addition of preset.additionalAccounts ?? []) {
    if (accounts.has(addition.code) || !addition.source?.trim())
      throw new Error(`行业预设追加科目 ${addition.code} 重复或没有依据`);
    accounts.set(addition.code, {
      ...structuredClone(addition),
      dimensions: (addition.dimensions ?? []).map((dimension) => ({
        ...dimension,
        required: dimension.required ?? true,
      })),
      sourceVersion: addition.sourceVersion ?? `${preset.id}@${preset.version}`,
    });
  }
  const categories = [...base.categories, ...(preset.additionalCategories ?? [])];
  if (new Set(categories.map((category) => category.id)).size !== categories.length)
    throw new Error('行业预设追加科目类别重复');
  const template = parseTemplate({
    ...base,
    id: preset.id,
    version: preset.version,
    name: preset.name,
    order: preset.order,
    description: preset.description,
    accounts: [...accounts.values()].sort((a, b) => a.code.localeCompare(b.code)),
    categories,
    sources: [
      ...base.sources,
      {
        title: `基础制度：${base.name}`,
        note: `${base.id}@${base.version}；行业方案在此版本上应用，不改写已有账套。`,
      },
      ...preset.sources,
    ],
  });
  return mapTemplateScheme(template, parseCodeScheme(scheme));
}
