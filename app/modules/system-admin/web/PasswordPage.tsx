import { Alert, Button, Form, Input } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { PageContainer } from '@caiwu/ui';
import { useRequiredSession } from '@caiwu/web-kit';
import { api } from './api';
import { goToLogin } from './session';

export default function PasswordPage() {
  const session = useRequiredSession();
  const change = useMutation(api.changePassword.mutationOptions());
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
        onFinish={async (v: {
          oldPassword?: string;
          password: string;
          confirmPassword: string;
        }) => {
          await change.mutateAsync({ ...v, oldPassword: v.oldPassword ?? '' });
          await goToLogin(session.bookId);
        }}
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
        <Button type="primary" htmlType="submit" loading={change.isPending}>
          保存新密码并重新登录
        </Button>
      </Form>
    </PageContainer>
  );
}
