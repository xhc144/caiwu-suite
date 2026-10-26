import { z } from 'zod';
import {
  BusinessError,
  sumCents,
  centsToYuan,
  toCents,
  VoucherInputSchema,
  VoucherFilterSchema,
  zCents,
  zDate,
  zId,
  zPeriod,
} from '@caiwu/core';

/** 通用 Excel money 列会转成元数值；无损往返不了的金额改存精确文本。 */
export function reportExcelAmount(cents: number): number | string {
  const text = centsToYuan(cents);
  try {
    if (toCents(Number(text)) === cents) return cents;
  } catch {
    // 例如向上取整后超过安全整数分；同样保留文本，不能静默舍入。
  }
  return text;
}

export function reportTotals(rows: readonly { debit: number; credit: number }[]) {
  try {
    return {
      debit: sumCents(rows.map((r) => r.debit)),
      credit: sumCents(rows.map((r) => r.credit)),
    };
  } catch {
    throw new BusinessError({
      code: 'VOUCHER_BOOK_AMOUNT_RANGE',
      message: '丁字账合计超过安全整数分范围，无法准确显示或输出',
      hint: '请缩小期间、编号或金额范围后重新查询',
    });
  }
}

export const ConditionSchema = z
  .object({
    field: z.enum(['date', 'number', 'amount', 'summary', 'creator']),
    operator: z.enum(['eq', 'ne', 'gte', 'lte', 'contains', 'notContains']),
    value: z.string().min(1),
  })
  .superRefine((v, ctx) => {
    const character = v.field === 'summary' || v.field === 'creator';
    if (!character && ['contains', 'notContains'].includes(v.operator))
      ctx.addIssue({ code: 'custom', message: '非字符字段不能使用含有或不含有' });
    if (v.field === 'date' && !zDate.safeParse(v.value).success)
      ctx.addIssue({ code: 'custom', message: '日期格式应为 YYYY-MM-DD，且必须是有效日期' });
    if (
      ['number', 'amount'].includes(v.field) &&
      (!/^-?\d+$/.test(v.value) || !Number.isSafeInteger(Number(v.value)))
    )
      ctx.addIssue({ code: 'custom', message: '编号和金额（分）必须是安全整数' });
  });
export const BookFilterSchema = VoucherFilterSchema.extend({
  id: zId.optional(),
  amountFrom: zCents.optional(),
  amountTo: zCents.optional(),
  conditions: z.array(ConditionSchema).max(20).default([]),
  limit: z.number().int().min(1).max(200).default(30),
}).superRefine((f, ctx) => {
  for (const [a, b] of [
    [f.periodFrom, f.periodTo],
    [f.dateFrom, f.dateTo],
    [f.numberFrom, f.numberTo],
    [f.amountFrom, f.amountTo],
  ] as const)
    if (a != null && b != null && a > b)
      ctx.addIssue({ code: 'custom', message: '范围起点不能大于终点' });
});
export type BookFilter = z.input<typeof BookFilterSchema>;
export const SelectionSchema = z
  .object({
    ids: z.array(zId).max(10000).optional(),
    filter: BookFilterSchema.optional(),
  })
  .refine((v) => (v.ids != null) !== (v.filter != null), '请选择凭证或使用查询范围');
