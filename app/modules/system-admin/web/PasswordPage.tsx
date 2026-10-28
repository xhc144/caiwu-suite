import { Alert, Button, Form, Input } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { PageContainer } from '@caiwu/ui';
import { useRequiredSession, useUnsavedChanges, useSubmission } from '@caiwu/web-kit';
import { useRef, useState } from 'react';
import { api } from './api';
import { flushSync } from 'react-dom';
import { goToLogin } from './session';

export default function PasswordPage() {
  const session = useRequiredSession();
  const submission = useSubmission();
  const change = useMutation(api.changePassword.mutationOptions());
  const [form] = Form.useForm();
  const [dirty, setDirty] = useState(false);
  const revision = useRef(0);
  const save = () =>
    submission.submit(async () => {
      if (change.isPending) return false;
      const version = revision.current;
      const v = await form.validateFields();
      await change.mutateAsync({ ...v, oldPassword: v.oldPassword ?? '' });
      // Successful password changes revoke this session immediately.
      if (version !== revision.current) return false;
      flushSync(() => setDirty(false));
      await goToLogin(session.bookId);
      return true;
    });
  useUnsavedChanges({
    title: '自改密码',
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
      title="自改密码"
      subtitle={`当前用户：${session.user.name}（${session.user.code}）`}
    >
      <Alert
        type="info"
        showIcon
        title="新密码须为 8–64 个字符；保存后当前账套的全部旧会话失效，请重新登录。"
      />
      <Form
        style={{ maxWidth: 420, marginTop: 20 }}
        layout="vertical"
        form={form}
        disabled={change.isPending || submission.isSubmitting}
        onValuesChange={() => {
          revision.current++;
          setDirty(true);
        }}
        onFinish={() => void save()}
      >
        <Form.Item name="oldPassword" label="原密码">
          <Input.Password autoComplete="current-password" maxLength={64} />
        </Form.Item>
        <Form.Item
          name="password"
          label="新密码"
          rules={[{ required: true, min: 8, max: 64, message: '请输入 8–64 个字符' }]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          label="确认新密码"
          dependencies={['password']}
          rules={[
            { required: true, message: '请再次输入新密码' },
            ({ getFieldValue }) => ({
              validator: (_, v) =>
                v === getFieldValue('password')
                  ? Promise.resolve()
                  : Promise.reject(new Error('两次新密码不一致')),
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Button
          type="primary"
          htmlType="submit"
          loading={change.isPending || submission.isSubmitting}
        >
          保存新密码并重新登录
        </Button>
      </Form>
    </PageContainer>
  );
}
