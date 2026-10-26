import { useEffect, useRef, type RefObject } from 'react';

export function confirmDiscard(dirty: boolean, ask: () => boolean, leave: () => void) {
  if (!dirty || ask()) {
    leave();
    return true;
  }
  return false;
}
export const discardQuestion = '有未保存的报表修改。放弃修改并继续？取消将保留当前编辑。';
/** 模块内导航、刷新、鼠标切换/关闭壳标签与 Ctrl+F4；本地草稿同时保留。 */
export function useUnsavedGuard(
  dirty: boolean,
  active: boolean,
  root: RefObject<HTMLDivElement | null>,
  busy = false,
) {
  const bypass = useRef(false);
  useEffect(() => {
    if (!dirty && !busy) return;
    const unload = (e: BeforeUnloadEvent) => {
      if (bypass.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    const click = (e: MouseEvent) => {
      if (!active || !(e.target instanceof Element) || root.current?.contains(e.target)) return;
      if (!e.target.closest('a,button,[role="tab"],[role="menuitem"]')) return;
      if (bypass.current) return;
      if (busy || !window.confirm(discardQuestion)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    const key = (e: KeyboardEvent) => {
      if (active && e.ctrlKey && e.key === 'F4' && (busy || !window.confirm(discardQuestion))) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', click, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [dirty, active, root, busy]);
  return () => {
    bypass.current = true;
  };
}
