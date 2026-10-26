import { useAssetFilters as useUrlFilters } from './common';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox, Form, Input, InputNumber, Select, Space, Typography } from 'antd';
import { DataTable, PageContainer, type DataColumn } from '@caiwu/ui';
import { escapeHtml, printHtml } from '@caiwu/print';
import { formatMoney } from '@caiwu/core';
import { reportKinds } from '../shared';
import { useRequiredSession } from '@caiwu/web-kit';
import { api, type Outputs } from './api';
export default function ReportsPage() {
  const year = Math.trunc(useRequiredSession().book.startPeriod / 100);
  const [f, setF] = useUrlFilters({
    kind: 'list',
    year,
    cutoff: `${year}-12-31`,
    includeEarlier: false,
    fromCode: '',
    toCode: '',
    measure: 'original',
    departmentLevel: 'detail',
    categoryLevel: 'detail',
  });
  const q = useQuery(
    api.reports.queryOptions({
      ...f,
      kind: f.kind as keyof typeof reportKinds,
      measure: f.measure as 'original' | 'net' | 'depreciation',
      departmentLevel: f.departmentLevel as 'detail' | 'top',
      categoryLevel: f.categoryLevel as 'detail' | 'top',
    }),
  );
  type Row = Outputs['reports']['rows'][number];
  const columns: DataColumn<Row>[] = [
    { key: 'code', title: '设备编号/分组', dataIndex: 'code', width: 150 },
    { key: 'name', title: '名称', dataIndex: 'name', width: 200 },
    { key: 'date', title: '日期', dataIndex: 'date', width: 120 },
    { key: 'department', title: '部门', dataIndex: 'department', width: 130 },
    { key: 'category', title: '类别', dataIndex: 'category', width: 150 },
    { key: 'description', title: '摘要/规格', dataIndex: 'description', width: 180 },
    { key: 'quantity', title: '数量', dataIndex: 'quantity', width: 100 },
    {
      key: 'original',
      title: f.kind === 'distribution' ? '分布金额' : '原值/金额',
      dataIndex: 'original',
      money: true,
    },
    { key: 'depreciation', title: '累计折旧', dataIndex: 'depreciation', money: true },
    { key: 'net', title: '净值', dataIndex: 'net', money: true },
  ];
  if (f.kind === 'ledger')
    columns.splice(
      7,
      0,
      { key: 'originalChange', title: '原值增减', dataIndex: 'originalChange', money: true },
      {
        key: 'depreciationChange',
        title: '折旧增减',
        dataIndex: 'depreciationChange',
        money: true,
      },
    );
  const print = () => {
    if (!q.data?.rows.length) return;
    const rows = q.data.rows;
    if (f.kind === 'labels')
      return printHtml({
        title: '资产标签',
        pageSize: { widthMm: 88, heightMm: 51 },
        marginMm: 4,
        css: 'section h2{font-size:12px;margin:0 0 2mm}section p{font-size:9px;line-height:1.25;margin:1mm 0;overflow-wrap:anywhere}',
        html: rows
          .map(
            (r, i) =>
              `<section ${i < rows.length - 1 ? 'class="cw-page-break"' : ''}><h2>固定资产标签</h2><p>编号：${escapeHtml(r.code)}</p><p>名称：${escapeHtml(r.name)}</p><p>部门：${escapeHtml(r.department)}</p><p>类别：${escapeHtml(r.category)}</p></section>`,
          )
          .join(''),
      });
    return printHtml({
      title: q.data.title,
      orientation: 'landscape',
      html: `<h2>${escapeHtml(q.data.title)}</h2><p>截止 ${escapeHtml(f.cutoff)}</p><table><thead><tr>${columns.map((c) => `<th>${escapeHtml(c.title)}</th>`).join('')}</tr></thead><tbody>${rows
        .map(
          (r) =>
            `<tr>${columns
              .map((c) => {
                const val = r[c.dataIndex as keyof Row];
                return `<td>${escapeHtml(c.money ? formatMoney(Number(val)) : val)}</td>`;
              })
              .join('')}</tr>`,
        )
        .join('')}</tbody></table><p>原值/金额合计：${formatMoney(q.data.total)} 元</p>`,
    });
  };
  return (
    <PageContainer
      title="资产报表与标签"
      extra={
        <Button disabled={!q.data?.rows.length} onClick={() => void print()}>
          打印当前报表
        </Button>
      }
    >
      <Form
        layout="inline"
        initialValues={f}
        onFinish={setF}
        style={{ rowGap: 8, marginBottom: 16 }}
      >
        <Form.Item name="kind" label="报表">
          <Select
            style={{ width: 190 }}
            options={Object.entries(reportKinds).map(([value, label]) => ({ value, label }))}
          />
        </Form.Item>
        <Form.Item name="year" label="年度">
          <InputNumber controls={false} />
        </Form.Item>
        <Form.Item name="cutoff" label="截止日">
          <Input type="date" />
        </Form.Item>
        <Form.Item name="includeEarlier" valuePropName="checked">
          <Checkbox>到期清单含以前年度</Checkbox>
        </Form.Item>
        <Form.Item name="fromCode" label="编号从">
          <Input />
        </Form.Item>
        <Form.Item name="toCode" label="至">
          <Input />
        </Form.Item>
        <Form.Item name="measure" label="分布口径">
          <Select
            options={[
              { value: 'original', label: '原值' },
              { value: 'net', label: '净值' },
              { value: 'depreciation', label: '累计折旧' },
            ]}
          />
        </Form.Item>
        <Form.Item name="departmentLevel" label="部门">
          <Select
            options={[
              { value: 'detail', label: '明细' },
              { value: 'top', label: '大类' },
            ]}
          />
        </Form.Item>
        <Form.Item name="categoryLevel" label="资产类别">
          <Select
            options={[
              { value: 'detail', label: '细类' },
              { value: 'top', label: '大类' },
            ]}
          />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          查询报表
        </Button>
      </Form>
      <Typography.Title level={4}>{q.data?.title ?? '资产报表'}</Typography.Title>
      <Space>
        <span>标签纸张 8.8cm × 5.1cm，可按编号范围打印。</span>
      </Space>
      <DataTable
        tableId={`fixed-assets-report-${f.kind}`}
        rowKey="key"
        dataSource={q.data?.rows ?? []}
        columns={columns}
        loading={q.isLoading}
        exportName={q.data?.rows.length ? q.data.title : undefined}
        locale={{ emptyText: q.data?.empty ?? '没有记录' }}
      />
      <p>
        {f.kind === 'ledger'
          ? `各行展示增减发生额与余额。期末原值合计：${formatMoney(q.data?.total ?? 0)} 元。`
          : `金额合计：${formatMoney(q.data?.total ?? 0)} 元`}
      </p>
    </PageContainer>
  );
}
