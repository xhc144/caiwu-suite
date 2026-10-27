import {
  balanceKey,
  exactSum,
  mappedRow,
  type Configuration,
  type Sources,
  type Statement,
} from './model';

/** 追溯工作底稿必须借贷平衡，期末每项变动必须由次年真实年初逐明细承接。 */
export function retrospectiveBridge(
  current: Sources,
  prior: Sources,
  c: Configuration,
  pc: Configuration,
  currentStatement: Statement,
  priorStatement: Statement,
) {
  const changes = c.comparison?.balanceAdjustments ?? [];
  if (!changes.length) {
    if (currentStatement.period.kind === 'annual') {
      const old = new Map(prior.balances.map((b) => [balanceKey(b), b.closing]));
      const next = new Map(current.balances.map((b) => [balanceKey(b), b.opening]));
      if (
        [...new Set([...old.keys(), ...next.keys()])].some(
          (key) => (old.get(key) ?? 0) !== (next.get(key) ?? 0),
        )
      )
        throw new Error('次年年初存在未列入追溯底稿的实际变动，请逐明细补齐来源');
    }
    return { netChangeDelta: 0, cashOpeningDelta: 0, cashClosingDelta: 0 };
  }
  if (!c.policyChangeReference) throw new Error('追溯重列须填写政策变更或差错更正原始依据');
  if (currentStatement.period.kind !== 'annual')
    throw new Error('中期追溯重列尚缺逐期衔接来源，不能将全年追溯数代填中期');
  const actualPrior = new Map(prior.balances.map((b) => [balanceKey(b), b]));
  const actualCurrent = new Map(current.balances.map((b) => [balanceKey(b), b]));
  const known = new Set([...actualPrior.keys(), ...actualCurrent.keys()]);
  const used = new Set<string>();
  for (const x of changes) {
    const tag = `${x.at}:${x.key}`;
    if (used.has(tag) || !known.has(x.key))
      throw new Error('追溯工作底稿明细重复或缺少真实科目及往来来源');
    used.add(tag);
    const b = actualPrior.get(x.key),
      now = actualCurrent.get(x.key);
    const account = b ?? now!;
    if (
      prior.categories.find(
        (cat) => cat.id === prior.accounts.find((a) => a.id === account.accountId)?.categoryId,
      )?.isPnl
    )
      throw new Error('追溯余额底稿不能用损益发生额替代资产负债和净资产衔接');
    if (x.originalBalance !== (b?.[x.at] ?? 0))
      throw new Error('追溯底稿原余额与上年真实来源不一致');
    if (x.at === 'closing' && exactSum([x.originalBalance, x.delta]) !== (now?.opening ?? 0))
      throw new Error('追溯期末调整未由次年真实年初逐明细承接');
  }
  for (const at of ['opening', 'closing'] as const)
    if (exactSum(changes.filter((x) => x.at === at).map((x) => x.delta)) !== 0)
      throw new Error('追溯工作底稿借贷不平，不能用净资产金额倒挤');
  for (const key of known) {
    const before = actualPrior.get(key)?.closing ?? 0,
      after = actualCurrent.get(key)?.opening ?? 0;
    if (before !== after && !changes.some((x) => x.at === 'closing' && x.key === key))
      throw new Error('次年年初存在未列入追溯底稿的实际变动，请逐明细补齐来源');
  }
  for (const b of prior.balances) {
    const a = prior.accounts.find((a) => a.id === b.accountId);
    if (prior.categories.find((cat) => cat.id === a?.categoryId)?.isPnl && b.closing !== 0)
      throw new Error('政策追溯需要完整损益结转后的上年期末来源');
  }
  const net = (at: 'opening' | 'closing') =>
    exactSum(
      changes
        .filter(
          (x) =>
            x.at === at &&
            ['unrestricted', 'restricted'].includes(
              mappedRow(x.key.split(':')[0]!, pc.mappings) ?? '',
            ),
        )
        .map((x) => -x.delta),
    );
  const cash = (at: 'opening' | 'closing') =>
    exactSum(
      changes
        .filter((x) => x.at === at)
        .map((x) => {
          const scope = pc.cashScope.find((a) => a.account === x.key.split(':')[0]);
          if (!scope?.included) return 0;
          if (scope.partitioned)
            throw new Error('混合资金追溯尚缺逐部分的原时点现金范围来源，请先补齐');
          return x.delta;
        }),
    );
  const cashOpeningDelta = currentStatement.code === '403' ? cash('opening') : 0;
  const cashClosingDelta =
    currentStatement.code === '403'
      ? exactSum([currentStatement.cashOpening!, -priorStatement.cashClosing!])
      : 0;
  return {
    netChangeDelta: exactSum([net('closing'), -net('opening')]),
    cashOpeningDelta,
    cashClosingDelta,
  };
}
