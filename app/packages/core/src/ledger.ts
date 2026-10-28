import { z } from 'zod';
import { DIMENSION_TYPE_IDS, type DimensionTypeId, type DimensionValues } from './dimensions';
import { zId, zPeriod } from './schemas';
import { VOUCHER_STATUSES, type VoucherStatus, type CashflowDirection } from './voucher';
import type { BalanceDirection } from './account';
import type { Cents } from './money';
import type { Period } from './period';

const zDimFilter = z
  .object(
    Object.fromEntries(DIMENSION_TYPE_IDS.map((t) => [t, zId.nullable().optional()])) as {
      [K in DimensionTypeId]: z.ZodOptional<z.ZodNullable<typeof zId>>;
    },
  )
  .default({});

/** 分录明细查询（明细账、日记账、联查用）。 */
export const EntryFilterSchema = z.object({
  periodFrom: zPeriod,
  periodTo: zPeriod,
  /** 科目编码；默认包含下级科目 */
  accountCode: z.string().optional(),
  includeChildren: z.boolean().default(true),
  accountIds: z.array(zId).optional(),
  /** 只取科目档案中与此单位完全一致的分录；在明细截页前过滤。 */
  quantityUnit: z.string().min(1).max(80).optional(),
  /** 缺省维度不筛选，显式 null 精确匹配未指定的辅助项。 */
  dimensions: zDimFilter,
  /** 指定账套本位币时同时包含未标币种（NULL）的本位币行。 */
  currency: z.string().optional(),
  /** false（默认）只看已过账；true 包含待审核、已审核 */
  includeUnposted: z.boolean().default(false),
  /** 排除 closingKind 非 NULL 的结转凭证；不按摘要或来源推测。 */
  excludeClosing: z.boolean().default(false),
  /** 按确切的 closingKind 排除；NULL 和其它标记保留。excludeClosing=true 时排除全部。 */
  excludeClosingKinds: z.array(z.string().min(1).max(80)).max(32).default([]),
  limit: z.number().int().min(1).max(200_000).default(50_000),
});
export type EntryFilter = z.input<typeof EntryFilterSchema>;

/** 每次只物化一页，行数始终覆盖全部匹配分录，不使用旧 limit 字段截断。 */
export const EntryPageSchema = EntryFilterSchema.extend({
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  pageSize: z.number().int().min(1).max(5_000).default(200),
});
export type EntryPageQuery = z.input<typeof EntryPageSchema>;
export interface EntryPage {
  rows: EntryRow[];
  rowCount: number;
  offset: number;
  pageSize: number;
  hasMore: boolean;
}

export const CashflowPageSchema = EntryPageSchema;
export type CashflowPageQuery = z.input<typeof CashflowPageSchema>;

export interface CashflowTotals {
  rowCount: number;
  cashNet: number;
  inflow: number;
  outflow: number;
  internalNet: number;
  exchangeEffect: number;
  unallocatedNet: number;
  unallocatedCount: number;
}
export interface CashflowPage {
  rows: EntryRow[];
  totals: CashflowTotals;
  internalUnbalancedVoucherCount: number;
  rowCount: number;
  offset: number;
  pageSize: number;
  hasMore: boolean;
}
export interface CashflowGroupPage {
  groups: (CashflowTotals & { cashflowId: number | null })[];
  groupCount: number;
  offset: number;
  pageSize: number;
  hasMore: boolean;
}
export interface CashflowDiagnosticPage {
  voucherIds: number[];
  voucherCount: number;
  offset: number;
  pageSize: number;
  hasMore: boolean;
}

export interface EntryRow {
  cashflowDirection?: CashflowDirection | null;
  entrySide?: 'debit' | 'credit' | null;
  voucherId: number;
  lineId: number;
  period: Period;
  date: string;
  voucherTypeCode: string;
  number: number | null;
  displayNo: string;
  status: VoucherStatus;
  lineNo: number;
  summary: string;
  accountId: number;
  accountCode: string;
  dimensions: DimensionValues;
  currency: string | null;
  exchangeRate: string | null;
  fcAmount: Cents | null;
  quantity: string | null;
  unitPrice: string | null;
  debit: Cents;
  credit: Cents;
  refNo: string | null;
  sourceModule: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  closingKind?: string | null;
}

