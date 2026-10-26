import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { GlobalHotkeys } from './GlobalHotkeys';
import { canHandleShellKey, checkBeforeLeave } from './guards';

afterEach(cleanup);
const flush = () =>
  act(async () => {
    await Promise.resolve();
  });
describe('壳快捷键上下文', () => {
  it('尊重输入/IME/网格/defaultPrevented，不抢业务Ctrl+K，卸载清理监听', async () => {
    const search = vi.fn();
    const shortcuts = vi.fn();
    const help = vi.fn();
    const view = render(
      <MemoryRouter>
        <GlobalHotkeys navItems={[]} onSearch={search} onShortcuts={shortcuts} onHelp={help} />
        <input aria-label="编辑" />
        <div role="grid" tabIndex={0}>
          表格
        </div>
        <div contentEditable suppressContentEditableWarning>
          富文本
        </div>
      </MemoryRouter>,
    );
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true });
    await flush();
    expect(search).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText('编辑'), { key: 'k', code: 'KeyK', ctrlKey: true });
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'k', code: 'KeyK', ctrlKey: true });
    fireEvent.keyDown(screen.getByText('富文本'), { key: '?', code: 'Slash', shiftKey: true });
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true, isComposing: true });
    await flush();
    expect(search).toHaveBeenCalledTimes(1);
    expect(shortcuts).not.toHaveBeenCalled();
    const prevented = new KeyboardEvent('keydown', {
      key: 'k',
      code: 'KeyK',
      ctrlKey: true,
      cancelable: true,
    });
    prevented.preventDefault();
    window.dispatchEvent(prevented);
    await flush();
    expect(search).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: '?', code: 'Slash', shiftKey: true });
    fireEvent.keyDown(window, { key: 'F1', code: 'F1' });
    await flush();
    expect(shortcuts).toHaveBeenCalledOnce();
    expect(help).toHaveBeenCalledOnce();
    view.unmount();
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true });
    await flush();
    expect(search).toHaveBeenCalledTimes(1);
  });
  it('凭证和报表页整体保留Ctrl+K业务上下文，搜索入口可由按钮使用', async () => {
    for (const path of ['/m/voucher-entry/edit', '/m/report-engine/report']) {
      const search = vi.fn();
      const view = render(
        <MemoryRouter initialEntries={[path]}>
          <GlobalHotkeys navItems={[]} onSearch={search} onShortcuts={() => {}} onHelp={() => {}} />
        </MemoryRouter>,
      );
      fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true });
      await flush();
      expect(search).not.toHaveBeenCalled();
      view.unmount();
    }
  });
  it('已有beforeunload取消离开时壳保留页面', () => {
    const listener = (e: Event) => e.preventDefault();
    window.addEventListener('beforeunload', listener);
    expect(checkBeforeLeave()).toBe(false);
    window.removeEventListener('beforeunload', listener);
    expect(checkBeforeLeave()).toBe(true);
    const e = new KeyboardEvent('keydown', { key: '?', cancelable: true });
    e.preventDefault();
    expect(canHandleShellKey(e)).toBe(false);
  });
});
