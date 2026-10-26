import { z } from 'zod';
import type { CoreServices } from '@caiwu/core/server';
import { balanceFormula, ReportTemplateSchema, type ReportTemplate } from '../../shared';
import { nonprofitFormDraft, textCell } from './forms';
import { yearOpening } from './period-formulas';

const groupNames = [
  'cash',
  'agencyCash',
  'shortInvestment',
  'shortImpairment',
  'receivables',
  'badDebt',
  'prepayments',
  'inventory',
  'inventoryImpairment',
  'deferred',
  'currentInvestment',
  'currentInvestmentImpairment',
  'otherCurrentAssets',
  'equityInvestment',
  'equityInvestmentImpairment',
  'debtInvestment',
  'debtInvestmentImpairment',
  'otherInvestment',
  'otherInvestmentImpairment',
  'fixedCost',
  'depreciation',
  'fixedImpairment',
  'construction',
  'disposal',
  'culturalResources',
  'intangibleCost',
  'amortization',
  'intangibleImpairment',
  'longDeferred',
  'agencyAsset',
  'shortBorrowing',
  'payables',
  'employees',
  'taxes',
  'advances',
  'accruals',
  'currentDebt',
  'otherCurrentLiabilities',
  'longBorrowing',
  'longPayables',
  'provisions',
  'otherLongLiabilities',
  'agencyLiability',
  'unrestricted',
  'restricted',
] as const;
export type Balance401Group = (typeof groupNames)[number];
const source = z
  .object({
    accounts: z
      .array(z.string().regex(/^\d{1,20}$/))
      .min(1)
      .max(8),
    basis: z.string().trim().min(1, '每项分类必须有依据').max(500),
  })
  .strict();
export const Balance401MappingSchema = z
  .object({
    period: z
      .number()
      .int()
      .min(202601)
      .max(999912)
      .refine((v) => v % 100 >= 1 && v % 100 <= 12, '期间月份无效'),
    groups: z.record(z.enum(groupNames), source),
  })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    for (const [id, group] of Object.entries(v.groups))
      for (const code of group.accounts) {
        if (id === 'agencyCash') {
          if (!v.groups.cash.accounts.includes(code))
            ctx.addIssue({ code: 'custom', message: '受托现金必须是货币资金范围内的明细' });
        } else {
          if (seen.has(code))
            ctx.addIssue({ code: 'custom', message: `科目不能重复分类：${code}` });
          seen.add(code);
        }
        if (group.accounts.filter((c) => c === code).length > 1)
          ctx.addIssue({ code: 'custom', message: `同一组不能重复科目：${code}` });
      }
  });
export type Balance401Mapping = z.infer<typeof Balance401MappingSchema>;

type FormulaSet = (g: Balance401Group) => string;
function formulas(s: FormulaSet, a: string, l: string): Record<string, string> {
  const debit = (g: Balance401Group) => s(g);
  const credit = (g: Balance401Group) => `-(${s(g)})`;
  return {
    [`${a}6`]: `${s('cash')}-${s('agencyCash')}`,
    [`${a}7`]: `${s('shortInvestment')}+${s('shortImpairment')}`,
    [`${a}8`]: `${s('receivables')}+${s('badDebt')}`,
    [`${a}9`]: debit('prepayments'),
    [`${a}10`]: `${s('inventory')}+${s('inventoryImpairment')}`,
    [`${a}11`]: debit('deferred'),
    [`${a}12`]: `${s('currentInvestment')}+${s('currentInvestmentImpairment')}`,
    [`${a}13`]: debit('otherCurrentAssets'),
    [`${a}14`]: `SUM(${a}6:${a}13)`,
    [`${a}17`]: `${s('equityInvestment')}+${s('equityInvestmentImpairment')}`,
    [`${a}18`]: `${s('debtInvestment')}+${s('debtInvestmentImpairment')}`,
    [`${a}19`]: `${s('otherInvestment')}+${s('otherInvestmentImpairment')}`,
    [`${a}20`]: `SUM(${a}17:${a}19)`,
    [`${a}22`]: debit('fixedCost'),
    [`${a}23`]: credit('depreciation'),
    [`${a}24`]: `${a}22-${a}23+${s('fixedImpairment')}`,
    [`${a}25`]: debit('construction'),
    [`${a}26`]: debit('disposal'),
    [`${a}27`]: `SUM(${a}24:${a}26)`,
    [`${a}28`]: debit('culturalResources'),
    [`${a}30`]: debit('intangibleCost'),
    [`${a}31`]: credit('amortization'),
    [`${a}32`]: `${a}30-${a}31+${s('intangibleImpairment')}`,
    [`${a}33`]: debit('longDeferred'),
    [`${a}34`]: `${a}20+${a}27+${a}28+${a}32+${a}33`,
    [`${a}36`]: `${s('agencyAsset')}+${s('agencyCash')}`,
    [`${a}37`]: `${a}14+${a}34+${a}36`,
    [`${l}6`]: credit('shortBorrowing'),
    [`${l}7`]: credit('payables'),
    [`${l}8`]: credit('employees'),
    [`${l}9`]: credit('taxes'),
    [`${l}10`]: credit('advances'),
    [`${l}11`]: credit('accruals'),
    [`${l}12`]: credit('currentDebt'),
    [`${l}13`]: credit('otherCurrentLiabilities'),
    [`${l}14`]: `SUM(${l}6:${l}13)`,
    [`${l}16`]: credit('longBorrowing'),
    [`${l}17`]: credit('longPayables'),
    [`${l}18`]: credit('provisions'),
    [`${l}19`]: credit('otherLongLiabilities'),
    [`${l}20`]: `SUM(${l}16:${l}19)`,
    [`${l}22`]: credit('agencyLiability'),
    [`${l}23`]: `${l}14+${l}20+${l}22`,
    [`${l}25`]: credit('unrestricted'),
    [`${l}26`]: credit('restricted'),
    [`${l}27`]: `SUM(${l}25:${l}26)`,
    [`${l}28`]: `${l}23+${l}27`,
  };
}

