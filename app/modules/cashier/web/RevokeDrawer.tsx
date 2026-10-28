import { Alert, Button, Drawer, Space } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { DataTable } from '@caiwu/ui';
import { api, refresh } from './api';
import { QueryState, useCashierConfirm } from './common';

export default function RevokeDrawer({
  batchId,
  onClose,
}: {
  batchId: number;
  onClose: () => void;
}) {
  const preview = useQuery({
    ...api.previewRevoke.queryOptions({ batchId }),
    staleTime: Infinity,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const documents = useQuery({
    ...api.documents.queryOptions({ batch: batchId }),
    staleTime: Infinity,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const [confirm, holder] = useCashierConfirm();
  const revoke = useMutation(
    api.revoke.mutationOptions({
      onSuccess: () => {
        void refresh();
        onClose();
      },
    }),
  );
  const plan = preview.data?.plan;
  const voucherRows = (preview.data?.voucherIds ?? []).map((id) => ({
    id,
    number: documents.data?.find((row) => row.voucherId === id)?.voucherNo ?? `凭证 ${id}`,
  }));
  const busy = revoke.isPending;
  return (
    <Drawer
      open
      title={`撤销出纳凭证批次 ${batchId}`}
      size={680}
      onClose={busy ? undefined : onClose}
      closable={!busy}
      maskClosable={!busy}
      keyboard={!busy}
    >
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <Alert
          type="warning"
          showIcon
          title="整批撤销来源凭证，保留原收付单"
          description="请核对本批次的全部凭证及其他凭证的编号影响。已审核、已过账或已勾账时不能撤销；预览后数据变化须重新预览。"
        />
        <QueryState loading={preview.isLoading} error={preview.error} retry={preview.refetch}>
          {preview.data && plan && (
            <>
              <DataTable
                tableId="cashier.revoke.sources"
                rowKey="id"
                dataSource={voucherRows}
                columns={[
                  {
                    key: 'number',
                    title: '将删除的全部来源凭证',
                    dataIndex: 'number',
                  },
                  {
                    key: 'view',
                    title: '查看',
                    noExport: true,
                    render: (_, row) => (
                      <Link to={`/m/voucher-entry/edit?id=${row.id}`}>查看凭证</Link>
                    ),
                  },
                ]}
                pagination={false}
              />
              <Alert
                type={plan.renumber ? 'warning' : 'info'}
                title={
                  plan.renumber
                    ? '账套已启用删除后重排编号，以下列出完整编号影响'
                    : '账套未启用删除后重排编号，其余凭证编号保留'
                }
              />
              <DataTable
                tableId="cashier.revoke.numbers"
                rowKey="id"
                dataSource={plan.impacts}
                columns={[
                  {
                    key: 'voucher',
                    title: '受影响凭证',
                    render: (_, row) => (
                      <Link to={`/m/voucher-entry/edit?id=${row.id}`}>查看凭证</Link>
                    ),
                    exportValue: (row) => row.id,
                  },
                  { key: 'old', title: '原编号', dataIndex: 'oldNumber' },
                  { key: 'new', title: '撤销后编号', dataIndex: 'number' },
                  {
                    key: 'changed',
                    title: '变化',
                    render: (_, row) => (row.oldNumber === row.number ? '保留' : '重排'),
                    exportValue: (row) => (row.oldNumber === row.number ? '保留' : '重排'),
                  },
                ]}
                pagination={false}
                locale={{ emptyText: '其他凭证编号无变化' }}
              />
              <span>本次预览有效至：{new Date(plan.expiresAt).toLocaleString('zh-CN')}</span>
              <Space>
                <Button
                  disabled={busy}
                  loading={preview.isFetching}
                  onClick={() => {
                    void preview.refetch();
                    void documents.refetch();
                  }}
                >
                  重新预览编号影响
                </Button>
                <Button
                  danger
                  type="primary"
                  loading={busy}
                  disabled={preview.isFetching || busy}
                  onClick={async () => {
                    const selected = preview.data;
                    if (
                      selected &&
                      (await confirm({
                        title: `撤销出纳生成批次 ${batchId}`,
                        content: `将删除本批次全部 ${selected.voucherIds.length} 张来源凭证，并按已展示的编号计划处理其他凭证。原收付单保留，撤销后可以修改并重新生成。`,
                        confirmText: '撤销生成',
                        okText: '确认撤销并按计划处理编号',
                      }))
                    )
                      revoke.mutate({ batchId, confirmed: true, plan: selected.plan });
                  }}
                >
                  确认整批撤销
                </Button>
              </Space>
            </>
          )}
        </QueryState>
      </Space>
      {holder}
    </Drawer>
  );
}
