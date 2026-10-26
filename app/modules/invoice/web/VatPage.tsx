import { today } from '@caiwu/core';
import { useInvoiceFilters } from './useInvoiceFilters';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Checkbox, Drawer, Form, InputNumber, Select, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { DataTable, FilterBar, MoneyText, PageContainer } from '@caiwu/ui';
import type { inferRouterOutputs } from '@trpc/server';
import type { InvoiceRouter } from '../server/router';
import { api } from './api';
import { Nav, QueryError } from './common';
type Row = inferRouterOutputs<InvoiceRouter>['vat'][number];
export default function VatPage() {
  const [filters, setFilters] = useInvoiceFilters({
    year: Number(today().slice(0, 4)),
    groupBy: 'month',
    includeUnposted: false,
  });
  const input = {
    year: filters.year,
    groupBy: filters.groupBy === 'quarter' ? ('quarter' as const) : ('month' as const),
    includeUnposted: filters.includeUnposted,
  };
  const query = useQuery(api.vat.queryOptions(input));
  const [detail, setDetail] = useState<Row | null>(null);
  return (
    <PageContainer
      title="增值税比对"
      subtitle="票面：销项按开票月份、进项按确认月份；账面：所配置税科目本期借贷净发生"
    >
      <Nav />
      <FilterBar
        initialValues={filters}
        onSearch={setFilters}
        extra={<Button onClick={() => void query.refetch()}>刷新比对</Button>}
      >
        <Form.Item name="year" label="年度">
          <InputNumber min={2000} max={2100} />
        </Form.Item>
        <Form.Item name="groupBy" label="汇总">
          <Select
            style={{ width: 130 }}
            options={[
              { value: 'month', label: '按月' },
              { value: 'quarter', label: '按季' },
            ]}
          />
        </Form.Item>
        <Form.Item name="includeUnposted" valuePropName="checked">
          <Checkbox>含未过账</Checkbox>
        </Form.Item>
      </FilterBar>
      <Alert
        type="info"
        title={
          input.includeUnposted
            ? '账面口径：含待审核、已审核及已过账（不含草稿/作废）'
            : '账面口径：仅已过账（默认）'
        }
        description="差额 = 账面税额 − 全部正常票面税额。未制证、未过账、非抵扣税额计入成本、确认跨月及科目映射变更均可能产生差额；此表不自动补差、不判定抵扣资格或税务合规。"
      />
      <QueryError error={query.error} retry={query.refetch} />
      {query.data?.[0] && (
        <Alert
          type="info"
          title={`账套启用月份：${query.data[0].startPeriod}；启用前标为未启用，跨启用月季度仅比对启用后范围。`}
        />
      )}
      <DataTable
        tableId="invoice-vat"
        rowKey="key"
        dataSource={query.data ?? []}
        loading={query.isPending}
        columns={[
          {
            key: 'direction',
            title: '方向',
            width: 100,
            render: (_, r) => (r.direction === 'input' ? '进项' : '销项'),
          },
          { key: 'from', title: '起月', dataIndex: 'from', width: 100 },
          { key: 'to', title: '止月', dataIndex: 'to', width: 100 },
          {
            key: 'scope',
            title: '可比范围',
            width: 210,
            render: (_, r) =>
              !r.active
                ? `未启用（${r.startPeriod}起）`
                : r.partial
                  ? `部分期间：${r.effectiveFrom}–${r.to}`
                  : '完整期间',
          },
          {
            key: 'account',
            title: '税科目',
            width: 130,
            render: (_, r) => (r.configured ? r.accountCode : '未配置（不能判断差额）'),
          },
          { key: 'count', title: '票数', width: 80, render: (_, r) => r.count ?? '未启用' },
          {
            key: 'face',
            title: '票面税额',
            money: true,
            width: 130,
            render: (_, r) => (r.face == null ? '未启用' : <MoneyText value={r.face} />),
          },
          {
            key: 'book',
            title: '账面税额',
            width: 130,
            money: true,
            render: (_, r) =>
              !r.active ? '未启用' : r.configured ? <MoneyText value={r.book} /> : '未配置',
          },
          {
            key: 'difference',
            title: '差额',
            width: 130,
            money: true,
            render: (_, r) =>
              !r.active ? '未启用' : r.configured ? <MoneyText value={r.difference} /> : '未配置',
          },
          {
            key: 'detail',
            title: '钻取',
            width: 180,
            render: (_, r) => (
              <Space>
                <Button size="small" disabled={!r.active} onClick={() => setDetail(r)}>
                  查看票与分录
                </Button>
                {r.active && r.accountCode && (
                  <Link
                    to={`/m/ledgers/detail?account=${r.accountCode}&from=${r.effectiveFrom}&to=${r.to}&dims=`}
                  >
                    明细账
                  </Link>
                )}
              </Space>
            ),
          },
        ]}
      />
      {detail && (
        <Drawer open title="账票差异明细" width="90%" onClose={() => setDetail(null)}>
          <p>
            本期可比范围：{detail.effectiveFrom}–{detail.to}，账套启用月份 {detail.startPeriod}。
          </p>
          <p>
            进项税处理配置：{detail.basis === 'cost' ? '税额计入成本/费用' : '税额单列或尚未配置'}
            。票面与凭证月份可能不同；点击来源核对实际科目。
          </p>
          <DataTable
            tableId="invoice-vat-docs"
            rowKey="id"
            dataSource={detail.explanations}
            columns={[
              {
                key: 'number',
                title: '票号',
                width: 240,
                render: (_, r) => (
                  <Link to={`/m/invoice/${detail.direction}?id=${r.id}`}>{r.number}</Link>
                ),
              },
              { key: 'date', title: '开票日期', dataIndex: 'date', width: 110 },
              { key: 'confirm', title: '确认日期', dataIndex: 'confirmDate', width: 110 },
              {
                key: 'reason',
                title: '解释线索',
                width: 280,
                render: (_, r) =>
                  [
                    r.crossPeriod ? '确认跨月' : '',
                    r.crossVoucherPeriod ? `凭证跨期（${r.voucherDate}）` : '',
                    r.red ? '红字' : '',
                    r.voucherStatus ?? '未制证',
                  ]
                    .filter(Boolean)
                    .join('；'),
              },
              {
                key: 'voucher',
                title: '来源凭证',
                width: 180,
                render: (_, r) =>
                  r.voucherId ? (
                    <Link to={`/m/voucher-entry/edit?id=${r.voucherId}`}>查看凭证</Link>
                  ) : (
                    '无'
                  ),
              },
            ]}
          />
          <h4>该税科目纳入账面分录</h4>
          {detail.entriesLimited && (
            <Alert
              type="warning"
              title="钻取分录达到 20 万行上限，请转明细账缩小范围；本表账面合计使用完整余额服务计算。"
            />
          )}
          <DataTable
            tableId="invoice-vat-entries"
            height={420}
            rowKey="lineId"
            dataSource={detail.entries}
            columns={[
              { key: 'date', title: '日期', dataIndex: 'date', width: 110 },
              {
                key: 'voucher',
                title: '凭证',
                width: 140,
                render: (_, r) => (
                  <Link to={`/m/voucher-entry/edit?id=${r.voucherId}`}>{r.displayNo}</Link>
                ),
              },
              { key: 'summary', title: '摘要', dataIndex: 'summary', width: 240 },
              { key: 'debit', title: '借方', dataIndex: 'debit', money: true, width: 130 },
              { key: 'credit', title: '贷方', dataIndex: 'credit', money: true, width: 130 },
            ]}
          />
        </Drawer>
      )}
    </PageContainer>
  );
}
