import { afterEach, expect, it, vi } from 'vitest';
import { CloseHandshake } from '../close-handshake';
afterEach(() => vi.useRealTimers());
it('原生关闭等待异步保存回应，取消/失败/新编辑不关闭，重试成功才关闭', async () => {
  const guard = new CloseHandshake();
  let id = '';
  for (const allowed of [false, false, false, true]) {
    let resolved = false;
    const pending = guard
      .request((value) => {
        id = value;
      })
      .then((value) => {
        resolved = true;
        return value;
      });
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(
      await guard.request(() => {
        throw new Error('不能重复发起');
      }),
    ).toBe(false);
    guard.respond('旧请求', true);
    expect(resolved).toBe(false);
    guard.respond(id, allowed);
    expect(await pending).toBe(allowed);
  }
});
it('页面不回应、发送失败、窗口销毁均不确认关闭，迟到回应不释放下一请求', async () => {
  vi.useFakeTimers();
  const guard = new CloseHandshake();
  let old = '';
  const timeout = guard.request((id) => {
    old = id;
  });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await timeout).toBe(false);
  expect(
    await guard.request(() => {
      throw new Error('页面退出');
    }),
  ).toBe(false);
  const pending = guard.request(() => {});
  guard.respond(old, true);
  guard.cancel();
  expect(await pending).toBe(false);
});
