import { z } from 'zod';
import { isPeriod, sumCents, type EntryRow } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { balanceFormula, ReportTemplateSchema, type ReportTemplate } from '../../shared';
import { cashflowDetails, cashflowRows, nonprofitFormDraft, textCell } from './forms';

const evidence = z.string().trim().min(1, '必须提供分类依据').max(500);
const item = z.object({ code: z.string().min(1).max(40), basis: evidence }).strict();
export const CashflowYearSourceSchema = z
  .object({
    year: z.number().int().min(2026).max(9999),
    policyBasis: evidence,
    // 只支持明确选择的末级账户，避免父子科目重复计数；限制数量以遵守引擎公式预算。
    accounts: z
      .array(z.object({ code: z.string().regex(/^\d{1,20}$/), basis: evidence }).strict())
      .min(1)
      .max(4),
    excludedAccounts: z.array(
      z.object({ code: z.string().regex(/^\d{1,20}$/), basis: evidence }).strict(),
    ),
    items: z.record(z.string(), item),
    internalTransfer: item,
  })
  .strict()
  .superRefine((v, ctx) => {
    const expected = cashflowDetails.map((r) => r.id);
    for (const id of expected)
      if (!v.items[id]) ctx.addIssue({ code: 'custom', message: `缺少现金流量项目映射：${id}` });
    for (const id of Object.keys(v.items))
      if (!expected.includes(id))
        ctx.addIssue({ code: 'custom', message: `未知现金流量项目：${id}` });
    const codes = [...Object.values(v.items).map((i) => i.code), v.internalTransfer.code];
    if (new Set(codes).size !== codes.length)
      ctx.addIssue({ code: 'custom', message: '现金流量项目不能重复映射或与内部划转共用' });
    const accounts = [...v.accounts, ...v.excludedAccounts].map((a) => a.code);
    if (new Set(accounts).size !== accounts.length)
      ctx.addIssue({ code: 'custom', message: '现金账户不能重复或同时列入排除清单' });
  });
export const Cashflow403MappingSchema = CashflowYearSourceSchema.refine(
  (v) => v.year === 2026,
  '首次执行取数切片仅支持2026；其他年度须提供比较来源',
);
export type Cashflow403Mapping = z.infer<typeof Cashflow403MappingSchema>;
export type CashflowYearSource = z.infer<typeof CashflowYearSourceSchema>;

function movement(account: string, cashflow?: string) {
  const term = (metric: 'ytdDebit' | 'ytdCredit') =>
    balanceFormula({
      account,
      metric,
      unit: 'cents',
      currency: 'CNY',
      direction: 'signed',
      dimension: cashflow ? 'cashflow' : 'none',
      item: cashflow ?? '',
    });
  return `(${term('ytdDebit')}-${term('ytdCredit')})`;
}

