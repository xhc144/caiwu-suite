import { useState } from 'react';
import { Button, Checkbox, Drawer, Form, Input, Modal, Select, Space, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AccountSelect, FilterBar, PageContainer, useUrlFilters } from '@caiwu/ui';
import { usePermission } from '@caiwu/web-kit';
import type { ProductInput } from '../shared';
import { api } from './api';
import { InventoryNavigation } from './common';
import { Field, Grid, TextField, mayDiscard, useCatalog, useRefresh, useUnsaved } from './common';
import ImportButton from './ImportButton';
const blank: ProductInput = {
  code: '',
  name: '',
  specification: '',
  unit: '件',
  receiptPrice: '0',
  issuePrice: '0',
  planPrice: '0',
  allocationFactor: '1',
  inventoryAccountId: null,
  salesAccountId: null,
  disabled: false,
};
export default function MasterPage() {
  const [f, setF] = useUrlFilters({ keyword: '' });
  const products = useQuery(api.products.queryOptions({ keyword: f.keyword }));
  const { warehouses } = useCatalog();
  const can = usePermission('inventory.edit');
  const refresh = useRefresh();
  const [editing, setEditing] = useState<ProductInput | null>(null),
    [dirty, setDirty] = useState(false),
    [selected, setSelected] = useState<number[]>([]);
  const [w, setW] = useState<{
    id?: number;
    revision?: number;
    code: string;
    name: string;
    kind: 'warehouse' | 'workshop';
    disabled: boolean;
  } | null>(null);
  const [bulkField, setBulkField] = useState<
      'receiptPrice' | 'issuePrice' | 'planPrice' | 'allocationFactor' | 'disabled' | 'unit'
    >('receiptPrice'),
    [bulkValue, setBulkValue] = useState('');
  const save = useMutation(api.saveProduct.mutationOptions()),
    saveW = useMutation(api.saveWarehouse.mutationOptions()),
    remove = useMutation(api.removeProducts.mutationOptions()),
    bulk = useMutation(api.bulk.mutationOptions());
  useUnsaved(dirty);
  const edit = (patch: Partial<ProductInput>) => {
    setEditing((p) => (p ? { ...p, ...patch } : p));
    setDirty(true);
  };
  const collection = (products.data ?? []).filter((p) => selected.includes(p.id));
  const saveProduct = async () => {
    if (!editing) return;
    const v = { ...editing };
    if (/^0+(\.0+)?$/.test(v.allocationFactor ?? '')) {
      if (!window.confirm('费用分摊系数为零，确认使用 1 吗？')) return;
      v.confirmZeroFactor = true;
    }
    await save.mutateAsync(v);
    setDirty(false);
    setEditing(null);
    await refresh();
  };
  return (
    <PageContainer
      title="产品与仓库"
      subtitle="产品编号可修改；既有单据始终引用稳定产品 ID。"
      extra={
        <Space>
          {can && (
            <Button
              type="primary"
              onClick={() => {
                setEditing({ ...blank });
                setDirty(false);
              }}
            >
              新增产品
            </Button>
          )}
          <ImportButton kind="products" />
        </Space>
      }
    >
      <InventoryNavigation />
      <FilterBar initialValues={f} onSearch={setF}>
        <Form.Item name="keyword" label="编码/名称/拼音">
          <Input />
        </Form.Item>
      </FilterBar>
      <Grid
        id="products"
        title="产品档案"
        rows={products.data ?? []}
        columns={[
          {
            key: 'select',
            title: '选择',
            noExport: true,
            render: (_, p) => (
              <Checkbox
                aria-label={`选择产品${p.code}`}
                checked={selected.includes(p.id)}
                onChange={(e) =>
                  setSelected((ids) =>
                    e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id),
                  )
                }
              />
            ),
          },
          { key: 'code', title: '产品编号', dataIndex: 'code', width: 150 },
          { key: 'name', title: '名称', dataIndex: 'name', width: 180 },
          { key: 'specification', title: '规格', dataIndex: 'specification', width: 120 },
          { key: 'unit', title: '单位', dataIndex: 'unit', width: 80 },
          { key: 'receiptPrice', title: '默认入库价', dataIndex: 'receiptPrice' },
          { key: 'issuePrice', title: '默认出库价', dataIndex: 'issuePrice' },
          { key: 'planPrice', title: '计划价', dataIndex: 'planPrice' },
          { key: 'allocationFactor', title: '费用分摊系数', dataIndex: 'allocationFactor' },
          { key: 'inventoryAccountId', title: '存货科目ID', dataIndex: 'inventoryAccountId' },
          { key: 'salesAccountId', title: '销售科目ID', dataIndex: 'salesAccountId' },
          {
            key: 'disabled',
            title: '状态',
            exportValue: (p) => (p.disabled ? '停用' : '启用'),
            render: (_, p) => (p.disabled ? '停用' : '启用'),
          },
          {
            key: 'edit',
            title: '操作',
            noExport: true,
            render: (_, p) =>
              can && (
                <Button
                  onClick={() => {
                    setEditing(p);
                    setDirty(false);
                  }}
                >
                  编辑/修改编号
                </Button>
              ),
          },
        ]}
        toolbar={
          can && (
            <Space>
              <Button
                danger
                disabled={!collection.length}
                onClick={async () => {
                  const names = collection.map((p) => `${p.code} ${p.name}`).join('、');
                  if (!window.confirm(`请核对将删除的产品集合：${names}。是否继续？`)) return;
                  if (
                    !window.confirm(
                      `再次确认删除 ${collection.length} 个产品，使用过的产品将被阻止：${names}`,
                    )
                  )
                    return;
                  await remove.mutateAsync({
                    products: collection.map((p) => ({ id: p.id, revision: p.revision })),
                    confirmSet: true,
                    confirmDelete: true,
                  });
                  setSelected([]);
                  await refresh();
                }}
              >
                删除所选产品（两次确认）
              </Button>
              <Select
                aria-label="批量字段"
                value={bulkField}
                onChange={setBulkField}
                options={[
                  { value: 'receiptPrice', label: '默认入库价' },
                  { value: 'issuePrice', label: '默认出库价' },
                  { value: 'planPrice', label: '计划价' },
                  { value: 'allocationFactor', label: '分摊系数' },
                  { value: 'disabled', label: '停用 true/false' },
                  { value: 'unit', label: '单位' },
                ]}
              />
              <Input
                aria-label="批量数值"
                value={bulkValue}
                onChange={(e) => {
                  setBulkValue(e.target.value);
                  bulk.reset();
                }}
              />
              <Button
                disabled={!collection.length}
                onClick={() =>
                  bulk.mutate({
                    products: collection.map((p) => ({ id: p.id, revision: p.revision })),
                    field: bulkField,
                    value: bulkValue,
                    confirmed: false,
                  })
                }
              >
                批量预览
              </Button>
            </Space>
          )
        }
      />
      <Modal
        title="批量修改预览"
        open={!!bulk.data}
        onCancel={() => bulk.reset()}
        onOk={async () => {
          await bulk.mutateAsync({
            products: collection.map((p) => ({ id: p.id, revision: p.revision })),
            field: bulkField,
            value: bulkValue,
            confirmed: true,
          });
          bulk.reset();
          await refresh();
        }}
        okText="确认修改"
        cancelText="取消"
      >
        <pre>
          {JSON.stringify(
            bulk.data?.map((c) => ({
              产品: c.before.code,
              原值: c.before[bulkField],
              新值: c.after[bulkField],
            })),
            null,
            2,
          )}
        </pre>
      </Modal>
      <Typography.Title level={4}>仓库 / 车间</Typography.Title>
      {can && (
        <Button
          onClick={() => {
            setW({ code: '', name: '', kind: 'warehouse', disabled: false });
            setDirty(false);
          }}
        >
          新增仓库
        </Button>
      )}
      <Grid
        id="warehouses"
        title="仓库档案"
        rows={warehouses}
        columns={[
          { key: 'code', title: '编码', dataIndex: 'code' },
          { key: 'name', title: '名称', dataIndex: 'name' },
          {
            key: 'kind',
            title: '类型',
            exportValue: (r) => (r.kind === 'warehouse' ? '仓库' : '车间'),
            render: (_, r) => (r.kind === 'warehouse' ? '仓库' : '车间'),
          },
          {
            key: 'disabled',
            title: '状态',
            exportValue: (r) => (r.disabled ? '停用' : '启用'),
            render: (_, r) => (r.disabled ? '停用' : '启用'),
          },
          {
            key: 'edit',
            title: '操作',
            noExport: true,
            render: (_, r) =>
              can && (
                <Button
                  onClick={() => {
                    setW({ ...r, disabled: !!r.disabled });
                    setDirty(false);
                  }}
                >
                  编辑仓库
                </Button>
              ),
          },
        ]}
      />
      <Drawer
        title={editing?.id ? '编辑产品 / 修改编号' : '新增产品'}
        open={!!editing}
        onClose={() => {
          if (mayDiscard(dirty)) {
            setEditing(null);
            setDirty(false);
          }
        }}
        size={620}
        extra={
          <Button type="primary" loading={save.isPending} onClick={() => void saveProduct()}>
            保存产品
          </Button>
        }
      >
        {editing && (
          <Form layout="vertical">
            <TextField label="产品编号" value={editing.code} onChange={(code) => edit({ code })} />
            <TextField label="产品名称" value={editing.name} onChange={(name) => edit({ name })} />
            <TextField
              label="规格"
              value={editing.specification}
              onChange={(specification) => edit({ specification })}
            />
            <TextField label="计量单位" value={editing.unit} onChange={(unit) => edit({ unit })} />
            {(['receiptPrice', 'issuePrice', 'planPrice', 'allocationFactor'] as const).map(
              (k, i) => (
                <TextField
                  key={k}
                  label={['默认入库价', '默认出库价', '计划价', '费用分摊系数'][i]!}
                  value={editing[k]}
                  onChange={(v) => edit({ [k]: v })}
                />
              ),
            )}
            <Field label="存货科目">
              <AccountSelect
                aria-label="存货科目"
                value={editing.inventoryAccountId ?? undefined}
                allowClear
                onChange={(v) => edit({ inventoryAccountId: v ?? null })}
              />
            </Field>
            <Field label="销售科目">
              <AccountSelect
                aria-label="销售科目"
                value={editing.salesAccountId ?? undefined}
                allowClear
                onChange={(v) => edit({ salesAccountId: v ?? null })}
              />
            </Field>
            <Checkbox
              checked={editing.disabled}
              onChange={(e) => edit({ disabled: e.target.checked })}
            >
              停用
            </Checkbox>
          </Form>
        )}
      </Drawer>
      <Drawer
        title="仓库维护"
        open={!!w}
        onClose={() => {
          if (mayDiscard(dirty)) {
            setW(null);
            setDirty(false);
          }
        }}
        extra={
          <Button
            type="primary"
            loading={saveW.isPending}
            onClick={async () => {
              if (w) {
                await saveW.mutateAsync(w);
                setW(null);
                setDirty(false);
                await refresh();
              }
            }}
          >
            保存仓库
          </Button>
        }
      >
        {w && (
          <Form layout="vertical">
            <TextField
              label="仓库编码"
              value={w.code}
              onChange={(code) => {
                setW({ ...w, code });
                setDirty(true);
              }}
            />
            <TextField
              label="仓库名称"
              value={w.name}
              onChange={(name) => {
                setW({ ...w, name });
                setDirty(true);
              }}
            />
            <Field label="仓库类型">
              <Select
                aria-label="仓库类型"
                value={w.kind}
                onChange={(kind) => {
                  setW({ ...w, kind });
                  setDirty(true);
                }}
                options={[
                  { value: 'warehouse', label: '仓库' },
                  { value: 'workshop', label: '车间' },
                ]}
              />
            </Field>
            <Checkbox
              checked={w.disabled}
              onChange={(e) => {
                setW({ ...w, disabled: e.target.checked });
                setDirty(true);
              }}
            >
              停用仓库
            </Checkbox>
          </Form>
        )}
      </Drawer>
    </PageContainer>
  );
}
