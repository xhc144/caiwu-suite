import { centsToYuan, parseMoney } from '@caiwu/core';

/** 地址栏及接口沿用整数分；只有编辑表单使用元。 */
export function amountToForm(value: string): string {
  if (value === '') return '';
  return /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value))
    ? centsToYuan(Number(value))
    : '金额无效，请重新输入';
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
  if (
    !Array.isArray(rows) ||
    !rows.every(
      (row: unknown) =>
        row != null &&
        typeof row === 'object' &&
        'field' in row &&
        typeof row.field === 'string' &&
        'operator' in row &&
        typeof row.operator === 'string' &&
        'value' in row &&
        typeof row.value === 'string',
    )
  )
    throw new Error('请重新选择综合查询条件');
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

/** 外部链接的基础类型错误也用会计字段说明，保留已有的业务提示。 */
export function queryProblem(issue: { path: readonly PropertyKey[]; message: string }): string {
  if (/[\u3400-\u9fff]/.test(issue.message) && !/整数分|安全整数/.test(issue.message))
    return issue.message;
  const labels: Record<string, string> = {
    periodFrom: '起始期间',
    periodTo: '结束期间',
    dateFrom: '起始日期',
    dateTo: '结束日期',
    voucherTypeId: '凭证类型',
    statuses: '凭证状态',
    numberFrom: '起始编号',
    numberTo: '结束编号',
    amountFrom: '起始金额',
    amountTo: '结束金额',
    createdBy: '制单人',
    conditions: '综合查询条件',
  };
  return `${labels[String(issue.path[0])] ?? '查询条件'}格式无效，请在筛选栏修正后重新查询`;
}
