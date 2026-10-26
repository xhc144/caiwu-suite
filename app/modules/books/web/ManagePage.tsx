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

type Credentials = { userCode: string; password: string; name?: string; confirmed?: boolean };
type Operation = { mode: 'copy' | 'delete'; target: BookSummary; requestId: string };
type Prepared = { ticket: string; backupId: string; book: BookInfo; credentials: Credentials };

import { useBookNavigation } from './useBookNavigation';

export default function ManagePage() {
  useBookNavigation();
  const session = useRequiredSession();
  const books = useQuery(coreApi.books.list.queryOptions());
  const diagnostics = useQuery(api.diagnostics.queryOptions());
  const canCopy = usePermission('books.copy');
  const canDelete = usePermission('books.delete');
  const [creating, setCreating] = useState(false);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [confirmName, setConfirmName] = useState('');
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
  const remove = useMutation(
    api.remove.mutationOptions({
      onSuccess: (result) => {
        notify.success(`账套已移入恢复目录，备份编号：${result.backupId}`);
        setOperation(null);
        setPrepared(null);
        refresh();
      },
    }),
  );
  const cancel = useMutation(api.cancelDelete.mutationOptions());
  const busy = copy.isPending || prepare.isPending || remove.isPending;
  const close = () => {
    if (busy) return;
    if (prepared) cancel.mutate({ ticket: prepared.ticket });
    setOperation(null);
    setPrepared(null);
    setConfirmName('');
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
    setConfirmName('');
  };
  return (
    <PageContainer
      title="账套管理"
      subtitle="复制和删除均需目标账套的有效身份；每套账数据独立"
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
      <Table<BookSummary>
        rowKey="id"
        dataSource={books.data ?? []}
        loading={books.isLoading}
        pagination={false}
        columns={[
          {
            title: '账套名称',
            dataIndex: 'name',
            render: (name: string, b) => (
              <span>
                {name}
                {b.id === session.bookId ? '（当前使用）' : ''}
              </span>
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
                    删除
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Typography.Paragraph type="secondary">
        当前账套不能删除，请先切换并登录另一个账套。删除保留自动备份和恢复目录文件，不永久清除数据。凭证账册设置与自动备份设置由对应模块提供。
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
        title={operation?.mode === 'copy' ? '复制账套' : '删除账套：身份验证与自动备份'}
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
                      onSuccess: (p) => setPrepared({ ...p, credentials: v }),
                    });
                }}
              >
                <Alert
                  type="info"
                  title="请输入目标账套管理员或具有对应权限的用户及当前密码"
                  description="当前登录账套的权限不能代替目标账套身份验证。"
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
                  title="自动备份成功，请再次确认"
                  description={`备份编号：${prepared.backupId}。删除将移出活动目录，并使目标账套的全部登录会话失效；恢复文件会保留。`}
                />
                <label htmlFor="books-delete-confirm">
                  逐字输入目标账套名称：{prepared.book.name}
                </label>
                <Input
                  id="books-delete-confirm"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                />
                <Space>
                  <Button onClick={close} disabled={busy}>
                    取消删除
                  </Button>
                  <Button
                    danger
                    type="primary"
                    loading={remove.isPending}
                    disabled={confirmName !== prepared.book.name}
                    onClick={() =>
                      remove.mutate({
                        targetId: prepared.book.id,
                        ticket: prepared.ticket,
                        userCode: prepared.credentials.userCode,
                        password: prepared.credentials.password ?? '',
                        confirmName,
                      })
                    }
                  >
                    确认删除并保留备份
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
