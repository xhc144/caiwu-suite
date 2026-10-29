import { parseMoney, zDate } from '@caiwu/core';

export const CONTRACT_SEARCH_FIELDS = {
  code: '合同号',
  name: '合同名称',
  partnerName: '客供',
  signed_date: '签订日期',
  kind: '收付款类型',
  amount: '合同金额',
  opening: '期初收付',
  reviewed_by: '审核状态',
  description: '说明',
  remark: '备注1',
  remark2: '备注2',
} as const;
export type ContractSearchField = keyof typeof CONTRACT_SEARCH_FIELDS;
export type ContractSearchOperator =
  'contains' | 'equal' | 'greater' | 'less' | 'empty' | 'notEmpty';
export type ContractSearchRow = {
  code: string;
  name: string;
  partnerName: string;
  signed_date: string;
  kind: 'receipt' | 'payment';
  amount: number;
  opening: number;
  reviewed_by: number | null;
  description: string;
  remark: string;
  remark2: string;
};
export function contractConditionError(
  field: ContractSearchField,
  operator: ContractSearchOperator,
  value: string,
): string | null {
  if (operator === 'empty' || operator === 'notEmpty') return null;
  if (field === 'amount' || field === 'opening') {
    try {
      return parseMoney(value) === null ? '定位金额无效，请按元填写' : null;
    } catch {
      return '定位金额超出范围，请检查金额';
    }
  }
  if (field === 'signed_date' && operator !== 'contains' && !zDate.safeParse(value).success)
    return '定位日期无效，请填写YYYY-MM-DD格式的实际日期';
  return null;
}
export function matchesContractCondition(
  row: ContractSearchRow,
  field: ContractSearchField,
  operator: ContractSearchOperator,
  value: string,
): boolean {
  const raw =
    field === 'kind'
      ? row.kind === 'receipt'
        ? '收款'
        : '付款'
      : field === 'reviewed_by'
        ? row.reviewed_by
          ? '已审核'
          : '未审核'
        : row[field];
  if (operator === 'empty') return raw === '';
  if (operator === 'notEmpty') return raw !== '';
  if (field === 'amount' || field === 'opening') {
    let amount: number | null;
    try {
      amount = parseMoney(value);
    } catch {
      return false;
    }
    if (amount === null) return false;
    return operator === 'greater'
      ? row[field] > amount
      : operator === 'less'
        ? row[field] < amount
        : row[field] === amount;
  }
  const text = String(raw).toLowerCase(),
    search = value.trim().toLowerCase();
  return operator === 'contains'
    ? text.includes(search)
    : operator === 'equal'
      ? text === search
      : operator === 'greater'
        ? text > search
        : text < search;
}
