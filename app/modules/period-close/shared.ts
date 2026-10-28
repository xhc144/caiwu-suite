import { z } from 'zod';
import { zId, zPeriod, zDecimal, type Account } from '@caiwu/core';

export const RangeSchema = z.object({ from: zPeriod, to: zPeriod });
export const PeriodSchema = z.object({ period: zPeriod });
// 与 M03 持久化约定一致；模块之间不互相 import。
export const CashflowDirectionSchema = z.enum(['inflow', 'outflow', 'internal']);
export const CashflowsSchema = z.object({
  in: zId.nullable().optional(),
  out: zId.nullable().optional(),
});
export type Cashflows = z.input<typeof CashflowsSchema>;
export const requiresCashflow = (account: Pick<Account, 'cashflowRequired' | 'dimensions'>) =>
  account.cashflowRequired || account.dimensions.some((d) => d.type === 'cashflow' && d.required);
export const SourceModeSchema = z.enum([
  'balance',
  'debitBalance',
  'creditBalance',
  'periodDebit',
  'periodCredit',
  'periodNet',
]);
export type SourceMode = z.output<typeof SourceModeSchema>;
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
  // 显式绑定币种/计量单位，档案变化后必须重新设置，不能沿用旧换算。
  targetConversion: z
    .object({
      currency: z.string().trim().min(1).max(10).optional(),
      exchangeRate: z.string().trim().max(40).pipe(zDecimal).optional(),
      quantityUnit: z.string().trim().min(1).max(40).optional(),
      unitPrice: z.string().trim().max(40).pipe(zDecimal).optional(),
    })
    .optional(),
  sources: z
    .array(
      z.object({
        accountId: zId,
        mode: SourceModeSchema,
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
  voucherNumbers: z.record(z.string(), z.number().int().positive().max(2147483647)).optional(),
});
export const BatchIdSchema = z.object({ id: z.string().uuid() });
export const BatchStartSchema = TransferSchema.extend({ confirmed: z.boolean() });
export const BatchExecuteSchema = BatchIdSchema.extend({
  revision: z.number().int().positive(),
  previewToken: z.string(),
  confirmed: z.boolean(),
  number: z.number().int().positive().max(2147483647).optional(),
});
export const BatchDecisionSchema = BatchIdSchema.extend({
  revision: z.number().int().positive(),
  decision: z.enum(['retry', 'skip', 'stop']),
  confirmed: z.boolean(),
});
export const ExchangeSettingsSchema = z.object({
  period: zPeriod,
  voucherTypeId: zId,
  number: z.number().int().positive().max(2147483647).optional(),
  summary: z.string().trim().min(1).max(200),
  accountIds: z.array(zId).min(1).max(300),
  rates: z
    .array(
      z.object({
        currency: z.string().trim().min(1).max(10),
        rate: z.string().trim().max(40).pipe(zDecimal),
        gainLossAccountId: zId,
        dimensions: z
          .object({
            project: zId.nullable().optional(),
            partner: zId.nullable().optional(),
            department: zId.nullable().optional(),
            person: zId.nullable().optional(),
          })
          .default({}),
      }),
    )
    .min(1)
    .max(50),
});
export type ExchangeSettings = z.output<typeof ExchangeSettingsSchema>;
export const ExchangeDeleteSchema = PeriodSchema.extend({
  confirmed: z.boolean(),
  plan: z.object({ ids: z.array(zId), expiresAt: z.number(), fingerprint: z.string() }),
});
export const CloseSchema = PeriodSchema.extend({
  confirmed: z.boolean(),
  allowUntransferredPnl: z.boolean().default(false),
  acknowledgeDrafts: z.boolean().default(false),
});
export const CloseRangeSchema = RangeSchema.extend({
  confirmed: z.boolean(),
  previewToken: z.string(),
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
