import { Alert, Button, Card, Form, Input, Space, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { useNavigate } from 'react-router';
import { coreApi, getBusinessError, queryClient, sessionStore } from '@caiwu/web-kit';

export default function LoginPage({ bookId }: { bookId: string }) {
  const navigate = useNavigate();
  const books = useQuery(coreApi.books.list.queryOptions());
  const book = books.data?.find((b) => b.id === bookId);
  const login = useMutation(coreApi.auth.login.mutationOptions({ meta: { silent: true } }));
  const inFlight = useRef(false);
  const submit = async (v: { userCode: string; password?: string }) => {
    if (inFlight.current || !book) return;
    inFlight.current = true;
    try {
      const result = await login.mutateAsync({
        bookId,
        userCode: v.userCode,
        password: v.password ?? '',
      });
      await queryClient.cancelQueries();
      queryClient.clear();
      sessionStore.set({
        token: result.token,
        bookId: result.book.id,
        user: result.user,
        book: result.book,
      });
      void navigate('/home', { replace: true });
    } catch (error) {
      if (getBusinessError(error)?.code === 'BOOK_NOT_FOUND') await books.refetch();
      /* 中文错误在页内显示，不暴露账号状态 */
    } finally {
      inFlight.current = false;
    }
  };
  return (
    <main style={{ maxWidth: 480, margin: '8vh auto', padding: 24 }}>
      <Card>
        <Typography.Title level={3}>用户登录</Typography.Title>
        {books.isLoading ? (
          <Typography.Paragraph>正在读取账套…</Typography.Paragraph>
        ) : books.error ? (
          <Alert
            type="error"
            title="账套列表读取失败"
            description="请确认本地服务正常后刷新账套。"
          />
        ) : !book ? (
          <Alert
            type="error"
            showIcon
            title={!bookId ? '尚未选择账套' : '账套不存在，可能已删除'}
            description="请返回账套列表重新选择。"
          />
        ) : (
          <>
            <Typography.Paragraph>
              已选账套：<strong>{book.name}</strong>
              <br />
              {book.orgName} · 启用期间 {book.startPeriod}
            </Typography.Paragraph>
            <Form
              layout="vertical"
              initialValues={{ userCode: 'admin' }}
              onFinish={(v) => void submit(v)}
            >
              <Form.Item
                name="userCode"
                label="用户编号"
                rules={[{ required: true, message: '请输入用户编号' }]}
              >
                <Input autoFocus autoComplete="username" maxLength={20} />
              </Form.Item>
              <Form.Item name="password" label="密码">
                <Input.Password autoComplete="current-password" maxLength={64} />
              </Form.Item>
              {login.error && (
                <Alert
                  style={{ marginBottom: 16 }}
                  type="error"
                  showIcon
                  title={getBusinessError(login.error)?.message ?? '登录未成功，请重试'}
                  description="请核对用户编号和密码；忘记密码请联系管理员。"
                />
              )}
              <Button block type="primary" htmlType="submit" loading={login.isPending}>
                登录
              </Button>
            </Form>
          </>
        )}
        <Space style={{ marginTop: 16 }}>
          <Button onClick={() => void navigate('/')}>返回账套列表</Button>
          <Button onClick={() => void books.refetch()}>刷新账套</Button>
        </Space>
      </Card>
    </main>
  );
}