/** 2026本年取数切片；调用前须逐期间运行 checkCashflow403Sources，尚无自动挂载入口。 */
export function cashflow403Template(raw: Cashflow403Mapping, period: number): ReportTemplate {
  const mapping = Cashflow403MappingSchema.parse(raw);
  if (!isPeriod(period) || Math.floor(period / 100) !== mapping.year)
    throw new Error('现金流量分类报告期必须属于来源年度');
  const t = nonprofitFormDraft('403', mapping.year);
  t.name = '民非现金流量表（2026本年取数切片）';
  t.cells = t.cells.filter((c) => !/^B(?:[5-9]|[1-3]\d|4[01])$/.test(c.address));
  t.cells = t.cells.filter((c) => !['A1', 'A3'].includes(c.address));
  t.cells.unshift(textCell('A1', '现金流量表（2026本年取数切片，未完成制度报表接入）'));
  t.cells.push(textCell('A3', '编制单位：待填；仅已过账；每次生成前须检查分类；年度须为2026'));
  const amount = (address: string, source: string) =>
    t.cells.push({ address, source, kind: 'formula', unit: 'cents', currency: 'CNY' });
  cashflowRows.forEach((r, i) => {
    if (r.section) return;
    const source =
      r.total ??
      `SUM(${mapping.accounts.map((a) => movement(a.code, mapping.items[r.id]!.code)).join(',')})`;
    amount(`B${i + 5}`, !r.total && r.outflow ? `-(${source})` : source);
  });
  t.checks = [
    {
      name: '分类净额等于选定现金及现金等价物账户本年变动',
      left: 'B41',
      right: `SUM(${mapping.accounts.map((a) => movement(a.code)).join(',')})`,
      tolerance: '0',
    },
  ];
  t.cells.push(textCell('A43', `现金及现金等价物政策依据：${mapping.policyBasis}`));
  t.merges.push({ row: 43, col: 1, rows: 1, cols: 3 });
  // 原表样中已有 B 列格式，追加政策说明的格式，不制造重复地址。
  t.styles.push({ address: 'A43', align: 'left', wrap: true, bold: false, format: 'general' });
  const sources = [
    ...mapping.accounts.map((a) => `现金账户 ${a.code}：${a.basis}`),
    ...mapping.excludedAccounts.map((a) => `排除账户 ${a.code}：${a.basis}`),
    ...cashflowDetails.map(
      (r) => `${r.label} ← ${mapping.items[r.id]!.code}：${mapping.items[r.id]!.basis}`,
    ),
    `内部划转 ${mapping.internalTransfer.code}：${mapping.internalTransfer.basis}`,
  ];
  t.rows = 45 + sources.length;
  sources.forEach((source, i) => {
    const row = 46 + i;
    t.cells.push(textCell(`A${row}`, source));
    t.merges.push({ row, col: 1, rows: 1, cols: 3 });
    t.styles.push({
      address: `A${row}`,
      align: 'left',
      wrap: true,
      bold: false,
      format: 'general',
    });
  });
  t.reportIdentity = 'nonprofit-cashflow403';
  t.profile = { mode: 'declaration', version: 1, kind: t.reportIdentity, scope: 'posted', period, mapping };
  return ReportTemplateSchema.parse(t);
}

/**
 * 只读预检：实际分录的现金流量维度是分类来源，普通项目不参与。
 * 与生成尚不是同一事务；共享 owner 接入前，不宣称是可直接提交的完整报表。
 */
export async function checkCashflow403Sources(
  svc: CoreServices,
  period: number,
  raw: Cashflow403Mapping,
  generation: { includeUnposted: boolean } = { includeUnposted: false },
): Promise<void> {
  const mapping = Cashflow403MappingSchema.parse(raw);
  if (generation.includeUnposted)
    throw new Error('民非现金流量取数只允许已过账；不能用确认按钮绕过口径');
  if (!Number.isInteger(period) || Math.floor(period / 100) !== 2026)
    throw new Error('本切片仅支持2026；2027起必须接入上年比较数');
  await svc.periods.require(period);
  const info = await svc.book.info();
  if (info.product !== 'minfei') throw new Error('请选择民非企账套');
  if (info.startPeriod !== 202601)
    throw new Error('本切片要求2026年1月启用；现金流量缺少启用前分类时不能补零');
  await checkCashflowSourceRange(svc, 202601, period, mapping);
}

