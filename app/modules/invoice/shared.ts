import { z } from 'zod';
import { DIMENSION_TYPE_IDS, zCents, zDate, zDecimal, zId, zPeriod } from '@caiwu/core';
import type { InvoiceIssuePlan } from '@caiwu/core';

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
  state: 'draft' | 'audited' | 'generated' | 'issued';
  period: number;
  batchId: number | null;
  groupId: number | null;
  voucherId: number | null;
  voucherNo: string | null;
  voucherStatus: string | null;
  issueId: number | null;
  inventoryDocumentId: number | null;
  issueNumber: string | null;
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
  settlementMode: z.enum(['unified', 'partnerName']).default('unified'),
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
export const VoucherRoleSchema = z.enum(['business', 'tax', 'settlement', 'nonDeductible']);
export type VoucherRole = z.infer<typeof VoucherRoleSchema>;
export const VoucherAllocationSchema = z.object({
  invoiceId: zId,
  role: VoucherRoleSchema,
  exchangeRate: zDecimal.max(60, '汇率长度不能超过60个字符').nullable().optional(),
  fcAmount: zCents.nullable().optional(),
  quantity: zDecimal.max(60, '数量长度不能超过60个字符').nullable().optional(),
  unitPrice: zDecimal.max(60, '单价长度不能超过60个字符').nullable().optional(),
  dimensions: DimensionsSchema.optional(),
});
export const DeletionPlanSchema = z.object({
  ids: z.array(zId).min(1).max(9999),
  expiresAt: z.number().int().positive(),
  fingerprint: z.string().length(64),
});
export const PlanSchema = z.object({
  selection: SelectionSchema,
  date: zDate,
  voucherTypeId: zId,
  mode: z.enum(['individual', 'monthly']),
  regenerate: z.boolean().optional(),
  allocations: z.array(VoucherAllocationSchema).max(800).optional(),
  firstNumber: z.number().int('凭证号必须为整数').positive('凭证号必须大于零').optional(),
  deletionPlan: DeletionPlanSchema.optional(),
});
export type PlanInput = z.infer<typeof PlanSchema>;
export const ProcessDraftSchema = z.object({
  direction: DirectionSchema,
  period: zPeriod,
  selected: z.array(zId).max(200),
  values: PlanSchema.omit({ selection: true, deletionPlan: true }).partial(),
});
export type ProcessDraft = z.infer<typeof ProcessDraftSchema>;
export const IssueProductChoiceSchema = z.object({
  lineNo: z.number().int().positive(),
  productCode: z.string().trim().min(1, '请选择产品或填写新产品编码').max(100),
  create: z.boolean().default(false),
  inventoryAccountId: zId.optional(),
  salesAccountId: zId.optional(),
  taxRate: zDecimal.max(60, '税率长度不能超过60个字符').optional(),
});
export const IssueOptionsSchema = z.object({
  invoiceId: zId,
  invoiceRevision: z.number().int().positive(),
  requestKey: z.uuid(),
  warehouseId: zId,
  date: zDate,
  number: z.string().trim().min(1, '请填写出库单号').max(100),
  settlementAccountId: zId,
  costAccountId: zId,
  regenerate: z.boolean().default(false),
  products: z.array(IssueProductChoiceSchema).min(1).max(200),
});
export type IssueOptions = z.output<typeof IssueOptionsSchema>;
export const IssueSaveSchema = z.object({
  options: IssueOptionsSchema,
  // 库存计划的定义与完整校验由共享服务提供，不在模块复制。
  plan: z.custom<InvoiceIssuePlan>(),
  fingerprint: z.string().length(64),
  newProductsConfirmed: z.boolean(),
  negativeStockConfirmed: z.boolean(),
  replacementConfirmed: z.boolean(),
});
export type IssueSave = z.infer<typeof IssueSaveSchema>;
export const IssueDraftSchema = IssueOptionsSchema.partial().extend({
  date: z.union([zDate, z.literal('')]).optional(),
  number: z.string().max(100).optional(),
  products: z
    .array(
      IssueProductChoiceSchema.partial().extend({
        productCode: z.string().max(100).optional(),
        taxRate: z.union([zDecimal, z.literal('')]).optional(),
      }),
    )
    .max(200)
    .optional(),
});
export type IssueDraft = z.infer<typeof IssueDraftSchema>;
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
