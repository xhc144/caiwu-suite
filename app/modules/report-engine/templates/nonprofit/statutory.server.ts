import type { CoreServices } from '@caiwu/core/server';
import type { BookInfo } from '@caiwu/core';
import {
  ConfigurationSchema,
  RequestSchema,
  mappedRow,
  standardAccounts,
  incomeIds,
  expenseIds,
  type Configuration,
  type Sources,
  type Statement,
  type StatementRequest,
} from './model';
import { readNonprofitSources, sourceFingerprint } from './sources.server';
import { activityStatement, classifyActivity, classifyNetAssetEvents } from './activity';
import { balanceStatement, balanceTargets } from './balance';
import { cashflowStatement } from './cashflow';
import { attachComparative } from './comparative';
import { retrospectiveBridge } from './retrospective';
import { validateResourceRollforward } from './resource-control';
import { validatePnlClosings, validateAdjustmentClosings } from './closing-control';

export const nonprofitCatalogue = {
  id: 'nonprofit-2026',
  version: 1,
  regime: 'nonprofit',
  effectiveFrom: '2026-01-01',
  source: '民间非营利组织会计制度（2026），第127—153页；财会〔2025〕6号，第4—5页',
  reports: [
    { code: '401', name: '资产负债表', periods: ['interim', 'annual'] },
    { code: '402', name: '业务活动表', periods: ['interim', 'annual'] },
    { code: '403', name: '现金流量表', periods: ['annual'] },
  ],
  applicable: (book: BookInfo) =>
    book.regime === 'nonprofit' && /^nonprofit-2026(?:$|-)/.test(book.templateId),
} as const;
export function validateConfiguration(raw: unknown, s: Sources): Configuration {
  const c = ConfigurationSchema.parse(raw);
  if (c.bookId !== s.book.id || c.year !== Math.floor(s.to / 100))
    throw new Error('来源配置属于其他账套或年度，请重新选择本账套本年度资料');
  if (
    c.recognitions.some((r) => Math.floor(r.line.period / 100) !== c.year) ||
    c.cashConfirmations.some((r) => Math.floor(r.line.period / 100) !== c.year) ||
    c.events.some((e) => Number(e.date.slice(0, 4)) !== c.year)
  )
    throw new Error('逐笔确认或净资产事件属于其他年度，请核对本年度来源');
  const seen = new Set<string>();
  const valid = new Set([
    ...balanceTargets,
    'fixedAllowance',
    'intangibleAllowance',
    'investmentAllowance',
    ...Object.values(standardAccounts),
  ]);
  for (const m of c.mappings) {
    const a = s.accounts.find((a) => a.code === m.account);
    if (!a?.isLeaf || seen.has(m.account) || !valid.has(m.row))
      throw new Error(`科目${m.account}映射重复、不存在或项目无效`);
    const official = standardAccounts[m.account.slice(0, 4)];
    if (official && official !== m.row)
      throw new Error(`科目${m.account}已有官方对应项目，请在余额分析中处理合法重分类`);
    seen.add(m.account);
  }
  for (const a of s.accounts) {
    if (a.isLeaf && !mappedRow(a.code, c.mappings) && s.entries.some((e) => e.accountId === a.id))
      throw new Error(`科目${a.code}尚未完整映射`);
    if (!a.isLeaf) continue;
    const row = mappedRow(a.code, c.mappings),
      cat = s.categories.find((c) => c.id === a.categoryId);
    if (!row) continue;
    const income = (incomeIds as readonly string[]).includes(row),
      expense = (expenseIds as readonly string[]).includes(row);
    if ((income || expense) && (!cat?.isPnl || cat.direction !== (income ? 'credit' : 'debit')))
      throw new Error(`科目${a.code}收入费用类别与报表项目不一致`);
    if (!income && !expense && cat?.isPnl)
      throw new Error(`科目${a.code}损益科目不能映射为资产、负债或净资产`);
    if (!income && !expense) {
      const net = ['unrestricted', 'restricted', 'priorAdjustment'].includes(row),
        liability = [
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
        ].includes(row);
      if (a.categoryId !== (net ? 'net-assets' : liability ? 'liability' : 'asset'))
        throw new Error(`科目${a.code}实际类别与资产负债列报项目不一致`);
    }
  }
  return c;
}
function build(s: Sources, c: Configuration, r: StatementRequest): Statement {
  if (r.code !== '403') {
    classifyActivity(s, c);
    classifyNetAssetEvents(s, c);
    validateResourceRollforward(s, c);
    validatePnlClosings(s, c);
    validateAdjustmentClosings(s, c);
  }
  if (r.code === '401') return balanceStatement(s, c, r);
  if (r.code === '403') return cashflowStatement(s, c, r);
  const result = activityStatement(s, c, r);
  result.checks.push(...balanceStatement(s, c, r).checks);
  return result;
}
export type NonprofitGeneration = {
  statement: Statement;
  binding: {
    version: 1;
    bookId: string;
    year: number;
    request: StatementRequest;
    current: string;
    previous?: string;
    previousPeriods?: { to: number; fingerprint: string }[];
  };
};
/** 接线方必须在公共 generate 的现有事务内调用；任何失败发生于快照写入之前。 */
export async function generateNonprofit(
  svc: CoreServices,
  raw: StatementRequest,
  configuration: unknown,
  previousConfiguration?: unknown,
): Promise<NonprofitGeneration> {
  const r = RequestSchema.parse(raw),
    parsed = ConfigurationSchema.parse(configuration),
    s = await readNonprofitSources(svc, r, parsed),
    c = validateConfiguration(parsed, s);
  const statement = build(s, c, r);
  const binding: NonprofitGeneration['binding'] = {
    version: 1,
    bookId: s.book.id,
    year: c.year,
    request: r,
    current: sourceFingerprint(s, c),
  };
  if (r.code !== '401' && c.year >= 2027) {
    if (!r.comparison) throw new Error('2027年起须提供真实上年度可比期间，请补齐上年来源');
    if (!c.comparison) throw new Error('缺少上年项目可比口径和必要重列依据');
    if (!previousConfiguration) throw new Error('缺少上年度真实来源和逐笔分类资料');
    const pr = RequestSchema.parse({ ...r, from: r.from - 100, to: r.to - 100, comparison: false });
    const priorConfiguration = ConfigurationSchema.parse(previousConfiguration);
    const ps = await readNonprofitSources(svc, pr, priorConfiguration),
      pc = validateConfiguration(priorConfiguration, ps),
      previous = build(ps, pc, pr);
    binding.previous = sourceFingerprint(ps, pc);
    const needed = [
      ...new Set([
        Math.floor(pr.to / 100) * 100 + 12,
        ...(pr.from % 100 > 1 ? [pr.from - 1] : []),
        ...(c.comparison.balanceAdjustments ?? []).flatMap((x) => (x.period ? [x.period] : [])),
        ...(c.comparison.retrospectivePeriods ?? [])
          .filter((x) => x.at === 'closing')
          .map((x) => x.period),
      ]),
    ].filter((p) => p !== ps.to);
    const previousPeriods = await Promise.all(
      needed.map((to) =>
        readNonprofitSources(
          svc,
          {
            ...pr,
            code: '401',
            kind: 'interim',
            from: Math.floor(pr.to / 100) * 100 + 1,
            to,
          },
          pc,
        ),
      ),
    );
    if (previousPeriods.length)
      binding.previousPeriods = previousPeriods.map((s) => ({
        to: s.to,
        fingerprint: sourceFingerprint(s, pc),
      }));
    if (previous.checks.some((x) => x.difference !== 0))
      throw new Error('上年比较资料勾稽不一致，请定位并修正上年来源');
    if (c.cashPolicy !== pc.cashPolicy && !c.policyChangeReference)
      throw new Error('现金范围较上年发生变化，请提供会计政策变更依据');
    attachComparative(
      statement,
      previous,
      c,
      pr,
      retrospectiveBridge(s, ps, c, pc, statement, previous, previousPeriods),
      r.code === '402' ? classifyActivity(ps, pc) : undefined,
    );
  }
  assertNonprofitChecks(statement);
  return { statement, binding };
}
/** 公共导出、打印、幂等回放复核实际绑定；绑定原账套、年度、来源和配置，不能由复制或改码刷新。 */
export async function verifyNonprofitBinding(
  svc: CoreServices,
  r: StatementRequest,
  c: unknown,
  saved: NonprofitGeneration,
  previous?: unknown,
) {
  const fresh = await generateNonprofit(svc, r, c, previous);
  if (
    JSON.stringify(fresh.binding) !== JSON.stringify(saved.binding) ||
    JSON.stringify(fresh.statement) !== JSON.stringify(saved.statement)
  )
    throw new Error('账务、科目或来源配置已变化，请重新确认并生成报表');
  assertNonprofitChecks(fresh.statement);
}
export function assertNonprofitChecks(s: Statement) {
  const fail = s.checks.find((c) => c.difference !== 0);
  if (fail)
    throw new Error(
      `${fail.row}·${fail.column}（${fail.from}至${fail.to}）：${fail.name}，差额${(fail.difference / 100).toFixed(2)}元；请查看对应凭证和来源配置`,
    );
}

