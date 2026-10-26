import {
  Alert,
  Button,
  Col,
  Drawer,
  Form,
  Input,
  Row,
  Select,
  Space,
  Switch,
  Tabs,
  Typography,
} from 'antd';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  DIMENSION_TYPES,
  dimensionName,
  type DimensionItem,
  type DimensionTypeId,
} from '@caiwu/core';
import {
  DataTable,
  DimensionSelect,
  FilterBar,
  PageContainer,
  useUrlFilters,
  type DataColumn,
} from '@caiwu/ui';
import { notify, queryClient, usePermission } from '@caiwu/web-kit';
import { DimensionTypeSchema, type DimensionInput } from '../shared';
import { api } from './api';
import { ExcelActions, refresh, run, useConfirm, useUnsaved } from './common';

const directionLabels: Record<string, string> = {
  inflow: '流入',
  outflow: '流出',
  internal: '内部转移',
};
export default function DimensionsPage() {
  const [filters, setFilters] = useUrlFilters({ type: 'department', keyword: '' });
  const parsed = DimensionTypeSchema.safeParse(filters.type);
  const type = parsed.success ? parsed.data : 'department';
  const [searchForm] = Form.useForm<{ keyword: string }>();
  const [editing, setEditing] = useState<DimensionItem | 'new' | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const items = useQuery(api.dimensions.list.queryOptions({ type, keyword: filters.keyword }));
  const scheme = useQuery(api.dimensions.scheme.queryOptions({ type }));
  const canEdit = usePermission('masterdata.dimensions.edit');
  const remove = useMutation(api.dimensions.remove.mutationOptions());
  const ask = useConfirm();
  const columns: DataColumn<DimensionItem>[] = [
    { key: 'code', title: '编码', dataIndex: 'code', width: 140 },
    { key: 'name', title: '名称', dataIndex: 'name', width: 240 },
    {
      key: 'parent',
      title: '上级分类',
      width: 150,
      render: (_, a) => items.data?.find((p) => p.id === a.parentId)?.name ?? '—',
    },
    { key: 'pinyin', title: '拼音首字母', dataIndex: 'pinyin', width: 140 },
    {
      key: 'attrs',
      title:
        type === 'partner' ? '简称 / 角色 / 联系人' : type === 'cashflow' ? '分类 / 方向' : '分类',
      width: 260,
      render: (_, a) =>
        type === 'partner'
          ? [
              a.attrs.shortName,
              ({ customer: '客户', supplier: '供应商', both: '双向' } as Record<string, string>)[
                String(a.attrs.role)
              ] ?? '未设置角色',
              a.attrs.contact,
            ]
              .filter(Boolean)
              .join(' / ')
          : type === 'cashflow'
            ? `${String(a.attrs.category ?? '—')} / ${directionLabels[String(a.attrs.cashflowDirection)] ?? '未设置方向'}`
            : String(a.attrs.category ?? ''),
    },
    {
      key: 'status',
      title: '状态',
      width: 100,
      render: (_, a) => (a.disabled ? '停用' : a.isLeaf ? '在用末级' : '分类'),
    },
    {
      key: 'actions',
      title: '操作',
      width: 150,
      render: (_, a) => (
        <Space>
          <Button type="link" onClick={() => setEditing(a)}>
            {canEdit ? '编辑' : '查看'}
          </Button>
          {canEdit && (
            <Button
              danger
              type="link"
              onClick={() =>
                run(
                  (async () => {
                    if (
                      !(await ask(
                        `确认删除 ${a.code} ${a.name}？已有凭证、期初或默认项引用时会拒绝。`,
                      ))
                    )
                      return;
                    await remove.mutateAsync({ id: a.id, confirmed: true });
                    await refresh();
                    notify.success('已删除');
                  })(),
                )
              }
            >
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ];
  return (
    <PageContainer
      title="辅助档案"
      subtitle={`当前${dimensionName(type)}分级规则：${scheme.data?.join('-') ?? ''}；最多5级，总长不超过10位`}
      extra={
        <Space>
          <ExcelActions key={type} kind="dimensions" type={type} />
          {canEdit && (
            <>
              <Button onClick={() => setConfiguring(true)}>分级规则</Button>
              <Button type="primary" onClick={() => setEditing('new')}>
                新增{dimensionName(type)}
              </Button>
            </>
          )}
        </Space>
      }
    >
      <Tabs
        activeKey={type}
        onChange={(next) => setFilters({ type: next, keyword: '' })}
        items={DIMENSION_TYPES.map((d) => ({ key: d.id, label: d.name }))}
      />
      <FilterBar
        key={type}
        form={searchForm}
        initialValues={{ keyword: filters.keyword }}
        onSearch={(v: { keyword: string }) => setFilters({ keyword: v.keyword ?? '' })}
        extra={
          <>
            <Button
              onClick={() => {
                const keyword = searchForm.getFieldValue('keyword') ?? '';
                run(
                  queryClient
                    .fetchQuery(api.dimensions.list.queryOptions({ type, keyword, locate: true }))
                    .then(() => setFilters({ keyword })),
                );
              }}
            >
              定位
            </Button>
            <Button onClick={() => run(refresh())}>刷新列表</Button>
          </>
        }
      >
        <Form.Item name="keyword" label="查找">
          <Input placeholder="编码、名称、拼音首字母" allowClear />
        </Form.Item>
      </FilterBar>
      <DataTable
        tableId={`masterdata.dimensions.${type}`}
        rowKey="id"
        columns={columns}
        dataSource={items.data ?? []}
        loading={items.isLoading}
      />
      {editing && (
        <DimensionDrawer
          key={`${type}:${editing === 'new' ? 'new' : editing.id}`}
          type={type}
          item={editing}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
        />
      )}
      {configuring && (
        <SchemeDrawer
          type={type}
          scheme={scheme.data ?? []}
          onClose={() => setConfiguring(false)}
        />
      )}
    </PageContainer>
  );
}

function DimensionDrawer({
  type,
  item,
  canEdit,
  onClose,
}: {
  type: DimensionTypeId;
  item: DimensionItem | 'new';
  canEdit: boolean;
  onClose: () => void;
}) {
  const [form] = Form.useForm<DimensionInput>();
  const [dirty, setDirty] = useState(false);
  const isNew = item === 'new';
  const save = useMutation(api.dimensions.save.mutationOptions());
  const submit = async () => {
    const data = await form.validateFields();
    await save.mutateAsync({ ...data, id: isNew ? undefined : item.id, type });
    setDirty(false);
    await refresh();
    notify.success('档案已保存');
    onClose();
  };
  const unsaved = useUnsaved(dirty, submit, () => {
    form.resetFields();
    setDirty(false);
  });
  const defaults: DimensionInput = isNew
    ? {
        type,
        code: '',
        name: '',
        attrs: type === 'partner' ? { role: 'both' } : {},
        disabled: false,
      }
    : { ...item, type, attrs: item.attrs };
  const fields = [
    ['shortName', '简称'],
    ['contact', '联系人'],
    ['phone', '电话'],
    ['address', '地址'],
    ['postalCode', '邮编'],
    ['bank', '开户银行'],
    ['bankAccount', '银行账号'],
    ['taxNumber', '税号'],
  ] as const;
  return (
    <>
      <Drawer
        open
        title={`${isNew ? '新增' : '编辑'}${dimensionName(type)}`}
        size={620}
        onClose={() => unsaved.guard(onClose)}
        destroyOnHidden
        footer={
          <Space>
            <Button
              onClick={() =>
                unsaved.guard(() => {
                  form.resetFields();
                  setDirty(false);
                })
              }
            >
              刷新表单
            </Button>
            <Button onClick={() => unsaved.guard(onClose)}>取消</Button>
            {canEdit && (
              <Button type="primary" loading={save.isPending} onClick={() => run(submit())}>
                保存
              </Button>
            )}
          </Space>
        }
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={defaults}
          onValuesChange={() => setDirty(true)}
          disabled={!canEdit}
        >
          <Row gutter={16}>
            <Col span={10}>
              <Form.Item
                name="code"
                label="档案编码"
                rules={[{ required: true, message: '请输入编码' }]}
              >
                <Input maxLength={10} />
              </Form.Item>
            </Col>
            <Col span={14}>
              <Form.Item
                name="name"
                label="档案名称"
                rules={[{ required: true, message: '请输入名称' }]}
              >
                <Input maxLength={100} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="parentId" label="上级分类">
            <DimensionSelect type={type} leafOnly={false} />
          </Form.Item>
          <Form.Item name={['attrs', 'category']} label="分类名称">
            <Input />
          </Form.Item>
          <Form.Item name="disabled" label="停用" valuePropName="checked">
            <Switch />
          </Form.Item>
          {type === 'partner' && (
            <>
              <Form.Item
                name={['attrs', 'role']}
                label="客户/供应商角色"
                rules={isNew ? [{ required: true, message: '请选择角色' }] : []}
              >
                <Select
                  allowClear
                  placeholder="未设置角色"
                  options={[
                    { value: 'customer', label: '客户' },
                    { value: 'supplier', label: '供应商' },
                    { value: 'both', label: '双向' },
                  ]}
                />
              </Form.Item>
              <Row gutter={16}>
                {fields.map(([key, label]) => (
                  <Col span={12} key={key}>
                    <Form.Item name={['attrs', key]} label={label}>
                      <Input />
                    </Form.Item>
                  </Col>
                ))}
              </Row>
            </>
          )}
          {type === 'cashflow' && (
            <>
              <Form.Item
                name={['attrs', 'cashflowDirection']}
                label="现金流量方向"
                rules={isNew ? [{ required: true, message: '请选择方向' }] : []}
              >
                <Select
                  allowClear
                  placeholder="未设置方向"
                  options={Object.entries(directionLabels).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
              </Form.Item>
              {!isNew && !item.attrs.cashflowDirection && (
                <Alert
                  type="warning"
                  title="历史项目未设置方向；不会按名称猜测。已有引用时不能改变方向。"
                />
              )}
            </>
          )}
          <Typography.Paragraph type="secondary">
            修改编号保留 ID
            引用。停用后不能用于新业务，历史资料仍保留；已有引用时不能删除或改变分类语义。
          </Typography.Paragraph>
        </Form>
      </Drawer>
      {unsaved.dialog}
    </>
  );
}

function SchemeDrawer({
  type,
  scheme,
  onClose,
}: {
  type: DimensionTypeId;
  scheme: number[];
  onClose: () => void;
}) {
  const [form] = Form.useForm<{ scheme: string }>();
  const save = useMutation(api.dimensions.setScheme.mutationOptions());
  return (
    <Drawer
      open
      title="分级规则"
      size={480}
      onClose={onClose}
      footer={
        <Button
          type="primary"
          onClick={() =>
            run(
              (async () => {
                const v = await form.validateFields();
                await save.mutateAsync({ type, scheme: v.scheme.split('-').map(Number) });
                await refresh();
                onClose();
              })(),
            )
          }
        >
          保存规则
        </Button>
      }
    >
      <Typography.Paragraph>
        每级长度用连字符分隔，最多5级，总长不超过10位。保存前将逐项验证现存编码和分类关系。
      </Typography.Paragraph>
      <Form form={form} layout="vertical" initialValues={{ scheme: scheme.join('-') }}>
        <Form.Item name="scheme" label="每级长度" rules={[{ required: true }]}>
          <Input placeholder="2-2-2-2-2" />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
