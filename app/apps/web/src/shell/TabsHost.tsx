import { Button, Result, Spin, Tabs } from 'antd';
import {
  Component,
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { Route, Routes, useLocation, useNavigate, type Location } from 'react-router';
import { TabContext, useHotkey, type TabContextValue } from '@caiwu/web-kit';
import { loadWebModule } from '../modules';
import { EntryPage } from './EntryPage';
import { HomePage } from './HomePage';
import type { NavItem } from './NavMenu';

interface TabState {
  /** 标签页的键 = 路径（不含查询参数）。同一路径只开一个标签，参数变化时更新它。 */
  key: string;
  location: Location;
  title: string;
  /** 页面自己设置过标题后，不再用默认标题覆盖 */
  customTitle: boolean;
}

const HOME = '/home';
const MAX_TABS = 20;

function isTabPath(pathname: string) {
  return pathname === HOME || pathname.startsWith('/m/');
}

function defaultTitle(pathname: string, navItems: NavItem[]) {
  if (pathname === HOME) return '首页';
  const exact = navItems.find((i) => i.to === pathname);
  if (exact) return exact.title;
  const prefix = navItems
    .filter((i) => pathname.startsWith(`${i.to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0];
  return prefix?.title ?? '加载中…';
}

/**
 * 多标签页工作区。每个标签页里的页面保持状态（切走再切回不丢输入），
 * 页面拿到的 location 是自己标签页的（useSearchParams 等照常用）。
 */
export function TabsHost({ navItems, devMode }: { navItems: NavItem[]; devMode: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  // 首页标签始终存在，且不能关闭
  const [tabs, setTabs] = useState<TabState[]>(() => [
    {
      key: HOME,
      location: { pathname: HOME, search: '', hash: '', state: null, key: 'home' },
      title: '首页',
      customTitle: true,
    },
  ]);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  useEffect(() => {
    if (!isTabPath(location.pathname)) {
      void navigate(HOME, { replace: true });
      return;
    }
    setTabs((prev) => {
      const i = prev.findIndex((t) => t.key === location.pathname);
      if (i >= 0) {
        if (prev[i]!.location === location) return prev;
        const next = [...prev];
        next[i] = { ...prev[i]!, location };
        return next;
      }
      const tab: TabState = {
        key: location.pathname,
        location,
        title: defaultTitle(location.pathname, navItems),
        customTitle: false,
      };
      const next = [...prev, tab];
      if (next.length <= MAX_TABS) return next;
      // 标签太多时关掉最早打开的一个（首页除外）
      const oldest = next.findIndex((t) => t.key !== HOME);
      return next.filter((_, idx) => idx !== oldest);
    });
  }, [location, navigate, navItems]);

  const activeKey = location.pathname;

  const close = useCallback(
    (key: string) => {
      if (key === HOME) return;
      const prev = tabsRef.current;
      const idx = prev.findIndex((t) => t.key === key);
      const next = prev.filter((t) => t.key !== key);
      setTabs(next);
      if (key === activeKey) {
        const neighbor = next[Math.max(0, idx - 1)] ?? next[0];
        void navigate(neighbor ? neighbor.location.pathname + neighbor.location.search : HOME);
      }
    },
    [activeKey, navigate],
  );

  const setTitle = useCallback((key: string, title: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.key === key && t.title !== title ? { ...t, title, customTitle: true } : t,
      ),
    );
  }, []);

  const setDefaultTitle = useCallback((key: string, title: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.key === key && !t.customTitle && t.title !== title ? { ...t, title } : t)),
    );
  }, []);

  // 原版快捷键：Ctrl+F4 关闭当前窗口
  useHotkey('Ctrl+F4', () => close(activeKey), { global: true });

  const ordered = useMemo(() => {
    const home = tabs.find((t) => t.key === HOME);
    return home ? [home, ...tabs.filter((t) => t.key !== HOME)] : tabs;
  }, [tabs]);

  return (
    <Tabs
      className="cw-tabs"
      type="editable-card"
      hideAdd
      size="small"
      activeKey={activeKey}
      onChange={(key) => {
        const t = tabs.find((x) => x.key === key);
        if (t) void navigate(t.location.pathname + t.location.search);
      }}
      onEdit={(key, action) => {
        if (action === 'remove' && typeof key === 'string') close(key);
      }}
      items={ordered.map((t) => ({
        key: t.key,
        label: t.title,
        closable: t.key !== HOME,
        children: (
          <TabPane
            tab={t}
            active={t.key === activeKey}
            devMode={devMode}
            setTitle={setTitle}
            setDefaultTitle={setDefaultTitle}
            close={close}
          />
        ),
      }))}
    />
  );
}

function TabPane({
  tab,
  active,
  devMode,
  setTitle,
  setDefaultTitle,
  close,
}: {
  tab: TabState;
  active: boolean;
  devMode: boolean;
  setTitle: (key: string, title: string) => void;
  setDefaultTitle: (key: string, title: string) => void;
  close: (key: string) => void;
}) {
  const ctx = useMemo<TabContextValue>(
    () => ({
      key: tab.key,
      active,
      setTitle: (title) => setTitle(tab.key, title),
      close: () => close(tab.key),
    }),
    [tab.key, active, setTitle, close],
  );
  return (
    <TabContext.Provider value={ctx}>
      <PageErrorBoundary>
        <Suspense fallback={<Spin style={{ display: 'block', margin: 48 }} />}>
          {tab.key === HOME ? (
            <EntryPage kind="home" devMode={devMode} fallback={<HomePage />} />
          ) : (
            <ModuleOutlet
              location={tab.location}
              onTitle={(title) => setDefaultTitle(tab.key, title)}
            />
          )}
        </Suspense>
      </PageErrorBoundary>
    </TabContext.Provider>
  );
}

function ModuleOutlet({
  location,
  onTitle,
}: {
  location: Location;
  onTitle: (title: string) => void;
}) {
  const moduleId = location.pathname.split('/')[2] ?? '';
  const mod = use(loadWebModule(moduleId));
  if (!mod) return <NotFound />;
  const base = `/m/${moduleId}`;
  return (
    <Routes location={location}>
      {mod.routes.map((r) => {
        const Page = r.component;
        return (
          <Route
            key={r.path}
            path={r.path === '/' ? base : `${base}${r.path}`}
            element={
              <TitleOnMount title={r.title} onTitle={onTitle}>
                <Page />
              </TitleOnMount>
            }
          />
        );
      })}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function TitleOnMount({
  title,
  onTitle,
  children,
}: {
  title: string;
  onTitle: (t: string) => void;
  children: ReactNode;
}) {
  useEffect(() => onTitle(title), [title, onTitle]);
  return <>{children}</>;
}

function NotFound() {
  const navigate = useNavigate();
  return (
    <Result
      status="404"
      title="页面不存在"
      subTitle="这个功能可能还没有做，或者当前产品形态里没有这个模块。"
      extra={<Button onClick={() => void navigate(HOME)}>回到首页</Button>}
    />
  );
}

class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }
  override render() {
    if (this.state.error) {
      return (
        <Result
          status="error"
          title="页面出错了"
          subTitle={this.state.error.message}
          extra={<Button onClick={() => this.setState({ error: null })}>重新加载这个页面</Button>}
        />
      );
    }
    return this.props.children;
  }
}
