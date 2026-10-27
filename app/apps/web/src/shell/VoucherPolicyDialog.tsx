import { Alert, Button, Checkbox, Form, Modal, Radio, Spin } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { coreApi } from '@caiwu/web-kit';

export function VoucherPolicyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const policy = useQuery({ ...coreApi.voucherPolicy.get.queryOptions(), enabled: open });
  const save = useMutation(
    coreApi.voucherPolicy.set.mutationOptions({
      onSuccess: async () => {
        await policy.refetch();
        onClose();
      },
    }),
  );
  return (
    <Modal title="凭证编号与修改设置" open={open} onCancel={onClose} footer={null} destroyOnHidden>
      {policy.isLoading ? (
        <Spin />
      ) : policy.isError ? (
        <Alert type="error" title="无法读取账套设置，请刷新后重试" />
      ) : (
        policy.data && (
          <Form
            key={JSON.stringify(policy.data)}
            initialValues={policy.data}
            layout="vertical"
            onFinish={(value: typeof policy.data) => {
              if (value) save.mutate(value);
            }}
          >
            <Form.Item label="凭证编号方式" name="numbering">
              <Radio.Group
                options={[
                  { value: 'automatic', label: '自动编号' },
                  { value: 'manual', label: '手工编号' },
                ]}
              />
            </Form.Item>
            <p>
              自动编号取当前最大号的下一个号。保留历史号或指定其他编号前，请选择手工编号。编号整理和插入仍须预览确认。
            </p>
            <Form.Item name="renumberAfterDelete" valuePropName="checked">
              <Checkbox>删除凭证后重新排列编号</Checkbox>
            </Form.Item>
            <Form.Item name="allowModifyOthers" valuePropName="checked">
              <Checkbox>允许修改其他操作员的凭证</Checkbox>
            </Form.Item>
            <Button htmlType="submit" type="primary" loading={save.isPending}>
              保存账套设置
            </Button>
          </Form>
        )
      )}
    </Modal>
  );
}
