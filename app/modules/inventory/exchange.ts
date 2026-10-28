import { z } from 'zod';
import { zCents, zDate, zId } from '@caiwu/core';
import { InvoiceKind, Kind, LineSchema, decimal } from './shared';

const text = z.string().trim().max(200);
export const EXCHANGE_LIMITS = { documents: 200, lines: 5000, bytes: 5 * 1024 * 1024 };
const reference = z.object({
  kind: Kind,
  warehouseCode: text.min(1),
  number: text.min(1),
});
export const ExchangeSourceSchema = z.discriminatedUnion('type', [
  reference.extend({ type: z.literal('document') }).strict(),
  z.object({ type: z.literal('contract'), number: text.min(1) }).strict(),
]);
export const ExchangeDocumentSchema = z
  .object({
    key: text.min(1, '文件内单据标识不能为空'),
    kind: Kind,
    warehouseCode: text.min(1, '仓库编码不能为空'),
    number: text.min(1, '单号不能为空'),
    date: zDate,
    category: z.enum(['采购', '其他入库', '销售', '领用', '其他出库']),
    operator: text,
    summary: text,
    accountCode: text.min(1).nullable(),
    costAccountCode: text.min(1).nullable(),
    taxRate: decimal,
    invoiceKind: InvoiceKind.optional(),
    source: ExchangeSourceSchema.nullable(),
    lines: z
      .array(
        LineSchema.extend({
          priceIncludesTax: z.boolean(),
          netCents: zCents.nonnegative(),
          taxCents: zCents.nonnegative(),
          grossCents: zCents.nonnegative(),
        }).strict(),
      )
      .min(1, '单据必须有明细')
      .max(1000),
  })
  .strict();
export const ExchangeRelationsSchema = z
  .object({
    transfers: z
      .array(
        z
          .object({
            number: text.min(1).max(180),
            issueKey: text.min(1),
            receiptKey: text.min(1),
          })
          .strict(),
      )
      .max(EXCHANGE_LIMITS.documents / 2),
    reversals: z
      .array(
        z
          .object({
            originalKey: text.min(1),
            reversalKey: text.min(1),
          })
          .strict(),
      )
      .max(EXCHANGE_LIMITS.documents / 2),
  })
  .strict();
const fileHeader = {
  format: z.literal('caiwu.inventory.documents'),
  documents: z.array(ExchangeDocumentSchema).min(1).max(EXCHANGE_LIMITS.documents),
};
export const ExchangeFileSchema = z
  .discriminatedUnion('version', [
    z.object({ ...fileHeader, version: z.literal(1) }).strict(),
    z.object({ ...fileHeader, version: z.literal(2), relations: ExchangeRelationsSchema }).strict(),
  ])
  .refine(
    (f) => f.documents.reduce((n, d) => n + d.lines.length, 0) <= EXCHANGE_LIMITS.lines,
    `单据明细合计不能超过 ${EXCHANGE_LIMITS.lines} 行`,
  );
export const ExportDocumentsSchema = z
  .object({ ids: z.array(zId).min(1).max(EXCHANGE_LIMITS.documents) })
  .strict();
export const ImportDocumentsSchema = z
  .object({
    file: z.unknown(),
    requestKey: z.string().uuid(),
    confirmation: z.string().optional(),
    allowNegative: z.boolean().default(false),
  })
  .strict();
export type ExchangeDocument = z.infer<typeof ExchangeDocumentSchema>;
export type ExchangeFile = z.infer<typeof ExchangeFileSchema>;
export type ExchangeImportInput = z.input<typeof ImportDocumentsSchema>;
export type ExchangeIssue = { document: number; line?: number; message: string };
export const exchangeIdentity = (v: {
  kind: 'receipt' | 'issue';
  warehouseCode: string;
  number: string;
}) => JSON.stringify([v.kind, v.warehouseCode, v.number]);
