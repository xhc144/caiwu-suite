import { Button, Card, Form, Input, Result, Spin, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { formatPeriod } from '@caiwu/core';
import { coreApi, sessionStore } from '@caiwu/web-kit';

/** 壳自带的登录页。系统管理模块（manifest.entryPages 含 login）会替换它。 */
export function LoginPage({ bookId }: { bookId: string }) {
  const navigate = useNavigate();
  const books = useQuery(coreApi.books.list.queryOptions());
  const login = useMutation(coreApi.auth.login.mutationOptions());
  const book = books.data?.find((b) => b.id === bookId);
  if (books.isLoading) return <Spin style={{ display: 'block', margin: 64 }} />;
  if (!book) {
    return (
      <Result
        status="404"
        title="账套不存在"
        extra={<Button onClick={() => void navigate('/')}>返回账套列表</Button>}
      />
    );
  }
  return (
    <div className="cw-center-page">
      <Card style={{ width: 380 }} title={book.name}>
        <Typography.Paragraph type="secondary">
          {book.orgName} · {book.templateName} · {formatPeriod(book.startPeriod)}启用
        </Typography.Paragraph>
        <Form
          layout="vertical"
          initialValues={{ userCode: 'admin', password: '' }}
          onFinish={(v: { userCode: string; password: string }) =>
            login.mutate(
              { bookId, userCode: v.userCode, password: v.password ?? '' },
              {
                onSuccess: (r) => {
                  sessionStore.set({ token: r.token, bookId, user: r.user, book: r.book });
                  void navigate('/home', { replace: true });
                },
              },
            )
          }
        >
          <Form.Item
            name="userCode"
            label="用户编号"
            rules={[{ required: true, message: '请输入用户编号' }]}
          >
            <Input prefix={<UserOutlined />} autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码">
            <Input.Password prefix={<LockOutlined />} autoFocus autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={login.isPending}>
            登录
          </Button>
          <Button type="link" block style={{ marginTop: 8 }} onClick={() => void navigate('/')}>
            返回账套列表
          </Button>
        </Form>
      </Card>
    </div>
  );
}
