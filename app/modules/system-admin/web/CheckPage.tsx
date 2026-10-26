import { Alert, Button, Space, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { DataTable, PageContainer, type DataColumn } from '@caiwu/ui';
import type { CheckItem } from '../shared';
import { api } from './api';

export default function CheckPage() {
  const navigate = useNavigate();
  const checks = useQuery(api.checks.queryOptions(undefined, { staleTime: 0 }));
  const cols: DataColumn<CheckItem>[] = [
    { key: 'category', title: '项目', dataIndex: 'category', width: 160 },
    {
      key: 'status',
      title: '结果',
      width: 100,
      render: (_, r) => (
        <Tag color={r.status === '通过' ? 'green' : r.status === '不通过' ? 'red' : 'default'}>
          {r.status}
        </Tag>
      ),
    },
    { key: 'target', title: '科目/凭证/期间', dataIndex: 'target', width: 260 },
    { key: 'message', title: '检查结果', dataIndex: 'message', width: 360 },
    { key: 'suggestion', title: '建议', dataIndex: 'suggestion', width: 330 },
    {
      key: 'to',
      title: '操作',
      width: 100,
      render: (_, r) =>
        r.to && (
          <Button size="small" onClick={() => void navigate(r.to!)}>
            去处理
          </Button>
        ),
    },
  ];
  return (
    <PageContainer
      title="综合检查"
      subtitle="只读核查当前账套的科目、期初、凭证及辅助项、外币和数量；金额按整数分，余额借正贷负。"
      extra={
        <Button onClick={() => void checks.refetch()} loading={checks.isFetching}>
          重新检查
        </Button>
      }
    >
      <Alert
        style={{ marginBottom: 16 }}
        showIcon
        type="info"
        title="检查不会修改凭证或账期"
        description="自动修复和开账日期调整暂未开放，需要完整在线备份、独占维护锁及安全的原子服务。"
      />
      {checks.isError ? (
        <Alert
          type="error"
          title="本次检查未能完成"
          description="请重新检查；已有结果仅供参考，不能据此判断当前账套通过。"
          style={{ marginBottom: 12 }}
        />
      ) : checks.data ? (
        <Space style={{ marginBottom: 12 }}>
          不通过：{checks.data.filter((r) => r.status === '不通过').length}{' '}
          项；无数据与无法检查的项目请阅读具体说明。
        </Space>
      ) : null}
      <DataTable
        tableId="system-admin.checks"
        rowKey="id"
        loading={checks.isFetching}
        columns={cols}
        dataSource={checks.data ?? []}
      />
    </PageContainer>
  );
}
