import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Drawer, Form, Input, Select, Space, Switch, Tabs } from 'antd';
import { AccountSelect, DataTable, PageContainer, type DataColumn } from '@caiwu/ui';
import { coreApi, queryClient, useAccounts, usePermission } from '@caiwu/web-kit';
import type { z } from 'zod';
import { masterLabels, type MasterSchema } from '../shared';
import { api, type Outputs } from './api';
import { Confirm, EmptyError, refresh } from './common';
import { useAssetDraft } from './useAssetDraft';

type Master = Outputs['masters'][number];
type Department = Outputs['departments'][number];
type Kind = keyof typeof masterLabels | 'department';
type Editor = { kind: Kind; master?: Master; department?: Department };
const refreshDepartments = () =>
  Promise.all([
    refresh(),
    queryClient.invalidateQueries({ queryKey: coreApi.dimensions.items.queryKey() }),
  ]);

export default function MastersPage() {
  const masters = useQuery(api.masters.queryOptions());
  const departments = useQuery(api.departments.queryOptions());
  const { byId } = useAccounts();
  const canEdit = usePermission('fixed-assets.edit');
  const [kind, setKind] = useState<Kind>('category');
  const [editing, setEditing] = useState<Editor | null>(null);
  const [deleting, setDeleting] = useState<Department | null>(null);
  const remove = useMutation(api.removeMaster.mutationOptions({ onSuccess: () => void refresh() }));
  const setDisabled = useMutation(
    api.setDepartmentDisabled.mutationOptions({ onSuccess: () => void refreshDepartments() }),
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
            <Button size="small" onClick={() => setEditing({ kind, master: m })}>
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
          <Button type="primary" onClick={() => setEditing({ kind })}>
            新增{kind === 'department' ? '部门' : masterLabels[kind]}
          </Button>
        )
      }
    >
      <Tabs
        activeKey={kind}
        onChange={(key) => setKind(key as Kind)}
        items={[
          ...Object.entries(masterLabels).map(([key, label]) => ({ key, label })),
          { key: 'department', label: '部门' },
        ]}
      />
      <Alert
        title="部门与账套基础档案共用。停用后保留历史，新增资产不能选择；被使用的档案不能删除。"
        type="info"
        style={{ marginBottom: 16 }}
      />
      <EmptyError error={kind === 'department' ? departments.error : masters.error} />
      {kind === 'department' ? (
        <DataTable
          tableId="fixed-assets-departments"
          rowKey="id"
          loading={departments.isLoading}
          dataSource={departments.data ?? []}
          columns={[
            { key: 'code', title: '编码', dataIndex: 'code' },
            { key: 'name', title: '名称', dataIndex: 'name' },
            {
              key: 'disabled',
              title: '状态',
              render: (_, row) => (row.disabled ? '已停用' : '使用中'),
            },
            {
              key: 'actions',
              title: '操作',
              noExport: true,
              width: 280,
              render: (_, row) =>
                canEdit ? (
                  <Space wrap>
                    <Button
                      size="small"
                      onClick={() => setEditing({ kind: 'department', department: row })}
                    >
                      修改
                    </Button>
                    <Confirm
                      title={row.disabled ? '确认启用此部门？' : '确认停用此部门？已有记录保留。'}
                      onConfirm={() =>
                        setDisabled.mutate({
                          id: row.id,
                          revision: row.revision!,
                          disabled: !row.disabled,
                        })
                      }
                    >
                      {row.disabled ? '启用' : '停用'}
                    </Confirm>
                    <Button size="small" danger onClick={() => setDeleting(row)}>
                      删除
                    </Button>
                  </Space>
                ) : null,
            },
          ]}
        />
      ) : (
        <DataTable
          tableId={`fixed-assets-master-${kind}`}
          rowKey="id"
          columns={columns}
          dataSource={(masters.data ?? []).filter((m) => m.kind === kind)}
          loading={masters.isLoading}
        />
      )}
      {editing && <MasterEditor {...editing} onClose={() => setEditing(null)} />}
      {deleting && <DepartmentDelete department={deleting} onClose={() => setDeleting(null)} />}
    </PageContainer>
  );
}

