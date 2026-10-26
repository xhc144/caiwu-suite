import { useState } from 'react';
import { Alert, Button, Input, Select, Space, Table } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { formatMoney, periodEndDate, periodStartDate } from '@caiwu/core';
import { PageContainer } from '@caiwu/ui';
import type { ProfitLine } from '../shared';
import { api } from './api';

export default function ProfitPage() {
  const context = useQuery(api.context.queryOptions());
  const p = context.data?.currentPeriod ?? 202601;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [productFrom, setProductFrom] = useState('');
  const [productTo, setProductTo] = useState('');
  const [input, setInput] = useState<{
    from: string;
    to: string;
    warehouseId?: number;
    productFrom?: string;
    productTo?: string;
  } | null>(null);
  const report = useQuery(
    api.profit.queryOptions(input ?? { from: periodStartDate(p), to: periodEndDate(p) }, {
      enabled: !!input,
      retry: false,
    }),
  );
  const columns = [
    { title: '日期', dataIndex: 'date' },
    { title: '单号', dataIndex: 'number' },
    { title: '产品编号', dataIndex: 'productCode' },
    { title: '产品名称', dataIndex: 'productName' },
    { title: '数量', dataIndex: 'quantity' },
    ...(['revenueCents', 'taxCents', 'costCents', 'grossProfitCents'] as const).map((key, i) => ({
      title: ['不含税收入', '销项税额', '销售成本', '销售毛利'][i],
      key,
      render: (_: unknown, r: ProfitLine) => (r[key] == null ? r.costStatus : formatMoney(r[key])),
    })),
    { title: '成本状态', dataIndex: 'costStatus' },
    {
      title: '来源',
      key: 'source',
      render: (_: unknown, r: ProfitLine) => (
        <a href={`/m/inventory/issues?id=${r.documentId}`}>查看出库单</a>
      ),
    },
  ];
  return (
    <PageContainer
      title="收入成本利润表"
      subtitle="仅销售类别出库；销售毛利＝不含税收入－销售成本。销售费用与附加税分摊尚未接入。"
    >
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Space wrap>
          <label>
            起始日期{' '}
            <Input
              aria-label="起始日期"
              type="date"
              value={from || periodStartDate(p)}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            截止日期{' '}
            <Input
              aria-label="截止日期"
              type="date"
              value={to || periodEndDate(p)}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label>
            仓库{' '}
            <Select
              aria-label="仓库"
              value={warehouseId ?? undefined}
              allowClear
              placeholder="全部仓库"
              style={{ width: 180 }}
              options={(context.data?.warehouses ?? []).map((w) => ({
                value: w.id,
                label: `${w.code} ${w.name}`,
              }))}
              onChange={(v) => setWarehouseId(v ?? null)}
            />
          </label>
          <Input
            aria-label="产品从"
            placeholder="产品编号从"
            value={productFrom}
            onChange={(e) => setProductFrom(e.target.value)}
          />
          <Input
            aria-label="产品到"
            placeholder="产品编号到"
            value={productTo}
            onChange={(e) => setProductTo(e.target.value)}
          />
          <Button
            type="primary"
            loading={report.isFetching}
            onClick={() => {
              const next = {
                from: from || periodStartDate(p),
                to: to || periodEndDate(p),
                warehouseId: warehouseId ?? undefined,
                productFrom: productFrom || undefined,
                productTo: productTo || undefined,
              };
              if (JSON.stringify(next) === JSON.stringify(input)) void report.refetch();
              else setInput(next);
            }}
          >
            查询销售明细
          </Button>
        </Space>
        {report.error && <Alert type="error" title={report.error.message} />}
        {report.data && (
          <>
            <Alert
              type={report.data.totals.pendingLines ? 'warning' : 'info'}
              title={`不含税收入 ${formatMoney(report.data.totals.revenueCents)}；销售成本 ${report.data.totals.costCents == null ? (report.data.totals.unknownHistoryLines ? '历史成本未知' : '待成本核算') : formatMoney(report.data.totals.costCents)}；销售毛利 ${report.data.totals.grossProfitCents == null ? (report.data.totals.unknownHistoryLines ? '历史成本未知' : '待成本核算') : formatMoney(report.data.totals.grossProfitCents)}`}
              description={
                report.data.totals.unknownHistoryLines
                  ? '历史成本的有效批次链或来源头行证据不完整，相关成本和毛利暂不提供。'
                  : undefined
              }
            />
            <Table<ProfitLine>
              rowKey="id"
              pagination={false}
              dataSource={report.data.rows}
              columns={columns}
              scroll={{ x: 1200 }}
            />
          </>
        )}
      </Space>
    </PageContainer>
  );
}
