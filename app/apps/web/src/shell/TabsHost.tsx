import { Button, Modal, Result, Spin, Tabs } from 'antd';
import {
  Component,
  Suspense,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import {
  NavigationType,
  UNSAFE_LocationContext,
  Route,
  Routes,
  useLocation,
  useNavigate,
  type Location,
} from 'react-router';
import { TabContext, useRequiredSession, type TabContextValue } from '@caiwu/web-kit';
import { loadWebModule, visibleModules } from '../modules';
import { checkBeforeLeave, routeAccess } from './guards';
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
  const exact = navItems.find((i) => i.to.split('?')[0] === pathname);
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
export function TabsHost({
  navItems,
  devMode,
  onWorkspaceChange,
}: {
  navItems: NavItem[];
  devMode: boolean;
  onWorkspaceChange?: (paths: string[]) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useRequiredSession();
  const activeKeyRef = useRef(location.pathname);
  const locationKeyRef = useRef(location.key);
  if (locationKeyRef.current !== location.key) {
    locationKeyRef.current = location.key;
    activeKeyRef.current = location.pathname;
  }
  const modules = visibleModules(session.book.product, devMode);
  const [closing, setClosing] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
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
    onWorkspaceChange?.(tabs.map((tab) => tab.key));
  }, [tabs, onWorkspaceChange]);

  useLayoutEffect(() => {
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
      if (prev.length >= MAX_TABS) return prev;
      const tab: TabState = {
        key: location.pathname,
        location,
        title: defaultTitle(location.pathname, navItems),
        customTitle: false,
      };
      return [...prev, tab];
    });
  }, [location, navigate, navItems]);

  const activeKey = location.pathname;
  useEffect(() => {
    if (tabs.length >= MAX_TABS && !tabs.some((t) => t.key === activeKey)) {
      setLimitReached(true);
      const last = tabs.at(-1)!;
      void navigate(last.location.pathname + last.location.search + last.location.hash, {
        replace: true,
      });
    }
  }, [activeKey, tabs, navigate]);

  const close = useCallback(
    (key: string) => {
      if (key === HOME || !checkBeforeLeave()) return;
      const prev = tabsRef.current;
      const idx = prev.findIndex((t) => t.key === key);
      const next = prev.filter((t) => t.key !== key);
      tabsRef.current = next;
      setTabs(next);
      if (key === activeKeyRef.current) {
        const neighbor = next[Math.max(0, idx - 1)] ?? next[0];
        activeKeyRef.current = neighbor?.key ?? HOME;
        void navigate(
          neighbor
            ? neighbor.location.pathname + neighbor.location.search + neighbor.location.hash
            : HOME,
        );
      }
    },
    [navigate],
  );

  const setTitle = useCallback((key: string, title: string) => {
    setTabs((prev) =>
      prev.some((t) => t.key === key && t.title !== title)
        ? prev.map((t) => (t.key === key ? { ...t, title, customTitle: true } : t))
        : prev,
    );
  }, []);

  const setDefaultTitle = useCallback((key: string, title: string) => {
    setTabs((prev) =>
      prev.some((t) => t.key === key && !t.customTitle && t.title !== title)
        ? prev.map((t) => (t.key === key && !t.customTitle ? { ...t, title } : t))
        : prev,
    );
  }, []);

  const closeRef = useRef(close);
  closeRef.current = close;

  // 监听器只注册一次；点击意图与当前回调通过ref同步，避免读取上一标签的闭包。
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (
        !e.defaultPrevented &&
        !e.isComposing &&
        e.keyCode !== 229 &&
        e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        e.key === 'F4'
      ) {
        e.preventDefault();
        const current = activeKeyRef.current;
        if (current !== HOME) closeRef.current(current);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const ordered = useMemo(() => {
    const home = tabs.find((t) => t.key === HOME);
    return home ? [home, ...tabs.filter((t) => t.key !== HOME)] : tabs;
  }, [tabs]);

  return (
    <>
      <Tabs
        className="cw-tabs"
        type="editable-card"
        hideAdd
        size="small"
        activeKey={activeKey}
        onChange={(key) => {
          const t = tabs.find((x) => x.key === key);
          if (t) {
            activeKeyRef.current = key;
            void navigate(t.location.pathname + t.location.search + t.location.hash);
          }
        }}
        onEdit={(key, action) => {
          if (action === 'remove' && typeof key === 'string') close(key);
        }}
        tabBarExtraContent={
          <Button size="small" onClick={() => setClosing(true)}>
            关闭所有
          </Button>
        }
        items={ordered.map((t) => ({
          key: t.key,
          label: t.title,
          closable: t.key !== HOME,
          children: (
            <TabPane
              tab={t.key === activeKey ? { ...t, location } : t}
              active={t.key === activeKey}
              devMode={devMode}
              setTitle={setTitle}
              setDefaultTitle={setDefaultTitle}
              close={close}
              access={routeAccess(t.key, modules, navItems, session.user)}
            />
          ),
        }))}
      />
      <Modal
        getContainer={false}
        title="关闭所有标签"
        open={closing}
        onCancel={() => setClosing(false)}
        okText="已保存内容，关闭"
        cancelText="取消"
        onOk={() => {
          if (!checkBeforeLeave()) return;
          activeKeyRef.current = HOME;
          setTabs((prev) => prev.filter((t) => t.key === HOME));
          void navigate(HOME);
          setClosing(false);
        }}
      >
        <p>请先保存表单。已有页面的离开保护会被检查；当前框架尚不能判断所有未保存内容。</p>
      </Modal>
      <Modal
        getContainer={false}
        title="标签数量已达上限"
        open={limitReached}
        footer={<Button onClick={() => setLimitReached(false)}>知道了</Button>}
        onCancel={() => setLimitReached(false)}
      >
        <p>最多同时打开20个标签。请先保存并关闭一些标签后再打开新功能；现有页面已保留。</p>
      </Modal>
    </>
  );
}

function TabPane({
  tab,
  active,
  devMode,
  setTitle,
  setDefaultTitle,
  close,
  access,
}: {
  tab: TabState;
  active: boolean;
  devMode: boolean;
  setTitle: (key: string, title: string) => void;
  setDefaultTitle: (key: string, title: string) => void;
  close: (key: string) => void;
  access: 'allow' | 'denied' | 'missing';
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
  const onTitle = useCallback(
    (title: string) => setDefaultTitle(tab.key, title),
    [setDefaultTitle, tab.key],
  );
  return (
    <UNSAFE_LocationContext.Provider
      value={{ location: tab.location, navigationType: NavigationType.Pop }}
    >
      <TabContext.Provider value={ctx}>
        <PageErrorBoundary>
          <Suspense fallback={<Spin style={{ display: 'block', margin: 48 }} />}>
            {access === 'missing' ? (
              <NotFound />
            ) : access === 'denied' ? (
              <Result
                status="403"
                title="无权访问此页面"
                subTitle="当前菜单未授权，或嵌套路由尚无明确权限映射。请联系管理员检查权限。"
              />
            ) : tab.key === HOME ? (
              <EntryPage kind="home" devMode={devMode} fallback={<HomePage />} />
            ) : (
              <ModuleOutlet location={tab.location} onTitle={onTitle} />
            )}
          </Suspense>
        </PageErrorBoundary>
      </TabContext.Provider>
    </UNSAFE_LocationContext.Provider>
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
    <Routes>
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
