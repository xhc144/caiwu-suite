import { z } from 'zod';
import {
  zCents,
  zDate,
  zDecimal,
  zId,
  zPeriod,
  DIMENSION_TYPE_IDS,
  BusinessError,
} from '@caiwu/core';

export const EnableSchema = z.object({ period: zPeriod });
export const CashAccountSchema = z.object({
  name: z.string().trim().min(1, '请填写账户名称').max(80, '账户名称不能超过80字'),
  coreAccountId: zId,
  currency: z.string().min(1).max(12),
  opening: zCents,
  foreignOpening: zCents.nullable().default(null),
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
  summary: z.string().trim().min(1, '请填写摘要').max(200, '摘要不能超过200字'),
  direction: z.enum(['receipt', 'payment']),
  amount: zCents.refine((v) => v > 0, '请输入大于零的收款或付款金额'),
  foreignAmount: zCents
    .refine((v) => v > 0, '原币金额必须大于零')
    .nullable()
    .default(null),
  exchangeRate: zDecimal
    .refine(
      (v) => v.length <= 40 && Number.isFinite(Number(v)) && Number(v) > 0,
      '汇率必须是大于零的有效数字',
    )
    .nullable()
    .default(null),
  oppositeAccountId: zId.nullable().default(null),
  dimensions: DimensionsSchema.default({}),
  refNo: z.string().trim().max(40, '票号不能超过40字').default(''),
  note: z.string().trim().max(500, '备注不能超过500字').default(''),
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
  firstNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
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

export const CheckReceiveSchema = z.object({
  accountId: zId,
  number: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .transform((s) => s.toUpperCase()),
  receivedDate: zDate,
  note: z.string().trim().max(500, '备注不能超过500字').default(''),
});
export const CheckIssueSchema = z.object({
  id: zId,
  revision: zId,
  date: zDate,
  payee: z.string().trim().min(1).max(120),
  amount: zCents.refine((n) => n > 0, '签发金额必须大于零'),
  confirmed: z.literal(true),
});

export const AutoMatchSchema = ReconcileFilterSchema.extend({
  snapshot: z.string().min(1),
  pairs: z
    .array(z.object({ documentId: zId, revision: zId, lineId: zId }))
    .min(1)
    .max(200)
    .refine(
      (pairs) =>
        new Set(pairs.map((p) => p.documentId)).size === pairs.length &&
        new Set(pairs.map((p) => p.lineId)).size === pairs.length,
      '一张单据或一条分录只能选择一次',
    ),
  confirmed: z.literal(true),
});
export function matchSuggestions<
  D extends {
    id: number;
    date: string;
    signed: number;
    foreignSigned?: number | null;
    matchId: number | null;
  },
  E extends {
    lineId: number;
    date: string;
    signed: number;
    foreignSigned?: number | null;
    matchId: number | null;
  },
>(documents: D[], entries: E[]) {
  // 本位币与原币金额共同确定匹配键；重复金额共享候选桶。
  const docs = documents
    .filter((d) => d.matchId == null)
    .toSorted((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const amountKey = (r: { signed: number; foreignSigned?: number | null }) =>
    `${r.signed}:${r.foreignSigned ?? ''}`;
  const counts = new Map<string, number>();
  for (const d of docs) counts.set(amountKey(d), (counts.get(amountKey(d)) ?? 0) + 1);
  const buckets = new Map<string, E[]>();
  for (const e of entries
    .filter((e) => e.matchId == null)
    .toSorted((a, b) => a.date.localeCompare(b.date) || a.lineId - b.lineId)) {
    const bucket = buckets.get(amountKey(e));
    if (bucket) bucket.push(e);
    else buckets.set(amountKey(e), [e]);
  }
  const empty: E[] = [];
  return docs.map((document) => {
    const candidates = buckets.get(amountKey(document)) ?? empty;
    return {
      document,
      candidates,
      unique: candidates.length === 1 && counts.get(amountKey(document)) === 1,
    };
  });
}
