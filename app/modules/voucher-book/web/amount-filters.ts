import { centsToYuan, parseMoney } from '@caiwu/core';

/** 地址栏及接口沿用整数分；只有编辑表单使用元。 */
export function amountToForm(value: string): string {
  return value !== '' && Number.isSafeInteger(Number(value)) ? centsToYuan(Number(value)) : value;
}
export function amountToUrl(value: string): string {
  if (!value.trim()) return '';
  let cents: number | null;
  try {
    cents = parseMoney(value);
  } catch {
    throw new Error('金额超出可查询范围，请缩小金额');
  }
  if (cents == null) throw new Error('请输入有效金额，例如 0.01 或 -100.00');
  return String(cents);
}
export function conditionAmounts(value: string, convert: (value: string) => string): string {
  if (!value) return '';
  let rows: unknown;
  try {
    rows = JSON.parse(value);
  } catch {
    throw new Error('综合查询条件格式有误，请清空后重新选择');
  }
  if (!Array.isArray(rows)) throw new Error('请重新选择综合查询条件');
  return JSON.stringify(
    rows.map((row: unknown) => {
      if (
        row &&
        typeof row === 'object' &&
        'field' in row &&
        row.field === 'amount' &&
        'value' in row
      )
        return { ...row, value: convert(String(row.value)) };
      return row;
    }),
  );
}
