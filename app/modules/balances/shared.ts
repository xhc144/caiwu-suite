import { z } from 'zod';
import {
  BusinessError,
  balanceSide,
  formatMoney,
  zId,
  zPeriod,
  type BalanceRow,
  type DimensionValues,
} from '@caiwu/core';

export const DimensionsSchema = z.strictObject({
  project: zId.optional(),
  partner: zId.optional(),
  department: zId.optional(),
  person: zId.optional(),
});

export function parseDimensions(text: string): z.infer<typeof DimensionsSchema> {
  try {
    return DimensionsSchema.parse(JSON.parse(text || '{}'));
  } catch {
    throw new BusinessError({
      code: 'BALANCES_DIMENSIONS_INVALID',
      message: '辅助项条件无效：需要项目、客供、部门或个人的数字 ID',
      hint: '清除地址中的 dims 条件后重新查询，不能用辅助项编码代替 ID',
      actions: [{ label: '清除条件', to: '/m/balances' }],
    });
  }
}

export const QuerySchema = z.object({
  mode: z.enum(['summary', 'foreign', 'quantity']).default('summary'),
  dimension: z
    .enum(['', 'project', 'partner', 'department', 'person'], {
      error: '辅助核算类型无效，请重新选择项目、客供、部门或个人',
    })
    .default(''),
  dimensionFrom: z.string().trim().max(40).default(''),
  dimensionTo: z.string().trim().max(40).default(''),
  periodFrom: zPeriod.optional(),
  periodTo: zPeriod.optional(),
  codeFrom: z.string().trim().max(40).default(''),
  codeTo: z.string().trim().max(40).default(''),
  currency: z.string().max(10).default(''),
  dims: z.string().max(1000).default('{}'),
  includeUnposted: z.boolean().default(false),
  onlyActivity: z.boolean().default(false),
});
export type QueryInput = z.input<typeof QuerySchema>;
export const DisplaySchema = z.object({
  level: z.number().int().min(-1).max(20).default(1),
  onlyActivity: z.boolean().default(false),
});
export const SettingsSchema = z.object({
  revision: z.number().int().nonnegative(),
  display: DisplaySchema,
});
export type DisplaySettings = z.infer<typeof DisplaySchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export const defaultSettings: Settings = {
  revision: 0,
  display: { level: 1, onlyActivity: false },
};

export type ReportRow = BalanceRow & { parentId: number | null };
export type Totals = {
  openingDebit: number;
  openingCredit: number;
  closingDebit: number;
  closingCredit: number;
  debit: number;
  credit: number;
  ytdDebit: number;
  ytdCredit: number;
  fcOpening: number;
  fcDebit: number;
  fcCredit: number;
  fcClosing: number;
};
export const quantityKeys = ['qtyOpening', 'qtyDebit', 'qtyCredit', 'qtyClosing'] as const;
export type QuantityTotals = Record<(typeof quantityKeys)[number], string>;
export type ReportGroup = {
  currency: string;
  rows: ReportRow[];
  totals: Totals;
  unit?: string;
  quantityTotals?: QuantityTotals;
  dimension?: { type: string; id: number | null; code: string; name: string };
};
export type Report = {
  periodFrom: number;
  periodTo: number;
  orgName: string;
  baseCurrency: string;
  groups: ReportGroup[];
  dimensions: DimensionValues;
  includeUnposted: boolean;
  mode: 'summary' | 'foreign' | 'quantity';
  auxiliary?: boolean;
  scope: string;
};

/** 显示只改变行集合，不参与业务合计。用实际 parentId 遍历，不解释编码。 */
export function visibleRows(rows: ReportRow[], level: number, expanded: number[]): ReportRow[] {
  if (level === -1) return rows.filter((r) => r.isLeaf);
  const byId = new Map(rows.map((r) => [r.accountId, r]));
  const children = new Map<number | null, ReportRow[]>();
  for (const row of rows) {
    const parent = row.parentId != null && byId.has(row.parentId) ? row.parentId : null;
    const list = children.get(parent) ?? [];
    list.push(row);
    children.set(parent, list);
  }
  const out: ReportRow[] = [];
  const visit = (parent: number | null) => {
    for (const row of children.get(parent) ?? []) {
      // 范围根行始终可见：选择一个二级/末级科目时，默认一级也不能变成空表。
      if (parent != null && level > 0 && row.level > level) continue;
      out.push(row);
      if (expanded.includes(row.accountId)) visit(row.accountId);
    }
  };
  visit(null);
  return out;
}

