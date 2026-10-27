import { Alert, Button, Drawer, Form, Input, InputNumber, Popconfirm, Space, Tag } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { notify, queryClient, usePermission } from '@caiwu/web-kit';
import {
  DataTable,
  FilterBar,
  PageContainer,
  downloadBlob,
  useUrlFilters,
  type DataColumn,
} from '@caiwu/ui';
import { ReportTemplateSchema, type Report } from '../shared';
import exampleTemplate from '../templates/example.json';
import { api } from './api';
import StatutoryList, { StatutoryChoices } from './StatutoryList';

type Editing = { mode: 'new' } | { mode: 'copy' | 'header'; report: Report };
type Fields = { code: string; name: string; rows: number; cols: number };
export default function ListPage() {
  const [filters, setFilters] = useUrlFilters({ keyword: '' });
  const list = useQuery(api.list.queryOptions({ keyword: filters.keyword }));
  const canEdit = usePermission('report-engine.edit');
  const canExport = usePermission('report-engine.export');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: api.list.queryKey() });
  const remove = useMutation(api.remove.mutationOptions({ onSuccess: () => void refresh() }));
  const importing = useMutation(
    api.importTemplate.mutationOptions({
      onSuccess: () => {
        notify.success('已引入报表模板');
        void refresh();
      },
    }),
  );
  const exportTemplate = async (id: number) => {
    const t = await queryClient.fetchQuery(api.exportTemplate.queryOptions({ id }));
    downloadBlob(
      new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' }),
      `${t.code}-${t.name}.json`,
    );
  };
  const columns: DataColumn<Report>[] = [
    { key: 'code', title: '编码', width: 100, render: (_, r) => r.template.code },
    {
      key: 'name',
      title: '名称',
      width: 260,
      render: (_, r) => (
        <>
          {r.template.name} {r.template.readOnly && <Tag>只读模板</Tag>}
        </>
      ),
    },
    {
      key: 'size',
      title: '行 × 列',
      width: 110,
      render: (_, r) => `${r.template.rows} × ${r.template.cols}`,
    },
    { key: 'revision', title: '版本', dataIndex: 'revision', width: 90 },
    {
      key: 'actions',
      title: '操作',
      width: 520,
      noExport: true,
      render: (_, r) => (
        <Space wrap size={0}>
          <Button
            type="link"
            onClick={() => window.location.assign(`/m/report-engine/view?id=${r.id}`)}
          >
            生成/查看
          </Button>
          <Button
            type="link"
            onClick={() => window.location.assign(`/m/report-engine/designer?id=${r.id}`)}
          >
            定义
          </Button>
          {canEdit && (
            <Button type="link" onClick={() => setEditing({ mode: 'copy', report: r })}>
              复制
            </Button>
          )}
          {canEdit && !r.template.readOnly && (
            <Button type="link" onClick={() => setEditing({ mode: 'header', report: r })}>
              修改编号
            </Button>
          )}
          {canExport && (
            <Button type="link" onClick={() => void exportTemplate(r.id)}>
              导出模板
            </Button>
          )}
          {canEdit && !r.template.readOnly && (
            <Popconfirm
              title={`删除「${r.template.name}」及生成结果？`}
              okText="确认删除"
              cancelText="取消"
              onConfirm={() =>
                remove.mutate({ id: r.id, expectedRevision: r.revision, confirmed: true })
              }
            >
              <Button type="link" danger loading={remove.isPending}>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];
  return (
    <PageContainer
      title="报表管理"
      subtitle="选择适用的法定报表，或定义自己的单元格报表。"
      extra={
        canEdit && (
          <Button type="primary" onClick={() => setEditing({ mode: 'new' })}>
            新增报表
          </Button>
        )
      }
    >
      <StatutoryList />
      <FilterBar<{ keyword: string }>
        initialValues={filters}
        onSearch={(v) => {
          setFilters({ keyword: v.keyword ?? '' });
          window.location.reload();
        }}
      >
        <Form.Item name="keyword" label="编码/名称">
          <Input allowClear />
        </Form.Item>
      </FilterBar>
      {canEdit && (
        <Space wrap style={{ marginBottom: 12 }}>
          <Button
            loading={importing.isPending}
            onClick={() => importing.mutate(ReportTemplateSchema.parse(exampleTemplate))}
          >
            引入示例模板
          </Button>
          <label>
            引入 JSON 模板{' '}
            <input
              aria-label="引入JSON模板"
              type="file"
              accept=".json,application/json"
              disabled={importing.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                if (file.size > 1_000_000) {
                  setError('模板文件不能超过1MB');
                  return;
                }
                void file.text().then(async (text) => {
                  try {
                    const t = ReportTemplateSchema.parse(JSON.parse(text));
                    setError('');
                    await importing.mutateAsync(t);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : '模板读取失败，请检查JSON文件');
                  }
                });
              }}
            />
          </label>
        </Space>
      )}
      {(error || list.isError) && (
        <Alert
          type="error"
          showIcon
          title={error || '报表列表读取失败，请重试'}
          action={<Button onClick={() => void list.refetch()}>重试</Button>}
        />
      )}
      <DataTable<Report>
        tableId="report-engine.list"
        rowKey="id"
        columns={columns}
        dataSource={list.data ?? []}
        loading={list.isLoading}
        locale={{ emptyText: '暂无报表，请新增或引入示例模板' }}
      />
      {editing && (
        <HeaderDrawer
          key={editing.mode === 'new' ? 'new' : `${editing.mode}-${editing.report.id}`}
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={(created) => {
            setEditing(null);
            void refresh();
            if (created) window.location.assign(`/m/report-engine/designer?id=${created.id}`);
          }}
        />
      )}
    </PageContainer>
  );
}
function HeaderDrawer({
  editing,
  onClose,
  onSaved,
}: {
  editing: Editing;
  onClose(): void;
  onSaved(created?: Report): void;
}) {
  const [form] = Form.useForm<Fields>();
  const create = useMutation(api.create.mutationOptions());
  const copy = useMutation(api.copy.mutationOptions());
  const save = useMutation(api.save.mutationOptions());
  const title =
    editing.mode === 'new' ? '新增报表' : editing.mode === 'copy' ? '复制报表' : '修改编号';
  const submit = async (v: Fields) => {
    if (editing.mode === 'new') {
      const r = await create.mutateAsync(v);
      onSaved(r);
    } else if (editing.mode === 'copy') {
      await copy.mutateAsync({ sourceId: editing.report.id, code: v.code, name: v.name });
      onSaved();
    } else {
      await save.mutateAsync({
        id: editing.report.id,
        expectedRevision: editing.report.revision,
        template: { ...editing.report.template, code: v.code, name: v.name },
      });
      onSaved();
    }
  };
  return (
    <Drawer open title={title} onClose={onClose} destroyOnHidden size={420}>
      {editing.mode === 'new' && (
        <>
          <h3>选择法定报表</h3>
          <StatutoryChoices />
          <h3>或新增自定义报表</h3>
        </>
      )}
      <Form<Fields>
        layout="vertical"
        form={form}
        initialValues={
          editing.mode === 'new'
            ? { code: '', name: '', rows: 6, cols: 4 }
            : {
                ...editing.report.template,
                code: editing.mode === 'copy' ? '' : editing.report.template.code,
                name:
                  editing.mode === 'copy'
                    ? `${editing.report.template.name}副本`
                    : editing.report.template.name,
              }
        }
        onFinish={(v) => void submit(v)}
      >
        <Form.Item
          name="code"
          label="报表编码"
          rules={[
            { required: true, message: '请输入报表编码' },
            { pattern: /^\d{1,3}$/, message: '最多三位数字，小于1000' },
          ]}
        >
          <Input autoFocus maxLength={4} />
        </Form.Item>
        <Form.Item
          name="name"
          label="报表名称"
          rules={[{ required: true, whitespace: true, message: '请输入名称' }]}
        >
          <Input maxLength={80} />
        </Form.Item>
        {editing.mode === 'new' && (
          <Space>
            <Form.Item name="rows" label="行数" rules={[{ required: true }]}>
              <InputNumber min={1} max={999} />
            </Form.Item>
            <Form.Item name="cols" label="列数" rules={[{ required: true }]}>
              <InputNumber min={1} max={250} />
            </Form.Item>
          </Space>
        )}
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            htmlType="submit"
            loading={create.isPending || copy.isPending || save.isPending}
          >
            保存
          </Button>
        </Space>
      </Form>
    </Drawer>
  );
}
