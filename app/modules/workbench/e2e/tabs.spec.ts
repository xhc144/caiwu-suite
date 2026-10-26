import { expect, test } from '@playwright/test';
import { loginWithNewBook } from '@caiwu/testkit/e2e';

test('快速回切：路由提交前的Ctrl+F4关闭刚选择的标签，首页保持不可关闭', async ({
  page,
  request,
}) => {
  await loginWithNewBook(page, request);
  await page.goto('/m/example/memos');
  const input = page.getByLabel('摘要', { exact: true });
  await input.fill('路由提交前的输入');
  const home = page.getByRole('tab', { name: '首页', exact: true });
  const memo = page.getByRole('tab', { name: '示范记账单', exact: true });
  await home.click();
  await expect(home).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/\/home$/);
  // 同一个浏览器任务内点击并按键，稳定覆盖React路由尚未提交的窗口。
  await memo.evaluate((element) => {
    (element as HTMLElement).click();
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F4',
        code: 'F4',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(memo).toHaveCount(0);
  await expect(page).toHaveURL(/\/home$/);
  await expect(home).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+F4');
  await expect(home).toHaveCount(1);
});

test('可见活动页Ctrl+F4：原生按键重复关闭、保留取消离开和标签输入', async ({ page, request }) => {
  await loginWithNewBook(page, request);
  await page.goto('/m/example/memos');
  const input = page.getByLabel('摘要', { exact: true });
  const home = page.getByRole('tab', { name: '首页', exact: true });
  const memo = page.getByRole('tab', { name: '示范记账单', exact: true });
  for (let i = 0; i < 3; i++) {
    if (i > 0) await page.getByRole('menuitem', { name: /示范记账单/ }).click();
    await expect(memo).toHaveAttribute('aria-selected', 'true');
    await expect(input).toBeVisible();
    await input.fill(`未提交筛选${i}`);
    await home.click();
    await expect(home).toHaveAttribute('aria-selected', 'true');
    await memo.click();
    await expect(page).toHaveURL(/\/m\/example\/memos$/);
    await expect(memo).toHaveAttribute('aria-selected', 'true');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue(`未提交筛选${i}`);
    await page.evaluate(() => {
      window.onbeforeunload = (event) => event.preventDefault();
    });
    await page.keyboard.press('Control+F4');
    await expect(memo).toHaveCount(1);
    await expect(memo).toHaveAttribute('aria-selected', 'true');
    await expect(input).toHaveValue(`未提交筛选${i}`);
    await page.evaluate(() => {
      window.onbeforeunload = null;
    });
    await page.keyboard.press('Control+F4');
    await expect(memo).toHaveCount(0);
    await expect(page).toHaveURL(/\/home$/);
  }
});
