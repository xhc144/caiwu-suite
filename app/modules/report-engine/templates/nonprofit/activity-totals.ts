import { z } from 'zod';
import type { CoreServices } from '@caiwu/core/server';
import { ReportTemplateSchema, type ReportTemplate } from '../../shared';
import { activityRows, nonprofitFormDraft, textCell } from './forms';
import { activityMovement } from './period-formulas';

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
export const ActivityTotalsMappingSchema = z
  .object({
    period: z
      .number()
      .int()
      .min(202601)
      .max(999912)
      .refine((v) => v % 100 >= 1 && v % 100 <= 12),
    groups: z.record(
      z.enum([...incomeIds, ...expenseIds]),
      z
        .object({
          accounts: z
            .array(z.string().regex(/^\d{1,20}$/))
            .min(1)
            .max(4),
          basis: z.string().trim().min(1, '收入费用项目必须提供来源依据').max(500),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((v, ctx) => {
    const seen: string[] = [];
    for (const group of Object.values(v.groups))
      for (const code of group.accounts) {
        if (seen.some((old) => old.startsWith(code) || code.startsWith(old)))
          ctx.addIssue({ code: 'custom', message: `收入费用取数范围重复：${code}` });
        seen.push(code);
      }
  });
export type ActivityTotalsMapping = z.infer<typeof ActivityTotalsMappingSchema>;

/** 只填收入费用的合计列，不推断限定性，不将未接入的互转/调整或净变动补零。 */
export function activity402TotalsTemplate(raw: ActivityTotalsMapping): ReportTemplate {
  const mapping = ActivityTotalsMappingSchema.parse(raw);
  const t = nonprofitFormDraft('402', Math.floor(mapping.period / 100));
  t.name = '民非业务活动表（收入费用合计取数切片，限定性未接入）';
  t.cells.find((c) => c.address === 'A1')!.source =
    '业务活动表（合计取数切片，限定性及净资产互转未接入）';
  t.cells.find((c) => c.address === 'A3')!.source =
    `依据期间${mapping.period}；仅已过账；排除pnl，保留自定义转账；不是完整法定报表`;
  const row = (id: string) => activityRows.findIndex((r) => r.id === id) + 5;
  const replace = (address: string, source: string) => {
    t.cells = t.cells.filter((c) => c.address !== address);
    t.cells.push({ address, source, kind: 'formula', unit: 'cents', currency: 'CNY' });
  };
  for (const [col, range] of [
    ['D', 'month'],
    ['G', 'ytd'],
  ] as const) {
    for (const id of [...incomeIds, ...expenseIds]) {
      const source = `SUM(${mapping.groups[id].accounts.map((a) => activityMovement(a, range)).join(',')})`;
      replace(
        `${col}${row(id)}`,
        (expenseIds as readonly string[]).includes(id) ? `-(${source})` : source,
      );
    }
    replace(
      `${col}${row('incomeTotal')}`,
      `SUM(${incomeIds.map((id) => `${col}${row(id)}`).join(',')})`,
    );
    replace(
      `${col}${row('expenseTotal')}`,
      `SUM(${expenseIds.map((id) => `${col}${row(id)}`).join(',')})`,
    );
  }
  for (const [id, source] of Object.entries(mapping.groups)) {
    const n = ++t.rows;
    t.cells.push(
      textCell(
        `A${n}`,
        `${id}合计来源 ${source.accounts.join('、')}：${source.basis}；不代表限定性分类`,
      ),
    );
    t.merges.push({ row: n, col: 1, rows: 1, cols: t.cols });
  }
  t.reportIdentity = 'nonprofit-activity402-totals';
  t.profile = { version: 1, kind: t.reportIdentity, scope: 'posted', period: mapping.period, mapping };
  return ReportTemplateSchema.parse(t);
}

/** 供共享事务门禁调用的只读检查；当前公共generate尚未注册。 */
export async function checkActivityTotalsSources(
  svc: CoreServices,
  period: number,
  raw: ActivityTotalsMapping,
  generation = { includeUnposted: false },
): Promise<void> {
  const mapping = ActivityTotalsMappingSchema.parse(raw);
  if (generation.includeUnposted) throw new Error('业务活动表合计取数只允许已过账');
  if (period !== mapping.period) throw new Error('业务活动表来源依据期间不匹配');
  if ((await svc.book.info()).product !== 'minfei') throw new Error('请选择民非企账套');
  await svc.periods.require(period);
  const pnl = new Set((await svc.accounts.categories()).filter((c) => c.isPnl).map((c) => c.id));
  const accounts = await svc.accounts.list();
  const scopes = Object.values(mapping.groups).flatMap((g) => g.accounts);
  for (const code of scopes)
    if (!pnl.has((await svc.accounts.require(code)).categoryId))
      throw new Error(`收入费用来源不是损益类科目：${code}`);
  const rows = await svc.ledger.balances({
    periodFrom: Math.floor(period / 100) * 100 + 1,
    periodTo: period,
    rollup: false,
    excludeClosingKinds: ['pnl'],
  });
  for (const r of rows)
    if (
      pnl.has(accounts.find((a) => a.id === r.accountId)!.categoryId) &&
      (r.debit !== 0 || r.credit !== 0 || r.ytdDebit !== 0 || r.ytdCredit !== 0) &&
      !scopes.some((s) => r.accountCode.startsWith(s))
    )
      throw new Error(`尚有未映射的收入费用发生额：${r.accountCode}`);
}
