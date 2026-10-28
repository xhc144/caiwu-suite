import {
  BusinessError,
  mapTemplateScheme,
  parseCodeScheme,
  parseTemplate,
  type AccountingTemplate,
  type TemplateAccount,
} from '@caiwu/core';
import { constructionPresets, type ConstructionPresetId } from './presets';

export {
  constructionCasPreset,
  constructionSmallPreset,
  constructionSystem2003Preset,
  constructionPresets,
  type ConstructionPreset,
  type ConstructionPresetId,
} from './presets';
export { constructionSources } from './sources';
export { supplement } from './supplement';

export type ConstructionTemplateOptions = {
  /** 基表须是原生4-2-2；合成后统一按core逐段映射，不能在合成前改编号。 */
  codeScheme?: string;
  /** 可由向导传入建账启用日；只检查本预设明示的生效范围。 */
  startDate?: string;
};

function fail(code: string, message: string, hint?: string): never {
  throw new BusinessError({ code, message, hint });
}

/**
 * 纯合成函数。调用方传入其已注册的只读基表；本目录不import books或修改registry。
 * 返回完整AccountingTemplate，可直接放入templates模块的templates数组。
 */
export function materializeConstructionTemplate(
  baseInput: unknown,
  presetId: ConstructionPresetId,
  options: ConstructionTemplateOptions = {},
): AccountingTemplate {
  const preset = constructionPresets.find((item) => item.id === presetId);
  if (!preset) fail('CONSTRUCTION_PRESET_NOT_FOUND', `施工预设 ${presetId} 不存在`);
  if (preset.integration !== 'ready')
    fail(
      'CONSTRUCTION_BASE_MISSING',
      '2003施工补充尚缺完整、经官方原文核定的2001企业会计制度基表，不能建账',
      '先补齐法定基表及其版本，再接入此历史预设；不能与2006企业准则基表合并',
    );

  const base = parseTemplate(baseInput);
  if (
    base.id !== preset.baseTemplateId ||
    base.version !== preset.baseVersion ||
    base.regime !== preset.baseRegime ||
    base.codeScheme !== '4-2-2'
  )
    fail(
      'CONSTRUCTION_BASE_VERSION',
      `施工预设要求 ${preset.baseTemplateId}@${preset.baseVersion} 的原生4-2-2基表`,
      '请传入指定版本的完整企业基表；不能将演示模板、小企业和企业制度互换',
    );

  if (options.startDate) {
    const date = new Date(`${options.startDate}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(options.startDate) ||
      !Number.isFinite(date.valueOf()) ||
      date.toISOString().slice(0, 10) !== options.startDate ||
      options.startDate < preset.effectiveFrom
    )
      fail(
        'CONSTRUCTION_EFFECTIVE_DATE',
        `${preset.name}不能用于启用日期 ${options.startDate}`,
        `本预设支持 ${preset.effectiveFrom} 起的适用范围；更早的分批执行日期须使用对应历史配置`,
      );
  }

  const accounts = new Map<string, TemplateAccount>(
    base.accounts.map((row) => [
      row.code,
      { ...structuredClone(row), sourceVersion: row.sourceVersion ?? base.version },
    ]),
  );
  for (const expected of preset.expectedBaseAccounts) {
    const actual = accounts.get(expected.code);
    if (
      !actual ||
      actual.name !== expected.name ||
      actual.category !== expected.category ||
      actual.direction !== expected.direction ||
      actual.disabled
    )
      fail(
        'CONSTRUCTION_BASE_ACCOUNT',
        `施工预设的基表科目 ${expected.code} ${expected.name} 缺失或名称、类别、方向不一致`,
        '核对基表版本与科目，不要以行业补充静默更正错误基表',
      );
  }

  for (const patch of preset.overrides) {
    const before = accounts.get(patch.code);
    if (!before) fail('CONSTRUCTION_PARENT_MISSING', `缺少待补充的基表科目 ${patch.code}`);
    const dimensions = new Map(before.dimensions.map((dimension) => [dimension.type, dimension]));
    for (const dimension of patch.dimensions ?? []) dimensions.set(dimension.type, dimension);
    accounts.set(patch.code, {
      ...before,
      ...structuredClone(patch),
      dimensions: [...dimensions.values()],
      source: [before.source, patch.source].filter(Boolean).join('；施工预设补充：'),
      sourceVersion: `${base.version}+${preset.id}@${preset.version}`,
    });
  }

  for (const addition of preset.additions) {
    if (accounts.has(addition.code))
      fail(
        'CONSTRUCTION_CODE_COLLISION',
        `施工补充科目 ${addition.code} 与基表重复，不能覆盖`,
        '核对基表版本及编号分配；同名或同编号也不能静默合并',
      );
    // 增设明细会把父科目变成非末级，必须确保父科目未停用、类别相同。
    const parentCode = addition.code.length > 4 ? addition.code.slice(0, -2) : null;
    if (parentCode) {
      const parent = accounts.get(parentCode);
      if (!parent || parent.disabled || parent.category !== addition.category)
        fail(
          'CONSTRUCTION_PARENT_MISSING',
          `施工明细 ${addition.code} 的合法父科目 ${parentCode} 不存在`,
        );
    }
    accounts.set(addition.code, structuredClone(addition));
  }

  for (const root of preset.disableSubtrees) {
    for (const [code, account] of accounts) {
      if (code === root || code.startsWith(root))
        accounts.set(code, {
          ...account,
          disabled: true,
          source: `${account.source ?? ''}；施工预设停用旧建造合同核算科目：财会〔2017〕22号通知第一项；新建账使用合同履约成本和合同结算。`,
        });
    }
  }

  const template = parseTemplate({
    ...base,
    id: preset.id,
    version: preset.version,
    name: preset.name,
    description: preset.description,
    order: presetId === 'construction-cas-revenue-2017' ? 20 : 21,
    status: preset.status,
    devOnly: false,
    accounts: [...accounts.values()].sort((a, b) => a.code.localeCompare(b.code)),
    sources: [...base.sources, ...preset.sources],
    // 原企业报表映射不自动支持合同结算，不能继承并宣称其可用。
    reports: [],
  });
  return options.codeScheme
    ? mapTemplateScheme(template, parseCodeScheme(options.codeScheme))
    : template;
}

/** registry owner在本模块中将基表作为参数传入，无需任何core接口或新registry。 */
export function buildConstructionTemplates(bases: readonly unknown[]): AccountingTemplate[] {
  const parsed = bases.map((base) => parseTemplate(base));
  const byId = new Map<string, AccountingTemplate>();
  for (const base of parsed) {
    if (byId.has(base.id)) fail('CONSTRUCTION_BASE_DUPLICATE', `基表 ${base.id} 重复提供`);
    byId.set(base.id, base);
  }
  return constructionPresets
    .filter((preset) => preset.integration === 'ready')
    .map((preset) => {
      const base = byId.get(preset.baseTemplateId);
      if (!base)
        fail('CONSTRUCTION_BASE_MISSING', `未提供施工预设需要的基表 ${preset.baseTemplateId}`);
      return materializeConstructionTemplate(base, preset.id);
    });
}
