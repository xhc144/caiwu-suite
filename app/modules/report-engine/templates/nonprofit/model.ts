import { z } from 'zod';
import type { Account, AccountCategory, BalanceRow, BookInfo, EntryRow } from '@caiwu/core';
import { RestrictionEvidenceSchema } from './restriction-evidence';

export const reference = z.string().trim().min(1, '请填写原始凭据及具体条款').max(1000);
export const money = z.number().int().safe();
export const period = z
  .number()
  .int()
  .min(202601)
  .max(999912)
  .refine((p) => p % 100 >= 1 && p % 100 <= 12, '月份无效');
const account = z.string().regex(/^\d{4,20}$/);
export const RequestSchema = z
  .object({
    code: z.enum(['401', '402', '403']),
    from: period,
    to: period,
    kind: z.enum(['month', 'quarter', 'half', 'interim', 'annual']),
    includeUnposted: z.literal(false).default(false),
    comparison: z.boolean().default(true),
  })
  .strict()
  .superRefine((v, c) => {
    const y = Math.floor(v.to / 100);
    if (v.from > v.to || Math.floor(v.from / 100) !== y)
      c.addIssue({ code: 'custom', message: '报告期间须在同一年度并按先后排列' });
    const a = v.from % 100,
      b = v.to % 100;
    if (v.kind === 'annual' && (a !== 1 || b !== 12))
      c.addIssue({ code: 'custom', message: '年度报告必须包含一月至十二月' });
    if (v.kind === 'month' && a !== b)
      c.addIssue({ code: 'custom', message: '月报只能选择一个月' });
    if (v.kind === 'quarter' && (b - a !== 2 || ![3, 6, 9, 12].includes(b)))
      c.addIssue({ code: 'custom', message: '季报须选择完整季度' });
    if (v.kind === 'half' && (b - a !== 5 || ![6, 12].includes(b)))
      c.addIssue({ code: 'custom', message: '半年报须选择完整半年度' });
    if (v.code === '403' && v.kind !== 'annual')
      c.addIssue({ code: 'custom', message: '现金流量表为年度报告，请选择完整年度' });
  });
export type StatementRequest = z.infer<typeof RequestSchema>;

export const ResourceSchema = z
  .object({
    id: reference,
    name: reference,
    classification: z.enum(['unrestricted', 'restricted']),
    sourceReference: reference,
    acquisitionReference: reference,
    openingBalance: money,
    openingReference: reference,
    unrestrictedBasis: reference.optional(),
    restriction: RestrictionEvidenceSchema.optional(),
  })
  .strict()
  .superRefine((r, c) => {
    if (r.classification === 'restricted' && r.openingBalance < 0)
      c.addIssue({ code: 'custom', message: '限定性资源年初余额不能为负，请核对真实资源分配' });
    if (r.classification === 'restricted' && !r.restriction)
      c.addIssue({ code: 'custom', message: '限定性资源须填写提供者或法规设置的限制' });
    if (r.classification === 'unrestricted' && (!r.unrestrictedBasis || r.restriction))
      c.addIssue({ code: 'custom', message: '非限定性资源须核对外部文件未设具体限制' });
    if (
      r.restriction &&
      (r.restriction.resourceReference !== r.id ||
        r.restriction.sourceReference !== r.sourceReference)
    )
      c.addIssue({ code: 'custom', message: '资源批次及限制来源必须一致' });
  });
export type Resource = z.infer<typeof ResourceSchema>;

export const LineIdentitySchema = z
  .object({
    voucherId: z.number().int().positive(),
    lineId: z.number().int().positive(),
    revision: z.number().int().positive(),
    period,
    account,
    debit: money,
    credit: money,
  })
  .strict();
export type LineIdentity = z.infer<typeof LineIdentitySchema>;
export const incomeIds = [
  'donations',
  'dues',
  'services',
  'grants',
  'sales',
  'headquarters',
  'investmentIncome',
  'otherIncome',
] as const;
export const expenseIds = [
  'activityCost',
  'taxExpense',
  'administration',
  'fundraising',
  'impairment',
  'incomeTax',
  'otherExpense',
] as const;
export const ActivityAllocationSchema = z
  .object({
    resourceId: reference,
    debit: money,
    credit: money,
    classification: z.enum(['unrestricted', 'restricted']),
    recognitionReference: reference,
    acquisitionReference: reference,
    detail: reference.optional(),
    charitableTrust: z.boolean().default(false),
    fundraisingCost: z.boolean().default(false),
  })
  .strict();