function fill(t: ReportTemplate, values: Record<string, string>) {
  const addresses = new Set(Object.keys(values));
  t.cells = t.cells.filter((c) => !addresses.has(c.address));
  for (const [address, source] of Object.entries(values))
    t.cells.push({ address, source, kind: 'formula', unit: 'cents', currency: 'CNY' });
}
function appendSources(t: ReportTemplate, mapping: Balance401Mapping, title: string) {
  for (const [id, group] of Object.entries(mapping.groups)) {
    const row = ++t.rows;
    t.cells.push(
      textCell(`A${row}`, `${title} ${id} ← ${group.accounts.join('、')}：${group.basis}`),
    );
    t.merges.push({ row, col: 1, rows: 1, cols: 6 });
  }
}

/** 原七参数引擎即可真实运行；年初数持续明确待接入，不宣称完整资产负债表。 */
export function balance401ClosingTemplate(raw: Balance401Mapping): ReportTemplate {
  const mapping = Balance401MappingSchema.parse(raw);
  const t = nonprofitFormDraft('401', Math.floor(mapping.period / 100));
  t.name = '民非资产负债表（期末取数切片，年初未接入）';
  t.cells = t.cells.filter((c) => !['A1', 'A3'].includes(c.address));
  t.cells.unshift(textCell('A1', '资产负债表（期末取数切片，年初未接入）'));
  t.cells.push(textCell('A3', `映射依据期间：${mapping.period}；仅已过账；每次生成前须检查来源`));
  fill(
    t,
    formulas(
      (g) =>
        `SUM(${mapping.groups[g].accounts.map((account) => balanceFormula({ account, metric: 'closing', unit: 'cents', currency: 'CNY', direction: 'signed', dimension: 'none', item: '' })).join(',')})`,
      'C',
      'F',
    ),
  );
  t.checks = [{ name: '期末资产等于负债和净资产', left: 'C37', right: 'F28', tolerance: '0' }];
  appendSources(t, mapping, '期末来源');
  t.reportIdentity = 'nonprofit-balance401';
  t.profile = { version: 1, kind: t.reportIdentity, scope: 'posted', period: mapping.period, mapping };
  return ReportTemplateSchema.parse(t);
}

