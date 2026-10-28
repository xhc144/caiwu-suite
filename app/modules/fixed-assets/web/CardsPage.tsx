import { useAssetFilters as useUrlFilters } from './common';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Typography,
} from 'antd';
import {
  DataTable,
  DimensionSelect,
  FilterBar,
  MoneyInput,
  PageContainer,
  type DataColumn,
} from '@caiwu/ui';
import {
  notify,
  useCurrentPeriod,
  useDimensionItems,
  useHotkey,
  usePermission,
  useRequiredSession,
} from '@caiwu/web-kit';
import { formatMoney, multiplyToCents, periodStartDate, qtyFromE6 } from '@caiwu/core';
import type { CardInput } from '../shared';
import { api, type Outputs } from './api';
import { Confirm, MasterSelect, refresh } from './common';
import CardOperations from './CardOperations';
import { useAssetDraft } from './useAssetDraft';
type Card = Outputs['list'][number];
export default function CardsPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useUrlFilters({
    keyword: '',
    code: '',
    name: '',
    id: 0,
    categoryId: 0,
    statusId: 0,
    departmentId: 0,
    includeDisposed: false,
  });
  const list = useQuery(
    api.list.queryOptions({
      keyword: filters.keyword || undefined,
      code: filters.code || undefined,
      name: filters.name || undefined,
      id: filters.id || undefined,
      categoryId: filters.categoryId || undefined,
      statusId: filters.statusId || undefined,
      departmentId: filters.departmentId || undefined,
      includeDisposed: filters.includeDisposed,
    }),
  );
  const can = usePermission('fixed-assets.edit');
  const [edit, setEdit] = useState<{ id?: number; copy?: boolean; readOnly?: boolean } | null>(
    null,
  );
  const [operation, setOperation] = useState<{ id: number; kind: 'adjust' | 'dispose' } | null>(
    null,
  );
  const masters = useQuery(api.masters.queryOptions());
  const { items: departments } = useDimensionItems('department');
  const remove = useMutation(api.remove.mutationOptions({ onSuccess: () => void refresh() }));
  const missing = ['category', 'status', 'purpose'].filter(
    (k) => !(masters.data ?? []).some((m) => m.kind === k && !m.disabled),
  );
  useHotkey('Alt+N', () => can && setEdit({}));
  const columns: DataColumn<Card>[] = [
    { key: 'code', title: '设备编号', dataIndex: 'code', width: 140 },
    { key: 'name', title: '设备名称', dataIndex: 'name', width: 180 },
    { key: 'category', title: '类别', dataIndex: 'category', width: 160 },
    { key: 'department', title: '部门', dataIndex: 'department', width: 120 },
    {
      key: 'status',
      title: '状态',
      width: 120,
      render: (_, c) => (c.disposal_date ? '已注销' : c.status),
    },
    { key: 'use', title: '使用日期', dataIndex: 'use_date', width: 120 },
    { key: 'original', title: '原值', dataIndex: 'original', money: true },
    { key: 'dep', title: '累计折旧', dataIndex: 'depreciation', money: true },
    { key: 'net', title: '净值', dataIndex: 'net', money: true },
    { key: 'months', title: '累计月数', dataIndex: 'months', width: 100 },
    {
      key: 'actions',
      title: '操作',
      noExport: true,
      width: 430,
      render: (_, c) => (
        <Space wrap>
          <Button size="small" onClick={() => setEdit({ id: c.id, readOnly: true })}>
            查看
          </Button>
          {can && (
            <>
              <Button size="small" onClick={() => setEdit({ id: c.id })}>
                修改
              </Button>
              <Button size="small" onClick={() => setEdit({ id: c.id, copy: true })}>
                复制新增
              </Button>
              <Button size="small" onClick={() => setOperation({ id: c.id, kind: 'adjust' })}>
                原值调整
              </Button>
              <Button size="small" onClick={() => setOperation({ id: c.id, kind: 'dispose' })}>
                注销/撤销
              </Button>
              <Confirm
                title="确认物理删除未折旧资产及其附属设备？"
                danger
                onConfirm={() => remove.mutate({ id: c.id, confirm: true })}
              >
                删除
              </Confirm>
            </>
          )}
          {c.voucher_id && (
            <Button
              size="small"
              onClick={() => void navigate(`/m/voucher-entry/edit?id=${c.voucher_id}`)}
            >
              查看清理凭证
            </Button>
          )}
        </Space>
      ),
    },
  ];
  return (
    <PageContainer
      title="固定资产台账"
      extra={
        can && (
          <Button type="primary" onClick={() => setEdit({})}>
            新增资产
          </Button>
        )
      }
    >
      {(missing.length > 0 || !departments.some((d) => !d.disabled && d.isLeaf)) && (
        <Alert
          type="warning"
          title="新增卡片前请准备类别、状态、用途与部门"
          action={<Button onClick={() => void navigate('/m/fixed-assets/masters')}>去新增</Button>}
          style={{ marginBottom: 16 }}
        />
      )}
      <FilterBar initialValues={filters} onSearch={setFilters}>
        <Form.Item name="keyword" label="编码/名称">
          <Input />
        </Form.Item>
        <Form.Item name="categoryId" label="类别">
          <MasterSelect kind="category" />
        </Form.Item>
        <Form.Item name="statusId" label="状态">
          <MasterSelect kind="status" />
        </Form.Item>
        <Form.Item name="departmentId" label="部门">
          <DimensionSelect type="department" />
        </Form.Item>
        <Form.Item name="includeDisposed" valuePropName="checked">
          <Checkbox>含已注销</Checkbox>
        </Form.Item>
      </FilterBar>
      <DataTable
        tableId="fixed-assets-cards"
        rowKey="id"
        columns={columns}
        dataSource={list.data ?? []}
        loading={list.isLoading}
        exportName={list.data?.length ? '固定资产台账' : undefined}
        locale={{ emptyText: '尚无资产卡片，请新增或导入期初卡片' }}
      />
      {edit && (
        <CardEditor
          key={`${edit.id}-${edit.copy}-${edit.readOnly}`}
          {...edit}
          onClose={() => setEdit(null)}
        />
      )}
      {operation && (
        <CardOperations
          key={`${operation.id}-${operation.kind}`}
          id={operation.id}
          kind={operation.kind}
          onClose={() => setOperation(null)}
        />
      )}
    </PageContainer>
  );
}
function CardEditor({
  id,
  copy,
  readOnly,
  onClose,
}: {
  id?: number;
  copy?: boolean;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const session = useRequiredSession();
  const current = useCurrentPeriod();
  const initialDate = current?.startDate ?? periodStartDate(session.book.startPeriod);
  const detail = useQuery({ ...api.detail.queryOptions({ id: id ?? 1 }), enabled: !!id });
  const masters = useQuery(api.masters.queryOptions());
  const [form] = Form.useForm<CardInput>();
  const create = useMutation(api.save.mutationOptions());
  const hydrated = useRef(false);
  const persisted = useRef<{ id?: number; revision?: number }>({
    id: copy ? undefined : id,
  });
  const draft = useAssetDraft({
    title: copy ? '复制新增资产' : id ? '修改资产卡片' : '新增资产卡片',
    discard: onClose,
    save: async () => {
      if (readOnly || (id && !hydrated.current)) return false;
      const data = structuredClone(await form.validateFields());
      const savedId = await create.mutateAsync({ ...persisted.current, data });
      persisted.current = {
        id: savedId,
        revision: (persisted.current.revision ?? 0) + 1,
      };
      notify.success('资产卡片已保存');
      void refresh();
    },
  });
  const d = detail.data;
  useEffect(() => {
    if (!d || hydrated.current) return;
    hydrated.current = true;
    if (!copy) persisted.current = { id: d.card.id, revision: d.card.revision };
    const c = d.card;
    form.setFieldsValue({
      code: copy ? '' : c.code,
      name: c.name,
      reference: c.reference,
      categoryId: c.category_id,
      statusId: c.status_id,
      purposeId: c.purpose_id,
      departmentId: c.department_id,
      acquired: c.acquired,
      useDate: c.use_date,
      original: c.original,
      rate: c.rate,
      residual: c.residual,
      method: c.method as '1' | '2',
      lifeMonths: c.life_months,
      model: c.model,
      unit: c.unit,
      quantity: qtyFromE6(c.quantity_e6),
      totalWork: qtyFromE6(c.total_work_e6),
      openingDepreciation: 0,
      openingMonths: 0,
      openingWork: '0',
      accessories: d.accessories.map((a) => ({
        code: a.code,
        name: a.name,
        quantity: a.quantity,
        unitPrice: a.unit_price,
        note: a.note,
      })),
      confirmShortLife: false,
      confirmCodeChange: false,
    });
  }, [d, form, copy]);
  const method = Form.useWatch('method', form);
  const submit = async () => {
    try {
      if (await draft.save()) onClose();
    } catch {
      // Validation and server failures retain the current form for correction or retry.
    }
  };
  useHotkey('Ctrl+S', () => !readOnly && void submit());
  return (
    <Drawer
      title={
        readOnly ? '查看资产卡片' : copy ? '复制新增资产' : id ? '修改资产卡片' : '新增资产卡片'
      }
      open
      onClose={() => draft.close(onClose)}
      size={850}
      footer={
        <Space>
          <Button onClick={() => draft.close(onClose)}>取消</Button>
          {!readOnly && (
            <Button
              type="primary"
              loading={draft.saving}
              disabled={!!id && !d}
              onClick={() => void submit()}
            >
              保存卡片
            </Button>
          )}
        </Space>
      }
    >
      {d && (
        <Alert
          title={`当前累计折旧 ${formatMoney(d.card.depreciation)} 元；累计 ${d.card.months} 月；累计工作量 ${qtyFromE6(d.card.work_e6)}；净值 ${formatMoney(d.card.original - d.card.depreciation)} 元`}
          style={{ marginBottom: 12 }}
        />
      )}
      <Form
        name="fixed-assets-card"
        form={form}
        layout="vertical"
        disabled={readOnly || (!!id && !d)}
        onValuesChange={draft.changed}
        initialValues={{
          code: '',
          name: '',
          reference: '',
          acquired: initialDate,
          useDate: initialDate,
          original: null,
          rate: '0.05',
          method: '1',
          lifeMonths: 60,
          unit: '台',
          quantity: '1',
          totalWork: '0',
          openingWork: '0',
          openingDepreciation: 0,
          openingMonths: 0,
          accessories: [],
          confirmShortLife: false,
          confirmCodeChange: false,
        }}
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}
      >
        {(
          [
            ['code', '设备编号'],
            ['name', '设备名称'],
            ['reference', '参考编号'],
          ] as const
        ).map(([name, label]) => (
          <Form.Item
            key={name}
            name={name}
            label={label}
            rules={[{ required: name !== 'reference' }]}
          >
            <Input />
          </Form.Item>
        ))}
        <Form.Item name="categoryId" label="类别" rules={[{ required: true }]}>
          <Select
            onChange={(v) => {
              const m = masters.data?.find((m) => m.id === v);
              if (m) form.setFieldValue('rate', m.rate);
            }}
            options={(masters.data ?? [])
              .filter((m) => m.kind === 'category' && !m.disabled)
              .map((m) => ({ value: m.id, label: `${m.code} ${m.name}` }))}
          />
        </Form.Item>
        <Form.Item name="statusId" label="状态" rules={[{ required: true }]}>
          <MasterSelect kind="status" />
        </Form.Item>
        <Form.Item name="purposeId" label="用途" rules={[{ required: true }]}>
          <MasterSelect kind="purpose" />
        </Form.Item>
        <Form.Item name="departmentId" label="部门" rules={[{ required: true }]}>
          <DimensionSelect type="department" />
        </Form.Item>
        <Form.Item name="acquired" label="购置日期" rules={[{ required: true }]}>
          <Input type="date" />
        </Form.Item>
        <Form.Item name="useDate" label="使用日期" rules={[{ required: true }]}>
          <Input type="date" />
        </Form.Item>
        <Form.Item name="original" label="原值（元）" rules={[{ required: true }]}>
          <MoneyInput allowNegative={false} disabled={!!persisted.current.id} />
        </Form.Item>
        <Form.Item name="rate" label="残值率（0 至 1）" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="residual" label="预计残值（元，留空按率计算）">
          <MoneyInput allowNegative={false} />
        </Form.Item>
        <Form.Item name="method" label="折旧方法" rules={[{ required: true }]}>
          <Select
            options={[
              { value: '1', label: '平均年限法' },
              { value: '2', label: '工作量法' },
            ]}
          />
        </Form.Item>
        <Form.Item name="lifeMonths" label="使用年限（月）" rules={[{ required: method === '1' }]}>
          <InputNumber min={0} max={12000} />
        </Form.Item>
        <Form.Item name="confirmShortLife" valuePropName="checked">
          <Checkbox>已复核少于 30 月的使用年限</Checkbox>
        </Form.Item>
        <Form.Item name="totalWork" label="总工作量">
          <Input />
        </Form.Item>
        <Form.Item name="model" label="规格型号">
          <Input />
        </Form.Item>
        <Form.Item name="unit" label="单位">
          <Input />
        </Form.Item>
        <Form.Item name="quantity" label="数量">
          <Input />
        </Form.Item>
        {persisted.current.id && (
          <Form.Item
            name="confirmCodeChange"
            valuePropName="checked"
            style={{ gridColumn: '1 / -1' }}
          >
            <Checkbox>确认修改设备编号，所有相关记录保持关联</Checkbox>
          </Form.Item>
        )}
        <div style={{ gridColumn: '1 / -1' }}>
          <Typography.Title level={5}>附属设备</Typography.Title>
          <Form.List name="accessories">
            {(fields, { add, remove }) => (
              <>
                {fields.map((f) => (
                  <Space key={f.key} align="start" wrap>
                    <Form.Item
                      name={[f.name, 'code']}
                      label="附属编号"
                      rules={[{ required: true }]}
                    >
                      <Input style={{ width: 110 }} />
                    </Form.Item>
                    <Form.Item
                      name={[f.name, 'name']}
                      label="附属名称"
                      rules={[{ required: true }]}
                    >
                      <Input style={{ width: 130 }} />
                    </Form.Item>
                    <Form.Item
                      name={[f.name, 'quantity']}
                      label="附属数量"
                      rules={[{ required: true }]}
                    >
                      <Input style={{ width: 90 }} />
                    </Form.Item>
                    <Form.Item
                      name={[f.name, 'unitPrice']}
                      label="单价（元）"
                      rules={[{ required: true }]}
                    >
                      <Input style={{ width: 100 }} />
                    </Form.Item>
                    <Form.Item name={[f.name, 'note']} label="说明">
                      <Input style={{ width: 150 }} />
                    </Form.Item>
                    <Form.Item noStyle shouldUpdate>
                      {({ getFieldValue }) => {
                        const a = getFieldValue(['accessories', f.name]) as
                          { quantity?: string; unitPrice?: string } | undefined;
                        let amount = '待填写';
                        try {
                          if (a?.quantity && a.unitPrice)
                            amount = formatMoney(multiplyToCents(a.quantity, a.unitPrice)) + ' 元';
                        } catch {
                          amount = '金额超出范围';
                        }
                        return <span>金额：{amount}</span>;
                      }}
                    </Form.Item>
                    <Button danger onClick={() => remove(f.name)}>
                      删除附属
                    </Button>
                  </Space>
                ))}
                {!readOnly && (
                  <Button
                    onClick={() =>
                      add({ code: '', name: '', quantity: '1', unitPrice: '0', note: '' })
                    }
                  >
                    增加附属设备
                  </Button>
                )}
              </>
            )}
          </Form.List>
          <p style={{ color: '#666' }}>
            金额保存时按十进制数量与单价精确计算，取消编辑不会写入附属设备。
          </p>
        </div>
      </Form>
    </Drawer>
  );
}
