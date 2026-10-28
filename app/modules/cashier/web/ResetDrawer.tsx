import { useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Form, Input, Space } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PeriodPicker } from '@caiwu/ui';
import { api, refresh } from './api';
import { QueryState, useCashierConfirm } from './common';

export default function ResetDrawer({ onClose }: { onClose: () => void }) {
  const preview = useQuery({
    ...api.resetPreview.queryOptions(),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [completed, setCompleted] = useState<{ period: number; backupId: string } | null>(null);
  const [confirm, holder] = useCashierConfirm();
  const reset = useMutation(
    api.reset.mutationOptions({
      onSuccess: (result) => {
        setCompleted(result);
        void refresh();
      },
    }),
  );
  const state = preview.data;
  return (
    <Drawer
      open
      title="重新初始化出纳"
      size={600}
      onClose={reset.isPending ? undefined : onClose}
      closable={!reset.isPending}
      maskClosable={!reset.isPending}
      keyboard={!reset.isPending}
    >
      {completed ? (
        <Space orientation="vertical" style={{ width: '100%' }}>
          <Alert
            type="success"
            showIcon
            title="出纳已重新初始化，请重新建立账户并录入期初"
            description={`新启用期间：${completed.period}；保护备份编号：${completed.backupId}。可在备份恢复页查看和导出完整备份。`}
          />
          <Button type="primary" onClick={onClose}>
            返回账户与期初
          </Button>
        </Space>
      ) : (
        <QueryState loading={preview.isLoading} error={preview.error} retry={preview.refetch}>
          {state && (
            <Space orientation="vertical" style={{ width: '100%' }} size="middle">
              <Alert
                type="warning"
                showIcon
                title="将删除当前账套的全部出纳数据"
                description="包含账户、期初、收付单及删除历史、支票、勾账和出纳结账记录。系统先创建并校验完整保护备份，成功后才清空；账务科目、账务期初和其他业务数据保留。"
              />
              <Descriptions bordered size="small" column={2}>
                <Descriptions.Item label="当前账套">{state.bookName}</Descriptions.Item>
                <Descriptions.Item label="原启用期间">{state.enabledPeriod}</Descriptions.Item>
                <Descriptions.Item label="账户">{state.accounts} 个</Descriptions.Item>
                <Descriptions.Item label="期初">{state.openings} 条</Descriptions.Item>
                <Descriptions.Item label="收付单">{state.documents} 张</Descriptions.Item>
                <Descriptions.Item label="已删除历史">
                  {state.deletedDocuments} 张
                </Descriptions.Item>
                <Descriptions.Item label="支票">{state.checks} 张</Descriptions.Item>
                <Descriptions.Item label="勾账">{state.matches} 组</Descriptions.Item>
                <Descriptions.Item label="出纳已结月份">
                  {state.closedPeriods} 个月
                </Descriptions.Item>
                <Descriptions.Item label="关联凭证">{state.vouchers} 张</Descriptions.Item>
                <Descriptions.Item label="单据日期范围" span={2}>
                  {state.from ? `${state.from} 至 ${state.to}` : '无单据'}
                </Descriptions.Item>
              </Descriptions>
              {state.blocked && (
                <Alert
                  type="error"
                  showIcon
                  title="请先处理出纳关联凭证"
                  description="请在收付单页按正常流程撤销出纳生成的凭证，再刷新预览。已审核或过账的凭证须先取消审核或过账。"
                />
              )}
              <Button
                loading={preview.isFetching}
                disabled={reset.isPending}
                onClick={() => {
                  setRequestKey(crypto.randomUUID());
                  void preview.refetch();
                }}
              >
                刷新清空范围
              </Button>
              <Form<{ period: number; bookName: string }>
                layout="vertical"
                initialValues={{ period: state.enabledPeriod }}
                disabled={reset.isPending}
                onFinish={async (value) => {
                  if (
                    await confirm({
                      title: '确认备份后清空全部出纳数据',
                      content: `账套「${state.bookName}」的 ${state.documents} 张收付单、${state.accounts} 个账户及全部出纳历史将删除。备份或保存失败会保留原数据；请确认已核对清空范围。`,
                      confirmText: '清空出纳数据',
                      okText: '创建保护备份并清空',
                    })
                  )
                    reset.mutate({
                      ...value,
                      snapshot: state.snapshot,
                      requestKey,
                      confirmation: '清空出纳数据',
                      confirmed: true,
                    });
                }}
              >
                <Form.Item name="period" label="新的出纳启用期间" rules={[{ required: true }]}>
                  <PeriodPicker aria-label="重新初始化启用期间" />
                </Form.Item>
                <Form.Item
                  name="bookName"
                  label={`请输入当前账套名称「${state.bookName}」`}
                  rules={[
                    { required: true, message: '请输入当前账套名称' },
                    {
                      validator: (_, value: string) =>
                        value === state.bookName
                          ? Promise.resolve()
                          : Promise.reject(new Error('账套名称必须完全一致')),
                    },
                  ]}
                >
                  <Input autoComplete="off" aria-label="确认初始化账套名称" maxLength={60} />
                </Form.Item>
                <Button
                  danger
                  type="primary"
                  htmlType="submit"
                  loading={reset.isPending}
                  disabled={state.blocked || preview.isFetching}
                >
                  重新初始化出纳
                </Button>
              </Form>
            </Space>
          )}
        </QueryState>
      )}
      {holder}
    </Drawer>
  );
}
