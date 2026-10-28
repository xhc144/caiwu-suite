import { z } from 'zod';
import { zDate, zId, zPeriod, VoucherSourceSchema } from '@caiwu/core';

const decimal = z.string().regex(/^\d{1,9}(\.\d{1,6})?$/, '请输入最多六位小数的非负数');
export const ProductionSchema = z.object({
  date: zDate,
  warehouseId: zId,
  materialAccountId: zId,
  laborAccountId: zId,
  overheadAccountId: zId,
  rows: z
    .array(z.object({ productId: zId, quantity: decimal, factor: decimal.optional() }))
    .min(1)
    .max(200),
});
export const SaveProductionSchema = ProductionSchema.extend({
  requestKey: z.string().min(8).max(100),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  voucherTypeId: zId,
  number: z.number().int().positive().optional(),
  confirmed: z.boolean(),
});
export const CancelProductionSchema = z.object({
  id: zId,
  revision: z.number().int().positive(),
  confirmed: z.boolean(),
  voucherDeletion: VoucherSourceSchema.shape.voucherDeletion,
});
export const ProfitConfigSchema = z.object({
  period: zPeriod,
  expenseAccountId: zId,
  surchargeAccountId: zId,
  profitAccountId: zId,
  revision: z.number().int().nonnegative(),
});
export const ProfitTransferSchema = z.object({
  period: zPeriod,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  voucherTypeId: zId,
  number: z.number().int().positive().optional(),
  confirmed: z.boolean(),
});
export const ProfitTransferDeleteSchema = z.object({
  period: zPeriod,
  confirmed: z.boolean(),
  voucherDeletion: VoucherSourceSchema.shape.voucherDeletion,
});
export const ProductionDraftSchema = z.object({
  date: z.string().max(10),
  warehouseId: zId.nullable(),
  materialAccountId: zId.nullable(),
  laborAccountId: zId.nullable(),
  overheadAccountId: zId.nullable(),
  rows: z
    .array(
      z.object({
        productId: zId.nullable(),
        quantity: z.string().max(40),
        factor: z.string().max(40),
      }),
    )
    .max(200),
  requestKey: z.string().min(8).max(100),
});
