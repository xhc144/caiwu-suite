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
      kind !== 'detail' && id === 'debit'
        ? '收入'
        : kind !== 'detail' && id === 'credit'
          ? '付出'
          : LABELS[id],
    money: id === 'debit' || id === 'credit' || id === 'balance',
  }));
}
export function cellText(row: LedgerRow, id: ColumnId): string {
  const value = row[id];
  return value == null ? '' : typeof value === 'number' ? centsToYuan(value) : value;
}
export function reportCaption(report: LedgerReport) {
  const q = report.query;
  return `${q.periodFrom}—${q.periodTo}；科目 ${q.account || '全部'}${q.accountTo ? ` 至 ${q.accountTo}` : q.account ? '（含下级）' : ''}；辅助维度 ${JSON.stringify(q.dimensions)}；${report.scope}`;
}
