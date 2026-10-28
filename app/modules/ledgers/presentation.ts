import { centsToYuan } from '@caiwu/core';
import { type ColumnId, type LedgerKind, type LedgerReport, type LedgerRow } from './shared';

const LABELS: Record<ColumnId, string> = {
  date: '日期/期间',
  account: '科目',
  summary: '摘要',
  voucherNo: '凭证号',
  status: '凭证状态',
  dimensions: '辅助核算',
  currency: '币种',
  refNo: '票据号',
  debit: '借方',
  credit: '贷方',
  side: '方向',
  balance: '余额',
};
export function displayColumns(kind: LedgerKind, ids: ColumnId[]) {
  return ids.map((id) => ({
    id,
    label:
      (kind === 'cash' || kind === 'bank') && id === 'debit'
        ? '收入'
        : (kind === 'cash' || kind === 'bank') && id === 'credit'
          ? '付出'
          : kind === 'general' && id === 'voucherNo'
            ? '追溯'
            : LABELS[id],
    money: id === 'debit' || id === 'credit' || id === 'balance',
  }));
}
export function cellText(row: LedgerRow, id: ColumnId): string {
  const value = row[id];
  return value == null ? '' : typeof value === 'number' ? centsToYuan(value) : value;
}
/** 专账字段由服务端定义，金额始终保存整数分，数量与单价保持十进制文本。 */
export function reportColumns(report: LedgerReport, ids: ColumnId[]) {
  const base = displayColumns(report.query.kind, ids);
  if (report.query.groupAuxiliary && !base.some((c) => c.id === 'dimensions'))
    base.push(...displayColumns(report.query.kind, ['dimensions']));
  return [...base, ...(report.dynamicColumns ?? [])];
}
export function reportCellText(row: LedgerRow, id: string, money: boolean): string {
  if (COLUMN_IDS_SET.has(id)) return cellText(row, id as ColumnId);
  const value = row.values?.[id];
  if (value == null) return '';
  return money && typeof value === 'number' ? centsToYuan(value) : String(value);
}
const COLUMN_IDS_SET = new Set<string>([
  'date',
  'account',
  'summary',
  'voucherNo',
  'status',
  'dimensions',
  'currency',
  'refNo',
  'debit',
  'credit',
  'side',
  'balance',
]);
export function reportCaption(report: LedgerReport) {
  const q = report.query;
  return `${report.orgName ? `单位：${report.orgName}；` : ''}${q.periodFrom}—${q.periodTo}；金额单位：元；科目 ${q.account || '全部'}${q.accountTo ? ` 至 ${q.accountTo}` : q.account ? '（含下级）' : ''}；辅助核算：${report.filterDescription ?? (Object.keys(q.dimensions).length ? '已指定' : '全部')}；${report.scope}`;
}

/** 仅改变展示层次；下载和打印始终保留完整月份及累计、期末。 */
export function generalTableRows(rows: LedgerRow[]): LedgerRow[] {
  const result: LedgerRow[] = [];
  for (const row of rows) {
    const previous = result.at(-1);
    if (
      (row.kind === 'ytd' || row.kind === 'closing') &&
      previous?.kind === 'month' &&
      previous.account === row.account &&
      previous.date === row.date
    ) {
      (previous.children ??= []).push(row);
    } else result.push({ ...row });
  }
  return result;
}
