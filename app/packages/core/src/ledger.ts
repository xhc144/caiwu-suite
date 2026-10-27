import { z } from 'zod';
import { DIMENSION_TYPE_IDS, type DimensionTypeId, type DimensionValues } from './dimensions';
import { zId, zPeriod } from './schemas';
import { VOUCHER_STATUSES, type VoucherStatus } from './voucher';
import type { BalanceDirection } from './account';
import type { Cents } from './money';
import type { Period } from './period';

const zDimFilter = z
  .object(
    Object.fromEntries(DIMENSION_TYPE_IDS.map((t) => [t, zId.optional()])) as {
      [K in DimensionTypeId]: z.ZodOptional<typeof zId>;
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
  dimensions: zDimFilter,
  /** 指定账套本位币时同时包含未标币种（NULL）的本位币行。 */
  currency: z.string().optional(),
  /** false（默认）只看已过账；true 包含待审核、已审核 */
  includeUnposted: z.boolean().default(false),
  limit: z.number().int().min(1).max(200_000).default(50_000),
});
export type EntryFilter = z.input<typeof EntryFilterSchema>;

export interface EntryRow {
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
}

/** 余额查询（余额表、报表取数、账簿期初用）。 */
export const BalanceQuerySchema = z.object({
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
  /** true 时同时返回各级上级科目的汇总行 */
  rollup: z.boolean().default(true),
  /** false（默认）去掉期初、发生、期末全为 0 的行 */
  includeZero: z.boolean().default(false),
});
export type BalanceQuery = z.input<typeof BalanceQuerySchema>;

/**
 * 余额行。所有余额都是"借正贷负"的有符号数，显示时用 balanceSide() 换算。
 * fc* 为外币金额（分），qty* 为数量（十进制字符串）。
 */
export interface BalanceRow {
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
