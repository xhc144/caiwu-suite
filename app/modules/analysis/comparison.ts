import { z } from 'zod';
import { zPeriod } from '@caiwu/core';

/** 对应三产品 w_fx_1：结构、比较，以及月/季/年绝对数、定基、环比。 */
export const ComparisonFilterSchema = z
  .object({
    definitionId: z.number().int().positive(),
    method: z.enum(['structure', 'comparison', 'trend']).default('trend'),
    periodFrom: zPeriod,
    periodTo: zPeriod,
    granularity: z.enum(['month', 'quarter', 'year']).default('month'),
    aggregation: z.enum(['ending', 'sum']).default('ending'),
    comparison: z.enum(['previousYear', 'specified']).default('previousYear'),
    baselinePeriod: zPeriod.optional(),
    trendMode: z.enum(['absolute', 'fixed', 'chain']).default('absolute'),
    denominatorKey: z.number().int().min(1).max(9999).optional(),
    includeUnposted: z.boolean().default(false),
    scope: z.enum(['operating', 'ledger']).default('operating'),
  })
  .refine((f) => f.periodFrom <= f.periodTo, '开始期间不能晚于结束期间')
  .refine((f) => periodIndex(f.periodTo) - periodIndex(f.periodFrom) < 36, '一次最多选择36个月')
  .refine(
    (f) => f.method !== 'comparison' || f.comparison !== 'specified' || !!f.baselinePeriod,
    '请选择指定基期',
  )
  .refine((f) => f.method !== 'structure' || !!f.denominatorKey, '请选择结构分析的基数项目');
export type ComparisonFilter = z.input<typeof ComparisonFilterSchema>;
export type ComparisonOptions = z.output<typeof ComparisonFilterSchema>;

export function periodIndex(period: number) {
  return Math.trunc(period / 100) * 12 + (period % 100) - 1;
}
export function periodAt(index: number) {
  return Math.trunc(index / 12) * 100 + (index % 12) + 1;
}
export type ComparisonColumn = {
  label: string;
  periodFrom: number;
  periodTo: number;
};
export type ComparisonCell = {
  amount: number | null;
  ratio: string | null;
  growth: string | null;
  reason: string | null;
};
export type ComparisonRow = {
  key: string;
  name: string;
  unit: 'money' | 'percent' | 'number';
  subtotal: boolean;
  decimalPlaces: 2 | 6;
  cells: ComparisonCell[];
  difference: number | null;
};
/** 精确展示缩放整数，不把六位小数数量当成两位小数金额。 */
export function comparisonValueText(value: number, decimalPlaces: 2 | 6 = 2) {
  const digits = BigInt(Math.abs(value))
    .toString()
    .padStart(decimalPlaces + 1, '0');
  return `${value < 0 ? '-' : ''}${digits.slice(0, -decimalPlaces)}.${digits.slice(-decimalPlaces)}`;
}
export type ComparisonReport = {
  title: string;
  generatedAt: string;
  definitionRevision: number;
  filter: ComparisonOptions;
  columns: ComparisonColumn[];
  rows: ComparisonRow[];
  note: string;
};
export const METHOD_NAMES = {
  structure: '结构分析',
  comparison: '比较分析',
  trend: '趋势分析',
} as const;
