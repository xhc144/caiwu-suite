import { useMemo, useState } from 'react';
import { Alert, Button, Input, Select, Space, Table } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { formatMoney, periodEndDate, periodStartDate, sumCents } from '@caiwu/core';
import { showError } from '@caiwu/web-kit';
import { exportToExcel, PageContainer, type ExcelColumn } from '@caiwu/ui';
import { escapeHtml, printHtml } from '@caiwu/print';
import type { ProfitLine } from '../shared';
import { api } from './api';

type ReportRow = Omit<ProfitLine, 'id'> & { id: number | string };

export default function ProfitPage({ detail = false }: { detail?: boolean }) {
  const title = detail ? '销售明细账' : '收入成本利润表';
  const context = useQuery(api.context.queryOptions());
  const p = context.data?.currentPeriod ?? 202601;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [productFrom, setProductFrom] = useState('');
  const [productTo, setProductTo] = useState('');
  const [outputBusy, setOutputBusy] = useState(false);
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
  const warehouseName = (id: number) =>
    id === 0 ? '' : (context.data?.warehouses.find((w) => w.id === id)?.name ?? String(id));
  const rows = useMemo<ReportRow[]>(() => {
    if (!report.data) return [];
    if (detail) return report.data.rows;
    const groups = new Map<string, ReportRow>();
    for (const line of report.data.rows) {
      const key = `${line.warehouseId}:${line.productCode}`;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, { ...line, id: key });
        continue;
      }
      existing.quantity = new Decimal(existing.quantity).plus(line.quantity).toFixed();
      existing.revenueCents = sumCents([existing.revenueCents, line.revenueCents]);
      existing.taxCents = sumCents([existing.taxCents, line.taxCents]);
      existing.costCents =
        existing.costCents == null || line.costCents == null
          ? null
          : sumCents([existing.costCents, line.costCents]);
      existing.grossProfitCents =
        existing.grossProfitCents == null || line.grossProfitCents == null
          ? null
          : sumCents([existing.grossProfitCents, line.grossProfitCents]);
      if (line.costStatus !== '已核算') existing.costStatus = line.costStatus;
    }
    return [...groups.values()];
  }, [report.data, detail]);
  const columns = [
    ...(detail
      ? [
          { title: '日期', dataIndex: 'date' },
          { title: '单号', dataIndex: 'number' },
        ]
      : []),
    {
      title: '仓库',
      key: 'warehouse',
      render: (_: unknown, r: ReportRow) => warehouseName(r.warehouseId),
    },
    { title: '产品编号', dataIndex: 'productCode' },
    { title: '产品名称', dataIndex: 'productName' },
    { title: '数量', dataIndex: 'quantity' },
    ...(['revenueCents', 'taxCents', 'costCents', 'grossProfitCents'] as const).map((key, i) => ({
      title: ['不含税收入', '销项税额', '销售成本', '销售毛利'][i],
      key,
      render: (_: unknown, r: ReportRow) => (r[key] == null ? r.costStatus : formatMoney(r[key])),
    })),
    { title: '成本状态', dataIndex: 'costStatus' },
    ...(detail
      ? [
          {
            title: '来源',
            key: 'source',
            render: (_: unknown, r: ReportRow) => (
              <Space>
                <a href={`/m/inventory/issues?id=${r.documentId}`}>查看出库单</a>
                <a href={`/m/costing/vouchers?id=${r.documentId}&purpose=revenue`}>
                  收入与成本凭证
                </a>
              </Space>
            ),
          },
        ]
      : []),
  ];
  const exportColumns: ExcelColumn<ReportRow>[] = [
    ...(detail
      ? [
          { title: '日期', value: (r: ReportRow) => r.date },
          { title: '单号', value: (r: ReportRow) => r.number },
        ]
      : []),
    { title: '仓库', value: (r) => warehouseName(r.warehouseId) },
    { title: '产品编号', value: (r) => r.productCode },
    { title: '产品名称', value: (r) => r.productName },
    { title: '数量', value: (r) => r.quantity },
    { title: '不含税收入', money: true, value: (r) => r.revenueCents },
    { title: '销项税额', money: true, value: (r) => r.taxCents },
    { title: '销售成本', money: true, value: (r) => r.costCents },
    { title: '销售毛利', money: true, value: (r) => r.grossProfitCents },
    { title: '成本状态', value: (r) => r.costStatus },
  ];
  const output = async (print: boolean) => {
    if (!report.data || !input) return;
    setOutputBusy(true);
    try {
      const description = `${report.data.orgName} · ${input.from} 至 ${input.to} · 金额单位：元`;
      const totals = report.data.totals;
      const footer = `合计：不含税收入 ${formatMoney(totals.revenueCents)}；销项税额 ${formatMoney(totals.taxCents)}；销售成本 ${totals.costCents == null ? '待核算' : formatMoney(totals.costCents)}；销售毛利 ${totals.grossProfitCents == null ? '待核算' : formatMoney(totals.grossProfitCents)}`;
      if (print) {
        await printHtml({
          title,
          pageSize: 'A4',
          orientation: 'landscape',
          html: `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><table><thead><tr>${exportColumns.map((c) => `<th>${escapeHtml(c.title)}</th>`).join('')}</tr></thead><tbody>${rows
            .map(
              (r) =>
                `<tr>${exportColumns
                  .map((c) => {
                    const v = c.value(r);
                    return `<td>${escapeHtml(c.money && typeof v === 'number' ? formatMoney(v) : v)}</td>`;
                  })
                  .join('')}</tr>`,
            )
            .join('')}</tbody></table><p>${escapeHtml(footer)}</p>`,
          css: 'thead{display:table-header-group} tr{break-inside:avoid} h1{font-size:18px}',
        });
      } else {
        await exportToExcel({
          fileName: `${title}_${input.from}_${input.to}`,
          sheetName: title,
          title: `${title} · ${description}`,
          columns: exportColumns,
          rows: [
            ...rows,
            {
              id: 'total',
              documentId: 0,
              date: '',
              number: '',
              warehouseId: 0,
              productCode: '合计',
              productName: '',
              quantity: '',
              revenueCents: totals.revenueCents,
              taxCents: totals.taxCents,
              costCents: totals.costCents,
              grossProfitCents: totals.grossProfitCents,
              costStatus: totals.pendingLines ? '待成本核算' : '已核算',
            },
          ],
        });
      }
    } catch (error) {
      showError(error);
    } finally {
      setOutputBusy(false);
    }
  };
  return (
    <PageContainer title={title} subtitle="仅销售类别出库；销售毛利＝不含税收入－销售成本。">
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
          <Button
            aria-label="导出 Excel"
            disabled={!report.data}
            loading={outputBusy}
            onClick={() => void output(false)}
          >
            导出 Excel
          </Button>
          <Button
            aria-label="打印"
            disabled={!report.data}
            loading={outputBusy}
            onClick={() => void output(true)}
          >
            打印
          </Button>
          <a href={detail ? '/m/costing/profit' : '/m/costing/sales'}>
            {detail ? '查看收入成本利润表' : '查看销售明细账'}
          </a>
        </Space>
        {(context.error || report.error) && (
          <Alert type="error" title={(context.error ?? report.error)?.message} />
        )}
        {report.data && (
          <>
            <Alert
              type={report.data.totals.pendingLines ? 'warning' : 'info'}
              title={`不含税收入 ${formatMoney(report.data.totals.revenueCents)}；销售成本 ${report.data.totals.costCents == null ? '待成本核算' : formatMoney(report.data.totals.costCents)}；销售毛利 ${report.data.totals.grossProfitCents == null ? '待成本核算' : formatMoney(report.data.totals.grossProfitCents)}`}
              description={
                report.data.totals.pendingLines
                  ? '部分销售尚无可核验成本，相关成本与毛利留空；完成核算后重新查询。'
                  : undefined
              }
            />
            <Table<ReportRow>
              rowKey="id"
              pagination={false}
              dataSource={rows}
              columns={columns}
              scroll={{ x: 1200 }}
              loading={report.isFetching}
            />
          </>
        )}
      </Space>
    </PageContainer>
  );
}
