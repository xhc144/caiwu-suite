import { z } from 'zod';
import { zCents, zDate, zId, zPeriod, DIMENSION_TYPE_IDS, BusinessError } from '@caiwu/core';

export const EnableSchema = z.object({ period: zPeriod });
export const CashAccountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  coreAccountId: zId,
  currency: z.string().min(1).max(12),
  opening: zCents,
});
export const DimensionsSchema = z.object(
  Object.fromEntries(DIMENSION_TYPE_IDS.map((key) => [key, zId.nullable().optional()])) as {
    [K in (typeof DIMENSION_TYPE_IDS)[number]]: z.ZodOptional<z.ZodNullable<typeof zId>>;
  },
);
export const DocumentSchema = z.object({
  accountId: zId,
  period: zPeriod,
  date: zDate,
  summary: z.string().trim().min(1).max(200),
  direction: z.enum(['receipt', 'payment']),
  amount: zCents.refine((v) => v > 0, '请输入大于零的收款或付款金额'),
  oppositeAccountId: zId.nullable().default(null),
  dimensions: DimensionsSchema.default({}),
  refNo: z.string().trim().max(40).default(''),
  note: z.string().trim().max(500).default(''),
});
export const DocumentCreateSchema = DocumentSchema.extend({ requestKey: z.string().uuid() });
export const DocumentFilterSchema = z
  .object({
    id: zId.optional(),
    batch: zId.optional(),
    accountId: zId.optional(),
    from: zDate.optional(),
    to: zDate.optional(),
    keyword: z.string().max(200).optional(),
    min: zCents.optional(),
    max: zCents.optional(),
    partnerId: zId.optional(),
    generated: z.enum(['all', 'yes', 'no']).default('all'),
    matched: z.enum(['all', 'yes', 'no']).default('all'),
    sort: z.enum(['date', 'amount', 'number']).default('date'),
  })
  .refine(
    (v) =>
      (!v.from || !v.to || v.from <= v.to) && (v.min == null || v.max == null || v.min <= v.max),
    '筛选起点不能大于终点',
  );
export const SelectionSchema = z
  .array(z.object({ id: zId, revision: zId }))
  .min(1)
  .max(200)
  .refine((v) => new Set(v.map((x) => x.id)).size === v.length, '不能重复选择单据');
export const GenerateSchema = z.object({
  documents: SelectionSchema,
  mode: z.enum(['individual', 'summary']),
  date: zDate,
  voucherTypeId: zId,
});
export const GenerateCommitSchema = GenerateSchema.extend({ requestKey: z.string().uuid() });
export const ReconcileFilterSchema = z.object({ accountId: zId, cutoff: zDate });
export const MatchSchema = ReconcileFilterSchema.extend({
  documents: SelectionSchema,
  lineIds: z
    .array(zId)
    .min(1)
    .max(200)
    .refine((v) => new Set(v).size === v.length, '不能重复选择分录'),
  snapshot: z.string().min(1),
  confirmed: z.literal(true),
});
export type DocumentInput = z.input<typeof DocumentSchema>;
export type DocumentFilter = z.input<typeof DocumentFilterSchema>;
export type GenerateInput = z.input<typeof GenerateSchema>;
export type MatchInput = z.input<typeof MatchSchema>;

export function safeSum(values: readonly number[]): number {
  const total = values.reduce((s, v) => s + BigInt(v), 0n);
  const n = Number(total);
  if (!Number.isSafeInteger(n))
    throw new BusinessError({
      code: 'CASHIER_AMOUNT_RANGE',
      message: '金额合计超出安全整数范围',
      hint: '请缩小查询范围后重试',
      actions: [{ label: '出纳单据', to: '/m/cashier/documents' }],
    });
  return n;
}
export const signedAmount = (row: { direction: string; amount: number }) =>
  row.direction === 'receipt' ? row.amount : -row.amount;
