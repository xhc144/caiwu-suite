import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Drawer, Space } from 'antd';
import { DataTable } from '@caiwu/ui';
import { formatMoney } from '@caiwu/core';
import { notify } from '@caiwu/web-kit';
import type { CardFilterInput } from '../shared';
import { api } from './api';
import { Confirm, refresh } from './common';

export default function RecalculationDrawer({
  filter,
  onClose,
}: {
  filter: CardFilterInput;
  onClose: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const preview = useQuery({
    ...api.recalculationPreview.queryOptions(filter),
    enabled: !confirmed,
  });
  const history = useQuery(api.recalculations.queryOptions());
  const apply = useMutation(api.recalculate.mutationOptions());
  const undo = useMutation(api.undoRecalculation.mutationOptions());
  const result = !preview.isFetching && !preview.error && !confirmed ? preview.data : undefined;
  return (
    <Drawer open title="按使用日期重算累计折旧" width={1000} onClose={onClose}>
      <Alert
        type="warning"
        title="将重建当前筛选资产的期初累计折旧及已有月记录，保存前请核对逐项差额。"
        description="平均年限法从使用次月算至启用前月，并按现存折旧月份、原值调整、转移状态继续计算。工作量法按已录累计及每月工作量计算。启用前没有逐月状态记录时沿用最早可还原状态。关闭期间或已有来源凭证须先按正常流程逆序处理。成功后保留原数快照，多次重算请从最后一次逆序撤回；其他后续变更会阻止撤回。"
      />
      {preview.error && <Alert type="error" title={preview.error.message} />}
      <DataTable
        tableId="fixed-assets-recalculation"
        rowKey="id"
        dataSource={result?.rows ?? []}
        loading={preview.isFetching}
        columns={[
          { key: 'code', title: '设备编号', dataIndex: 'code' },
          { key: 'name', title: '设备名称', dataIndex: 'name' },
          { key: 'before', title: '原累计折旧', dataIndex: 'before', money: true },
          { key: 'after', title: '重算累计折旧', dataIndex: 'after', money: true },
          { key: 'difference', title: '差额', dataIndex: 'difference', money: true },
          { key: 'beforeMonths', title: '原累计月数', dataIndex: 'beforeMonths' },
          { key: 'afterMonths', title: '重算月数', dataIndex: 'afterMonths' },
          { key: 'note', title: '重算依据', dataIndex: 'note', width: 300 },
        ]}
        exportName={result?.rows.length ? '累计折旧重算预览' : undefined}
      />
      <p>累计折旧差额合计：{formatMoney(result?.totalDifference ?? 0)} 元</p>
      <Space>
        <Button
          onClick={() => {
            setConfirmed(false);
            void preview.refetch();
          }}
        >
          重新预览
        </Button>
        {result && (
          <Confirm
            danger
            title="确认覆盖以上累计折旧及历史月记录？"
            onConfirm={async () => {
              await apply.mutateAsync({ filter, token: result.token, confirm: true });
              setConfirmed(true);
              notify.success('累计折旧已重算，原数快照已保留');
              void refresh();
            }}
          >
            确认重算并保存
          </Confirm>
        )}
      </Space>
      <DataTable
        tableId="fixed-assets-recalculations"
        rowKey="id"
        dataSource={history.data ?? []}
        columns={[
          { key: 'date', title: '重算时间', dataIndex: 'created_at', width: 200 },
          { key: 'operator', title: '操作员', dataIndex: 'operator' },
          {
            key: 'status',
            title: '状态',
            render: (_, r) => (r.undone ? '已撤回' : r.canUndo ? '可撤回' : r.undoBlockReason),
          },
          {
            key: 'action',
            title: '操作',
            noExport: true,
            render: (_, r) =>
              !r.undone &&
              r.canUndo && (
                <Confirm
                  danger
                  title="确认恢复此批重算前的累计数和月记录？后续变更会阻止撤回。"
                  onConfirm={async () => {
                    await undo.mutateAsync({ id: r.id, confirm: true });
                    notify.success('已恢复重算前数据');
                    setConfirmed(false);
                    void refresh();
                  }}
                >
                  撤回重算
                </Confirm>
              ),
          },
        ]}
        locale={{ emptyText: '没有累计折旧重算记录' }}
      />
    </Drawer>
  );
}