function MasterEditor({ kind, master, department, onClose }: Editor & { onClose: () => void }) {
  const [form] = Form.useForm<z.input<typeof MasterSchema>>();
  const initialValues: Partial<z.input<typeof MasterSchema>> = department
    ? { code: department.code, name: department.name, disabled: department.disabled }
    : master
      ? {
          kind: master.kind as keyof typeof masterLabels,
          code: master.code,
          name: master.name,
          accountId: master.account_id,
          rate: master.rate,
          depreciates: !!master.depreciates,
          disabled: !!master.disabled,
        }
      : {
          kind: kind === 'department' ? undefined : kind,
          rate: '0.05',
          depreciates: true,
          disabled: false,
        };
  const saved = useRef(initialValues);
  const persisted = useRef({ id: department?.id ?? master?.id, revision: department?.revision });
  const save = useMutation(api.saveMaster.mutationOptions());
  const saveDepartment = useMutation(api.saveDepartment.mutationOptions());
  const draft = useAssetDraft({
    title: kind === 'department' ? '部门维护' : `${masterLabels[kind]}维护`,
    save: async () => {
      const values = structuredClone(await form.validateFields());
      if (kind === 'department') {
        const result = await saveDepartment.mutateAsync({
          ...persisted.current,
          code: values.code,
          name: values.name,
          disabled: values.disabled ?? false,
        });
        persisted.current = { id: result.id, revision: result.revision };
        saved.current = values;
        await refreshDepartments();
      } else {
        const id = await save.mutateAsync({ id: persisted.current.id, data: { ...values, kind } });
        persisted.current.id = id;
        saved.current = values;
        await refresh();
      }
    },
    discard: () => {
      form.resetFields();
      form.setFieldsValue(saved.current);
      onClose();
    },
  });
  const close = () => draft.close(onClose);
  return (
    <Drawer
      title={
        kind === 'department'
          ? department
            ? '修改部门'
            : '新增部门'
          : master
            ? '修改基础档案'
            : '新增基础档案'
      }
      open
      onClose={close}
      footer={
        <Space>
          <Button onClick={close}>取消</Button>
          <Button
            type="primary"
            loading={draft.saving}
            onClick={() =>
              void draft
                .save()
                .then((clean) => clean && onClose())
                .catch(() => {})
            }
          >
            保存
          </Button>
        </Space>
      }
    >
      <Form
        form={form}
        layout="vertical"
        onValuesChange={draft.changed}
        initialValues={initialValues}
      >
        {kind !== 'department' && (
          <Form.Item name="kind" hidden>
            <Select />
          </Form.Item>
        )}
        <Form.Item name="code" label="编码" rules={[{ required: true, whitespace: true }]}>
          <Input maxLength={40} />
        </Form.Item>
        <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true }]}>
          <Input maxLength={100} />
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
        <Form.Item name="disabled" label="停用" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Drawer>
  );
}

function DepartmentDelete({
  department,
  onClose,
}: {
  department: Department;
  onClose: () => void;
}) {
  const preview = useQuery(api.departmentDeletePreview.queryOptions({ id: department.id }));
  const remove = useMutation(api.removeDepartment.mutationOptions());
  const references = preview.data?.references ?? [];
  return (
    <Drawer title="删除部门" open onClose={onClose}>
      <p>
        {department.code} {department.name}
      </p>
      <EmptyError error={preview.error} />
      {preview.isFetching ? (
        <p>正在检查使用情况…</p>
      ) : preview.data && !preview.error ? (
        <>
          {references.length ? (
            <Alert
              type="warning"
              title="此部门已被使用，不能删除。可以停用以保留历史。"
              description={references.map((reference) => (
                <p key={reference.category}>
                  {reference.category}：{reference.count} 项
                </p>
              ))}
            />
          ) : (
            <Alert title="未发现引用。删除后不能恢复，请确认部门编码和名称。" type="warning" />
          )}
          <Button
            danger
            disabled={!!references.length}
            loading={remove.isPending}
            onClick={() => {
              if (!preview.data) return;
              void remove
                .mutateAsync({ plan: preview.data, confirm: true })
                .then(async () => {
                  await refreshDepartments();
                  onClose();
                })
                .catch(() => {});
            }}
          >
            确认删除部门
          </Button>
          <Button onClick={() => void preview.refetch()}>重新检查</Button>
        </>
      ) : null}
    </Drawer>
  );
}
