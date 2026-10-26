import { Menu, Typography, type MenuProps } from 'antd';
import { useLocation, useNavigate } from 'react-router';
import { MENU_GROUPS, moduleRoute, type CurrentUser, type ModuleManifest } from '@caiwu/core';
import { isAdminEntry } from './guards';
import { tabPath } from './paths';

export interface NavItem {
  key: string;
  moduleId: string;
  groupId: string;
  title: string;
  /** 完整路由 /m/<id><path> */
  to: string;
  shortcut?: string;
  keywords: string[];
  order: number;
}

/** 从模块清单生成导航项：按产品形态、开发模式（已在外层过滤）和权限过滤。 */
export function buildNavItems(modules: ModuleManifest[], user: CurrentUser): NavItem[] {
  const can = (perm?: string) => !perm || user.isAdmin || user.permissions.includes(perm);
  return modules.flatMap((m) =>
    m.menu
      .filter(
        (item) => can(item.permission) && (!isAdminEntry(item.title, item.path) || user.isAdmin),
      )
      .map((item) => {
        const to = moduleRoute(m.id, item.path);
        return {
          key: to,
          moduleId: m.id,
          groupId: item.group,
          title: item.title,
          to,
          shortcut: item.shortcut,
          keywords: item.keywords,
          order: item.order,
        };
      }),
  );
}

export function NavMenu({ items, collapsed }: { items: NavItem[]; collapsed: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const groups = MENU_GROUPS.map((g) => ({
    group: g,
    items: items
      .filter((i) => i.groupId === g.id)
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)),
  })).filter((g) => g.items.length);

  const menuItems: MenuProps['items'] = [
    { key: '/home', label: '首页' },
    ...groups.map(({ group, items: list }) => ({
      key: `group:${group.id}`,
      label: group.title,
      children: list.map((i) => ({
        key: i.key,
        label: (
          <span title={i.shortcut ? `${i.title}（${i.shortcut}）` : i.title}>
            {i.title}
            {i.shortcut && !collapsed && (
              <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                {i.shortcut}
              </Typography.Text>
            )}
          </span>
        ),
      })),
    })),
  ];
  const selected = selectedNavKey(items, location.pathname);
  return (
    <Menu
      mode="inline"
      items={menuItems}
      selectedKeys={[selected]}
      defaultOpenKeys={groups.map((g) => `group:${g.group.id}`)}
      onClick={(e) => void navigate(e.key)}
      style={{ borderInlineEnd: 'none' }}
    />
  );
}

export function selectedNavKey(items: NavItem[], pathname: string) {
  pathname = tabPath(pathname);
  const exact = items.find((i) => tabPath(i.to.split('?')[0]!) === pathname);
  if (exact) return exact.key;
  return (
    [...items]
      .sort((a, b) => b.to.split('?')[0]!.length - a.to.split('?')[0]!.length)
      .find((i) => pathname.startsWith(`${tabPath(i.to.split('?')[0]!)}/`))?.key ?? pathname
  );
}