/** 比较栏和本年栏各自调用，逐期使用各自映射；仍须由公共生成事务挂载。 */
export async function checkCashflowSourceRange(
  svc: CoreServices,
  periodFrom: number,
  period: number,
  raw: CashflowYearSource,
): Promise<void> {
  const mapping = CashflowYearSourceSchema.parse(raw);
  const info = await svc.book.info();
  if (info.product !== 'minfei') throw new Error('请选择民非企账套');
  if (periodFrom !== mapping.year * 100 + 1 || Math.floor(period / 100) !== mapping.year)
    throw new Error('现金流量来源年度与取数范围不一致');
  if (info.startPeriod > periodFrom) throw new Error('启用前现金流量分类来源未知，不能补零');
  await svc.periods.require(periodFrom);
  await svc.periods.require(period);
  if (
    (await svc.periods.list()).filter((p) => p.period >= periodFrom && p.period <= period)
      .length !==
    period % 100
  )
    throw new Error('现金流量取数范围内存在未建立期间，不能补零');
  const allAccounts = await svc.accounts.list();
  const cashRoots = allAccounts.filter((a) => a.isCash || a.isBank);
  const isCashAccount = (code: string) => cashRoots.some((root) => code.startsWith(root.code));
  const selected = new Set(mapping.accounts.map((a) => a.code));
  const covered = new Set([...selected, ...mapping.excludedAccounts.map((a) => a.code)]);
  for (const code of covered) {
    const a = await svc.accounts.require(code);
    // 停用限制新增业务，不应使历史报表无法读取既有分录。
    if (!a.isLeaf || a.direction !== 'debit')
      throw new Error(`现金及现金等价物范围必须使用借方末级科目：${code}`);
    if (selected.has(code) && !isCashAccount(code))
      throw new Error(`本切片仅支持现金和可随时支付的银行账户；其他现金等价物尚未接入：${code}`);
  }
  for (const a of allAccounts)
    if (a.isLeaf && isCashAccount(a.code) && !covered.has(a.code))
      throw new Error(`现金/银行账户尚未明确纳入或排除：${a.code}`);
  const cfIds = new Set<number>();
  for (const spec of [...Object.values(mapping.items), mapping.internalTransfer]) {
    const d = await svc.dimensions.getByCode('cashflow', spec.code);
    if (!d || !d.isLeaf) throw new Error(`请选择存在的末级现金流量项目：${spec.code}`);
    cfIds.add(d.id);
  }
  const internal = (await svc.dimensions.getByCode('cashflow', mapping.internalTransfer.code))!;
  const entries: EntryRow[] = [];
  for (const accountCode of selected) {
    const rows = await svc.ledger.entries({
      periodFrom,
      periodTo: period,
      accountCode,
      includeChildren: false,
      includeUnposted: false,
      limit: 200_000,
    });
    if (rows.length >= 200_000) throw new Error('现金流量分录达到查询上限，不能保证完整分类');
    entries.push(...rows);
  }
  const internalVouchers = new Set<number>();
  for (const e of entries) {
    const id = e.dimensions.cashflow;
    if (id == null || !cfIds.has(id))
      throw new Error(`现金分录未分类或使用未映射项目：${e.displayNo} 第${e.lineNo}行`);
    if (id === internal.id) internalVouchers.add(e.voucherId);
  }
  for (const id of internalVouchers) {
    const voucher = (await svc.vouchers.get(id))!;
    const accountIds = new Set(allAccounts.filter((a) => selected.has(a.code)).map((a) => a.id));
    if (
      voucher.lines.some(
        (l) => !accountIds.has(l.accountId) || l.dimensions.cashflow !== internal.id,
      ) ||
      sumCents(voucher.lines.map((l) => l.debit)) !== sumCents(voucher.lines.map((l) => l.credit))
    )
      throw new Error(`内部划转必须完全发生在选定现金账户之间且全部标为内部划转：${id}`);
  }
}

/** 公共profile注册点在generate的同一svc.tx回调调用此门禁。 */
export type Cashflow403GenerateGuard = {
  kind: 'nonprofit-cashflow403';
  year: 2026;
  scope: 'posted';
  mapping: Cashflow403Mapping;
};
export function cashflow403GenerateGuard(raw: Cashflow403Mapping): Cashflow403GenerateGuard {
  return {
    kind: 'nonprofit-cashflow403',
    year: 2026,
    scope: 'posted',
    mapping: Cashflow403MappingSchema.parse(raw),
  };
}
export async function validateCashflow403Generation(
  transactionalSvc: CoreServices,
  input: { period: number; includeUnposted: boolean },
  guard: Cashflow403GenerateGuard,
): Promise<void> {
  if (guard.kind !== 'nonprofit-cashflow403' || guard.year !== 2026 || guard.scope !== 'posted')
    throw new Error('民非现金流量生成门禁定义无效');
  await checkCashflow403Sources(transactionalSvc, input.period, guard.mapping, input);
}
