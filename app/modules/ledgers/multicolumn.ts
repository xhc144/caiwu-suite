import { z } from 'zod';
import { zPeriod } from '@caiwu/core';

export const MULTI_MODES = {
  debit: '借方发生额',
  credit: '贷方发生额',
  net: '借减贷净额',
} as const;
export const MultiQuerySchema = z
  .strictObject({
    account: z.string().trim().min(1, '请选择一个上级科目').max(40),
    periodFrom: zPeriod,
    periodTo: zPeriod,
    includeUnposted: z.boolean().default(false),
    includeEmpty: z.boolean().default(false),
    mode: z.enum(['debit', 'credit', 'net']).default('debit'),
  })
  .refine((q) => q.periodFrom <= q.periodTo, '开始期间不能晚于结束期间');
export type MultiQuery = z.infer<typeof MultiQuerySchema>;
export type MultiColumn = { id: number; code: string; name: string };
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
