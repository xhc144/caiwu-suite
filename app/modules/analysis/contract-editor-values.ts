import { z } from 'zod';
import { centsToYuan, parseMoney } from '@caiwu/core';
import type { ContractInput } from './contracts';

export type ContractEditorValues = Omit<ContractInput, 'amount' | 'opening'> & {
  amount: string;
  opening: string;
};
const moneyDraft = z
  .union([z.string(), z.number().int().safe()])
  .transform((value) => (typeof value === 'number' ? centsToYuan(value) : value));
const DraftSchema = z.object({
  id: z.number().int().positive().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  code: z.string().max(40).optional(),
  name: z.string().max(100).optional(),
  partnerId: z.number().int().positive().optional(),
  accountId: z.number().int().positive().optional(),
  signedDate: z.string().max(30).optional(),
  kind: z.enum(['receipt', 'payment']).optional(),
  amount: moneyDraft.optional(),
  opening: moneyDraft.optional(),
  description: z.string().max(4000).optional(),
  remark: z.string().max(500).optional(),
  remark2: z.string().max(500).optional(),
});
/** 草稿保留金额原文，旧版数字草稿的单位为分。恢复不等同于可保存。 */
export function readContractDraft(value: unknown): Partial<ContractEditorValues> | null {
  const result = DraftSchema.safeParse(value);
  return result.success ? result.data : null;
}
export function parseContractEditorMoney(text: string | undefined, label: string): number {
  if (typeof text !== 'string' || !text.trim()) throw new Error(`${label}不能为空，请按元填写`);
  if (/[-－—(（]/.test(text)) throw new Error(`${label}不能为负，请修改后保存；当前输入仍保留`);
  const normalized = text
    .trim()
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/[,，\s¥￥元]/g, '')
    .replace(/^\+/, '');
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(normalized))
    throw new Error(`${label}须为最多两位小数的非负金额，当前输入仍保留`);
  let value: number | null;
  try {
    value = parseMoney(text);
  } catch {
    throw new Error(`${label}超出可保存范围，当前输入仍保留`);
  }
  if (value === null || value < 0 || !Number.isSafeInteger(value))
    throw new Error(`${label}不是有效的非负金额，请修改后保存；当前输入仍保留`);
  return value;
}
