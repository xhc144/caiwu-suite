import { z } from 'zod';
import { Decimal, zCents, zDate, zId } from '@caiwu/core';

export const SourceCurrencyTargetSchema = z.object({ documentId: zId });
export const SaveSourceCurrencySchema = SourceCurrencyTargetSchema.extend({
  expectedRevision: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  currency: z.string().trim().min(1).max(12),
  exchangeRate: z
    .string()
    .max(40)
    .regex(/^\d+(\.\d{1,12})?$/)
    .refine((v) => new Decimal(v).gt(0), '汇率必须大于零'),
  netFcCents: zCents.nonnegative(),
  taxFcCents: zCents.nonnegative(),
  grossFcCents: zCents.nonnegative(),
}).refine(
  (v) =>
    [v.netFcCents, v.taxFcCents, v.grossFcCents].every(Number.isSafeInteger) &&
    BigInt(v.netFcCents) + BigInt(v.taxFcCents) === BigInt(v.grossFcCents),
  '原币净额加税额必须等于价税合计',
);

export const BatchVoucherSchema = z
  .object({
    from: zDate,
    to: zDate,
    warehouseId: zId.optional(),
    purpose: z.enum(['receipt', 'revenue', 'cost', 'count']),
    taxAccountId: zId.optional(),
    revenueAccountId: zId.optional(),
    adjustmentAccountId: zId.optional(),
    voucherTypeId: zId,
    startNumber: z.number().int().positive().optional(),
    regenerate: z.boolean().default(false),
  })
  .refine((v) => v.to >= v.from, '截止日期不能小于起始日期');

export const ExecuteBatchVoucherSchema = BatchVoucherSchema.safeExtend({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: z.boolean(),
});
