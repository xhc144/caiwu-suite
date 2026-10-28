import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Modal } from 'antd';
import { DataTable } from '@caiwu/ui';
import { queryClient } from '@caiwu/web-kit';
import { api } from './api';

type Plan = {
  ids: number[];
  expiresAt: number;
  fingerprint: string;
  renumber: boolean;
  impacts: { id: number; oldNumber: number | null; number: number }[];
};
export default function RevokeVoucher({
  id,
  revision,
  kind,
  onSuccess,
  disabled = false,
}: {
  id: number;
  revision: number;
  kind: 'payment' | 'allocation';
  onSuccess: () => void;
  disabled?: boolean;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const revoke = useMutation(api.revoke.mutationOptions({ onSuccess }));
  const preview = async () => {
    setLoading(true);
    setError('');
    try {
      setPlan(
        await queryClient.fetchQuery({
          ...api.previewRevoke.queryOptions({ id, revision, kind }),
          staleTime: 0,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '撤销预览失败，请重试');
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      <Button danger disabled={disabled} loading={loading} onClick={() => void preview()}>
        撤销{kind === 'payment' ? '发放' : '分配'}凭证
      </Button>
      {error && <Alert type="error" title={error} />}
      <Modal
        title="确认撤销工资凭证及编号影响"
        open={!!plan}
        onCancel={() => {
          if (!revoke.isPending) setPlan(null);
        }}
        footer={null}
        destroyOnHidden
      >
        <p>将删除此未审核凭证。工资仍保留；修改工资前须撤销本批次全部凭证。</p>
        {plan?.renumber && (
          <Alert type="warning" title="账套启用了删除后重排编号，请核对以下编号变化。" />
        )}
        {plan && (
          <DataTable
            tableId="payroll-voucher-revoke-impact"
            rowKey="id"
            dataSource={plan.impacts.filter((p) => p.oldNumber !== p.number)}
            columns={[
              { key: 'oldNumber', title: '原编号', dataIndex: 'oldNumber' },
              { key: 'number', title: '新编号', dataIndex: 'number' },
            ]}
          />
        )}
        {plan && !plan.impacts.some((p) => p.oldNumber !== p.number) && (
          <p>其它凭证编号不会变化。</p>
        )}
        {revoke.error && <Alert type="error" title={revoke.error.message} />}
        <Button
          danger
          type="primary"
          loading={revoke.isPending}
          onClick={() => {
            if (plan) revoke.mutate({ id, revision, kind, confirmed: true, deletionPlan: plan });
          }}
        >
          确认撤销并删除凭证
        </Button>
      </Modal>
    </>
  );
}
