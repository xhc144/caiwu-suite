import { Button, Modal, Result, Skeleton, Tabs } from 'antd';
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
  UNSAFE_NavigationContext,
  Route,
  Routes,
  useLocation,
  useNavigate,
  type Location,
  type Navigator,
} from 'react-router';
import {
  TabContext,
  unsavedPages,
  useRequiredSession,
  resetWebModuleRoutes,
  type TabContextValue,
} from '@caiwu/web-kit';
import { loadWebModule, visibleModules } from '../modules';
import { requestBeforeLeave, routeAccess } from './guards';
import { EntryPage } from './EntryPage';
import { HomePage } from './HomePage';
import type { NavItem } from './NavMenu';
import { tabPath } from './paths';

interface TabState {
  /** 标签键为去掉尾斜杠的路径。查询参数仍保留在location，同一路由只开一个标签。 */
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

// BrowserRouter/MemoryRouter使用的history都提供当前location；不修改全局history。
function navigationLocation(navigator: Navigator) {
  return (navigator as Navigator & { readonly location?: Location }).location;
}

function defaultTitle(pathname: string, navItems: NavItem[]) {
  if (pathname === HOME) return '首页';
  const exact = navItems.find((i) => tabPath(i.to.split('?')[0]!) === pathname);
  if (exact) return exact.title;
  const prefix = navItems
    .filter((i) => pathname.startsWith(`${tabPath(i.to.split('?')[0]!)}/`))
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
  const navigation = use(UNSAFE_NavigationContext);
  const session = useRequiredSession();
  const activeKeyRef = useRef(tabPath(location.pathname));
  const locationRef = useRef(location);
  // 点击/关闭先显示所选标签；路由的transition提交后由真实location接管。
  const [selection, setSelection] = useState<{ from: Location; to: Location } | null>(null);
  const historyLocation = navigationLocation(navigation.navigator);
  const pendingCommit =
    !!selection &&
    (historyLocation ? location.key !== historyLocation.key : selection.from === location);
  const candidateLocation = selection && pendingCommit ? selection.to : location;
  const candidateKey = tabPath(candidateLocation.pathname);
  const [approvedNavigation, setApprovedNavigation] = useState<string | null>(null);
  const modules = visibleModules(session.book.product, devMode);
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
  const priorTab = tabs.find((tab) => tab.key === candidateKey);
  const needsRouteConfirmation =
    !!priorTab &&
    priorTab.location.key !== candidateLocation.key &&
    (priorTab.location.search !== candidateLocation.search ||
      priorTab.location.hash !== candidateLocation.hash) &&
    unsavedPages.dirty(session.bookId, [candidateKey]).length > 0;
  const routeHeld = needsRouteConfirmation && approvedNavigation !== candidateLocation.key;
  const activeLocation = routeHeld ? priorTab!.location : candidateLocation;
  const activeKey = tabPath(activeLocation.pathname);
  // 标签与路由在同一次render里对齐，POP即使回到刚关闭的地址也会重建页面。
  // 不能只监听location的effect：关闭本身也会改变标签集合。
  const currentTab = tabs.find((tab) => tab.key === activeKey);
  if (isTabPath(activeKey) && currentTab?.location !== activeLocation) {
    if (currentTab) {
      setTabs(
        tabs.map((tab) => (tab.key === activeKey ? { ...tab, location: activeLocation } : tab)),
      );
    } else if (tabs.length < MAX_TABS) {
      setTabs([
        ...tabs,
        {
          key: activeKey,
          location: activeLocation,
          title: defaultTitle(activeKey, navItems),
          customTitle: false,
        },
      ]);
    }
  }
  const tabsRef = useRef(tabs);
  useLayoutEffect(() => {
    tabsRef.current = tabs;
    locationRef.current = location;
    activeKeyRef.current = activeKey;
  });
  useLayoutEffect(() => {
    if (selection && !pendingCommit) {
      setSelection((latest) => (latest === selection ? null : latest));
    }
  }, [selection, pendingCommit]);
  const syncNavigation = useCallback(
    (fallback?: Location) => {
      const target = navigationLocation(navigation.navigator) ?? fallback;
      if (target && isTabPath(tabPath(target.pathname))) {
        activeKeyRef.current = tabPath(target.pathname);
        setSelection({ from: locationRef.current, to: target });
      }
    },
    [navigation.navigator],
  );
  // 模块的筛选/跳转也记录同一导航意图。地址先变、Router transition晚提交时，
  // 活动页立即取得最新query；更早的commit不能重建表单并覆盖后续输入。
  const moduleNavigation = useMemo(
    () => ({
      ...navigation,
      navigator: {
        ...navigation.navigator,
        push: (...args: Parameters<Navigator['push']>) => {
          navigation.navigator.push(...args);
          syncNavigation();
        },
        replace: (...args: Parameters<Navigator['replace']>) => {
          navigation.navigator.replace(...args);
          syncNavigation();
        },
      },
    }),
    [navigation, syncNavigation],
  );
  useEffect(() => {
    onWorkspaceChange?.(tabs.map((tab) => tab.key));
  }, [tabs, onWorkspaceChange]);

  useLayoutEffect(() => {
    if (!isTabPath(tabPath(location.pathname))) {
      void navigate(HOME, { replace: true });
      syncNavigation();
    }
  }, [location.pathname, navigate, syncNavigation]);

  useEffect(() => {
    if (tabs.length >= MAX_TABS && !tabs.some((t) => t.key === activeKey)) {
      setLimitReached(true);
      const last = tabs.at(-1)!;
      void navigate(last.location.pathname + last.location.search + last.location.hash, {
        replace: true,
      });
      syncNavigation(last.location);
    }
  }, [activeKey, tabs, navigate, syncNavigation]);

  useEffect(() => {
    if (!routeHeld || !priorTab) return;
    let current = true;
    void requestBeforeLeave(session.bookId, [candidateKey]).then((accepted) => {
      if (!current) return;
      if (accepted) setApprovedNavigation(candidateLocation.key);
      else {
        void navigate(
          priorTab.location.pathname + priorTab.location.search + priorTab.location.hash,
          { replace: true },
        );
        syncNavigation(priorTab.location);
      }
    });
    return () => {
      current = false;
    };
  }, [
    routeHeld,
    priorTab,
    candidateKey,
    candidateLocation.key,
    session.bookId,
    navigate,
    syncNavigation,
  ]);

  const close = useCallback(
    async (key: string) => {
      const requested = tabsRef.current.find((tab) => tab.key === key);
      if (key === HOME || !requested || !(await requestBeforeLeave(session.bookId, [key]))) return;
      if (tabsRef.current.find((tab) => tab.key === key)?.location.key !== requested.location.key)
        return;
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
        syncNavigation(neighbor?.location);
      }
    },
    [navigate, syncNavigation, session.bookId],
  );

