import { useEffect } from 'react';
import manifest from '../manifest';

/**
 * W0壳的TabsHost为每个标签页反复创建标题回调，已打开模块页后切换新路由
 * 可能停在旧标签页。模块暂用正常整页导航完成自己的菜单跳转；无需改壳源码。
 * 共享层稳定标题回调后可删除此兼容钩子。
 */
export function useBookNavigation() {
  useEffect(() => {
    const routes = manifest.menu.map((item) => `/m/books${item.path}`);
    const handle = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
        return;
      const item =
        event.target instanceof Element
          ? event.target.closest('[role="menuitem"][data-menu-id]')
          : null;
      const id = item?.getAttribute('data-menu-id');
      const route = routes.find((route) => id?.endsWith(`-${route}`));
      if (!route || window.location.pathname === route) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign(route);
    };
    document.addEventListener('click', handle, true);
    return () => document.removeEventListener('click', handle, true);
  }, []);
}
