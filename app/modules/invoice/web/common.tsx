import { Alert, Button, Space } from 'antd';
import { Link } from 'react-router';
import { formatMoney } from '@caiwu/core';
import { queryClient } from '@caiwu/web-kit';
import { exportToExcel, type DataColumn } from '@caiwu/ui';
import { escapeHtml, printHtml } from '@caiwu/print';
import type { Invoice, InvoiceFilter } from '../shared';
import { api } from './api';

export function Nav() {
  return (
    <Space wrap style={{ marginBottom: 16 }}>
      {[
        ['input', '进项发票'],
        ['output', '销项发票'],
        ['process', '发票处理'],
        ['vat', '增值税比对'],
        ['settings', '参数设置'],
        ['summary', '发票汇总'],
        ['periods', '发票结账'],
      ].map(([path, label]) => (
        <Link key={path} to={`/m/invoice/${path}`}>
          {label}
        </Link>
      ))}
    </Space>
  );
}
export function QueryError({
  error,
  retry,
}: {
  error: { message: string } | null;
  retry: () => unknown;
}) {
  return error ? (
    <Alert
      type="error"
      title={error.message}
      action={<Button onClick={() => void retry()}>重试</Button>}
    />
  ) : null;
}
export const invoiceColumns: DataColumn<Invoice>[] = [
  { key: 'number', title: '发票号码', dataIndex: 'number', width: 220 },
  { key: 'date', title: '开票日期', dataIndex: 'date', width: 110 },
  { key: 'confirmDate', title: '确认日期', dataIndex: 'confirmDate', width: 110 },
  { key: 'period', title: '归属月份', dataIndex: 'period', width: 100 },
  { key: 'seller', title: '销售方', dataIndex: 'sellerName', width: 180 },
  { key: 'buyer', title: '购买方', dataIndex: 'buyerName', width: 180 },
  { key: 'kind', title: '票种', dataIndex: 'kind', width: 130 },
  { key: 'amount', title: '不含税金额', dataIndex: 'amount', money: true, width: 130 },
  { key: 'tax', title: '税额', dataIndex: 'tax', money: true, width: 110 },
  { key: 'total', title: '价税合计', dataIndex: 'total', money: true, width: 130 },
  {
    key: 'state',
    title: '处理状态',
    width: 100,
    render: (_, r) => ({ draft: '草稿', audited: '已审核', generated: '已制证' })[r.state],
  },
  {
    key: 'voucher',
    title: '凭证',
    width: 170,
    render: (_, r) =>
      r.voucherId ? (
        <Link to={`/m/voucher-entry/edit?id=${r.voucherId}`}>
          {r.voucherNo} {r.voucherStatus}
        </Link>
      ) : (
        '未制证'
      ),
  },
];
export async function exportInvoices(filter: InvoiceFilter, print = false) {
  const rows = await queryClient.fetchQuery({ ...api.export.queryOptions(filter), staleTime: 0 });
  const cols = [
    ['发票号码', (r: Invoice) => r.number],
    ['发票代码', (r: Invoice) => r.code],
    ['开票日期', (r: Invoice) => r.date],
    ['确认日期', (r: Invoice) => r.confirmDate],
    ['销售方', (r: Invoice) => r.sellerName],
    ['销售方税号', (r: Invoice) => r.sellerTaxId],
    ['购买方', (r: Invoice) => r.buyerName],
    ['票种', (r: Invoice) => r.kind],
    ['不含税金额', (r: Invoice) => r.amount],
    ['税额', (r: Invoice) => r.tax],
    ['价税合计', (r: Invoice) => r.total],
    ['凭证', (r: Invoice) => r.voucherNo],
    ['备注', (r: Invoice) => r.note],
  ] as const;
  if (print) {
    await printHtml({
      title: '发票查询',
      orientation: 'landscape',
      html: `<h1>发票查询</h1><p>筛选：${escapeHtml(JSON.stringify(filter))}</p><table><thead><tr>${cols.map(([t]) => `<th>${escapeHtml(t)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map(([t, v]) => `<td>${escapeHtml(['不含税金额', '税额', '价税合计'].includes(t) ? formatMoney(v(r) as number) : v(r))}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
    });
  } else
    await exportToExcel({
      fileName: '发票查询',
      columns: cols.map(([title, value]) => ({
        title,
        value,
        money: ['不含税金额', '税额', '价税合计'].includes(title),
      })),
      rows,
    });
}
