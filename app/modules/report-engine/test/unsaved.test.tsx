import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, renderHook } from '@testing-library/react';
import { useUnsavedGuard } from '../web/unsaved';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});
describe('w_bb_def 未保存确认', () => {
  it('取消阻止实际外部点击和Ctrl+F4，页内编辑与函数向导按钮不被拦截', () => {
    const root = document.createElement('div'),
      inside = document.createElement('button'),
      outside = document.createElement('button');
    root.appendChild(inside);
    document.body.append(root, outside);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const next = vi.fn();
    outside.addEventListener('click', next);
    const ref = { current: root };
    const hook = renderHook(() => useUnsavedGuard(true, true, ref));
    expect(fireEvent.click(inside)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(fireEvent.click(outside)).toBe(false);
    expect(next).not.toHaveBeenCalled();
    expect(
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'F4', ctrlKey: true, cancelable: true }),
      ),
    ).toBe(false);
    confirm.mockReturnValue(true);
    expect(fireEvent.click(outside)).toBe(true);
    expect(next).toHaveBeenCalledOnce();
    hook.unmount();
    expect(fireEvent.click(outside)).toBe(true);
  });
  it('刷新前有真实beforeunload保护，显式确认离开可一次性放行', () => {
    const ref = { current: document.createElement('div') };
    const hook = renderHook(() => useUnsavedGuard(true, true, ref));
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false);
    hook.result.current();
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true);
    hook.unmount();
  });
  it('保存后解除保护，隐藏标签的页内操作不拦截其他页面', () => {
    const ref = { current: document.createElement('div') };
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const button = document.createElement('button');
    document.body.appendChild(button);
    const hook = renderHook(({ dirty, active }) => useUnsavedGuard(dirty, active, ref), {
      initialProps: { dirty: true, active: false },
    });
    expect(fireEvent.click(button)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    hook.rerender({ dirty: false, active: true });
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true);
    hook.unmount();
  });
});
