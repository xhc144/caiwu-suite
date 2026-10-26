import { Alert, Button, Descriptions, Form, Input, Spin } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { coreApi, notify, queryClient, sessionStore, usePermission } from '@caiwu/web-kit';
import { PageContainer } from '@caiwu/ui';
import { formatPeriod } from '@caiwu/core';
import { api } from './api';

import { useBookNavigation } from './useBookNavigation';

export default function InfoPage() {
  useBookNavigation();
  const info = useQuery(api.info.queryOptions());
  const canEdit = usePermission('books.edit');
  const save = useMutation(
    api.update.mutationOptions({
      onSuccess: (book) => {
        const session = sessionStore.get();
        if (session && session.bookId === book.id) sessionStore.set({ ...session, book });
        void queryClient.invalidateQueries({ queryKey: api.info.queryKey() });
        void queryClient.invalidateQueries({ queryKey: coreApi.books.list.queryKey() });
        void queryClient.invalidateQueries({ queryKey: coreApi.auth.me.queryKey() });
        notify.success('账套信息已保存');
      },
    }),
  );
  if (!info.data)
    return info.isError ? (
      <Alert
        type="error"
        title="账套信息读取失败"
        action={<Button onClick={() => void info.refetch()}>重试</Button>}
      />
    ) : (
      <Spin />
    );
  const b = info.data;
  return (
    <PageContainer title="账套信息" subtitle="维护当前账套的名称及单位">
      <Form
        key={`${b.id}/${b.name}/${b.orgName}`}
        layout="vertical"
        initialValues={{ name: b.name, orgName: b.orgName }}
        onFinish={(v: { name: string; orgName: string }) => save.mutate(v)}
        style={{ maxWidth: 720 }}
      >
        <Form.Item
          name="name"
          label="账套名称"
          rules={[{ required: true, whitespace: true, max: 60 }]}
        >
          <Input maxLength={60} disabled={!canEdit} />
        </Form.Item>
        <Form.Item
          name="orgName"
          label="单位名称"
          rules={[{ required: true, whitespace: true, max: 100 }]}
        >
          <Input maxLength={100} disabled={!canEdit} />
        </Form.Item>
        {canEdit && (
          <Button htmlType="submit" type="primary" loading={save.isPending}>
            保存
          </Button>
        )}
      </Form>
      <Descriptions
        style={{ marginTop: 24 }}
        column={1}
        bordered
        items={[
          { key: 'id', label: '账套编号', children: b.id },
          { key: 'template', label: '会计制度', children: b.templateName },
          {
            key: 'period',
            label: '启用期间',
            children: `${formatPeriod(b.startPeriod)}；公历会计年度1—12月`,
          },
          { key: 'scheme', label: '科目级次', children: b.codeScheme.join('-') },
          {
            key: 'currency',
            label: '本位币',
            children: `${b.baseCurrency}（当前支持人民币本位币）`,
          },
        ]}
      />
      <Alert
        style={{ marginTop: 16 }}
        type="info"
        title="制度、启用期间和科目级次只读，避免破坏历史数据"
        description="科目编码调整由科目模块提供；凭证业务设置、期末处理设置、账册与打印设置分别由相应模块提供，尚无统一入口。"
      />
    </PageContainer>
  );
}
