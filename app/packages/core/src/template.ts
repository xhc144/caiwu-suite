import { z } from 'zod';
import {
  cumulativeLengths,
  levelOfCode,
  parentCodeOf,
  parseCodeScheme,
  type CodeScheme,
} from './code-scheme';
import { DIMENSION_TYPE_IDS } from './dimensions';

/**
 * 会计制度模板：新建账套时选择，决定科目表、科目类别、默认凭证类型。
 * 模块在 server/index.ts 里通过 defineServerModule({ templates: [...] }) 提供模板（JSON 文件）。
 */

const AccountCategorySchema = z.object({
  /** 例如 asset / liability / common / equity / cost / pnl / net-assets / revenue / expense */
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  /** 该类科目默认的余额方向 */
  direction: z.enum(['debit', 'credit']),
  /** 是否损益类（期末要结转）。民非的收入、费用类也是 true。 */
  isPnl: z.boolean().default(false),
});

const TemplateAccountSchema = z.object({
  code: z.string().regex(/^\d+$/, '科目编码只能是数字'),
  name: z.string().min(1),
  category: z.string(),
  /** 不写就用类别的默认方向 */
  direction: z.enum(['debit', 'credit']).optional(),
  cash: z.boolean().optional(),
  bank: z.boolean().optional(),
  /** 现金流量标志：凭证里要指定现金流量项目 */
  cashflow: z.boolean().optional(),
  /** 往来科目 */
  partner: z.boolean().optional(),
  /** 外币核算币种，例如 "USD" */
  currency: z.string().optional(),
  /** 数量核算单位，例如 "千克" */
  quantityUnit: z.string().optional(),
  dimensions: z
    .array(z.object({ type: z.enum(DIMENSION_TYPE_IDS), required: z.boolean().default(true) }))
    .default([]),
  disabled: z.boolean().optional(),
  /** 依据（文件名 + 条款），便于核对 */
  source: z.string().optional(),
  /** 还没有对照原文核实 */
  needsReview: z.boolean().optional(),
});

export const AccountingTemplateSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  version: z.string().min(1),
  name: z.string().min(1),
  /** 会计制度归属，例如 enterprise / small-business / nonprofit */
  regime: z.string().min(1),
  description: z.string().optional(),
  /** 新建账套列表里的排序 */
  order: z.number().default(100),
  status: z.enum(['current', 'deprecated']).default('current'),
  /** 只在开发/测试模式出现 */
  devOnly: z.boolean().default(false),
  /** 默认科目级次，例如 "4-2-2" */
  codeScheme: z.string(),
  categories: z.array(AccountCategorySchema).min(1),
  accounts: z.array(TemplateAccountSchema).min(1),
  voucherTypes: z
    .array(z.object({ code: z.string().min(1).max(4), name: z.string().min(1) }))
    .min(1),
  currencies: z
    .array(
      z.object({
        code: z.string().regex(/^[A-Z]{3}$/),
        name: z.string(),
        symbol: z.string().optional(),
      }),
    )
    .default([]),
  /** 制度原文出处 */
  sources: z
    .array(
      z.object({ title: z.string(), file: z.string().optional(), note: z.string().optional() }),
    )
    .default([]),
  /** 配套报表模板 id（报表引擎任务定义） */
  reports: z.array(z.string()).default([]),
});

export type AccountingTemplateInput = z.input<typeof AccountingTemplateSchema>;
export type AccountingTemplate = z.output<typeof AccountingTemplateSchema>;
export type TemplateAccount = AccountingTemplate['accounts'][number];
export type AccountCategoryDef = AccountingTemplate['categories'][number];

/** 解析并校验模板；有问题时抛出列出全部问题的错误。 */
export function parseTemplate(input: unknown, scheme?: CodeScheme): AccountingTemplate {
  const result = AccountingTemplateSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `会计制度模板格式不对：\n${result.error.issues.map((i) => `- ${i.path.join('.')} ${i.message}`).join('\n')}`,
    );
  }
  const problems = templateProblems(result.data, scheme);
  if (problems.length) {
    throw new Error(
      `会计制度模板 ${result.data.id} 有问题：\n${problems.map((p) => `- ${p}`).join('\n')}`,
    );
  }
  return result.data;
}

/** 检查模板内容在给定级次下是否自洽：编码长度、上级存在、类别存在、币种存在、无重复。 */
export function templateProblems(t: AccountingTemplate, scheme?: CodeScheme): string[] {
  const problems: string[] = [];
  let s: CodeScheme;
  try {
    s = scheme ?? parseCodeScheme(t.codeScheme);
  } catch (e) {
    return [(e as Error).message];
  }
  const categories = new Set(t.categories.map((c) => c.id));
  const currencies = new Set(['CNY', ...t.currencies.map((c) => c.code)]);
  const codes = new Set<string>();
  const maxLen = cumulativeLengths(s).at(-1) ?? 0;
  for (const a of t.accounts) {
    if (codes.has(a.code)) problems.push(`科目 ${a.code} 重复`);
    codes.add(a.code);
    if (!categories.has(a.category)) problems.push(`科目 ${a.code} 的类别 ${a.category} 未定义`);
    if (a.currency && !currencies.has(a.currency))
      problems.push(`科目 ${a.code} 的币种 ${a.currency} 未定义`);
    if (levelOfCode(a.code, s) == null) {
      problems.push(`科目 ${a.code} 的编码长度不符合级次 ${s.join('-')}（最长 ${maxLen} 位）`);
    }
  }
  for (const a of t.accounts) {
    if (levelOfCode(a.code, s) == null) continue;
    const parent = parentCodeOf(a.code, s);
    if (parent && !codes.has(parent)) problems.push(`科目 ${a.code} 的上级科目 ${parent} 不存在`);
  }
  const vtypes = new Set<string>();
  for (const v of t.voucherTypes) {
    if (vtypes.has(v.code)) problems.push(`凭证类型 ${v.code} 重复`);
    vtypes.add(v.code);
  }
  return problems;
}
