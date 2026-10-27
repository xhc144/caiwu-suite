import { z } from 'zod';
import {
  BusinessError,
  CreateBookInputSchema,
  parseCodeScheme,
  type AccountingTemplate,
  type BookSummary,
} from '@caiwu/core';
import { mapChart } from './chart-scheme';

export const NamesSchema = z.object({
  name: z.string().trim().min(1, '账套名称不能为空').max(60, '账套名称最多60字'),
  orgName: z.string().trim().min(1, '单位名称不能为空').max(100, '单位名称最多100字'),
});
export const WizardSchema = CreateBookInputSchema.extend({
  ...NamesSchema.shape,
  baseCurrency: z.literal('CNY', '请选择人民币本位币'),
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
    mapChart(template, text);
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
    [b.id, b.name, b.orgName, b.templateName, b.regime].some((v) =>
      v.toLocaleLowerCase('zh-CN').includes(text),
    ),
  );
}

// 按身份保留选择；刷新后原账套消失时不能悄悄改选另一个账套。
export function selectedBook(books: BookSummary[], id: string | null) {
  return id === null ? books[0] : books.find((b) => b.id === id);
}

export function moveBookSelection(books: BookSummary[], id: string | null, direction: 1 | -1) {
  const current = selectedBook(books, id);
  const index = current ? books.indexOf(current) : direction === 1 ? -1 : books.length;
  return books[Math.max(0, Math.min(books.length - 1, index + direction))]?.id ?? null;
}
