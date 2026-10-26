import { z } from 'zod';
import { zId, zPeriod, zDecimal, type Account } from '@caiwu/core';

export const RangeSchema = z.object({ from: zPeriod, to: zPeriod });
export const PeriodSchema = z.object({ period: zPeriod });
export const CashflowsSchema = z.object({
  in: zId.nullable().optional(),
  out: zId.nullable().optional(),
});
export type Cashflows = z.input<typeof CashflowsSchema>;
export const requiresCashflow = (account: Pick<Account, 'cashflowRequired' | 'dimensions'>) =>
  account.cashflowRequired || account.dimensions.some((d) => d.type === 'cashflow' && d.required);
export const RuleSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/, '代码限字母、数字、下划线和短横线'),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['pnl', 'custom']),
  voucherTypeId: zId,
  summary: z.string().trim().min(1).max(200),
  order: z.number().int().min(1).max(9999),
  enabled: z.boolean(),
  targetAccountId: zId,
  targetDimensions: z
    .object({
      project: zId.nullable().optional(),
      partner: zId.nullable().optional(),
      department: zId.nullable().optional(),
      person: zId.nullable().optional(),
      cashflow: zId.nullable().optional(),
    })
    .default({}),
  targetCashflows: CashflowsSchema.optional(),
  sources: z
    .array(
      z.object({
        accountId: zId,
        mode: z.literal('balance'),
        ratio: zDecimal,
        cashflows: CashflowsSchema.optional(),
      }),
    )
    .max(300),
});
export type RuleInput = z.input<typeof RuleSchema>;
export type TransferRule = z.output<typeof RuleSchema> & { id: number; revision: number };
export const TransferSchema = PeriodSchema.extend({ ruleIds: z.array(zId).max(100) });
export const GenerateSchema = TransferSchema.extend({
  confirmed: z.boolean(),
  previewToken: z.string(),
});
export const CloseSchema = PeriodSchema.extend({
  confirmed: z.boolean(),
  allowUntransferredPnl: z.boolean().default(false),
  acknowledgeDrafts: z.boolean().default(false),
});
export const ReopenSchema = RangeSchema.extend({ confirmed: z.boolean() });
export const RenumberSchema = PeriodSchema.extend({
  previewToken: z.string(),
  confirmed: z.boolean(),
  confirmText: z.string(),
});
export const YearEndSchema = z.object({
  year: z.number().int().min(1900).max(9998),
  confirmed: z.boolean(),
});

export const ReverseYearSchema = z.object({
  year: z.number().int().min(1900).max(9998),
  backupId: z.string(),
  confirmed: z.boolean(),
  confirmText: z.string(),
});