/** 年初与期末分别保存来源；制度/期间/来源门禁尚待共享事务注册，仍是取数切片。 */
export function balance401AnnualTemplate(
  closingRaw: Balance401Mapping,
  openingRaw: Balance401Mapping,
): ReportTemplate {
  const closing = Balance401MappingSchema.parse(closingRaw);
  const opening = Balance401MappingSchema.parse(openingRaw);
  if (opening.period !== Math.floor(closing.period / 100) * 100 + 1)
    throw new Error('年初分类依据须属于同年度1月；不能复用期末到期分类');
  const t = balance401ClosingTemplate(closing);
  fill(
    t,
    formulas((g) => `SUM(${opening.groups[g].accounts.map(yearOpening).join(',')})`, 'B', 'E'),
  );
  fill(
    t,
    formulas(
      (g) =>
        `SUM(${closing.groups[g].accounts.map((account) => balanceFormula({ account, metric: 'closing', unit: 'cents', currency: 'CNY', direction: 'signed', dimension: 'none', item: '', options: { from: 'yearStart', to: 'current', closing: 'include', side: 'net' } })).join(',')})`,
      'C',
      'F',
    ),
  );
  t.name = '民非资产负债表（年初期末取数切片）';
  t.cells.find((c) => c.address === 'A1')!.source =
    '资产负债表（年初期末取数切片，制度门禁未接入）';
  t.checks.push({ name: '年初资产等于负债和净资产', left: 'B37', right: 'E28', tolerance: '0' });
  appendSources(t, opening, '年初来源');
  t.reportIdentity = 'nonprofit-balance401-annual';
  t.profile = { version: 1, kind: t.reportIdentity, scope: 'posted', period: closing.period, mapping: { closing, opening } };
  return ReportTemplateSchema.parse(t);
}

/** 与生成的原子接入仍待共享owner；检查不替代正式制度校验。 */
export async function checkBalance401Sources(
  svc: CoreServices,
  period: number,
  raw: Balance401Mapping,
  generation: { includeUnposted: boolean } = { includeUnposted: false },
): Promise<void> {
  const mapping = Balance401MappingSchema.parse(raw);
  if (generation.includeUnposted) throw new Error('民非资产负债表取数只允许已过账');
  if (period !== mapping.period)
    throw new Error('分类依据期间与生成期间不一致，请重新复核到期和受托明细');
  await svc.periods.require(period);
  if ((await svc.book.info()).product !== 'minfei') throw new Error('请选择民非企账套');
  const accounts = await svc.accounts.list();
  const mapped = new Set(Object.values(mapping.groups).flatMap((g) => g.accounts));
  for (const code of mapped)
    if (!(await svc.accounts.require(code)).isLeaf)
      throw new Error(`来源必须是末级科目，不能父子重复汇总：${code}`);
  const pnl = new Set((await svc.accounts.categories()).filter((c) => c.isPnl).map((c) => c.id));
  const rows = await svc.ledger.balances({ periodFrom: period, periodTo: period, rollup: false });
  for (const row of rows) {
    if (row.closing === 0) continue;
    const account = accounts.find((a) => a.id === row.accountId)!;
    if (pnl.has(account.categoryId))
      throw new Error(`尚有未结转收入费用，不能假定净资产已含本期变动：${account.code}`);
    if (!mapped.has(account.code))
      throw new Error(`存在未分类的资产负债或净资产余额：${account.code}`);
  }
}

/** 公共generate待注册的年度门禁：两时点来源和实际取数范围须与本次生成绑定。 */
export async function validateBalance401AnnualGeneration(
  svc: CoreServices,
  input: { period: number; includeUnposted: boolean },
  sources: { closing: Balance401Mapping; opening: Balance401Mapping },
): Promise<void> {
  const closing = Balance401MappingSchema.parse(sources.closing);
  const opening = Balance401MappingSchema.parse(sources.opening);
  const first = Math.floor(input.period / 100) * 100 + 1;
  if (opening.period !== first) throw new Error('年初来源不是本次生成年度1月');
  await svc.periods.require(first);
  await svc.periods.require(input.period);
  const periods = await svc.periods.list();
  if (
    periods.filter((p) => p.period >= first && p.period <= input.period).length !==
    input.period % 100
  )
    throw new Error('资产负债表年度范围内存在未建立期间');
  await checkBalance401Sources(svc, input.period, closing, input);
  for (const code of new Set(Object.values(opening.groups).flatMap((g) => g.accounts)))
    if (!(await svc.accounts.require(code)).isLeaf)
      throw new Error(`年初来源必须是末级科目：${code}`);
  const mapped = new Set(Object.values(opening.groups).flatMap(g => g.accounts));
  const pnl = new Set((await svc.accounts.categories()).filter(c => c.isPnl).map(c => c.id));
  const accounts = new Map((await svc.accounts.list()).map(a => [a.id, a]));
  const rows = await svc.ledger.balances({ periodFrom: first, periodTo: first, rollup: false });
  for (const row of rows) {
    if (row.opening === 0) continue;
    const account = accounts.get(row.accountId)!;
    if (pnl.has(account.categoryId) || !mapped.has(account.code))
      throw new Error(`存在未分类或未结转的实际年初来源：${account.code}`);
  }
}
