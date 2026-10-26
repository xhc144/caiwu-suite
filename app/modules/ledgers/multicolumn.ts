import { z } from 'zod';
import { zPeriod } from '@caiwu/core';
import { DimensionsSchema } from './shared';

export const MULTI_MODES = {
  debit: '借方发生额',
  credit: '贷方发生额',
  net: '借减贷净额',
} as const;
export const MultiColumnDefinitionSchema = z.strictObject({
  name: z.string().trim().min(1, '请填写栏目名称').max(60),
  accountCodes: z.array(z.string().trim().min(1).max(40)).min(1, '每栏至少选择一个科目').max(500),
  mode: z.enum(['debit', 'credit', 'net']),
});
export type MultiColumnDefinition = z.infer<typeof MultiColumnDefinitionSchema>;
export const MultiColumnsSchema = z
  .array(MultiColumnDefinitionSchema)
  .min(1)
  .max(500)
  .refine((v) => new Set(v.map((c) => c.name)).size === v.length, '栏目名称不能重复');
export const MultiFormatSchema = z.object({
  columns: MultiColumnsSchema.nullable(),
  revision: z.number().int().nonnegative(),
});
export type MultiFormat = z.infer<typeof MultiFormatSchema>;
export const MultiFormatChangeSchema = z.strictObject({
  account: z.string().trim().min(1).max(40),
  columns: MultiColumnsSchema.nullable(),
  expectedRevision: z.number().int().nonnegative(),
  confirmed: z.boolean(),
});
export const MultiQuerySchema = z
  .strictObject({
    account: z.string().trim().min(1, '请选择一个上级科目').max(40),
    periodFrom: zPeriod,
    periodTo: zPeriod,
    includeUnposted: z.boolean().default(false),
    includeEmpty: z.boolean().default(false),
    mode: z.enum(['debit', 'credit', 'net']).default('debit'),
    columns: MultiColumnsSchema.optional(),
    dimensions: DimensionsSchema.optional(),
  })
  .refine((q) => q.periodFrom <= q.periodTo, '开始期间不能晚于结束期间');
export type MultiQuery = z.infer<typeof MultiQuerySchema>;
export type MultiColumn = {
  id: number;
  code: string;
  name: string;
  mode?: MultiQuery['mode'];
  accountCodes?: string[];
};
export type MultiRow = {
  id: string;
  kind: 'opening' | 'entry' | 'month' | 'ytd' | 'closing' | 'unknown';
  date: string;
  period: number;
  summary: string;
  voucherNo: string;
  href: string | null;
  status: string;
  debit: number | null;
  credit: number | null;
  side: string;
  balance: number | null;
  signedBalance: number | null;
  values: Record<string, number | null>;
};
export type MultiReport = {
  query: MultiQuery;
  accountName: string;
  orgName: string;
  startPeriod: number;
  scope: string;
  columns: MultiColumn[];
  rows: MultiRow[];
  entryCount: number;
};

export function parseMultiUrl(raw: Record<string, string | undefined>, current: number) {
  try {
    if (['currency', 'dims', 'accountTo'].some((k) => raw[k]))
      return {
        query: null,
        error: '自动多栏账暂不支持币种、辅助项或科目范围筛选，请移除这些地址参数。',
      };
    const flag = (v: string | undefined) => {
      const f = z.enum(['', '0', '1', 'true', 'false']).parse(v ?? '');
      return f === '1' || f === 'true';
    };
    const period = (s: string | undefined) => (s ? (/^\d{6}$/.test(s) ? Number(s) : NaN) : current);
    const result = MultiQuerySchema.safeParse({
      account: raw.account ?? '',
      periodFrom: period(raw.from),
      periodTo: period(raw.to),
      mode: raw.mode || 'debit',
      includeEmpty: flag(raw.includeEmpty),
      includeUnposted: flag(raw.includeUnposted),
      columns: raw.columns ? JSON.parse(raw.columns) : undefined,
      dimensions: raw.aux ? JSON.parse(raw.aux) : undefined,
    });
    return result.success
      ? { query: result.data, error: null }
      : { query: null, error: result.error.issues.map((i) => i.message).join('；') };
  } catch {
    return {
      query: null,
      error: '筛选地址无效：布尔条件须为0或1，期间须为六位年月。请重置或修正条件。',
    };
  }
}
