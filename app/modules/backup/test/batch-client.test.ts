import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { batchClient } from '../web/batch-client';

const context = vi.hoisted(() => ({ token: 'original', done: vi.fn(), start: vi.fn() }));
vi.mock('@caiwu/web-kit', () => ({
  appToken: () => 'synthetic-startup-token',
  sessionStore: { get: () => ({ token: context.token }) },
  requestActivity: { start: context.start },
}));
beforeEach(() => {
  context.token = 'original';
  context.done.mockReset();
  context.start.mockReset().mockReturnValue(context.done);
});
afterEach(() => {
  vi.unstubAllGlobals();
});
function response() {
  return new Response(JSON.stringify([{ result: { data: { id: 'synthetic-upload' } } }]), {
    headers: { 'content-type': 'application/json' },
  });
}

it('w_tzjl_get_all：HTTP批处理尚未发出时切账，旧包不能借新会话上传', async () => {
  const fetch = vi.fn().mockResolvedValue(response());
  vi.stubGlobal('fetch', fetch);
  const pending = batchClient('original').upload.mutate({ name: '旧账包', base64: 'AAAA' });
  context.token = 'next-book';
  await expect(pending).rejects.toThrow('账套或操作员已变化');
  expect(fetch).not.toHaveBeenCalled();
  expect(context.start).not.toHaveBeenCalled();
});

it('w_tzjl_get_all：请求固定原会话，响应前切账则拒绝旧结果并结束加载状态', async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const pending = batchClient('original').upload.mutate({ name: '旧账包', base64: 'AAAA' });
  const rejected = expect(pending).rejects.toThrow('账套或操作员已变化');
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  const headers = new Headers(fetch.mock.calls[0]![1].headers);
  expect(headers.get('authorization')).toBe('Bearer original');
  expect(headers.get('x-caiwu-token')).toBe('synthetic-startup-token');
  context.token = 'next-book';
  finish(response());
  await rejected;
  expect(context.start).toHaveBeenCalledOnce();
  expect(context.done).toHaveBeenCalledOnce();
});

it('w_tzjl_get_all：会话未变化时返回真实HTTP响应，加载状态正常结束', async () => {
  const fetch = vi.fn().mockResolvedValue(response());
  vi.stubGlobal('fetch', fetch);
  await expect(
    batchClient('original').upload.mutate({ name: '原账包', base64: 'AAAA' }),
  ).resolves.toMatchObject({ id: 'synthetic-upload' });
  expect(context.done).toHaveBeenCalledOnce();
});
