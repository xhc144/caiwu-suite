import { Decimal, DIMENSION_TYPES, isDecimalString, type Account } from '@caiwu/core';

export type ReferenceRow = {
  dim_project: number | null;
  dim_partner: number | null;
  dim_department: number | null;
  dim_person: number | null;
  dim_cashflow?: number | null;
  currency_code: string | null;
  quantity_e6: number | null;
};
export type ReferenceItem = { id: number; type_id: string; is_leaf: number };

/** 只核查存储快照。停用档案仍可被历史单据引用，不能按当前录入规则误报。 */
export function referenceIssues(
  row: ReferenceRow,
  account: Account,
  items: ReadonlyMap<number, ReferenceItem>,
  currencies: ReadonlySet<string>,
  options: { opening: boolean; draft?: boolean },
): string[] {
  const issues: string[] = [];
  if (!account.isLeaf) issues.push('引用非末级科目');
  for (const dimension of DIMENSION_TYPES) {
    if (options.opening && !dimension.inOpening) continue;
    const value = row[dimension.column];
    const config = account.dimensions.find((d) => d.type === dimension.id);
    if (value != null) {
      const item = items.get(value);
      if (!item) issues.push(`${dimension.name} ID ${value} 不存在`);
      else if (item.type_id !== dimension.id) issues.push(`${dimension.name} ID ${value} 类型不符`);
      else if (!item.is_leaf) issues.push(`${dimension.name} ID ${value} 不是末级`);
      if (dimension.id !== 'cashflow' && !config) issues.push(`科目未启用${dimension.name}核算`);
    } else if (dimension.id !== 'cashflow' && !options.draft && config?.required) {
      issues.push(`缺少必填${dimension.name}`);
    }
  }
  if (row.currency_code != null) {
    if (!currencies.has(row.currency_code)) issues.push(`币种 ${row.currency_code} 不存在`);
    if (row.currency_code !== account.currency) issues.push('币种与科目外币核算设置不符');
  }
  if (row.quantity_e6 != null) {
    if (!Number.isSafeInteger(row.quantity_e6)) issues.push('数量不是安全整数百万分之一');
    if (row.quantity_e6 !== 0 && !account.quantityUnit) issues.push('非数量科目存有数量');
  }
  return issues;
}

export function foreignAmountIssues(
  row: { currency_code: string | null; fc_amount: number | null; exchange_rate: string | null },
  account: Account,
  draft: boolean,
): string[] {
  const issues: string[] = [];
  if (account.currency && !draft) {
    if (!row.currency_code) issues.push('外币科目缺少币种');
    if (row.fc_amount == null) issues.push('外币科目缺少外币金额');
    if (row.exchange_rate == null) issues.push('外币科目缺少汇率');
  }
  if (row.fc_amount != null) {
    if (!Number.isSafeInteger(row.fc_amount)) issues.push('外币金额不是安全整数分');
    if (row.fc_amount !== 0 && (!account.currency || !row.currency_code))
      issues.push('外币金额缺少对应的科目币种');
  }
  if (row.exchange_rate != null) {
    if (!isDecimalString(row.exchange_rate) || !new Decimal(row.exchange_rate).greaterThan(0))
      issues.push('汇率不是正十进制数');
  }
  return issues;
}
