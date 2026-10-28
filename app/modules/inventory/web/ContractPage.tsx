import { useRef, useState } from 'react';
import { Alert, Button, Drawer, Form, Input, Select, Space } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DimensionSelect, FilterBar, PageContainer, useUrlFilters, exportToExcel } from '@caiwu/ui';
import { usePermission, useTab } from '@caiwu/web-kit';
import type { ContractInput } from '../shared';
import { api } from './api';
import { InventoryNavigation } from './common';
import ImportButton from './ImportButton';
import { importExportColumns } from '../excel';
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
  const { active } = useTab();
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
  const remove = useMutation(api.removeContract.mutationOptions());
  const status = useMutation(api.setContractStatus.mutationOptions());
  const [fulfillmentId, setFulfillmentId] = useState(0);
  const fulfillment = useQuery({
    ...api.contractFulfillment.queryOptions({ id: fulfillmentId || 1 }),
    enabled: !!fulfillmentId,
  });
  const latest = useRef(draft);
  latest.current = draft;
  const submit = async () => {
    if (!draft || save.isPending) return false;
    const saved = await save.mutateAsync(draft);
    if (latest.current === draft) {
      setDraft(null);
      setDirty(false);
    } else {
      setDraft((current) =>
        current ? { ...current, id: saved.id, revision: saved.revision } : current,
      );
    }
    await refresh();
    return true;
  };
  useUnsaved(dirty, {
    pending: save.isPending,
    title: `采购合同${draft?.number ? `：${draft.number}` : ''}`,
    version: JSON.stringify(draft),
    save: submit,
    discard: () => {
      setDraft(null);
      setDirty(false);
    },
  });
  const patch = (v: Partial<ContractInput>) => {
    setDraft((d) => (d ? { ...d, ...v } : d));
    setDirty(true);
  };
  const open = async (id: number, copy = false) => {
    if (save.isPending || !mayDiscard(dirty)) return;
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
      subtitle="采购合同本身不影响库存；可分批带入剩余数量，来源入库和反冲会更新履约。合同文件仅迁移合同头行。"
      extra={
        <Space wrap>
          <ImportButton kind="contracts" />
          <Button
            disabled={!q.data?.length || q.data.length > 200}
            onClick={async () => {
              const ids = (q.data ?? []).map((c) => c.id);
              if (
                !ids.length ||
                !window.confirm(`确认导出当前查询的 ${ids.length} 张合同完整头行？`)
              )
                return;
              const rows = await client.fetchQuery(api.exportContracts.queryOptions({ ids }));
              await exportToExcel({
                fileName: '采购合同完整头行',
                columns: importExportColumns('contracts'),
                rows,
              });
            }}
          >
            导出当前合同头行
          </Button>
          {can && (
            <Button
              type="primary"
              disabled={!warehouseId || save.isPending}
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
          )}
        </Space>
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
                <Button onClick={() => setFulfillmentId(c.id)}>履约明细</Button>
                {can && (
                  <>
                    <Button onClick={() => void open(c.id, true)}>复制合同</Button>
                    <Button
                      disabled={c.status !== 'open'}
                      onClick={() => void navigate(`/m/inventory/receipts?contractId=${c.id}`)}
                    >
                      带入新入库草稿
                    </Button>
                    <Button
                      danger
                      loading={remove.isPending}
                      onClick={async () => {
                        if (save.isPending || (draft?.id === c.id && !mayDiscard(dirty))) return;
                        if (
                          !window.confirm(
                            `确认删除采购合同 ${c.number} 及其明细？已有来源入库的合同将保留。`,
                          )
                        )
                          return;
                        await remove.mutateAsync({
                          id: c.id,
                          revision: c.revision,
                          confirmed: true,
                        });
                        if (draft?.id === c.id) {
                          setDraft(null);
                          setDirty(false);
                        }
                        await refresh();
                      }}
                    >
                      删除合同
                    </Button>
                  </>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Drawer
        mask={false}
        title="采购合同履约明细"
        open={active && !!fulfillmentId}
        size="large"
        onClose={() => setFulfillmentId(0)}
      >
        {fulfillment.error && <Alert type="error" title={fulfillment.error.message} />}
        {fulfillment.data && (
          <>
            <Alert
              type="info"
              title={`合同 ${fulfillment.data.contract.number}：来源入库按已保存数量累计；整单反冲后恢复未入库数量，删除反冲单后恢复原履约。恢复额度已被后续入库使用时，须先处理后续入库才能撤销反冲。`}
            />
            {can && (
              <Space wrap>
                {(['completed', 'cancelled', 'open'] as const).map((value) => {
                  const label = {
                    completed: '标记全部完成',
                    cancelled: '取消剩余采购',
                    open: '恢复执行',
                  }[value];
                  return (
                    <Button
                      key={value}
                      disabled={fulfillment.data.contract.status === value}
                      loading={status.isPending}
                      onClick={async () => {
                        const c = fulfillment.data!.contract;
                        if (!window.confirm(`确认将采购合同 ${c.number}${label}？`)) return;
                        await status.mutateAsync({
                          id: c.id,
                          revision: c.revision,
                          status: value,
                          confirmed: true,
                        });
                        await refresh();
                      }}
                    >
                      {label}
                    </Button>
                  );
                })}
              </Space>
            )}
            <Grid
              id="contract-fulfillment"
              title="采购数量履约"
              rows={fulfillment.data.rows}
              columns={[
                { key: 'productCode', title: '产品编号', dataIndex: 'productCode' },
                { key: 'productName', title: '产品名称', dataIndex: 'productName' },
                { key: 'planned', title: '合同数量', dataIndex: 'planned' },
                { key: 'received', title: '累计入库', dataIndex: 'received' },
                { key: 'remaining', title: '未入库数量', dataIndex: 'remaining' },
              ]}
            />
            <Grid
              id="contract-receipts"
              title="来源入库单"
              rows={fulfillment.data.documents}
              columns={[
                { key: 'number', title: '单号', dataIndex: 'number' },
                { key: 'date', title: '日期', dataIndex: 'date' },
                {
                  key: 'reversed',
                  title: '履约状态',
                  render: (_, d) => (d.reversed ? '已反冲，不计履约' : '计入履约'),
                  exportValue: (d) => (d.reversed ? '已反冲，不计履约' : '计入履约'),
                },
                {
                  key: 'view',
                  title: '操作',
                  noExport: true,
                  render: (_, d) => (
                    <Button onClick={() => void navigate(`/m/inventory/receipts?id=${d.id}`)}>
                      查看入库单
                    </Button>
                  ),
                },
              ]}
            />
          </>
        )}
      </Drawer>
      <Drawer
        mask={false}
        title="采购合同头与明细"
        open={active && !!draft}
        size="large"
        onClose={() => {
          if (!save.isPending && mayDiscard(dirty)) {
            setDraft(null);
            setDirty(false);
          }
        }}
        extra={
          can && (
            <Button type="primary" loading={save.isPending} onClick={() => void submit()}>
              保存合同
            </Button>
          )
        }
      >
        {draft && (
          <Form layout="vertical" disabled={!can || save.isPending}>
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
