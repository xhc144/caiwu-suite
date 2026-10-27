import { afterEach, expect, it, vi } from 'vitest';
import { RequestActivity } from '../src/loading';
afterEach(() => vi.useRealTimers());
it('w_retrieve_wait：300ms前不闪烁；并发、取消、失败结束计数均清理', () => {
  vi.useFakeTimers();
  const state = new RequestActivity();
  const first = state.start(),
    second = state.start();
  vi.advanceTimersByTime(299);
  expect(state.snapshot()).toEqual({ pending: 2, slow: 0 });
  first();
  vi.advanceTimersByTime(1);
  expect(state.snapshot()).toEqual({ pending: 1, slow: 1 });
  second();
  second();
  expect(state.snapshot()).toEqual({ pending: 0, slow: 0 });
  vi.advanceTimersByTime(1000);
  expect(state.snapshot().slow).toBe(0);
});
