import { z } from 'zod';
import { zPeriod, type EntryRow } from '@caiwu/core';

export const CashflowQuerySchema = z.object({
  periodFrom: zPeriod.optional(),
  periodTo: zPeriod.optional(),
  codeFrom: z.string().trim().max(40).default(''),
  codeTo: z.string().trim().max(40).default(''),
  project: z.string().max(40).default(''),
  includeUnposted: z.boolean().default(false),
  allowLarge: z.boolean().default(false),
});
export type CashflowQuery = z.input<typeof CashflowQuerySchema>;
export const CashflowDisplaySchema = z.object({
  sort: z.enum(['date', 'account', 'amount']).default('date'),
  pageSize: z.union([z.literal(20), z.literal(50), z.literal(100)]).default(50),
  showAccount: z.boolean().default(true),
});
export const CashflowSettingsSchema = z.object({
  revision: z.number().int().nonnegative(),
  display: CashflowDisplaySchema,
});
export type CashflowSettings = z.infer<typeof CashflowSettingsSchema>;
export const defaultCashflowSettings: CashflowSettings = {
  revision: 0,
  display: { sort: 'date', pageSize: 50, showAccount: true },
};
export type CashflowTotals = {
  inflow: number;
  outflow: number;
  internalNet: number;
  unallocatedNet: number;
  cashNet: number;
  unallocatedCount: number;
};
export type CashflowProject = CashflowTotals & {
  key: string;
  code: string;
  name: string;
  ytd: CashflowTotals;
};
export type CashflowDetail = EntryRow & {
  sequence: number;
  accountName: string;
  projectKey: string;
  projectName: string;
  directionName: string;
  allocated: boolean;
  runningNet: number;
};
export type CashflowReport = {
  periodFrom: number;
  periodTo: number;
  ytdFrom: number;
  ytdComplete: boolean;
  orgName: string;
  baseCurrency: string;
  includeUnposted: boolean;
  scope: string;
  project: string;
  projectLabel: string;
  cashOpening: number;
  cashClosing: number;
  balanceDifference: number;
  totals: CashflowTotals;
  ytd: CashflowTotals;
  projects: CashflowProject[];
  rows: CashflowDetail[];
  internalUnbalancedVouchers: number[];
};

/** 重排只改变展示顺序；净额累计始终按会计日期、凭证及分录顺序计算。 */
export function cashflowRows(
  report: CashflowReport,
  sort: CashflowSettings['display']['sort'],
  search = '',
): CashflowDetail[] {
  const text = search.trim().toLocaleLowerCase();
  return report.rows
    .filter(
      (r) =>
        !text ||
        [r.date, r.displayNo, r.summary, r.accountCode, r.accountName, r.projectName].some((v) =>
          v.toLocaleLowerCase().includes(text),
        ),
    )
    .sort(
      (a, b) =>
        (sort === 'account'
          ? a.accountCode.localeCompare(b.accountCode)
          : sort === 'amount'
            ? b.debit - b.credit - (a.debit - a.credit)
            : 0) || a.sequence - b.sequence,
    );
}
export function cashflowCaption(report: CashflowReport): string {
  return `单位：${report.orgName}；期间：${report.periodFrom}—${report.periodTo}；本年累计起点：${report.ytdFrom}；项目明细：${report.projectLabel}；币种：${report.baseCurrency}；金额单位：元；${report.ytdComplete ? '本年累计完整' : '年中启用，本年累计仅为启用后金额'}；${report.includeUnposted ? '包含待审核、已审核、已过账，排除草稿和作废' : '仅已过账'}；${report.scope}`;
}
export const cashflowVoucherUrl = (id: number) => `/m/voucher-entry/edit?id=${id}`;
