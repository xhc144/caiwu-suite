import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Drawer, Form, Input, Select, Space, Switch, Tabs } from 'antd';
import { AccountSelect, DataTable, PageContainer, type DataColumn } from '@caiwu/ui';
import { useAccounts, useDimensionItems, usePermission } from '@caiwu/web-kit';
import type { z } from 'zod';
import { masterLabels, type MasterSchema } from '../shared';
import { api, type Outputs } from './api';
import { Confirm, refresh } from './common';
type Master = Outputs['masters'][number];
export default function MastersPage() {
  const masters = useQuery(api.masters.queryOptions()),
    { items } = useDimensionItems('department'),
    { byId } = useAccounts();
  const canEdit = usePermission('fixed-assets.edit');
  const [kind, setKind] = useState<keyof typeof masterLabels | 'department'>('category');
  const [editing, setEditing] = useState<Master | 'new' | null>(null);
  const [form] = Form.useForm<z.input<typeof MasterSchema> & { id?: number }>();
  const save = useMutation(
    api.saveMaster.mutationOptions({
      onSuccess: () => {
        void refresh();
        setEditing(null);
      },
    }),
  );
  const remove = useMutation(api.removeMaster.mutationOptions({ onSuccess: () => void refresh() }));
  const department = useMutation(
    api.createDepartment.mutationOptions({
      onSuccess: () => {
        void refresh();
        void queryDepartments();
        setEditing(null);
      },
    }),
  );
  const queryDepartments = () =>
    import('@caiwu/web-kit').then(({ queryClient, coreApi }) =>
      queryClient.invalidateQueries({ queryKey: coreApi.dimensions.items.queryKey() }),
    );
  const columns: DataColumn<Master>[] = [
    { key: 'code', title: '编码', dataIndex: 'code', width: 100 },
    { key: 'name', title: '名称', dataIndex: 'name', width: 180 },
    {
      key: 'account',
      title: '对应科目',
      width: 200,
      render: (_, m) => (m.account_id ? byId.get(m.account_id)?.fullName : '未设置'),
    },
    { key: 'rate', title: '默认残值率', dataIndex: 'rate', width: 120 },
    {
      key: 'depreciates',
      title: '是否计提折旧',
      width: 120,
      render: (_, m) => (m.depreciates ? '是' : '否'),
    },
    { key: 'disabled', title: '停用', width: 80, render: (_, m) => (m.disabled ? '是' : '否') },
    {
      key: 'actions',
      title: '操作',
      noExport: true,
      width: 200,
      render: (_, m) =>
        canEdit ? (
          <Space>
            <Button
              size="small"
              onClick={() => {
                form.setFieldsValue({
                  kind: m.kind as keyof typeof masterLabels,
                  code: m.code,
                  name: m.name,
                  accountId: m.account_id,
                  rate: m.rate,
                  depreciates: !!m.depreciates,
                  disabled: !!m.disabled,
                });
                setEditing(m);
              }}
            >
              修改/停用
            </Button>
            <Confirm
              title="确认删除未被使用的档案？"
              danger
              onConfirm={() => remove.mutate({ id: m.id, confirm: true })}
            >
              删除
            </Confirm>
          </Space>
        ) : null,
    },
  ];
  return (
    <PageContainer
      title="资产基础档案"
      extra={
        canEdit && (
          <Button
            type="primary"
            onClick={() => {
              form.resetFields();
              form.setFieldsValue({
                kind: kind === 'department' ? 'category' : kind,
                rate: '0.05',
                depreciates: true,
              });
              setEditing('new');
            }}
          >
            新增{kind === 'department' ? '部门' : masterLabels[kind]}
          </Button>
        )
      }
    >
      <Tabs
        activeKey={kind}
        onChange={(k) => setKind(k as typeof kind)}
        items={[
          ...Object.entries(masterLabels).map(([key, label]) => ({ key, label })),
          { key: 'department', label: '部门（core）' },
        ]}
      />
      <Alert
        title="部门直接使用账套 core 部门维度。被卡片使用的档案请停用，历史记录保留。"
        type="info"
        style={{ marginBottom: 16 }}
      />
      {kind === 'department' ? (
        <DataTable
          tableId="fixed-assets-departments"
          rowKey="id"
          dataSource={items}
          columns={[
            { key: 'code', title: '编码', dataIndex: 'code' },
            { key: 'name', title: '名称', dataIndex: 'name' },
          ]}
        />
      ) : (
        <DataTable
          tableId={`fixed-assets-master-${kind}`}
          rowKey="id"
          columns={columns}
          dataSource={(masters.data ?? []).filter((m) => m.kind === kind)}
        />
      )}
      <Drawer
        title={
          kind === 'department' ? '新增部门' : editing === 'new' ? '新增基础档案' : '修改基础档案'
        }
        open={editing != null}
        onClose={() => setEditing(null)}
        destroyOnHidden
        footer={
          <Button
            type="primary"
            loading={save.isPending || department.isPending}
            onClick={() =>
              void form
                .validateFields()
                .then((v) =>
                  kind === 'department'
                    ? department.mutate({ code: v.code, name: v.name })
                    : save.mutate({ id: editing !== 'new' ? editing?.id : undefined, data: v }),
                )
            }
          >
            保存
          </Button>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item name="kind" hidden>
            <Select />
          </Form.Item>
          <Form.Item name="code" label="编码" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          {(kind === 'category' || kind === 'purpose') && (
            <Form.Item name="accountId" label={kind === 'category' ? '资产科目' : '折旧分配科目'}>
              <AccountSelect allowClear />
            </Form.Item>
          )}
          {kind === 'category' && (
            <Form.Item name="rate" label="默认残值率（0 至 1）" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          )}
          {kind === 'status' && (
            <Form.Item name="depreciates" label="是否计提折旧" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
          {kind !== 'department' && (
            <Form.Item name="disabled" label="停用" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Drawer>
    </PageContainer>
  );
}
