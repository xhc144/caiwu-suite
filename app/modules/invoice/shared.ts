import { z } from 'zod';
import { DIMENSION_TYPE_IDS, zCents, zDate, zDecimal, zId, zPeriod } from '@caiwu/core';

export const DirectionSchema = z.enum(['input', 'output']);
export type Direction = z.infer<typeof DirectionSchema>;
export const LineSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  specification: z.string().max(100).default(''),
  unit: z.string().max(30).default(''),
  quantity: zDecimal.nullable().default(null),
  unitPrice: zDecimal.nullable().default(null),
  taxRate: zDecimal.nullable().default(null),
  taxMark: z.enum(['rate', 'exempt', 'unspecified']),
  amount: zCents,
  tax: zCents,
  total: zCents,
});
export const InvoiceSchema = z.strictObject({
  direction: DirectionSchema,
  code: z.string().trim().max(40).default(''),
  number: z.string().trim().min(1, '发票号码不能为空').max(80),
  date: zDate,
  confirmDate: zDate.nullable().default(null),
  sellerName: z.string().trim().min(1).max(200),
  sellerTaxId: z.string().trim().min(1, '销售方税号是去重标识，不能为空').max(80).toUpperCase(),
  buyerName: z.string().trim().min(1).max(200),
  buyerTaxId: z.string().trim().max(80).default(''),
  kind: z.string().trim().min(1).max(60),
  invoiceStatus: z.enum(['normal', 'void']).default('normal'),
  amount: zCents,
  tax: zCents,
  total: zCents,
  note: z.string().max(500).default(''),
  lines: z.array(LineSchema).max(200).default([]),
});
export type InvoiceInput = z.input<typeof InvoiceSchema>;
export type InvoiceData = z.output<typeof InvoiceSchema>;
export type Invoice = InvoiceData & {
  id: number;
  revision: number;
  state: 'draft' | 'audited' | 'generated';
  period: number;
  batchId: number | null;
  groupId: number | null;
  voucherId: number | null;
  voucherNo: string | null;
  voucherStatus: string | null;
};
export const FilterSchema = z.object({
  direction: DirectionSchema.optional(),
  id: zId.optional(),
  period: zPeriod.optional(),
  dateFrom: zDate.optional(),
  dateTo: zDate.optional(),
  partner: z.string().max(200).optional(),
  kind: z.string().max(60).optional(),
  unvouchered: z.boolean().optional(),
});
export type InvoiceFilter = z.infer<typeof FilterSchema>;
const DimensionsSchema = z.partialRecord(z.enum(DIMENSION_TYPE_IDS), zId.nullable());
export const MappingSchema = z.object({
  accountId: zId,
  dimensions: DimensionsSchema.default({}),
});
export const SettingsSchema = z.object({
  direction: DirectionSchema,
  expectedRevision: z.number().int().min(0),
  taxpayerBasis: z.enum(['general', 'small', 'other']),
  inputTaxTreatment: z.enum(['separate', 'cost']),
  business: MappingSchema,
  tax: MappingSchema,
  settlement: MappingSchema,
  nonDeductible: MappingSchema,
});
export type Settings = z.output<typeof SettingsSchema>;
export const FileSchema = z.object({
  direction: DirectionSchema,
  fileName: z.string().max(200),
  base64: z.string().min(1).max(7_000_000),
});
export type ImportFile = z.infer<typeof FileSchema>;
export const SelectionSchema = z
  .array(z.object({ id: zId, revision: z.number().int().positive() }))
  .min(1)
  .max(200);
export const PlanSchema = z.object({
  selection: SelectionSchema,
  date: zDate,
  voucherTypeId: zId,
  mode: z.enum(['individual', 'monthly']),
});
export type PlanInput = z.infer<typeof PlanSchema>;
export const VatSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  groupBy: z.enum(['month', 'quarter']).default('month'),
  includeUnposted: z.boolean().default(false),
});

export const SummarySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  direction: DirectionSchema,
  groupBy: z.enum(['month', 'quarter', 'partner']),
});
