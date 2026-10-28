import { Alert, Button, Form, Input, Space } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { queryClient, useUnsavedChanges, useSubmission } from '@caiwu/web-kit';
import { PageContainer } from '@caiwu/ui';
import { api } from './api';

export default function OperationDatePage() {
  const current = useQuery(api.operationDate.get.queryOptions(undefined, { staleTime: 0 }));
  const submission = useSubmission();
  const mutation = useMutation(api.operationDate.set.mutationOptions());
  const [form] = Form.useForm<{ date: string }>();
  const [dirty, setDirty] = useState(false);
  const revision = useRef(0);
  const save = () =>
    submission.submit(async () => {
      if (mutation.isPending) return false;
      const version = revision.current;
      const input = await form.validateFields();
      const result = await mutation.mutateAsync(input);
      queryClient.setQueryData(api.operationDate.get.queryKey(), result);
      if (version !== revision.current) return false;
      setDirty(false);
      return true;
    });
  useUnsavedChanges({
    title: '操作日期',
    dirty,
    version: revision.current,
    save,
    discard: () => {
      form.resetFields();
      setDirty(false);
    },
  });
  return (
    <PageContainer
      title="操作日期"
      subtitle="操作日期按当前登录分别保存，系统时间和会计期间照常执行。"
    >
      {current.isError ? (
        <Alert type="error" title="操作日期读取失败，请刷新后重试" />
      ) : (
        current.data && (
          <>
            <Alert
              type="info"
              title={`当前操作日期：${current.data.date}；系统日期：${current.data.systemDate}`}
              description="此处保存个人操作日期。凭证及其他业务的默认日期仍按各业务页面的设置。"
            />
            <Form
              key={current.data.startDate}
              form={form}
              style={{ maxWidth: 420, marginTop: 20 }}
              layout="vertical"
              initialValues={{ date: current.data.date }}
              disabled={mutation.isPending || submission.isSubmitting}
              onValuesChange={() => {
                revision.current++;
                setDirty(true);
              }}
              onFinish={() => void save()}
            >
              <Form.Item
                name="date"
                label="操作日期"
                rules={[{ required: true, message: '请选择操作日期' }]}
              >
                <Input type="date" min={current.data.startDate} />
              </Form.Item>
              <Space>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={mutation.isPending || submission.isSubmitting}
                >
                  保存操作日期
                </Button>
                <Button
                  onClick={() => {
                    form.resetFields();
                    setDirty(false);
                  }}
                >
                  取消修改
                </Button>
              </Space>
            </Form>
          </>
        )
      )}
    </PageContainer>
  );
}
