import { Alert, Button, Card, Descriptions, Modal, Select, Space, Typography } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { PRODUCTS, productName, type ProductId } from '@caiwu/core';
import {
  coreApi,
  unsavedPages,
  queryClient,
  sessionStore,
  usePermission,
  useRequiredSession,
} from '@caiwu/web-kit';
import { PageContainer } from '@caiwu/ui';
import { api } from './api';
import { userError } from './errors';

export default function SettingsPage() {
  const session = useRequiredSession();
  const navigate = useNavigate();
  const canSwitch = usePermission('workbench.product.switch');
  const [next, setNext] = useState<ProductId>(session.book.product);
  const [confirm, setConfirm] = useState(false);
  const mutation = useMutation(api.switchProduct.mutationOptions());
  const [error, setError] = useState('');
  const switching = useRef(false);
  const [checking, setChecking] = useState(false);
  const commit = async () => {
    if (switching.current) return;
    switching.current = true;
    setChecking(true);
    setConfirm(false);
    setError('');
    const expected = sessionStore.get();
    try {
      const allowed = await unsavedPages.leave(
        session.bookId,
        undefined,
        (pages) =>
          new Promise((resolve) => {
            const dialog = Modal.confirm({
              title: '有未保存内容',
              transitionName: '',
              maskTransitionName: '',
              content: (
                <div>
                  {pages.map((page, i) => (
                    <p key={i}>{page.title}</p>
                  ))}
                </div>
              ),
              okText: '保存并继续',
              cancelText: '取消',
              onOk: () => {
                resolve('save');
              },
              onCancel: () => resolve('cancel'),
              footer: (_, { OkBtn, CancelBtn }) => (
                <Space wrap>
                  <Button
                    onClick={() => {
                      dialog.destroy();
                      resolve('discard');
                    }}
                  >
                    放弃修改并继续
                  </Button>
                  <CancelBtn />
                  <OkBtn />
                </Space>
              ),
            });
          }),
      );
      if (!allowed) {
        setError('切换已取消，或仍有内容未保存。请检查相关页面后重试。');
        return;
      }
      const event = new Event('beforeunload', { cancelable: true });
      Object.defineProperty(event, 'registeredPagesConfirmed', { value: true });
      if (!window.dispatchEvent(event)) {
        setError('有页面阻止离开，请先保存内容再切换。');
        return;
      }
      if (
        sessionStore.get()?.token !== expected?.token ||
        sessionStore.get()?.bookId !== expected?.bookId
      )
        return;
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
      setError(userError(e, '无法保存产品形态，请检查本地服务后重试'));
    } finally {
      switching.current = false;
      setChecking(false);
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
            id="workbench-product"
            aria-label="产品形态"
            value={next}
            disabled={!canSwitch || checking || mutation.isPending}
            style={{ width: 180 }}
            options={PRODUCTS.map((p) => ({ value: p.id, label: p.name }))}
            onChange={setNext}
          />
          <Button
            type="primary"
            disabled={!canSwitch || next === session.book.product}
            loading={checking || mutation.isPending}
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
      {confirm && (
        <Modal
          title="确认切换产品形态"
          open={confirm}
          onCancel={() => !checking && !mutation.isPending && setConfirm(false)}
          onOk={() => void commit()}
          confirmLoading={checking || mutation.isPending}
          okText="已保存内容，确认切换"
          cancelText="取消"
        >
          <p>
            将从{productName(session.book.product)}切换为{productName(next)}
            ，不适用的功能和标签将隐藏。
          </p>
          <p>切换前会检查未保存内容；如有修改，可选择保存、放弃修改或取消切换。</p>
        </Modal>
      )}
    </PageContainer>
  );
}
