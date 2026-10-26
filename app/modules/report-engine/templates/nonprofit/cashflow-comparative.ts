import { z } from 'zod';
import type { CoreServices } from '@caiwu/core/server';
import { isPeriod } from '@caiwu/core';
import {
  balanceFormula,
  ReportTemplateSchema,
  type BalanceOptions,
  type ReportTemplate,
} from '../../shared';
import {
  CashflowYearSourceSchema,
  checkCashflowSourceRange,
  type CashflowYearSource,
} from './cashflow';
import { cashflowRows, cashflowDetails, nonprofitFormDraft, textCell } from './forms';

export const ComparativeCashflowSchema = z
  .object({ current: CashflowYearSourceSchema, previous: CashflowYearSourceSchema })
  .strict()
  .superRefine((v, ctx) => {
    if (v.current.year < 2027 || v.previous.year !== v.current.year - 1)
      ctx.addIssue({
        code: 'custom',
        message: '2027起比较栏必须提供上年度独立分类来源；2026使用首次执行例外',
      });
  });
export type ComparativeCashflowMapping = z.infer<typeof ComparativeCashflowSchema>;
function movement(account: string, options: BalanceOptions, item?: string) {
  const term = (metric: 'debit' | 'credit') =>
    balanceFormula({
      account,
      metric,
      unit: 'cents',
      currency: 'CNY',
      direction: 'signed',
      dimension: item ? 'cashflow' : 'none',
      item: item ?? '',
      options,
    });
  return `(${term('debit')}-${term('credit')})`;
}

/** 共享统一第8参数实际取数；年初至报告月、上年同期。门禁尚未注册，仍标明切片。 */
export function comparativeCashflow403Template(
  raw: ComparativeCashflowMapping,
  period: number,
): ReportTemplate {
  const mapping = ComparativeCashflowSchema.parse(raw);
  if (!isPeriod(period) || Math.floor(period / 100) !== mapping.current.year)
    throw new Error('比较现金流量分类报告期必须属于本年来源年度');
  const t = nonprofitFormDraft('403', mapping.current.year);
  t.name = '民非现金流量表（本年与上年同期取数切片）';
  t.cells.find((c) => c.address === 'A1')!.source = '现金流量表（比较取数切片，非完整法定报表）';
  t.cells.find((c) => c.address === 'A3')!.source =
    '仅已过账；本年累计与上年同期；需分别核实两年度分类及现金政策';
  t.cells.find((c) => c.address === 'C4')!.source = '上年同期金额';
  t.checks = [];
  for (const [col, source, options] of [
    ['B', mapping.current, { from: 'yearStart', to: 'current' }],
    ['C', mapping.previous, { from: 'previousYearStart', to: 'previousYearSameMonth' }],
  ] as const) {
    for (const [i, r] of cashflowRows.entries()) {
      if (r.section) continue;
      const address = `${col}${i + 5}`;
      const input = r.total
        ? r.total.replace(/B(?=\d)/g, col)
        : `SUM(${source.accounts.map((a) => movement(a.code, options, source.items[r.id]!.code)).join(',')})`;
      t.cells = t.cells.filter((c) => c.address !== address);
      t.cells.push({
        address,
        source: !r.total && r.outflow ? `-(${input})` : input,
        kind: 'formula',
        unit: 'cents',
        currency: 'CNY',
      });
    }
    t.checks.push({
      name: `${source.year}分类净额与对应现金账户变动一致`,
      left: `${col}41`,
      right: `SUM(${source.accounts.map((a) => movement(a.code, options)).join(',')})`,
      tolerance: '0',
    });
    const notes = [
      `${source.year}现金政策：${source.policyBasis}`,
      ...source.accounts.map((a) => `${source.year}纳入账户${a.code}：${a.basis}`),
      ...source.excludedAccounts.map((a) => `${source.year}排除账户${a.code}：${a.basis}`),
      ...cashflowDetails.map(
        (r) =>
          `${source.year} ${r.label} ← ${source.items[r.id]!.code}：${source.items[r.id]!.basis}`,
      ),
      `${source.year}内部划转${source.internalTransfer.code}：${source.internalTransfer.basis}`,
    ];
    for (const note of notes) {
      const row = ++t.rows;
      t.cells.push(textCell(`A${row}`, note));
      t.merges.push({ row, col: 1, rows: 1, cols: 3 });
    }
  }
  t.reportIdentity = 'nonprofit-cashflow403-comparative';
  t.profile = {
    mode: 'declaration',
    version: 1,
    kind: t.reportIdentity,
    scope: 'posted',
    period,
    mapping,
  };
  return ReportTemplateSchema.parse(t);
}

export async function validateComparativeCashflow403Generation(
  svc: CoreServices,
  input: { period: number; includeUnposted: boolean },
  raw: ComparativeCashflowMapping,
): Promise<void> {
  const mapping = ComparativeCashflowSchema.parse(raw);
  if (input.includeUnposted) throw new Error('民非现金流量比较取数只允许已过账');
  if (Math.floor(input.period / 100) !== mapping.current.year)
    throw new Error('生成期间与现金流量来源年度不一致');
  await checkCashflowSourceRange(
    svc,
    mapping.current.year * 100 + 1,
    input.period,
    mapping.current,
  );
  await checkCashflowSourceRange(
    svc,
    mapping.previous.year * 100 + 1,
    input.period - 100,
    mapping.previous,
  );
}

export function comparativeCashflowMapping(
  current: CashflowYearSource,
  previous: CashflowYearSource,
): ComparativeCashflowMapping {
  return ComparativeCashflowSchema.parse({ current, previous });
}
