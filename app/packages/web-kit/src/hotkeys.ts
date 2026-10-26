import { useEffect, useRef } from 'react';
import { useTab } from './tabs';

/**
 * 快捷键。写法："Ctrl+S"、"Alt+Shift+M"、"F4"、"Ctrl+I"、"Escape"。不区分大小写。
 * 只在当前可见的标签页生效；默认在输入框里也生效（录入界面需要），不需要时传 allowInInput: false。
 */
export function parseHotkey(combo: string) {
  const parts = combo.split('+').map((p) => p.trim().toLowerCase());
  const key = parts.pop() ?? '';
  return {
    ctrl: parts.includes('ctrl') || parts.includes('control'),
    alt: parts.includes('alt'),
    shift: parts.includes('shift'),
    meta: parts.includes('meta') || parts.includes('cmd'),
    key: key === 'esc' ? 'escape' : key === 'space' ? ' ' : key,
  };
}

export function matchHotkey(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
  combo: string,
) {
  const h = parseHotkey(combo);
  if (h.ctrl !== e.ctrlKey || h.alt !== e.altKey || h.shift !== e.shiftKey || h.meta !== e.metaKey)
    return false;
  const key = e.key.toLowerCase();
  // 带 Alt/Shift 时 e.key 可能变成别的字符，用 e.code 兜底（KeyM → m，Digit1 → 1）
  const fromCode = e.code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .toLowerCase();
  return key === h.key || fromCode === h.key;
}

export interface HotkeyOptions {
  enabled?: boolean;
  allowInInput?: boolean;
  /** 全局快捷键：不受标签页是否可见的限制（壳用） */
  global?: boolean;
}

export function useHotkey(
  combo: string | undefined,
  handler: (e: KeyboardEvent) => void,
  opts: HotkeyOptions = {},
) {
  const tab = useTab();
  const ref = useRef(handler);
  ref.current = handler;
  const enabled = opts.enabled !== false && !!combo && (opts.global || tab.active);
  useEffect(() => {
    if (!enabled || !combo) return;
    const listener = (e: KeyboardEvent) => {
      if (!matchHotkey(e, combo)) return;
      const target = e.target as HTMLElement | null;
      const inInput =
        !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (inInput && opts.allowInInput === false) return;
      e.preventDefault();
      ref.current(e);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [combo, enabled, opts.allowInInput]);
}