/** 公共受控保存接口的最小端口；外层负责权限、乐观锁、绑定不可卸载及同事务快照。 */
export const nonprofitDescriptor = {
  catalogue: nonprofitCatalogue,
  configurationSchema: ConfigurationSchema,
  requestSchema: RequestSchema,
  readSources: readNonprofitSources,
  validateConfiguration,
  generate: generateNonprofit,
  verify: verifyNonprofitBinding,
  assertChecks: assertNonprofitChecks,
  configurationDraft: nonprofitConfigurationDraft,
};

/** 仅预填标准制度信息；必要来源仍留待会计人员确认，绝不生成已确认逐笔清单。 */
export function nonprofitConfigurationDraft(s: Sources): Configuration {
  return {
    version: 1,
    bookId: s.book.id,
    year: Math.floor(s.to / 100),
    accountingBasis: nonprofitCatalogue.source,
    transitionOpeningReference: '',
    mappings: [],
    resources: [],
    recognitions: [],
    events: [],
    balanceFacts: [],
    cashScope: s.accounts
      .filter(
        (a) =>
          a.isLeaf &&
          (a.isCash || a.isBank || ['1001', '1002', '1009'].includes(a.code.slice(0, 4))),
      )
      .map((a) => ({
        account: a.code,
        included: false,
        basis: '',
        agency: false,
        restricted: false,
        equivalent: false,
      })),
    cashConfirmations: [],
    cashPolicy: '',
  };
}
