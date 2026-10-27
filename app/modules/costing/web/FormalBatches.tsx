import { Alert, Button, Popconfirm, Space, Table, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { formatMoney, sumCents } from '@caiwu/core';
import { queryClient, usePermission } from '@caiwu/web-kit';
import type { CalculationResult } from '../shared';
import { api } from './api';

type Props = {
  latestBatchId: string | null | undefined;
  historyValid: boolean;
  onView: (result: CalculationResult, label: string) => void;
  onCancelled: (period: number) => void;
};

export default function FormalBatches({ latestBatchId, historyValid, onView, onCancelled }: Props) {
  const batches = useQuery(api.batches.queryOptions());
  const canCalculate = usePermission('costing.calculate');
  const cancel = useMutation(
    api.cancelCalculation.mutationOptions({
      onSuccess: (r) => {
        onCancelled(r.period);
        void queryClient.invalidateQueries();
      },
    }),
  );
  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Typography.Title level={4}>正式核算记录</Typography.Title>
      {latestBatchId === null && (
        <Alert type="info" title="已到初始开账日期，没有可以撤销的正式核算" />
      )}
      {batches.error && <Alert type="error" title={batches.error.message} />}
      {cancel.error && <Alert type="error" title={cancel.error.message} />}
      <Table
        aria-label="正式核算记录"
        rowKey="id"
        dataSource={batches.data ?? []}
        pagination={false}
        columns={[
          { title: '批次编号', dataIndex: 'id' },
          { title: '核算年月', dataIndex: 'period' },
          {
            title: '状态',
            key: 'status',
            render: (_, r) => (r.status === 'calculated' ? '已正式核算' : '已撤销'),
          },
          { title: '版本', dataIndex: 'revision' },
          {
            title: '出库成本',
            key: 'issued',
            render: (_, r) => formatMoney(sumCents(r.result.rows.map((v) => v.issuedCents))),
          },
          {
            title: '结存金额',
            key: 'closing',
            render: (_, r) => formatMoney(sumCents(r.result.rows.map((v) => v.closingCents))),
          },
          {
            title: '操作',
            key: 'actions',
            render: (_, r) => (
              <Space>
                <Button
                  onClick={() =>
                    onView(
                      r.result,
                      `正式批次 #${r.id} · ${r.period} · ${r.status === 'calculated' ? '已正式核算' : '已撤销（保留历史结果）'}`,
                    )
                  }
                >
                  查看核算结果
                </Button>
                {canCalculate &&
                  historyValid &&
                  r.status === 'calculated' &&
                  r.inventory_batch_id === latestBatchId && (
                    <Popconfirm
                      title={`确认撤销 ${r.period} 正式成本核算？`}
                      description="将恢复本月核算前态并删除未审核的成本凭证；已审核或过账的关联凭证会阻止撤销。"
                      okText="确认撤销"
                      cancelText="保留核算"
                      onConfirm={() =>
                        cancel.mutateAsync({ id: r.id, revision: r.revision, confirmed: true })
                      }
                    >
                      <Button danger loading={cancel.isPending}>
                        撤销正式核算
                      </Button>
                    </Popconfirm>
                  )}
              </Space>
            ),
          },
        ]}
      />
    </Space>
  );
}
