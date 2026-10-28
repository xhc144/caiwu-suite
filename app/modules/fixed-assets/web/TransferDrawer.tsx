import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Drawer, Form, Input } from 'antd';
import { DataTable, DimensionSelect } from '@caiwu/ui';
import { notify, useCurrentPeriod, useDimensionItems } from '@caiwu/web-kit';
import { api, type Outputs } from './api';
import { Confirm, MasterSelect, refresh } from './common';
import { useAssetDraft } from './useAssetDraft';
import { qtyFromE6 } from '@caiwu/core';

type Values = {
  date: string;
  departmentId: number;
  purposeId: number;
  statusId: number;
  note: string;
  installation: string;
  custodian: string;
  quantity: string;
};
export default function TransferDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const detail = useQuery(api.detail.queryOptions({ id }));
  const records = useQuery(api.transfers.queryOptions({ id }));
  const masters = useQuery(api.masters.queryOptions());
  const { items: departments } = useDimensionItems('department');
  const current = useCurrentPeriod();
  const [form] = Form.useForm<Values>();
  const [error, setError] = useState('');
  const transfer = useMutation(api.transfer.mutationOptions());
  const undo = useMutation(api.undoTransfer.mutationOptions());
  const draft = useAssetDraft({
    title: '资产转移',
    discard: onClose,
    save: async () => {
      if (!detail.data) return false;
      const values = structuredClone(await form.validateFields());
      try {
        await transfer.mutateAsync({
          ...values,
          id,
          revision: detail.data.card.revision,
          confirm: true,
        });
        notify.success('资产转移已保存，历史月份保持原分配');
        void refresh();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : '转移失败');
        return false;
      }
    },
  });
  const name = (id: number, kind: 'department' | 'master') =>
    kind === 'department'
      ? (departments.find((d) => d.id === id)?.name ?? String(id))
      : (masters.data?.find((m) => m.id === id)?.name ?? String(id));
  const c = detail.data?.card;
  return (
    <Drawer open title="资产转移与变更记录" width={850} onClose={() => draft.close(onClose)}>
      <Alert
        type="info"
        title="按转移日期所在月份分配折旧。已计提的受影响月份须先逆序取消；以前月份的审核凭证和折旧记录保留。"
      />
      {error && <Alert type="error" title={error} />}
      {detail.error && <Alert type="error" title={detail.error.message} />}
      {c && (
        <Form
          form={form}
          name={`fixed-assets-transfer-${id}`}
          layout="vertical"
          initialValues={{
            date: current?.startDate ?? c.use_date,
            departmentId: c.department_id,
            purposeId: c.purpose_id,
            statusId: c.status_id,
            installation: c.installation,
            custodian: c.custodian,
            quantity: qtyFromE6(c.quantity_e6),
            note: '',
          }}
          disabled={draft.saving}
          onValuesChange={draft.changed}
          onFinish={() => void draft.save().catch(() => {})}
        >
          <p>
            {c.code} {c.name}；转前：{name(c.department_id, 'department')} /{' '}
            {name(c.purpose_id, 'master')} / {name(c.status_id, 'master')}
          </p>
          <Form.Item name="date" label="转移日期" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
          <Form.Item name="departmentId" label="转入部门" rules={[{ required: true }]}>
            <DimensionSelect type="department" />
          </Form.Item>
          <Form.Item name="purposeId" label="转后用途" rules={[{ required: true }]}>
            <MasterSelect kind="purpose" />
          </Form.Item>
          <Form.Item name="statusId" label="转后状态" rules={[{ required: true }]}>
            <MasterSelect kind="status" />
          </Form.Item>
          <Form.Item name="note" label="转移原因" rules={[{ required: true }]}>
            <Input.TextArea maxLength={500} />
          </Form.Item>
          <Form.Item name="installation" label="转后安装地点">
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="custodian" label="转后保管人">
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="quantity" label="转后数量" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Confirm
            title="确认按以上日期、部门、用途及状态转移资产？"
            onConfirm={() => void draft.save().catch(() => {})}
          >
            确认资产转移
          </Confirm>
        </Form>
      )}
      <DataTable<Outputs['transfers'][number]>
        tableId="fixed-assets-transfers"
        rowKey="id"
        dataSource={records.data ?? []}
        loading={records.isFetching}
        columns={[
          { key: 'date', title: '日期', dataIndex: 'date', width: 110 },
          {
            key: 'department',
            title: '使用部门',
            width: 170,
            render: (_, t) =>
              `${name(t.from_department_id, 'department')} → ${name(t.to_department_id, 'department')}`,
          },
          {
            key: 'purpose',
            title: '用途',
            width: 150,
            render: (_, t) =>
              `${name(t.from_purpose_id, 'master')} → ${name(t.to_purpose_id, 'master')}`,
          },
          {
            key: 'status',
            title: '状态',
            width: 150,
            render: (_, t) =>
              `${name(t.from_status_id, 'master')} → ${name(t.to_status_id, 'master')}`,
          },
          { key: 'note', title: '原因', dataIndex: 'note', width: 180 },
          {
            key: 'installation',
            title: '安装地点',
            width: 180,
            render: (_, t) => `${t.from_installation} → ${t.to_installation}`,
          },
          {
            key: 'custodian',
            title: '保管人',
            width: 150,
            render: (_, t) => `${t.from_custodian} → ${t.to_custodian}`,
          },
          {
            key: 'quantity',
            title: '数量',
            width: 130,
            render: (_, t) => `${qtyFromE6(t.from_quantity_e6)} → ${qtyFromE6(t.to_quantity_e6)}`,
          },
          { key: 'operator', title: '操作员', dataIndex: 'operator', width: 100 },
          {
            key: 'action',
            title: '操作',
            width: 120,
            noExport: true,
            render: (_, t) =>
              t.id === records.data?.at(-1)?.id && (
                <Confirm
                  danger
                  title="确认撤销最后一次资产转移？"
                  onConfirm={async () => {
                    await undo.mutateAsync({ id: t.id, confirm: true });
                    void refresh();
                  }}
                >
                  撤销转移
                </Confirm>
              ),
          },
        ]}
        locale={{ emptyText: '没有资产转移记录' }}
        exportName={records.data?.length ? '资产转移记录' : undefined}
      />
      <Button onClick={() => draft.close(onClose)}>关闭</Button>
    </Drawer>
  );
}
