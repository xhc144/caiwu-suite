import { callApi } from '@caiwu/testkit/e2e';
import { test, expect } from './fixture';
import { bankBook } from './scenarios';
import type { Outputs } from '../web/api';

const feedback = { timeout: 5000 };
test('支票管理 页面领用、签发与兑付，强确认、真实金额和终态保护', async ({ cashier }) => {
  const book = await bankBook(cashier);
  const { page } = cashier;
  await test.step(
    '支票页面5秒内可用',
    async () => {
      await page.goto('/m/cashier/checks');
      await expect(page.getByRole('heading', { name: '支票登记簿', exact: true })).toBeVisible();
    },
    feedback,
  );
  await page.getByRole('button', { name: '领用支票', exact: true }).click();
  let drawer = page.getByRole('dialog', { name: '领用支票', exact: true });
  await drawer.getByLabel('银行账户', { exact: true }).click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await drawer.getByLabel('支票号码', { exact: true }).fill('UI-001');
  await drawer.getByLabel('办理日期', { exact: true }).fill('2026-01-02');
  await test.step(
    '领用5秒内真实保存',
    async () => {
      await drawer.getByRole('button', { name: '保存支票登记', exact: true }).click();
      await expect(drawer).not.toBeVisible();
      await expect(page.getByRole('row', { name: /UI-001/ })).toContainText('已领用');
    },
    feedback,
  );
  await page
    .getByRole('row', { name: /UI-001/ })
    .getByRole('button', { name: '签发', exact: true })
    .click();
  drawer = page.getByRole('dialog', { name: '签发支票', exact: true });
  await drawer.getByLabel('办理日期', { exact: true }).fill('2026-01-05');
  await drawer.getByLabel('收款人', { exact: true }).fill('合成供应商');
  await drawer.getByLabel('签发金额', { exact: true }).fill('100.01');
  await drawer.getByRole('button', { name: '保存支票登记', exact: true }).click();
  let confirm = page.getByRole('dialog', { name: '签发支票 UI-001', exact: true });
  await expect(confirm.getByRole('button', { name: '确定', exact: true })).toBeDisabled();
  await confirm.getByLabel('确认文字').fill('签发支票');
  await test.step(
    '签发5秒内保存收款人和整数金额',
    async () => {
      await confirm.getByRole('button', { name: '确定', exact: true }).click();
      await expect(drawer).not.toBeVisible();
      await expect(page.getByRole('row', { name: /UI-001/ })).toContainText('100.01');
      await expect(page.getByRole('row', { name: /UI-001/ })).toContainText('已签发');
    },
    feedback,
  );
  await page
    .getByRole('row', { name: /UI-001/ })
    .getByRole('button', { name: '登记兑付', exact: true })
    .click();
  drawer = page.getByRole('dialog', { name: '登记兑付', exact: true });
  await drawer.getByLabel('办理日期', { exact: true }).fill('2026-01-06');
  await drawer.getByRole('button', { name: '保存支票登记', exact: true }).click();
  confirm = page.getByRole('dialog', { name: '登记兑付 UI-001', exact: true });
  await confirm.getByLabel('确认文字').fill('登记兑付');
  await test.step(
    '兑付5秒内持久化并隐藏终态操作',
    async () => {
      await confirm.getByRole('button', { name: '确定', exact: true }).click();
      await expect(page.getByRole('row', { name: /UI-001/ })).toContainText('已兑付');
      await expect(page.getByRole('row', { name: /UI-001/ }).getByRole('button')).toHaveCount(0);
    },
    feedback,
  );
  const rows = await callApi<Outputs['checks']>(
    cashier.request,
    'm.cashier.checks',
    {},
    { token: book.token, method: 'GET' },
  );
  expect(rows[0]).toMatchObject({
    amount: 10001,
    payee: '合成供应商',
    state: 'cleared',
    revision: 3,
  });
  await expect(
    callApi(
      cashier.request,
      'm.cashier.finishCheck',
      { id: rows[0]!.id, revision: 3, date: '2026-01-07', state: 'voided', confirmed: true },
      { token: book.token },
    ),
  ).rejects.toThrow('不能再次');
});