export const RecognitionSchema = z
  .object({
    line: LineIdentitySchema,
    row: z.enum([...incomeIds, ...expenseIds]),
    allocations: z.array(ActivityAllocationSchema).min(1),
  })
  .strict();
export type Recognition = z.infer<typeof RecognitionSchema>;
export const EventSchema = z
  .object({
    id: reference,
    kind: z.enum(['release', 'restriction', 'priorAdjustment', 'directCapital']),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    resourceId: reference,
    lines: z
      .array(z.object({ line: LineIdentitySchema, debit: money, credit: money }).strict())
      .min(1),
    amount: money,
    sourceReference: reference,
    originalPeriod: z.number().int().optional(),
    restriction: RestrictionEvidenceSchema.optional(),
    releaseEvidence: z.array(RestrictionEvidenceSchema).optional(),
  })
  .strict();
export type NetAssetEvent = z.infer<typeof EventSchema>;

/** 有明确取数项，允许账套在不改变官方一级编码的情况下增设科目。 */
export const standardAccounts: Record<string, string> = {
  '1001': 'cash',
  '1002': 'cash',
  '1009': 'cash',
  '1101': 'shortInvestment',
  '1102': 'shortInvestment',
  '1111': 'receivables',
  '1121': 'receivables',
  '1122': 'receivables',
  '1131': 'receivables',
  '1141': 'prepayments',
  '1201': 'inventory',
  '1202': 'inventory',
  '1301': 'deferred',
  '1401': 'equityInvestment',
  '1402': 'debtInvestment',
  '1403': 'otherInvestment',
  '1421': 'investmentAllowance',
  '1501': 'fixedCost',
  '1502': 'depreciation',
  '1505': 'construction',
  '1506': 'culturalResources',
  '1509': 'disposal',
  '1601': 'intangibleCost',
  '1602': 'amortization',
  '1701': 'longDeferred',
  '1801': 'agencyAsset',
  '2101': 'shortBorrowing',
  '2201': 'payables',
  '2202': 'payables',
  '2203': 'advances',
  '2204': 'employees',
  '2206': 'taxes',
  '2209': 'payables',
  '2301': 'accruals',
  '2501': 'longBorrowing',
  '2502': 'longPayables',
  '2503': 'provisions',
  '2601': 'agencyLiability',
  '3101': 'unrestricted',
  '3102': 'restricted',
  '3201': 'priorAdjustment',
  '4101': 'donations',
  '4201': 'dues',
  '4301': 'services',
  '4401': 'grants',
  '4501': 'sales',
  '4601': 'investmentIncome',
  '4701': 'headquarters',
  '4901': 'otherIncome',
  '5101': 'activityCost',
  '5201': 'taxExpense',
  '5301': 'administration',
  '5401': 'fundraising',
  '5501': 'impairment',
  '5601': 'incomeTax',
  '5901': 'otherExpense',
};
export const MappingSchema = z.object({ account, row: reference, basis: reference }).strict();
export type AccountMapping = z.infer<typeof MappingSchema>;
export const BalanceFactSchema = z
  .object({
    at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    key: reference,
    balance: money,
    allocations: z
      .array(
        z
          .object({
            row: reference,
            amount: money,
            sourceReference: reference,
            maturity: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
            agency: z.boolean().default(false),
            cashIncluded: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type BalanceFact = z.infer<typeof BalanceFactSchema>;
export const cashIds = [
  'donations',
  'dues',
  'services',
  'sales',
  'grants',
  'otherOperatingReceipts',
  'donationsPaid',
  'employeesPaid',
  'goodsServicesPaid',
  'taxesPaid',
  'otherOperatingPayments',
  'investmentRecovered',
  'investmentIncome',
  'assetDisposal',
  'otherInvestingReceipts',
  'assetPurchase',
  'investmentPaid',
  'otherInvestingPayments',
  'borrowings',
  'otherFinancingReceipts',
  'principalPaid',
  'interestPaid',
  'otherFinancingPayments',
  'fx',
] as const;
export const CashScopeSchema = z
  .object({
    account,
    included: z.boolean(),
    basis: reference,
    agency: z.boolean(),
    restricted: z.boolean(),
    equivalent: z.boolean(),
    partitioned: z.boolean().optional(),
    acquiredOn: z.string().optional(),
    maturity: z.string().optional(),
    riskBasis: reference.optional(),
  })
  .strict()
  .superRefine((r, c) => {
    if (r.partitioned && !r.included)
      c.addIssue({ code: 'custom', message: '混合资金科目须按可用部分纳入，并分别确认余额及分录' });
    if (r.included && (r.agency || r.restricted) && !r.partitioned)
      c.addIssue({ code: 'custom', message: '受限或受托款项不能作为可随时支付的现金' });
    if (r.included && r.equivalent && (!r.acquiredOn || !r.maturity || !r.riskBasis))
      c.addIssue({ code: 'custom', message: '现金等价物须记录取得日、到期日和价值风险依据' });
  });
export const CashConfirmationSchema = z
  .object({
    line: LineIdentitySchema,
    allocations: z
      .array(
        z
          .object({
            row: z.enum([...cashIds, 'internal', 'excluded']),
            exclusionReason: z.enum(['agency', 'restricted']).optional(),
            amount: money,
            sourceReference: reference,
            transferReference: reference.optional(),
            nature: z
              .enum([
                'ordinary',
                'engineeringPayroll',
                'capitalizedInterest',
                'financeLease',
                'disposal',
              ])
              .default('ordinary'),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type CashConfirmation = z.infer<typeof CashConfirmationSchema>;
export const ConfigurationSchema = z
  .object({
    version: z.literal(1),
    bookId: reference,
    year: z.number().int().min(2026),
    accountingBasis: reference,
    transitionOpeningReference: reference,
    mappings: z.array(MappingSchema),
    resources: z.array(ResourceSchema),
    recognitions: z.array(RecognitionSchema),
    events: z.array(EventSchema),
    balanceFacts: z.array(BalanceFactSchema),
    cashScope: z.array(CashScopeSchema),
    cashConfirmations: z.array(CashConfirmationSchema),
    cashPolicy: reference,
    policyChangeReference: reference.optional(),
    comparison: z
      .object({
        basis: reference,
        restatements: z.array(
          z
            .object({
              code: z.enum(['402', '403']),
              row: reference,
              period,
              amount: money,
              basis: reference,
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Configuration = z.infer<typeof ConfigurationSchema>;
export type ActualLine = EntryRow & { revision: number; closingKind: string | null };
export type Sources = {
  book: BookInfo;
  accounts: Account[];
  categories: AccountCategory[];
  balances: BalanceRow[];
  entries: ActualLine[];
  from: number;
  to: number;
  openingDate: string;
  closingDate: string;
  unpostedCount: number;
  dimensionNames: Record<string, string>;
};
export type Check = {
  name: string;
  row: string;
  column: string;
  from: number;
  to: number;
  difference: number;
  sources: string[];
};
export type StatementRow = {
  id: string;
  label: string;
  section?: boolean;
  values: (number | string)[];
  sources: string[];
};
export type Statement = {
  code: '401' | '402' | '403';
  name: string;
  organization: string;
  period: StatementRequest;
  columns: string[];
  rows: StatementRow[];
  checks: Check[];
  notes: string[];
  unpostedCount: number;
  cashOpening?: number;
  cashClosing?: number;
};
export function exactSum(values: readonly number[]): number {
  const n = values.reduce((a, b) => a + BigInt(b), 0n);
  const out = Number(n);
  if (!Number.isSafeInteger(out)) throw new Error('金额合计超出可精确计算的范围，请分项核对');
  return out;
}
export function lineIdentity(e: ActualLine): LineIdentity {
  return {
    voucherId: e.voucherId,
    lineId: e.lineId,
    revision: e.revision,
    period: e.period,
    account: e.accountCode,
    debit: e.debit,
    credit: e.credit,
  };
}
export function sameLine(a: LineIdentity, b: LineIdentity) {
  return Object.keys(a).every((k) => a[k as keyof LineIdentity] === b[k as keyof LineIdentity]);
}
export function balanceKey(row: BalanceRow) {
  return `${row.accountCode}:${row.dimensions.partner ?? ''}:${row.dimensions.person ?? ''}`;
}
export function mappedRow(code: string, mappings: AccountMapping[]) {
  return mappings.find((m) => m.account === code)?.row ?? standardAccounts[code.slice(0, 4)];
}
