import {
  balanceKey,
  exactSum,
  mappedRow,
  type Configuration,
  type Sources,
  type Statement,
} from './model';
import { cashBalanceAt } from './cash-scope';

/** 追溯底稿逐时点借贷平衡；可比期与累计分别衔接，上年年末承接到次年真实年初。 */
export function retrospectiveBridge(
  current: Sources,
  prior: Sources,
  c: Configuration,
  pc: Configuration,
  currentStatement: Statement,
  priorStatement: Statement,
  history: Sources[] = [],
) {
  const changes = c.comparison?.balanceAdjustments ?? [];
  const cashRestatements = c.comparison?.cashRestatements ?? [];
  const year = Math.floor(prior.to / 100),
    january = year * 100 + 1,
    december = year * 100 + 12;
  const byPeriod = new Map([prior, ...history].map((s) => [s.to, s]));
  const yearEnd = byPeriod.get(december);
  if (!yearEnd) throw new Error('缺少上年度年末真实来源，不能将可比中期余额当作年末承接');
  const actualYearEnd = new Map(yearEnd.balances.map((b) => [balanceKey(b), b]));
  const actualCurrent = new Map(current.balances.map((b) => [balanceKey(b), b]));
  const known = new Set([...actualYearEnd.keys(), ...actualCurrent.keys()]);
  const when = (x: (typeof changes)[number]) =>
    x.period ?? (x.at === 'opening' ? january : december);
  const closingChanges = changes.filter((x) => x.at === 'closing' && when(x) === december);
  for (const key of known) {
    const before = actualYearEnd.get(key)?.closing ?? 0,
      after = actualCurrent.get(key)?.opening ?? 0;
    const delta = exactSum(closingChanges.filter((x) => x.key === key).map((x) => x.delta));
    if (exactSum([before, delta]) !== after)
      throw new Error('次年年初存在未列入追溯底稿的实际变动或期末调整未由次年真实年初逐明细承接');
  }
  if (!changes.length && !cashRestatements.length) {
    if (
      currentStatement.code === '403' &&
      currentStatement.cashOpening !== priorStatement.cashClosing
    )
      throw new Error('上年现金范围与次年真实年初不一致，请补齐原时点现金范围重列来源');
    return { netChangeDelta: 0, netChangeYtdDelta: 0, cashOpeningDelta: 0, cashClosingDelta: 0 };
  }
  if (!c.policyChangeReference) throw new Error('追溯重列须填写政策变更或差错更正原始依据');
  if (currentStatement.period.kind !== 'annual') {
    const boundaries = c.comparison?.retrospectivePeriods ?? [];
    const required = [
      { at: 'opening', period: january },
      { at: 'closing', period: prior.to },
      { at: 'closing', period: december },
      ...(currentStatement.period.from % 100 > 1
        ? [{ at: 'closing', period: currentStatement.period.from - 101 }]
        : []),
    ];
    for (const b of required)
      if (boundaries.filter((x) => x.at === b.at && x.period === b.period).length !== 1)
        throw new Error(
          `中期追溯缺少${b.period}${b.at === 'opening' ? '年初' : '期末'}逐期底稿及未调整项目核对依据`,
        );
  }
  const used = new Set<string>();
  for (const x of changes) {
    const p = when(x),
      tag = `${x.at}:${p}:${x.key}`;
    const source = x.at === 'opening' && p === january ? prior : byPeriod.get(p);
    if (Math.floor(p / 100) !== year || (x.at === 'opening' && p !== january) || !source)
      throw new Error('追溯时点缺少真实期间来源，请按原期间读取余额并补齐底稿');
    const b = source.balances.find((b) => balanceKey(b) === x.key);
    const account = source.accounts.find((a) => a.code === x.key.split(':')[0]);
    if (used.has(tag) || !account?.isLeaf || (!b && !known.has(x.key)))
      throw new Error('追溯工作底稿明细重复或缺少真实科目及往来来源');
    used.add(tag);
    if (source.categories.find((cat) => cat.id === account.categoryId)?.isPnl)
      throw new Error('追溯余额底稿不能用损益发生额替代资产负债和净资产衔接');
    if (x.originalBalance !== (b?.[x.at] ?? 0))
      throw new Error('追溯底稿原余额与上年真实来源不一致');
  }
  for (const tag of new Set(changes.map((x) => `${x.at}:${when(x)}`)))
    if (exactSum(changes.filter((x) => `${x.at}:${when(x)}` === tag).map((x) => x.delta)) !== 0)
      throw new Error('追溯工作底稿借贷不平，不能跨时点抵销或用净资产金额倒挤');
  for (const b of yearEnd.balances) {
    const a = yearEnd.accounts.find((a) => a.id === b.accountId);
    if (yearEnd.categories.find((cat) => cat.id === a?.categoryId)?.isPnl && b.closing !== 0)
      throw new Error('政策追溯需要完整损益结转后的上年期末来源');
  }
  const net = (at: 'opening' | 'closing', p: number) =>
    exactSum(
      changes
        .filter(
          (x) =>
            x.at === at &&
            when(x) === p &&
            ['unrestricted', 'restricted'].includes(
              mappedRow(x.key.split(':')[0]!, pc.mappings) ?? '',
            ),
        )
        .map((x) => -x.delta),
    );
  const cash = (at: 'opening' | 'closing') => {
    const snapshots = (c.comparison?.cashRestatements ?? []).filter((x) => x.at === at);
    if (snapshots.length > 1) throw new Error('同一原时点现金范围重列重复');
    const snapshot = snapshots[0];
    const adjusted: Sources = {
      ...prior,
      balances: prior.balances.map((b) => ({
        ...b,
        [at]: exactSum([
          b[at],
          ...changes
            .filter(
              (x) =>
                x.at === at &&
                when(x) === (at === 'opening' ? january : prior.to) &&
                x.key === balanceKey(b),
            )
            .map((x) => x.delta),
        ]),
      })),
    };
    const config = snapshot
      ? {
          ...pc,
          cashScope: snapshot.cashScope,
          cashPolicy: snapshot.cashPolicy,
          balanceFacts: snapshot.balanceFacts,
        }
      : pc;
    const date = at === 'opening' ? prior.openingDate : prior.closingDate;
    if (snapshot) {
      const keys = new Set<string>();
      for (const f of snapshot.balanceFacts) {
        const actual = adjusted.balances.find((b) => balanceKey(b) === f.key);
        if (
          f.at !== date ||
          keys.has(f.key) ||
          !actual ||
          f.balance !== actual[at] ||
          exactSum(f.allocations.map((a) => a.amount)) !== f.balance
        )
          throw new Error('现金范围重列须逐项对应原时点真实余额及借贷平衡后的追溯底稿');
        keys.add(f.key);
      }
    }
    return exactSum([cashBalanceAt(adjusted, config, at), -cashBalanceAt(prior, pc, at)]);
  };
  const cashOpeningDelta = currentStatement.code === '403' ? cash('opening') : 0;
  const cashClosingDelta = currentStatement.code === '403' ? cash('closing') : 0;
  if (
    currentStatement.code === '403' &&
    exactSum([priorStatement.cashClosing!, cashClosingDelta]) !== currentStatement.cashOpening
  )
    throw new Error('上年重列后的现金范围期末尚未由次年真实年初承接，请核对两个时点分配');
  const start =
    currentStatement.period.from % 100 === 1
      ? net('opening', january)
      : net('closing', currentStatement.period.from - 101);
  return {
    netChangeDelta: exactSum([net('closing', prior.to), -start]),
    netChangeYtdDelta: exactSum([net('closing', prior.to), -net('opening', january)]),
    cashOpeningDelta,
    cashClosingDelta,
  };
}
