import { createHash } from 'node:crypto';
import {
  BusinessError,
  makePeriod,
  periodYear,
  periodRange,
  type VoucherHeader,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  parseEnterpriseConfiguration,
  FORMAT,
  type EnterpriseConfig,
  type SourceData,
} from './model';
import { calculateEnterprise, enterpriseRanges } from './calculate';
import { suggestEnterpriseRules, suggestEnterpriseCashProjects } from './mapping';
export const enterpriseDescriptors = [
  { key: 'balance', code: '201', name: '资产负债表', annualOnly: false },
  { key: 'profit', code: '202', name: '利润表', annualOnly: false },
  { key: 'cashflow', code: '203', name: '现金流量表', annualOnly: false },
  { key: 'equity', code: '204', name: '所有者权益变动表', annualOnly: true },
] as const;
export const enterpriseRegistration = {
  format: FORMAT,
  regime: 'enterprise',
  products: ['qingsong', 'chengben'],
  group: 'report',
  descriptors: enterpriseDescriptors,
} as const;
function problem(message: string): never {
  throw new BusinessError({
    code: 'REPORT_ENTERPRISE_SOURCE',
    message,
    hint: '请核实报告日、科目和分类来源后重新确认；上次成功报表保留。',
    actions: [{ label: '报表管理', to: '/m/report-engine' }],
  });
}
function assertContext(svc: CoreServices) {
  if (svc.moduleId !== 'report-engine') problem('请通过报表管理执行此操作');
}
export async function readEnterpriseSources(
  svc: CoreServices,
  c: EnterpriseConfig,
): Promise<SourceData> {
  assertContext(svc);
  const book = await svc.book.info(),
    accounts = await svc.accounts.list(),
    categories = await svc.accounts.categories(),
    periods = await svc.periods.list(),
    ranges = enterpriseRanges(c),
    y = periodYear(c.period);
  if (book.regime !== 'enterprise') problem('当前账套不适用企业准则报表');
  const needed = new Set([
    c.period,
    ranges.balancePrevious,
    ranges.current.from,
    ranges.previous.from,
    ranges.previous.to,
  ]);
  if (c.scope === 'annual') needed.add(makePeriod(y - 2, 12));
  for (const range of [ranges.current, ranges.previous])
    for (const p of periodRange(range.from, range.to)) await svc.periods.require(p);
  const balances: SourceData['balances'] = {};
  for (const p of needed) {
    await svc.periods.require(p);
    balances[p] = await svc.ledger.balances({
      periodFrom: p,
      periodTo: p,
      groupBy: ['partner', 'project', 'department', 'person'],
      rollup: false,
      includeZero: true,
      includeUnposted: false,
    });
  }
  const entries = await svc.ledger.entries({
    periodFrom: book.startPeriod,
    periodTo: c.period,
    includeUnposted: false,
    limit: 200000,
  });
  if (entries.length >= 200000)
    problem('分录达到读取上限，无法保证现金及权益事件完整；请先核实来源范围');
  const vouchers: VoucherHeader[] = [];
  for (let offset = 0; ; offset += 10000) {
    const page = await svc.vouchers.list({
      periodFrom: book.startPeriod,
      periodTo: c.period,
      statuses: ['posted'],
      offset,
      limit: 10000,
    });
    vouchers.push(...page.items);
    if (vouchers.length >= page.total) break;
    if (!page.items.length) problem('凭证分页来源不完整');
  }
  return {
    bookId: book.id,
    orgName: book.orgName,
    regime: book.regime,
    startPeriod: book.startPeriod,
    accounts,
    pnlCategoryIds: categories.filter((c) => c.isPnl).map((c) => c.id),
    balances,
    entries,
    vouchers,
    periods: periods.map((p) => p.period),
    cashflowItems: await svc.dimensions.items('cashflow'),
    openingSources: (
      await Promise.all(
        [
          ...new Set(periods.filter((p) => p.period <= c.period).map((p) => periodYear(p.period))),
        ].map((y) => svc.opening.list(y)),
      )
    ).flat(),
  };
}
const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
function calculateSafely(c: EnterpriseConfig, d: SourceData) {
  try {
    return calculateEnterprise(c, d);
  } catch (e) {
    if (e instanceof BusinessError) throw e;
    return problem(e instanceof Error ? e.message : '企业报表计算失败');
  }
}
/** 必须由公共保存事务传入tsvc；本域不另建配置存储。 */
export async function prepareEnterprise(svc: CoreServices, raw: EnterpriseConfig) {
  assertContext(svc);
  await svc.permissions.require('report-engine.edit');
  const configuration = parseEnterpriseConfiguration(raw),
    source = await readEnterpriseSources(svc, configuration);
  calculateSafely(configuration, source);
  return { configuration, sourceDigest: fingerprint(source) };
}
export async function verifyEnterprise(
  svc: CoreServices,
  raw: EnterpriseConfig,
  sourceDigest: string,
  requestedPeriod: number,
) {
  assertContext(svc);
  const configuration = parseEnterpriseConfiguration(raw);
  if (configuration.period !== requestedPeriod)
    problem('报告期间与已确认分类报告日不一致，请重新确认两个日期');
  const source = await readEnterpriseSources(svc, configuration);
  if (fingerprint(source) !== sourceDigest)
    problem('科目、期初、凭证或来源已变化，请核实后明确重新确认');
  return { configuration, source };
}
export async function generateEnterprise(
  svc: CoreServices,
  input: {
    configuration: EnterpriseConfig;
    sourceDigest: string;
    period: number;
    confirmUnposted?: boolean;
  },
) {
  assertContext(svc);
  await svc.permissions.require('report-engine.generate');
  const { configuration, source } = await verifyEnterprise(
      svc,
      input.configuration,
      input.sourceDigest,
      input.period,
    ),
    ranges = enterpriseRanges(configuration);
  const from = Math.min(source.startPeriod, ranges.previous.from),
    pending = await svc.vouchers.list({
      periodFrom: from,
      periodTo: input.period,
      statuses: ['draft', 'pending', 'audited'],
      limit: 1,
    });
  if (pending.total && !input.confirmUnposted)
    return { kind: 'confirmation' as const, count: pending.total, from, to: input.period };
  const result = calculateSafely(configuration, source),
    failed = result.checks.filter((c) => c.difference !== '0');
  if (failed.length)
    problem(
      failed
        .map(
          (c) =>
            `${c.period} ${c.row} ${c.column === 'current' ? '本期' : '比较期'}差额${c.difference}；${c.hint}`,
        )
        .join('；'),
    );
  return { kind: 'generated' as const, result, unpostedCount: pending.total };
}
export async function enterpriseConfiguration(svc: CoreServices) {
  assertContext(svc);
  await svc.permissions.require('report-engine.view');
  const cashflowItems = await svc.dimensions.items('cashflow');
  return {
    ...suggestEnterpriseRules(await svc.accounts.list()),
    cashflowItems,
    cashProjectSuggestions: suggestEnterpriseCashProjects(cashflowItems),
  };
}
