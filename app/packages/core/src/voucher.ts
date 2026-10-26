import { z } from 'zod';
import { DIMENSION_TYPE_IDS, type DimensionValues } from './dimensions';
import { zCents, zDate, zDecimal, zId, zPeriod } from './schemas';
import type { Cents } from './money';
import type { Period } from './period';

/**
 * 凭证状态：
 * - draft 草稿：随时保存，不校验借贷平衡，没有编号，不进任何账表
 * - pending 待审核：已校验，有编号，可以选择"含未过账"进账表
 * - audited 已审核
 * - posted 已过账：进正式账表
 * 作废是单独的 voided 标记，作废凭证保留编号但不进账表。
 */
export const VOUCHER_STATUSES = ['draft', 'pending', 'audited', 'posted'] as const;
export type VoucherStatus = (typeof VOUCHER_STATUSES)[number];

export const VOUCHER_STATUS_LABELS: Record<VoucherStatus, string> = {
  draft: '草稿',
  pending: '待审核',
  audited: '已审核',
  posted: '已过账',
};

/** 允许的状态变更。审核、过账的业务规则由对应模块检查，core 只管这张表。 */
export const VOUCHER_TRANSITIONS: Record<VoucherStatus, readonly VoucherStatus[]> = {
  draft: ['pending'],
  pending: ['audited', 'draft'],
  audited: ['posted', 'pending'],
  posted: ['audited'],
};

const zDimensionValues = z
  .object(
    Object.fromEntries(DIMENSION_TYPE_IDS.map((t) => [t, zId.nullable().optional()])) as {
      [K in (typeof DIMENSION_TYPE_IDS)[number]]: z.ZodOptional<z.ZodNullable<typeof zId>>;
    },
  )
  .default({});

export const VoucherLineInputSchema = z.object({
  summary: z.string().trim().max(200).default(''),
  /** 草稿里允许没选科目的行（保存草稿时会丢弃这些行）；正式保存必须有 */
  accountId: zId.nullable().optional(),
  dimensions: zDimensionValues,
  currency: z.string().nullable().optional(),
  exchangeRate: zDecimal.nullable().optional(),
  /** 外币金额（分） */
  fcAmount: zCents.nullable().optional(),
  quantity: zDecimal.nullable().optional(),
  unitPrice: zDecimal.nullable().optional(),
  debit: zCents.default(0),
  credit: zCents.default(0),
  settlementMethodId: zId.nullable().optional(),
  /** 票号（银行单号、支票号） */
  refNo: z.string().trim().max(40).nullable().optional(),
  /** 业务日期（往来账龄用），默认凭证日期 */
  bizDate: zDate.nullable().optional(),
});

export const VoucherInputSchema = z.object({
  voucherTypeId: zId,
  /** 凭证日期，决定所属期间 */
  date: zDate,
  /** 不填自动取该期间该类型的下一个编号；草稿没有编号 */
  number: z.number().int().positive().nullable().optional(),
  attachments: z.number().int().min(0).max(9999).default(0),
  note: z.string().max(500).nullable().optional(),
  lines: z.array(VoucherLineInputSchema).max(999),
  /** true 存为草稿（不校验平衡、不分配编号） */
  draft: z.boolean().default(false),
  /** 由业务模块生成时填写来源单据；手工凭证不填。 */
  source: z.object({ type: z.string().min(1), id: z.string().min(1) }).optional(),
  /** 结转凭证标记，例如 "pnl"（损益结转），由期末处理模块使用 */
  closingKind: z.string().nullable().optional(),
  /** 红字冲销：被冲销的原凭证 id */
  reversalOfId: zId.nullable().optional(),
});

export type VoucherLineInput = z.input<typeof VoucherLineInputSchema>;
export type VoucherInput = z.input<typeof VoucherInputSchema>;

export interface VoucherUserRef {
  id: number;
  name: string;
}

export interface VoucherLine {
  id: number;
  lineNo: number;
  summary: string;
  accountId: number;
  accountCode: string;
  accountName: string;
  dimensions: DimensionValues;
  currency: string | null;
  exchangeRate: string | null;
  fcAmount: Cents | null;
  quantity: string | null;
  unitPrice: string | null;
  debit: Cents;
  credit: Cents;
  settlementMethodId: number | null;
  refNo: string | null;
  bizDate: string | null;
}

export interface VoucherHeader {
  id: number;
  period: Period;
  voucherTypeId: number;
  voucherTypeCode: string;
  number: number | null;
  /** 显示用凭证字号："记-0012"；草稿为 "记-草稿" */
  displayNo: string;
  date: string;
  attachments: number;
  status: VoucherStatus;
  voided: boolean;
  reversalOfId: number | null;
  source: { module: string; type: string; id: string } | null;
  closingKind: string | null;
  note: string | null;
  debitTotal: Cents;
  creditTotal: Cents;
  /** 第一条分录的摘要 */
  summary: string;
  createdBy: VoucherUserRef;
  createdAt: string;
  updatedAt: string;
  auditedBy: VoucherUserRef | null;
  auditedAt: string | null;
  postedBy: VoucherUserRef | null;
  postedAt: string | null;
  /** 每次修改 +1，更新时要带上（乐观锁） */
  revision: number;
}

export interface Voucher extends VoucherHeader {
  lines: VoucherLine[];
}

export const VoucherFilterSchema = z.object({
  periodFrom: zPeriod.optional(),
  periodTo: zPeriod.optional(),
  dateFrom: zDate.optional(),
  dateTo: zDate.optional(),
  statuses: z.array(z.enum(VOUCHER_STATUSES)).optional(),
  voucherTypeId: zId.optional(),
  numberFrom: z.number().int().optional(),
  numberTo: z.number().int().optional(),
  /** 含有该科目（含下级）分录的凭证 */
  accountCode: z.string().optional(),
  summaryContains: z.string().optional(),
  createdBy: zId.optional(),
  sourceModule: z.string().optional(),
  sourceType: z.string().optional(),
  sourceId: z.string().optional(),
  includeVoided: z.boolean().default(false),
  limit: z.number().int().min(1).max(10000).default(500),
  offset: z.number().int().min(0).default(0),
});
export type VoucherFilter = z.input<typeof VoucherFilterSchema>;

export function formatVoucherNo(typeCode: string, number: number | null): string {
  return number == null ? `${typeCode}-草稿` : `${typeCode}-${String(number).padStart(4, '0')}`;
}
