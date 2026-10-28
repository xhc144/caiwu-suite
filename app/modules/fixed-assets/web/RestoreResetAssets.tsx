import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Form, Input, Modal } from 'antd';
import { notify, usePermission } from '@caiwu/web-kit';
import { api } from './api';

export default function RestoreResetAssets() {
  const can = usePermission('fixed-assets.reset');
  const info = useQuery({ ...api.resetProtection.queryOptions(), enabled: can });
  const preview = useMutation(api.resetRestorePreview.mutationOptions());
  const restore = useMutation(api.resetRestore.mutationOptions());
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ bookName: string; password: string; confirmText: string }>();
  return (
    <>
      <Button
        disabled={!can || !info.data}
        onClick={() => {
          form.resetFields();
          preview.reset();
          setOpen(true);
          preview.mutate();
        }}
      >
        恢复重置前整账
      </Button>
      <Modal
        open={open}
        title="恢复重置前的完整账套"
        width={760}
        confirmLoading={restore.isPending}
        onCancel={() => {
          if (!restore.isPending) {
            form.resetFields();
            setOpen(false);
          }
        }}
        okText="备份当前账套并恢复"
        okButtonProps={{
          danger: true,
          disabled: !preview.data || preview.isPending || !!preview.error,
        }}
        onOk={() =>
          void form
            .validateFields()
            .then(async (values) => {
              if (!preview.data) return;
              const result = await restore.mutateAsync({
                ...values,
                replacementId: preview.data.replacementId,
              });
              form.resetFields();
              notify.success(result.message);
              window.location.assign('/');
            })
            .catch(() => {})
        }
      >
        <Alert
          type="warning"
          title="恢复的是重置前完整账套，会覆盖重置后所有模块的新变更。"
          description="请核对保护副本日期及资产数量。恢复前也会完整备份当前账套；覆盖失败自动回滚，完成后须重新登录。此操作不会只合并资产卡片。"
        />
        {preview.error && <Alert type="error" title={preview.error.message} />}
        {restore.error && <Alert type="error" title={restore.error.message} />}
        <p>
          目标账套：{preview.data?.bookName ?? '正在读取保护备份'}；保护副本日期：
          {preview.data?.createdAt ?? '—'}；资产：{preview.data?.cardCount ?? '—'} 张。
        </p>
        <Form form={form} layout="vertical" disabled={restore.isPending}>
          <Form.Item name="bookName" label="确认完整账套名称" rules={[{ required: true }]}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name="password" label="确认当前管理员密码" rules={[{ required: true }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="confirmText" label="输入“恢复重置前整账”" rules={[{ required: true }]}>
            <Input autoComplete="off" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