  const closeAll = async () => {
    const requested = tabsRef.current.map((tab) => [tab.key, tab.location.key]);
    if (
      !(await requestBeforeLeave(
        session.bookId,
        tabsRef.current.map((t) => t.key),
      ))
    )
      return;
    if (
      JSON.stringify(requested) !==
      JSON.stringify(tabsRef.current.map((tab) => [tab.key, tab.location.key]))
    )
      return;
    activeKeyRef.current = HOME;
    const home = tabsRef.current.find((t) => t.key === HOME)!;
    tabsRef.current = [home];
    setTabs([home]);
    void navigate(HOME);
    syncNavigation(home.location);
  };

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
  useLayoutEffect(() => {
    closeRef.current = close;
  }, [close]);

  // 监听器只注册一次；点击意图与当前回调通过ref同步，避免读取上一标签的闭包。
  useEffect(() => {
    // POP可以在关闭导航的transition提交前回到原地址，Router会复用原location。
    // 历史操作必须撤销点击意图，否则同一location会继续显示关闭后的邻页。
    const onPop = () => setSelection(null);
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
        if (current !== HOME) void closeRef.current(current);
      }
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', listener);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', listener);
    };
  }, []);

  const ordered = useMemo(() => {
    const home = tabs.find((t) => t.key === HOME);
    return home ? [home, ...tabs.filter((t) => t.key !== HOME)] : tabs;
  }, [tabs]);

  return (
    <UNSAFE_NavigationContext.Provider value={moduleNavigation}>
      <Tabs
        className="cw-tabs"
        type="editable-card"
        hideAdd
        size="small"
        activeKey={activeKey}
        onChange={(key) => {
          const t = tabsRef.current.find((x) => x.key === key);
          if (t) {
            activeKeyRef.current = key;
            void navigate(t.location.pathname + t.location.search + t.location.hash);
            syncNavigation(t.location);
          }
        }}
        onEdit={(key, action) => {
          if (action === 'remove' && typeof key === 'string') void close(key);
        }}
        tabBarExtraContent={
          <Button size="small" onClick={() => void closeAll()}>
            关闭所有
          </Button>
        }
        items={ordered.map((t) => ({
          key: t.key,
          label: t.title,
          closable: t.key !== HOME,
          children: (
            <TabPane
              tab={t.key === activeKey ? { ...t, location: activeLocation } : t}
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
        title="标签数量已达上限"
        open={limitReached}
        footer={<Button onClick={() => setLimitReached(false)}>知道了</Button>}
        onCancel={() => setLimitReached(false)}
      >
        <p>最多同时打开20个标签。请先保存并关闭一些标签后再打开新功能；现有页面已保留。</p>
      </Modal>
    </UNSAFE_NavigationContext.Provider>
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
        <PageErrorBoundary
          onRetry={async () => {
            const mod = await loadWebModule(tab.key.split('/')[2] ?? '');
            if (mod) resetWebModuleRoutes(mod);
          }}
        >
          <Suspense
            fallback={
              <div role="status" aria-label="正在加载页面" style={{ padding: 24 }}>
                <p>正在加载页面，请稍候…</p>
                <Skeleton active />
              </div>
            }
          >
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

class PageErrorBoundary extends Component<
  { children: ReactNode; onRetry?: () => void | Promise<void> },
  { error: Error | null }
> {
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
          extra={
            <Button
              onClick={() => {
                void Promise.resolve(this.props.onRetry?.()).then(() =>
                  this.setState({ error: null }),
                );
              }}
            >
              重新加载这个页面
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}
