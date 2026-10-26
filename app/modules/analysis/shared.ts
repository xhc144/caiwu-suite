import { z } from 'zod';
import { zDate, zPeriod, type BalanceDirection, type DimensionValues } from '@caiwu/core';

export const BucketBoundsSchema = z
  .array(
    z
      .number({ error: '区间上限必须是整数天数' })
      .int('区间上限必须是整数天数')
      .min(0, '区间上限不能小于0天')
      .max(36500, '区间上限不能超过36500天'),
  )
  .min(1, '至少设置一个区间上限')
  .max(12, '最多设置12个区间上限')
  .refine(
    (v) => v.every((n, i) => i === 0 || n > v[i - 1]!),
    '账龄上限必须严格递增，系统自动连续衔接并补最后的无限区间',
  );
export const DEFAULT_BOUNDS = [30, 60, 90, 180, 365];
export const GroupSchema = z.enum(['partner', 'project', 'department', 'person', 'none']);
export const AgingFilterSchema = z.object({
  accountCode: z.string().trim().min(1, '请选择科目').max(40, '科目编码过长'),
  cutoff: zDate.refine((v) => Number(v.slice(0, 4)) >= 1900, '截止日期不得早于1900年'),
  direction: z.enum(['receivable', 'payable']).default('receivable'),
  groupBy: GroupSchema.default('partner'),
  includeUnposted: z.boolean().default(false),
  hideZero: z.boolean().default(true),
  bounds: BucketBoundsSchema.default(DEFAULT_BOUNDS),
});
export type AgingFilter = z.input<typeof AgingFilterSchema>;
export type AgingQuery = z.output<typeof AgingFilterSchema>;
export const TrendFilterSchema = z.object({
  accountCode: z.string().trim().min(1, '请选择科目').max(40, '科目编码过长'),
  period: zPeriod,
  mode: z.enum(['annual', 'monthly']).default('annual'),
  metric: z.enum(['debit', 'credit', 'balance']).default('debit'),
  scope: z.enum(['operating', 'ledger']).default('operating'),
  includeUnposted: z.boolean().default(false),
});
export type TrendFilter = z.input<typeof TrendFilterSchema>;
export type TrendQuery = z.output<typeof TrendFilterSchema>;
export const ShortcutSchema = z.enum([
  'finance',
  'management',
  'sales',
  'receivable',
  'payable',
  'other',
]);
export const SHORTCUT_NAMES = {
  finance: '财务费用',
  management: '管理费用',
  sales: '销售费用',
  receivable: '应收账款',
  payable: '应付账款',
  other: '其它科目',
};
export const ConfigInputSchema = z.object({
  bounds: BucketBoundsSchema,
  expectedRevision: z.number().int().nonnegative(),
});
export type AgingLot = {
  groupName?: string;
  lineId: number | null;
  voucherId: number | null;
  voucherNo: string;
  date: string | null;
  bizDate: string | null;
  amount: number;
  remaining: number;
};
export type AgingRow = {
  key: string;
  accountCode: string;
  accountName: string;
  groupId: number | null;
  groupName: string;
  dimensions: DimensionValues;
  currency: string;
  buckets: number[];
  unaged: number;
  future: number;
  reverse: number;
  closing: number;
  allocated: number;
  lots: AgingLot[];
};
export type AgingReport = {
  filter: AgingQuery;
  generatedAt: string;
  basePeriod: number;
  baseCurrency: string;
  bucketLabels: string[];
  rows: AgingRow[];
  controls: {
    key: string;
    accountCode: string;
    groupName: string;
    allocated: number;
    ledger: number;
    difference: number;
  }[];
  totals: {
    buckets: number[];
    unaged: number;
    future: number;
    reverse: number;
    closing: number;
    ledger: number;
    difference: number;
  };
};
export type TrendRow = {
  accountCode: string;
  accountName: string;
  direction: BalanceDirection;
  months: (number | null)[];
  current: number;
  ytd: number;
  average: number;
  ratio: string | null;
  ledgerCurrent: number;
  pnlAdjustment: number;
};
export type TrendReport = {
  filter: TrendQuery;
  generatedAt: string;
  startPeriod: number;
  activeMonths: number;
  denominator: number;
  rows: TrendRow[];
};
