import { balanceFormula, type BalanceFunction } from '../../shared';

/** 共享owner已确认的第8参数契约；只负责模板序列化，不实现求值或扩展共享schema。 */
export type StatementOptions = {
  from?: 'current' | 'yearStart' | 'previousYear' | 'previousYearStart' | `${number}`;
  to?: 'current' | 'yearStart' | 'previousYear' | 'previousYearStart' | `${number}`;
  closing?: 'include' | 'exclude' | 'excludePnl';
  side?: 'net' | 'debit' | 'credit';
  groupBy?: ('project' | 'partner' | 'department' | 'person')[];
};

/** 等待共享SHA后进行真实router验证；旧七参数引擎不能执行本函数产物。 */
export function statementBalance(input: BalanceFunction, options: StatementOptions): string {
  const relative = ['current', 'yearStart', 'previousYear', 'previousYearStart'];
  for (const period of [options.from, options.to])
    if (
      period !== undefined &&
      !relative.includes(period) &&
      !/^\d{4}(?:0[1-9]|1[0-2])$/.test(period)
    )
      throw new Error('取数期间只允许统一契约的相对期间或YYYYMM');
  if (
    options.side &&
    (input.unit !== 'cents' ||
      input.direction !== 'signed' ||
      !['opening', 'closing'].includes(input.metric))
  )
    throw new Error('side只用于本币期初或期末signed取数');
  const seven = balanceFormula(input);
  return `${seven.slice(0, -1)},${JSON.stringify(JSON.stringify(options))})`;
}

export function yearOpening(account: string): string {
  return statementBalance(
    {
      account,
      metric: 'opening',
      unit: 'cents',
      currency: 'CNY',
      direction: 'signed',
      dimension: 'none',
      item: '',
    },
    { from: 'yearStart', to: 'yearStart', closing: 'include', side: 'net' },
  );
}

/** 仅取真实科目净发生额；本函数没有、也不推断任何民非限定性分类。 */
export function activityMovement(account: string, range: 'month' | 'ytd'): string {
  const input = {
    account,
    unit: 'cents' as const,
    currency: 'CNY',
    direction: 'signed' as const,
    dimension: 'none' as const,
    item: '',
  };
  const options = {
    from: range === 'month' ? ('current' as const) : ('yearStart' as const),
    to: 'current' as const,
    closing: 'excludePnl' as const,
  };
  return `(${statementBalance({ ...input, metric: 'credit' }, options)}-${statementBalance({ ...input, metric: 'debit' }, options)})`;
}
