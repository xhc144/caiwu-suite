import { balanceFormula, type BalanceFunction, type BalanceOptions } from '../../shared';

/** 共享owner已确认的第8参数契约；只负责模板序列化，不实现求值或扩展共享schema。 */
export type StatementOptions = BalanceOptions;

/** 使用共享f9b591d6的唯一schema/helper；不维护第二套参数校验或求值。 */
export function statementBalance(input: BalanceFunction, options: StatementOptions): string {
  return balanceFormula({ ...input, options });
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
