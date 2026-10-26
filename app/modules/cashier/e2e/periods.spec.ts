import { callApi } from '@caiwu/testkit/e2e';
import { test, expect } from './fixture';
import { bankBook, recordThree, documents } from './scenarios';
import type { Outputs } from '../web/api';

const feedback = { timeout: 5000 };

test('w_cn_fz/fjz 页面真实月结、取消确认与反结账，原单金额/总账期间均保留', async ({ cashier }) => {
  const book = await bankBook(cashier);
  await recordThree(cashier, book);
  const before = await documents(cashier, book);
  const { page } = cashier;
  await test.step(
    '期间页在5秒内显示真实结余',
    async () => {
      await page.goto('/m/cashier/periods');
      await expect(page.getByText('当前出纳月份：2026年01月', { exact: true })).toBeVisible();
      await expect(page.getByRole('row', { name: /闭环银行/ })).toContainText('1,145.00');
    },
    feedback,
  );
  await page.getByRole('button', { name: '结账当前出纳月份', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '结账 2026年01月' });
  await expect(dialog.getByRole('button', { name: '确定', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(
    (
      await callApi<Outputs['periods']>(cashier.request, 'm.cashier.periods', undefined, {
        token: book.token,
        method: 'GET',
      })
    ).current,
  ).toBe(202601);
  await page.getByRole('button', { name: '结账当前出纳月份', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '结账 2026年01月' });
  await dialog.getByLabel('确认文字').fill('出纳结账');
  await test.step(
    '结账在5秒内持久化并反馈',
    async () => {
      await dialog.getByRole('button', { name: '确定', exact: true }).click();
      await expect(page.getByText('当前出纳月份：2026年02月', { exact: true })).toBeVisible();
      await expect(page.getByRole('row', { name: /2026年01月 已结账/ })).toBeVisible();
    },
    feedback,
  );
  await page.getByRole('button', { name: '反结账最近出纳月份', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '反结账 2026年01月' });
  await dialog.getByLabel('确认文字').fill('出纳反结账');
  await test.step(
    '反结账在5秒内恢复当前月份',
    async () => {
      await dialog.getByRole('button', { name: '确定', exact: true }).click();
      await expect(page.getByText('当前出纳月份：2026年01月', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('button', { name: '反结账最近出纳月份', exact: true }),
      ).toBeDisabled();
    },
    feedback,
  );
  expect(await documents(cashier, book)).toEqual(before);
  await cashier.withServices(book.bookId, async (svc) => {
    expect((await svc.periods.require(202601)).status).toBe('open');
    expect(await svc.vouchers.list({})).toEqual({ items: [], total: 0 });
  });
});
