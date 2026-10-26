import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { matchHotkey } from '@caiwu/web-kit';
import type { NavItem } from './NavMenu';

/** 模块菜单里声明的全局快捷键：按下就打开对应功能。 */
export function GlobalHotkeys({ navItems }: { navItems: NavItem[] }) {
  const navigate = useNavigate();
  useEffect(() => {
    const withKeys = navItems.filter((i) => i.shortcut);
    if (!withKeys.length) return;
    const listener = (e: KeyboardEvent) => {
      const hit = withKeys.find((i) => matchHotkey(e, i.shortcut!));
      if (hit) {
        e.preventDefault();
        void navigate(hit.to);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [navItems, navigate]);
  return null;
}
