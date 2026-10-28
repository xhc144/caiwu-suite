import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Drawer, Form, Input, Popconfirm, Space, Spin } from 'antd';
import type { DimensionItem } from '@caiwu/core';
import { queryClient, useSubmission, useUnsavedChanges } from '@caiwu/web-kit';
import { DataTable } from '@caiwu/ui';
import { api } from './api';

export default function DepartmentManager({ onClose }: { onClose: () => void }) {
  const list = useQuery(api.departments.queryOptions());
  const [editing, setEditing] = useState<DimensionItem | 'new'>('new');
  const [dirty, setDirty] = useState(false);
  const { isSubmitting, submit } = useSubmission();
  const [form] = Form.useForm<{ code: string; name: string }>();
  const [deletion, setDeletion] = useState<{
    id: number;
    revision: number;
    expiresAt: number;
    fingerprint: string;
    references: { category: string; count: number }[];
  } | null>(null);
  const changed = async () => {
    setDirty(false);
    await queryClient.invalidateQueries();
  };
  const create = useMutation(api.createDepartment.mutationOptions());
  const update = useMutation(api.updateDepartment.mutationOptions());
  const status = useMutation(
    api.setDepartmentDisabled.mutationOptions({
      onSuccess: async (saved) => {
        if (editing !== 'new' && editing.id === saved.id) setEditing(saved);
        await changed();
      },
    }),
  );
  const remove = useMutation(
    api.deleteDepartment.mutationOptions({
      onSuccess: async () => {
        setDeletion(null);
        setEditing('new');
        form.resetFields();
        await changed();
      },
    }),
  );
  const saving = isSubmitting || create.isPending || update.isPending;
  const save = () =>
    submit(async () => {
      const input = await form.validateFields();
      const saved =
        editing === 'new'
          ? await create.mutateAsync(input)
          : await update.mutateAsync({
              ...input,
              id: editing.id,
              revision: editing.revision ?? 0,
            });
      setEditing(saved);
      await changed();
    });
  useUnsavedChanges({ title: '部门资料', dirty, save, discard: () => setDirty(false) });
  const choose = (item: DimensionItem | 'new') => {
    if (dirty && !window.confirm('放弃尚未保存的部门修改？')) return;
    setEditing(item);
    setDirty(false);
    form.setFieldsValue(item === 'new' ? { code: '', name: '' } : item);
  };
  const previewDelete = async (id: number) => {
    const plan = await queryClient.fetchQuery({
      ...api.previewDepartmentDelete.queryOptions({ id }),
      staleTime: 0,
    });
    setDeletion(plan);
  };
  return (
    <Drawer
      open
      size="large"
      title="部门管理"
      onClose={() => {
        if (!saving && (!dirty || window.confirm('放弃尚未保存的部门修改？'))) onClose();
      }}
    >
      <Alert
        type="info"
        title="修改编码与名称保留历史关联；停用后保留档案，新增工资须选择启用部门。已有引用的部门不能删除。"
      />
      {list.error && <Alert type="error" title={list.error.message} />}
      <DataTable<DimensionItem>
        tableId="payroll.departments"
        rowKey="id"
        loading={list.isLoading}
        dataSource={list.data ?? []}
        pagination={{ pageSize: 8 }}
        columns={[
          { key: 'code', title: '部门编码', dataIndex: 'code', width: 110 },
          { key: 'name', title: '部门名称', dataIndex: 'name', width: 150 },
          {
            key: 'status',
            title: '状态',
            width: 90,
            render: (_, r) => (r.disabled ? '停用' : '启用'),
          },
          {
            key: 'actions',
            title: '操作',
            width: 220,
            render: (_, r) => (
              <Space>
                <Button disabled={saving || status.isPending} onClick={() => choose(r)}>
                  修改部门
                </Button>
                <Popconfirm
                  title={`确认${r.disabled ? '启用' : '停用'}部门“${r.name}”？`}
                  onConfirm={() =>
                    status.mutateAsync({
                      id: r.id,
                      revision: r.revision ?? 0,
                      disabled: !r.disabled,
                      confirmed: true,
                    })
                  }
                >
                  <Button disabled={dirty || saving} loading={status.isPending}>
                    {r.disabled ? '启用' : '停用'}
                  </Button>
                </Popconfirm>
                <Button
                  danger
                  disabled={dirty || saving || remove.isPending}
                  onClick={() => void previewDelete(r.id)}
                >
                  删除
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <Space>
        <Button disabled={saving} onClick={() => choose('new')}>
          新增部门
        </Button>
        <span>{editing === 'new' ? '新增部门' : `修改部门：${editing.code}`}</span>
      </Space>
      <Form form={form} layout="vertical" onValuesChange={() => setDirty(true)}>
        <Form.Item name="code" label="部门编码" rules={[{ required: true, whitespace: true }]}>
          <Input disabled={saving} maxLength={30} />
        </Form.Item>
        <Form.Item name="name" label="部门名称" rules={[{ required: true, whitespace: true }]}>
          <Input disabled={saving} maxLength={60} />
        </Form.Item>
        <Button type="primary" loading={saving} onClick={() => void save().catch(() => {})}>
          保存部门
        </Button>
        {saving && <Spin />}
        {(create.error || update.error) && (
          <Alert type="error" title={(create.error ?? update.error)!.message} />
        )}
      </Form>
      {deletion && (
        <Drawer open title="确认删除部门" onClose={() => !remove.isPending && setDeletion(null)}>
          {deletion.references.length ? (
            <Alert
              type="warning"
              title="该部门已使用，不能删除"
              description={deletion.references
                .map((r) => `${r.category}：${r.count} 条`)
                .join('；')}
            />
          ) : (
            <Alert
              type="warning"
              title="确认删除该未使用部门？"
              description="正式删除时将再次核对引用和版本；取消不会修改部门。"
            />
          )}
          <Button onClick={() => setDeletion(null)} disabled={remove.isPending}>
            取消删除
          </Button>
          <Button
            danger
            disabled={!!deletion.references.length}
            loading={remove.isPending}
            onClick={() => remove.mutate({ ...deletion, confirmed: true })}
          >
            确认删除部门
          </Button>
          {remove.error && <Alert type="error" title={remove.error.message} />}
        </Drawer>
      )}
    </Drawer>
  );
}