/**
 * 余额查询（余额表、报表取数、账簿期初用）。
 * 返回整行前检查实际覆盖期间：余额从最近的已存期初锚点承接，YTD 从目标年年初
 * （首启用年从 startPeriod）累计。缺失期间明确拒绝，不视为零或推算未来余额。
 * 此项收紧旧查询行为；参数格式兼容不代表未建期间仍可查询。
 */
export const BalanceQuerySchema = z.object({
  quantityUnit: z.string().optional(),
  periodFrom: zPeriod,
  periodTo: zPeriod,
  /** 编码范围（含两端，按字符串比较），例如 { from: '1001', to: '1999' } */
  codeFrom: z.string().optional(),
  codeTo: z.string().optional(),
  /** 只要这些科目及其下级（不含它们的上级汇总行） */
  accountCodes: z.array(z.string()).optional(),
  /** 按哪些维度分组展开；不填按科目汇总 */
  groupBy: z.array(z.enum(DIMENSION_TYPE_IDS)).default([]),
  /** 维度过滤 */
  dimensions: zDimFilter,
  /** 指定本位币时包含 NULL 行；不填时汇总全部本位币金额，原币金额不混加。 */
  currency: z.string().optional(),
  includeUnposted: z.boolean().default(false),
  /** 本期发生及本年累计排除标记为结转的凭证；历史期初仍按真实账面余额。 */
  excludeClosing: z.boolean().default(false),
  /** 仅筛本期及累计发生额；历史期初不重写。 */
  excludeClosingKinds: z.array(z.string().min(1).max(80)).max(32).default([]),
  /** true 时同时返回各级上级科目的汇总行 */
  rollup: z.boolean().default(true),
  /** false（默认）去掉期初、发生、期末全为 0 的行 */
  includeZero: z.boolean().default(false),
});
export type BalanceQuery = z.input<typeof BalanceQuerySchema>;

/**
 * 余额行。所有余额都是"借正贷负"的有符号数，显示时用 balanceSide() 换算。
 * fc* 为外币金额（分），qty* 为数量（十进制字符串）。
 * 任一余额/YTD 实际覆盖期间未建立时不返回确定数值，抛期间缺失业务错误。
 */
export interface BalanceRow {
  /** Quantity rows are never aggregated across units. */
  quantityUnit?: string | null;
  accountId: number;
  accountCode: string;
  accountName: string;
  level: number;
  isLeaf: boolean;
  direction: BalanceDirection;
  dimensions: DimensionValues;
  opening: Cents;
  debit: Cents;
  credit: Cents;
  closing: Cents;
  /** 本年累计（年初到 periodTo） */
  ytdDebit: Cents;
  ytdCredit: Cents;
  fcYtdDebit?: Cents | null;
  fcYtdCredit?: Cents | null;
  qtyYtdDebit?: string | null;
  qtyYtdCredit?: string | null;
  dimensionYtdMissing?: string | null;
  fcOpening: Cents;
  fcDebit: Cents;
  fcCredit: Cents;
  fcClosing: Cents;
  qtyOpening: string;
  qtyDebit: string;
  qtyCredit: string;
  qtyClosing: string;
}

export const DEFAULT_COUNTED_STATUSES: readonly VoucherStatus[] = ['posted'];
export const UNPOSTED_COUNTED_STATUSES: readonly VoucherStatus[] = ['pending', 'audited', 'posted'];

export { VOUCHER_STATUSES };

/** Flow totals follow the requested subset; internal-balance diagnostics inspect each selected voucher in full. */
export interface CashflowSummary {
  rows: EntryRow[];
  cashNet: number;
  inflow: number;
  outflow: number;
  internalNet: number;
  /** 外币现金/银行账面折算变动，借正贷负；不是经营、投资或筹资收付。 */
  exchangeEffect: number;
  unallocatedNet: number;
  unallocatedCount: number;
  internalUnbalancedVouchers: number[];
}
