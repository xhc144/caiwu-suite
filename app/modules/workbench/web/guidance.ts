import { useSyncExternalStore } from 'react';
import { useRequiredSession } from '@caiwu/web-kit';
const changed = 'workbench-guidance-changed';
const memory = new Map<string, boolean>();
const subscribe = (listener: () => void) => {
  window.addEventListener(changed, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener('storage', listener);
  };
};
/** 非敏感引导标记可在本机跳过；无设置权限也不会反复提示。 */
export function useGuidance() {
  const session = useRequiredSession();
  const key = `caiwu.guide.${session.bookId}.${session.user.id}`;
  const read = () => {
    try {
      return (localStorage.getItem(key) ?? (memory.get(key) ? 'done' : null)) === 'done';
    } catch {
      return memory.get(key) ?? false;
    }
  };
  const dismissed = useSyncExternalStore(subscribe, read, () => false);
  const setDismissed = (value: boolean) => {
    memory.set(key, value);
    try {
      if (value) localStorage.setItem(key, 'done');
      else localStorage.removeItem(key);
    } catch {
      /* 存储禁用时仍不阻断使用 */
    }
    window.dispatchEvent(new Event(changed));
  };
  return { dismissed, setDismissed };
}
