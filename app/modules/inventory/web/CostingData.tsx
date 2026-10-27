import { useState } from 'react';
import { Alert, Button, Drawer, Input, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { Grid, useCatalog } from './common';

export function CostingData() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const { context } = useCatalog();
  const period = selected || context?.current?.period || 202601;
  const q = useQuery({ ...api.costingSnapshot.queryOptions({ period }), enabled: open });
  const data = q.data;
  const products = new Map(data?.products.map((p) => [p.id, p]));
  const warehouses = new Map(data?.warehouses.map((w) => [w.id, w]));
  const documents = new Map(data?.documents.map((d) => [d.id, d]));
  return (
    <>
      <Button onClick={() => setOpen(true)}>查看月末库存数据</Button>
      <Drawer title="月末库存数据（只读）" open={open} onClose={() => setOpen(false)} size="large">
        <Space wrap>
          <Input
            aria-label="库存数据月份"
            type="month"
            value={`${String(period).slice(0, 4)}-${String(period).slice(4)}`}
            onChange={(e) => {
              if (e.target.value) setSelected(Number(e.target.value.replace('-', '')));
            }}
          />
          <Button loading={q.isFetching} onClick={() => void q.refetch()}>
            刷新月末数据
          </Button>
        </Space>
        <p>列出启用期初与截至所选月末的全部出入库，核算金额由成本核算发布；未核算成本留空。</p>
        {q.error && <Alert type="error" title={q.error.message} />}
        {data && (
          <>
            <p>
              截止日期：{data.cutoffDate}；成本已核算至：{data.control.costCutoffDate ?? '尚未核算'}
            </p>
            <Grid
              id="costing-opening"
              title="库存启用期初"
              rows={data.opening.map((r) => ({
                ...r,
                key: String(r.id),
                warehouse: warehouses.get(r.warehouseId)?.name,
                productCode: products.get(r.productId)?.code,
              }))}
              columns={[
                { key: 'warehouse', title: '仓库', dataIndex: 'warehouse' },
                { key: 'productCode', title: '产品编号', dataIndex: 'productCode' },
                { key: 'quantity', title: '数量', dataIndex: 'quantity' },
                { key: 'amountCents', title: '期初金额', dataIndex: 'amountCents', money: true },
              ]}
            />
            <Grid
              id="costing-movements"
              title="截至月末出入库明细"
              rows={data.movements.map((r) => {
                const d = documents.get(r.documentId)!;
                return {
                  ...r,
                  key: String(r.id),
                  date: d.date,
                  number: d.number,
                  kind: d.kind === 'receipt' ? '入库' : '出库',
                  warehouse: warehouses.get(d.warehouseId)?.name,
                  productCode: products.get(r.productId)?.code,
                  costCents:
                    d.calculationStatus === 'calculated' &&
                    r.calculationStatus === 'calculated' &&
                    d.calculationBatch === r.calculationBatch &&
                    d.calculationPeriod === r.calculationPeriod
                      ? r.outboundCostCents
                      : null,
                };
              })}
              columns={[
                { key: 'date', title: '日期', dataIndex: 'date' },
                { key: 'number', title: '单号', dataIndex: 'number' },
                { key: 'warehouse', title: '仓库', dataIndex: 'warehouse' },
                { key: 'kind', title: '方向', dataIndex: 'kind' },
                { key: 'productCode', title: '产品编号', dataIndex: 'productCode' },
                { key: 'quantity', title: '数量', dataIndex: 'quantity' },
                { key: 'netCents', title: '原单不含税金额', dataIndex: 'netCents', money: true },
                { key: 'costCents', title: '已核算出库成本', dataIndex: 'costCents', money: true },
              ]}
            />
          </>
        )}
      </Drawer>
    </>
  );
}
