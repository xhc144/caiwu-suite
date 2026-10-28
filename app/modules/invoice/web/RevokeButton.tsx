import { useState } from 'react';
import { Alert, Button, Checkbox, Modal, Spin, Table } from 'antd';
import { useQuery } from '@tanstack/react-query';
import type { RevokeInput } from '../shared';
import { api } from './api';
import { QueryError } from './common';

export default function RevokeButton({
  id,
  expectedRevision,
  pending,
  onConfirm,
}: {
  id: number;
  expectedRevision: number;
  pending: boolean;
  onConfirm: (input: RevokeInput) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [confirmedFingerprint, setConfirmedFingerprint] = useState('');
  const preview = useQuery({
    ...api.previewRevoke.queryOptions({ id, expectedRevision }),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const plan = preview.data;
  const ready = !!plan && !preview.isFetching && !preview.isError;
  return (
    <>
      <Button
        danger
        disabled={pending}
        onClick={() => {
          setConfirmedFingerprint('');
          setOpen(true);
        }}
      >
        整体撤销
      </Button>
      <Modal
        title="撤销来源凭证预览"
        open={open}
        width={760}
        okText="确认整体撤销"
        okButtonProps={{
          danger: true,
          disabled: !ready || confirmedFingerprint !== plan?.fingerprint,
          loading: pending,
        }}
        cancelText="取消"
        cancelButtonProps={{ disabled: pending }}
        closable={!pending}
        maskClosable={!pending}
        onCancel={() => setOpen(false)}
        onOk={() => {
          if (ready && confirmedFingerprint === plan.fingerprint && !pending)
            void onConfirm({
              id: plan.id,
              expectedRevision: plan.expectedRevision,
              fingerprint: plan.fingerprint,
              deletionPlan: plan.deletionPlan,
              confirmed: true,
            }).then(
              () => {
                setOpen(false);
                setConfirmedFingerprint('');
              },
              () => setConfirmedFingerprint(''),
            );
        }}
      >
        <QueryError error={preview.error} retry={preview.refetch} />
        {preview.isFetching && <Spin />}
        {ready && (
          <>
            <p>将删除凭证 {plan.voucherNo}，整体解除以下发票的收入凭证关联：</p>
            <ul>
              {plan.invoices.map((invoice) => (
                <li key={invoice.id}>
                  {invoice.number}：恢复为{invoice.state === 'issued' ? '已转出库' : '已审核'}
                </li>
              ))}
            </ul>
            <Alert
              type="warning"
              title={
                plan.deletionPlan.renumber
                  ? '已启用删除后重排，请核对以下完整编号映射'
                  : '未启用删除后重排，其余凭证编号保持不变'
              }
            />
            {plan.impacts.length > 0 ? (
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={plan.impacts}
                columns={[
                  { title: '凭证记录', dataIndex: 'id' },
                  { title: '期间', dataIndex: 'period' },
                  { title: '原凭证', dataIndex: 'displayNo' },
                  { title: '原编号', dataIndex: 'oldNumber' },
                  { title: '撤销后编号', dataIndex: 'number' },
                ]}
              />
            ) : (
              <p>没有其他凭证需要改变编号。</p>
            )}
            <p>已转出库发票的原出库单、库存和成本关联将保留。</p>
            <Checkbox
              checked={confirmedFingerprint === plan.fingerprint}
              disabled={pending}
              onChange={(event) =>
                setConfirmedFingerprint(event.target.checked ? plan.fingerprint : '')
              }
            >
              已核对来源发票与编号影响，确认整体撤销
            </Checkbox>
          </>
        )}
        <p>
          <Button
            disabled={preview.isFetching || pending}
            onClick={() => {
              setConfirmedFingerprint('');
              void preview.refetch();
            }}
          >
            重新预览撤销
          </Button>
        </p>
      </Modal>
    </>
  );
}