export function detailUrl(report: Report, row: ReportRow, currency: string): string {
  const dims = Object.fromEntries(
    Object.entries({ ...report.dimensions, ...row.dimensions }).filter(([, v]) => v != null),
  );
  const params = new URLSearchParams({
    account: row.accountCode,
    from: String(report.periodFrom),
    to: String(report.periodTo),
    dims: JSON.stringify(dims),
    includeUnposted: report.includeUnposted ? '1' : '0',
    currency,
  });
  return `/m/ledgers/detail?${params}`;
}

export function balanceDisplay(value: number, row: Pick<BalanceRow, 'direction'>) {
  const side = balanceSide(value, row.direction);
  return { ...side, reverse: value !== 0 && value > 0 !== (row.direction === 'debit') };
}

export function reportCaption(report: Report, currency: string): string {
  return `单位：${report.orgName}；期间：${report.periodFrom}—${report.periodTo}；币种：${currency || '全部（仅汇总本位币）'}；本位币：${report.baseCurrency}；金额单位：元；${report.includeUnposted ? '含待审核、已审核、已过账（排除草稿、作废）' : '仅已过账'}；${report.scope}；辅助条件：${JSON.stringify(report.dimensions)}`;
}

export function reportTitle(report: Pick<Report, 'mode' | 'auxiliary'>): string {
  return `${report.auxiliary ? '辅助' : ''}${report.mode === 'foreign' ? '外币' : report.mode === 'quantity' ? '数量' : report.auxiliary ? '' : '汇总'}余额表`;
}

export function groupCaption(group: ReportGroup): string {
  return [
    group.unit != null ? `数量单位：${group.unit}（不同单位不合计）` : '',
    group.dimension
      ? `辅助类型：${({ project: '项目', partner: '客户/供应商', department: '部门', person: '个人' } as Record<string, string>)[group.dimension.type] ?? group.dimension.type}；辅助项：${group.dimension.code} ${group.dimension.name}`
      : '',
  ]
    .filter(Boolean)
    .join('；');
}

export type OutputRow = {
  key: string;
  source?: ReportRow;
  code: string;
  name: string;
  openingSide: string;
  opening: number | string;
  debit: number;
  credit: number;
  ytdDebit: number;
  ytdCredit: number;
  closingSide: string;
  closing: number | string;
  fcOpening: number;
  fcDebit: number;
  fcCredit: number;
  fcClosing: number;
  qtyOpening?: string;
  qtyDebit?: string;
  qtyCredit?: string;
  qtyClosing?: string;
};

/** 页、Excel、打印使用相同的行和列值。合计的余额保留借、贷两边。 */
export function outputRows(group: ReportGroup, level: number, expanded: number[]): OutputRow[] {
  const rows: OutputRow[] = visibleRows(group.rows, level, expanded).map((r) => ({
    key: String(r.accountId),
    source: r,
    code: r.accountCode,
    name: r.accountName,
    openingSide: balanceDisplay(r.opening, r).side,
    opening: balanceDisplay(r.opening, r).amount,
    debit: r.debit,
    credit: r.credit,
    ytdDebit: r.ytdDebit,
    ytdCredit: r.ytdCredit,
    closingSide: balanceDisplay(r.closing, r).side,
    closing: balanceDisplay(r.closing, r).amount,
    fcOpening: r.fcOpening,
    fcDebit: r.fcDebit,
    fcCredit: r.fcCredit,
    fcClosing: r.fcClosing,
    ...(group.quantityTotals ? Object.fromEntries(quantityKeys.map((key) => [key, r[key]])) : {}),
  }));
  const t = group.totals;
  rows.push({
    key: 'total',
    code: '合计',
    name: '范围内末级各计一次（不受级次、展开、只发生额影响）',
    openingSide: '借 / 贷',
    opening: `${formatMoney(t.openingDebit)} / ${formatMoney(t.openingCredit)}`,
    closingSide: '借 / 贷',
    closing: `${formatMoney(t.closingDebit)} / ${formatMoney(t.closingCredit)}`,
    ...t,
    ...group.quantityTotals,
  });
  return rows;
}
