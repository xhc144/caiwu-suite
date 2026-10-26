import { z } from 'zod';
import { zCents, zId, zPeriod } from '@caiwu/core';
const quantity = z
  .string()
  .max(40)
  .regex(/^\d+(\.\d{1,6})?$/);
const signedQuantity = z
  .string()
  .max(40)
  .regex(/^-?\d+(\.\d{1,6})?$/);

export const CostingCommitSchema = z.object({
  bookId: z.string().min(1),
  period: zPeriod,
  requestKey: z.string().min(8).max(100),
  expectedStockRevision: z.number().int().nonnegative(),
  expectedOpeningRevision: z.number().int().nonnegative(),
  previousBatchId: z.string().nullable(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  lines: z
    .array(
      z.object({
        lineId: zId,
        documentId: zId,
        costCents: zCents.nonnegative(),
        unitCost: z
          .string()
          .max(100)
          .regex(/^\d+(\.\d{1,12})?$/),
      }),
    )
    .max(100000),
  balances: z
    .array(
      z.object({
        warehouseId: zId,
        productId: zId,
        quantity,
        amountCents: zCents.nonnegative(),
      }),
    )
    .max(100000),
  countAdjustments: z
    .array(
      z.object({
        warehouseId: zId,
        productId: zId,
        countId: zId.nullable(),
        quantity: signedQuantity,
        amountCents: zCents,
        zeroQuantityAdjustmentCents: zCents,
      }),
    )
    .max(100000),
});
export const CostingCancelSchema = z.object({
  bookId: z.string().min(1),
  batchId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
});
export const VoucherSourceSchema = z.object({
  bookId: z.string().min(1),
  documentId: zId,
  purpose: z.enum(['receipt', 'revenue', 'cost']),
  expectedRevision: z.number().int().positive(),
  voucherId: zId,
});
export type CostingCommitInput = z.infer<typeof CostingCommitSchema>;
export type CostingCancelInput = z.infer<typeof CostingCancelSchema>;
export type VoucherSourceInput = z.infer<typeof VoucherSourceSchema>;
