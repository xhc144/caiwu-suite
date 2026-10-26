import { useState } from 'react';
import { Alert, Checkbox, Form, Input, Select, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { FilterBar, PageContainer, useUrlFilters } from '@caiwu/ui';
import { api } from './api';
import { InventoryNavigation } from './common';
import { Grid, ProductSelect, WarehouseSelect, useCatalog, useInventoryNavigate } from './common';
export default function ReportPage() {
  const [f, setF] = useUrlFilters({
    warehouseId: 0,
    productCode: '',
    from: '',
    to: '',
    category: '',
  });
  const { warehouses } = useCatalog();
  const warehouseId = f.warehouseId || warehouses[0]?.id || 0;
  const [mode, setMode] = useState<'receipt' | 'issue' | 'sales'>('receipt'),
    [group, setGroup] = useState<'product' | 'category' | 'account' | 'costAccount'>('product'),
    [detail, setDetail] = useState(false),
    [valuation, setValuation] = useState<'document' | 'cost'>('document');
  const navigate = useInventoryNavigate();
  const filter = {
    warehouseId: warehouseId || undefined,
    productCode: f.productCode || undefined,
    from: f.from || undefined,
    to: f.to || undefined,
    category: f.category || undefined,
  };
  const summary = useQuery({
    ...api.summary.queryOptions({
      filter: { ...filter, kind: mode === 'sales' ? undefined : mode },
      group,
      detail,
      valuation,
    }),
    enabled: mode !== 'sales',
  });
  const sales = useQuery({ ...api.sales.queryOptions(filter), enabled: mode === 'sales' });
  return (
    <PageContainer
      title="汇总与销售明细"
      subtitle="入库金额来自原单不含税金额；出库成本未核算时留空。销售明细仅含销售出库，成本状态随导出保留。"
    >
      <InventoryNavigation />
      <FilterBar initialValues={f} onSearch={setF}>
        <Form.Item label="当前仓库">
          <WarehouseSelect
            value={warehouseId || undefined}
            onChange={(warehouseId) => setF({ warehouseId })}
          />
        </Form.Item>
        <Form.Item label="产品">
          <ProductSelect
            value={f.productCode}
            onChange={(productCode) => setF({ productCode: productCode ?? '' })}
          />
        </Form.Item>
        <Form.Item name="from" label="起始日期">
          <Input type="date" />
        </Form.Item>
        <Form.Item name="to" label="截止日期">
          <Input type="date" />
        </Form.Item>
        <Form.Item name="category" label="类别">
          <Input />
        </Form.Item>
      </FilterBar>
      <Space wrap>
        <Select
          aria-label="报表类型"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'receipt', label: '入库汇总' },
            { value: 'issue', label: '出库汇总' },
            { value: 'sales', label: '销售明细账' },
          ]}
        />
        {mode !== 'sales' && (
          <>
            <Select
              aria-label="汇总方式"
              value={group}
              onChange={setGroup}
              options={[
                { value: 'product', label: '按产品' },
                { value: 'category', label: '按类别' },
                { value: 'account', label: mode === 'receipt' ? '按付款科目ID' : '按收款科目ID' },
                ...(mode === 'issue' ? [{ value: 'costAccount', label: '按成本科目ID' }] : []),
              ]}
            />
            <Checkbox checked={detail} onChange={(e) => setDetail(e.target.checked)}>
              产品明细
            </Checkbox>
            {mode === 'issue' && (
              <Select
                aria-label="金额口径"
                value={valuation}
                onChange={setValuation}
                options={[
                  { value: 'document', label: '出库单金额（非成本）' },
                  { value: 'cost', label: '真实核算成本（未核算留空）' },
                ]}
              />
            )}
          </>
        )}
      </Space>
      {(mode === 'sales' ? sales.error : summary.error) && (
        <Alert type="error" title={(mode === 'sales' ? sales.error : summary.error)?.message} />
      )}
      {mode === 'sales' ? (
        <Grid
          id="sales"
          title="销售明细账"
          rows={sales.data ?? []}
          columns={[
            { key: 'date', title: '日期', dataIndex: 'date' },
            {
              key: 'number',
              title: '单号',
              dataIndex: 'number',
              render: (_, r) => (
                <a
                  href={`/m/inventory/issues?id=${r.documentId}`}
                  onClick={(e) => {
                    e.preventDefault();
                    void navigate(`/m/inventory/issues?id=${r.documentId}`);
                  }}
                >
                  {r.number}
                </a>
              ),
            },
            { key: 'productCode', title: '产品编号', dataIndex: 'productCode' },
            { key: 'productName', title: '产品名称', dataIndex: 'productName' },
            { key: 'quantity', title: '数量', dataIndex: 'quantity' },
            { key: 'unitPrice', title: '销售单价', dataIndex: 'unitPrice' },
            { key: 'revenueCents', title: '销售收入', dataIndex: 'revenueCents', money: true },
            { key: 'costCents', title: '已核算销售成本', dataIndex: 'costCents', money: true },
            { key: 'costStatus', title: '成本/利润状态', dataIndex: 'costStatus' },
          ]}
        />
      ) : (
        <Grid
          id="summary"
          title={mode === 'receipt' ? '入库汇总' : '出库汇总'}
          rows={summary.data ?? []}
          columns={[
            { key: 'group', title: '汇总项目', dataIndex: 'group' },
            { key: 'productCode', title: '产品编号', dataIndex: 'productCode' },
            { key: 'quantity', title: '数量', dataIndex: 'quantity' },
            { key: 'amountCents', title: '金额', dataIndex: 'amountCents', money: true },
            { key: 'taxCents', title: '原单税额', dataIndex: 'taxCents', money: true },
            { key: 'grossCents', title: '原单价税合计', dataIndex: 'grossCents', money: true },
            { key: 'costStatus', title: '金额口径/核算状态', dataIndex: 'costStatus' },
          ]}
        />
      )}
    </PageContainer>
  );
}
