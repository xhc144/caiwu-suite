import { z } from 'zod';
import { zCents, zDate, zId } from '@caiwu/core';
import { decimal } from './shared';

const text = z.string().trim().max(200);
export const InvoiceIssueReferencesSchema = z.object({ invoiceId: zId.optional() }).strict();
export type InvoiceIssueReferencesInput = z.input<typeof InvoiceIssueReferencesSchema>;
export const InvoiceIssueInputSchema = z
  .object({
    invoiceId: zId,
    invoiceRevision: z.number().int().positive(),
    redLetter: z.boolean(),
    requestKey: z.string().min(8).max(80),
    warehouseId: zId,
    date: zDate,
    number: text.min(1, '出库单号不能为空'),
    settlementAccountId: zId,
    costAccountId: zId,
    originalDocument: z
      .object({ id: zId, revision: z.number().int().positive() })
      .strict()
      .nullable()
      .optional(),
    newProducts: z
      .array(
        z
          .object({
            code: text.min(1, '新产品编号不能为空'),
            name: text.min(1, '新产品名称不能为空'),
            specification: text,
            unit: text.min(1, '新产品单位不能为空'),
            inventoryAccountId: zId,
            salesAccountId: zId,
          })
          .strict(),
      )
      .max(200)
      .default([]),
    lines: z
      .array(
        z
          .object({
            productCode: text.min(1, '产品编号不能为空'),
            quantity: decimal.refine((v) => /[1-9]/.test(v), '发票转出库数量必须大于零'),
            unitPrice: decimal,
            taxRate: decimal,
            netCents: zCents.nonnegative(),
            taxCents: zCents.nonnegative(),
            totalCents: zCents.nonnegative(),
          })
          .strict(),
      )
      .min(1, '发票没有可转入的出库明细')
      .max(200),
  })
  .strict();
export const InvoiceIssuePlanSchema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.number().int().positive(),
    stockRevision: z.number().int().nonnegative(),
    shortages: z
      .array(
        z
          .object({
            warehouseId: zId,
            productCode: text.min(1),
            availableQuantity: z
              .string()
              .max(40)
              .regex(/^-?\d+(\.\d{1,6})?$/),
            requiredQuantity: z
              .string()
              .max(40)
              .regex(/^\d+(\.\d{1,6})?$/),
            shortageQuantity: z
              .string()
              .max(40)
              .regex(/^\d+(\.\d{1,6})?$/),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export const SaveInvoiceIssueSchema = z
  .object({
    input: InvoiceIssueInputSchema,
    plan: InvoiceIssuePlanSchema,
    newProductsConfirmed: z.boolean(),
    negativeStockConfirmed: z.boolean(),
    replacementConfirmed: z.boolean(),
  })
  .strict();
export type InvoiceIssueInput = z.input<typeof InvoiceIssueInputSchema>;
export type InvoiceIssuePlan = z.infer<typeof InvoiceIssuePlanSchema>;
export type SaveInvoiceIssueInput = z.input<typeof SaveInvoiceIssueSchema>;
