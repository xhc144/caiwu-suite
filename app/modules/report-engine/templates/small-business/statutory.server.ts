import { createHash } from 'node:crypto';
import { BusinessError, type BalanceRow, type EntryRow, type VoucherFilter } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  ConfigurationSchema,
  initialConfiguration,
  resolveRoles,
  initialDetails,
  problem,
  type Configuration,
} from './configuration';
import {
  balanceSheet,
  incomeStatement,
  cashflowStatement,
  developmentAdjustment,
  type DomainData,
  type Scope,
  type Statement,
} from './statements';
import type { FilingMode } from './catalogue';
import { historicalOpeningBalances, openingHistory } from './opening-history';
import { effectiveBalanceRole, analysisDestinations } from './statements';
import { rowKey } from './configuration';

export const smallBusinessDescriptor = {
  id: 'small-business',
  version: 1,
  regime: 'small-business',
  name: '小企业会计准则',
  sources: [
    { file: 'rules/sources/official/small-appendix.pdf', pages: '68—82' },
    { file: 'rules/sources/official/small-standard.pdf', pages: '全文' },
    {
      file: 'rules/sources.json',
      pages: '财会〔2016〕22号：税金及附加更名',
    },
  ],
  reports: [
    { code: '301', name: '资产负债表' },
    { code: '302', name: '利润表' },
    { code: '303', name: '现金流量表' },
  ],
} as const;
const key = 'statutory.small-business.configuration';
export async function loadConfiguration(svc: CoreServices): Promise<Configuration> {
  if (svc.moduleId !== 'report-engine') problem('MODULE', '请从报表管理读取配置');
  const book = await svc.book.info();
  if (book.regime !== 'small-business')
    problem('REGIME', '当前账套采用的会计制度不是小企业会计准则');
  const stored = await svc.settings.get<Configuration | null>(key, null);
  if (stored) {
    const parsed = ConfigurationSchema.safeParse(stored);
    if (!parsed.success) problem('CONFIGURATION', '已保存的报表配置不完整，请在配置页重新确认');
    return parsed.data;
  }
  const initial = initialConfiguration(book.id);
  initial.details = initialDetails(await svc.accounts.list({ includeDisabled: true }), initial);
  return initial;
}
/** 公共路由在其事务内调用；本函数不另起事务，不写凭证或期间状态。 */
export async function saveConfiguration(
  svc: CoreServices,
  raw: Configuration,
  expectedRevision: number,
) {
  await svc.permissions.require('report-engine.edit');
  if (!svc.db.isTransaction) problem('TRANSACTION', '保存报表配置必须在同一账套事务内完成');
  if (svc.moduleId !== 'report-engine') problem('MODULE', '请从报表管理保存配置');
  const parsed = ConfigurationSchema.safeParse(raw);
  if (!parsed.success)
    problem('CONFIGURATION', '配置尚未填写完整，或金额、日期和依据不合法，请检查配置页');
  const config = parsed.data;
  const old = await loadConfiguration(svc);
  const book = await svc.book.info();
  if (config.bookId !== book.id) problem('BOOK', '配置不属于当前账套');
  if (old.revision !== expectedRevision || config.revision !== expectedRevision)
    problem('REVISION', '配置已由其他操作更新，请刷新后保存');
  const accounts = await svc.accounts.list({ includeDisabled: true }),
    resolved = resolveRoles(accounts, config);
  for (const scope of config.cashScope) {
    if (
      !accounts.some((a) => a.code === scope.account && a.isLeaf) ||
      resolved.get(scope.account) !== 'money'
    )
      problem(
        'CASH_SCOPE',
        `现金范围中的${scope.account}不是当前有效的货币资金末级科目`,
        scope.account,
      );
    for (const date of [scope.from, scope.to])
      if (Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)
        problem('CASH_DATE', `${scope.account}现金范围的日期不合法`, scope.account);
    if (scope.from > scope.to)
      problem('CASH_DATE', `${scope.account}现金范围的开始日期晚于截止日期`, scope.account);
  }
  for (const [index, scope] of config.cashScope.entries())
    if (
      config.cashScope
        .slice(0, index)
        .some(
          (old) => old.account === scope.account && old.from <= scope.to && scope.from <= old.to,
        )
    )
      problem(
        'CASH_SCOPE',
        `${scope.account}的现金范围日期重叠，请修改或移除重复范围`,
        scope.account,
      );
  for (const code of Object.keys(config.details))
    if (!accounts.some((a) => a.code === code && a.isLeaf))
      problem('DETAIL', `${code}费用明细映射不是当前末级科目，请重新确认`, code);
  const next = { ...config, revision: old.revision + 1 };
  await svc.settings.set(key, next);
  return next;
}
export type PreparedSmallBusiness = {
  descriptor: typeof smallBusinessDescriptor;
  period: number;
  mode: FilingMode;
  bookId: string;
  orgName: string;
  configuration: Configuration;
  sourceBinding: string;
  statements: [Statement, Statement, Statement];
  comparisonNote: string | null;
  unpostedCount: number;
};
function months(from: number, to: number) {
  const values: number[] = [];
  let p = from;
  while (p <= to) {
    values.push(p);
    p = p % 100 === 12 ? (Math.floor(p / 100) + 1) * 100 + 1 : p + 1;
  }
  return values;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** 唯一公共生成事务传入其svc。返回本域金额、来源、审核及绑定，由公共入口原子保存成功快照。 */
export async function prepareSmallBusiness(
  svc: CoreServices,
  input: { period: number; mode: FilingMode; confirmUnposted?: boolean },
): Promise<PreparedSmallBusiness> {
  await svc.permissions.require('report-engine.generate');
  if (!svc.db.isTransaction)
    problem('TRANSACTION', '生成报表必须在同一账套事务内读取来源并保存成功快照');
  const config = await loadConfiguration(svc),
    book = await svc.book.info();
  if (config.bookId !== book.id) problem('BOOK', '配置不属于当前账套');
  const year = Math.floor(input.period / 100),
    month = input.period % 100;
  if (year < 2000 || year > 2100 || month < 1 || month > 12)
    problem('PERIOD', '请选择合法报告月份');
  if (input.mode === 'annual' && month !== 12)
    problem('ANNUAL', '年报必须选择12月，取完整会计年度');
  if (input.period < book.startPeriod) problem('BEFORE_START', '报告月份早于账套启用月份');
  const comparison: Scope | null =
    input.mode === 'monthly'
      ? { from: input.period, to: input.period, label: '本月' }
      : Math.floor(book.startPeriod / 100) === year && config.firstYear?.year === year
        ? null
        : { from: (year - 1) * 100 + 1, to: (year - 1) * 100 + 12, label: '上年全年' };
  const scopes: [Scope, Scope | null] = [
    {
      from: year * 100 + 1,
      to: input.period,
      label: input.mode === 'annual' ? '本年全年' : '本年累计',
    },
    comparison,
  ];
  if (!comparison && config.firstYear?.year !== Math.floor(book.startPeriod / 100))
    problem('COMPARISON', '首年无比较数据声明与账套启用年度不一致');
  if (comparison && Math.floor(comparison.from / 100) < Math.floor(book.startPeriod / 100))
    problem('COMPARISON', '上年全年比较数据缺失；若本年确为企业首个会计年度，请填写首年依据');
  const periods = await svc.periods.list();
  const required = new Set(scopes.flatMap((s) => (s ? months(s.from, s.to) : [])));
  for (const p of required)
    if (p >= book.startPeriod)
      if (!periods.some((v) => v.period === p))
        problem('MISSING_PERIOD', `缺少会计期间 ${p}，请建立该期间并核实账务来源`, String(p));
  const accounts = await svc.accounts.list({ includeDisabled: true }),
    roles = resolveRoles(accounts, config);
  const needsHistory =
    book.startPeriod % 100 !== 1 &&
    scopes.some((s) => s && s.from < book.startPeriod && s.to >= book.startPeriod);
  const historyRows = needsHistory
    ? await svc.opening.list(Math.floor(book.startPeriod / 100))
    : [];
  const history = needsHistory
    ? openingHistory(accounts, historyRows, config, book.startPeriod, roles)
    : null;
  const balances = (from: number, to: number) =>
    svc.ledger.balances({
      periodFrom: from,
      periodTo: to,
      rollup: false,
      includeZero: true,
      includeUnposted: false,
      groupBy: ['partner', 'project', 'department', 'person'],
    });
  const entries = async (scope: Scope): Promise<EntryRow[]> => {
    const result = await svc.ledger.entries({
      periodFrom: Math.max(scope.from, book.startPeriod),
      periodTo: scope.to,
      includeUnposted: false,
      limit: 200000,
    });
    if (result.length >= 200000)
      problem('LIMIT', `${scope.label}明细达到查询上限，无法保证完整取数`);
    return [
      ...(history?.entries.filter((e) => e.period >= scope.from && e.period <= scope.to) ?? []),
      ...result,
    ];
  };
  const current = await entries(scopes[0]),
    comp = comparison ? await entries(comparison) : [];
  const closing = await balances(input.period, input.period),
    opening =
      year * 100 + 1 < book.startPeriod
        ? history!.balances
        : await balances(year * 100 + 1, year * 100 + 1);
  for (const row of [...closing, ...opening])
    if (
      !roles.has(row.accountCode) &&
      [row.opening, row.closing, row.debit, row.credit].some(Boolean)
    )
      problem('UNMAPPED', `科目 ${row.accountCode} 未指定中文业务角色`, row.accountCode);
  for (const e of [...current, ...comp])
    if (!roles.has(e.accountCode))
      problem('UNMAPPED', `科目 ${e.accountCode} 的发生额未指定业务角色`, e.accountCode);
  const closingKinds = new Map<number, string | null>();
  const voucherRevisions: unknown[] = [];
  for (const id of new Set([...current, ...comp].map((e) => e.voucherId))) {
    if (id < 0) continue;
    const v = await svc.vouchers.get(id);
    if (!v) problem('SOURCE', `来源凭证 ${id} 已不存在`);
    closingKinds.set(id, v.closingKind);
    voucherRevisions.push([v.id, v.revision, v.status, v.closingKind]);
  }
  const unpostedRange = {
    periodFrom: Math.min(...scopes.flatMap((scope) => (scope ? [scope.from] : []))),
    periodTo: Math.max(...scopes.flatMap((scope) => (scope ? [scope.to] : []))),
    statuses: ['draft', 'pending', 'audited'],
  } satisfies VoucherFilter;
  const unposted = await svc.vouchers.list({
    ...unpostedRange,
    limit: 10000,
  });
  const unpostedHeaders = [...unposted.items];
  for (let offset = unpostedHeaders.length; offset < unposted.total; offset += 10000) {
    const page = await svc.vouchers.list({
      ...unpostedRange,
      limit: 10000,
      offset,
    });
    unpostedHeaders.push(...page.items);
  }
  if (unposted.total && !input.confirmUnposted)
    throw new BusinessError({
      code: 'SMALL_REPORT_UNPOSTED',
      message: `报告范围内有 ${unposted.total} 张未过账凭证，请确认按仅已过账口径生成`,
      hint: '可先查看相关凭证，或确认以仅已过账口径继续生成。',
      details: {
        count: unposted.total,
        from: unpostedRange.periodFrom,
        to: unpostedRange.periodTo,
        confirmation: 'confirmUnposted',
      },
      actions: [
        { status: 'draft', label: '草稿' },
        { status: 'pending', label: '待审核凭证' },
        { status: 'audited', label: '已审核凭证' },
      ].map((v) => ({
        label: `查看${v.label}`,
        to: `/m/voucher-book?period=${unpostedRange.periodFrom}&periodTo=${unpostedRange.periodTo}&status=${v.status}`,
      })),
    });
  const data: DomainData = {
    accounts,
    roles,
    closing,
    opening,
    current,
    comparison: comp,
    unclosed: closing,
    unclosedOpening: opening,
    scopes,
    period: input.period,
    mode: input.mode,
    config: history
      ? { ...config, cashAllocations: { ...config.cashAllocations, ...history.allocations } }
      : config,
    closingKinds,
  };
  const cashBalances: [
    { opening: BalanceRow[]; closing: BalanceRow[] },
    { opening: BalanceRow[]; closing: BalanceRow[] } | null,
  ] = [
    { opening, closing },
    comparison
      ? {
          opening:
            comparison.from < book.startPeriod
              ? history!.balances
              : await balances(comparison.from, comparison.from),
          closing: await balances(comparison.to, comparison.to),
        }
      : null,
  ];
  data.developmentAdjustments = [
    developmentAdjustment(
      cashBalances[0].opening,
      cashBalances[0].closing,
      scopes[0],
      config,
      roles,
    ),
    comparison && cashBalances[1]
      ? developmentAdjustment(
          cashBalances[1].opening,
          cashBalances[1].closing,
          comparison,
          config,
          roles,
        )
      : null,
  ];
  const statements: [Statement, Statement, Statement] = [
    balanceSheet(data),
    incomeStatement(data),
    cashflowStatement(data, cashBalances),
  ];
  const sourceBinding = digest({
    book,
    config,
    accounts,
    current,
    comp,
    closing,
    opening,
    cashBalances,
    voucherRevisions,
    periods,
    historyRows,
    unpostedRange,
    unpostedHeaders,
  });
  return {
    descriptor: smallBusinessDescriptor,
    period: input.period,
    mode: input.mode,
    bookId: book.id,
    orgName: book.orgName,
    configuration: config,
    sourceBinding,
    statements,
    comparisonNote: comparison ? null : `首个会计年度，无上年比较数据：${config.firstYear!.reason}`,
    unpostedCount: unposted.total,
  };
}
export function assertSmallBusinessOutput(prepared: PreparedSmallBusiness) {
  for (const [index, count] of [53, 32, 22].entries()) {
    const report = prepared.statements[index];
    if (!report || report.rows.length !== count || report.checks.length === 0)
      problem('INCOMPLETE', '三表快照缺少完整行次或审核结果，请重新生成');
    for (const [i, row] of report.rows.entries()) {
      if (row.line !== i + 1) problem('INCOMPLETE', `${report.name}行次不完整，请重新生成`);
      for (const column of [0, 1]) {
        const a = row.amounts[column];
        if (!a) {
          if (column === 0 || index === 0 || !prepared.comparisonNote)
            problem('INCOMPLETE', `${report.name}行${row.line}缺少金额及来源`);
          continue;
        }
        if (!Number.isSafeInteger(a.value) || !a.formula.trim())
          problem('INCOMPLETE', `${report.name}行${row.line}金额或取数依据无效`);
      }
    }
  }
  const failures = prepared.statements.flatMap((s) =>
    s.checks
      .filter((c) => c.difference !== 0)
      .map(
        (c) =>
          `${s.name} ${s.columns[c.column]} 行${c.line} ${c.name}，差额 ${(c.difference / 100).toFixed(2)} 元`,
      ),
  );
  if (failures.length) problem('CHECK', failures.join('；'), 'checks');
}
export function assertSameSource(saved: PreparedSmallBusiness, fresh: PreparedSmallBusiness) {
  if (saved.sourceBinding !== fresh.sourceBinding)
    problem('STALE', '账务、期间或报表配置已改变，请重新生成后导出或打印');
  assertSmallBusinessOutput(fresh);
  if (digest(saved.statements) !== digest(fresh.statements))
    problem('SNAPSHOT', '已保存快照与当前来源计算不一致，请重新生成后输出');
}
/** 配置页读取真实末级、往来明细、费用与现金分录；不依赖生成先成功。公共查询挂接此入口。 */
export async function smallBusinessConfigurationData(
  svc: CoreServices,
  period: number,
  mode: FilingMode = 'monthly',
) {
  await svc.permissions.require('report-engine.view');
  await svc.periods.require(period);
  const book = await svc.book.info(),
    configuration = await loadConfiguration(svc),
    accounts = await svc.accounts.list({ includeDisabled: true });
  const roles = resolveRoles(accounts, configuration, { allowStaleMappings: true }),
    year = Math.floor(period / 100);
  const from = Math.max((year - 1) * 100 + 1, book.startPeriod);
  const entries = await svc.ledger.entries({
    periodFrom: from,
    periodTo: period,
    includeUnposted: false,
    limit: 200000,
  });
  if (entries.length >= 200000) problem('LIMIT', '明细达到查询上限，无法保证配置来源完整');
  const closing = await svc.ledger.balances({
    periodFrom: period,
    periodTo: period,
    rollup: false,
    includeZero: true,
    groupBy: ['partner', 'project', 'department', 'person'],
  });
  const openingRows = await svc.opening.list(Math.floor(book.startPeriod / 100));
  const historical = historicalOpeningBalances(accounts, openingRows);
  const opening =
    year * 100 + 1 < book.startPeriod
      ? historical
      : await svc.ledger.balances({
          periodFrom: year * 100 + 1,
          periodTo: year * 100 + 1,
          rollup: false,
          includeZero: true,
          groupBy: ['partner', 'project', 'department', 'person'],
        });
  const analysisRows = [
    ...closing.map((row) => ({ period, row, balance: row.closing })),
    ...opening.map((row) => ({ period: (year - 1) * 100 + 12, row, balance: row.opening })),
  ].flatMap((a) => {
    const mapped = roles.get(a.row.accountCode);
    if (!mapped || !a.balance) return [];
    const role = effectiveBalanceRole(mapped, a.balance),
      destinations = analysisDestinations[role];
    return destinations ? [{ ...a, destinations }] : [];
  });
  const scopeFrom = mode === 'monthly' ? period : (year - 1) * 100 + 1;
  if (Math.floor(scopeFrom / 100) >= Math.floor(book.startPeriod / 100)) {
    const starts =
      scopeFrom < book.startPeriod
        ? historical
        : await svc.ledger.balances({
            periodFrom: scopeFrom,
            periodTo: scopeFrom,
            rollup: false,
            groupBy: ['partner', 'project', 'department', 'person'],
          });
    const at = scopeFrom % 100 === 1 ? (Math.floor(scopeFrom / 100) - 1) * 100 + 12 : scopeFrom - 1;
    for (const row of starts)
      if (
        roles.get(row.accountCode) === 'development' &&
        row.opening &&
        !analysisRows.some((a) => a.period === at && rowKey(a.row) === rowKey(row))
      )
        analysisRows.push({
          period: at,
          row,
          balance: row.opening,
          destinations: analysisDestinations.development!,
        });
  }
  return {
    book,
    configuration,
    accounts,
    entries,
    analysisRows,
    openingRows: historical.map((row) => ({
      key: rowKey(row),
      label: `${row.accountCode} ${row.accountName} ${rowKey(row)}`,
      ytdDebit: row.ytdDebit,
      ytdCredit: row.ytdCredit,
      role: roles.get(row.accountCode),
    })),
  };
}
