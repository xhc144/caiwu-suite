import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { ModuleManifest } from '@caiwu/core';

export interface WebRoute {
  /** 模块内路径，例如 "/memos"、"/edit"；支持参数 "/documents/:id" */
  path: string;
  /** 标签页默认标题 */
  title: string;
  component: ComponentType | LazyExoticComponent<ComponentType>;
}

/**
 * 可替换的入口页面。壳自带简易版本；模块提供了就用模块的（按模块 id 排序取第一个）。
 * - bookPicker：启动后的账套选择页（账套管理模块提供）
 * - login：登录页（系统管理模块提供），组件收到 bookId
 * - home：登录后的首页 / 工作台（工作台模块提供）
 */
export interface EntryPages {
  bookPicker?: ComponentType;
  login?: ComponentType<{ bookId: string }>;
  home?: ComponentType;
}

export interface WebModule {
  manifest: ModuleManifest;
  routes: WebRoute[];
  entryPages?: EntryPages;
}

type RouteLoader = () => Promise<{ default: ComponentType }>;
const routeLoaders = new WeakMap<WebRoute, RouteLoader>();
/** React 19 lazy initializers are captured before first render so explicit retry constructs a fresh lazy instance. */
export function resetWebModuleRoutes(module: WebModule) {
  for (const route of module.routes) {
    const load = routeLoaders.get(route);
    if (load) route.component = lazy(load);
  }
}

/** modules/<id>/web/index.tsx 默认导出 defineWebModule(...)。页面组件请用 lazy() 按需加载。 */
export function defineWebModule(
  manifest: ModuleManifest,
  def: Omit<WebModule, 'manifest'>,
): WebModule {
  for (const r of def.routes) {
    const component = r.component as {
      $$typeof?: symbol;
      _payload?: { _status?: number; _result?: unknown };
    };
    if (
      component.$$typeof === Symbol.for('react.lazy') &&
      component._payload?._status === -1 &&
      typeof component._payload._result === 'function'
    )
      routeLoaders.set(r, component._payload._result as RouteLoader);
    if (!r.path.startsWith('/'))
      throw new Error(`模块 ${manifest.id} 的路由 ${r.path} 必须以 / 开头`);
  }
  return { manifest, ...def };
}
