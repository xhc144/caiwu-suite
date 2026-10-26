import { describe, expect, it } from 'vitest';
import { defineManifest, type CurrentUser } from '@caiwu/core';
import { buildNavItems, selectedNavKey } from './NavMenu';
import { routeAccess } from './guards';
const user: CurrentUser = {
  id: 2,
  code: 'MANAGER',
  name: 'MANAGER',
  isAdmin: false,
  permissions: ['system-admin.users.view'],
};
const manifest = defineManifest({
  id: 'system-admin',
  name: '系统',
  products: 'all',
  permissions: [
    { id: 'system-admin.users.view', name: '查看用户' },
    { id: 'system-admin.profile.view', name: '查看资料' },
  ],
  menu: [
    { group: 'system', title: '用户管理', path: '/users', permission: 'system-admin.users.view' },
    {
      group: 'system',
      title: '个人资料',
      path: '/profile',
      permission: 'system-admin.profile.view',
    },
  ],
});
describe('w_main1 导航权限', () => {
  it('非管理员即使名叫MANAGER也不出现操作员和账套管理', () => {
    expect(buildNavItems([manifest], user)).toEqual([]);
    expect(buildNavItems([manifest], { ...user, isAdmin: true })).toHaveLength(2);
    expect(routeAccess('/m/system-admin/users', [manifest], [], user)).toBe('denied');
  });
  it('直接URL/历史页校验明确菜单权限；不从根菜单推测嵌套权限', () => {
    const items = buildNavItems([manifest], {
      ...user,
      permissions: ['system-admin.profile.view'],
    });
    expect(routeAccess('/m/system-admin/profile', [manifest], items, user)).toBe('allow');
    expect(routeAccess('/m/system-admin/profile/edit', [manifest], items, user)).toBe('denied');
    expect(routeAccess('/m/absent', [], [], user)).toBe('missing');
    expect(routeAccess('/home', [], [], user)).toBe('allow');
  });
  it('w_main1 删除的移动端/加密狗/注册入口不由壳生成', () => {
    expect(buildNavItems([], user)).toEqual([]);
    expect(
      buildNavItems([manifest], { ...user, isAdmin: true })
        .map((i) => i.title)
        .join(' '),
    ).not.toMatch(/移动端|加密狗|注册|云报表/);
  });
  it('根路由query和尾斜杠保持同页授权，嵌套业务路径仍单独校验', () => {
    const root = defineManifest({
      id: 'fixture',
      name: '根页',
      products: 'all',
      permissions: [{ id: 'fixture.view', name: '查看' }],
      menu: [
        {
          group: 'master',
          title: '项目页',
          path: '/?dimension=project',
          permission: 'fixture.view',
        },
      ],
    });
    const allowed = { ...user, permissions: ['fixture.view'] };
    const items = buildNavItems([root], allowed);
    expect(routeAccess('/m/fixture', [root], items, allowed)).toBe('allow');
    expect(routeAccess('/m/fixture/', [root], items, allowed)).toBe('allow');
    expect(routeAccess('/m/fixture/edit', [root], items, allowed)).toBe('denied');
    expect(routeAccess('/m/fixture/', [root], buildNavItems([root], user), user)).toBe('denied');
    expect(selectedNavKey(items, '/m/fixture')).toBe('/m/fixture/?dimension=project');
  });
});

it('余额表子页优先精确路径或最长前缀，不被根菜单抢占', () => {
  const balances = defineManifest({
    id: 'balances',
    name: '余额',
    products: 'all',
    menu: [
      { group: 'ledger', title: '余额表', path: '/' },
      { group: 'ledger', title: '外币余额表', path: '/foreign' },
    ],
  });
  const items = buildNavItems([balances], { ...user, isAdmin: true });
  expect(selectedNavKey(items, '/m/balances/foreign')).toBe('/m/balances/foreign');
  expect(selectedNavKey(items, '/m/balances/foreign/details')).toBe('/m/balances/foreign');
  expect(selectedNavKey(items, '/m/balances')).toBe('/m/balances');
});
