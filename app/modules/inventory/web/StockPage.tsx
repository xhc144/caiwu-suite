import { useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, Select } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { FilterBar, PageContainer, useUrlFilters } from '@caiwu/ui';
import { formatMoney } from '@caiwu/core';
import { api } from './api';
import { InventoryNavigation } from './common';
import { Grid, ProductSelect, WarehouseSelect, useCatalog, useInventoryNavigate } from './common';
export default function StockPage() {
  const [f, setF] = useUrlFilters({
    warehouseId: 0,
    productCode: '',
    from: '',
    to: '',
    hideZero: false,
  });
  const { warehouses } = useCatalog();
  const warehouseId =
    f.warehouseId || warehouses.find((w) => !w.disabled)?.id || warehouses[0]?.id || 0;
  const navigate = useInventoryNavigate();
  const [valuation, setValuation] = useState('receipt');
  const filter = {
    warehouseId: warehouseId || undefined,
    productCode: f.productCode || undefined,
    from: f.from || undefined,
    to: f.to || undefined,
    hideZero: f.hideZero,
  };
  const q = useQuery(api.stock.queryOptions(filter));
  const ledger = useQuery({
    ...api.ledger.queryOptions(filter),
    enabled: !!warehouseId && !!f.productCode,
  });
  return (
    <PageContainer
      title="库存与台账"
      subtitle="数量 = 期初 + 已保存入库 − 已保存出库；盘点差异尚未转库存。所有估价均不是已核算成本。"
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
        <Form.Item name="hideZero" valuePropName="checked">
          <Checkbox>隐藏期初与发生全零项</Checkbox>
        </Form.Item>
      </FilterBar>
      <Select
        aria-label="库存估价口径"
        value={valuation}
        onChange={setValuation}
        options={[
          { value: 'receipt', label: '默认入库价估算' },
          { value: 'issue', label: '默认出库价估算' },
        ]}
      />
      {q.error && <Alert type="error" title={q.error.message} />}
      <Grid
        id="stock"
        title="库存汇总余额表（未核算/估算）"
        rows={q.data ?? []}
        columns={[
          { key: 'warehouseName', title: '仓库', dataIndex: 'warehouseName' },
          { key: 'productCode', title: '产品编号', dataIndex: 'productCode' },
          { key: 'productName', title: '产品名称', dataIndex: 'productName' },
          { key: 'opening', title: '期初数量', dataIndex: 'opening' },
          { key: 'received', title: '期间入库', dataIndex: 'received' },
          { key: 'issued', title: '期间出库', dataIndex: 'issued' },
          { key: 'balance', title: '结余数量', dataIndex: 'balance' },
          { key: 'openingCents', title: '期初金额', dataIndex: 'openingCents', money: true },
          { key: 'receiptCents', title: '入库金额', dataIndex: 'receiptCents', money: true },
          {
            key: 'issueCostCents',
            title: '出库成本（未核算留空）',
            dataIndex: 'issueCostCents',
            money: true,
          },
          {
            key: 'estimate',
            title: '结余估算金额',
            money: true,
            exportValue: (r) =>
              valuation === 'receipt' ? r.estimatedReceiptCents : r.estimatedIssueCents,
            render: (_, r) =>
              formatMoney(
                valuation === 'receipt' ? r.estimatedReceiptCents : r.estimatedIssueCents,
              ),
          },
          { key: 'costStatus', title: '成本状态', dataIndex: 'costStatus' },
          {
            key: 'ledger',
            title: '操作',
            noExport: true,
            render: (_, r) => (
              <Button
                onClick={() => setF({ productCode: r.productCode, warehouseId: r.warehouseId })}
              >
                查看台账
              </Button>
            ),
          },
        ]}
      />
      {f.productCode && (
        <>
          {ledger.error && <Alert type="error" title={ledger.error.message} />}
          <Grid
            id="ledger"
            title={`库存台账-${f.productCode}`}
            rows={ledger.data ?? []}
            columns={[
              { key: 'date', title: '日期', dataIndex: 'date' },
              { key: 'number', title: '单号', dataIndex: 'number' },
              { key: 'received', title: '入库数量', dataIndex: 'received' },
              { key: 'issued', title: '出库数量', dataIndex: 'issued' },
              { key: 'balance', title: '结余数量', dataIndex: 'balance' },
              { key: 'amountCents', title: '金额', dataIndex: 'amountCents', money: true },
              { key: 'costStatus', title: '核算状态', dataIndex: 'costStatus' },
              {
                key: 'source',
                title: '操作',
                noExport: true,
                render: (_, r) =>
                  r.documentId && (
                    <Button
                      onClick={() =>
                        void navigate(
                          `/m/inventory/${r.kind === 'receipt' ? 'receipts' : 'issues'}?id=${r.documentId}`,
                        )
                      }
                    >
                      查看原单
                    </Button>
                  ),
              },
            ]}
          />
        </>
      )}
    </PageContainer>
  );
}
