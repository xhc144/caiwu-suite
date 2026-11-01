import { z } from 'zod';
import { zCents, zDate, zId } from '@caiwu/core';

export const ContractInputSchema = z.object({
  id: zId.optional(),
  expectedRevision: z.number().int().nonnegative(),
  code: z.string().trim().min(1, '请输入合同号').max(40),
  name: z.string().trim().min(1, '请输入合同名称').max(100),
  partnerId: zId,
  accountId: zId,
  signedDate: zDate,
  kind: z.enum(['receipt', 'payment']),
  amount: zCents.refine((n) => n >= 0, '合同金额不能为负'),
  opening: zCents.refine((n) => n >= 0, '期初收付款不能为负'),
  description: z.string().max(4000).default(''),
  remark: z.string().max(500).default(''),
  remark2: z.string().max(500).default(''),
});
export type ContractInput = z.input<typeof ContractInputSchema>;
export const ContractVersionSchema = z.object({
  id: zId,
  expectedRevision: z.number().int().positive(),
});
export const ContractLinkSchema = ContractVersionSchema.extend({ voucherId: zId, lineId: zId });
export const ContractFilterSchema = z
  .object({
    signedFrom: zDate,
    signedTo: zDate,
    from: zDate,
    to: zDate,
    partnerId: zId.optional(),
    kind: z.enum(['all', 'receipt', 'payment']).default('all'),
  })
  .refine((v) => v.signedFrom <= v.signedTo && v.from <= v.to, '开始日期不能晚于结束日期');
export type ContractFilter = z.input<typeof ContractFilterSchema>;
