import { useRef, useState } from 'react';
import { Button, Checkbox, Drawer, Form, Input, Modal, Select, Space, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AccountSelect, FilterBar, PageContainer, useUrlFilters } from '@caiwu/ui';
import { useAccounts, useHotkey, usePermission, useTab } from '@caiwu/web-kit';
import type { BulkField, ProductInput } from '../shared';
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
  const { active } = useTab();
  const { byId: accounts } = useAccounts();
  const [f, setF] = useUrlFilters({ keyword: '' });
  const products = useQuery(api.products.queryOptions({ keyword: f.keyword }));
  const { warehouses } = useCatalog();
  const can = usePermission('inventory.edit');
  const refresh = useRefresh();
  const client = useQueryClient();
  const [editing, setEditing] = useState<ProductInput | null>(null),
    [dirty, setDirty] = useState(false),
    [warehouseDirty, setWarehouseDirty] = useState(false),
    [selected, setSelected] = useState<number[]>([]);
  const [w, setW] = useState<{
    id?: number;
    revision?: number;
    code: string;
    name: string;
    kind: 'warehouse' | 'workshop';
    disabled: boolean;
  } | null>(null);
  const [bulkField, setBulkField] = useState<BulkField>('receiptPrice'),
    [bulkValue, setBulkValue] = useState('');
  const bulkValueAt = (p: ProductInput) => {
    if (bulkField === 'inventoryAccountCode')
      return accounts.get(p.inventoryAccountId ?? 0)?.code ?? '';
    if (bulkField === 'salesAccountCode') return accounts.get(p.salesAccountId ?? 0)?.code ?? '';
    const value = p[bulkField];
    return typeof value === 'boolean' ? (value ? '停用' : '启用') : (value ?? '');
  };
  const save = useMutation(api.saveProduct.mutationOptions()),
    saveW = useMutation(api.saveWarehouse.mutationOptions()),
    remove = useMutation(api.removeProducts.mutationOptions()),
    removeW = useMutation(api.removeWarehouse.mutationOptions()),
    bulk = useMutation(api.bulk.mutationOptions());
  const latestProduct = useRef(editing);
  latestProduct.current = editing;
  const latestWarehouse = useRef(w);
  latestWarehouse.current = w;
  const edit = (patch: Partial<ProductInput>) => {
    setEditing((p) => (p ? { ...p, ...patch } : p));
    setDirty(true);
  };
  const collection = (products.data ?? []).filter((p) => selected.includes(p.id));
  const saveProduct = async () => {
    if (!editing || save.isPending) return false;
    const v = { ...editing };
    if (/^0+(\.0+)?$/.test(v.allocationFactor ?? '')) {
      if (!window.confirm('费用分摊系数为零，确认使用 1 吗？')) return false;
      v.confirmZeroFactor = true;
    }
    const saved = await save.mutateAsync(v);
    if (latestProduct.current === editing) {
      setDirty(false);
      setEditing(null);
    } else {
      setEditing((current) =>
        current ? { ...current, id: saved.id, revision: saved.revision } : current,
      );
    }
    await refresh();
    return true;
  };
  const saveWarehouse = async () => {
    if (!w || saveW.isPending) return false;
    const id = await saveW.mutateAsync(w);
    if (latestWarehouse.current === w) {
      setW(null);
      setWarehouseDirty(false);
    } else {
      setW((current) => (current ? { ...current, id, revision: (w.revision ?? 0) + 1 } : current));
    }
    await refresh();
    return true;
  };
  useUnsaved(dirty, {
    pending: save.isPending,
    title: `产品档案${editing?.code ? `：${editing.code}` : ''}`,
    version: JSON.stringify(editing),
    save: saveProduct,
    discard: () => {
      setEditing(null);
      setDirty(false);
    },
  });
  useUnsaved(warehouseDirty, {
    pending: saveW.isPending,
    title: `仓库档案${w?.code ? `：${w.code}` : ''}`,
    version: JSON.stringify(w),
    save: saveWarehouse,
    discard: () => {
      setW(null);
      setWarehouseDirty(false);
    },
  });
  useHotkey('Ctrl+S', () => {
    if (!can) return;
    if (w) void saveWarehouse();
    else if (editing) void saveProduct();
  });
  const productRows = products.data ?? [];
  const index = productRows.findIndex((p) => p.id === editing?.id);
  const moveProduct = (at: number) => {
    const p = productRows[at];
    if (!p || save.isPending || w || !mayDiscard(dirty)) return;
    setEditing(p);
    setDirty(false);
  };
  useHotkey('Ctrl+Home', () => moveProduct(0), { enabled: !w, allowInInput: false });
  useHotkey('Ctrl+End', () => moveProduct(productRows.length - 1), {
    enabled: !w,
    allowInInput: false,
  });
  useHotkey('ArrowUp', () => moveProduct(index - 1), {
    enabled: index > 0 && !w,
    allowInInput: false,
  });
  useHotkey('ArrowDown', () => moveProduct(index + 1), {
    enabled: index >= 0 && index < productRows.length - 1 && !w,
    allowInInput: false,
  });
  return (
    <PageContainer
      title="产品与仓库"
      subtitle="修改产品编号后，既有单据仍保留与该产品的关联。"
      extra={
        <Space>
          {can && (
            <Button
              type="primary"
              onClick={() => {
                if (save.isPending || !mayDiscard(dirty)) return;
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
          {
            key: 'inventoryAccountId',
            title: '存货科目编码',
            exportValue: (p) => accounts.get(p.inventoryAccountId ?? 0)?.code ?? '',
            render: (_, p) => {
              const a = accounts.get(p.inventoryAccountId ?? 0);
              return a ? `${a.code} ${a.fullName}` : '未设置';
            },
          },
          {
            key: 'salesAccountId',
            title: '销售科目编码',
            exportValue: (p) => accounts.get(p.salesAccountId ?? 0)?.code ?? '',
            render: (_, p) => {
              const a = accounts.get(p.salesAccountId ?? 0);
              return a ? `${a.code} ${a.fullName}` : '未设置';
            },
          },
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
                    if (save.isPending || !mayDiscard(dirty)) return;
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
                onChange={(field) => {
                  setBulkField(field);
                  setBulkValue('');
                  bulk.reset();
                }}
                options={[
                  { value: 'receiptPrice', label: '默认入库价' },
                  { value: 'issuePrice', label: '默认出库价' },
                  { value: 'planPrice', label: '计划价' },
                  { value: 'allocationFactor', label: '分摊系数' },
                  { value: 'disabled', label: '停用状态' },
                  { value: 'unit', label: '单位' },
                  { value: 'name', label: '产品名称' },
                  { value: 'specification', label: '规格' },
                  { value: 'inventoryAccountCode', label: '存货科目编码' },
                  { value: 'salesAccountCode', label: '销售科目编码' },
                ]}
              />
              {bulkField === 'disabled' ? (
                <Select
                  aria-label="批量停用状态"
                  value={bulkValue || undefined}
                  options={[
                    { value: 'false', label: '启用' },
                    { value: 'true', label: '停用' },
                  ]}
                  onChange={(value) => {
                    setBulkValue(value);
                    bulk.reset();
                  }}
                />
              ) : (
                <Input
                  aria-label="批量数值"
                  value={bulkValue}
                  onChange={(e) => {
                    setBulkValue(e.target.value);
                    bulk.reset();
                  }}
                />
              )}
              <Button
                disabled={!collection.length}
                onClick={() => {
                  const zero = bulkField === 'allocationFactor' && /^0+(\.0+)?$/.test(bulkValue);
                  if (zero && !window.confirm('费用分摊系数为零，确认对所选产品改用 1 吗？'))
                    return;
                  bulk.mutate({
                    products: collection.map((p) => ({ id: p.id, revision: p.revision })),
                    field: bulkField,
                    value: bulkValue,
                    confirmed: false,
                    confirmZeroFactor: zero,
                  });
                }}
              >
                批量预览
              </Button>
            </Space>
          )
        }
      />
      <Modal
        title="批量修改预览"
        open={active && !!bulk.data}
        onCancel={() => bulk.reset()}
        confirmLoading={bulk.isPending}
        onOk={async () => {
          const previewed = bulk.variables;
          if (!previewed || !bulk.data) return;
          await bulk.mutateAsync({
            ...previewed,
            confirmed: true,
          });
          bulk.reset();
          await refresh();
        }}
        okText="确认修改"
        cancelText="取消"
      >
        <Grid
          id="bulk-products-preview"
          title="批量修改预览"
          rows={(bulk.data ?? []).map((c) => ({
            productCode: c.before.code,
            before: bulkValueAt(c.before),
            after: bulkValueAt(c.after),
          }))}
          columns={[
            { key: 'productCode', title: '产品编号', dataIndex: 'productCode' },
            { key: 'before', title: '原值', dataIndex: 'before' },
            { key: 'after', title: '新值', dataIndex: 'after' },
          ]}
        />
      </Modal>
      <Typography.Title level={4}>仓库 / 车间</Typography.Title>
      {can && (
        <Button
          onClick={() => {
            if (saveW.isPending || !mayDiscard(warehouseDirty)) return;
            setW({ code: '', name: '', kind: 'warehouse', disabled: false });
            setWarehouseDirty(false);
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
                <Space>
                  <Button
                    onClick={() => {
                      if (saveW.isPending || !mayDiscard(warehouseDirty)) return;
                      setW({ ...r, disabled: !!r.disabled });
                      setWarehouseDirty(false);
                    }}
                  >
                    编辑仓库
                  </Button>
                  <Button
                    danger
                    loading={removeW.isPending}
                    onClick={async () => {
                      if (w?.id === r.id && !mayDiscard(warehouseDirty)) return;
                      if (
                        !window.confirm(
                          `确认删除未使用的仓库 ${r.code} ${r.name}？已有业务的仓库请改为停用。`,
                        )
                      )
                        return;
                      await removeW.mutateAsync({
                        id: r.id,
                        revision: r.revision,
                        confirmed: true,
                      });
                      if (w?.id === r.id) {
                        setW(null);
                        setWarehouseDirty(false);
                      }
                      await refresh();
                    }}
                  >
                    删除仓库
                  </Button>
                </Space>
              ),
          },
        ]}
      />
      <Drawer
        mask={false}
        title={editing?.id ? '编辑产品 / 修改编号' : '新增产品'}
        open={active && !!editing}
        onClose={() => {
          if (!save.isPending && mayDiscard(dirty)) {
            setEditing(null);
            setDirty(false);
          }
        }}
        size={620}
        extra={
          <Space>
            <Button
              disabled={!editing?.id || save.isPending}
              onClick={async () => {
                if (!window.confirm('恢复本行将放弃未保存的修改，重新读取当前产品，确认吗？'))
                  return;
                const current = (await client.fetchQuery(api.products.queryOptions({}))).find(
                  (p) => p.id === editing?.id,
                );
                if (!current) {
                  window.alert('产品已不存在，请刷新产品列表');
                  return;
                }
                setEditing(current);
                setDirty(false);
              }}
            >
              恢复本行
            </Button>
            <Button type="primary" loading={save.isPending} onClick={() => void saveProduct()}>
              保存产品
            </Button>
          </Space>
        }
      >
        {editing && (
          <Form layout="vertical" disabled={save.isPending}>
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
        mask={false}
        title="仓库维护"
        open={active && !!w}
        onClose={() => {
          if (!saveW.isPending && mayDiscard(warehouseDirty)) {
            setW(null);
            setWarehouseDirty(false);
          }
        }}
        extra={
          <Button type="primary" loading={saveW.isPending} onClick={() => void saveWarehouse()}>
            保存仓库
          </Button>
        }
      >
        {w && (
          <Form layout="vertical" disabled={saveW.isPending}>
            <TextField
              label="仓库编码"
              value={w.code}
              onChange={(code) => {
                setW({ ...w, code });
                setWarehouseDirty(true);
              }}
            />
            <TextField
              label="仓库名称"
              value={w.name}
              onChange={(name) => {
                setW({ ...w, name });
                setWarehouseDirty(true);
              }}
            />
            <Field label="仓库类型">
              <Select
                aria-label="仓库类型"
                value={w.kind}
                onChange={(kind) => {
                  setW({ ...w, kind });
                  setWarehouseDirty(true);
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
                setWarehouseDirty(true);
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
