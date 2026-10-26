import { useAssetFilters as useUrlFilters } from './common';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox, Form, Input, InputNumber, Select, Space } from 'antd';
import { DataTable, DimensionSelect, PageContainer } from '@caiwu/ui';
import { formatMoney } from '@caiwu/core';
import { useRequiredSession } from '@caiwu/web-kit';
import { api } from './api';
import { Confirm, MasterSelect } from './common';
export default function QueriesPage() {
  const year = Math.trunc(useRequiredSession().book.startPeriod / 100);
  const [f, setF] = useUrlFilters({
    from: year * 100 + 1,
    to: year * 100 + 12,
    showZero: false,
    assetId: 0,
    departmentId: 0,
    categoryId: 0,
    purposeId: 0,
    field: 'code',
    op: 'eq',
    value: '',
    departmentLevel: 'detail',
    categoryLevel: 'detail',
  });
  const [version, setVersion] = useState(0);
  const [draftId] = useState(() => {
    const id = `fixed-assets-query-draft-${crypto.randomUUID()}`;
    for (const name of ['query', 'distribution'])
      localStorage.setItem(
        `caiwu.table.${id}-${name}.widths`,
        localStorage.getItem(`caiwu.fixed-assets.${name}.confirmed-widths`) ?? '{}',
      );
    return id;
  });
  useEffect(
    () => () => {
      for (const name of ['query', 'distribution'])
        localStorage.removeItem(`caiwu.table.${draftId}-${name}.widths`);
    },
    [draftId],
  );
  const input = {
    from: f.from,
    to: f.to,
    showZero: f.showZero,
    assetId: f.assetId || undefined,
    departmentId: f.departmentId || undefined,
    categoryId: f.categoryId || undefined,
    purposeId: f.purposeId || undefined,
    conditions: f.value
      ? [
          {
            field: f.field as 'code' | 'name' | 'amount' | 'useDate',
            op: f.op as 'eq' | 'contains' | 'gt' | 'lt',
            value: f.value,
          },
        ]
      : [],
    departmentLevel: f.departmentLevel as 'detail' | 'top',
    categoryLevel: f.categoryLevel as 'detail' | 'top',
  };
  const q = useQuery(api.query.queryOptions(input));
  const cards = useQuery(api.list.queryOptions({ includeDisposed: true }));
  return (
    <PageContainer title="折旧查询与分布">
      <Form
        layout="inline"
        initialValues={f}
        onFinish={setF}
        style={{ rowGap: 8, marginBottom: 16 }}
      >
        <Form.Item name="from" label="起始月份">
          <InputNumber controls={false} />
        </Form.Item>
        <Form.Item name="to" label="截止月份">
          <InputNumber controls={false} />
        </Form.Item>
        <Form.Item name="showZero" valuePropName="checked">
          <Checkbox>显示零折旧</Checkbox>
        </Form.Item>
        <Form.Item name="assetId" label="资产">
          <Select
            allowClear
            style={{ minWidth: 200 }}
            showSearch={{ optionFilterProp: 'label' }}
            options={(cards.data ?? []).map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))}
          />
        </Form.Item>
        <Form.Item name="departmentId" label="部门">
          <DimensionSelect type="department" />
        </Form.Item>
        <Form.Item name="categoryId" label="类别">
          <MasterSelect kind="category" />
        </Form.Item>
        <Form.Item name="purposeId" label="用途">
          <MasterSelect kind="purpose" />
        </Form.Item>
        <Form.Item name="departmentLevel" label="部门聚合">
          <Select
            options={[
              { value: 'detail', label: '明细部门' },
              { value: 'top', label: '部门大类' },
            ]}
          />
        </Form.Item>
        <Form.Item name="categoryLevel" label="类别聚合">
          <Select
            options={[
              { value: 'detail', label: '资产细类' },
              { value: 'top', label: '资产大类' },
            ]}
          />
        </Form.Item>
        <Form.Item name="field" label="综合条件">
          <Select
            options={[
              { value: 'code', label: '编码' },
              { value: 'name', label: '名称' },
              { value: 'amount', label: '折旧额（整数分）' },
              { value: 'useDate', label: '使用日期' },
            ]}
          />
        </Form.Item>
        <Form.Item name="op">
          <Select
            options={[
              { value: 'eq', label: '等于' },
              { value: 'contains', label: '含有' },
              { value: 'gt', label: '大于' },
              { value: 'lt', label: '小于' },
            ]}
          />
        </Form.Item>
        <Form.Item name="value">
          <Input />
        </Form.Item>
        <Button htmlType="submit" type="primary">
          查询
        </Button>
      </Form>
      <Space>
        <Confirm
          title="确认将当前列宽格式保存在本机？"
          onConfirm={() => {
            for (const name of ['query', 'distribution'])
              localStorage.setItem(
                `caiwu.fixed-assets.${name}.confirmed-widths`,
                localStorage.getItem(`caiwu.table.${draftId}-${name}.widths`) ?? '{}',
              );
          }}
        >
          记录列宽
        </Confirm>
        <Confirm
          title="确认恢复标准列宽？"
          onConfirm={() => {
            for (const name of ['query', 'distribution']) {
              localStorage.removeItem(`caiwu.fixed-assets.${name}.confirmed-widths`);
              localStorage.removeItem(`caiwu.table.${draftId}-${name}.widths`);
            }
            setVersion((v) => v + 1);
          }}
        >
          恢复默认列宽
        </Confirm>
      </Space>
      <DataTable
        key={version}
        tableId={`${draftId}-query`}
        rowKey="id"
        dataSource={q.data?.rows ?? []}
        exportName={q.data?.rows.length ? '折旧查询' : undefined}
        columns={[
          { key: 'period', title: '月份', dataIndex: 'period', width: 100 },
          { key: 'code', title: '编号', dataIndex: 'code', width: 120 },
          { key: 'name', title: '设备', dataIndex: 'name', width: 170 },
          { key: 'department', title: '部门', dataIndex: 'department', width: 130 },
          { key: 'category', title: '类别', dataIndex: 'category', width: 150 },
          { key: 'purpose', title: '用途', dataIndex: 'purpose', width: 130 },
          { key: 'work', title: '月工作量', dataIndex: 'work', width: 120 },
          { key: 'amount', title: '折旧额', dataIndex: 'amount', money: true },
          { key: 'issue', title: '跳过或说明', dataIndex: 'issue', width: 220 },
        ]}
      />
      <p>明细合计：{formatMoney(q.data?.total ?? 0)} 元</p>
      <DataTable
        key={`distribution-${version}`}
        tableId={`${draftId}-distribution`}
        rowKey="group"
        dataSource={q.data?.distribution ?? []}
        columns={[
          { key: 'group', title: '部门 / 资产类别', dataIndex: 'group', width: 350 },
          { key: 'amount', title: '折旧额', dataIndex: 'amount', money: true },
        ]}
        exportName={q.data?.distribution.length ? '折旧分布表' : undefined}
      />
    </PageContainer>
  );
}
