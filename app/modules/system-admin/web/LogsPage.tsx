import { useAdminConfirm } from './confirm';
import { Alert, Button, Drawer, Form, Input, Pagination, Select, Space, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { coreApi, useRequiredSession } from '@caiwu/web-kit';
import { DataTable, FilterBar, PageContainer, useUrlFilters, type DataColumn } from '@caiwu/ui';
import { api } from './api';
import { saveFile } from './session';

type LogRow = {
  id: number;
  at: string;
  userName: string;
  module: string;
  moduleName: string;
  actionName: string;
  summary: string;
  target: string;
  detail: string;
  to: string | null;
};
export default function LogsPage() {
  const s = useRequiredSession(),
    navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7) + '-01';
  const [f, setF] = useUrlFilters({
    from: month,
    to: today,
    user: '',
    module: '',
    action: '',
    target: '',
    page: 1,
  });
  const input = {
    from: f.from,
    to: f.to,
    userId: f.user ? Number(f.user) : undefined,
    module: f.module || undefined,
    action: f.action || undefined,
    target: f.target || undefined,
    page: f.page,
    pageSize: 30,
  };
  const modules = useQuery(coreApi.modules.list.queryOptions());
  const logs = useQuery(api.logs.list.queryOptions(input));
  const exp = useMutation(api.logs.export.mutationOptions());
  const [selected, setSelected] = useState<LogRow | null>(null);
  const [confirm, holder] = useAdminConfirm();
  const [version, setVersion] = useState(0);
  const tableId = `system-admin.logs.${s.bookId}.${s.user.id}`;
  const cols: DataColumn<LogRow>[] = [
    { key: 'at', title: '时间（UTC）', dataIndex: 'at', width: 210 },
    { key: 'user', title: '用户', dataIndex: 'userName', width: 130 },
    { key: 'module', title: '模块', dataIndex: 'moduleName', width: 150 },
    { key: 'action', title: '操作', dataIndex: 'actionName', width: 150 },
    { key: 'target', title: '目标', dataIndex: 'target', width: 120 },
    { key: 'summary', title: '业务摘要', dataIndex: 'summary', width: 340 },
    {
      key: 'detail',
      title: '详情',
      width: 90,
      render: (_, r) => (
        <Button size="small" onClick={() => setSelected(r)}>
          查看
        </Button>
      ),
    },
  ];
  return (
    <PageContainer
      title="操作日志"
      subtitle="当前账套；默认仅查询本月，扩大范围请显式调整日期。非管理员仅查看本人非敏感业务日志。"
      extra={
        <Space>
          <Button
            onClick={async () => {
              if (
                !(await confirm({
                  title: '导出当前范围日志',
                  content: `将导出 ${f.from} 至 ${f.to}、当前筛选下有权查看的全部日志（最多 10000 条）。`,
                  confirmText: '导出日志',
                }))
              )
                return;
              await saveFile(await exp.mutateAsync(input));
            }}
            loading={exp.isPending}
          >
            导出当前筛选
          </Button>
          <Button
            onClick={async () => {
              if (
                !(await confirm({
                  title: '恢复默认列宽',
                  content: '清除本机此用户此账套的日志列宽设置。',
                  confirmText: '恢复默认',
                }))
              )
                return;
              localStorage.removeItem(`caiwu.table.${tableId}.widths`);
              setVersion((n) => n + 1);
            }}
          >
            恢复默认列宽
          </Button>
        </Space>
      }
    >
      {holder}
      <FilterBar<typeof f> initialValues={f} onSearch={(v) => setF({ ...v, page: 1 })}>
        <Form.Item name="from" label="开始日期">
          <Input type="date" />
        </Form.Item>
        <Form.Item name="to" label="结束日期">
          <Input type="date" />
        </Form.Item>
        <Form.Item name="user" label="用户 ID">
          <Input style={{ width: 90 }} disabled={!s.user.isAdmin} />
        </Form.Item>
        <Form.Item name="module" label="模块">
          <Select
            allowClear
            style={{ width: 160 }}
            options={[
              { value: 'core', label: '系统' },
              ...(modules.data ?? []).map((m) => ({ value: m.id, label: m.name })),
            ]}
          />
        </Form.Item>
        <Form.Item name="action" label="操作">
          <Input style={{ width: 150 }} placeholder="操作中文名或代码" />
        </Form.Item>
        <Form.Item name="target" label="目标">
          <Input style={{ width: 100 }} />
        </Form.Item>
      </FilterBar>
      {logs.error && <Alert type="error" title="日志未能读取，请检查日期范围和权限" />}
      <DataTable
        key={version}
        tableId={tableId}
        rowKey="id"
        columns={cols}
        dataSource={logs.data?.rows ?? []}
        loading={logs.isLoading}
      />
      <Pagination
        style={{ marginTop: 16 }}
        current={f.page}
        pageSize={30}
        total={logs.data?.total ?? 0}
        showSizeChanger={false}
        onChange={(page) => setF({ page })}
      />
      <Drawer title="日志业务详情" open={!!selected} onClose={() => setSelected(null)}>
        <Typography.Paragraph>{selected?.summary}</Typography.Paragraph>
        <Typography.Paragraph>
          {selected?.detail || '此记录没有可显示的结构化业务详情。'}
        </Typography.Paragraph>
        {selected?.to && <Button onClick={() => void navigate(selected.to!)}>查看业务目标</Button>}
      </Drawer>
    </PageContainer>
  );
}
