import { expect } from '@playwright/test';
import { loginWithNewBook } from '@caiwu/testkit/e2e';
import { seedBalanceCases } from '../test/fixtures';
import { test } from './fixture';

test('余额独立服务：种子失败正常结束辅助占用，后续种子与真实查询仍可用', async ({
  page,
  localServer,
}) => {
  const { bookId } = await loginWithNewBook(page, localServer.request);
  await expect(
    localServer.seed(bookId, async (svc) => {
      await svc.accounts.require('100201');
      throw new Error('合成种子失败');
    }),
  ).rejects.toThrow('合成种子失败');
  expect((await localServer.request.get('/healthz')).ok()).toBe(true);
  await localServer.seed(bookId, seedBalanceCases);
  await page.goto(`${localServer.url}/m/balances?from=202602&to=202602`);
  await expect(
    page.getByRole('row').filter({ has: page.getByRole('cell', { name: '合计', exact: true }) }),
  ).toContainText('738.34');
});
