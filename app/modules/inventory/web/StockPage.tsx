import { useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, Select } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { FilterBar, PageContainer, useUrlFilters } from '@caiwu/ui';
import { formatMoney } from '@caiwu/core';
import { api } from './api';
import { CostingData } from './CostingData';
import BatchLedgers from './BatchLedgers';
import { InventoryNavigation } from './common';
import { Grid, ProductSelect, WarehouseSelect, useCatalog, useInventoryNavigate } from './common';
export default function StockPage() {
  const [f, setF] = useUrlFilters({
    warehouseId: 0,
    productCode: '',
    productFrom: '',
    productTo: '',
    from: '',
    to: '',
    hideZero: false,
  });
  const { warehouses } = useCatalog();
  const warehouseId =
    f.warehouseId || warehouses.find((w) => !w.disabled)?.id || warehouses[0]?.id || 0;
  const navigate = useInventoryNavigate();
  const [valuation, setValuation] = useState('cost');
  const filter = {
    warehouseId: warehouseId || undefined,
    productCode: f.productCode || undefined,
    productFrom: f.productFrom || undefined,
    productTo: f.productTo || undefined,
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
      subtitle="数量 = 期初 + 已保存入库 − 已保存出库。账面金额扣除已核算出库成本；缺少成本时留空。盘点差异尚未转库存。"
    >
      <InventoryNavigation />
      <CostingData />
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
        <Form.Item label="起始产品">
          <ProductSelect
            label="起始产品"
            value={f.productFrom}
            onChange={(productFrom) => setF({ productFrom: productFrom ?? '' })}
          />
        </Form.Item>
        <Form.Item label="截止产品">
          <ProductSelect
            label="截止产品"
            value={f.productTo}
            onChange={(productTo) => setF({ productTo: productTo ?? '' })}
          />
        </Form.Item>
        <Form.Item name="to" label="截止日期">
          <Input type="date" />
        </Form.Item>
        <Form.Item name="hideZero" valuePropName="checked">
          <Checkbox>隐藏期末零数量</Checkbox>
        </Form.Item>
      </FilterBar>
      <Select
        aria-label="库存估价口径"
        value={valuation}
        onChange={setValuation}
        options={[
          { value: 'cost', label: '账面成本（未核算留空）' },
          { value: 'receipt', label: '默认入库价估算' },
          { value: 'issue', label: '默认出库价估算' },
        ]}
      />
      <BatchLedgers filter={filter} />
      {q.error && <Alert type="error" title={q.error.message} />}
      <Grid
        id="stock"
        title="库存汇总余额表"
        rows={q.data ?? []}
        columns={[
          { key: 'warehouseName', title: '仓库', dataIndex: 'warehouseName' },
          { key: 'productCode', title: '产品编号', dataIndex: 'productCode' },
          { key: 'productName', title: '产品名称', dataIndex: 'productName' },
          { key: 'opening', title: '期初数量', dataIndex: 'opening' },
          { key: 'received', title: '期间入库', dataIndex: 'received' },
          { key: 'issued', title: '期间出库', dataIndex: 'issued' },
          { key: 'adjustmentQuantity', title: '正式盘点调整', dataIndex: 'adjustmentQuantity' },
          { key: 'balance', title: '结余数量', dataIndex: 'balance' },
          { key: 'openingCents', title: '期初金额', dataIndex: 'openingCents', money: true },
          { key: 'receiptCents', title: '入库金额', dataIndex: 'receiptCents', money: true },
          {
            key: 'adjustmentCents',
            title: '正式核算调整金额',
            dataIndex: 'adjustmentCents',
            money: true,
          },
          {
            key: 'issueCostCents',
            title: '出库成本（未核算留空）',
            dataIndex: 'issueCostCents',
            money: true,
          },
          {
            key: 'estimate',
            title: valuation === 'cost' ? '结余账面金额' : '结余估算金额',
            money: true,
            exportValue: (r) =>
              valuation === 'cost'
                ? r.balanceCents
                : valuation === 'receipt'
                  ? r.estimatedReceiptCents
                  : r.estimatedIssueCents,
            render: (_, r) =>
              formatMoney(
                valuation === 'cost'
                  ? r.balanceCents
                  : valuation === 'receipt'
                    ? r.estimatedReceiptCents
                    : r.estimatedIssueCents,
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
              { key: 'unitPrice', title: '本笔成本单价（元）', dataIndex: 'unitPrice' },
              {
                key: 'balanceUnitPrice',
                title: '结余成本单价（元）',
                dataIndex: 'balanceUnitPrice',
              },
              {
                key: 'balanceCents',
                title: '结余账面金额',
                dataIndex: 'balanceCents',
                money: true,
              },
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
