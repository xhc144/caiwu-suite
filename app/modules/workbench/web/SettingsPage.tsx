import { Alert, Button, Card, Descriptions, Modal, Select, Space, Typography } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { PRODUCTS, productName, type ProductId } from '@caiwu/core';
import {
  coreApi,
  queryClient,
  sessionStore,
  usePermission,
  useRequiredSession,
} from '@caiwu/web-kit';
import { PageContainer } from '@caiwu/ui';
import { api } from './api';

export default function SettingsPage() {
  const session = useRequiredSession();
  const navigate = useNavigate();
  const canSwitch = usePermission('workbench.product.switch');
  const [next, setNext] = useState<ProductId>(session.book.product);
  const [confirm, setConfirm] = useState(false);
  const mutation = useMutation(api.switchProduct.mutationOptions());
  const [error, setError] = useState('');
  const commit = async () => {
    setError('');
    // 现有模块的 beforeunload 可取消切换；统一 dirty 回调待共享层接入。
    const event = new Event('beforeunload', { cancelable: true });
    if (!window.dispatchEvent(event)) {
      setError('有页面阻止离开，请先保存内容再切换。');
      return;
    }
    const expected = sessionStore.get();
    try {
      await mutation.mutateAsync({
        product: next,
        expectedProduct: session.book.product,
        confirmed: true,
      });
      if (
        sessionStore.get()?.token !== expected?.token ||
        sessionStore.get()?.bookId !== expected?.bookId
      )
        return;
      await queryClient.cancelQueries();
      queryClient.clear();
      const me = await queryClient.fetchQuery({ ...coreApi.auth.me.queryOptions(), staleTime: 0 });
      if (expected && sessionStore.get()?.token === expected.token)
        sessionStore.set({ ...expected, user: me.user, book: me.book });
      void navigate('/home', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : '切换失败，请刷新重试');
    }
  };
  return (
    <PageContainer title="工作台设置">
      <Card title="账套产品形态">
        <Descriptions column={1}>
          <Descriptions.Item label="当前产品">
            {productName(session.book.product)}
          </Descriptions.Item>
          <Descriptions.Item label="会计制度">{session.book.templateName}</Descriptions.Item>
        </Descriptions>
        <Typography.Paragraph>
          只改变当前账套可见功能，不修改会计制度、科目或历史数据，也不删除隐藏功能的数据。更改会保存到账套，重新登录后仍生效。
        </Typography.Paragraph>
        {!canSwitch && <Alert type="warning" title="没有产品形态切换权限" />}
        <Space wrap>
          <Select
            aria-label="产品形态"
            value={next}
            disabled={!canSwitch || mutation.isPending}
            style={{ width: 180 }}
            options={PRODUCTS.map((p) => ({ value: p.id, label: p.name }))}
            onChange={setNext}
          />
          <Button
            type="primary"
            disabled={!canSwitch || next === session.book.product}
            loading={mutation.isPending}
            onClick={() => setConfirm(true)}
          >
            切换产品形态
          </Button>
        </Space>
        {error && <Alert type="error" title="切换未完成" description={error} />}
      </Card>
      <Card title="界面偏好">
        <Typography.Paragraph>
          页头「界面」中可选择明亮、深色或跟随系统主题，以及100%/125%/150%网页界面缩放；设置按账套和用户保存在本机，不改变账套业务数据。
        </Typography.Paragraph>
        <Typography.Paragraph>桌面窗口的原生缩放需桌面壳支持。</Typography.Paragraph>
      </Card>
      <Modal
        title="确认切换产品形态"
        open={confirm}
        onCancel={() => !mutation.isPending && setConfirm(false)}
        onOk={() => void commit()}
        confirmLoading={mutation.isPending}
        okText="已保存内容，确认切换"
        cancelText="取消"
      >
        <p>
          将从{productName(session.book.product)}切换为{productName(next)}
          ，不适用的功能和标签将隐藏。
        </p>
        <p>请先保存所有表单。当前框架不能判断每个业务表单的未保存状态；已有离开保护会阻止切换。</p>
      </Modal>
    </PageContainer>
  );
}
