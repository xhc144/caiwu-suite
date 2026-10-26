import { z } from 'zod';
import {
  BusinessError,
  CreateBookInputSchema,
  parseCodeScheme,
  templateProblems,
  type AccountingTemplate,
  type BookSummary,
} from '@caiwu/core';

export const NamesSchema = z.object({
  name: z.string().trim().min(1, '账套名称不能为空').max(60, '账套名称最多60字'),
  orgName: z.string().trim().min(1, '单位名称不能为空').max(100, '单位名称最多100字'),
});
export const WizardSchema = CreateBookInputSchema.extend({
  ...NamesSchema.shape,
  codeScheme: z.string().trim().min(1, '请设置科目级次'),
  adminCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]{1,20}$/, '管理员编号应为1—20位字母、数字、下划线、点或短横线'),
  adminName: z.string().trim().min(1, '管理员姓名不能为空'),
});
export type WizardInput = z.input<typeof WizardSchema>;

export function validateScheme(template: AccountingTemplate, text: string) {
  try {
    const scheme = parseCodeScheme(text);
    const problems = templateProblems(template, scheme);
    // 一级不能被解释为多段、也不能折叠原有上下级。
    const original = parseCodeScheme(template.codeScheme);
    if (scheme[0] !== original[0])
      problems.unshift(`科目 ${template.accounts[0]!.code} 的一级编码需要 ${original[0]} 位`);
    if (problems.length) throw new Error(problems.join('；'));
    return scheme;
  } catch (e) {
    throw new BusinessError({
      code: 'BOOKS_SCHEME_INVALID',
      message: (e as Error).message,
      hint: `可用级次：${template.codeScheme}；最多8级，每级1—6位。需保留模板的一级编码和上级链。`,
    });
  }
}

export const TargetSchema = z.object({
  targetId: z.uuid(),
  userCode: z.string().trim().min(1, '请输入目标账套用户代码'),
  password: z.string().max(64),
});
export const CopySchema = TargetSchema.extend({
  name: NamesSchema.shape.name,
  requestId: z.uuid(),
  confirmed: z.literal(true, '请确认复制来源与新名称'),
});
export const DeleteSchema = TargetSchema.extend({ ticket: z.uuid(), confirmName: z.string() });

export function filterBooks(books: BookSummary[], keyword: string) {
  const text = keyword.trim().toLocaleLowerCase('zh-CN');
  return books.filter((b) =>
    [b.name, b.orgName, b.templateName, b.regime].some((v) =>
      v.toLocaleLowerCase('zh-CN').includes(text),
    ),
  );
}
