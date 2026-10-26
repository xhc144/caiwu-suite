import { Avatar, Button, Dropdown, Layout, Space, Tag, Tooltip, Typography } from 'antd';
import { LogoutOutlined, SwapOutlined, UserOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { formatPeriod, productName } from '@caiwu/core';
import { coreApi, sessionStore, useRequiredSession } from '@caiwu/web-kit';
import { visibleModules } from '../modules';
import { GlobalHotkeys } from './GlobalHotkeys';
import { NavMenu, buildNavItems } from './NavMenu';
import { TabsHost } from './TabsHost';

/** 登录后的主界面：左侧导航 + 顶部账套信息 + 多标签页工作区。 */
export function Shell({ devMode }: { devMode: boolean }) {
  const session = useRequiredSession();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const me = useQuery(coreApi.auth.me.queryOptions());
  const logout = useMutation({
    ...coreApi.auth.logout.mutationOptions(),
    meta: { silent: true },
    onSettled: () => {
      sessionStore.set(null);
      void navigate('/', { replace: true });
    },
  });

  const modules = useMemo(
    () => visibleModules(session.book.product, devMode),
    [session.book.product, devMode],
  );
  const navItems = useMemo(() => buildNavItems(modules, session.user), [modules, session.user]);
  const period = me.data?.currentPeriod;

  return (
    <Layout style={{ height: '100vh' }}>
      <Layout.Sider
        width={208}
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme="light"
        style={{ borderRight: '1px solid #eef0f3' }}
      >
        <div className="cw-brand" title={productName(session.book.product)}>
          {collapsed ? '财' : productName(session.book.product)}
        </div>
        <div style={{ height: 'calc(100% - 48px)', overflow: 'auto' }}>
          <NavMenu items={navItems} collapsed={collapsed} />
        </div>
      </Layout.Sider>
      <Layout>
        <Layout.Header className="cw-shell-header">
          <Space size={12} align="center" style={{ minWidth: 0 }}>
            <Typography.Text strong ellipsis style={{ maxWidth: 360 }}>
              {session.book.name}
            </Typography.Text>
            <Typography.Text type="secondary" ellipsis style={{ maxWidth: 260 }}>
              {session.book.orgName}
            </Typography.Text>
            {period && (
              <Tooltip title="当前工作期间（最早的未结账月份）">
                <Tag color={period.status === 'closed' ? 'default' : 'blue'}>
                  {formatPeriod(period.period)}
                </Tag>
              </Tooltip>
            )}
            <Tag>{session.book.templateName}</Tag>
          </Space>
          <Space>
            <Dropdown
              menu={{
                items: [
                  { key: 'switch', icon: <SwapOutlined />, label: '切换账套' },
                  { key: 'logout', icon: <LogoutOutlined />, label: '退出登录' },
                ],
                onClick: () => logout.mutate(),
              }}
            >
              <Button type="text">
                <Space>
                  <Avatar size="small" icon={<UserOutlined />} />
                  {session.user.name}
                </Space>
              </Button>
            </Dropdown>
          </Space>
        </Layout.Header>
        <Layout.Content style={{ minHeight: 0 }}>
          <TabsHost navItems={navItems} devMode={devMode} />
        </Layout.Content>
      </Layout>
      <GlobalHotkeys navItems={navItems} />
    </Layout>
  );
}
