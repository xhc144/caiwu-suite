import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Form, Input, Modal } from 'antd';
import { DataTable } from '@caiwu/ui';
import { notify, usePermission } from '@caiwu/web-kit';
import { api } from './api';
import { VoucherDeletionPreview } from './VoucherDeletionPreview';

export default function ResetAssets() {
  const can = usePermission('fixed-assets.reset');
  const [open, setOpen] = useState(false);
  const preview = useQuery({ ...api.resetPreview.queryOptions(), enabled: open, staleTime: 0 });
  const reset = useMutation(api.reset.mutationOptions());
  const [form] = Form.useForm<{ bookName: string; password: string; confirmText: string }>();
  const ready = !preview.isFetching && !preview.error ? preview.data : undefined;
  return (
    <>
      <Button
        danger
        disabled={!can}
        onClick={() => {
          form.resetFields();
          setOpen(true);
          void preview.refetch();
        }}
      >
        受保护重置固定资产
      </Button>
      <Modal
        open={open}
        title="受保护重置固定资产"
        width={850}
        destroyOnHidden
        confirmLoading={reset.isPending}
        onCancel={() => {
          if (!reset.isPending) {
            form.resetFields();
            setOpen(false);
          }
        }}
        okText="备份并重置固定资产"
        okButtonProps={{ danger: true, disabled: !ready }}
        onOk={() =>
          void form
            .validateFields()
            .then(async (values) => {
              if (!ready) return;
              const result = await reset.mutateAsync({ ...values, revision: ready.revision });
              form.resetFields();
              setOpen(false);
              notify.success(result?.message ?? '已重置，请重新登录');
              window.location.assign('/');
            })
            .catch(() => {})
        }
      >
        <Alert
          type="warning"
          title="将清空本账套全部资产卡片、附属设备、折旧、转移、重算记录及资产基础档案，删除待审核或草稿资产凭证。"
          description="已审核或过账的来源凭证会阻止重置。执行前自动校验并保留整账保护备份，独占执行；替换失败由共享账套维护自动回滚。其他模块业务保留，完成后须重新登录。"
        />
        {preview.error && <Alert type="error" title={preview.error.message} />}
        {reset.error && <Alert type="error" title={reset.error.message} />}
        <p>目标账套：{ready?.book.name ?? '请等待预览'}</p>
        <DataTable
          tableId="fixed-assets-reset-sources"
          rowKey="id"
          loading={preview.isFetching}
          dataSource={ready?.vouchers ?? []}
          columns={[
            { key: 'date', title: '日期', dataIndex: 'date' },
            { key: 'number', title: '将删除的资产凭证', dataIndex: 'displayNo' },
            {
              key: 'status',
              title: '状态',
              render: (_, v) => (v.status === 'draft' ? '草稿' : '待审核'),
            },
          ]}
          locale={{ emptyText: '没有需要删除的资产凭证' }}
        />
        <p>
          资产卡片 {ready?.counts.find((c) => c.table === 'fixed_assets_card')?.count ?? 0}{' '}
          张；折旧批次 {ready?.counts.find((c) => c.table === 'fixed_assets_batch')?.count ?? 0}{' '}
          批。
        </p>
        <VoucherDeletionPreview preview={ready?.voucherDeletion} />
        <Form form={form} layout="vertical" disabled={reset.isPending}>
          <Form.Item name="bookName" label="输入完整账套名称" rules={[{ required: true }]}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name="password" label="当前管理员密码" rules={[{ required: true }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="confirmText" label="输入“清空固定资产”" rules={[{ required: true }]}>
            <Input autoComplete="off" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
