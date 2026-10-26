import { Link } from 'react-router';
import { Alert, Button, Form, InputNumber, Select, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import { today, formatMoney } from '@caiwu/core';
import { queryClient, showError, usePermission } from '@caiwu/web-kit';
import { DataTable, FilterBar, PageContainer, exportToExcel, type DataColumn } from '@caiwu/ui';
import { escapeHtml, printHtml } from '@caiwu/print';
import type { InvoiceRouter } from '../server/router';
import { api } from './api';
import { Nav, QueryError } from './common';
import { useInvoiceFilters } from './useInvoiceFilters';
type Row = inferRouterOutputs<InvoiceRouter>['summary'][number];
export default function SummaryPage() {
  const [filters, setFilters] = useInvoiceFilters({
    year: Number(today().slice(0, 4)),
    direction: 'input',
    groupBy: 'month',
  });
  const input = {
    year: filters.year,
    direction: filters.direction === 'output' ? ('output' as const) : ('input' as const),
    groupBy:
      filters.groupBy === 'partner'
        ? ('partner' as const)
        : filters.groupBy === 'quarter'
          ? ('quarter' as const)
          : ('month' as const),
  };
  const query = useQuery(api.summary.queryOptions(input));
  const canExport = usePermission('invoice.export');
  const columns: DataColumn<Row>[] = [
    {
      key: 'label',
      title:
        input.groupBy === 'partner'
          ? input.direction === 'input'
            ? '供应商'
            : '客户'
          : '归属期间',
      dataIndex: 'label',
      width: 240,
    },
    { key: 'taxId', title: '税号', dataIndex: 'taxId', width: 180 },
    { key: 'count', title: '票数', dataIndex: 'count', width: 90 },
    { key: 'amount', title: '不含税金额', dataIndex: 'amount', money: true, width: 150 },
    { key: 'tax', title: '税额', dataIndex: 'tax', money: true, width: 130 },
    { key: 'total', title: '价税合计', dataIndex: 'total', money: true, width: 150 },
    {
      key: 'detail',
      title: '发票明细',
      width: 260,
      noExport: true,
      render: (_, r) => (
        <Space wrap>
          {r.ids.map((id) => (
            <Link key={id} to={`/m/invoice/${input.direction}?id=${id}`}>
              #{id}
            </Link>
          ))}
        </Space>
      ),
    },
  ];
  async function output(print: boolean) {
    const rows = await queryClient.fetchQuery({
      ...api.exportSummary.queryOptions(input),
      staleTime: 0,
    });
    if (print)
      await printHtml({
        title: '发票汇总',
        html: `<h1>发票汇总</h1><p>${input.year} 年；${input.direction === 'input' ? '进项（确认月份）' : '销项（开票月份）'}；${input.groupBy === 'partner' ? '按单位' : input.groupBy === 'quarter' ? '按季' : '按月'}</p><table><tr><th>期间/单位</th><th>税号</th><th>份数</th><th>金额</th><th>税额</th><th>合计</th></tr>${rows.map((r) => `<tr><td>${escapeHtml(r.label)}</td><td>${escapeHtml(r.taxId)}</td><td>${r.count}</td><td>${formatMoney(r.amount)}</td><td>${formatMoney(r.tax)}</td><td>${formatMoney(r.total)}</td></tr>`).join('')}</table>`,
      });
    else
      await exportToExcel({
        fileName: '发票汇总',
        rows,
        columns: [
          { title: '期间/单位', value: (r) => r.label },
          { title: '税号', value: (r) => r.taxId },
          { title: '票数', value: (r) => r.count },
          ...(['amount', 'tax', 'total'] as const).map((f) => ({
            title: f === 'amount' ? '不含税金额' : f === 'tax' ? '税额' : '价税合计',
            money: true,
            value: (r: Row) => r[f],
          })),
        ],
      });
  }
  return (
    <PageContainer title="发票汇总">
      <Nav />
      <FilterBar initialValues={filters} onSearch={setFilters}>
        <Form.Item label="年度" name="year">
          <InputNumber min={2000} max={2100} />
        </Form.Item>
        <Form.Item label="方向" name="direction">
          <Select
            style={{ width: 130 }}
            options={[
              { value: 'input', label: '进项/供应商' },
              { value: 'output', label: '销项/客户' },
            ]}
          />
        </Form.Item>
        <Form.Item label="汇总方式" name="groupBy">
          <Select
            style={{ width: 140 }}
            options={[
              { value: 'month', label: '按月' },
              { value: 'quarter', label: '按季度' },
              { value: 'partner', label: '按客户/供应商' },
            ]}
          />
        </Form.Item>
      </FilterBar>
      <Alert
        type="info"
        title="销项按开票月份、进项按确认月份；包含未制证正常票，作废票不计入，红字保留负数"
      />
      {canExport && (
        <Space>
          <Button onClick={() => void output(false).catch(showError)}>导出汇总 Excel</Button>
          <Button onClick={() => void output(true).catch(showError)}>打印汇总</Button>
        </Space>
      )}
      <QueryError error={query.error} retry={query.refetch} />
      <DataTable
        tableId="invoice-summary"
        rowKey="key"
        columns={columns}
        loading={query.isPending}
        dataSource={query.data ?? []}
        locale={{ emptyText: '本年度当前范围没有正常发票' }}
      />
    </PageContainer>
  );
}
