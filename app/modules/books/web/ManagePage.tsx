import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Descriptions,
  Form,
  Input,
  Modal,
  Space,
  Table,
  Typography,
} from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { coreApi, notify, queryClient, usePermission, useRequiredSession } from '@caiwu/web-kit';
import { PageContainer } from '@caiwu/ui';
import { formatPeriod, type BookInfo, type BookSummary } from '@caiwu/core';
import { api } from './api';
import Wizard from './Wizard';
import { filterBooks } from '../shared';

type Credentials = { userCode: string; password: string; name?: string; confirmed?: boolean };
type Operation = { mode: 'copy' | 'delete'; target: BookSummary; requestId: string };
type Prepared = { ticket: string; backupId: string; book: BookInfo };

import { useBookNavigation } from './useBookNavigation';

export default function ManagePage() {
  useBookNavigation();
  const session = useRequiredSession();
  const books = useQuery(coreApi.books.list.queryOptions());
  const diagnostics = useQuery(api.diagnostics.queryOptions());
  const canCopy = usePermission('books.copy');
  const canDelete = usePermission('books.delete');
  const [creating, setCreating] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [operation, setOperation] = useState<Operation | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [form] = Form.useForm<Credentials>();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: coreApi.books.list.queryKey() });
    void diagnostics.refetch();
  };
  const copy = useMutation(
    api.copy.mutationOptions({
      onSuccess: (book) => {
        notify.success(`已复制为「${book.name}」`);
        setOperation(null);
        refresh();
      },
    }),
  );
  const prepare = useMutation(api.prepareDelete.mutationOptions());
  const cancel = useMutation(api.cancelDelete.mutationOptions());
  const busy = copy.isPending || prepare.isPending;
  const close = () => {
    if (busy) return;
    if (prepared) cancel.mutate({ ticket: prepared.ticket });
    setOperation(null);
    setPrepared(null);
    form.resetFields();
  };
  const begin = (mode: Operation['mode'], target: BookSummary) => {
    form.resetFields();
    form.setFieldsValue({
      userCode: '',
      password: '',
      name: `${target.name}（副本）`,
      confirmed: false,
    });
    setOperation({ mode, target, requestId: crypto.randomUUID() });
    setPrepared(null);
  };
  return (
    <PageContainer
      title="账套管理"
      subtitle="复制及删除预览需验证目标账套身份；当前版本不执行删除"
      extra={
        <Button type="primary" onClick={() => setCreating(true)}>
          新建账套
        </Button>
      }
    >
      {books.isError && (
        <Alert
          type="error"
          title="账套列表读取失败"
          action={<Button onClick={() => void books.refetch()}>重试</Button>}
        />
      )}
      {diagnostics.data?.map((d) => (
        <Alert key={d.id} type="error" title={d.message} description={`文件编号：${d.id}`} />
      ))}
      <Space style={{ marginBottom: 16 }} wrap>
        <Input
          aria-label="搜索账套"
          placeholder="搜索编号、名称、单位或会计制度"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          allowClear
          style={{ width: 440, maxWidth: '75vw' }}
        />
        <Button onClick={refresh}>刷新列表</Button>
        <Typography.Text type="secondary">
          共{filterBooks(books.data ?? [], keyword).length}个匹配账套
        </Typography.Text>
      </Space>
      <Table<BookSummary>
        rowKey="id"
        dataSource={filterBooks(books.data ?? [], keyword)}
        loading={books.isLoading}
        pagination={false}
        locale={{ emptyText: keyword ? '没有匹配的账套，请修改搜索内容' : '没有可用账套' }}
        columns={[
          {
            title: '账套名称 / 编号',
            dataIndex: 'name',
            render: (name: string, b) => (
              <>
                <div>
                  {name}
                  {b.id === session.bookId ? '（当前使用）' : ''}
                </div>
                <Typography.Text
                  type="secondary"
                  copyable={{ tooltips: ['复制账套编号', '编号已复制'] }}
                >
                  {b.id}
                </Typography.Text>
              </>
            ),
          },
          { title: '单位', dataIndex: 'orgName' },
          { title: '会计制度', dataIndex: 'templateName' },
          { title: '启用年月', render: (_, b) => formatPeriod(b.startPeriod) },
          {
            title: '操作',
            render: (_, b) => (
              <Space>
                {canCopy && <Button onClick={() => begin('copy', b)}>复制</Button>}
                {canDelete && (
                  <Button
                    danger
                    disabled={b.id === session.bookId}
                    onClick={() => begin('delete', b)}
                  >
                    删除预览
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Typography.Paragraph type="secondary">
        删除执行暂不可用：当前无法保证其它窗口或进程已停止写入。仅支持目标身份验证、自动备份与预览，不会移动或删除账套、关闭目标连接或使会话失效。
      </Typography.Paragraph>
      {creating && (
        <Wizard
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            refresh();
            notify.info('新账套已核对；使用“切换账套”登录新账套');
          }}
        />
      )}
      <Modal
        open={!!operation}
        title={operation?.mode === 'copy' ? '复制账套' : '删除预览：身份验证与自动备份'}
        onCancel={close}
        maskClosable={false}
        footer={null}
        destroyOnHidden
      >
        {operation && (
          <>
            <Descriptions
              column={1}
              bordered
              items={[
                { key: 'id', label: '目标编号', children: operation.target.id },
                { key: 'name', label: '目标账套', children: operation.target.name },
                { key: 'org', label: '单位', children: operation.target.orgName },
                {
                  key: 'period',
                  label: '启用期间',
                  children: formatPeriod(operation.target.startPeriod),
                },
              ]}
            />
            {!prepared ? (
              <Form
                form={form}
                layout="vertical"
                style={{ marginTop: 16 }}
                onFinish={(v: Credentials) => {
                  const input = {
                    targetId: operation.target.id,
                    userCode: v.userCode,
                    password: v.password ?? '',
                  };
                  if (operation.mode === 'copy')
                    copy.mutate({
                      ...input,
                      name: v.name ?? '',
                      confirmed: true,
                      requestId: operation.requestId,
                    });
                  else
                    prepare.mutate(input, {
                      onSuccess: (p) => setPrepared(p),
                    });
                }}
              >
                <Alert
                  type="info"
                  title="请输入目标账套管理员或具有对应权限的用户及当前密码"
                  description={
                    operation.mode === 'copy'
                      ? '副本继承来源账套的操作员、密码、权限及全部业务数据；请仅向有权访问这些数据的人员提供副本。当前登录账套的权限不能代替来源身份验证。'
                      : '当前登录账套的权限不能代替目标账套身份验证。'
                  }
                />
                <Form.Item
                  name="userCode"
                  label="目标用户代码"
                  rules={[{ required: true, whitespace: true, message: '请输入目标账套用户代码' }]}
                >
                  <Input autoComplete="off" />
                </Form.Item>
                <Form.Item name="password" label="目标当前密码">
                  <Input.Password autoComplete="off" />
                </Form.Item>
                {operation.mode === 'copy' && (
                  <>
                    <Form.Item
                      name="name"
                      label="新账套名称"
                      rules={[{ required: true, whitespace: true, max: 60 }]}
                    >
                      <Input maxLength={60} />
                    </Form.Item>
                    <Form.Item
                      name="confirmed"
                      valuePropName="checked"
                      rules={[
                        {
                          validator: (_, value: boolean) =>
                            value
                              ? Promise.resolve()
                              : Promise.reject(new Error('请确认来源和新名称')),
                        },
                      ]}
                    >
                      <Checkbox>确认复制上述账套的全部数据，源账套保留</Checkbox>
                    </Form.Item>
                  </>
                )}
                <Space>
                  <Button onClick={close} disabled={busy}>
                    取消
                  </Button>
                  <Button type="primary" htmlType="submit" loading={busy}>
                    {operation.mode === 'copy' ? '确认复制' : '验证并自动备份'}
                  </Button>
                </Space>
              </Form>
            ) : (
              <Space orientation="vertical" style={{ marginTop: 16, width: '100%' }}>
                <Alert
                  type="warning"
                  title="自动备份成功；删除执行暂不可用"
                  description={`备份编号：${prepared.backupId}。当前账套未删除，其它窗口和会话可继续使用。为保护仍在写入的数据，本版本不能移动或删除账套。`}
                />
                <Space>
                  <Button onClick={close} disabled={busy}>
                    关闭预览
                  </Button>
                  <Button danger disabled>
                    删除暂不可用
                  </Button>
                </Space>
              </Space>
            )}
          </>
        )}
      </Modal>
    </PageContainer>
  );
}
