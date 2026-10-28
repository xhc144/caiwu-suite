import { z } from 'zod';
import { zDate, zId } from '@caiwu/core';
import { LineSchema } from './shared';

export const TransferSchema = z
  .object({
    requestKey: z.string().min(8).max(80),
    number: z.string().trim().min(1, '调拨单号不能为空').max(180),
    sourceWarehouseId: zId,
    targetWarehouseId: zId,
    date: zDate,
    clearingAccountId: zId,
    operator: z.string().trim().max(200).default(''),
    summary: z.string().trim().max(180).default(''),
    lines: z.array(LineSchema).min(1, '调拨单必须有明细').max(1000),
    negativeConfirmation: z.string().optional(),
  })
  .strict()
  .refine((v) => v.sourceWarehouseId !== v.targetWarehouseId, {
    path: ['targetWarehouseId'],
    message: '调出仓库与调入仓库不能相同',
  })
  .refine((v) => v.lines.every((l) => !l.priceIncludesTax), {
    path: ['lines'],
    message: '调拨不计税，请填写不含税调拨单价',
  });

export const TransferIdentitySchema = z.object({
  id: zId,
  revision: z.number().int().positive(),
  issueRevision: z.number().int().positive(),
  receiptRevision: z.number().int().positive(),
});
export const AuditTransferSchema = TransferIdentitySchema.extend({ to: z.boolean() }).strict();
export const RemoveTransferSchema = TransferIdentitySchema.extend({
  confirmed: z.boolean(),
}).strict();

export type TransferInput = z.input<typeof TransferSchema>;
export type TransferIdentity = z.infer<typeof TransferIdentitySchema>;
