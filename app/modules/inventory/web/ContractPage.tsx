import { useState } from 'react';
import { Alert, Button, Drawer, Form, Input, Select, Space } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DimensionSelect, FilterBar, PageContainer, useUrlFilters } from '@caiwu/ui';
import { usePermission } from '@caiwu/web-kit';
import type { ContractInput } from '../shared';
import { api } from './api';
import { InventoryNavigation } from './common';
import {
  Field,
  Grid,
  LineEditor,
  TextField,
  WarehouseSelect,
  mayDiscard,
  newLine,
  useInventoryNavigate,
  useCatalog,
  useRefresh,
  useUnsaved,
} from './common';
export default function ContractPage() {
  const [f, setF] = useUrlFilters({ warehouseId: 0, keyword: '', from: '', to: '' });
  const { warehouses, context } = useCatalog();
  const warehouseId =
    f.warehouseId || warehouses.find((w) => !w.disabled)?.id || warehouses[0]?.id || 0;
  const q = useQuery(
    api.contracts.queryOptions({
      warehouseId: warehouseId || undefined,
      keyword: f.keyword || undefined,
      from: f.from || undefined,
      to: f.to || undefined,
    }),
  );
  const [draft, setDraft] = useState<ContractInput | null>(null),
    [dirty, setDirty] = useState(false);
  const can = usePermission('inventory.edit');
  const refresh = useRefresh(),
    client = useQueryClient(),
    navigate = useInventoryNavigate();
  const save = useMutation(api.saveContract.mutationOptions());
  useUnsaved(dirty);
  const patch = (v: Partial<ContractInput>) => {
    setDraft((d) => (d ? { ...d, ...v } : d));
    setDirty(true);
  };
  const open = async (id: number, copy = false) => {
    if (!mayDiscard(dirty)) return;
    const c = await client.fetchQuery(api.contract.queryOptions({ id }));
    setDraft({
      id: copy ? undefined : c.id,
      revision: copy ? undefined : c.revision,
      number: copy ? '' : c.number,
      warehouseId: c.warehouse_id,
      supplierId: c.supplier_id,
      date: c.date,
      agent: c.agent,
      dueDate: c.due_date,
      note: c.note,
      status: copy ? 'open' : c.status,
      lines: c.lines.map((l) => ({
        productCode: l.productCode,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        priceIncludesTax: false,
        note: l.note,
      })),
    });
    setDirty(copy);
  };
  return (
    <PageContainer
      title="采购合同"
      subtitle="采购合同与出入库分开保存；合同本身不影响库存。带入入库后，保存入库才计数量。"
      extra={
        can && (
          <Button
            type="primary"
            disabled={!warehouseId}
            onClick={() => {
              if (mayDiscard(dirty)) {
                setDraft({
                  number: '',
                  warehouseId,
                  supplierId: 0,
                  date: context?.current?.startDate ?? '2026-01-01',
                  agent: '',
                  dueDate: null,
                  note: '',
                  status: 'open',
                  lines: [newLine()],
                });
                setDirty(false);
              }
            }}
          >
            新增采购合同
          </Button>
        )
      }
    >
      <InventoryNavigation />
      <FilterBar initialValues={f} onSearch={setF}>
        <Form.Item label="当前仓库">
          <WarehouseSelect
            value={warehouseId || undefined}
            onChange={(warehouseId) => setF({ warehouseId })}
          />
        </Form.Item>
        <Form.Item name="keyword" label="合同号">
          <Input />
        </Form.Item>
        <Form.Item name="from" label="起始日期">
          <Input type="date" />
        </Form.Item>
        <Form.Item name="to" label="截止日期">
          <Input type="date" />
        </Form.Item>
      </FilterBar>
      {q.error && <Alert type="error" title={q.error.message} />}
      <Grid
        id="contracts"
        title="采购合同"
        rows={q.data ?? []}
        columns={[
          { key: 'number', title: '合同号', dataIndex: 'number' },
          { key: 'supplier_name', title: '供应商', dataIndex: 'supplier_name' },
          { key: 'date', title: '日期', dataIndex: 'date' },
          { key: 'agent', title: '经办人', dataIndex: 'agent' },
          { key: 'due_date', title: '交期', dataIndex: 'due_date' },
          {
            key: 'status',
            title: '执行状态',
            exportValue: (c) =>
              ({ open: '执行中', completed: '已完成', cancelled: '已取消' })[c.status],
            render: (_, c) =>
              ({ open: '执行中', completed: '已完成', cancelled: '已取消' })[c.status],
          },
          {
            key: 'actions',
            title: '操作',
            noExport: true,
            render: (_, c) => (
              <Space>
                <Button onClick={() => void open(c.id)}>查看/编辑合同</Button>
                {can && (
                  <>
                    <Button onClick={() => void open(c.id, true)}>复制合同</Button>
                    <Button
                      onClick={() => void navigate(`/m/inventory/receipts?contractId=${c.id}`)}
                    >
                      带入新入库草稿
                    </Button>
                  </>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Drawer
        title="采购合同头与明细"
        open={!!draft}
        size="large"
        onClose={() => {
          if (mayDiscard(dirty)) {
            setDraft(null);
            setDirty(false);
          }
        }}
        extra={
          can && (
            <Button
              type="primary"
              loading={save.isPending}
              onClick={async () => {
                if (draft) {
                  await save.mutateAsync(draft);
                  setDraft(null);
                  setDirty(false);
                  await refresh();
                }
              }}
            >
              保存合同
            </Button>
          )
        }
      >
        {draft && (
          <Form layout="vertical" disabled={!can}>
            <TextField
              label="合同号"
              value={draft.number}
              onChange={(number) => patch({ number })}
            />
            <Field label="合同仓库">
              <WarehouseSelect
                value={draft.warehouseId}
                onChange={(warehouseId) => patch({ warehouseId })}
              />
            </Field>
            <Field label="供应商">
              <DimensionSelect
                aria-label="供应商"
                type="partner"
                value={draft.supplierId || undefined}
                onChange={(supplierId) => patch({ supplierId })}
              />
            </Field>
            <TextField
              label="合同日期"
              type="date"
              value={draft.date}
              onChange={(date) => patch({ date })}
            />
            <TextField
              label="交期"
              type="date"
              value={draft.dueDate ?? ''}
              onChange={(dueDate) => patch({ dueDate: dueDate || null })}
            />
            <TextField label="经办人" value={draft.agent} onChange={(agent) => patch({ agent })} />
            <TextField label="合同说明" value={draft.note} onChange={(note) => patch({ note })} />
            <Field label="执行状态">
              <Select
                value={draft.status}
                onChange={(status) => patch({ status })}
                options={[
                  { value: 'open', label: '执行中' },
                  { value: 'completed', label: '已完成' },
                  { value: 'cancelled', label: '已取消' },
                ]}
              />
            </Field>
            <LineEditor opening lines={draft.lines} onChange={(lines) => patch({ lines })} />
          </Form>
        )}
      </Drawer>
    </PageContainer>
  );
}
