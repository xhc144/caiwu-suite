import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { test, expect } from './isolated';

test('独立发票 fixture：种子过程失败也释放请求、账套与辅助 runtime 租约', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request);
  await expect(
    isolated.inBook(bookId, async (svc) => {
      expect((await svc.book.info()).id).toBe(bookId);
      throw new Error('合成种子失败');
    }),
  ).rejects.toThrow('合成种子失败');
  const result = await isolated.inBook(bookId, async (svc) => ({ id: (await svc.book.info()).id }));
  expect(result.id).toBe(bookId);
  const me = await callApi<{ book: { id: string } }>(
    isolated.request,
    'core.auth.me',
    {},
    {
      token,
      method: 'GET',
    },
  );
  expect(me.book.id).toBe(bookId);
});
