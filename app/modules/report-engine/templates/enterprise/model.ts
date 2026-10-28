import { z } from 'zod';
import {
  zDate,
  zId,
  zPeriod,
  type Account,
  type BalanceRow,
  type EntryRow,
  type VoucherHeader,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
export const FORMAT = 'enterprise-2019-appendix2' as const;
const amount = z
  .string()
  .max(20)
  .regex(/^-?\d+$/)
  .refine(
    (v) =>
      /^-?\d+$/.test(v) &&
      BigInt(v) >= -BigInt(Number.MAX_SAFE_INTEGER) &&
      BigInt(v) <= BigInt(Number.MAX_SAFE_INTEGER),
    '单笔金额超出精确范围',
  );
const evidence = z
  .object({ source: z.string().trim().min(2), version: z.string().trim().min(1) })
  .strict();
export const RuleSchema = z
  .object({
    accountId: zId,
    line: z.string().min(1),
    kind: z.enum([
      'balance',
      'receivable',
      'payable',
      'contract',
      'financial',
      'maturity',
      'contractCost',
      'return',
      'equityInstrument',
      'pnl',
      'oci',
      'currentProfit',
    ]),
    role: z
      .enum([
        'gross',
        'allowance',
        'depreciation',
        'amortization',
        'clearing',
        'financing',
        'special',
      ])
      .default('gross'),
    parent: z.string().optional(),
  })
  .strict();
const instrumentPart = z
  .object({
    id: z.string().min(1),
    amount,
    classification: z.enum(['equity', 'liability']),
    duePeriod: zPeriod.optional(),
    current: z.boolean().optional(),
    instrument: z.enum(['ordinary', 'preferred', 'perpetual', 'other']),
    ...evidence.shape,
  })
  .strict();
export const ClassificationFactSchema = z
  .object({
    period: zPeriod,
    basis: z.enum(['opening', 'closing']).default('closing'),
    allowanceFor: z.string().optional(),
    bucket: z.string().min(1),
    ...evidence.shape,
    contractId: z.string().min(1).optional(),
    current: z.boolean().optional(),
    duePeriod: zPeriod.optional(),
    initialTermMonths: z.number().int().positive().optional(),
    normalCycleMonths: z.number().int().positive().optional(),
    category: z.enum(['amortized', 'fvoci', 'fvtpl', 'equity-fvoci']).optional(),
    expectedHoldMonths: z.number().int().nonnegative().optional(),
    contractualMaturity: z.enum(['dated', 'none']).optional(),
    originallyLongTerm: z.boolean().optional(),
    sppi: z.boolean().optional(),
    businessModel: z.enum(['collect', 'collectAndSell', 'other']).optional(),
    nonTrading: z.boolean().optional(),
    irrevocableElection: z.boolean().optional(),
    segments: z
      .array(
        z
          .object({
            key: z.string().min(1),
            amount,
            current: z.boolean().optional(),
            duePeriod: zPeriod.optional(),
            contractId: z.string().optional(),
            allowanceFor: z.string().optional(),
            category: z.enum(['amortized', 'fvoci', 'fvtpl', 'equity-fvoci']).optional(),
            ...evidence.shape,
          })
          .strict(),
      )
      .optional(),
    measurementModel: z.enum(['cost', 'fairValue']).optional(),
    parts: z.array(instrumentPart).min(1).optional(),
  })
  .strict();
export const EQUITY_COLUMNS = [
  'capital',
  'equityPreferred',
  'equityPerpetual',
  'equityOther',
  'capitalReserve',
  'treasuryStock',
  'otherComprehensive',
  'specialReserve',
  'surplusReserve',
  'retainedEarnings',
] as const;
export const EQUITY_DETAILS = [
  'ordinaryContributions',
  'instrumentContributions',
  'sharePayments',
  'otherContributions',
  'surplusAppropriation',
  'distributions',
  'otherDistribution',
  'capitalizationReserve',
  'capitalizationSurplus',
  'lossRecovery',
  'benefitTransfer',
  'ociTransfer',
  'otherTransfer',
] as const;
export const EquityEventSchema = z
  .object({
    lineId: zId,
    row: z.enum(EQUITY_DETAILS),
    liabilityAmount: amount.default('0'),
    parts: z.array(
      z
        .object({ column: z.enum(EQUITY_COLUMNS), amount, instrumentId: z.string().optional() })
        .strict(),
    ),
    ...evidence.shape,
  })
  .strict();
export const EnterpriseConfigSchema = z
  .object({
    format: z.literal(FORMAT),
    period: zPeriod,
    scope: z.enum(['month', 'yearToDate', 'annual']),
    adoption: z
      .object({
        entityClass: z.enum(['dualListed', 'overseasListed', 'domesticListed', 'unlisted']),
        financial: zDate,
        revenue: zDate,
        lease: zDate,
        cas30_2026: zDate.nullable(),
        ...evidence.shape,
      })
      .strict(),
    rules: z.array(RuleSchema).min(1),
    facts: z.array(ClassificationFactSchema),
    absentRoles: z.array(
      z.object({ period: zPeriod, line: z.string(), role: z.string(), ...evidence.shape }).strict(),
    ),
    cashPolicies: z.array(
      z
        .object({
          period: zPeriod,
          basis: z.enum(['opening', 'closing']).default('closing'),
          accounts: z.array(zId),
          restrictedAccounts: z.array(zId),
          ...evidence.shape,
        })
        .strict(),
    ),
    cashAllocations: z.array(
      z
        .object({
          lineId: zId,
          parts: z.array(z.object({ line: z.string(), amount }).strict()).min(1),
          ...evidence.shape,
        })
        .strict(),
    ),
    contractNetAllocations: z
      .array(
        z
          .object({
            period: zPeriod,
            basis: z.enum(['opening', 'closing']),
            contractId: z.string().min(1),
            currentAmount: amount,
            noncurrentAmount: amount,
            ...evidence.shape,
          })
          .strict(),
      )
      .default([]),
    cashScopeChanges: z.array(
      z
        .object({
          period: zPeriod,
          date: zDate,
          accountId: zId,
          amount,
          kind: z.enum(['restriction', 'release', 'policy']),
          parts: z
            .array(
              z
                .object({
                  line: z.string().min(1),
                  amount,
                  purpose: z.string().trim().min(2),
                })
                .strict(),
            )
            .optional(),
          ...evidence.shape,
        })
        .strict(),
    ),
    equityEvents: z.array(EquityEventSchema),
    adjustments: z.array(
      z
        .object({
          period: zPeriod,
          statement: z.enum(['balance', 'profit', 'cashflow', 'equity']),
          row: z.string(),
          column: z.string().optional(),
          amount,
          kind: z.enum(['policy', 'error', 'other']),
          ...evidence.shape,
        })
        .strict(),
    ),
    oci: z.array(
      z
        .object({ lineId: zId, line: z.string(), gross: amount, tax: amount, ...evidence.shape })
        .strict(),
    ),
    discontinued: z.array(z.object({ lineId: zId, ...evidence.shape }).strict()),
    shares: z.array(
      z
        .object({
          from: zDate,
          to: zDate,
          ordinary: z.string().regex(/^\d+(\.\d+)?$/),
          ...evidence.shape,
        })
        .strict(),
    ),
    eps: z.array(
      z
        .object({
          from: zPeriod,
          to: zPeriod,
          applicable: z.boolean(),
          preference: amount,
          dilutions: z.array(
            z
              .object({
                numerator: amount,
                shares: z.string().regex(/^\d+(\.\d+)?$/),
                ...evidence.shape,
              })
              .strict(),
          ),
          ...evidence.shape,
        })
        .strict(),
    ),
  })
  .strict();
export type EnterpriseConfig = z.infer<typeof EnterpriseConfigSchema>;
export type ClassificationFact = z.infer<typeof ClassificationFactSchema>;
export type SourceData = {
  bookId: string;
  orgName: string;
  regime: string;
  startPeriod: number;
  accounts: Account[];
  pnlCategoryIds: string[];
  balances: Record<number, BalanceRow[]>;
  entries: EntryRow[];
  vouchers: VoucherHeader[];
  periods: number[];
  cashflowItems: Awaited<ReturnType<CoreServices['dimensions']['items']>>;
  openingSources: Awaited<ReturnType<CoreServices['opening']['list']>>;
};
export type Range = { from: number; to: number; label: string };
export type Values = Record<string, string>;
export type Matrix = Record<string, Values>;
export type Check = {
  statement: string;
  row: string;
  column: string;
  period: number;
  difference: string;
  hint: string;
  sources: string[];
};
export type EnterpriseResult = {
  format: typeof FORMAT;
  period: number;
  scope: EnterpriseConfig['scope'];
  orgName: string;
  /** 旧快照无此字段时沿用原有比较数；新生成结果明确区分真实比较数与无来源。 */
  comparison?: {
    balance: 'available' | 'unavailable';
    flow: 'available' | 'unavailable';
    reason: string | null;
  };
  balance: { current: Values; previous: Values };
  profit: { current: Values; previous: Values };
  cashflow: { current: Values; previous: Values };
  equity: { current: Matrix; previous: Matrix };
  ranges: { current: Range; previous: Range; balancePrevious: number };
  checks: Check[];
};
export const balanceBucket = (r: Pick<BalanceRow, 'accountId' | 'dimensions'>) =>
  JSON.stringify([
    r.accountId,
    r.dimensions.partner ?? null,
    r.dimensions.project ?? null,
    r.dimensions.department ?? null,
    r.dimensions.person ?? null,
  ]);
const FIELD_LABELS: Record<string, string> = {
  period: '报告期间',
  scope: '比较口径',
  adoption: '适用政策',
  rules: '科目匹配',
  facts: '分类依据',
  absentRoles: '组成角色依据',
  cashPolicies: '现金范围',
  cashAllocations: '现金分配',
  cashScopeChanges: '现金范围变化',
  parts: '分项资料',
  purpose: '活动用途依据',
  equityEvents: '权益事件',
  adjustments: '追溯调整',
  oci: '其他综合收益',
  discontinued: '终止经营',
  shares: '股份区间',
  eps: '每股收益资料',
  source: '依据来源',
  version: '依据版本',
  line: '列报项目',
  amount: '金额',
  from: '起期',
  to: '止期',
  column: '权益列',
  accountId: '科目',
  contractId: '合同编号',
  currentAmount: '流动部分',
  noncurrentAmount: '非流动部分',
  contractNetAllocations: '合同净额期限分配',
};
export function parseEnterpriseConfiguration(raw: unknown): EnterpriseConfig {
  const parsed = EnterpriseConfigSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const fields = parsed.error.issues
    .slice(0, 8)
    .map((issue) =>
      issue.path
        .map((k) =>
          typeof k === 'number' ? `第${k + 1}项` : (FIELD_LABELS[String(k)] ?? '分类资料'),
        )
        .join('／'),
    );
  throw new Error(
    `配置尚未完整或格式无效：${fields.join('；')}。请填写有效日期、项目、金额和依据后再保存。`,
  );
}
