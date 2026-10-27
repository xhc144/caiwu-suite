import { z } from 'zod';
import {
  Decimal,
  VoucherInputSchema,
  VoucherLineInputSchema,
  isValidDate,
  parseMoney,
  qtyFromE6,
  qtyToE6,
  periodOfDate,
  zDate,
  convertCurrency,
  multiplyToCents,
  BusinessError,
  type VoucherLineInput,
} from '@caiwu/core';

export function isEntryDate(value: string): boolean {
  try {
    periodOfDate(value);
    return true;
  } catch {
    return false;
  }
}

// 手工入口拒绝来源、结转和反冲字段，不能通过丢弃 source 绕过来源保护。
export const EntrySchema = VoucherInputSchema.omit({
  source: true,
  closingKind: true,
  reversalOfId: true,
})
  .extend({
    date: zDate.refine((value) => {
      try {
        periodOfDate(value);
        return true;
      } catch {
        return false;
      }
    }, '日期不在核心支持的会计期间范围内'),
  })
  .strict();
export type Entry = z.input<typeof EntrySchema>;
export const SaveSchema = z.object({
  key: z.string().min(1).max(100),
  id: z.number().int().positive().optional(),
  expectedRevision: z.number().int().positive().optional(),
  bufferRevision: z.number().int().nonnegative().default(0),
  data: EntrySchema,
  confirmFuture: z.boolean().default(false),
  confirmNumberChange: z.boolean().default(false),
  acknowledgeCashflowUnknown: z.boolean().default(false),
});
export type SaveInput = z.input<typeof SaveSchema>;
export const TemplateSchema = z
  .object({
    id: z.number().int().positive().optional(),
    revision: z.number().int().positive().optional(),
    code: z.string().trim().min(1, '请输入模版编码').max(4, '模版编码最多 4 位'),
    name: z.string().trim().min(1, '请输入模版名称').max(80),
    voucherTypeId: z.number().int().positive(),
    lines: z.array(VoucherLineInputSchema).min(2).max(999),
    acknowledgeCashflowUnknown: z.boolean().default(false),
  })
  .strict();
export type TemplateInput = z.input<typeof TemplateSchema>;
export const CashflowDirectionSchema = z.enum(['inflow', 'outflow', 'internal']);
export type Problem = { line: number; field: string; message: string };
export const blankLine = (): VoucherLineInput => ({
  summary: '',
  accountId: null,
  dimensions: {},
  debit: 0,
  credit: 0,
});

export function monthDistance(date: string, today: string): number {
  if (!isValidDate(date) || !isValidDate(today)) throw new Error('请输入真实的 YYYY-MM-DD 日期');
  return (
    (Number(date.slice(0, 4)) - Number(today.slice(0, 4))) * 12 +
    Number(date.slice(5, 7)) -
    Number(today.slice(5, 7))
  );
}

/** 只改变当前借/贷金额格，其它格（含同一行对侧）保持原样。 */
export function balanceCell(
  lines: readonly VoucherLineInput[],
  index: number,
  side: 'debit' | 'credit',
) {
  const result = lines.map((line) => ({ ...line }));
  const current = result[index];
  if (!current) return result;
  const other = lines.reduce(
    (sum, line, i) =>
      sum
        .plus(i === index && side === 'debit' ? 0 : (line.debit ?? 0))
        .minus(i === index && side === 'credit' ? 0 : (line.credit ?? 0)),
    new Decimal(0),
  );
  const amount = (side === 'debit' ? other.negated() : other).toNumber();
  if (!Number.isSafeInteger(amount))
    throw new BusinessError({
      code: 'ENTRY_AMOUNT_RANGE',
      message: '找平金额超出安全整数分范围',
      hint: '请核对其它行的金额',
    });
  current[side] = amount === 0 ? 0 : amount;
  return result;
}

export function quantityAmount(quantity: string, price: string): number {
  const cents = multiplyToCents(qtyFromE6(qtyToE6(quantity)), price);
  return cents === 0 ? 0 : cents;
}
export function foreignAmount(cents: number, rate: string): number {
  const amount = convertCurrency(cents, rate);
  return amount === 0 ? 0 : amount;
}

export const pasteFields = [
  'summary',
  'account',
  'debit',
  'credit',
  'project',
  'partner',
  'department',
  'person',
  'cashflow',
  'currency',
  'exchangeRate',
  'fcAmount',
  'quantity',
  'unitPrice',
  'refNo',
  'bizDate',
] as const;
export type PasteField = (typeof pasteFields)[number];
export const pasteLabels: Record<PasteField, string> = {
  summary: '摘要',
  account: '科目编码',
  debit: '借方',
  credit: '贷方',
  project: '项目编码',
  partner: '客供编码',
  department: '部门编码',
  person: '个人编码',
  cashflow: '现金流量编码',
  currency: '币种',
  exchangeRate: '汇率',
  fcAmount: '原币金额',
  quantity: '数量',
  unitPrice: '单价',
  refNo: '票号',
  bizDate: '业务日期',
};
export function parsePaste(text: string, mapping: readonly (PasteField | '')[]) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.trim())
    .slice(0, 1000)
    .map((line, index) => {
      const values: Partial<Record<PasteField, string>> = {};
      const errors: string[] = [];
      const cells = line.split('\t');
      const fields = mapping.slice(0, cells.length).filter(Boolean);
      if (new Set(fields).size !== fields.length) errors.push('同一字段不能映射多列，请调整映射');
      cells.forEach((cell, col) => {
        const field = mapping[col];
        if (field) values[field] = cell.trim();
      });
      if (!values.account) errors.push('科目编码不能为空');
      if (!values.summary) errors.push('摘要不能为空');
      const amounts: Record<string, number> = {};
      for (const field of ['debit', 'credit', 'fcAmount'] as const) {
        const value = values[field];
        let cents: number | null = null;
        try {
          cents = value ? parseMoney(value) : 0;
        } catch {
          /* 超出整数分范围，按本行错误展示 */
        }
        if (cents == null) errors.push(`${pasteLabels[field]}格式错误`);
        else amounts[field] = cents;
      }
      for (const field of ['quantity', 'unitPrice', 'exchangeRate'] as const) {
        if (values[field] && !/^-?(\d+(\.\d+)?|\.\d+)$/.test(values[field]))
          errors.push(`${pasteLabels[field]}格式错误`);
      }
      if (values.bizDate && !isValidDate(values.bizDate)) errors.push('业务日期无效');
      return { line: index + 1, values, amounts, errors };
    });
}
