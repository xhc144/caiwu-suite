import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { matchHotkey } from '@caiwu/web-kit';
import type { NavItem } from './NavMenu';
import { canHandleShellKey } from './guards';

export function GlobalHotkeys({
  navItems,
  onSearch,
  onShortcuts,
  onHelp,
}: {
  navItems: NavItem[];
  onSearch: () => void;
  onShortcuts: () => void;
  onHelp: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (!canHandleShellKey(e)) return;
      // W0 没有快捷键优先级登记。凭证/报表页面整体保留其 Ctrl+K，搜索仍可点页头。
      if (
        matchHotkey(e, 'Ctrl+K') &&
        /^\/m\/(voucher-entry|report-engine)(\/|$)/.test(location.pathname)
      )
        return;
      const action = matchHotkey(e, 'Ctrl+K')
        ? onSearch
        : e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey
          ? onShortcuts
          : matchHotkey(e, 'F1')
            ? onHelp
            : undefined;
      const hit = navItems.find(
        (i) =>
          i.shortcut &&
          !['ctrl+s', 'ctrl+p', 'ctrl+k', 'ctrl+f4', 'f1', '?'].includes(
            i.shortcut.toLowerCase(),
          ) &&
          matchHotkey(e, i.shortcut),
      );
      if (action || hit)
        queueMicrotask(() => {
          if (!canHandleShellKey(e)) return;
          e.preventDefault();
          if (action) action();
          else if (hit) void navigate(hit.to);
        });
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [navItems, navigate, onSearch, onShortcuts, onHelp, location.pathname]);
  return null;
}
