import { z } from 'zod';
import {
  DIMENSION_TYPE_IDS,
  makePeriod,
  periodYear,
  zId,
  zPeriod,
  type DimensionTypeId,
} from '@caiwu/core';

export const KindSchema = z.enum([
  'detail',
  'cash',
  'bank',
  'general',
  'multi',
  'auxiliary-multi',
  'auxiliary',
  'quantity',
  'foreign',
  'quantity-foreign',
  'vat',
]);
export type LedgerKind = z.infer<typeof KindSchema>;
export const TITLES: Record<LedgerKind, string> = {
  detail: '三栏明细账',
  cash: '现金日记账',
  bank: '银行日记账',
  general: '总分类账',
  multi: '多栏账',
  'auxiliary-multi': '辅助多栏账',
  auxiliary: '辅助明细账',
  quantity: '数量金额明细账',
  foreign: '复币明细账',
  'quantity-foreign': '数量复币明细账',
  vat: '增值税明细账',
};
export const DimensionsSchema = z.strictObject(
  Object.fromEntries(DIMENSION_TYPE_IDS.map((id) => [id, zId.optional()])) as {
    [K in DimensionTypeId]: z.ZodOptional<typeof zId>;
  },
);
export const QuerySchema = z
  .object({
    kind: KindSchema.default('detail'),
    periodFrom: zPeriod,
    periodTo: zPeriod,
    account: z.string().trim().max(40).default(''),
    accountTo: z.string().trim().max(40).default(''),
    dimensions: DimensionsSchema.default({}),
    currency: z.string().trim().max(12).default(''),
    includeUnposted: z.boolean().default(false),
    includeZero: z.boolean().default(false),
    dimensionType: z.enum(DIMENSION_TYPE_IDS).default('partner'),
    multiMode: z.enum(['auto', 'custom']).default('auto'),
    valueMode: z.enum(['base', 'quantity', 'foreign', 'quantity-foreign']).default('base'),
    groupAuxiliary: z.boolean().default(false),
  })
  .refine((v) => v.periodFrom <= v.periodTo, '开始期间不能晚于结束期间');
export type LedgerQuery = z.infer<typeof QuerySchema>;
export const MultiColumnSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
  label: z.string().trim().min(1).max(60),
  accountCodes: z.array(z.string().trim().min(1).max(40)).min(1).max(500),
  side: z.enum(['debit', 'credit', 'net']).default('net'),
});
export const MultiFormatSchema = z.object({
  columns: z
    .array(MultiColumnSchema)
    .max(500)
    .refine((v) => new Set(v.map((c) => c.id)).size === v.length, '栏目编号不能重复'),
  revision: z.number().int().nonnegative(),
});
export const MultiFormatKeySchema = z.object({
  kind: z.enum(['multi', 'auxiliary-multi']),
  account: z.string().trim().min(1).max(40),
});
export const MultiFormatChangeSchema = MultiFormatKeySchema.extend({
  columns: MultiFormatSchema.shape.columns,
  expectedRevision: z.number().int().nonnegative(),
  confirmed: z.boolean(),
});
export type MultiColumn = z.infer<typeof MultiColumnSchema>;
export type LedgerDataColumn = { id: string; label: string; money: boolean };
export const COLUMN_IDS = [
  'date',
  'account',
  'summary',
  'voucherNo',
  'status',
  'dimensions',
  'currency',
  'refNo',
  'debit',
  'credit',
  'side',
  'balance',
] as const;
export type ColumnId = (typeof COLUMN_IDS)[number];
export const DEFAULT_COLUMNS: ColumnId[] = [
  'date',
  'account',
  'summary',
  'voucherNo',
  'status',
  'debit',
  'credit',
  'side',
  'balance',
];
export const GENERAL_COLUMNS: ColumnId[] = [
  'date',
  'account',
  'summary',
  'voucherNo',
  'debit',
  'credit',
  'side',
  'balance',
];
export const defaultColumns = (kind: LedgerKind) =>
  kind === 'general'
    ? GENERAL_COLUMNS
    : kind === 'auxiliary' || kind === 'auxiliary-multi'
      ? [...DEFAULT_COLUMNS.slice(0, 5), 'dimensions' as const, ...DEFAULT_COLUMNS.slice(5)]
      : kind === 'foreign' || kind === 'quantity-foreign'
        ? [...DEFAULT_COLUMNS.slice(0, 5), 'currency' as const, ...DEFAULT_COLUMNS.slice(5)]
        : DEFAULT_COLUMNS;