export type Selection = z.input<typeof SelectionSchema>;
export const ActionSchema = z.enum(
  [
    'audit',
    'unaudit',
    'delete',
    'void',
    'unvoid',
    'copy',
    'reverse',
    'insert',
    'renumber',
    'modify',
  ],
  { error: '请选择审核、取消审核或其它操作模式' },
);
export type Action = z.infer<typeof ActionSchema>;
export const PreviewSchema = z.object({
  action: ActionSchema,
  selection: SelectionSchema,
  date: zDate.optional(),
  voucherTypeId: zId.optional(),
  period: zPeriod.optional(),
  byDate: z.boolean().default(false),
  compactAfter: z.boolean().default(false),
  change: z
    .object({
      field: z.enum(['date', 'type']),
      date: zDate.optional(),
      voucherTypeId: zId.optional(),
      keepDay: z.boolean().default(false),
    })
    .optional(),
  input: VoucherInputSchema.omit({
    source: true,
    closingKind: true,
    reversalOfId: true,
    draft: true,
    number: true,
  }).optional(),
});
export type PreviewInput = z.input<typeof PreviewSchema>;
export type PreviewRow = {
  id: number;
  revision: number;
  label: string;
  eligible: boolean;
  reasons: string[];
  warnings: string[];
  sourceUrl: string | null;
  periodUrl: string;
};
export type NumberMapping = { id: number; from: number; to: number; label: string };
export type Preview = {
  token: string;
  action: Action;
  rows: PreviewRow[];
  mappings: NumberMapping[];
  warnings: string[];
  eligibleCount: number;
  skippedCount: number;
  generatedDebit: number | null;
};
export const CommitSchema = z.object({
  token: z.string().uuid(),
  confirmed: z.literal(true, { error: '请明确确认操作后再提交' }),
  cashflowConfirmed: z.boolean().default(false),
  numberingConfirmed: z.boolean().default(false),
  overwriteConfirmed: z.boolean().default(false),
});
export type CommitInput = z.input<typeof CommitSchema>;
export type ActionResult = {
  successCount: number;
  skippedCount: number;
  createdIds: number[];
  message: string;
  /** 旧版已提交预览可能只有汇总；新提交保存执行时的逐凭证结果。 */
  rows?: ActionResultRow[];
};
export type ActionResultRow = {
  key: string;
  label: string;
  outcome: 'success' | 'skipped';
  reasons: string[];
  voucherId: number | null;
  voucherLabel: string | null;
  status: string;
};
export const SummarySchema = z.object({
  filter: BookFilterSchema,
  level: z.enum(['root', 'leaf']).default('leaf'),
  foreign: z.boolean().default(false),
});
export type SummaryInput = z.input<typeof SummarySchema>;
export const TransferLineSchema = z.object({
  summary: z.string(),
  account: z.string().min(1),
  dimensions: z.record(z.string(), z.string()).default({}),
  currency: z.string().nullable().optional(),
  exchangeRate: z.string().nullable().optional(),
  fcAmount: zCents.nullable().optional(),
  quantity: z.string().nullable().optional(),
  unitPrice: z.string().nullable().optional(),
  debit: zCents,
  credit: zCents,
  settlement: z.string().nullable().optional(),
  refNo: z.string().nullable().optional(),
  bizDate: z.string().nullable().optional(),
});
export const TransferVoucherSchema = z.object({
  key: z.string().min(1),
  date: z.string(),
  type: z.string(),
  number: z.number().int().nullable(),
  attachments: z.number().int().min(0),
  note: z.string().nullable().optional(),
  lines: z.array(TransferLineSchema).max(999),
});
export const TransferSchema = z
  .object({
    format: z.literal('caiwu-voucher-book'),
    version: z.literal(1),
    vouchers: z.array(TransferVoucherSchema).min(1).max(10000),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    for (const [i, v] of data.vouchers.entries()) {
      if (seen.has(v.key))
        ctx.addIssue({
          code: 'custom',
          path: ['vouchers', i, 'key'],
          message: `凭证分组 ${v.key} 重复，请为每张凭证使用唯一分组`,
        });
      seen.add(v.key);
    }
  });
export type Transfer = z.infer<typeof TransferSchema>;
export const ImportSchema = z.object({
  file: z.string().min(1, '请选择文件').max(20_000_000),
  format: z.enum(['json', 'xlsx']),
  mapping: z.record(z.string(), z.string()).default({}),
  from: z.number().int().min(1).default(1),
  to: z.number().int().min(1).optional(),
  targetDate: zDate.optional(),
  voucherTypeId: zId.optional(),
  keepDay: z.boolean().default(false),
  numbering: z.enum(['auto', 'original', 'start']).default('auto'),
  start: z.number().int().min(1).max(10000).optional(),
  onlyValid: z.boolean().default(false),
  overwritePending: z.boolean().default(false),
});
export type ImportInput = z.input<typeof ImportSchema>;

export const TRANSFER_FIELD_LABELS: Record<string, string> = {
  key: '凭证分组',
  date: '凭证日期',
  type: '凭证类型',
  number: '凭证编号',
  attachments: '附单数',
  note: '凭证备注',
  line: '行号',
  summary: '摘要',
  account: '科目编码',
  project: '项目编码',
  partner: '客供编码',
  department: '部门编码',
  person: '个人编码',
  cashflow: '现金流量编码',
  currency: '币种',
  exchangeRate: '汇率',
  fcAmount: '原币金额（分）',
  quantity: '数量',
  unitPrice: '单价',
  debit: '借方（分）',
  credit: '贷方（分）',
  settlement: '结算方式编码',
  refNo: '票号',
  bizDate: '业务日期',
};
