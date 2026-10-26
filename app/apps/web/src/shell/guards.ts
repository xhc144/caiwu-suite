import type { CurrentUser, ModuleManifest } from '@caiwu/core';
import type { NavItem } from './NavMenu';
import { tabPath } from './paths';

/** 原版 w_main1 的管理员入口规则；不用用户名判断。 */
export function isAdminEntry(title: string, path: string) {
  return (
    /用户管理|操作员管理|账套管理|套账管理/.test(title) || /\/(users|books)(\/|$|\?)/.test(path)
  );
}

export function routeAccess(
  pathname: string,
  modules: ModuleManifest[],
  items: NavItem[],
  user: CurrentUser,
): 'allow' | 'denied' | 'missing' {
  if (pathname === '/home') return 'allow';
  const id = pathname.split('/')[2];
  const manifest = modules.find((m) => m.id === id);
  if (!manifest) return 'missing';
  // 只按明确菜单路径授权。不把根菜单权限推测成整个模块的权限。
  const declared = manifest.menu.filter(
    (i) => tabPath(`/m/${manifest.id}${i.path.split('?')[0]}`) === tabPath(pathname),
  );
  if (declared.length)
    return items.some((i) => tabPath(i.to.split('?')[0]!) === tabPath(pathname))
      ? 'allow'
      : 'denied';
  return user.isAdmin ? 'allow' : 'denied';
}

export function checkBeforeLeave() {
  const event = new Event('beforeunload', { cancelable: true });
  return window.dispatchEvent(event) && !event.defaultPrevented;
}

/** 输入、网格、组合输入优先；壳监听只在冒泡结束后处理。 */
export function editableTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest(
      'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="grid"],[role="dialog"],[data-hotkey-context]',
    )
  );
}
export function canHandleShellKey(e: KeyboardEvent) {
  return !e.defaultPrevented && !e.isComposing && e.keyCode !== 229 && !editableTarget(e.target);
}