export const FormatSchema = z.object({
  columns: z
    .array(z.enum(COLUMN_IDS))
    .min(1)
    .max(COLUMN_IDS.length)
    .refine((v) => new Set(v).size === v.length, '显示列不能重复'),
  revision: z.number().int().nonnegative(),
});
export type LedgerFormat = z.infer<typeof FormatSchema>;
export const FormatChangeSchema = z.object({
  kind: KindSchema,
  columns: FormatSchema.shape.columns,
  expectedRevision: z.number().int().nonnegative(),
  confirmed: z.boolean(),
});
export type LedgerRow = {
  id: string;
  kind: 'opening' | 'entry' | 'day' | 'month' | 'ytd' | 'closing';
  date: string;
  account: string;
  summary: string;
  voucherNo: string;
  voucherId: number | null;
  href: string | null;
  status: string;
  dimensions: string;
  currency: string;
  refNo: string;
  debit: number | null;
  credit: number | null;
  side: string;
  balance: number | null;
  signedBalance: number | null;
  /** 独立账页身份（科目、辅助对象、币种），打印据此换账页。 */
  sectionKey?: string;
  values?: Record<string, string | number | null>;
  /** 总账只向既有明细账追溯，不将汇总行冒充凭证。 */
  detailHref?: string;
  children?: LedgerRow[];
};
export type LedgerReport = {
  query: LedgerQuery;
  rows: LedgerRow[];
  entryCount: number;
  scope: string;
  title: string;
  orgName?: string;
  dynamicColumns?: LedgerDataColumn[];
  filterDescription?: string;
};

/** 地址栏必须严格校验；不把坏 JSON、未知维度或错误布尔值默默变成全部查询。 */
export function parseLedgerUrl(raw: Record<string, string>, current: number, kind: LedgerKind) {
  try {
    const flag = z.enum(['', '0', '1', 'true', 'false']).parse(raw.includeUnposted ?? '');
    const period = (v: string | undefined) => (v ? (/^\d{6}$/.test(v) ? Number(v) : NaN) : current);
    const dimensions: unknown = JSON.parse(raw.dims || '{}');
    const parsed = QuerySchema.safeParse({
      kind,
      periodFrom: raw.from
        ? period(raw.from)
        : kind === 'general'
          ? makePeriod(periodYear(current), 1)
          : current,
      periodTo: period(raw.to),
      account: raw.account ?? '',
      accountTo: raw.accountTo ?? '',
      dimensions,
      currency: raw.currency ?? '',
      includeUnposted: flag === '1' || flag === 'true',
      includeZero:
        z.enum(['', '0', '1', 'true', 'false']).parse(raw.includeZero ?? '') === '1' ||
        raw.includeZero === 'true',
      dimensionType: raw.dimensionType || 'partner',
      multiMode: raw.multiMode || 'auto',
      valueMode: raw.valueMode || 'base',
      groupAuxiliary:
        z.enum(['', '0', '1', 'true', 'false']).parse(raw.groupAuxiliary ?? '') === '1' ||
        raw.groupAuxiliary === 'true',
    });
    return parsed.success
      ? { query: parsed.data, error: null }
      : { query: null, error: parsed.error.issues.map((i) => i.message).join('；') };
  } catch {
    return {
      query: null,
      error: '筛选地址无效：辅助核算须为数字 ID 对象，复选条件须为 0 或 1。请修正条件或重置筛选。',
    };
  }
}
