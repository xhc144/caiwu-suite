import { useSyncExternalStore } from 'react';
import type { BookInfo, CurrentUser } from '@caiwu/core';

/** 当前窗口的登录状态（存在 sessionStorage，关掉窗口就没了）。 */
export interface SessionState {
  token: string;
  bookId: string;
  user: CurrentUser;
  book: BookInfo;
}

const KEY = 'caiwu.session';
let current: SessionState | null = read();
const listeners = new Set<() => void>();

function read(): SessionState | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SessionState) : null;
  } catch {
    return null;
  }
}

export const sessionStore = {
  get: () => current,
  set(next: SessionState | null) {
    current = next;
    try {
      if (next) sessionStorage.setItem(KEY, JSON.stringify(next));
      else sessionStorage.removeItem(KEY);
    } catch {
      // 浏览器禁用存储时只保存在内存里
    }
    for (const l of listeners) l();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useSession(): SessionState | null {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.get);
}

/** 已登录时使用（壳内的页面都是已登录的）。 */
export function useRequiredSession(): SessionState {
  const s = useSession();
  if (!s) throw new Error('需要登录');
  return s;
}

/** 当前用户是否有某个权限点（管理员都有）。 */
export function usePermission(permission: string | undefined): boolean {
  const s = useSession();
  if (!permission) return true;
  return !!s && (s.user.isAdmin || s.user.permissions.includes(permission));
}
