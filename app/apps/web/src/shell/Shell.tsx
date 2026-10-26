import {
  Avatar,
  Button,
  ConfigProvider,
  Dropdown,
  Layout,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  theme as antTheme,
} from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { formatPeriod, productName } from '@caiwu/core';
import {
  coreApi,
  getBusinessError,
  queryClient,
  sessionStore,
  useRequiredSession,
} from '@caiwu/web-kit';
import { visibleModules } from '../modules';
import { GlobalHotkeys } from './GlobalHotkeys';
import { NavMenu, buildNavItems } from './NavMenu';
import { TabsHost } from './TabsHost';
import { checkBeforeLeave } from './guards';
import { SearchDialog, ShortcutDialog, SessionMonitor } from './Tools';
import { loadAppearance, saveAppearance } from './preferences';
import './shell.css';

export function sessionIdentity(session: ReturnType<typeof sessionStore.get>) {
  return session
    ? JSON.stringify([
        session.token,
        session.bookId,
        session.user.id,
        session.user.isAdmin,
        [...session.user.permissions].sort(),
        session.book.product,
      ])
    : '';
}

/** 身份变化先撤销查询并清空缓存，再挂载新身份的页面。 */
export function Shell({ devMode }: { devMode: boolean }) {
  const session = useRequiredSession();
  const identity = sessionIdentity(session);
  const [ready, setReady] = useState('');
  useLayoutEffect(() => {
    void queryClient.cancelQueries();
    queryClient.clear();
    setReady(identity);
    let previous = identity;
    const unsubscribe = sessionStore.subscribe(() => {
      const next = sessionIdentity(sessionStore.get());
      if (next !== previous) {
        previous = next;
        void queryClient.cancelQueries();
        queryClient.clear();
      }
    });
    return () => {
      unsubscribe();
    };
  }, [identity]);
  return ready === identity ? (
    <ShellContent key={identity} devMode={devMode} />
  ) : (
    <Spin style={{ margin: 40 }} />
  );
}

