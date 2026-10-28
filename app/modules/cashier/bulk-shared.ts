import { z } from 'zod';
import { DIMENSION_TYPE_IDS, zId } from '@caiwu/core';
import { DimensionsSchema, DocumentFilterSchema } from './shared';

export const BulkDeleteSchema = z
  .object({
    selection: z
      .array(z.object({ id: zId, revision: zId }))
      .min(1)
      .max(2000)
      .refine((rows) => new Set(rows.map((r) => r.id)).size === rows.length, '不能重复选择单据')
      .optional(),
    filter: DocumentFilterSchema.optional(),
  })
  .refine((v) => !!v.selection !== !!v.filter, '请选择已选单据或日期范围中的一种删除方式')
  .refine((v) => !v.filter || (!!v.filter.from && !!v.filter.to), '范围删除必须填写起止日期');
export const BulkDeleteCommitSchema = z.object({
  previewToken: z.string().min(1).max(1000000),
  rangeConfirmed: z.literal('已核对范围'),
  deleteConfirmed: z.literal('删除'),
});

export const IMPORT_FIELDS = [
  ['account', '出纳账户'],
  ['currency', '币种'],
  ['date', '日期'],
  ['summary', '摘要'],
  ['receipt', '收款金额'],
  ['payment', '付款金额'],
  ['amount', '金额'],
  ['direction', '收付方向'],
  ['oppositeAccount', '对方科目编码'],
  ['foreignAmount', '原币金额'],
  ['exchangeRate', '汇率'],
  ['refNo', '票号'],
  ['note', '说明'],
  ...DIMENSION_TYPE_IDS.map((id) => [id, id] as const),
] as const;
export const ImportMappingSchema = z.partialRecord(
  z.enum(IMPORT_FIELDS.map(([id]) => id)),
  z.number().int().min(0).max(59).optional(),
);
export const ImportSchema = z.object({
  requestKey: z.string().uuid(),
  fileName: z.string().trim().min(1).max(200),
  rows: z
    .array(z.array(z.string().max(2000)).max(60))
    .min(1)
    .max(1000),
  mapping: ImportMappingSchema,
  defaultAccountId: zId.optional(),
  defaultDimensions: DimensionsSchema.default({}),
});
export const ImportCommitSchema = ImportSchema.extend({
  previewToken: z.string().min(1).max(2000),
  confirmed: z.literal(true),
});
export type BulkDeleteInput = z.input<typeof BulkDeleteSchema>;
export type ImportInput = z.input<typeof ImportSchema>;
export type ImportMapping = z.infer<typeof ImportMappingSchema>;
