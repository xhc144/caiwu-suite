import { z } from 'zod';
import {
  AccountingTemplateSchema,
  BusinessError,
  mapTemplateScheme,
  parseCodeScheme,
  parseTemplate,
  type AccountingTemplate,
} from '@caiwu/core';

const account = AccountingTemplateSchema.shape.accounts.element.strict();
// partial() 在 Zod 4 中仍会应用字段内部默认值；省略维度不能变成清空维度。
const override = account
  .partial()
  .extend({ dimensions: account.shape.dimensions.unwrap().optional() })
  .required({ code: true, source: true });

/** 行业选择复用已经注册的制度，不复制基表，也不跨模块读取文件。 */
export const TemplatePresetSchema = z
  .object({
    id: AccountingTemplateSchema.shape.id,
    version: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    baseTemplateId: AccountingTemplateSchema.shape.id,
    baseTemplateVersion: z.string().min(1),
    order: z.number().default(100),
    codeScheme: z.string().optional(),
    additionalAccounts: z.array(account).default([]),
    accountOverrides: z.array(override).default([]),
    additionalCategories: z.array(AccountingTemplateSchema.shape.categories.element).default([]),
    sources: AccountingTemplateSchema.shape.sources.unwrap().min(1),
  })
  .strict();

export type TemplatePresetInput = z.input<typeof TemplatePresetSchema>;
export type TemplateSupplement = {
  templates?: readonly unknown[];
  presets?: readonly TemplatePresetInput[];
};

/** 接受作者直接导出的 JSON；拒绝未知核算字段，不能静默丢弃双体系等定义。 */
export function parseSupplementTemplates(inputs: readonly unknown[]): AccountingTemplate[] {
  const schema = AccountingTemplateSchema.extend({ accounts: z.array(account).min(1) }).strict();
  return inputs.map((input) => parseTemplate(schema.parse(input)));
}

function invalid(message: string): never {
  throw new BusinessError({
    code: 'TEMPLATE_PRESET_INVALID',
    message,
    hint: '请核对行业模板的基础制度版本、科目编码和原文来源后重新启动',
  });
}

/** 一次解析全部方案，成功后才交给既有登记处，避免半批注册。 */
export function resolveTemplatePresets(
  inputs: readonly TemplatePresetInput[],
  getBase: (id: string) => AccountingTemplate,
): AccountingTemplate[] {
  const definitions = inputs.map((input) => TemplatePresetSchema.parse(input));
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  if (byId.size !== definitions.length) invalid('行业模板编号重复');
  const resolved = new Map<string, AccountingTemplate>();
  const visiting = new Set<string>();

  const resolve = (id: string): AccountingTemplate => {
    const cached = resolved.get(id);
    if (cached) return cached;
    const definition = byId.get(id);
    if (!definition) return getBase(id);
    if (visiting.has(id)) invalid(`行业模板 ${id} 的基础制度存在循环引用`);
    visiting.add(id);
    let base = resolve(definition.baseTemplateId);
    if (base.version !== definition.baseTemplateVersion)
      invalid(
        `行业模板“${definition.name}”要求基础制度版本 ${definition.baseTemplateVersion}，实际为 ${base.version}`,
      );
    if (base.devOnly || base.status !== 'current')
      invalid(`行业模板“${definition.name}”不能基于演示或已停用制度`);
    if (definition.codeScheme)
      base = mapTemplateScheme(base, parseCodeScheme(definition.codeScheme));
    const accounts = new Map(
      base.accounts.map((a) => [a.code, { ...a, sourceVersion: a.sourceVersion ?? base.version }]),
    );
    const changed = new Set<string>();
    for (const change of definition.accountOverrides) {
      if (changed.has(change.code))
        invalid(`行业模板“${definition.name}”重复修改科目 ${change.code}`);
      const original = accounts.get(change.code);
      if (!original) invalid(`行业模板“${definition.name}”修改的科目 ${change.code} 不存在`);
      if (!change.source.trim()) invalid(`行业模板科目 ${change.code} 缺少修改依据`);
      changed.add(change.code);
      accounts.set(change.code, {
        ...original,
        ...change,
        source: `${original.source ?? ''}；行业设置：${change.source}`,
        sourceVersion: `${base.id}@${base.version}；${definition.id}@${definition.version}`,
      });
    }
    for (const addition of definition.additionalAccounts) {
      if (accounts.has(addition.code))
        invalid(`行业模板“${definition.name}”新增科目 ${addition.code} 与已有科目重复`);
      if (!addition.source?.trim()) invalid(`行业模板科目 ${addition.code} 缺少原文依据`);
      accounts.set(addition.code, {
        ...addition,
        sourceVersion: addition.sourceVersion ?? `${definition.id}@${definition.version}`,
      });
    }
    const categories = [...base.categories, ...definition.additionalCategories];
    if (new Set(categories.map((c) => c.id)).size !== categories.length)
      invalid(`行业模板“${definition.name}”的科目类别重复`);
    const template = parseTemplate({
      ...base,
      id: definition.id,
      version: definition.version,
      name: definition.name,
      description: definition.description,
      order: definition.order,
      accounts: [...accounts.values()].sort((a, b) => a.code.localeCompare(b.code)),
      categories,
      sources: [
        ...base.sources,
        {
          title: `基础制度：${base.name}`,
          note: `${base.id}@${base.version}；行业方案在此版本上应用，不改写已有账套。`,
        },
        ...definition.sources,
      ],
    });
    visiting.delete(id);
    resolved.set(id, template);
    return template;
  };
  return definitions.map((definition) => resolve(definition.id));
}
