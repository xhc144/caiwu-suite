import { describe, expect, it } from 'vitest';
import { matchHotkey } from '../src/hotkeys';

const ev = (
  key: string,
  mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {},
  code = '',
) => ({
  key,
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe('快捷键匹配', () => {
  it('修饰键必须完全一致', () => {
    expect(matchHotkey(ev('s', { ctrlKey: true }), 'Ctrl+S')).toBe(true);
    expect(matchHotkey(ev('s', { ctrlKey: true, shiftKey: true }), 'Ctrl+S')).toBe(false);
    expect(matchHotkey(ev('F4'), 'F4')).toBe(true);
    expect(matchHotkey(ev('F4', { ctrlKey: true }), 'Ctrl+F4')).toBe(true);
    expect(matchHotkey(ev('Escape'), 'Esc')).toBe(true);
  });

  it('Alt/Shift 改变了字符时按物理键匹配', () => {
    expect(matchHotkey(ev('µ', { altKey: true }, 'KeyM'), 'Alt+M')).toBe(true);
    expect(matchHotkey(ev('!', { shiftKey: true }, 'Digit1'), 'Shift+1')).toBe(true);
  });
});
