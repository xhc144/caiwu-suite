import { Menu, Typography, type MenuProps } from 'antd';
import {
  AccountBookOutlined,
  BarChartOutlined,
  BookOutlined,
  CalculatorOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  FundOutlined,
  HddOutlined,
  HomeOutlined,
  InboxOutlined,
  LockOutlined,
  SettingOutlined,
  TeamOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
  /** 模块及菜单声明顺序，order 相同时用它保持清单里的业务顺序 */
  seq: number;
}

/** 从模块清单生成导航项：按产品形态、开发模式（已在外层过滤）和权限过滤。 */
export function buildNavItems(modules: ModuleManifest[], user: CurrentUser): NavItem[] {
  const can = (perm?: string) => !perm || user.isAdmin || user.permissions.includes(perm);
  return modules.flatMap((m, moduleIndex) =>
    m.menu
      .map((item, itemIndex) => ({ item, seq: moduleIndex * 1000 + itemIndex }))
      .filter(
        ({ item }) =>
          can(item.permission) && (!isAdminEntry(item.title, item.path) || user.isAdmin),
      )
      .map(({ item, seq }) => {
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
          seq,
        };
      }),
  );
}

/**
 * 按分组整理导航：组内按 order，再按清单声明顺序（不按拼音），
 * 保证"凭证录入""总分类账"这类常用功能排在前面。
 */
export function groupNavItems(items: NavItem[]) {
  return MENU_GROUPS.map((g) => ({
    group: g,
    items: items
      .filter((i) => i.groupId === g.id)
      .sort((a, b) => a.order - b.order || a.seq - b.seq),
  })).filter((g) => g.items.length);
}

/** 分组图标。图标不参与可访问名称（aria-hidden），菜单项名称仍是纯文字。 */
const GROUP_ICONS: Record<string, ReactNode> = {
  voucher: <FileTextOutlined aria-hidden />,
  ledger: <BookOutlined aria-hidden />,
  report: <BarChartOutlined aria-hidden />,
  period: <LockOutlined aria-hidden />,
  cashier: <WalletOutlined aria-hidden />,
  invoice: <AccountBookOutlined aria-hidden />,
  payroll: <TeamOutlined aria-hidden />,
  asset: <HddOutlined aria-hidden />,
  inventory: <InboxOutlined aria-hidden />,
  costing: <CalculatorOutlined aria-hidden />,
  analysis: <FundOutlined aria-hidden />,
  master: <DatabaseOutlined aria-hidden />,
  system: <SettingOutlined aria-hidden />,
  dev: <ExperimentOutlined aria-hidden />,
};

/** order 的百位表示同一分组里的一档（日常、辅助、设置……），换档处加分隔线。 */
export const navTier = (order: number) => Math.floor(order / 100);

const OPEN_GROUPS_KEY = 'caiwu.ui.nav-open-groups';
function loadOpenGroups(): string[] | null {
  try {
    const raw = JSON.parse(localStorage.getItem(OPEN_GROUPS_KEY) ?? 'null') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}
function saveOpenGroups(keys: string[]) {
  try {
    localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(keys));
  } catch {
    /* 内存中仍可使用 */
  }
}

export function NavMenu({ items, collapsed }: { items: NavItem[]; collapsed: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const groups = useMemo(() => groupNavItems(items), [items]);
  const selected = selectedNavKey(items, location.pathname);
  const currentGroup = items.find((i) => i.key === selected)?.groupId;
  // 默认全部展开；用户收起或展开的分组记在本机，打开某个功能时自动展开它所在的分组。
  const [openKeys, setOpenKeys] = useState<string[]>(
    () => loadOpenGroups() ?? groups.map((g) => `group:${g.group.id}`),
  );
  useEffect(() => {
    if (!currentGroup) return;
    const key = `group:${currentGroup}`;
    setOpenKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
  }, [currentGroup]);

  const menuItems: MenuProps['items'] = [
    { key: '/home', label: '首页', icon: <HomeOutlined aria-hidden /> },
    ...groups.map(({ group, items: list }) => ({
      key: `group:${group.id}`,
      label: group.title,
      icon: GROUP_ICONS[group.id],
      children: list.flatMap((i, index) => {
        const entry = {
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
        };
        const previous = list[index - 1];
        return previous && navTier(previous.order) !== navTier(i.order)
          ? [{ type: 'divider' as const, key: `divider:${i.key}` }, entry]
          : [entry];
      }),
    })),
  ];
  return (
    <Menu
      className="cw-nav-menu"
      mode="inline"
      items={menuItems}
      selectedKeys={[selected]}
      openKeys={collapsed ? undefined : openKeys}
      onOpenChange={(keys) => {
        setOpenKeys(keys);
        saveOpenGroups(keys);
      }}
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