function ShellContent({ devMode }: { devMode: boolean }) {
  const session = useRequiredSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [exitTarget, setExitTarget] = useState<'user' | 'book' | null>(null);
  const prefKey = `${session.bookId}.${session.user.id}`;
  const [appearance, setAppearance] = useState(() => loadAppearance(prefKey));
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const [recent, setRecent] = useState<string[]>([]);
  const me = useQuery({
    ...coreApi.auth.me.queryOptions(undefined, { trpc: { abortOnUnmount: true } }),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const logout = useMutation({ ...coreApi.auth.logout.mutationOptions(), meta: { silent: true } });
  const modules = useMemo(
    () => visibleModules(session.book.product, devMode),
    [session.book.product, devMode],
  );
  const navItems = useMemo(() => buildNavItems(modules, session.user), [modules, session.user]);
  const dark = appearance.theme === 'dark' || (appearance.theme === 'system' && systemDark);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => setSystemDark(media.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
  useEffect(() => {
    saveAppearance(prefKey, appearance);
  }, [appearance, prefKey]);
  useEffect(() => {
    const hit = navItems.find((i) => i.to.split('?')[0] === location.pathname);
    if (hit) setRecent((prev) => [hit.to, ...prev.filter((x) => x !== hit.to)].slice(0, 8));
    setSearch(false);
  }, [location.pathname, location.search, location.key, navItems]);
  useEffect(() => {
    if (!me.data || sessionStore.get()?.token !== session.token) return;
    if (
      JSON.stringify([me.data.user, me.data.book]) !== JSON.stringify([session.user, session.book])
    )
      sessionStore.set({ ...session, user: me.data.user, book: me.data.book });
  }, [me.data, session]);
  useEffect(() => {
    const invalidate = (error: unknown) => {
      if (
        getBusinessError(error)?.code === 'UNAUTHORIZED' &&
        sessionStore.get()?.token === session.token
      ) {
        sessionStore.set(null);
        void navigate(`/login/${encodeURIComponent(session.bookId)}`, { replace: true });
      }
    };
    const removeQuery = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') invalidate(event.action.error);
    });
    const removeMutation = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') invalidate(event.action.error);
    });
    return () => {
      removeQuery();
      removeMutation();
    };
  }, [navigate, session.token, session.bookId]);
  const onSearch = useCallback(() => setSearch(true), []);
  const onShortcuts = useCallback(() => setShortcuts(true), []);
  const onHelp = useCallback(() => {
    void navigate('/m/workbench/help');
  }, [navigate]);
  const exit = async () => {
    if (!checkBeforeLeave()) return;
    const target = exitTarget === 'user' ? `/login/${encodeURIComponent(session.bookId)}` : '/';
    // 先撤销并卸载旧页面；即使注销请求失败也不会恢复旧财务缓存。
    await queryClient.cancelQueries();
    try {
      await logout.mutateAsync();
    } catch {
      /* 本地清除仍然有效，服务端会话由其生命周期清理 */
    }
    if (sessionStore.get()?.token === session.token) sessionStore.set(null);
    queryClient.clear();
    void navigate(target, { replace: true });
  };
  return (
    <ConfigProvider
      getPopupContainer={(trigger) =>
        (trigger?.closest('.cw-shell-root') as HTMLElement | null) ?? document.body
      }
      theme={{
        algorithm: dark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
        token: {
          colorBgLayout: dark ? '#141414' : '#f5f6f8',
          colorBgContainer: dark ? '#1f1f1f' : '#fff',
        },
        components: {
          Layout: {
            headerBg: dark ? '#1f1f1f' : '#fff',
            siderBg: dark ? '#1f1f1f' : '#fff',
            bodyBg: dark ? '#141414' : '#f5f6f8',
          },
          Menu: { subMenuItemBg: dark ? '#1f1f1f' : '#fff' },
          Table: { headerBg: dark ? '#262626' : '#f7f8fa' },
        },
      }}
    >
      <div
        className="cw-shell-root"
        style={
          {
            zoom: appearance.scale / 100,
            height: `${10000 / appearance.scale}vh`,
            '--cw-scale': appearance.scale / 100,
            '--cw-surface': dark ? '#1f1f1f' : '#fff',
            '--cw-text': dark ? '#eee' : '#222',
            '--cw-border': dark ? '#424242' : '#eef0f3',
          } as React.CSSProperties
        }
      >
        <Layout style={{ height: '100%', minWidth: 0 }}>
          <Layout.Sider
            width={208}
            collapsedWidth={56}
            breakpoint="lg"
            collapsible
            collapsed={collapsed}
            onCollapse={setCollapsed}
            theme={dark ? 'dark' : 'light'}
            style={{ borderRight: '1px solid var(--cw-border)' }}
          >
            <div className="cw-brand" title={productName(session.book.product)}>
              {collapsed ? '财' : productName(session.book.product)}
            </div>
            <div style={{ height: 'calc(100% - 96px)', overflow: 'auto' }}>
              <NavMenu items={navItems} collapsed={collapsed} />
              {!collapsed && recent.length > 0 && (
                <div style={{ padding: 12 }}>
                  <Typography.Text type="secondary">最近功能</Typography.Text>
                  {recent.map((to) => {
                    const item = navItems.find((i) => i.to === to);
                    return item ? (
                      <Button
                        type="link"
                        key={to}
                        block
                        style={{ textAlign: 'left' }}
                        onClick={() => void navigate(to)}
                      >
                        {item.title}
                      </Button>
                    ) : null;
                  })}
                </div>
              )}
            </div>
          </Layout.Sider>
          <Layout style={{ minWidth: 0 }}>
            <Layout.Header className="cw-shell-header">
              <div className="cw-header-book">
                <Typography.Text strong ellipsis style={{ maxWidth: 260 }}>
                  {session.book.name}
                </Typography.Text>
                <Typography.Text
                  className="cw-header-secondary"
                  type="secondary"
                  ellipsis
                  style={{ maxWidth: 180 }}
                >
                  {session.book.orgName}
                </Typography.Text>
                {me.data?.currentPeriod && <Tag>{formatPeriod(me.data.currentPeriod.period)}</Tag>}
              </div>
              <div className="cw-header-actions">
                <Button onClick={onSearch}>搜索 Ctrl+K</Button>
                <Button onClick={onShortcuts}>快捷键 ?</Button>
                <Button onClick={onHelp}>帮助</Button>
                <Button onClick={() => setAppearanceOpen(true)}>界面</Button>
                <Dropdown
                  menu={{
                    items: [
                      { key: 'user', label: '切换用户 / 退出登录' },
                      { key: 'book', label: '切换账套' },
                    ],
                    onClick: ({ key }) => setExitTarget(key === 'user' ? 'user' : 'book'),
                  }}
                >
                  <Button type="text">
                    <Space>
                      <Avatar size="small" icon={<UserOutlined />} />
                      {session.user.name}
                    </Space>
                  </Button>
                </Dropdown>
              </div>
            </Layout.Header>
            <Layout.Content style={{ minHeight: 0, minWidth: 0 }}>
              <TabsHost navItems={navItems} devMode={devMode} />
            </Layout.Content>
          </Layout>
        </Layout>
        <SessionMonitor />
        <GlobalHotkeys
          navItems={navItems}
          onSearch={onSearch}
          onShortcuts={onShortcuts}
          onHelp={onHelp}
        />
        <SearchDialog open={search} onClose={() => setSearch(false)} />
        <ShortcutDialog open={shortcuts} onClose={() => setShortcuts(false)} items={navItems} />
        <Modal
          getContainer={false}
          title="界面偏好"
          open={appearanceOpen}
          onCancel={() => setAppearanceOpen(false)}
          footer={<Button onClick={() => setAppearanceOpen(false)}>完成</Button>}
        >
          <Space orientation="vertical" style={{ width: '100%' }}>
            <label>
              主题{' '}
              <Select
                aria-label="主题"
                value={appearance.theme}
                style={{ width: 180 }}
                options={[
                  { value: 'light', label: '明亮' },
                  { value: 'dark', label: '深色' },
                  { value: 'system', label: '跟随系统' },
                ]}
                onChange={(theme) => setAppearance({ ...appearance, theme })}
              />
            </label>
            <label>
              网页界面缩放{' '}
              <Select
                aria-label="网页界面缩放"
                value={appearance.scale}
                style={{ width: 180 }}
                options={[100, 125, 150].map((value) => ({ value, label: `${value}%` }))}
                onChange={(scale) => setAppearance({ ...appearance, scale })}
              />
            </label>
            <Button onClick={() => setAppearance({ theme: 'system', scale: 100 })}>恢复默认</Button>
            <p>仅影响当前用户的本机网页界面，不修改账套产品或桌面原生缩放。</p>
          </Space>
        </Modal>
        <Modal
          getContainer={false}
          title={exitTarget === 'book' ? '切换账套' : '切换用户 / 退出登录'}
          open={exitTarget !== null}
          onCancel={() => !logout.isPending && setExitTarget(null)}
          onOk={() => void exit()}
          confirmLoading={logout.isPending}
          okText="已保存内容，继续"
          cancelText="取消"
        >
          <p>请先保存所有表单。现有页面的离开保护会被检查；当前框架尚不能识别所有未保存内容。</p>
        </Modal>
      </div>
    </ConfigProvider>
  );
}
